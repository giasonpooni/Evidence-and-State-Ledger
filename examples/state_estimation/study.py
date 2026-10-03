"""Synthetic partial-observation research recipe; not an ESM admission service.

The numerical estimator remains in the pinned GSIE repository. This example
creates observations, calls that provider, and reports local reference diagnostics.
It never collects real data, authorizes an action, or writes canonical state.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import hashlib
import importlib
import importlib.util
import json
from pathlib import Path
import sys
import subprocess
import tempfile
from uuid import uuid4

import numpy as np
from scipy.stats import chi2

GSIE_REVISION = "4ec062bb72caa76ce1405f2851766589cee9d160"
HELPER_BLOB = "065c3c5057d05e2a153587ac539b80f7290310c7"
FRAME = "synthetic:local-east-north.v1"
VARIABLES = ["east", "north", "east_velocity", "north_velocity"]
UNITS = ["m", "m", "m/s", "m/s"]
MODEL = "synthetic:planar-cv-white-acceleration.v1"
R = np.array([[9.0, 1.5], [1.5, 16.0]])
P0 = np.diag([25.0, 25.0, 4.0, 4.0])
M0 = np.array([100.0, 50.0, 12.0, 3.0])
Q_DENSITY = 0.04  # m^2/s^3, independent continuous white acceleration per axis
INPUT_SCHEMA = "payload.partial-observation-input.v1"
REFERENCE_SCHEMA = "payload.synthetic-state-reference.v1"
RESULT_SCHEMA = "payload.partial-observation-research-result.v1"
VARIANTS = ("nominal", "multirate", "blackout")


def canonical(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False, allow_nan=False).encode("utf-8")


def digest(role: str, value: object) -> str:
    return "sha256:" + hashlib.sha256(role.encode() + b"\0" + canonical(value)).hexdigest()


def _seal(role: str, value: dict, field: str) -> dict:
    return {**value, field: digest(role, value)}


def _check_seal(role: str, value: dict, field: str) -> None:
    if value.get(field) != digest(role, {k: v for k, v in value.items() if k != field}):
        raise ValueError(f"{field} does not bind the supplied content")


def _keys(value: object, expected: set[str]) -> None:
    if not isinstance(value, dict) or set(value) != expected:
        raise ValueError("unsupported or missing fields")


def _number(value: object) -> float:
    if type(value) not in (int, float):
        raise ValueError("finite real JSON number required; no booleans or coercion")
    try:
        result = float(value)
    except (ValueError, OverflowError) as exc:
        raise ValueError("number cannot be represented in binary64") from exc
    if not np.isfinite(result):
        raise ValueError("finite number required")
    if isinstance(value, int) and int(result) != value:
        raise ValueError("integer loses binary64 precision")
    return result


def _array(value: object, shape: tuple[int, ...]) -> np.ndarray:
    a = np.array(value, dtype=object)
    if a.shape != shape:
        raise ValueError("array shape mismatch")
    return np.array([_number(x) for x in a.flat]).reshape(shape)


def _pd(value: object, n: int) -> np.ndarray:
    a = _array(value, (n, n))
    if not np.array_equal(a, a.T) or np.any(np.diag(a) <= 0):
        raise ValueError("strict symmetric positive-definite covariance required")
    scale = np.sqrt(np.diag(a))
    try:
        np.linalg.cholesky(a / scale[:, None] / scale[None, :])
    except np.linalg.LinAlgError as exc:
        raise ValueError("covariance is not positive definite") from exc
    return a


def discretize(dt: float) -> tuple[np.ndarray, np.ndarray]:
    """Analytic fixture model: caller discretizes F and Q for each actual dt."""
    dt = _number(dt)
    if not 0 < dt <= 10:
        raise ValueError("fixture interval must be in (0, 10] seconds")
    f = np.eye(4)
    f[0, 2] = f[1, 3] = dt
    q = np.zeros((4, 4))
    for p, v in ((0, 2), (1, 3)):
        q[p, p] = Q_DENSITY * dt ** 3 / 3
        q[p, v] = q[v, p] = Q_DENSITY * dt ** 2 / 2
        q[v, v] = Q_DENSITY * dt
    return f, q


def generate(seed: int = 7, steps: int = 24, variant: str = "blackout") -> tuple[dict, dict]:
    """Paired experiments draw identical truth/noise before masking observations.

    The estimator input does not carry the simulation seed or withheld values.
    This is a software-interface separation, not secrecy from the study operator.
    """
    if type(seed) is not int or not 0 <= seed < 2 ** 32:
        raise ValueError("seed must be an unsigned 32-bit integer")
    if type(steps) is not int or not 1 <= steps <= 30:
        raise ValueError("1..30 steps required to bound provider replay history")
    if variant not in VARIANTS:
        raise ValueError("unsupported variant")
    truth_seed, sensor_seed = np.random.SeedSequence(seed).spawn(2)
    rng, sensor = np.random.default_rng(truth_seed), np.random.default_rng(sensor_seed)
    truth = M0 + np.linalg.cholesky(P0) @ rng.standard_normal(4)
    events, reference = [], []
    t = 0.0
    for k in range(steps):
        dt = (0.5, 1.0, 1.5)[k % 3]
        t += dt
        f, q = discretize(dt)
        truth = f @ truth + np.linalg.cholesky(q) @ rng.standard_normal(4)
        values = truth[:2] + np.linalg.cholesky(R) @ sensor.standard_normal(2)
        axes = [0, 1] if variant == "nominal" or k % 2 == 0 else [0]
        if variant == "blackout" and 8 <= k < 13:
            axes = []
        measurement = None
        if axes:
            measurement = {"values": values[axes].tolist(),
                           "covariance": R[np.ix_(axes, axes)].tolist()}
        events.append({"index": k, "time": t, "receivedTime": t, "axes": axes,
                       "missingAxes": [a for a in (0, 1) if a not in axes],
                       "availabilityReason": "synthetic_schedule" if axes else "synthetic_blackout",
                       "measurement": measurement})
        reference.append({"time": t, "state": truth.tolist()})
    inputs = _seal("input", {
        "schema": INPUT_SCHEMA, "synthetic": True, "variant": variant,
        "frame": FRAME, "variables": VARIABLES, "units": UNITS,
        "timeBasis": "elapsed_seconds", "model": MODEL,
        "noiseAssumption": "independent_process_measurement_and_prior",
        "prior": {"time": 0.0, "mean": M0.tolist(), "covariance": P0.tolist()},
        "events": events,
    }, "inputId")
    references = _seal("reference", {
        "schema": REFERENCE_SCHEMA, "kind": "SYNTHETIC_GENERATOR_TRUTH",
        "inputId": inputs["inputId"], "seed": seed, "frame": FRAME,
        "variables": VARIABLES, "units": UNITS, "states": reference,
        "referenceUncertainty": "zero_by_simulation_construction_not_field_metrology",
    }, "referenceId")
    validate_input(inputs)
    return inputs, references


def validate_input(inputs: dict) -> None:
    _keys(inputs, {"schema", "synthetic", "variant", "frame", "variables", "units",
                  "timeBasis", "model", "noiseAssumption", "prior", "events", "inputId"})
    _check_seal("input", inputs, "inputId")
    if (inputs["schema"] != INPUT_SCHEMA or inputs["synthetic"] is not True
            or inputs["variant"] not in VARIANTS or inputs["model"] != MODEL
            or inputs["frame"] != FRAME or inputs["variables"] != VARIABLES
            or inputs["units"] != UNITS or inputs["timeBasis"] != "elapsed_seconds"
            or inputs["noiseAssumption"] != "independent_process_measurement_and_prior"):
        raise ValueError("unsupported study semantics; nonlinear models are not silently approximated")
    prior = inputs["prior"]
    _keys(prior, {"time", "mean", "covariance"})
    if _number(prior["time"]) != 0:
        raise ValueError("fixture prior time must be zero")
    if not np.array_equal(_array(prior["mean"], (4,)), M0) or not np.array_equal(_pd(prior["covariance"], 4), P0):
        raise ValueError("this version accepts only the declared fixture prior")
    if not isinstance(inputs["events"], list) or not 1 <= len(inputs["events"]) <= 30:
        raise ValueError("bounded event list required")
    previous = 0.0
    for index, event in enumerate(inputs["events"]):
        _keys(event, {"index", "time", "receivedTime", "axes", "missingAxes", "availabilityReason", "measurement"})
        if type(event["index"]) is not int or event["index"] != index:
            raise ValueError("unique ordered event indices required")
        time = _number(event["time"])
        discretize(time - previous)
        if time != _number(event["receivedTime"]):
            raise ValueError("delayed/out-of-sequence arrival needs a separate replay policy")
        previous = time
        axes = event["axes"]
        if not isinstance(axes, list) or any(type(a) is not int for a in axes) or axes not in ([], [0], [1], [0, 1]):
            raise ValueError("ordered unique observed axes required")
        expected_axes = [0, 1] if inputs["variant"] == "nominal" or index % 2 == 0 else [0]
        if inputs["variant"] == "blackout" and 8 <= index < 13:
            expected_axes = []
        if axes != expected_axes:
            raise ValueError("axes contradict the declared experimental schedule")
        missing = event["missingAxes"]
        if (not isinstance(missing, list) or any(type(a) is not int for a in missing)
                or missing != [a for a in (0, 1) if a not in axes]):
            raise ValueError("missingness must explicitly partition sensor axes")
        reason = "synthetic_schedule" if axes else "synthetic_blackout"
        if event["availabilityReason"] != reason:
            raise ValueError("unsupported availability semantics")
        measurement = event["measurement"]
        if not axes:
            if measurement is not None:
                raise ValueError("absent observation must not contain imputed measurement")
        else:
            _keys(measurement, {"values", "covariance"})
            _array(measurement["values"], (len(axes),))
            if not np.array_equal(_pd(measurement["covariance"], len(axes)), R[np.ix_(axes, axes)]):
                raise ValueError("measurement covariance must match selected fixture sensor axes")


def _assimilate(inputs: dict, provider: object) -> list[dict]:
    """Internal provider call boundary; no truth argument and no filter math here."""
    validate_input(inputs)
    prior = inputs["prior"]
    state = provider.StatePrior(0.0, prior["mean"], prior["covariance"], FRAME,
                                tuple(UNITS), inputs["inputId"] + ":prior")
    trace = []
    for event in inputs["events"]:
        f, q = discretize(event["time"] - state.time)
        state = provider.predict(state, provider.LinearDynamics(f, q, MODEL), event["time"])
        prediction = {"mean": state.mean.tolist(), "covariance": state.covariance.tolist()}
        axes, measurement = event["axes"], event["measurement"]
        diagnostic = None
        if axes:
            observation_id = digest("observation", {"inputId": inputs["inputId"], "event": event})
            observation = provider.Observation(event["time"], measurement["values"],
                measurement["covariance"], FRAME, tuple("m" for _ in axes), observation_id,
                (inputs["inputId"],))
            h = np.eye(4)[axes, :]
            model = provider.LinearObservation(h, "synthetic:position-selection.v1",
                measurement_units=tuple("m" for _ in axes), measurement_frame_id=FRAME)
            estimate = provider.update(state, observation, model)
            diagnostic = {"innovation": estimate.innovation.tolist(),
                "innovationCovariance": estimate.innovation_covariance.tolist(),
                "residual": estimate.residual.tolist(), "nis": estimate.nis,
                "measurementDimension": len(axes),
                "nativeNumericalResultId": estimate.numerical_result_id}
            state = estimate.as_prior()
        trace.append({"time": state.time, "status": "UPDATED" if axes else "PREDICTED_ONLY",
                      "prediction": prediction, "mean": state.mean.tolist(),
                      "covariance": state.covariance.tolist(), "stateId": state.state_id,
                      "diagnostics": diagnostic})
    return trace


def _gate():
    path = Path(__file__).resolve().parents[2] / "scripts" / "instrument-replay-verify.py"
    content = path.read_bytes()
    actual = hashlib.sha1(b"blob " + str(len(content)).encode() + b"\0" + content).hexdigest()
    if actual != HELPER_BLOB:
        raise ValueError("reviewed ESM source-check helper changed")
    spec = importlib.util.spec_from_file_location("esm_study_source_gate", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@contextmanager
def checked_provider(path: Path):
    """Use ESM's existing source check, fixed import, and fresh bytecode prefix."""
    if any(n == "geometric_state_inference" or n.startswith("geometric_state_inference.") for n in sys.modules):
        raise ValueError("provider already imported; use a fresh research process")
    gate = _gate()
    binding = {"path": str(path.resolve()), "revision": GSIE_REVISION}
    root = gate.checkout(binding) / "src"
    old_path, old_prefix, old_no_bytecode = list(sys.path), sys.pycache_prefix, sys.dont_write_bytecode
    with tempfile.TemporaryDirectory(prefix="esm-study-import-") as temporary:
        try:
            sys.path.insert(0, str(root))
            sys.pycache_prefix, sys.dont_write_bytecode = temporary, True
            importlib.invalidate_caches()
            spec = importlib.util.find_spec("geometric_state_inference")
            if spec is None or spec.origin is None or not Path(spec.origin).resolve().is_relative_to(root):
                raise ValueError("provider import is outside reviewed source")
            yield importlib.import_module("geometric_state_inference")
            gate.checkout(binding)
        finally:
            for name in list(sys.modules):
                if name == "geometric_state_inference" or name.startswith("geometric_state_inference."):
                    del sys.modules[name]
            sys.path[:], sys.pycache_prefix, sys.dont_write_bytecode = old_path, old_prefix, old_no_bytecode


def numerical_trace(trace: list[dict]) -> list[dict]:
    """Strip lineage labels before deriving numerical-content identity."""
    return [{k: ({dk: dv for dk, dv in value.items() if dk != "nativeNumericalResultId"}
                  if k == "diagnostics" and value is not None else value)
             for k, value in row.items() if k != "stateId"} for row in trace]


def run(inputs: dict, provider_path: Path) -> dict:
    validate_input(inputs)
    with checked_provider(provider_path) as provider:
        trace = _assimilate(inputs, provider)
    numerical = digest("numerical-trace", numerical_trace(trace))
    result = _seal("result", {
        "schema": RESULT_SCHEMA, "inputId": inputs["inputId"],
        "operationId": "payload.research.synthetic-cv-kf.v1",
        "providerRevision": GSIE_REVISION,
        "recipeSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "helperBlob": HELPER_BLOB, "numpyVersion": np.__version__,
        "pythonVersion": sys.version, "numericalContentId": numerical,
        "synthetic": True, "canonicalAdmission": False, "evidenceRetained": False,
        "verification": "NOT_RUN", "truthUsed": False, "trace": trace,
    }, "resultContentId")
    # Occurrence identity is deliberately outside the content-addressed result.
    return {"executionId": "execution:" + str(uuid4()), "result": result}


def compare(inputs: dict, envelope: dict, reference: dict) -> dict:
    """Local synthetic diagnostics, not SET verification or calibration proof."""
    validate_input(inputs)
    _keys(envelope, {"executionId", "result"})
    if not isinstance(envelope["executionId"], str) or not envelope["executionId"].startswith("execution:"):
        raise ValueError("execution occurrence required")
    result = envelope["result"]
    _check_seal("result", result, "resultContentId")
    _check_seal("reference", reference, "referenceId")
    if (result.get("schema") != RESULT_SCHEMA or reference.get("schema") != REFERENCE_SCHEMA
            or result.get("inputId") != inputs["inputId"] or reference.get("inputId") != inputs["inputId"]
            or result.get("synthetic") is not True or result.get("truthUsed") is not False
            or result.get("canonicalAdmission") is not False or result.get("evidenceRetained") is not False
            or result.get("verification") != "NOT_RUN"
            or reference.get("kind") != "SYNTHETIC_GENERATOR_TRUTH"
            or reference.get("frame") != FRAME or reference.get("variables") != VARIABLES
            or reference.get("units") != UNITS
            or reference.get("referenceUncertainty") != "zero_by_simulation_construction_not_field_metrology"):
        raise ValueError("unsupported or mismatched research/reference semantics")
    trace, truth = result["trace"], reference["states"]
    if digest("numerical-trace", numerical_trace(trace)) != result["numericalContentId"]:
        raise ValueError("numerical trace content mismatch")
    if len(trace) != len(truth) or len(trace) != len(inputs["events"]):
        raise ValueError("trace/reference lengths differ")
    errors, nees, nis = [], [], []
    for event, row, target in zip(inputs["events"], trace, truth):
        if _number(row["time"]) != event["time"] or _number(target["time"]) != event["time"]:
            raise ValueError("truth and estimate must align at physical time")
        error = _array(row["mean"], (4,)) - _array(target["state"], (4,))
        covariance = _pd(row["covariance"], 4)
        errors.append(error)
        nees.append(float(error @ np.linalg.solve(covariance, error)))
        d = row["diagnostics"]
        if not event["axes"]:
            if row["status"] != "PREDICTED_ONLY" or d is not None:
                raise ValueError("dropout must carry no fabricated innovation")
        else:
            n = len(event["axes"])
            if row["status"] != "UPDATED" or d is None or type(d["measurementDimension"]) is not int or d["measurementDimension"] != n:
                raise ValueError("measurement diagnostic dimension mismatch")
            innovation = _array(d["innovation"], (n,))
            s = _pd(d["innovationCovariance"], n)
            score = float(innovation @ np.linalg.solve(s, innovation))
            reported = _number(d["nis"])
            if reported < 0 or not np.isclose(reported, score, rtol=1e-10, atol=1e-12):
                raise ValueError("reported NIS disagrees with innovation/covariance")
            nis.append({"time": event["time"], "dimension": n, "value": score,
                        "pointwise95Band": chi2.ppf([0.025, 0.975], n).tolist()})
    errors = np.array(errors)
    return _seal("comparison", {
        "schema": "payload.partial-observation-comparison.v1",
        "inputId": inputs["inputId"], "resultContentId": result["resultContentId"],
        "referenceId": reference["referenceId"], "subjectExecutionId": envelope["executionId"],
        "rmseByAxis": dict(zip(VARIABLES, np.sqrt(np.mean(errors ** 2, axis=0)).tolist())),
        "units": UNITS, "positionRMSEMetres": float(np.sqrt(np.mean(np.sum(errors[:, :2] ** 2, axis=1)))),
        "nees": nees, "neesPointwise95Band": chi2.ppf([0.025, 0.975], 4).tolist(),
        "nis": nis, "scipyVersion": importlib.import_module("scipy").__version__,
        "formalCalibration": "NOT_ESTABLISHED_SINGLE_CORRELATED_TRAJECTORY",
        "verification": "NOT_RUN", "canonicalAdmission": False,
    }, "comparisonId")


def _read(path: Path) -> dict:
    with path.open("rb") as stream:
        data = stream.read(4 * 1024 * 1024 + 1)
    if len(data) > 4 * 1024 * 1024:
        raise ValueError("research artifact exceeds 4 MiB")
    result = _gate().strict_json(data)
    if not isinstance(result, dict):
        raise ValueError("object document required")
    return result


def _write(path: Path, value: dict) -> None:
    data = json.dumps(value, indent=2, sort_keys=True, allow_nan=False) + "\n"
    with path.open("x", encoding="utf-8") as stream:
        stream.write(data)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    prepare = sub.add_parser("prepare")
    prepare.add_argument("--output", type=Path, required=True)
    prepare.add_argument("--seed", type=int, default=7)
    prepare.add_argument("--steps", type=int, default=24)
    prepare.add_argument("--variant", choices=VARIANTS, default="blackout")
    execute = sub.add_parser("run")
    execute.add_argument("--input", type=Path, required=True)
    execute.add_argument("--provider", type=Path, required=True)
    execute.add_argument("--output", type=Path, required=True)
    assess = sub.add_parser("compare")
    for name in ("input", "result", "reference", "output"):
        assess.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.command == "prepare":
            inputs, reference = generate(args.seed, args.steps, args.variant)
            args.output.mkdir(parents=True, exist_ok=False)
            _write(args.output / "observations.json", inputs)
            _write(args.output / "reference.json", reference)
        elif args.command == "run":
            _write(args.output, run(_read(args.input), args.provider))
        else:
            _write(args.output, compare(_read(args.input), _read(args.result), _read(args.reference)))
    except (ValueError, OSError, KeyError, TypeError, ImportError, subprocess.SubprocessError) as exc:
        print(f"research recipe refused: {type(exc).__name__}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
