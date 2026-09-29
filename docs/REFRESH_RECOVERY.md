# Inspectable refresh history and signed quarantine

This increment extends the existing industrial refresh runner, authority verifier,
local immutable-file primitives and capture planner. It adds no evidence store,
collector, admission writer, source adapter, public route or remote service.
The original v1 binding, intent and completion-receipt formats are unchanged.

## The distinction that recovery must preserve

An attempt without a completion receipt is **INCOMPLETE**, not a measured failure.
Its source effects are unknown. An authorized operator can quarantine that attempt
for scheduling after maintenance; that act does not retrospectively complete it.
The original intent stays byte-for-byte and no completion receipt is manufactured.

| Journal evidence | Execution state | Scheduling disposition | Budget |
| --- | --- | --- | --- |
| Valid capture receipt | CAPTURED | CAPTURED | One spent slot |
| Valid failure receipt | FAILED | FAILED | One spent slot |
| Intent without completion or quarantine | INCOMPLETE | INCOMPLETE; schedule blocked | One spent slot |
| Intent plus separately signed quarantine | INCOMPLETE; effects UNKNOWN | QUARANTINED | Same spent slot |
| Both completion and quarantine | Conflicting terminal records | Unavailable; schedule blocked | No reset or collection |

Quarantine uses the planner's already supported `QUARANTINED` disposition. The
planner itself is unchanged. No slot is reclaimed, no interval/window is enlarged,
and re-enabling does not reset the immutable schedule identity. A later attempt
has its own identity. A v1 reader without quarantine support still sees the
original incomplete intent and refuses to run: it fails closed on new journals.

## Read-only status

```sh
node .stamp/industrial-operations.mjs refresh-status CONFIG.json
```

The result uses `payload.industrial-refresh-status.v1` and reports `UNINITIALIZED`,
`INSPECTED`, `BLOCKED`, `LOCKED` or `UNAVAILABLE`. It distinguishes no previous
capture from a timestamp or zero. A readable journal includes the original
planner's due decision, spent/remaining budget, next eligible time, attempt
identities/dispositions and latest successful receipt's bound output digests.

Status never creates a root, binding, lock, attempt or audit file. The reader
checks the exact binding, all intents and receipts, time order, receipt hashes,
and any signed quarantine. It reads the journal twice and refuses a differing
snapshot, and it checks the lock before and after. This is an observed snapshot,
not a read lock or a guarantee that a future writer cannot act after it returns.

An existing lock returns `LOCKED / LOCK_OWNER_NOT_ASSESSED`, with no invented
history count or plan. Its age does not establish whether its worker is alive.
Corruption returns a fixed reason and no partial plan, raw exception, filesystem
path or rejected payload. CLI exit code is 2 for LOCKED/BLOCKED/UNAVAILABLE,
0 for a readable/uninitialized result, and 1 for invalid command/configuration.

**`verificationScope: JOURNAL_ONLY`** is intentional. `journalAgeMs` measures time
since a capture receipt finished, not since a sensor observed the world. Status
does not reopen all source artifacts, authenticate the remote provider, recheck
release rights or imply freshness. `sourceFreshness: NOT_CHECKED`,
`executionAuthorized: false`, `canonicalAdmission: false` and `release: null`
remain explicit. The normal capture pipeline retains its separate byte checks.

## Explicit quarantine operation

First disable the configured schedule and stop its host timer/workers. Investigate
the incomplete attempt and preserve its files. A signature below asserts that
execution has been stopped; the application cannot independently prove that host
maintenance statement. No operation in this increment kills a process or removes,
steals, times out, renames or automatically clears an existing lock.

A lock left after a process crash must be addressed through trusted host
maintenance only after the worker is proven stopped. Removing a lock while a
worker can still write is unsafe. Without that maintenance, quarantine refuses.
The process tests demonstrate an OS-confirmed child exit before their explicit
fixture-only lock removal; this is not an automatic production unlock policy.

Prepare a request for one exact incomplete attempt:

```sh
node .stamp/industrial-operations.mjs prepare-refresh-quarantine \
  CONFIG.json ATTEMPT_UUID > quarantine-request.json
```

This preparation writes nothing itself. The shell redirection is the operator's
file write. The request binds the immutable schedule/operation, exact intent,
full current journal digest and preparation instant, and declares:

```text
disposition: QUARANTINED
executionOutcome: UNKNOWN
maintenance: EXECUTION_STOPPED_CONFIRMED_BY_OPERATOR
canonicalAdmission: false
release: null
```

Obtain an **external operator Ed25519 approval** with action `QUARANTINE_REFRESH`,
using the existing `payload.industrial-approval.v1` body, `encodeLocalRecord`
serialization and `localRecordDigest` target commitment. The signing target is
exactly the parsed preparation request. The approval cannot predate preparation.
Use a distinct decision ID, finite validity and a separately configured public key
with `QUARANTINE_REFRESH` in its actions. This action grants neither ADMIT nor
RELEASE. Production private keys are not generated or stored by these commands.

```sh
node .stamp/industrial-operations.mjs quarantine-refresh \
  CONFIG.json quarantine-request.json operator-approval.json
```

The command refuses an enabled schedule or any existing lock. It acquires the
same exclusive lock used by capture, reinspects the journal, verifies the exact
snapshot and action-scoped signature, and atomically publishes one create-only
`attempts/ATTEMPT_UUID/quarantine.json`. The record contains request, approval,
act timestamp and its digest. It is then reopened through the same verifier used
by the normal refresh runner. There is no canonical write, release or capture.

An already terminal attempt cannot be quarantined again. A changed journal needs
fresh preparation and signature; a reused decision ID cannot name another act.
A response lost after publication is handled by `refresh-status`, not by deleting
or overwriting the sidecar. It may be present even if the command did not return.
A late worker completion alongside quarantine blocks the entire journal rather
than choosing the more convenient record.

Only after reviewing the result should the operator explicitly re-enable the
schedule. The next external refresh invocation uses the original cadence and
remaining budget. It does not widen reader credentials to cover its new output.

## Trust and compatibility

Historical quarantine signatures are evaluated at their recorded act time using
the currently configured public-key trust registry. An approval expiring later
does not erase a prior act. Removing/revoking its trust key or action blocks use
of the quarantine; it never reclaims the spent slot. Retain historical public
keys and handle compromise through explicit maintenance, not history rewriting.

The existing distribution configuration accepts the shared action vocabulary so
its authority type cannot drift. No new HTTP command or authority-bearing route
is added. Authentication, signature checks for native releases, same-origin
transport and reader scopes are unchanged. A quarantine-only key cannot admit or
release a record, and a release-only key cannot quarantine an attempt.

This is single-host, operator-owned local filesystem coordination, not a
multi-host consensus/lease service. Host maintenance, root selection and the
filesystem remain trusted. Hashes are local integrity bindings, not physical WORM
or proof against a privileged actor rewriting the entire archive. The shared
immutable-file primitive states its process-crash rather than power-loss scope.

## Verification

Run the existing operational suite and strengthened scoped typecheck/lint:

```sh
npx tsc -p industrial-operations.tsconfig.json
npx eslint src/industrial-operations scripts/industrial-operations.entry.ts \
  scripts/qualify-industrial-operations.entry.ts
npx vitest run --config industrial-operations.vitest.mts
```

The new tests cover side-effect-free reads, malformed/tampered/changed history,
action/expiry/revocation isolation, no refunded budget, unchanged original intents,
no fabricated completion, late-result conflict, real two-process exclusion and
SIGKILL behavior. These failure/recovery tests use synthetic results and ephemeral
keys, never a signed production admission or real-source quarantine.

The live integration workflow additionally inspects its freshly captured journal
and checks every retained refresh file digest before/after that inspection. Its
existing real-source admission-refusal and authenticated GSV browser checks remain
required and separate from journal inspection. No recurring collector is activated
by running tests or installing these commands.

API basis: Node.js cryptographic signature verification and filesystem primitives:
https://nodejs.org/download/release/v24.16.0/docs/api/crypto.html
https://nodejs.org/api/fs.html
