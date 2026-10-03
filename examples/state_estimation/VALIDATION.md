# Validation record — 2026-09-28

Base ESM commit: `c3fdc51f114d3f73f0b6632cbc4f07e71f85cb47`.
Files were read through the authorized GitHub connector. The development
container could not resolve `github.com`, so a full checkout and the private
native dependency chain were not available there.

## Executed locally

Environment: Python 3.13.5, NumPy 2.3.5, SciPy 1.17.0.

```text
python -B -m unittest discover -s examples/state_estimation -p 'test_*.py' -v
Ran 36 tests
OK (skipped=1)
```

**35 tests passed; one native-provider test explicitly skipped.**
The passing tests cover deterministic paired fixture generation, irregular-interval
process discretization and its composition law, full measurement covariance,
missingness, invalid data/refusals, identity separation, overwrite refusal, and
local reference-diagnostic calculations. Provider call-wiring tests use an
explicit non-numerical spy; they do not establish GSIE's numerical performance.

A real CLI fixture-generation smoke test also completed:

```text
python -I -B examples/state_estimation/study.py prepare \
  --seed 7 --steps 24 --variant blackout --output <new temporary directory>

observation events: 24
complete blackout events: 5
inputId: sha256:2f12d850b5aeada8b4c7dae2eb6e75cb6e376465c7712240af724aec0d410f50
```

The smoke test emitted separate `observations.json` and `reference.json`; no
native result or performance comparison was manufactured for this record.

## Not executed / not established

* The exact private GSIE checkout was unavailable. Native prediction/update,
  its end-to-end replay, and real estimator RMSE/NEES/NIS were **not run**.
* The full ESM application test suite, Node typecheck/build, existing multi-repo
  candidate-evidence integration, and hosted CI were **not run locally**.
* Nonlinear EKF/UKF, Monte Carlo calibration, observability certification,
  spectral inference, real sensors, field accuracy, and RTOS timing are not
  implemented or validated by this slice.

The native test becomes mandatory (and fails instead of skipping on source
errors) when `ESM_STUDY_GSIE_ROOT` is supplied. See the README for the pinned
revision and commands. Successful local diagnostics do not become SET
verification, evidence retention, corpus admission, or execution permission.

## Tested source commitments

SHA-256 over exact UTF-8 file bytes:

```text
study.py
09e8b7fb4e97cf638e27f6dc02e2792d1a8aa76460bdcd0b8a629ab14c0e0dc8

test_study.py
bcadcd289e88426f10dfb17100176ad6d3bb1b440fd81f06df92b3499241e48a
```

These identify this local test subject. They are not independent signatures or
attestations of the dependency environment.
