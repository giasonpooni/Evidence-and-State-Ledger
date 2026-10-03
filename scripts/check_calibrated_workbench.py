"""Real, source-pinned calibrated CIW → SET → ESM candidate integration."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

CIW_REVISION = "e0af0472d9731eff603c13568325f15d14d2de5b"
REPOS = {
    "fsrt": "Fluid-State-Reconstruction-Testbed",
    "tbrt": "Time-Base-Reconciliation-Runtime",
    "mcur": "Metrological-Calibration-Uncertainty-Runtime",
    "oit": "Observability-Identifiability-Testbed",
    "gsie": "Geometric-State-Inference-Engine",
    "cbsr": "Constraint-Based-State-Reconciliation",
    "fdir": "Fault-Detection-Isolation-Runtime",
    "set": "State-Estimation-Evaluation-Testbed",
}


def clone(name, revision, path):
    subprocess.run(["git", "clone", "--quiet", "--no-checkout",
                    "https://github.com/giasonpooni/" + name + ".git", str(path)], check=True)
    subprocess.run(["git", "-C", str(path), "checkout", "--quiet", "--detach", revision], check=True)
    return path


def run(directory, ciw_path=None, stack_root=None):
    esm = Path(__file__).resolve().parents[1]
    ciw = ciw_path.resolve() if ciw_path else clone("Computational-Instrumentation-Workbench", CIW_REVISION, directory / "ciw")
    pins = json.loads((ciw / "src/ciw/calibrated-observable-runtimes.json").read_text())
    repositories = {role: (stack_root / role).resolve() if stack_root else clone(REPOS[role], pin["revision"], directory / role)
                    for role, pin in pins.items()}
    sys.path.insert(0, str(ciw / "src"))
    from ciw.calibrated_observable import canonical, create_session
    bundle = create_session((ciw / "examples/calibrated-observable/source.json").read_bytes(), repositories)
    runtime = {"python": sys.executable, "pythonSha256": hashlib.sha256(Path(sys.executable).read_bytes()).hexdigest(),
               "helperPath": str(esm / "scripts/instrument-replay-verify.py"),
               "repositories": {"ciw": {"path": str(ciw), "revision": CIW_REVISION},
                   **{role: {"path": str(path), "revision": pins[role]["revision"]} for role, path in repositories.items()}}}
    bundle_path, runtime_path = directory / "bundle.json", directory / "runtime.json"
    bundle_path.write_bytes(canonical(bundle))
    runtime_path.write_text(json.dumps(runtime))
    environment = {**os.environ, "ESM_TELEMETRY_BUNDLE_FILE": str(bundle_path), "ESM_TELEMETRY_RUNTIME_FILE": str(runtime_path)}
    subprocess.run(["npx", "vitest", "run", "src/data-os/instrument-result.integration.test.ts",
                    "src/data-os/workbench-candidate.integration.test.ts"], cwd=esm, env=environment, check=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ciw-repo", type=Path)
    parser.add_argument("--stack-root", type=Path)
    parser.add_argument("--output-dir", type=Path)
    args = parser.parse_args()
    if args.output_dir:
        args.output_dir.mkdir(parents=True, exist_ok=True)
        run(args.output_dir.resolve(), args.ciw_repo, args.stack_root)
    else:
        with tempfile.TemporaryDirectory(prefix="esm-calibrated-") as temporary:
            run(Path(temporary), args.ciw_repo, args.stack_root)
