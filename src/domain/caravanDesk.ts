/**
 * CARAVAN V1 — bounded inbound purchase-order exception evaluation.
 *
 * This module is a domain projection over caller-declared operational state.
 * It does not acquire carrier data, predict ETAs, mutate State Ledger, contact
 * suppliers, approve expedites, or change a production schedule.
 *
 * It answers one commercial question:
 *
 *   Which inbound POs need attention, why, what modeled production impact is
 *   visible from the declared state, and which bounded follow-up actions are
 *   available for a human/operator to review?
 */

export const CARAVAN_SCHEMA = 'caravan.po-exception-request.v1' as const;
export const CARAVAN_RESULT_SCHEMA = 'caravan.po-exception-result.v1' as const;

export const SHIPMENT_STATUSES = [
  'PLANNED',
  'PICKED_UP',
  'IN_TRANSIT',
  'AT_TERMINAL',
  'CUSTOMS_HOLD',
  'DELIVERED',
  'CANCELLED',
] as const;
export type ShipmentStatus = typeof SHIPMENT_STATUSES[number];

export const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'OK'] as const;
export type ExceptionSeverity = typeof SEVERITIES[number];

export const REASON_CODES = [
  'NO_SHIPMENT',
  'INSUFFICIENT_SHIPMENT_COVERAGE',
  'SHIPMENT_CANCELLED',
  'ETA_UNKNOWN',
  'ETA_AFTER_REQUIRED_BY',
  'PRODUCTION_RUNWAY_BREACH',
  'STALE_TRACKING',
  'MISSING_DOCUMENTS',
] as const;
export type ReasonCode = typeof REASON_CODES[number];

export const ACTION_CODES = [
  'REQUEST_CARRIER_UPDATE',
  'REQUEST_DOCUMENTS',
  'CREATE_SHIPMENT_FOLLOWUP',
  'ESCALATE_SUPPLIER',
  'REVIEW_EXPEDITE',
  'REVIEW_ALTERNATE_INVENTORY',
  'REVIEW_PRODUCTION_SCHEDULE',
] as const;
export type ActionCode = typeof ACTION_CODES[number];

export interface PurchaseOrder {
  poId: string;
  supplierId: string;
  plantId: string;
  materialId: string;
  quantity: number;
  requiredBy: string;
  evidenceRefs: string[];
}

export interface EtaWindow {
  earliest: string;
  latest: string;
}

export interface Shipment {
  shipmentId: string;
  poId: string;
  quantity: number;
  status: ShipmentStatus;
  eta?: EtaWindow;
  lastEventAt: string;
  documentsComplete: boolean;
  evidenceRefs: string[];
}

export interface InventoryState {
  plantId: string;
  materialId: string;
  onHand: number;
  reserved: number;
  safetyStock: number;
  asOf: string;
  evidenceRefs: string[];
}

export interface ProductionDemand {
  plantId: string;
  materialId: string;
  startsAt: string;
  dailyUse: number;
  evidenceRefs: string[];
}

export interface CaravanPolicy {
  trackingStaleAfterHours: number;
}

export interface CaravanRequest {
  schema: typeof CARAVAN_SCHEMA;
  asOf: string;
  purchaseOrders: PurchaseOrder[];
  shipments: Shipment[];
  inventory: InventoryState[];
  production: ProductionDemand[];
  policy: CaravanPolicy;
}

export interface ProductionImpact {
  status: 'MODELLED_THREAT' | 'NO_MODELLED_THREAT' | 'UNKNOWN';
  threatAt?: string;
  usableInventory?: number;
  runwayDays?: number;
  basis: string;
}

export interface CandidateAction {
  code: ActionCode;
  candidateOnly: true;
  rationale: string;
}

export interface PoException {
  poId: string;
  severity: ExceptionSeverity;
  needsAttention: boolean;
  reasons: ReasonCode[];
  shipmentIds: string[];
  outstandingQuantity: number;
  coverageEtaLatest?: string;
  requiredBy: string;
  productionImpact: ProductionImpact;
  evidenceRefs: string[];
  candidateActions: CandidateAction[];
}

export interface CaravanResult {
  schema: typeof CARAVAN_RESULT_SCHEMA;
  asOf: string;
  exceptions: PoException[];
  summary: {
    totalPurchaseOrders: number;
    needsAttention: number;
    critical: number;
    high: number;
    medium: number;
    ok: number;
    productionThreats: number;
  };
  claims: {
    decisionSupportOnly: true;
    executionAuthority: false;
    etaPredictionPerformed: false;
    physicalTruthEstablished: false;
    stateAdmissionPerformed: false;
  };
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MAX_ROWS = 5_000;
const MAX_EVIDENCE_REFS = 64;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/;

function requireObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function id(value: unknown, label: string): string {
  if (typeof value !== 'string' || !ID.test(value)) {
    throw new Error(`${label} must be a bounded identifier`);
  }
  return value;
}

function finiteNonNegative(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e15) {
    throw new Error(`${label} must be a finite non-negative number`);
  }
  return value;
}

function finitePositive(value: unknown, label: string): number {
  const result = finiteNonNegative(value, label);
  if (result <= 0) throw new Error(`${label} must be positive`);
  return result;
}

function instant(value: unknown, label: string): number {
  if (typeof value !== 'string' || value.length > 64) throw new Error(`${label} must be an ISO-8601 timestamp`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be an ISO-8601 timestamp`);
  return parsed;
}

function refs(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > MAX_EVIDENCE_REFS) {
    throw new Error(`${label} must be a bounded evidence-reference array`);
  }
  const result = value.map((item, index) => id(item, `${label}[${index}]`));
  if (new Set(result).size !== result.length) throw new Error(`${label} contains duplicate evidence references`);
  return result;
}

function unique<T>(rows: readonly T[], key: (row: T) => string, label: string): void {
  const seen = new Set<string>();
  for (const row of rows) {
    const value = key(row);
    if (seen.has(value)) throw new Error(`duplicate ${label}: ${value}`);
    seen.add(value);
  }
}

function validateRequest(input: unknown): CaravanRequest {
  requireObject(input, 'request');
  const request = input as unknown as CaravanRequest;
  if (request.schema !== CARAVAN_SCHEMA) throw new Error('unsupported CARAVAN request schema');
  const asOf = instant(request.asOf, 'asOf');

  for (const [label, rows] of [
    ['purchaseOrders', request.purchaseOrders],
    ['shipments', request.shipments],
    ['inventory', request.inventory],
    ['production', request.production],
  ] as const) {
    if (!Array.isArray(rows) || rows.length > MAX_ROWS) throw new Error(`${label} must be an array of at most ${MAX_ROWS} rows`);
  }

  request.purchaseOrders.forEach((po, i) => {
    requireObject(po, `purchaseOrders[${i}]`);
    id(po.poId, 'poId'); id(po.supplierId, 'supplierId'); id(po.plantId, 'plantId'); id(po.materialId, 'materialId');
    finitePositive(po.quantity, 'PO quantity');
    instant(po.requiredBy, 'requiredBy');
    refs(po.evidenceRefs, 'PO evidenceRefs');
  });
  unique(request.purchaseOrders, (row) => row.poId, 'PO identity');

  const poIds = new Set(request.purchaseOrders.map((row) => row.poId));
  request.shipments.forEach((shipment, i) => {
    requireObject(shipment, `shipments[${i}]`);
    id(shipment.shipmentId, 'shipmentId'); id(shipment.poId, 'shipment poId');
    if (!poIds.has(shipment.poId)) throw new Error(`shipment ${shipment.shipmentId} references unknown PO ${shipment.poId}`);
    finitePositive(shipment.quantity, 'shipment quantity');
    if (!SHIPMENT_STATUSES.includes(shipment.status)) throw new Error('unsupported shipment status');
    const lastEvent = instant(shipment.lastEventAt, 'lastEventAt');
    if (lastEvent > asOf) throw new Error('shipment lastEventAt cannot be later than request asOf');
    if (typeof shipment.documentsComplete !== 'boolean') throw new Error('documentsComplete must be boolean');
    refs(shipment.evidenceRefs, 'shipment evidenceRefs');
    if (shipment.eta !== undefined) {
      requireObject(shipment.eta, 'eta');
      const earliest = instant(shipment.eta.earliest, 'eta.earliest');
      const latest = instant(shipment.eta.latest, 'eta.latest');
      if (earliest > latest) throw new Error('eta earliest cannot be after latest');
    }
  });
  unique(request.shipments, (row) => row.shipmentId, 'shipment identity');

  request.inventory.forEach((row, i) => {
    requireObject(row, `inventory[${i}]`);
    id(row.plantId, 'inventory plantId'); id(row.materialId, 'inventory materialId');
    finiteNonNegative(row.onHand, 'onHand'); finiteNonNegative(row.reserved, 'reserved'); finiteNonNegative(row.safetyStock, 'safetyStock');
    const inventoryAsOf = instant(row.asOf, 'inventory asOf');
    if (inventoryAsOf > asOf) throw new Error('inventory asOf cannot be later than request asOf');
    refs(row.evidenceRefs, 'inventory evidenceRefs');
  });
  unique(request.inventory, (row) => `${row.plantId}|${row.materialId}`, 'inventory plant/material');

  request.production.forEach((row, i) => {
    requireObject(row, `production[${i}]`);
    id(row.plantId, 'production plantId'); id(row.materialId, 'production materialId');
    instant(row.startsAt, 'production startsAt');
    finitePositive(row.dailyUse, 'dailyUse');
    refs(row.evidenceRefs, 'production evidenceRefs');
  });
  unique(request.production, (row) => `${row.plantId}|${row.materialId}`, 'production plant/material');

  requireObject(request.policy, 'policy');
  finitePositive(request.policy.trackingStaleAfterHours, 'trackingStaleAfterHours');
  if (request.policy.trackingStaleAfterHours > 24 * 30) throw new Error('trackingStaleAfterHours exceeds 30-day policy bound');

  return structuredClone(request);
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function severityRank(value: ExceptionSeverity): number {
  return { CRITICAL: 0, HIGH: 1, MEDIUM: 2, OK: 3 }[value];
}

function buildProductionImpact(
  asOf: number,
  _po: PurchaseOrder,
  inventory: InventoryState | undefined,
  production: ProductionDemand | undefined,
  coverageEtaLatest: number | undefined,
): ProductionImpact {
  if (!inventory || !production) {
    return {
      status: 'UNKNOWN',
      basis: 'No unique declared inventory and production-demand pair was supplied for this plant/material.',
    };
  }
  const usableInventory = Math.max(0, inventory.onHand - inventory.reserved - inventory.safetyStock);
  const runwayDays = usableInventory / production.dailyUse;
  const demandStart = Math.max(asOf, Date.parse(production.startsAt));
  const threatAt = demandStart + runwayDays * DAY_MS;

  if (coverageEtaLatest !== undefined && coverageEtaLatest > threatAt) {
    return {
      status: 'MODELLED_THREAT',
      threatAt: iso(threatAt),
      usableInventory,
      runwayDays,
      basis: 'Declared usable inventory divided by declared daily use is exhausted before the latest ETA needed to cover the PO.',
    };
  }
  return {
    status: 'NO_MODELLED_THREAT',
    threatAt: iso(threatAt),
    usableInventory,
    runwayDays,
    basis: coverageEtaLatest === undefined
      ? 'A production runway was computed, but no complete inbound ETA coverage is available to compare against it.'
      : 'The latest ETA needed for declared shipment coverage does not exceed the modeled inventory-runway threshold.',
  };
}

function addAction(map: Map<ActionCode, CandidateAction>, code: ActionCode, rationale: string): void {
  if (!map.has(code)) map.set(code, { code, candidateOnly: true, rationale });
}

export function evaluatePoExceptions(input: unknown): CaravanResult {
  const request = validateRequest(input);
  const asOf = Date.parse(request.asOf);
  const staleMs = request.policy.trackingStaleAfterHours * HOUR_MS;

  const inventoryByKey = new Map(request.inventory.map((row) => [`${row.plantId}|${row.materialId}`, row]));
  const productionByKey = new Map(request.production.map((row) => [`${row.plantId}|${row.materialId}`, row]));
  const shipmentsByPo = new Map<string, Shipment[]>();
  for (const shipment of request.shipments) {
    const rows = shipmentsByPo.get(shipment.poId) ?? [];
    rows.push(shipment);
    shipmentsByPo.set(shipment.poId, rows);
  }

  const exceptions: PoException[] = request.purchaseOrders.map((po) => {
    const shipments = [...(shipmentsByPo.get(po.poId) ?? [])].sort((a, b) => a.shipmentId.localeCompare(b.shipmentId));
    const delivered = shipments.filter((row) => row.status === 'DELIVERED').reduce((sum, row) => sum + row.quantity, 0);
    const active = shipments.filter((row) => !['DELIVERED', 'CANCELLED'].includes(row.status));
    const cancelled = shipments.filter((row) => row.status === 'CANCELLED');
    const outstandingQuantity = Math.max(0, po.quantity - delivered);

    const reasons = new Set<ReasonCode>();
    if (outstandingQuantity > 0 && shipments.length === 0) reasons.add('NO_SHIPMENT');
    if (cancelled.length > 0 && outstandingQuantity > 0) reasons.add('SHIPMENT_CANCELLED');

    const orderedActive = [...active].sort((a, b) => {
      const aEta = a.eta ? Date.parse(a.eta.latest) : Number.POSITIVE_INFINITY;
      const bEta = b.eta ? Date.parse(b.eta.latest) : Number.POSITIVE_INFINITY;
      return aEta - bEta || a.shipmentId.localeCompare(b.shipmentId);
    });

    let covered = delivered;
    let coverageEtaLatest: number | undefined;
    let neededEtaUnknown = false;
    for (const shipment of orderedActive) {
      if (covered >= po.quantity) break;
      covered += shipment.quantity;
      if (shipment.eta) {
        coverageEtaLatest = Math.max(coverageEtaLatest ?? Number.NEGATIVE_INFINITY, Date.parse(shipment.eta.latest));
      } else {
        neededEtaUnknown = true;
      }
    }

    if (outstandingQuantity > 0 && covered < po.quantity) reasons.add('INSUFFICIENT_SHIPMENT_COVERAGE');
    if (outstandingQuantity > 0 && neededEtaUnknown) reasons.add('ETA_UNKNOWN');
    if (coverageEtaLatest !== undefined && coverageEtaLatest > Date.parse(po.requiredBy)) {
      reasons.add('ETA_AFTER_REQUIRED_BY');
    }

    for (const shipment of active) {
      if (asOf - Date.parse(shipment.lastEventAt) > staleMs) reasons.add('STALE_TRACKING');
      if (!shipment.documentsComplete) reasons.add('MISSING_DOCUMENTS');
    }

    const key = `${po.plantId}|${po.materialId}`;
    const productionImpact = buildProductionImpact(
      asOf,
      po,
      inventoryByKey.get(key),
      productionByKey.get(key),
      coverageEtaLatest,
    );
    if (productionImpact.status === 'MODELLED_THREAT') reasons.add('PRODUCTION_RUNWAY_BREACH');

    let severity: ExceptionSeverity = 'OK';
    if (reasons.has('PRODUCTION_RUNWAY_BREACH')) severity = 'CRITICAL';
    else if (reasons.has('NO_SHIPMENT') || reasons.has('INSUFFICIENT_SHIPMENT_COVERAGE') || reasons.has('SHIPMENT_CANCELLED') || reasons.has('ETA_AFTER_REQUIRED_BY')) severity = 'HIGH';
    else if (reasons.has('ETA_UNKNOWN') || reasons.has('STALE_TRACKING') || reasons.has('MISSING_DOCUMENTS')) severity = 'MEDIUM';

    const actions = new Map<ActionCode, CandidateAction>();
    if (reasons.has('STALE_TRACKING') || reasons.has('ETA_UNKNOWN')) {
      addAction(actions, 'REQUEST_CARRIER_UPDATE', 'Tracking or ETA evidence is incomplete/stale.');
    }
    if (reasons.has('MISSING_DOCUMENTS')) {
      addAction(actions, 'REQUEST_DOCUMENTS', 'One or more active shipments are declared document-incomplete.');
    }
    if (reasons.has('NO_SHIPMENT') || reasons.has('INSUFFICIENT_SHIPMENT_COVERAGE')) {
      addAction(actions, 'CREATE_SHIPMENT_FOLLOWUP', 'Declared shipment quantity does not fully cover the outstanding PO quantity.');
      addAction(actions, 'ESCALATE_SUPPLIER', 'Supplier follow-up is a candidate because the declared PO is not fully covered by shipments.');
    }
    if (reasons.has('SHIPMENT_CANCELLED') || reasons.has('ETA_AFTER_REQUIRED_BY')) {
      addAction(actions, 'ESCALATE_SUPPLIER', 'A cancellation or required-date miss is declared.');
      addAction(actions, 'REVIEW_EXPEDITE', 'Review whether expediting is commercially/operationally justified; no expedite is authorized here.');
    }
    if (reasons.has('PRODUCTION_RUNWAY_BREACH')) {
      addAction(actions, 'REVIEW_EXPEDITE', 'Inbound coverage arrives after the modeled inventory-runway threshold.');
      addAction(actions, 'REVIEW_ALTERNATE_INVENTORY', 'Review alternate internal/external inventory; compatibility and availability are not established here.');
      addAction(actions, 'REVIEW_PRODUCTION_SCHEDULE', 'Review production sequencing against the modeled material shortage window.');
    }

    const evidenceRefs = [...new Set([
      ...po.evidenceRefs,
      ...shipments.flatMap((row) => row.evidenceRefs),
      ...(inventoryByKey.get(key)?.evidenceRefs ?? []),
      ...(productionByKey.get(key)?.evidenceRefs ?? []),
    ])].sort();

    return {
      poId: po.poId,
      severity,
      needsAttention: severity !== 'OK',
      reasons: [...reasons].sort(),
      shipmentIds: shipments.map((row) => row.shipmentId),
      outstandingQuantity,
      ...(coverageEtaLatest !== undefined ? { coverageEtaLatest: iso(coverageEtaLatest) } : {}),
      requiredBy: new Date(Date.parse(po.requiredBy)).toISOString(),
      productionImpact,
      evidenceRefs,
      candidateActions: [...actions.values()].sort((a, b) => a.code.localeCompare(b.code)),
    };
  });

  exceptions.sort((a, b) =>
    severityRank(a.severity) - severityRank(b.severity)
    || (a.productionImpact.threatAt ?? '9999').localeCompare(b.productionImpact.threatAt ?? '9999')
    || a.poId.localeCompare(b.poId));

  return {
    schema: CARAVAN_RESULT_SCHEMA,
    asOf: new Date(asOf).toISOString(),
    exceptions,
    summary: {
      totalPurchaseOrders: exceptions.length,
      needsAttention: exceptions.filter((row) => row.needsAttention).length,
      critical: exceptions.filter((row) => row.severity === 'CRITICAL').length,
      high: exceptions.filter((row) => row.severity === 'HIGH').length,
      medium: exceptions.filter((row) => row.severity === 'MEDIUM').length,
      ok: exceptions.filter((row) => row.severity === 'OK').length,
      productionThreats: exceptions.filter((row) => row.productionImpact.status === 'MODELLED_THREAT').length,
    },
    claims: {
      decisionSupportOnly: true,
      executionAuthority: false,
      etaPredictionPerformed: false,
      physicalTruthEstablished: false,
      stateAdmissionPerformed: false,
    },
  };
}
