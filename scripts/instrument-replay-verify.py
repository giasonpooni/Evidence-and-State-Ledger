"""Read-only ESM adapter to pinned native CIW replay and fresh SET verification.

Invoked only by the Node server helper, in Python isolated mode. Runtime paths
and source pins are operator configuration, not fields interpreted from a
candidate bundle. This adapter creates no artifacts, fetches no code and admits
no corpus records. A hash match is not source authenticity.
"""

from __future__ import annotations

import base64
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from datetime import datetime
from decimal import Decimal


def unique(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON member")
        result[key] = value
    return result


def strict_json(value: str | bytes) -> object:
    def finite_float(text: str) -> float:
        number = float(text)
        if not math.isfinite(number) or (number == 0.0 and Decimal(text) != 0):
            raise ValueError("JSON numeric overflow or nonzero underflow")
        return number
    return json.loads(value, object_pairs_hook=unique,
                      parse_float=finite_float,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError("nonfinite JSON")))


def git(path: Path, *args: str) -> str:
    return subprocess.check_output(["git", "--no-replace-objects", "-c", "core.fsmonitor=false", "-C", str(path), *args],
                                   timeout=5, stderr=subprocess.DEVNULL,
                                   env={key: value for key, value in os.environ.items() if not key.startswith("GIT_")}, text=True).strip()


def checkout(runtime: dict[str, object], *, standalone_ppda: bool = False) -> Path:
    if set(runtime) != {"path", "revision"}:
        raise ValueError("runtime must name only an approved path and revision")
    path = Path(runtime["path"])
    revision = runtime["revision"]
    if not path.is_absolute() or not path.is_dir():
        raise ValueError("runtime path must be an absolute existing checkout")
    if not isinstance(revision, str) or not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise ValueError("runtime revision must be a full commit SHA")
    if git(path, "rev-parse", "HEAD") != revision:
        raise ValueError("runtime source pin mismatch")
    if Path(git(path, "rev-parse", "--show-toplevel")).resolve() != path.resolve():
        raise ValueError("runtime must be a checkout root")
    if git(path, "status", "--porcelain", "--untracked-files=all"):
        raise ValueError("runtime checkout is not clean")
    caches = {".venv", "venv", "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache"}
    exclusions = [f":(exclude,glob)**/{name}/**" for name in sorted(caches)]
    if git(path, "ls-files", "--others", "-z", "--", ".", *exclusions):
        raise ValueError("runtime contains untracked or ignored non-cache files")
    # Hash actual bytes, not the index/status promise. This catches
    # assume-unchanged/skip-worktree and ignored executable shadow modules.
    for entry in git(path, "ls-tree", "-r", "-z", revision).split("\0"):
        if not entry:
            continue
        metadata, name = entry.split("\t", 1)
        mode, kind, expected = metadata.split()
        source = path / name
        # CIW's PPDA adapter executes only separately checked bridge source.
        # Its unrelated vendor gitlink is not an import or execution authority.
        if standalone_ppda and mode == "160000" and kind == "commit" and not name.startswith("bridge/"):
            continue
        if kind != "blob" or mode == "120000" or source.is_symlink() or not source.is_file():
            raise ValueError("runtime source links/submodules/missing files refused")
        if any(parent.is_symlink() for parent in source.parents if parent != path.parent):
            raise ValueError("runtime source parent symlink refused")
        content = source.read_bytes()
        actual = hashlib.sha1(b"blob " + str(len(content)).encode() + b"\0" + content).hexdigest()
        if actual != expected:
            raise ValueError("runtime source bytes do not match pin")
        if os.name == "posix" and bool(source.stat().st_mode & 0o111) != (mode == "100755"):
            raise ValueError("runtime source mode mismatch")
    return path.resolve()


def workflow_spec(schema: object) -> tuple[str, set[str], set[str]]:
    """Only reviewed native lanes select code; artifacts cannot name imports."""
    if schema == "ciw.telemetry-session.v1":
        return "ciw.telemetry", {"ciw", "ppda", "stfe", "gsie", "set"}, {"cbsr"}
    if schema == "ciw.calibrated-observable-session.v1":
        return "ciw.calibrated_observable", {"ciw", "fsrt", "tbrt", "mcur", "oit", "gsie", "cbsr", "fdir", "set"}, set()
    raise ValueError("unsupported native candidate schema")


def process_assessment(bundle: dict) -> dict:
    steps = {step["runtime_ref"]: step for step in bundle["steps"]}
    estimate = steps["gsie"]["result"]["data"]
    observability = steps["oit"]["result"]["data"]
    faults = steps["fdir"]["result"]["data"]
    return {"stateResultId": steps["gsie"]["result_id"], "stateId": estimate["state_id"],
        "observabilityResultId": steps["oit"]["result_id"], "observabilityStatus": observability["status"],
        "reconciliationResultId": steps["cbsr"]["result_id"], "faultResultId": steps["fdir"]["result_id"],
        "residualBasis": faults["residual_basis"], "detectionStatus": faults["detection"]["status"],
        "isolabilityStatus": faults["isolability"]["status"],
        "crossCovariancePolicy": faults["isolability"]["cross_covariance_policy"],
        "isolatedFault": faults["isolability"]["isolated_fault"]}


def main() -> dict[str, object]:
    payload = strict_json(sys.stdin.buffer.read(12 * 1024 * 1024 + 1))
    if not isinstance(payload, dict) or set(payload) != {"bundleBase64", "runtime", "pythonSha256", "inspectedAt"}:
        raise ValueError("invalid trusted adapter input")
    if hashlib.sha256(Path(sys.executable).read_bytes()).hexdigest() != payload["pythonSha256"]:
        raise ValueError("interpreter pin mismatch")
    bundle_bytes = base64.b64decode(payload["bundleBase64"], validate=True)
    if not 0 < len(bundle_bytes) <= 8 * 1024 * 1024:
        raise ValueError("bundle byte limit")
    bundle = strict_json(bundle_bytes)
    if not isinstance(bundle, dict):
        raise ValueError("bundle must be an object")
    module_name, required, optional = workflow_spec(bundle.get("schema"))
    runtime = payload["runtime"]
    if not isinstance(runtime, dict) or not required <= set(runtime) or set(runtime) - required - optional:
        raise ValueError("unsupported or incomplete runtime map")
    repositories = {role: checkout(pin, standalone_ppda=role == "ppda") for role, pin in runtime.items()}
    if datetime.fromisoformat(payload["inspectedAt"].replace("Z", "+00:00")) < datetime.fromisoformat(bundle["created_at"].replace("Z", "+00:00")):
        raise ValueError("inspection cannot precede the retained session")
    # No bundle-supplied module paths, import names, subprocess argv or URLs.
    sys.path.insert(0, str(repositories["ciw"] / "src"))
    sys.path.insert(0, str(repositories["set"]))
    # -B disables writes, but still reads caches. A fresh prefix prevents
    # forged ignored bytecode from overriding the source bytes just verified.
    with tempfile.TemporaryDirectory(prefix="esm-replay-import-") as temporary:
        sys.pycache_prefix = str(Path(temporary) / "bytecode")
        # Never fall back to a globally installed package when a selected
        # checkout lacks the named entry point. Check the parent before a
        # dotted find_spec can import its initializer.
        for module, root in ((module_name, repositories["ciw"] / "src"),
                             ("state_estimation_testbed.replay", repositories["set"])):
            parent = module.split(".")[0]
            for name in (parent, module):
                spec = importlib.util.find_spec(name)
                if spec is None or spec.origin is None or not Path(spec.origin).resolve().is_relative_to(root):
                    raise ValueError("verifier import resolved outside approved source")
        replay_session = importlib.import_module(module_name).replay_session
        from state_estimation_testbed.replay import verify_replay_bundle

        replay = replay_session(bundle, repositories={key: path for key, path in repositories.items() if key != "ciw"})
        verification = verify_replay_bundle(
            bundle, replay_results=replay["replay_results"],
            verifier_ref="set:replay-binding.v1@" + runtime["set"]["revision"],
            created_at=payload["inspectedAt"],
        )
    if verification["outcome"] != "passed":
        raise ValueError("fresh replay verification refused")
    # A concurrent checkout change cannot produce a successful inspection.
    for role, pin in runtime.items():
        checkout(pin, standalone_ppda=role == "ppda")
    binding = verification["binding"]
    evidence = [{"artifactRef": ref, "digest": digest}
                for ref, digest in sorted(binding["evidence_digests"].items())]
    calibrated = bundle["schema"] == "ciw.calibrated-observable-session.v1"
    reconciliations = [step["result"]["data"] if calibrated else step["result"]
                      for step in bundle["steps"] if step["operation_id"] == "cbsr.affine-exact.v1"]
    if len(reconciliations) > 1:
        raise ValueError("only one declared reconciliation is supported")
    reconciliation = {"status": "not_run", "outputConstraintResidualZero": None}
    if reconciliations:
        result = reconciliations[0]
        reconciliation = {"status": result["status"],
                          "outputConstraintResidualZero": result["output_constraint_residual_zero"]}
    numerical_ids = set(binding["numerical_result_ids"].values())
    for step in bundle["steps"]:
        # Preserve instrument-issued numerical IDs as well as CIW step IDs.
        # All result bytes have just been exactly reproduced by trusted CIW.
        result = step["result"]
        for artifact in (result, result.get("result_artifact", {}), result.get("data", {})):
            native = artifact.get("numerical_result_id")
            if isinstance(native, str) and native:
                numerical_ids.add(native)
        if calibrated and step["runtime_ref"] == "gsie":
            numerical_ids.add(result["data"]["state_id"])
    response = {
        "bundleBytesDigest": "sha256:" + hashlib.sha256(bundle_bytes).hexdigest(),
        "bundleDigest": binding["bundle_digest"],
        "evidence": evidence,
        "evidenceDigests": sorted(set(binding["evidence_digests"].values())),
        "operationPins": binding["operation_pins"],
        "executionIds": binding["execution_ids"],
        "numericalResultIds": sorted(numerical_ids),
        "runtimePins": {role: pin["revision"] for role, pin in runtime.items()},
        "interpreterSha256": payload["pythonSha256"],
        "reconciliation": reconciliation,
        "verification": verification,
    }
    if calibrated:
        response["processAssessment"] = process_assessment(bundle)
    return response


if __name__ == "__main__":
    try:
        print(json.dumps(main(), sort_keys=True, allow_nan=False))
    except Exception:
        # Do not echo confidential source bytes, runtime paths or child output.
        print("trusted replay adapter refused", file=sys.stderr)
        raise SystemExit(1)
