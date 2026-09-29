# Industrial operations: explicit decisions, exact delivery and retained refresh

Refresh journal inspection and separately signed quarantine are described in [Refresh recovery](REFRESH_RECOVERY.md). Existing admission, release and source-review boundaries below remain unchanged.

This private ESM increment extends the prior NOAA station 9414290 / USGS 3DEP
internal-review rail. It reuses `LocalEvidenceIntake`, content-addressed objects,
immutable local files, the existing admission gate, native SQL admission writer,
record hydration, source-use policy, ancestry and capture scheduler. It adds no
public endpoint to the existing app and does not widen fixture projections.

**Implementation is not operational authority.** The real capture has no known
source-publication timestamp, no approved canonical identity, no admission-rights
decision and no operator admission signature. Read-only qualification retains
those absences and the native gate refuses. We do not substitute observation,
retrieval or HTTP times. No real record is admitted or released by the test run.

## What is implemented

### Admission: inspect first, sign separately, use the native writer

`qualifyAdmission` reopens the original local acquisition and binds its digest and
capture time to each candidate. For this slice only `noaa-coops`, station 9414290,
`water_level.height`, metres and NAVD88 are supported. Every value and observation
time must match one retained raw observation. The existing `admit` gate evaluates
identity, evidence class, both clocks, source time, rights and authority. The
existing `bindReleaseRecord` binds the proposed projection; unknowns never pass
as defaults. Qualification writes no canonical state.

`executeAdmission` additionally verifies an Ed25519 operator approval over the
complete request. The configured authority must not be a `notationsos.*` method,
and action, exact commitment, key, authority and validity window must match. The
ruling instant equals the signed decision instant. Only a fully qualified batch
reaches the **existing `admitRecords` SQL writer**, which retains its native
transaction, idempotence, refusal, sealed-release and ancestry checks.

The audit precedes the write and a result audit follows it. These are not one
filesystem/SQL distributed transaction: an interrupted call can require native
idempotent reinspection. No retry invents a new decision or overwrites evidence.

### Release: an exact internal selection, not a new corpus certifier

`prepareInternalRelease` accepts explicit record IDs and reads actual SQL rows,
original admission rulings, ancestry, source artifact bytes and retractions. It
refuses fixture-only, altered, withdrawn, missing or ambiguous records. The
source release must already be `CURRENT` and **`CERTIFIED`**. This module does not
create a corpus, approve its identity policy or certify a release header.

Only the qualified NOAA scalar records with `INTERNAL_ONLY` visibility can enter
this selection. The caller supplies a source registration granting INTERNAL
`EXPORT`, and retains its terms evidence bytes. The previous internal review
registration grants INGEST/DERIVE/RETRIEVE, **not EXPORT**. Neither possession of a
capture nor public access is substituted for an export-rights decision.

The output `payload.industrial-record-release.v1` is a new exact internal
record-selection envelope, **not a relabelled `CorpusRelease` or fixture release**.
Its `corpusCertification: UNCHANGED` is deliberate. A second RELEASE approval
binds `{ requestDigest, body }`, including recipient, purpose, exact record
content, source-grant commitments and expiry. The portable envelope is
`{ body, requestDigest, approval }`. Candidate/build identities remain in ESM's
separate ancestry/audit, checked with the existing `releaseLeaks` rule.

Publication uses the original content-addressed store and a create-only
release-ID index. An ID cannot be rebound to different bytes. Every delivered
release is freshly reinspected against native records, retractions and signature
windows. A checksum or signature establishes the binding and configured signer,
not independent truth, correct scientific interpretation or independently
confirmed source rights. The authority/key registry, source declarations,
certificate state and database are trusted operator-controlled inputs.

### Authenticated internal delivery

The standalone listener binds **127.0.0.1 only**. It accepts random 32-byte bearer
credentials provisioned outside the service; configuration stores SHA-256 token
digests, exact artifact scopes, recipient identity, expiry and revocation. No
credential or signing private key is generated for production by this increment.

`GET /v1/artifacts/<64-hex-digest>` accepts a bearer header or the HttpOnly session
cookie. The same-origin login exchanges the header for `SameSite=Strict` cookie
storage, not localStorage. URL/query credentials, cross-origin requests,
client-selected paths, latest aliases and ambiguous credentials fail closed.
The cookie is intentionally not `Secure` on this HTTP loopback-only deployment;
this is **not Internet-facing TLS, SSO, tenant isolation or a production identity
provider**. Do not remove the loopback/Host/Origin gates to publish it remotely.

The GSV industrial viewer uses the protected same-origin
`/industrial-data/index.json` and digest-named review resource. That review stays
`UNADMITTED_SOURCE_REVIEW`; authentication does not turn it into a release.
Operator configuration grants access only to exact, already qualified review
bytes. Full viewer contract validation remains in GSV. Review access is not the
signed canonical-release path and must not be advertised as such.

Credential/resource revocation, expiry, exact digest and (for RELEASE) native
reinspection are checked per request. Successful data deliveries are logged
before bytes leave; logs omit raw tokens, cookies and URLs. This is not a complete
failed-login/security-event audit. Responses use no-store and restrictive origin
headers. Static serving is limited to known compiled viewer path classes; it
cannot expose the source tree, configuration or embedded unprotected data files.
Deleting or changing a grant prevents later delivery, but does not erase copies
already received by a client. Local filesystem and database owners remain trusted.

### Retained refresh

`refreshOnce` uses the existing `parseCaptureSchedule` and `planCapture` rather
than introducing a second scheduler. One invocation checks an explicit schedule,
locks its state directory, reopens bounded history and writes immutable intent
**before** acquisition. Receipt digests bind intent, operation, completion,
result digests and success/failure. Failures spend slots; missing receipts block
further work; concurrent invocations cannot spend the same slot. No automatic
stale-lock stealing occurs. The schedule ID binds interval, window, budget and
operation permanently; toggling enabled does not reset history. Changing scope
requires a deliberately new schedule, not a silent budget reset.

`fixedRefreshPipeline` verifies the clean pinned GSC checkout at
`98bd33bcca22efabe24de8be42642dc561fcfd17`, executes bounded one-shot capture and
raster re-decoding, calls the original ESM retention/reinspection path and runs
the existing GSC compiler. It retains raw source files and outputs per attempt.
Every result explicitly has `canonicalAdmission:false` and `release:null`.
Refresh never signs, admits, certifies, releases, or silently updates a reader's
artifact scope. The operator selects which new exact review to serve.

An external hourly systemd timer template is supplied. **It is not installed or
active merely because this code is pushed.** Its example schedule is disabled
and finite. Failed/interrupted runs require inspecting retained state before
manually clearing a lock; an incomplete intent must be reconciled rather than
deleted to recover budget. Backups are needed: local immutable files are not
hardware-enforced WORM storage or a tamper-proof distributed log.

## Build and run

Use the private ESM checkout at this PR head; preserve the locked dependencies.
No new package dependency is required.

```sh
npm ci
npx tsc -p industrial-operations.tsconfig.json
npx vitest run --config industrial-operations.vitest.mts
mkdir -p .stamp
npx esbuild scripts/industrial-operations.entry.ts --bundle --platform=node \
  --format=esm --packages=external --alias:@=./src \
  --outfile=.stamp/industrial-operations.mjs
node .stamp/industrial-operations.mjs --help
```

Copy `deploy/industrial-operations/config.example.json` to a protected local
configuration, replace paths, and keep it mode 0600. The operations file requires
all fields even when a command uses only some. `objectRoot` must point at the
existing intake's `objects` directory. Native admission/release require the
existing database configuration/migrations and a deliberately provisioned corpus.
Do not point qualification fixtures at production.

```sh
node .stamp/industrial-operations.mjs qualify CONFIG.json REQUEST.json
node .stamp/industrial-operations.mjs admit CONFIG.json REQUEST.json APPROVAL.json
node .stamp/industrial-operations.mjs prepare-release CONFIG.json RELEASE-REQUEST.json
node .stamp/industrial-operations.mjs release CONFIG.json RELEASE-REQUEST.json APPROVAL.json
node .stamp/industrial-operations.mjs refresh CONFIG.json
node .stamp/industrial-operations.mjs serve CONFIG.json
```

`serve` requires a separately protected configuration satisfying
`serverConfigSchema` in `distribution.ts`; no empty/default credential grants
work. Use `credentialForToken` from that module with an explicitly generated
`esm_` + base64url 32-random-byte token. Store only the returned digest grant in
config, deliver the token out of band, and set narrow artifact/recipient/time
scope. Config files are reread per request; replace them atomically. Granting a
review and publishing a signed record release are distinct actions.

Offline approval tooling must use ESM's **existing `encodeLocalRecord` and
`localRecordDigest` codec**, not arbitrary JSON stringification. Sign the bytes
of the following body with an operator-owned Ed25519 private key, then add the
base64url `signature` field. The private key must not enter repository, backend
configuration, CI artifact, or HTTP request.

```text
schema: payload.industrial-approval.v1
 decisionId, action: ADMIT or RELEASE, authorityId, keyId,
 targetDigest, issuedAt, notAfter

ADMIT target: complete parsed admission request
RELEASE target: { requestDigest: digest(parsed release request), body: prepared body }
```

The matching public key registry grants action-specific authority and a finite
window. A changed selection, value, purpose, recipient, source-grant declaration
or deadline changes the target and needs a new signature. Signing declarations
does not supply missing evidence, canonical identity or source rights.

## Validation scope and current blockers

`industrial-operations.vitest.mts` includes the original gate, local intake,
SQL admission writer, industrial review and scheduler tests, plus new signature,
HTTP, SQL release and crash/concurrency cases. Positive admission/release cases
use explicitly synthetic bytes in an isolated PGlite PostgreSQL database and
ephemeral keys. They execute the real writer and gate; only the database
connection is substituted. A fixture certification setup is explicitly a test,
not an automatic production-certification operation.

The qualification script can execute a new live retained refresh or reinspect an
already retained capture. It emits the real admission refusal and does not add
missing publication time, canonical identity, rights or a human approval. The
browser script exercises the actual authenticated listener and the existing GSV
industrial build with real captured data and ephemeral access credentials. It
checks unauthenticated denial, HttpOnly login, digest-bound read, mobile display
and live revocation. No credential is retained in its report or screenshots.

Tests do not qualify a deployed recurring process, production PostgreSQL,
external TLS/authentication, source truth, scientific uncertainty, legal rights,
or a live certified corpus. Existing unrelated repository failures remain
separate checks. Terrain stays NAD83/NAVD88 on a spherical display: no geodetic
conversion, aircraft clearance, bathymetry, navigation or flood model is added.

Primary API references: Node.js `crypto.verify` / `crypto.timingSafeEqual`
(https://nodejs.org/api/crypto.html), and systemd timer/service semantics
(https://www.freedesktop.org/software/systemd/man/latest/systemd.timer.html).

## Integration repair retained

The initial operations workflow at ESM `6855dd2` completed tests, live retained
refresh and real admission refusal, but browser qualification failed. GSV
explicitly sent `credentials: omit`; login could not authenticate its data
requests. GSV `f6e1c14b2da4c6d7bd1a4d5354d40d2e052645c6` changes only the bounded
loopback review transport to `same-origin` and adds four loader regressions.
The workflow pins that repair. No server authentication or GSV schema gate was
relaxed, and the original homepage/synthetic scene remain unchanged.
