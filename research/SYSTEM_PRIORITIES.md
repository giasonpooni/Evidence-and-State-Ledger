# Notation Systems — System and Subsystem Development Priorities

This document governs engineering priority across the Notation Systems commons.
It exists to prevent the architecture from expanding by enthusiasm rather than
by demonstrated missing capability.

The central rule is:

> Build the smallest shared subsystem required to complete a named investigation,
> then test it across unlike workloads before generalizing it.

## Priority model

### P0 — Stabilize the common substrate

Nothing outranks a broken shared contract.

Current P0 stack:

1. **System Board**
   - parameterized typed nodes;
   - typed sockets;
   - units / frames / scale / uncertainty / provenance;
   - hierarchical groups;
   - semantic compilation.

2. **Parameter Program**
   - deterministic navigation over exposed Board coordinates;
   - immutable candidate Boards;
   - no optimization or execution authority.

3. **Needle**
   - local immutable intervention;
   - dependency closure;
   - selective recomputation;
   - delta observation.

4. **Container / Experiment Calculus**
   - bounded computational boundaries;
   - backend-neutral occurrence telemetry;
   - explicit resource/evidence/authority envelopes.

5. **NISE → NET**
   - query-specific candidate structure;
   - explicit operator binding;
   - semantic operation lowering.

6. **Annotation**
   - human interpretive state remains distinct from evidence/state/verification;
   - human intent can seed NISE without silently becoming truth.

P0 exits only when focused Linux/Windows qualification is green and the
authority/epistemic boundaries are retained.

## P1 — Transformation and representation semantics

Once P0 is stable, prioritize the cross-domain interface:

- explicit Transform operation;
- preserved-property declarations;
- information/approximation loss budget;
- uncertainty introduced or propagated;
- validity domain;
- reversibility / non-reversibility;
- scale transformation;
- Projection / Render as a typed state representation.

The architectural question is not whether two objects are both bytes. It is
whether the system can state what a transformation preserves, loses, assumes,
and makes valid downstream.

Do not build a general visual editor before these semantics exist.

## P2 — Cross-domain falsification of the common grammar

The next experiments should attack the same primitive from genuinely different
directions.

### Needle corpus

1. scientific-computing oscillator — completed;
2. Notations Gaming / projectile or world-state workload;
3. energy / thermal network;
4. state-estimation / sensor model.

### Representation-reduction corpus

1. oscillator — completed;
2. state estimation;
3. GIS / geometry;
4. creative-production workload.

### Board / parameterization corpus

1. oscillator;
2. thermal/energy;
3. geospatial;
4. Notations Gaming world/asset graph.

A primitive becomes more interesting when the same contract survives these tests
without acquiring hidden domain-specific assumptions.

## P3 — Domain science and field workloads

Application domains should normally be workloads over common instruments, not
new architectures.

### Canada node

Primary stressors:

- manufacturing;
- materials/process systems;
- automation;
- robotics;
- industrial sensing;
- logistics/operational state.

### France / Nouvelle-Aquitaine node

Primary stressors:

- niche agriculture;
- agro-food;
- distributed energy;
- thermal/fluid systems;
- environmental systems;
- biological/process systems.

Current first transfer workload:

- synthetic agro-food cold-chain thermal state.

Next bounded workloads:

- greenhouse thermal/water/energy state;
- fermentation process state;
- vineyard/orchard water-state estimation;
- cooperative solar/battery/cold-room load;
- field/lot → process/batch/package traceability.

Domain-specific constitutive, biological, crop, reaction-kinetic, rheological and
equipment models remain specialist science.

## P4 — Human instrument surface

Only after Board / Transform / Needle semantics are stable:

- Board visual projection;
- groups and sockets;
- parameter controls;
- delta overlays;
- click-to-Needle;
- zoom through abstraction/scale;
- spectral/spatial/time/configuration-space views;
- human and agent actions against the same graph.

The UI must be a projection over the same machine representation used by agents,
Julia programs and optimizers. Do not create a separate human-only semantic
model.

## P5 — Execution backends and infrastructure scale-out

Local execution remains the reference until a workload requires more.

Backends are replaceable implementations of the execution contract:

- local CPU/GPU;
- bounded OS/container workcell;
- university HPC;
- cloud/HPC provider;
- external scientific application;
- later embedded/FPGA/robotics backends.

Do not let Kubernetes, a cloud vendor or a particular runtime become the
architecture.

## Parallel organizational workstreams

### Scientific Instrument Commons

Generalize and distribute reusable primitives:

- ClockSync;
- Calibration;
- DSP;
- state estimation;
- geometry/GIS;
- validated numerics;
- optimization;
- transformation;
- verification;
- projection.

### Research Ledger

Every important build should answer both:

1. What useful thing does this tool do?
2. What architectural/research claim does this build test?

Retain hypotheses, experiments, observations, counterexamples and refinements.
Frequency never automatically promotes a pattern to an axiom or theorem.

### Notations Gaming

Notations Gaming remains a separate application/IP layer and an adversarial integration
test of the commons.

Use Notations Gaming workloads to stress:

- executable world state;
- ground truth vs partial observation;
- physics;
- agents;
- terrain/GIS;
- rendering;
- large dependency graphs;
- Needle and delta rendering.

General primitives may move upstream; title-specific content/state/assets remain
separate.

### Operational pilots

Prefer narrow decision workflows over broad platforms.

Current examples:

- CARAVAN inbound PO exception monitoring;
- agro-food cold-chain thermal state;
- future manufacturing/process diagnostic pilots.

A pilot earns expansion only when it demonstrates useful accepted output,
evidence retention and measurable resource/human benefit.

## Repository creation rule

Do **not** create a new repository because a new industry appears.

Create a new specialist repository only when one of the following is true:

- it owns distinct mathematics/algorithms;
- it has an independently versioned scientific contract;
- it requires a distinct runtime/toolchain;
- it has a separate evidence/qualification lifecycle;
- it is a separately owned application/IP product.

Otherwise prefer a workload, adapter, experiment or representation over an
existing shared instrument.

## Research promotion rule

The progression remains:

Observation
→ Pattern
→ Principle
→ Proposition
→ Axiom / Theorem

with explicit counterexample search between levels.

Engineering architecture may be useful long before a deeper mathematical theory
is established.

## Immediate ordered queue

1. **System Board V1 — qualified.**
2. **Deterministic Parameter Program V1 — qualified.**
3. **Representation + Morphism Registry V1 — qualified in signal domain.**
4. **Representation-aware Needle gate — qualified in signal domain.**
5. Bind Board Transform / Project / Render nodes to morphism identities.
6. Add a finite cross-representation commutativity witness.
7. Add an explicit coarse→rich expansion/materialization contract that may return a set/distribution of compatible detailed states rather than one inverse.
8. Run Needle on Notations Gaming/projectile.
9. Run Needle on energy/thermal network.
10. Run Needle on state-estimation workload.
11. Run Board/Parameter Program/Morphism contracts on thermal or energy workload.
12. Build Board visual projection + click-to-Needle.
13. Expand agro-food/niche-agriculture transfer experiments.
14. Only then add additional cloud/HPC/backend integrations unless a current
    workload has already exceeded local capacity.

The ordering may change when an experiment falsifies an assumption. A failed
experiment is a reason to revise the queue, not to hide the failure.


## Ambient-space / hierarchy research note

Do not force the entire system into one universal manifold or one vector space.

Current research preference is a **fibered/indexed family of representation spaces**:
the context/scale/task forms a base, while different fibers may legitimately be
graphs, relations, vector spaces, probability spaces, spatial structures,
function spaces, quotient/groupoid objects or other specialized representations.

Use Fréchet/convenient/diffeological/stack-like mathematics only where the actual
objects satisfy the required mathematical structure.

The storage/context direction is **Lazy Scientific State**:
retain generators/templates, parameter spaces, coupling constraints,
representation/projection maps, deltas and evidence; materialize detailed state
only for the task-relevant branch. This remains a research/engineering direction,
not a claim that the implementation is already a moduli stack or fiber bundle.
