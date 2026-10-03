# Calibrated workbench candidate evidence

The candidate adapter now accepts both the original scalar telemetry lane and
`ciw.calibrated-observable-session.v1`. The latter selects an exact allowlist of
CIW, FSRT, TBRT, MCUR, OIT, GSIE, CBSR, FDIR and SET checkouts. Schema names never
select arbitrary modules. Existing clean-source, interpreter, exact-byte,
source-policy and withdrawal checks still run before retention.

The calibrated candidate keeps native GSIE state and result identities, the OIT
assessment, CBSR disposition, and FDIR detection and isolability separately.
FDIR's residual basis is `retained_gsie_prior_innovation`; ESM does not construct
another estimator or covariance. A held/refused reconciliation and an ambiguous
fault can be retained as evidence of that outcome, not endorsed as an accepted
state or a uniquely identified sensor fault. Unknown cross-covariance cannot
be promoted to unique isolation. Wrapped native numerical/state identities are
also withdrawal targets.

## Local workbench bridge

Build with `npm ci --ignore-scripts && npm run instrument:workbench:build`.
The Node-only `.stamp/workbench-candidate.mjs` accepts one bounded JSON document
on stdin and returns one JSON result. Its only actions are `inspect` and
`capture`. The embedding workbench supplies operator-owned runtime pins,
review context and, for capture only, a distinct derived-source registration
and absolute file-store path. These are not remote client permissions.

Inspection always performs fresh replay and SET verification but writes no
evidence. Capture performs a new inspection and explicit source/derived INGEST
checks, then uses the existing immutable FileContentAddressedStore and verified
readback. A timeout/storage failure may leave evidence bytes without a successful
receipt; the caller must not report a rollback or successful retention.

Both actions keep `canonicalAdmission: REFUSED`, `canonicalStateMutated: false`,
`releaseActivated: false`, and `sourceTruthClaimed: false`. Evidence envelopes
remain `UNADMITTED`. Supplied retraction history is not asserted complete.
Historical receipts do not establish current eligibility.

## Verification

`python -B scripts/check_calibrated_workbench.py` clones exact committed provider
pins, creates a real calibrated bundle, and tests replay, capture, tamper and
withdrawal through the existing ESM APIs and real file store. Optional
`--ciw-repo` and `--stack-root` use already clean, exact pinned checkouts.
All fixture rights are explicitly synthetic test-only, never deployment defaults.
