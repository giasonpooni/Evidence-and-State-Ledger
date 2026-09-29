# CARAVAN V1 — inbound PO exception monitoring

CARAVAN's first commercial wedge is intentionally narrow:

> Given declared purchase orders, inbound shipment state, inventory and production demand, identify which inbound POs need attention, why, the modeled production-impact window, and bounded candidate follow-up actions.

This is a **domain projection** over the existing State Ledger / physical-economy substrate. It is not a second canonical database.

## Inputs

V1 accepts one bounded JSON request with:

- purchase orders: supplier, plant, material, quantity, required-by time;
- shipments: quantity, status, declared ETA interval, latest tracking event, document completeness;
- inventory: on-hand, reserved and safety-stock quantities;
- production: declared start time and daily material use;
- evidence references for every input class;
- an explicit decision cutoff (`asOf`) and tracking-staleness policy.

No live carrier, ERP, TMS, EDI or supplier connector is installed by V1.

## Output

Each PO receives:

- `CRITICAL | HIGH | MEDIUM | OK`;
- exact reason codes;
- shipment coverage and latest ETA needed to cover the PO;
- modeled inventory runway when inventory + production inputs exist;
- retained evidence references;
- **candidate-only** actions.

Candidate actions never execute. Typical outputs are:

- request carrier update;
- request documents;
- supplier escalation review;
- expedite review;
- alternate-inventory review;
- production-schedule review.

## Deterministic rules

V1 does not predict ETA. It uses the caller-declared ETA window.

A PO is **CRITICAL** when the latest ETA required for declared shipment coverage falls after the modeled inventory-runway threshold.

A PO is **HIGH** when there is no shipment, insufficient shipment quantity, a cancellation, or the declared ETA misses the PO required-by date.

A PO is **MEDIUM** when the shipment needed for coverage has no ETA, tracking is stale, or documents are declared incomplete.

Otherwise it is **OK**.

The production runway is:

```text
usable_inventory = max(0, on_hand - reserved - safety_stock)
runway_days      = usable_inventory / declared_daily_use
threat_at        = max(as_of, production_starts_at) + runway_days
```

This is a declared-state calculation, not a probabilistic forecast.

## Authority and evidence boundary

CARAVAN V1 states:

```text
decision support only
execution authority = false
ETA prediction performed = false
physical truth established = false
state admission performed = false
```

It does not modify State Ledger, contact a carrier, approve an expedite, choose a substitute material, or change a production schedule.

The product value comes from turning retained customer state into a bounded exception decision, while canonical evidence/admission remains owned by State Ledger.

## Run the synthetic specimen

```sh
npm ci
npm run caravan:po-exceptions -- examples/caravan-po-exceptions.json
npm exec vitest run src/domain/caravanDesk.test.ts
```

The committed fixture is synthetic and does not represent a live customer.
