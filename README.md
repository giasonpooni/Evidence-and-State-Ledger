# Evidence and State Management

Part of **Notation Systems' computational instrumentation and evidence infrastructure** for industrial and cyber-physical systems.

[Stack map](https://github.com/giasonpooni/Notations-Engineering-Terminal/blob/main/docs/STACK.md) · [Component role and interfaces](docs/STACK_ROLE.md)

**Provenance-aware evidence, versioned state, admission, and release management.**

Evidence and State Management is the information-retention and governance component
of Notation Systems' computational instrumentation stack. It preserves source
material, organizes time-qualified observations and records, evaluates admission,
and manages releases, rights, correction and recall. Its scope includes
physical-economy corpora, business information, operational review and scientific
evidence; it is not restricted to scientific data storage.

Notation Systems develops computational instrumentation and evidence infrastructure
for industrial and cyber-physical systems. This extends the existing
information-production mandate: Caravan, Tradewind and Landshark retain their
domain responsibilities, and Dossier Services retains the information-delivery
role. The implemented local terminal, corpus preparation rails and review
interfaces in this repository continue to support those responsibilities.
[Company mandate](docs/COMPANY_MANDATE.md) and
[Economic architecture](docs/ECONOMIC_ARCHITECTURE.md) distinguish the technical
mandate, existing delivery interfaces and present operating limits.

The repository was previously named `PayLoad-OS`. Existing `payload-os` package
names, `payload.*` and `notationsos.*` contracts, `notation://` identities,
environment variables, local `.payload` storage and retained runtime pins remain
compatibility identities. Existing interface labels such as NotationsOS and
PayloadOS may still identify those internal components; they are not the current
repository title. Historical records are not relabeled into new evidence.

## A concrete local evidence path

Solid arrows show the implemented local-file intake and reinspection rail.
Its result is retained evidence with a recomputable receipt; canonical corpus
admission and release remain separate boundaries.

```mermaid
flowchart TD
    file["Local file bytes"] --> policy{"Declared INTERNAL INGEST allowed?"}
    manifest["Source registration and capture time"] --> policy
    policy -->|Denied or approval required| refused["Capture refused"]
    policy -->|Allowed| storage["Store bytes and verify readback"]
    storage --> metadata["Acquisition metadata and receipt"]
    metadata --> inspect["Reopen saved acquisition"]
    inspect --> integrity{"Policy, metadata and bytes agree?"}
    integrity -->|No| error["Integrity error; no repair"]
    integrity -->|Yes| receipt["Recomputed local receipt"]
```

Policy authority is an operator declaration, not independent confirmation of
source rights. Byte publication and metadata publication are separate, so a
failed capture may leave retained bytes. Inspection grants no new current-use
permission and the acquisition explicitly carries `canonicalAdmission: false`.
Native CIW replay has a separate [candidate-evidence route](docs/INSTRUMENT_CANDIDATE_EVIDENCE.md)
with fresh evidence/result verification and optional retention as `UNADMITTED`.
See [admission and serving diagrams](docs/STACK_ROLE.md#admission-and-serving-diagrams)
and [Diagram atlas](https://github.com/giasonpooni/Notations-Engineering-Terminal/blob/main/docs/DIAGRAMS.md).

## Stack responsibilities

| Component | Responsibility and boundary |
|---|---|
| [Evidence and State Management](https://github.com/giasonpooni/Evidence-and-State-Management) | Retains and governs evidence, time-qualified state, admission and release. This repository also contains its local operational terminal. |
| [Provenance-Preserving Data Acquisition](https://github.com/giasonpooni/Provenance-Preserving-Data-Acquisition) | Acquires source material and produces observations while preserving source identity, extraction lineage and explicit missingness. Acquisition alone does not admit canonical state. |
| [Scientific Computation Runtime](https://github.com/giasonpooni/Scientific-Computation-Runtime) | Specifies, dispatches and records declared scientific computations over versioned scientific state. Numerical execution remains separate from information admission. |
| [Geospatial Systems Compiler (GSC)](https://github.com/giasonpooni/Geospatial-Systems-Compiler) | Separately maintained browser presentation and visualization project, formerly Payload Terminal V0. Its proposed homepage/explorer consumes explicit projections; it does not replace ESM or the workbench. |
| [Geospatial State Visualization](https://github.com/giasonpooni/Geospatial-State-Visualization) | Presents geographic entities, routes, flows and temporal state through a read-only globe client. A view is a projection, not a separate authority. |
| [State Estimation Evaluation Testbed](https://github.com/giasonpooni/State-Estimation-Evaluation-Testbed) | Owns exchange validation, bounded declared-reference evaluation and replay binding; no estimator implementation. Integration scope is tracked separately from the repository's capabilities. |
| [Constraint-Based State Reconciliation](https://github.com/giasonpooni/Constraint-Based-State-Reconciliation) | Reconciles supplied candidates against declared constraints through a bounded exact-affine operation, retaining uncertainty and correction diagnostics; not a general fusion or admission service. |
| [Notations Engineering Terminal (CIW)](https://github.com/giasonpooni/Notations-Engineering-Terminal) | Provides the existing instrument sessions, adapters, inspection and replay. It is the working environment; ESM retains and governs the information those activities reference. |

These are component responsibilities, not a claim that every cross-repository
adapter is connected. The evidence, operation specification, execution attempt,
result and verification identities remain distinct. A computed result enters
governed state only through an explicit admission boundary. Naming changes grant
no new acquisition, execution, redistribution or physical-control authority.

### Current titles and the browser integration

**Notations Engineering Terminal** is the current title of the existing
Computational Instrumentation Workbench; `ciw` remains its runtime, command and
contract namespace. **Geospatial Systems Compiler (GSC)** is the current project
title of the former Payload Terminal V0. GSV remains the geographic inspection
client while its integration into GSC is developed.

Keep the GSC homepage/explorer separately maintained and deployed. Its first
ESM integration target is the existing read-only, fixture-scoped projection
path described in [Projection Fabric](docs/PROJECTION_FABRIC.md): an exact
release and snapshot binding, explicit record selection, and both time roles.
The new frontend adapter is a target, not an integration implemented by this
README change. It must not create another canonical store or widen the current
projection contract to expose local acquisitions or unadmitted candidates.

Recorded scientific sessions belong to the engineering workbench's result and
replay boundary. Candidate-evidence review uses ESM's separate existing adapter;
retention as `UNADMITTED` does not become release or public publication. GSC may
provide contextual links to exact records and sessions, but links do not grant
access or execution authority. Public demonstrations require deliberately
published artifacts, not credentials for private stores. ESM is not a general
solver dispatcher, and the frontend is not a second workbench.

## What is actually here

The [instrument candidate-evidence adapter](docs/INSTRUMENT_CANDIDATE_EVIDENCE.md)
replays pinned CIW telemetry bundles and freshly verifies evidence/result binding
before read-only candidate review or optional retention through the existing
evidence store. It does not admit numerical outputs as canonical world state.

Read this before anything else, because the rest of the repository is careful
about it and a reader should be too.

| | |
|---|---|
| Corpora with records | All three lines. Caravan is the deepest, with cases, rulings and captured artifact bytes; Tradewind and Landshark carry records, releases, rights and one retraction each, with no captured bytes |
| Landshark and Tradewind desks | `/landshark` and `/tradewind`: release selection, gated evidence inquiry, prior-vintage comparison, exact-reading JSON and release-scoped Earth record exploration. Operational on demonstration records, not live source pipelines. See [`docs/product-desks.md`](docs/product-desks.md) |
| The Caravan corpus | 3 releases, 21 records, 2 retractions, 7 sources — committed, synthetic, `fixture_only: true` on every response |
| Admission and retained inventory | Admission, identity/time rules and a guarded PostgreSQL writer exist. The supplied-byte statutory rail can evaluate admission in memory. A retained real customer inventory is not established by that demonstration |
| Source operation | Two bounded FMCSA observations and their immutable internal qualification packages are retained locally; the second source response was unchanged. Samsara is offline-tested. Recurring collection and live customer feeds are not established. Capture requires the operator's explicit flag and source-use basis |
| Boutique package path | `npm run boutique` reopens exact evidence, packages JSONL/CSV with dictionary, quality, terms and digests, and compares vintages. Customer export is refused under the qualification-only policy. See [`docs/BOUTIQUE_PRODUCT_MILESTONE.md`](docs/BOUTIQUE_PRODUCT_MILESTONE.md) |
| Independent verification | None. Verification here is internal recompute, stated on every release. V0 and V1 of six tiers are reached |
| Customers, bills, deliveries | No completed licensed customer delivery or pilot is established. The delivery ledger is specified and empty; internal outputs do not establish a billable customer product |

The domain modules carry the system's own claims **as data with tests over
them**, so that a claim about the system fails a test when it stops being true
rather than quietly ageing in prose. The pattern throughout: every module states
what exists, what does not, and the mistake the absence invites.

## The corpus, and the contract over it

Certified releases with production records, manifests, sources and
intelligence-rights schedules. Records carrying value, unit, basis,
machine-readable uncertainty, validity bounds, **both clocks**, provenance,
evidence class and a stable `notation://` identity. As-of answers that refuse
rather than guess. Push retractions for correction and recall.

Distribution demonstrations use the feed under `/api/v1`, the stream, and twelve
MCP tools (`npm run mcp`). Database-backed corpus reads are also wired when
configured, with their origin identified. The internal Caravan ruling workbench turns a claim, a declared
use, a tolerance and two clocks into an inspectable ruling — `ADMITTED`,
`ADMITTED_WITH_CONDITIONS`, `PENDING_EVIDENCE`, `REFUSED`, `SUPERSEDED`,
`REVOKED` — and is optional: the corpus is valuable without it.

## The model, as data

Each of these is a module with tests, rendered on `/model` or `/api`, and
documented. None of them acquires anything or claims a capability the repository
does not have.

- **Doctrine** — five fabrics, three states of information, seven rules with
  where each is enforced and which test proves it, verification tiers.
  [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- **Storage** — six classes of information, the store each asks for, and the
  invariant each store must not break. PostgreSQL is selected and wired for
  records; the rest are local files and fixtures.
  [`docs/STORAGE.md`](docs/STORAGE.md)
- **The admission gate** — nine checks with refusal as the default, and the ninth
  is the one a process would omit: **nothing admits on its own behalf**, because a
  process promoting its own output is a write wearing a ruling's clothes. A check
  that cannot be evaluated fails, so an undeclared evidence axis is not a weak one
  and an undecided right is not a quiet permission. Ancestry is produced only by an
  admission and lives outside the release, and `releaseLeaks` checks doctrine rule 2
  by scanning a serialized release rather than asserting the rule in a comment. The
  gate can return admission rulings on supplied inputs; retained operational
  inventory is a separate step. Fixtures written by the seeder are stamped
  `DEMONSTRATION`, which makes the two writers disjoint by type.
- **Reference ground, and the third clock** — *what the source knew by D* and *what
  this system held at K* are two different questions, and answering the second with
  the first invents a corpus that knew things it did not know. A caller names which
  one it is asking, the two use different clocks on purpose, and what a question
  excluded is named rather than dropped. Provenance is declared and never inferred:
  no threshold reads a gap between the clocks as backfill. Absence gets three
  readings and never a fourth, and none of them says the thing did not happen. The
  ground is measured but not sold, reasoned over but never into.
  [`docs/REFERENCE_GROUND.md`](docs/REFERENCE_GROUND.md)
- **The response pipeline** — what leaves, and why: five stages in refusal order,
  and the order is the argument. What no contract can buy is checked before what a
  contract can, so the estates are refused before rights are read and a fully
  permitted caller is still refused there. No later stage rescues an earlier
  refusal; a `DEMONSTRATION` row is never served as corpus state whatever a licence
  permits; a refusal is a result that names its stage, never an error and never
  silence. Every run carries a receipt over the canonical serialization, which says
  the declared policy ran — not that it was the right policy.
- **Correction and identity** — downstream invalidation, the specified-and-empty
  delivery ledger, one identity core with three per-line identifier families and
  the still-absent cross-line join.
  [`docs/CORRECTION_AND_IDENTITY.md`](docs/CORRECTION_AND_IDENTITY.md)
- **The cross-line join, run** — three lines carry records now, so the two
  present keys were finally exercised rather than asserted: 11 cross-line pairs,
  4 co-located, 3 unkeyable because their source stated no precision, and
  `resolved: 0`. A lot at a berth, a route's discharge point written against
  that berth and the parcel the berth sits on are three subjects in one cell.
  That is co-location, and no number of co-located pairs becomes a resolution.
  [`docs/CROSS_LINE_JOIN.md`](docs/CROSS_LINE_JOIN.md)
- **Metering** — what a lap is, and the half of a response receipt that would
  have to exist before a bill line could point at one.
  [`docs/METERING.md`](docs/METERING.md)
- **Space as a working dimension** — the display was the easy half. A cell key no
  finer than the source's own stated uncertainty, a geodesic verdict on whether
  two positions can be told apart, and the four other jobs space does once it
  stops being a display attribute. Declarations and the sources behind them are
  counted separately, so three overlapping declarations from one source read as one
  account restated rather than a threefold agreement. Three sensor families, and
  the semantic convergence that is the actual gap.
  [`docs/SPATIAL_DERIVATION.md`](docs/SPATIAL_DERIVATION.md)
- **Estimation** — a constraint is a measurement with `R = 0`, so constraints are
  beliefs with provenance; certainty is harvested in proportion to declared
  confidence; a violated constraint is evidence about the constraint; and a
  solver informs the corpus but never decides an identity. With the four tiers of
  invariant scoring and the reference channel they must never feed.
  [`docs/ESTIMATION.md`](docs/ESTIMATION.md)
- **The maritime layer** — the vessel as the state the sensor families were
  defined around, dispatch typed as a *prior* so intent-versus-track stays
  signal, and the port as a time-indexed set whose membership is a ruling with
  both clocks, where an unknown set is never an empty one. When several channels
  claim one arrival, the spread between them *is* the measurement: no composite
  confidence is produced at all, and agreement is counted over declared independent
  groups, because counting channels is counting republications.
  [`docs/MARITIME.md`](docs/MARITIME.md)
- **The carrier, congruence and the serving boundary** — the punch card rather
  than the proof: credibility lives in the estate, the rulings and the two
  clocks, and no cryptography moves it. Plus what a transport can enforce that a
  key cannot, and the three rules a reasoner over the surface is held to.
  [`docs/CARRIER_AND_CONGRUENCE.md`](docs/CARRIER_AND_CONGRUENCE.md)
- **Computations as archival artifacts** — can this be re-run from the artifact and
  a spec, on a machine that does not exist yet? Inputs must be fixed by digest and
  referenced by content rather than by a location; a version range is not a version.
  Floating point drops a grade, and not on principle: changing only
  `OPENBLAS_CORETYPE` was observed here to change covariance bytes while derived
  means stayed byte-identical. Divergence isolates a changed input and an unstable
  execution and then stops, because with everything pinned and fresh evidence still
  disagreeing, a changed world and a wrong model look identical to a frozen trace.
- **Legacy trade as backfill** — the strongest thing the past can offer this
  corpus, and why: records adversarially audited at creation, conserving mass and
  money so the constraint stack can adjudicate history, carrying institutional
  custody and printed vintages, sharing the live ontology natively, and absolutely
  archive-gated. With the coverage bound, the claim-not-truth grade and the
  extraction cost that falls with time.
- **The projection fabric** — one router, one routing table, and every engine
  routed to rather than installed. OpenUSD enters as a scene target and never a
  store, because composition resolves opinions silently where this corpus
  preserves them; the hyperbolic manifold enters as the tier below the corpus,
  where void renders void.
  [`docs/PROJECTION_FABRIC.md`](docs/PROJECTION_FABRIC.md)
- **The engine boundary** — where the pinned GAT engine's vocabulary meets the
  corpus's, the mapping is data rather than a spelling match. `DERIVED` is a GAT
  kind, a corpus claim strength *and* a corpus production class — three terms, one
  spelling — so the rows are checked. `ASSUMED` and `SIMULATED` map to nothing at
  all, and `unclassified` is not offered in their place: a value nothing witnessed
  must not be gradable. No engine output is `disinterested`, because the engine
  holds no stake but its inputs do, and it does not know whose.
  [`docs/GAT_INSPECTOR.md`](docs/GAT_INSPECTOR.md)

- **Conditional custody** — a deposit held and released against an adjudicated
  fact: the documentary credit with receipts in place of documents, and
  deliberately not an insurance product, because a stakeholder that also has a
  stake is not a stakeholder. Its real risk is that release is irreversible and
  facts are not. That is not a gap in feed-based oracles but a category boundary:
  a feed has no correction tape, so it cannot say what it has since had to unsay
  — which means **reversal exposure is a measurable property of a corpus and of
  nothing else**. Worked over the committed corpus, a condition GRANTED on
  2026-08-20 reads WITHHELD after a correction arrives 5.6 days later, and the
  decision is not touched. The window is measured — 18.3 days at the longest —
  and priceability is a declared gate that flips when the corpus earns it rather
  than a permanent refusal.
  [`docs/CONDITIONAL_CUSTODY.md`](docs/CONDITIONAL_CUSTODY.md)
- **The kinds of no** — every data system has one negative state and calls it
  null; this one has seven, each with the pair it separates, the fabrication the
  collapse produces, and the module that enforces it. An unknown set is not an
  empty set; a withdrawal removes support without supplying a contrary fact; a
  refusal is about admissibility and not about truth. The rules arrived one at a
  time from unrelated problems, which is the argument for treating the shape as a
  rule rather than a preference.
- **The settlement bridge** — the corpus says what is true and what it has since
  had to unsay; a ledger says what was irrevocably done about it. Keccak-256 and
  EIP-712 written out rather than imported, checked against the canonical vectors
  and the specification's own worked example; a receipt built from a real ruling
  that carries the admission standing, the terminal state, the clock provenance
  and the measured basis for its declared window; and a contract that refuses
  everything it cannot check — including every receipt this system can build
  today, all of which are stamped DEMONSTRATION.
  [`docs/SETTLEMENT_BRIDGE.md`](docs/SETTLEMENT_BRIDGE.md)
- **What compresses, and what must not** — the distrust stack is mostly
  translation: the same facts re-keyed, the same cargo re-examined, the same
  settlement reconciled, a dispute file assembled from paper. That collapses.
  Admission, underwriting and closing do not, because someone is answerable for
  each and compressing a judgment removes the liable party while keeping the
  appearance that one exists. And it is graded: 3 of 5 translation steps collapse
  on what the corpus holds today; the other two wait on an admitted record.
  [`docs/COMPRESSION.md`](docs/COMPRESSION.md)
- **What the additions cost** — one bullet per capability is not an inventory of
  what works. The preconditions each one waits on are declared, probed against
  the records where the corpus can decide them, and the fit is derived rather
  than asserted. The probes found something written down wrongly: the corpus
  already holds one independently corroborated quantity — lot 5B-221's gross
  weight, from a draft survey and a weighbridge — and it cannot be adjudicated,
  because one side states no bound. What is missing is not a second account but
  a second account that stated its own uncertainty.
  [`docs/ACCOMMODATION.md`](docs/ACCOMMODATION.md)

## The surfaces

`/model` is the operating model as data. `/products`, `/releases`, `/stream`,
`/retractions` and `/api` are the corpus and its distribution. `/cases`,
`/rulings`, `/replay`, `/profiles` and `/evidence` are the workbench.
`/production` and `/candidates` are the rail before admission; `/harvester` is
the one rail whose candidates reach the other side of it. `/notations` is
authored local state over a Rust kernel. `/agents` and `/board` are coordination.

Four instruments are synthetic previews and say so on the page: the
[Earth Twin](docs/EARTH_TWIN.md) at `/earth` (a keyless CesiumJS globe served
from this origin, drawing each record where its subject's own `location.position`
record declares — and, beneath the globe, what the corpus can *derive* from those
same positions rather than only draw), Spatial Inquiry at `/spatial`,
[registration and access](docs/REGISTRATION_ACCESS.md) at `/compute/registration`,
[clearance value of information](docs/CLEARANCE_VOI.md) at `/compute/clearance`,
and [observation replay](docs/RECORDED_OBSERVATION_REPLAY.md) at
`/compute/observations`.

## The local rails

Opt-in, loopback-only, operator-driven, and none of them a public control.

- The [production API](docs/LOCAL_PRODUCTION_WORKFLOW.md) connects corpus and
  source registration → byte capture → evidence inspection → fixed Carrier
  normalization → candidate-build inspection, with stage receipts and exact
  retries. The [production path](docs/PRODUCTION_PATH.md) at `/production` drives
  it and names every blocker.
- [Evidence intake](docs/LOCAL_EVIDENCE_INTAKE.md),
  [normalization](docs/LOCAL_NORMALIZATION.md) and
  [candidate builds](docs/LOCAL_CANDIDATE_BUILDS.md) each evaluate their own
  permission and produce unadmitted candidates or a recorded quarantine.
- The [pinned GAT IFC inspector](docs/GAT_INSPECTOR.md) audits preserved IFC
  evidence through an exactly pinned engine and keeps the original report, a safe
  projection and an execution receipt as distinct identities.
- The [statutory filing harvester](docs/STATUTORY_HARVESTER.md) at `/harvester`
  runs insurance-regulator filings from supplied bytes to admitted records:
  capture under a digest computed at capture, extraction under a declared
  per-jurisdiction header grammar (FL OIR, CA CDI, TX TDI), candidates under a
  knowledge horizon, the admission gate, and two as-of questions kept apart. It
  is the first rail here whose candidates reach `ADMITTED`, and not because a
  check was relaxed: a regulator names an issued NAIC code and declares its own
  effective date, so the two stages the census rail is missing arrive as
  testimony rather than inference. It collects nothing and writes nothing, and
  the payload says both rather than leaving either to be inferred:
  `intake.collecting` is 0 of 1 registered source, and
  `persistence.canonicalStateMutated` is false. A drafted specimen is refused at
  the capture, because its candidates declare `BACKFILLED` and a row from bytes
  typed here would be indistinguishable in the records table from one descending
  from a real filing.
- The [FMCSA connector](docs/LOCAL_SOURCE_CONNECTORS.md) and the
  [Samsara adapter](docs/SAMSARA_CONNECTOR.md) are operator-only and bounded.
  Collection requires a flag the operator holds; historical inspection never
  reconnects. The [source inventory](docs/SOURCE_INTEGRATION_INVENTORY.md) distinguishes historical declarations from implemented connectors.
- Local [observation replay](docs/RECORDED_OBSERVATION_REPLAY.md), the
  [scalar benchmark](docs/SCIENTIFIC_BASELINE.md), the
  [registration experiment](docs/REGISTRATION_ACCESS.md) and the
  [clearance experiment](docs/CLEARANCE_VOI.md) run on explicitly synthetic
  inputs and retain evidence-bound runs. None claims fusion, accuracy, admission
  or field validation.
- A [Rust notation state kernel](docs/LOCAL_NOTATION_STATE_KERNEL.md) backs
  `/notations`: stable-ID notations, explicit relations, undo and redo, versioned
  local saves. Authored workspace state, never canonical corpus state.

## Run

```
npm ci
npm run dev            # http://localhost:3000 → /releases; coordination is read-only
npm run dev:coordination # http://127.0.0.1:3000; local stable and board writes enabled
npm run dev:state-kernel # http://127.0.0.1:3000/notations; requires Rust, local notation state enabled
npm run dev:production # local acquisition/inspection APIs; GAT requires separate pinned bootstrap
npm run agent:contract-review -- --once # in a second terminal; register and run a local review pass
npm run build && npm start
```

The state-kernel launcher builds the locked Rust crate before enabling the loopback workspace. Preview does not save; Save revalidates against the exact saved base version, and Reload checks every stored version through Rust. Local notation history lives separately in `.payload/notation-state`. No production identity, permissions service, corpus admission or customer delivery is supplied by this milestone.

The coordination launcher binds to `127.0.0.1` and uses `PORT` when set, otherwise port 3000. Visit `/agents` to inspect and register definitions and `/board` to post, reply and acknowledge. Local history persists in the git-ignored `.payload/coordination/events.json`. Selecting an author simulates an identity; it is not authentication. The same `GET` / `POST /api/coordination` JSON interface and `GET /api/coordination/inbox` are available to C++, Rust, Python and JavaScript clients; dependency-free JavaScript and Python clients are included under `clients/`.

Run the contract reviewer once to register `agent.contract-review.v1`, post a directed `REQUEST` with topic `contract-review` and body `{"participantId":"agent.release"}`, then run it again to receive a result. `--watch` repeats passes with a two-second wait. Each pending-work pass starts its inbox scan at zero; durable acknowledgements exclude handled inputs. `PAYLOAD_COORDINATION_URL` selects the worker's local server URL. See [Agent coordination](docs/AGENT_COORDINATION.md) for the two-terminal workflow, client examples, cursor semantics and recovery behavior.

To exercise local evidence intake without a web server, use the included synthetic notice:

```sh
npm run evidence -- capture --request examples/evidence/request.json --input examples/evidence/notice.txt
npm run evidence -- inspect --acquisition demo-caravan-local-notice-001
```

The default store is `.payload/evidence`; `--root <directory>` selects another local root. An identical retry returns the original acquisition and timestamp; a changed valid, policy-allowed request under the same id conflicts, while invalid requests fail earlier checks. Inspection recomputes policy at the original capture time and byte/receipt integrity without returning raw bytes or modifying storage. It grants no current access or retention permission and checks no subsequent external revocation. Inputs are bounded at 8 MiB and metadata at 64 KiB. See [Local evidence intake](docs/LOCAL_EVIDENCE_INTAKE.md) for exact status, storage and recovery boundaries. The declaration is not independent authorization, and the local files are not production storage or canonical corpus state.

To exercise the separate normalized-candidate path, use the synthetic Carrier example, whose declaration permits both ingestion and derivation:

```sh
npm run evidence -- capture --request examples/carrier/acquisition.json --input examples/carrier/source.json
npm run evidence -- normalize --request examples/carrier/normalization.json
npm run evidence -- inspect-normalization --normalization demo-caravan-carrier-normalization-001
```

Use the same store root for all three commands. This fixed adapter parses captured UTF-8 JSON up to 64 KiB, preserves source-scoped identity and explicit missingness, and leaves canonical identity unresolved. A contract mismatch records a quarantine with no candidate; source bytes are not moved. Normalization and inspection return JSON with exit `0` for a normalized run, `2` for a persisted quarantine and `1` for an error. Inspection recomputes the parser and original declared DERIVE decision, not a current access grant. See [Local normalization](docs/LOCAL_NORMALIZATION.md) for the exact schema, historical retries, provenance and nonclaims. The original notice remains ingestion-only.

Then select 1–64 normalization ids in an explicit candidate-build request. Set its `knownThrough` at or after each candidate's knowledge time and no later than the build time:

```sh
npm run evidence -- build-candidates --request <manifest.json>
npm run evidence -- inspect-candidate-build --build <build-id>
```

The builder reopens every selected normalization and its source bytes, rejects missing/quarantined members and duplicate source-scoped identities, and persists references and metadata without copying candidate data fields. It does not scan for members or choose a current version. Reordered identical requests preserve the original build and time; inspection recomputes the original decisions without granting current access. Builds remain `UNADMITTED` and do not feed the public API. See [Local candidate builds](docs/LOCAL_CANDIDATE_BUILDS.md) for the request shape, cutoff, source-class and DERIVE rules, storage limits and recovery behavior.

`npm run evidence -- compare-candidate-builds --request <manifest.json>` compares two inspected local builds by exact source-id/source-record-id tuples and normalization/candidate references. It requires full build digests, identical definition/contract/purpose and nondecreasing build/cutoff times. The deterministic report is not saved and includes no invented comparison time; it distinguishes reference changes without inferring field changes, corrections or retractions. Source identifiers are included, but raw bytes, candidate fields and policy bodies are not. See [Local candidate comparison](docs/LOCAL_CANDIDATE_COMPARISON.md) for the request template and limits. This creates no new build, current-use grant, board post or released change feed.

With the local coordination server running, `npm run agent:candidate-build-review -- --once` registers a separate build-inspection worker. Send it a directed request with topic `candidate-build-review`, `context: null` and exact JSON body `{ "buildId": "…", "expectedDigest": "sha256:…" }`, using the full `build.digest` returned by inspection, not `recordsRoot`. Run it again to obtain a redacted build-level result and acknowledgement. Its evidence root is selected only by the operator's `--root` flag, not the message. Saved results are validated and read back before acknowledgement; a failed receipt reuses the historical observation, while a new request obtains a new inspection. See [Candidate-build review worker](docs/CANDIDATE_BUILD_REVIEW_WORKER.md) for the complete client example, loopback-only configuration and simulated-identity limits. This grants no current retrieval rights or admission authority.

## Check

```
npm run typecheck      # tsc --noEmit
npm run lint           # eslint
npm test               # vitest: node tests for selectors/fixtures, jsdom tests for screens
python -m unittest discover -s tests/python -v # standard-library coordination client checks
npm run stamp:digests  # recompute committed sha256 digests after editing a fixture
npm run e2e            # playwright: smoke, axe (WCAG 2.2 AA), keyboard, mobile, no horizontal document overflow
npm run screenshots    # writes docs/screenshots/*.png
npm run mcp            # MCP server over the fixture feed (stdio)
```

Playwright uses the environment's Chromium when `PW_CHROMIUM_PATH` is set (for example `/opt/pw-browsers/chromium`); otherwise its own download.

Typecheck also rejects unused locals and parameters. [Codebase consolidation](docs/CODEBASE_CLEANUP.md) records removed dependencies/declarations, shared boundaries and the regression checks that keep the apparatuses aligned.

## Read

- `docs/ECONOMIC_ARCHITECTURE.md` — current instrumentation and information-production mandate, internal preparation boundary, implementation status and explicitly superseded historical economic formulations.
- `docs/COMPANY_MANDATE.md` — the company mandate, customer categories, economic architecture, and the evidence/state component's place in the stack.
- `docs/SYNTHESIZED_ARCHITECTURE.md` — five fabrics, seven doctrine invariants, historical concept mapping and target runtime/projection responsibilities; implemented boundaries are explicit.
- `docs/PROJECTION_FABRIC.md` — exact fixture ProjectionSpec, read-only preview example, identity-preserving records/graph, rights/time gates and explicit missing geometry; no renderer implementation.
- `docs/UX_ARCHITECTURE.md` — object model, navigation, projections, component boundaries, the authority boundary.
- `docs/WORKSPACE_DESIGN.md` — the design language, the one shell, the inspector pattern, the notation and candidate-production slices built on it, and the verification receipt.
- `docs/STATUTORY_HARVESTER.md` — the insurance-regulator rail: the declared per-jurisdiction header grammar and its four presence states, why a filing supplies the two stages the census rail is missing, what is a claim and what is a coordinate, the two as-of questions, and the two boundaries the payload states rather than implies — nothing collected, nothing written.
- `docs/PRODUCTION_PATH.md` — the production path: seven stages with states derived from the rail's receipts, identities and recovery, the real source readback, the notation and release blockers, and the receipt.
- `docs/EARTH_TWIN.md` — the local Earth Twin: the projection fabric's CesiumJS instrument built on God's Eye View's globe stack, keyless and offline, with every layer's source and state, the corpus asked for honestly, the signal-source registry, current limits and the receipt.
- `docs/AGENT_COORDINATION.md` — the shared agent/apparatus stable, scoped board and inbox, contract synastry, JavaScript/Python clients, local worker and Bench references.
- `docs/LOCAL_EVIDENCE_INTAKE.md` — local source-policy evaluation, content-addressed evidence, acquisition receipts, inspection and Bench-derived boundaries.
- `docs/LOCAL_SOURCE_CONNECTORS.md` — operator-only live FMCSA Company Census qualification, strict transport, original-byte capture, permanent request bounds and historical inspection.
- `docs/SAMSARA_CONNECTOR.md` — offline-tested, operator-only single-vehicle GPS history; retained fleet authorization, current-use gates, private-storage limits and source observation semantics. No live fleet qualification.
- `docs/CLEARANCE_VOI.md` — exact finite-state measurement design, shared geometric dependencies, loss/cost comparisons, hypothetical posterior inspector and current-use-gated local evidence runs.
- `docs/LOCAL_NORMALIZATION.md` — fixed Caravan Carrier parsing, separate derivation permission, source-scoped candidates, quarantine and read-only recomputation.
- `docs/LOCAL_CANDIDATE_BUILDS.md` — explicit time-bounded candidate membership, build-time derivation permission, reference roots and historical inspection; no canonical admission.
- `docs/LOCAL_CANDIDATE_COMPARISON.md` — read-only exact local build comparison, source-scoped reference changes and deterministic ephemeral reports; no semantic diff or released change feed.
- `docs/LOCAL_NOTATION_STATE_KERNEL.md` — Rust notation commands, undo/redo, versioned local storage and the complete frontend save/reload milestone; no Bevy or canonical admission.
- `docs/CANDIDATE_BUILD_REVIEW_WORKER.md` — manually launched board-to-local-build inspection, bounded results, result-before-receipt recovery and authority limits.
- `docs/INTERACTION_SPEC.md` — status transitions, refusal interaction, replay, supersession, visibility.
- `docs/DEMO_CASE.md` — the fixtures, why they are synthetic, what they demonstrate, what is unvalidated.
- `docs/STORAGE.md` — six classes of information, the store each asks for, the invariant each must not break, and the current implementation boundary.
- `docs/CORRECTION_AND_IDENTITY.md` — downstream invalidation per class of derived artifact, the delivery ledger, as-of as a contract feature, and the identity core with the still-absent cross-line join.
- `docs/CROSS_LINE_JOIN.md` — the two present join keys run across all three corpora: the three lines and what each carries, the precision rule, the two clocks kept apart, 11 pairs with their outcomes, and why `resolved` is the literal 0.
- `docs/METERING.md` — the lap, the two halves of a response receipt that would have to exist before a bill line could point at one.
- `docs/TERMINAL_PLANE.md` — the control plane another terminal plugs into: a session that names a party, a purpose declared from the corpus's own permitted uses, a scope, an admission or a refusal per call, and a receipt either way.
- `docs/SPATIAL_DERIVATION.md` — space as resolver, join key, validity clock and inference engine; the cell key bounded by stated uncertainty; the three sensor families and the semantic convergence that is the actual gap.
- `docs/ESTIMATION.md` — constraints as observations with provenance, the factor graph they live in, the two disciplines written before the first solve, and the four tiers of invariant scoring with the reference channel they must never feed.
- `docs/MARITIME.md` — the vessel as state rather than feed, dispatch as a prior, the port as a time-indexed set, and the closure residual that a single-channel holder cannot produce.
- `docs/CARRIER_AND_CONGRUENCE.md` — the punch card rather than the proof, the archival test, congruence as one name for three mechanisms, the direction of authority in interoperation, the serving boundary, and the three rules a reasoner is held to.

## Layout

```
src/domain      corpus types and as-of selectors (corpus.ts); the operating model as data (product.ts); workbench view model and selectors; domains
                and the system's own claims as data with tests over them: doctrine, storage, correction, identity, metering, spatialKey, spatialDerivation,
                sensorFamilies, earthComplex, usdProjection, constraints, factorGraph, invariantScoring, eventClosure, vessel, portSet, admission,
                responsePipeline, computationCard, computationCarrier, servingBoundary, reasoningWitness, referenceGround, actuarial, legacyTrade
src/adapter     CorpusSource and CaseSource seams; feed payload builders; fixture implementations only
src/projection  closed ProjectionSpec, full fixture-source snapshot descriptor and replaceable records/graph compiler; engine routing only, no renderer dependencies
native/state-kernel small Rust notation command/replay kernel; stable IDs, explicit relations and inverse history, no renderer or filesystem
src/state-kernel fixed native-process adapter, loopback contract and immutable local saved versions; not domain canonical state
src/data-os     Bench-derived source policy/capture, local evidence store, fixed Carrier parser, candidate builds and read-only reference comparison; no canonical corpus admission
src/acquisition operator-only source requests, fixed FMCSA and Samsara HTTPS transports, source parsers, immutable capture history and CLIs; no customer API
src/coordination agent/apparatus definitions, scope and message rules, contract matching, participant inbox, deterministic contract/build-inspection workers and opt-in local event log
clients         dependency-free JavaScript and Python coordination clients
scripts         local server launcher, contract-review and candidate-build-review workers; evidence intake/normalization/candidate-build entry points
examples/evidence synthetic notice and operator-declared intake manifest
examples/carrier synthetic Carrier JSON, acquisition declaration and normalization request
src/mcp         MCP tools over the same feed payloads; serve.ts is the governed door every
                call goes through, and the stdio server opens a declared session (docs/TERMINAL_PLANE.md)
src/domain/informationProduct.ts  the first information product as data, held to the corpus by its test: every field exists, every released record meets the stated evidence requirement, the customer question is answerable through the feed at two knowledge times
src/domain/deliveredRecord.ts     the ten questions a delivered record answers, mapped to payload fields; its test holds every record the feed delivers to all ten
src/domain/doctrine.ts   the architecture carried forward as data: five fabrics, three states of information, seven rules with where each is enforced and which tests prove it, verification tiers (docs/ARCHITECTURE.md is the prose; /model renders it)
src/chain          keccak256, EIP-712 and the adjudication receipt: the digest a settlement contract verifies, built from a real ruling; contracts/ holds the escrow (docs/SETTLEMENT_BRIDGE.md)
scripts/bench-query.ts  what the read paths cost at volume, over synthetic in-memory records that are never written (docs/QUERY_PERFORMANCE.md)
src/domain/dependencyIndex.ts  the forward edge: what stands on a record, so a correction reaches it — transitive, cycle-safe, reporting a consequence rather than a verdict and its own coverage rather than completeness
src/domain/identityResolution.ts  resolving a source name to a canonical subject on issued identifiers against a bitemporal registry: names refused, ambiguity refused rather than broken, unresolved reported as a fact about the registry
src/domain/worldTime.ts  when a fact became true as against when a register was read: established, bracketed, or refused — and a bracket is never flattened into a valid-from
src/domain/candidateProjection.ts  the hop from the normalization rail to the admission gate: one entity with N fields becomes N candidates ruled on separately, with the predicate declared rather than derived and both absent stages carried through rather than filled
src/domain/compression.ts  what the system removes and what it must not: five translation steps that collapse into a named artifact, three judgment layers that stay with someone answerable, and a derivation of how much collapses on what the corpus actually holds (docs/COMPRESSION.md)
src/domain/conditionGrammar.ts  what a release condition can say: five composable node kinds, three-valued composition where an unknown never becomes a false, and a did-not-occur term that needs declared coverage rather than a failure to find a record
src/domain/routeClosure.ts  the three states of a route: open, closed, and the one systems lose — unclosed, which is a bilateral instrument rather than a failure
src/domain/negativeStates.ts  the kinds of no, kept apart: seven named rules, each with the fabrication its collapse produces and the module that enforces it
src/domain/collateralVehicle.ts  hold, monitor, adjudicate, release: the condition evaluator that never holds the collateral, never warrants the outcome and never un-fires a release; the restatement exposure measured and refused as a rate (docs/CONDITIONAL_CUSTODY.md)
src/domain/accommodation.ts  what each capability waits on, with the corpus probing every precondition it can decide; the fit is derived and never declared (docs/ACCOMMODATION.md)
src/domain/projection.ts the projection instruments' questions and roles and the routing table as data, over the one router in src/projection/spec.ts; a test checks the table against the router for every combination
src/domain/admission.ts  the gate: nine checks with refusal as the default, the entry stamp of three clocks and declared provenance, a writable row obtainable only from an ADMITTED ruling, ancestry kept outside the release, and releaseLeaks checking doctrine rule 2 rather than asserting it
src/domain/referenceGround.ts  the third clock and the two as-of questions it keeps apart; three readings of absence; the ground measured but not sold, reasoned over but not into (docs/REFERENCE_GROUND.md)
src/domain/responsePipeline.ts  what leaves and why: five stages in refusal order with the estates refused before rights are read, provenance-only disclosure, a named stage on every refusal, and a receipt over the canonical run
src/domain/computationCard.ts  computations graded as archival artifacts rather than trusted as proofs, and the four-way divergence whose last case a frozen trace cannot separate
src/domain/eventClosure.ts   the residual between channels claiming one event, counted over declared independent groups rather than over channels
src/domain/portSet.ts    a port as a time-indexed set whose membership is a ruling; unknown occupancy is null and never zero
src/architecture.test.ts structural doctrine: browser and page layers take only types and the pure policy evaluator from the rails; the rails import nothing from above; every projection leaves the corpus untouched and identities intact
src/fixtures/production  the candidate-production demonstration: pipeline.ts runs examples/ through the real local rails at fixed instants; demo.json is its committed output, drift-tested and separation-tested
src/fixtures    Caravan corpus releases, records, retractions and rights; profile and cases; manifest builder; digest plan; committed digests
src/components  primitives, case workspace, ruling viewer, replay, queue, intake, shell
src/app         operating model: /model (a permanent redirect from /product)
                corpus: /releases, /releases/[releaseId], /stream, /retractions, /api, /api/v1/* (fixture feed)
                workbench: /cases, /cases/new, /cases/[caseId], /rulings, /rulings/[rulingId], /replay/[caseId], /profiles, /evidence
                coordination: /agents, /board, /api/coordination, /api/coordination/inbox (read-only fixtures or local sandbox)
                product: /products (the first information product, caravan.lot-state.v0: customer question, subjects, fields with evidence requirements, freshness, permitted uses, correction at two knowledge times, the ten-question delivered-record contract, the acceptance target)
                production: /candidates (the local rail's acquisitions, normalizations, candidate build and refusals, all UNADMITTED; reproduced from examples/ by npm run stamp:production)
                projection: /api/projections/sources/[releaseId] (descriptor GET), /api/projections/preview (read-only POST over pinned fixture releases)
                instruments: /earth (Earth Twin, with the derivation beneath the globe), /spatial, /compute/registration, /compute/clearance, /compute/observations, /replay, /frontier, /factoring, /dispatch-liability
tests/e2e       Playwright smoke, accessibility, keyboard, mobile, overflow guard, screenshots
```