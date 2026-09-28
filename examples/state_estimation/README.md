# Partial-observation state-estimation research

A first executable research recipe for the internal PayloadOS / ESM stack.
**Implemented here: a synthetic observation experiment and a pinned GSIE linear
Kalman provider call boundary. Not implemented: a nonlinear estimator, a live
intelligence feed, or admission of estimates into canonical state.**

The question is deliberately bounded:

> How do missing and multi-rate position observations affect reconstruction of
> a coupled position/velocity state, and what uncertainty does the estimator retain?

## What runs

`study.py prepare` creates a reproducible 2D local navigation experiment.
Its state is `[east, north, east_velocity, north_velocity]`, with units
`[m, m, m/s, m/s]`; the coordinate frame is explicitly synthetic, not a real CRS.
Observation intervals cycle through 0.5, 1.0, and 1.5 seconds. Three paired
variants share the same generated trajectory and pre-mask sensor noise:

| Variant | Observation schedule |
|---|---|
| `nominal` | Both position coordinates at every event |
| `multirate` | East at every event; north at alternating events |
| `blackout` | Multi-rate schedule plus complete blackout at event indices 8 through 12 |

The sensor has full measurement covariance `[[9, 1.5], [1.5, 16]] m^2`.
Partial measurements retain the corresponding principal covariance submatrix;
they are **not** zero-filled. Full blackouts produce prediction-only steps with
no fabricated innovation, residual, or NIS.

This is a constant-velocity *stochastic* model, not an aircraft flight-dynamics
model. Continuous white acceleration is independently applied on each axis,
with spectral density `q = 0.04 m^2/s^3`. For each actual interval `dt`, the
position/velocity block uses:

```text
F = [[1, dt], [0, 1]]
Q = q * [[dt^3/3, dt^2/2], [dt^2/2, dt]]
```

The generator draws the initial truth from the declared prior. Process noise,
sensor noise, and prior error are independent by simulation construction;
within-event measurement cross-covariance is retained. Missingness is a known
experimental schedule, not evidence of evasion or wrongdoing.

## Run locally

Use a separate environment; the tested versions are pinned in `requirements.txt`.
The reported local validation used Python 3.13.5. From the ESM repository root:

```bash
python -m pip install -r examples/state_estimation/requirements.txt
python -B -m unittest discover -s examples/state_estimation -p 'test_*.py' -v

python -I -B examples/state_estimation/study.py prepare \
  --seed 7 --steps 24 --variant blackout --output /tmp/esm-study-blackout
```

Preparation writes two separate files:

* `observations.json`: model/prior metadata, partial measurements, complete
  covariance, observation/receipt times, explicit missingness, and a content ID.
* `reference.json`: withheld synthetic states and simulation seed, bound to the
  input ID. This file is used only by the later diagnostic comparison.

The estimator never receives the reference file or seed. This is API/data-flow
separation, not a claim that the operator cannot reproduce their own simulation.
No real people, vessels, confidential datasets, or external collection are used.

### Execute the existing estimator

Filtering remains in **Geometric State Inference Engine**, pinned to:

```text
repository: giasonpooni/Geometric-State-Inference-Engine
revision:   4ec062bb72caa76ce1405f2851766589cee9d160
```

Provide an operator-controlled, clean checkout at that exact commit. Do not put
runtime paths, code URLs, import names, or executable commands in observations.
The recipe does not clone or install a provider automatically.

```bash
python -I -B examples/state_estimation/study.py run \
  --input /tmp/esm-study-blackout/observations.json \
  --provider /absolute/path/to/Geometric-State-Inference-Engine \
  --output /tmp/esm-study-blackout/result.json

python -I -B examples/state_estimation/study.py compare \
  --input /tmp/esm-study-blackout/observations.json \
  --result /tmp/esm-study-blackout/result.json \
  --reference /tmp/esm-study-blackout/reference.json \
  --output /tmp/esm-study-blackout/comparison.json
```

The native gate reuses the existing ESM
[`scripts/instrument-replay-verify.py`](../../scripts/instrument-replay-verify.py)
`checkout` check before and after computation, and binds that helper's reviewed
Git blob. It checks actual tracked source bytes rather than trusting a clean
Git status alone. Imports use the fixed package name, verified source root, and
a fresh bytecode prefix. An already imported provider is refused. This is not
a sandbox, source authentication, or independent verification of NumPy/BLAS.

To require the real provider in the test run:

```bash
ESM_STUDY_GSIE_ROOT=/absolute/path/to/Geometric-State-Inference-Engine \
  python -B -m unittest discover -s examples/state_estimation -p 'test_*.py' -v
```

Without that variable the native test explicitly **skips**. With the variable
set, unavailable/dirty/wrong-revision source fails; it does not fall back to a
mock or globally installed estimator. Stub-based unit tests test wiring only.

## Outputs and identity boundaries

The result retains prediction and posterior means, full covariance, native state
lineage, innovations, innovation covariance, posterior residuals, and native NIS.
It keeps these identities separate:

| Identity | What it binds |
|---|---|
| `inputId` | Observations and declared fixture model, not reference truth |
| `operationId` and pins | Research operation, recipe bytes, GSIE revision, source-check helper |
| `executionId` | One execution occurrence, outside the content-addressed result |
| `numericalContentId` | Numerical trace excluding state/evidence lineage labels |
| `resultContentId` | Input binding, implementation metadata, and complete result |
| `referenceId` / `comparisonId` | Supplied synthetic reference and local diagnostic comparison |

A digest proves neither authenticity nor correct physics. Every result explicitly
has `synthetic: true`, `canonicalAdmission: false`, `evidenceRetained: false`,
`truthUsed: false`, and `verification: NOT_RUN`. Local result files are not
retained ESM evidence merely because they exist on disk.

Comparison computes per-axis RMSE (no mixing metres and metres/second into an
unlabelled score), position RMSE, NEES against the supplied simulated reference,
and recomputed NIS from retained innovations/covariances. Pointwise two-sided
95% chi-square reference bands are reported at the correct state/measurement
dimensions. These are **diagnostics on one time-correlated trajectory**, not
independent-trial confidence bounds or a calibration certificate. A very low
statistic is not automatically good. Reference identity, time alignment, and
covariance are checked, but reference authenticity is not independently proved.

The synthetic reference has zero uncertainty by construction; this does not
justify zero reference uncertainty for a physical experiment. Real metrology
needs a separate reference/cross-covariance contract. Cross-platform bitwise
reproducibility across NumPy/BLAS implementations is not claimed.

All writes require new destinations and refuse overwriting existing files.
Preparation or a storage failure can leave partial local artifacts; there is no
transactional-retention claim. Inputs are bounded to 30 steps to stay within
the provider's bounded replay history. Unsupported models, bad covariances,
unknown fields in observations, changed digests, imputed blackout measurements,
and late/out-of-order arrivals are refused rather than silently repaired.

## How this fits the existing stack

This directory is a **research example**, not a new production dispatcher.
It does not change existing CIW sessions, provider pins, ESM admission contracts,
release policies, evidence storage, source rights, or rendering contracts.

* **GSIE** continues to own filter mathematics. No Kalman implementation is copied here.
* **NET / CIW and SCR** retain production composition/execution responsibilities.
* **SET** retains instrument verification/evaluation authority. These local
  diagnostic comparisons are not SET verification artifacts.
* **ESM** retains evidence/state admission. This recipe's JSON is not accepted by
  the existing instrument-candidate adapter merely by resembling a result.
* **GSC** remains a read-only representation layer; no viewer is wired by this change.

For the existing admitted-versus-candidate boundary see
[Instrument candidate evidence](../../docs/INSTRUMENT_CANDIDATE_EVIDENCE.md).

## Next research increments

1. Run and qualify the pinned native-provider gate in an authorized environment;
   retain the evidence without calling it canonical state or an independent certificate.
2. Add an explicit NET/SET exchange for this multi-step experiment. Do not widen
   ESM's existing telemetry-bundle contract to accept arbitrary JSON results.
3. Implement nonlinear dynamics/observation contracts and EKF/UKF comparisons in
   **GSIE**, using a bounded synthetic range/bearing navigation case. Check
   Jacobians, angle handling, observability, and noise assumptions there.
4. Use independent Monte Carlo trials, matched-noise baselines, ablations,
   two-sided consistency checks, and field-reference uncertainty before making
   comparative accuracy or calibration claims.
5. Introduce delayed arrivals, biased sensors and structured missingness with
   explicit observation-process models. Add spectral diagnostics only with a
   declared treatment of irregular samples/masks; do not FFT zero-filled gaps.

Nonlinearity is not intrinsically an improvement. The initial linear case makes
it possible to distinguish orchestration/data mistakes from estimator errors
before increasing model complexity.

## Numerical references

The provider's pinned [numerical contract](https://github.com/giasonpooni/Geometric-State-Inference-Engine/blob/4ec062bb72caa76ce1405f2851766589cee9d160/docs/NUMERICS.md)
documents its prediction, Joseph update, independence assumptions, and replay limits.
The local comparison uses [NumPy linear solves](https://numpy.org/doc/stable/reference/generated/numpy.linalg.solve.html)
and [SciPy chi-square quantiles](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.chi2.html).
See [VALIDATION.md](VALIDATION.md) for what was actually executed.
