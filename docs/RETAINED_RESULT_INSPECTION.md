# Retained-result inspection and dependency-checked delivery

`refresh-status` continues to inspect the scheduling journal only. This additive
operation answers a different question: **can one selected successful attempt
still be reopened all the way from its compiled review to its retained source
bytes, and how old are its returned numeric observations?**

It neither acquires data nor repairs missing evidence. Admission, source-release
certification, signed release, credential provisioning and refresh scheduling
remain separate operations. GSC and GSV revisions do not change in this slice.

## Command

Build the existing CLI in the private ESM checkout:

```sh
npx esbuild scripts/industrial-operations.entry.ts --bundle --platform=node \
  --format=esm --packages=external --alias:@=./src \
  --outfile=.stamp/industrial-operations.mjs
node .stamp/industrial-operations.mjs refresh-inspect CONFIG.json ATTEMPT_UUID
```

The configuration uses the existing `root`, `intakeRoot`, `schedule` and
`authorityKeys`. The exact attempt UUID is mandatory. No latest-success fallback
is selected when that attempt is missing, incomplete, failed or corrupt. The
command prints a bounded report to stdout and exits 2 for an unavailable result.
Invalid CLI arguments keep the existing refusal behavior. It creates no source,
intake, journal, receipt, lock or verification files. Redirecting stdout is an
explicit action by the caller, not implicit evidence retention.

## What is checked

The reader checks the original refresh binding, intent, completion receipt and
all journal history, including existing quarantine signatures. An existing lock
refuses inspection. A second journal read and final lock check reject a changed
snapshot. It does not acquire the execution lock or claim transactional isolation.

The selected CAPTURED receipt must bind exactly:

- The capture manifest and all five fixed source/derived files, including the
  raw TIFF and decoded grid; URL, request/retrieval scope and byte limits use
  the same validation helper as the existing capture-retention path.
- The ESM reinspection report and all five original LocalEvidenceIntake records.
  Native intake inspection reopens source-policy declarations, receipt hashes
  and content-addressed bytes. Acquisition identities, stored times, media
  types, purpose and source-policy version must match the fixed review contract.
- The index, digest-named compiled artifact, five source references, and source,
  review, compilation and completion times. The compiled representation uses
  closed field sets, retains unadmitted/internal status and forbids extra payload.

Direct source bindings include the station metadata, every water-level row's
value/time/sigma/quality/flags, the entire retained grid array, affine metadata,
units, datums and source hashes. Observation and retrieval times are not assigned
to source-publication or terrain-survey dates. Invalid dates, numeric values,
chronology and flag representations fail closed.

The read helper now uses the existing bounded immutable-file reader, including
source-directory symlink refusal, and checks strict JSON syntax/duplicate keys
for the manifest and decoded grid. The original `retainIndustrialCapture` API
and its explicit internal-permission preflight remain intact.

## What is NOT established

`verificationScope` is `RETAINED_BYTES_AND_DIRECT_BINDINGS`, not independent
measurement verification. No TIFF decoder, GSC compiler or provider request is
executed. Matching the retained grid against the compiled grid does not establish
that the raw TIFF was originally decoded correctly. That separate computation
remains in the retained capture qualification workflow.

The reader trusts the selected local filesystem, journal, configuration and
historical source-policy declarations. Recomputable hashes are not signatures,
source authentication, independently established rights, a WORM store, or proof
against a privileged actor consistently rewriting every copy and commitment.
Concurrent mutation after a read cannot be excluded by snapshot comparisons.
Delivery serves the same compiled byte buffer that passed inspection, not an
unverified reread. Local code/runtime and operator clock are trusted.

The source policy is still an operator declaration for internal qualification.
There is no new admission or redistribution grant. Native RELEASE handling is
unchanged. Real missing publication time, canonical identity, rights decision
and admission authority are not filled in to make a candidate admissible.

## Freshness semantics

The report keeps `latestRowAt` separate from `latestNumericAt`. Trailing rows
with no numeric value cannot renew the age of the last actual numeric value.
Zero remains numeric. An empty/all-null series reports
`NO_NUMERIC_OBSERVATIONS` and `observationAgeMs: null`, never zero.

Observation age, retrieval age and journal-receipt age are computed independently
against the explicit assessment instant. Publication and terrain-survey ages
remain null. FRESH means only that the latest numeric observation's age is no
more than the existing GSC display threshold of 1,080,000 ms. It is not a provider
SLA, a quality-flag clearance, complete coverage, validated measurement accuracy
or authorization to act. Numeric observations with flags remain flagged data.

STALE is not corruption: an intact historical record may be inspected and served
as historical data. The report retains the assessment instant. Neither a saved
FRESH report nor its screenshot proves continuing liveness. GSV's original view
is unchanged; these new numeric-age semantics are exposed by the CLI/report and
HTTP headers, not substituted silently into the legacy viewer badge.

## Opt-in authenticated delivery

The existing server configuration gains the resource kind `RETAINED_REVIEW`.
Its `requestFile` points to an operator-selected JSON document with these fields:

```json
{
  "schema": "payload.retained-review-selection.v1",
  "refreshRoot": "/operator/refresh",
  "intakeRoot": "/operator/intake",
  "schedule": "Replace with the exact existing schedule object, not this string",
  "attemptId": "Replace with the selected CAPTURED attempt UUID",
  "compiledDigest": "Replace with that receipt's sha256-prefixed compiled digest"
}
```

The values above are documentation placeholders, not an executable configuration.
Use the same exact digest in the server resource and authorized credential scope.
No source path or selection is supplied by an HTTP caller. The new path rejects
missing/invalid bindings rather than falling back to legacy artifact-only access.

After normal authentication and artifact-scope checks, every authorized index
or data request reopens the retained result. Success writes the inspection report
under the existing audit root (`inspections/<digest>.json`) before the delivery
audit and response. The delivery record references its inspection/history digests
and the assessment's freshness. Failure can leave inspection evidence but cannot
send a successful delivery or claim one in the audit. Source/intake/journal roots
are not written by this operation. No credentials are included in these reports.

Responses expose `X-Evidence-Verification`, `X-Inspection-Digest`,
`X-Observation-Freshness` and `X-Observation-Age-Ms`. Existing artifact-digest,
no-store, exact paths, same-origin/loopback, credential expiry/revocation and
before-delivery auditing remain enforced. Native release retractions still use
the original SQL reinspection path. Existing REVIEW resources remain compatible
and are explicitly labelled `ARTIFACT_ONLY`; they are not upgraded by assertion.

There is no automatic reader grant for later refreshes. A new capture digest
requires explicit selection and credential scope. No endpoint admits, certifies,
changes source rights, starts a collector or exposes a remote TLS/SSO service.

## Qualification

The deterministic tests use synthetic contract fixtures and the actual original
intake/refresh/distribution implementations. Their TIFF marker is deliberately
not a real raster; the inspection does not claim raster decoding. Tests cover
intact compiled bytes with damaged/missing sources, native intake loss, exact
attempt selection, source/view field disagreement even after digest rebinding,
locks and changed history, unknown/zero/stale observation semantics, malformed
JSON and actual authenticated HTTP denial without fallback.

The live qualification workflow separately captures actual NOAA/USGS responses,
runs the existing raster recheck, retains/reopens them through ESM, inspects the
result without changing source/journal contents, and exercises dependency-checked
GSV delivery in Chromium. Its corruption scenario alters only a scratch copy of
the real source; the original retained evidence remains unchanged. Results are
reported for the observed commit/run, never assumed from fixture success.

The README's seven negative-state distinctions are restored from the existing
registry without changing its architectural assertion. Wider ESM CI and private
pinned-replay access have separate outcomes; no check is exempted by this feature.
