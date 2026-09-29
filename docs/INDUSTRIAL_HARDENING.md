# Industrial runtime hardening

This layer closes software-operational gaps without converting missing evidence or
organizational approvals into facts. It adds a machine readiness gate, a
hash-linked operations audit, hash-only backup manifests, health probes and
hardened service templates. It does **not** declare the real source admissible,
certify customer release, establish remote identity/TLS, qualify a datum
transformation, or create an off-host immutable backup.

## Readiness

`doctor CONFIG review|collector|all` is a no-acquisition diagnostic. Review
readiness requires a configured, non-revoked `RETAINED_REVIEW`, a currently
valid reader scoped to its digest, the industrial viewer build, an available
audit tail, and successful reinspection of the exact retained dependencies.
Collector readiness requires an enabled schedule, readable non-blocked journal
and remaining schedule capacity.

`all` reports two identities:

- `internalInstrument`: software-side review and collection readiness.
- `productionRelease`: always `HOLD_EXTERNAL` in this layer.

The latter names the remaining external gates: canonical identity/source clock
and rights/authority, certified release rights, remote TLS/identity provider or
mTLS, geodetic transformation/accuracy validation, and an off-host immutable
backup. Those gates require evidence or infrastructure outside this repository.

The HTTP listener exposes loopback-only `/healthz` and `/readyz`. Liveness
means the process can answer. Readiness is stricter and reopens the configured
active retained review. No paths, credentials or evidence payload are returned
by either probe.

## Operations audit

The new audit chain stores fixed-schema events as create-only files with
monotonic sequence numbers, the previous event digest and a digest of the entire
event body. Successful session creation and delivery are chained before success
is returned. Authenticated request refusals may also be chained without retaining
tokens, cookies or raw URLs.

This detects local deletion, reordering and byte modification when the full
chain is verified. It is **not physical WORM**, remote timestamping, hardware
attestation or protection against a privileged actor that can rewrite every
copy coherently. A real deployment should replicate the chain off-host.

## Integrity manifests

`integrity-snapshot CONFIG` hashes the refresh, intake, audit and static viewer
trees into one logical manifest without copying evidence bytes or exposing
absolute host paths. `integrity-verify CONFIG MANIFEST` recomputes the same
manifest. Symbolic paths, temporary files and active locks are refused.

Use this with an actual backup system: store the manifest separately from the
host, copy the corresponding bytes with a platform-specific backup mechanism,
then run verification after restore. The manifest is evidence of byte equality
under SHA-256; it is not a backup by itself.

## Deployment

`industrial-review.service` keeps the application on the existing loopback
listener and expects a dedicated `notation` account. It adds restart policy,
filesystem isolation, empty capabilities, kernel/control-group protections and
explicit writable state. Remote use still belongs behind separately managed
TLS/mTLS/SSO infrastructure; do not widen the Node listener.

The refresh service remains oneshot and the external timer remains the trigger.
Production installation and enabling are operator actions, not performed by
repository checkout or CI.
