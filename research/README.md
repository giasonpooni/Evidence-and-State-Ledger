# Notation Systems Research Ledger

This directory treats the Notation Systems Inc. programme as a
**longitudinal research apparatus**, not merely a collection of repositories.

The operating loop is:

```text
Build
  → Observe
  → Measure
  → Compare
  → Abstract
  → Try to break the abstraction
```

Every useful project can therefore carry two identities:

1. **product/instrument identity** — what useful thing does it do?
2. **experiment identity** — what candidate representational/computational
   principle does the build test?

The ledger is deliberately above individual implementation details. It records
links to exact repository revisions/workflow evidence; it does not absorb their
source code or domain mathematics.

## Epistemic ladder

The programme distinguishes:

```text
Observation
   ↓ repeated recurrence
Pattern
   ↓ provisional generalization
Principle
   ↓ mathematical specification
Proposition
   ↓ only with formal justification
Axiom / Theorem
```

A frequent pattern is **not automatically an axiom**, and a proposition is not a
theorem until there is a proof under explicit assumptions.

## Record kinds

- `H-*` — hypothesis
- `E-*` — experiment
- `O-*` — observation
- `CE-*` — counterexample
- `PT-*` — pattern
- `P-*` — principle
- `PROP-*` — formal proposition
- `AX-*` — explicitly chosen formal axiom
- `TH-*` — proved theorem

Relations form a theory/evidence graph:

```text
Experiment ─TESTS──────────────► Hypothesis / Principle
Observation ─SUPPORTS──────────► Pattern / Principle
Counterexample ─COUNTEREXAMPLE_TO► Claim
Pattern ─MOTIVATES─────────────► Principle
Principle/Proposition ─REFINES─► earlier claim
Proposition ─FORMALIZES────────► Principle
```

## Empirical generality

For a candidate claim with a declared domain corpus, the summary computes:

```text
empirical coverage =
  tested declared domains / declared domains
```

This is a bookkeeping measure, **not a proof of universality**.

The more important signals are often:

- counterexamples;
- required exceptions;
- whether the statement had to be weakened/refined;
- whether the same operation/invariant actually transfers.

## Representation experiments

The current central research question is:

> Given a typed computational system, an investigation, and an operation family,
> what is the smallest representation that preserves the outputs, invariants,
> epistemic distinctions and provenance required by those operations?

NET's separate investigation-efficiency records measure resource use and
representation-preservation checks. This ledger records what those experiments
mean for candidate principles.

## Commands

```sh
npm ci
npm run research:ledger
npx vitest run src/research/researchLedger.test.ts
```

The committed ledger seeds only claims already motivated by implemented
experiments. It is intentionally small; add records when a build supplies real
evidence or a real counterexample.
