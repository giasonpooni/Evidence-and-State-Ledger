# Industrial readiness gate

This layer separates **process liveness** from **instrument readiness**. A running
Node process is not enough to call the industrial review usable.

The readiness gate is read-only. It does not acquire data, repair history,
provision credentials, admit records, publish releases, or relax GSC/GSV
contracts.

## Required conditions

`industrial-operations readiness CONFIG.json` returns READY only when all
configured requirements pass:

- the operations and distribution configurations are regular files and, when
  required by policy, are not group/world accessible;
- refresh, intake, object and audit roots are real directories rather than
  symbolic-link substitutions;
- the audit directory is writable;
- the compiled industrial viewer exists;
- the existing refresh journal is coherent and not blocked or locked;
- the collector is enabled when the readiness policy requires it;
- the configured active resource exists and is specifically a
  `RETAINED_REVIEW`, not an artifact-only review;
- the retained-review selection binds the same refresh root, intake root,
  schedule and compiled digest as the active distribution configuration;
- the exact retained result successfully reopens through the existing
  dependency inspector;
- at least one non-revoked, in-window credential is scoped to the exact active
  digest when required;
- the latest numeric observation is no older than the explicit
  `maxObservationAgeMs` readiness budget.

The age budget is an **operator service policy**, separate from GSV's display
threshold and separate from any NOAA/USGS service-level agreement.

A null/empty latest row never becomes a fresh measurement. A stale but intact
capture can remain inspectable as history while the instrument reports
NOT_READY for operational use.

## Probe semantics

The loopback listener exposes two minimal unauthenticated probes:

- `GET /healthz` — process state only: `ALIVE` or `DRAINING`.
- `GET /readyz` — sanitized readiness result only: `READY` or `NOT_READY`
  plus fixed reason codes.

These endpoints are still subject to the existing loopback Host/Origin/path and
rate gates. They do not expose filesystem paths, credentials, source payloads,
record values, evidence digests, or operator identities.

All data routes remain authenticated.

## Graceful shutdown

`serve` performs a readiness check before binding the listener. SIGTERM/SIGINT
switches the service into DRAINING, making `/readyz` fail immediately, closes
idle connections, stops accepting new connections, and bounds final connection
drain before forcing closure.

This protects deployment orchestration from routing new work to a terminating
instrument. It does not create distributed consensus or guarantee that a client
has erased bytes already delivered.

## Hardened systemd service

`deploy/industrial-operations/industrial-review.service` adds an
`ExecStartPre` readiness gate, restart policy, bounded shutdown, empty
capability sets and systemd filesystem/kernel isolation. Only the audit
directory is writable by the long-running viewer service.

The one-shot refresh service remains separate because acquisition has different
write and network requirements. Do not merge the two units merely to simplify
deployment.

Before enabling either unit:

1. build and pin the ESM/GSC/GSV revisions;
2. provision protected configuration files (0600, owned by the service
   operator);
3. create the retained roots and audit directory with deliberate ownership;
4. provision exact reader grants and external signing authorities;
5. run `readiness` manually and preserve its result;
6. install the service unit only after host-specific systemd verification;
7. configure an external supervisor to poll `/healthz` and `/readyz`.

## What this still does not establish

Passing readiness means the configured internal review instrument is coherent
enough to serve its selected retained capture under the stated local policy.
It does **not** establish:

- source truth, legal rights, canonical admission or customer release;
- Internet-facing TLS, SSO, tenant isolation or remote zero-trust deployment;
- PostgreSQL high availability or multi-host refresh consensus;
- hardware-backed signing keys or hardware-enforced WORM storage;
- automatic backup/restore validation;
- qualified geodetic datum transformation;
- navigation, aircraft-clearance, bathymetric or flood-model accuracy.

Those remain separate acceptance domains and must not be inferred from a READY
probe.
