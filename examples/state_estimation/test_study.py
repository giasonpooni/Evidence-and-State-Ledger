"""Contract/simulation tests. Fake providers test wiring, never numerical accuracy.

The opt-in native test is a separate gate and explicitly skips without a pinned
checkout. An unexecuted native gate is not a passed estimator test.
"""
from copy import deepcopy
from contextlib import contextmanager
import inspect
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import study as s


def reseal(value, role="input", field="inputId"):
    value = deepcopy(value)
    value.pop(field, None)
    return s._seal(role, value, field)


class FixtureTests(unittest.TestCase):
    def setUp(self):
        self.inputs, self.reference = s.generate()

    def test_reproducible_generation(self):
        self.assertEqual((self.inputs, self.reference), s.generate())

    def test_variants_share_truth_not_withheld_data(self):
        nominal, truth = s.generate(7, 24, "nominal")
        self.assertEqual(truth["states"], self.reference["states"])
        for a, b in zip(self.inputs["events"], nominal["events"]):
            if a["axes"]:
                np.testing.assert_array_equal(a["measurement"]["values"],
                    np.array(b["measurement"]["values"])[a["axes"]])
            else:
                self.assertIsNone(a["measurement"])
        self.assertNotEqual(nominal["inputId"], self.inputs["inputId"])

    def test_truth_not_an_estimator_argument(self):
        self.assertEqual(list(inspect.signature(s._assimilate).parameters), ["inputs", "provider"])
        for key in ("seed", "states", "reference", "truth", "referenceId"):
            self.assertNotIn(key, self.inputs)
        self.assertEqual(self.reference["inputId"], self.inputs["inputId"])

    def test_missingness_is_explicit(self):
        for e in self.inputs["events"][8:13]:
            self.assertEqual(e["axes"], [])
            self.assertEqual(e["missingAxes"], [0, 1])
            self.assertIsNone(e["measurement"])

    def test_irregular_intervals(self):
        times = [0] + [e["time"] for e in self.inputs["events"]]
        self.assertEqual(set(np.diff(times)), {0.5, 1.0, 1.5})

    def test_full_correlated_measurement_covariance(self):
        self.assertEqual(self.inputs["events"][0]["measurement"]["covariance"], [[9, 1.5], [1.5, 16]])
        self.assertEqual(self.inputs["events"][1]["measurement"]["covariance"], [[9]])

    def test_process_discretization_composes(self):
        f1, q1 = s.discretize(0.5)
        f2, q2 = s.discretize(1.5)
        f, q = s.discretize(2.0)
        np.testing.assert_allclose(f, f2 @ f1)
        np.testing.assert_allclose(q, f2 @ q1 @ f2.T + q2)
        self.assertNotEqual(q[0, 0], q[2, 2])

    def test_discretized_covariance_is_positive_definite(self):
        for dt in (0.25, 0.5, 1, 1.5, 10):
            _, q = s.discretize(dt)
            self.assertGreater(np.linalg.eigvalsh(q).min(), 0)

    def test_bad_generation_parameters(self):
        for kw in ({"seed": True}, {"seed": -1}, {"seed": 2**32}, {"steps": True},
                   {"steps": 0}, {"steps": 31}, {"variant": "nonlinear"}):
            with self.subTest(kw=kw), self.assertRaises(ValueError):
                s.generate(**kw)

    def test_bad_dt(self):
        for dt in (True, 0, -1, 11, float("nan"), float("inf"), "1", 10**500):
            with self.subTest(dt=str(dt)[:20]), self.assertRaises(ValueError):
                s.discretize(dt)

    def test_hash_tamper(self):
        self.inputs["events"][0]["measurement"]["values"][0] += 1
        with self.assertRaises(ValueError):
            s.validate_input(self.inputs)

    def test_unsupported_semantics(self):
        changes = {"synthetic": False, "frame": "EPSG:4326", "model": "nonlinear:range-bearing",
                   "units": ["deg"]*4, "variables": list(reversed(s.VARIABLES)),
                   "noiseAssumption": "unknown", "timeBasis": "milliseconds"}
        for key, value in changes.items():
            item = {**self.inputs, key: value}
            with self.subTest(key=key), self.assertRaises(ValueError):
                s.validate_input(reseal(item))

    def test_unexpected_truth_field_refused(self):
        item = {**self.inputs, "truth": self.reference}
        with self.assertRaises(ValueError):
            s.validate_input(reseal(item))

    def test_event_failures(self):
        changes = [("time", 0), ("receivedTime", 2), ("index", True),
                   ("axes", [True]), ("axes", [1, 0]), ("missingAxes", [True]),
                   ("missingAxes", [0]), ("availabilityReason", "criminal_evasion")]
        for key, value in changes:
            item = deepcopy(self.inputs)
            item["events"][0][key] = value
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                s.validate_input(reseal(item))

    def test_duplicate_event_time(self):
        self.inputs["events"][1]["time"] = self.inputs["events"][0]["time"]
        self.inputs["events"][1]["receivedTime"] = self.inputs["events"][0]["time"]
        with self.assertRaises(ValueError):
            s.validate_input(reseal(self.inputs))

    def test_dropouts_not_zero_filled(self):
        self.inputs["events"][8]["measurement"] = {"values": [0, 0], "covariance": [[0, 0], [0, 0]]}
        with self.assertRaises(ValueError):
            s.validate_input(reseal(self.inputs))

    def test_malformed_covariance(self):
        for r in ([[9, 2], [1, 16]], [[-9, 0], [0, 16]], [[9, 50], [50, 16]],
                  [[9, 0], [0, 0]], [[True, 0], [0, 16]], [[9]]):
            item = deepcopy(self.inputs)
            item["events"][0]["measurement"]["covariance"] = r
            with self.subTest(r=r), self.assertRaises(ValueError):
                s.validate_input(reseal(item))

    def test_bad_measurement_values(self):
        for values in ([True, 1], ["2", 1], [1], [2**53+1, 1]):
            item = deepcopy(self.inputs)
            item["events"][0]["measurement"]["values"] = values
            with self.subTest(values=values), self.assertRaises(ValueError):
                s.validate_input(reseal(item))

    def test_empty_or_excessive_events(self):
        for events in ([], self.inputs["events"]*2):
            with self.assertRaises(ValueError):
                s.validate_input(reseal({**self.inputs, "events": events}))


class SpyProvider:
    """No filter implementation: identity predictions and unchanged updates."""
    def __init__(self):
        self.predictions, self.observations = [], []
    def StatePrior(self, time, mean, covariance, frame_id, units, state_id):
        return SimpleNamespace(time=time, mean=np.array(mean), covariance=np.array(covariance), state_id=state_id)
    def LinearDynamics(self, f, q, model_id):
        return SimpleNamespace(matrix=f, process_covariance=q)
    def predict(self, state, dynamics, time):
        self.predictions.append((time, dynamics))
        return self.StatePrior(time, state.mean, state.covariance, None, None, "spy:prediction")
    def Observation(self, *args):
        self.observations.append(args)
        return SimpleNamespace(values=np.array(args[1]))
    def LinearObservation(self, h, model_id, **kw):
        return h
    def update(self, state, observation, h):
        n = len(observation.values)
        return SimpleNamespace(innovation=np.zeros(n), innovation_covariance=np.eye(n),
            residual=np.zeros(n), nis=0.0, numerical_result_id="spy:not-numerical-evidence",
            as_prior=lambda: state)


class WiringTests(unittest.TestCase):
    def test_missing_steps_predict_but_do_not_update(self):
        inputs, _ = s.generate()
        provider = SpyProvider()
        trace = s._assimilate(inputs, provider)
        self.assertEqual(len(provider.predictions), 24)
        self.assertEqual(len(provider.observations), 19)
        self.assertEqual(sum(r["status"] == "PREDICTED_ONLY" for r in trace), 5)
        self.assertTrue(all(trace[k]["diagnostics"] is None for k in range(8, 13)))

    def test_covariance_subselection_and_evidence_passed_to_provider(self):
        inputs, _ = s.generate()
        p = SpyProvider()
        s._assimilate(inputs, p)
        self.assertEqual(p.observations[0][2], [[9, 1.5], [1.5, 16]])
        self.assertEqual(p.observations[1][2], [[9]])
        self.assertEqual(p.observations[0][-1], (inputs["inputId"],))

    def test_no_partial_result_after_provider_failure(self):
        p = SpyProvider()
        p.update = lambda *a: (_ for _ in ()).throw(ValueError("provider refusal"))
        with self.assertRaises(ValueError):
            s._assimilate(s.generate()[0], p)

    def test_validation_precedes_any_provider_call(self):
        p = SpyProvider()
        inputs, _ = s.generate()
        inputs["synthetic"] = False
        with self.assertRaises(ValueError):
            s._assimilate(inputs, p)
        self.assertEqual(p.predictions, [])

    def test_numerical_identity_excludes_lineage(self):
        trace = s._assimilate(s.generate()[0], SpyProvider())
        altered = deepcopy(trace)
        altered[0]["stateId"] = "other:evidence-lineage"
        altered[0]["diagnostics"]["nativeNumericalResultId"] = "other:label"
        self.assertEqual(s.numerical_trace(trace), s.numerical_trace(altered))

    def test_occurrence_is_separate_from_content(self):
        @contextmanager
        def fake(_path):
            yield SpyProvider()
        with patch.object(s, "checked_provider", fake):
            a = s.run(s.generate()[0], Path("unused"))
            b = s.run(s.generate()[0], Path("unused"))
        self.assertNotEqual(a["executionId"], b["executionId"])
        self.assertEqual(a["result"], b["result"])
        self.assertFalse(a["result"]["canonicalAdmission"])
        self.assertFalse(a["result"]["truthUsed"])
        self.assertEqual(a["result"]["verification"], "NOT_RUN")

    def test_preloaded_provider_refused(self):
        with patch.dict(sys.modules, {"geometric_state_inference": SimpleNamespace()}):
            with self.assertRaises(ValueError), s.checked_provider(Path("unused")):
                pass

    def test_write_never_overwrites(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/"result.json"
            s._write(path, {"original": True})
            with self.assertRaises(FileExistsError):
                s._write(path, {"replacement": True})
            self.assertIn("original", path.read_text())


class ComparisonTests(unittest.TestCase):
    def setUp(self):
        self.inputs, self.reference = s.generate()
        trace = s._assimilate(self.inputs, SpyProvider())
        # Deliberately fabricated diagnostic fixture; no real provider claim.
        result = {"schema": s.RESULT_SCHEMA, "inputId": self.inputs["inputId"],
                  "synthetic": True, "truthUsed": False, "canonicalAdmission": False,
                  "evidenceRetained": False, "verification": "NOT_RUN", "trace": trace,
                  "numericalContentId": s.digest("numerical-trace", s.numerical_trace(trace))}
        self.envelope = {"executionId": "execution:unit-test-only",
                         "result": s._seal("result", result, "resultContentId")}

    def test_diagnostics_are_not_verification(self):
        report = s.compare(self.inputs, self.envelope, self.reference)
        self.assertEqual(report["verification"], "NOT_RUN")
        self.assertFalse(report["canonicalAdmission"])
        self.assertEqual(set(report["rmseByAxis"]), set(s.VARIABLES))
        self.assertEqual(len(report["nees"]), 24)
        self.assertEqual(len(report["nis"]), 19)
        self.assertGreater(report["neesPointwise95Band"][0], 0)
        self.assertIn("CORRELATED", report["formalCalibration"])

    def test_reference_time_mismatch(self):
        ref = deepcopy(self.reference)
        ref["states"][0]["time"] += 1
        with self.assertRaises(ValueError):
            s.compare(self.inputs, self.envelope, reseal(ref, "reference", "referenceId"))

    def test_reference_identity_mismatch(self):
        _, ref = s.generate(8)
        with self.assertRaises(ValueError):
            s.compare(self.inputs, self.envelope, ref)

    def test_result_tamper(self):
        self.envelope["result"]["trace"][0]["mean"][0] += 1
        with self.assertRaises(ValueError):
            s.compare(self.inputs, self.envelope, self.reference)

    def test_bad_covariance_refused_after_resealing(self):
        result = self.envelope["result"]
        result["trace"][0]["covariance"][0][0] = -1
        result["numericalContentId"] = s.digest("numerical-trace", s.numerical_trace(result["trace"]))
        self.envelope["result"] = reseal(result, "result", "resultContentId")
        with self.assertRaises(ValueError):
            s.compare(self.inputs, self.envelope, self.reference)

    def test_nis_must_match_retained_innovation(self):
        result = self.envelope["result"]
        result["trace"][0]["diagnostics"]["nis"] = 100.0
        result["numericalContentId"] = s.digest("numerical-trace", s.numerical_trace(result["trace"]))
        self.envelope["result"] = reseal(result, "result", "resultContentId")
        with self.assertRaises(ValueError):
            s.compare(self.inputs, self.envelope, self.reference)

    def test_negative_nis_is_not_hidden_by_numeric_tolerance(self):
        result = self.envelope["result"]
        result["trace"][0]["diagnostics"]["nis"] = -1e-14
        result["numericalContentId"] = s.digest("numerical-trace", s.numerical_trace(result["trace"]))
        self.envelope["result"] = reseal(result, "result", "resultContentId")
        with self.assertRaises(ValueError):
            s.compare(self.inputs, self.envelope, self.reference)

    def test_canonical_or_truth_used_claim_refused(self):
        for key in ("canonicalAdmission", "truthUsed", "evidenceRetained"):
            env = deepcopy(self.envelope)
            env["result"][key] = True
            env["result"] = reseal(env["result"], "result", "resultContentId")
            with self.subTest(key=key), self.assertRaises(ValueError):
                s.compare(self.inputs, env, self.reference)


@unittest.skipUnless(os.environ.get("ESM_STUDY_GSIE_ROOT"), "native GSIE gate NOT RUN: supply a clean pinned checkout")
class NativeProviderTests(unittest.TestCase):
    def test_real_provider_replays_and_propagates_blackout_uncertainty(self):
        root = Path(os.environ["ESM_STUDY_GSIE_ROOT"])
        inputs, ref = s.generate()
        a, b = s.run(inputs, root), s.run(inputs, root)
        self.assertEqual(a["result"], b["result"])
        self.assertNotEqual(a["executionId"], b["executionId"])
        trace = a["result"]["trace"]
        for k in range(8, 13):
            self.assertEqual(trace[k]["status"], "PREDICTED_ONLY")
            self.assertGreater(trace[k]["covariance"][0][0], trace[k-1]["covariance"][0][0])
        self.assertLess(trace[13]["covariance"][0][0], trace[12]["covariance"][0][0])
        for row in trace:
            self.assertGreater(np.linalg.eigvalsh(row["covariance"]).min(), 0)
        report = s.compare(inputs, a, ref)
        self.assertTrue(np.isfinite(report["positionRMSEMetres"]))


if __name__ == "__main__":
    unittest.main()
