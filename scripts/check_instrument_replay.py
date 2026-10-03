"""Opt-in pinned native integration; network reads clone only declared repos.

All generated fixtures/checkouts are temporary. The ESM integration test uses
the existing in-memory evidence seam, never canonical records or a release.
"""

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile

CIW_REVISION = "eabb45d3255766d052938bd3033b1dc7027b3844"
REPOSITORIES = {
    "ppda": "Provenance-Preserving-Data-Acquisition",
    "stfe": "Streaming-Telemetry-Feature-Extraction",
    "gsie": "Geometric-State-Inference-Engine",
    "set": "State-Estimation-Evaluation-Testbed",
}


def clone(repository, revision, destination):
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise ValueError("full source commit pin required")
    environment = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}
    token = os.environ.get("INSTRUMENT_REPLAY_TOKEN", "")
    if token:
        askpass = destination.parent / ".git-askpass"
        askpass.write_text("""#!/bin/sh
case "$1" in
  *Username*) printf '%s\\n' x-access-token ;;
  *Password*) printf '%s\\n' "$INSTRUMENT_REPLAY_TOKEN" ;;
  *) exit 1 ;;
esac
""")
        askpass.chmod(stat.S_IRUSR | stat.S_IWUSR | stat.S_IXUSR)
        environment["GIT_ASKPASS"] = str(askpass)
    subprocess.run(["git", "clone", "--no-checkout", "--filter=blob:none",
                    f"https://github.com/giasonpooni/{repository}.git", str(destination)],
                   check=True, timeout=120, env=environment)
    subprocess.run(["git", "--no-replace-objects", "-C", str(destination),
                    "-c", "core.autocrlf=false", "checkout", "--detach", revision],
                   check=True, timeout=120)


def main():
    root = Path(__file__).resolve().parents[1]
    helper = root / "scripts/instrument-replay-verify.py"
    spec = importlib.util.spec_from_file_location("esm_checked_source", helper)
    gate = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gate)
    with tempfile.TemporaryDirectory(prefix="esm-native-replay-") as directory:
        scratch = Path(directory)
        ciw = scratch / "Computational-Instrumentation-Workbench"
        clone("Computational-Instrumentation-Workbench", CIW_REVISION, ciw)
        runtimes = {"ciw": {"path": str(ciw), "revision": CIW_REVISION}}
        gate.checkout(runtimes["ciw"])
        pins = json.loads((ciw / "src/ciw/telemetry-runtimes.json").read_text())
        for role, repository in REPOSITORIES.items():
            destination = scratch / repository
            clone(repository, pins[role]["revision"], destination)
            runtimes[role] = {"path": str(destination), "revision": pins[role]["revision"]}
            gate.checkout(runtimes[role], standalone_ppda=role == "ppda")
        sys.path.insert(0, str(ciw / "src"))
        sys.pycache_prefix = str(scratch / "fresh-bytecode")
        sys.dont_write_bytecode = True
        from ciw.telemetry import create_session, save_session
        configuration = json.loads((ciw / "examples/telemetry/configuration.json").read_text())
        bundle = create_session((ciw / "examples/telemetry/source.json").read_bytes(), configuration,
                                {role: Path(pin["path"]) for role, pin in runtimes.items() if role != "ciw"})
        bundle_path = scratch / "telemetry-session.json"
        save_session(bundle, scratch)
        runtime_path = scratch / "operator-runtime.json"
        runtime_path.write_text(json.dumps({
            "python": sys.executable,
            "pythonSha256": hashlib.sha256(Path(sys.executable).read_bytes()).hexdigest(),
            "helperPath": str(helper), "repositories": runtimes,
        }))
        environment = {**os.environ, "ESM_TELEMETRY_BUNDLE_FILE": str(bundle_path),
                       "ESM_TELEMETRY_RUNTIME_FILE": str(runtime_path)}
        return subprocess.call(["npm", "exec", "--", "vitest", "run",
                                "src/data-os/instrument-result.integration.test.ts"],
                               cwd=root, env=environment, timeout=360)


if __name__ == "__main__":
    raise SystemExit(main())
