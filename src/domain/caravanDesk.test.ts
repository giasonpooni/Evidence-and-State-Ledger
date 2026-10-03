import { describe, expect, it } from 'vitest';
import {
  CARAVAN_SCHEMA,
  evaluatePoExceptions,
  type CaravanRequest,
} from './caravanDesk';

const ref = (id: string) => `notation://evidence/fixture/${id}`;

function base(): CaravanRequest {
  return {
    schema: CARAVAN_SCHEMA,
    asOf: '2026-09-29T12:00:00Z',
    policy: { trackingStaleAfterHours: 24 },
    purchaseOrders: [{
      poId: 'PO-100',
      supplierId: 'supplier-a',
      plantId: 'plant-4',
      materialId: 'pp-homopolymer',
      quantity: 100,
      requiredBy: '2026-10-02T12:00:00Z',
      evidenceRefs: [ref('po-100')],
    }],
    shipments: [{
      shipmentId: 'SHIP-100',
      poId: 'PO-100',
      quantity: 100,
      status: 'IN_TRANSIT',
      eta: {
        earliest: '2026-10-01T12:00:00Z',
        latest: '2026-10-01T18:00:00Z',
      },
      lastEventAt: '2026-09-29T10:00:00Z',
      documentsComplete: true,
      evidenceRefs: [ref('ship-100')],
    }],
    inventory: [{
      plantId: 'plant-4',
      materialId: 'pp-homopolymer',
      onHand: 500,
      reserved: 0,
      safetyStock: 100,
      asOf: '2026-09-29T12:00:00Z',
      evidenceRefs: [ref('inventory-1')],
    }],
    production: [{
      plantId: 'plant-4',
      materialId: 'pp-homopolymer',
      startsAt: '2026-09-29T12:00:00Z',
      dailyUse: 50,
      evidenceRefs: [ref('schedule-1')],
    }],
  };
}

describe('CARAVAN PO exception evaluation', () => {
  it('returns OK when declared inbound coverage meets date and runway', () => {
    const result = evaluatePoExceptions(base());
    expect(result.summary).toEqual({
      totalPurchaseOrders: 1,
      needsAttention: 0,
      critical: 0,
      high: 0,
      medium: 0,
      ok: 1,
      productionThreats: 0,
    });
    expect(result.exceptions[0].severity).toBe('OK');
    expect(result.claims.executionAuthority).toBe(false);
  });

  it('marks a modeled production-runway breach CRITICAL', () => {
    const request = base();
    request.inventory[0].onHand = 150;
    request.inventory[0].safetyStock = 100;
    request.shipments[0].eta = {
      earliest: '2026-10-02T12:00:00Z',
      latest: '2026-10-03T12:00:00Z',
    };
    const row = evaluatePoExceptions(request).exceptions[0];
    expect(row.severity).toBe('CRITICAL');
    expect(row.reasons).toContain('PRODUCTION_RUNWAY_BREACH');
    expect(row.productionImpact.status).toBe('MODELLED_THREAT');
    expect(row.candidateActions.map((item) => item.code)).toEqual(expect.arrayContaining([
      'REVIEW_EXPEDITE',
      'REVIEW_ALTERNATE_INVENTORY',
      'REVIEW_PRODUCTION_SCHEDULE',
    ]));
    expect(row.candidateActions.every((item) => item.candidateOnly)).toBe(true);
  });

  it('marks required-date miss HIGH when inventory runway is sufficient', () => {
    const request = base();
    request.shipments[0].eta = {
      earliest: '2026-10-03T12:00:00Z',
      latest: '2026-10-03T18:00:00Z',
    };
    request.inventory[0].onHand = 10_000;
    const row = evaluatePoExceptions(request).exceptions[0];
    expect(row.severity).toBe('HIGH');
    expect(row.reasons).toContain('ETA_AFTER_REQUIRED_BY');
    expect(row.reasons).not.toContain('PRODUCTION_RUNWAY_BREACH');
  });

  it('marks stale tracking and missing documents MEDIUM', () => {
    const request = base();
    request.shipments[0].lastEventAt = '2026-09-27T00:00:00Z';
    request.shipments[0].documentsComplete = false;
    const row = evaluatePoExceptions(request).exceptions[0];
    expect(row.severity).toBe('MEDIUM');
    expect(row.reasons).toEqual(expect.arrayContaining(['MISSING_DOCUMENTS', 'STALE_TRACKING']));
    expect(row.candidateActions.map((item) => item.code)).toEqual(expect.arrayContaining([
      'REQUEST_CARRIER_UPDATE',
      'REQUEST_DOCUMENTS',
    ]));
  });

  it('supports split shipment coverage and uses the ETA needed to cover the PO', () => {
    const request = base();
    request.shipments = [
      { ...request.shipments[0], shipmentId: 'SHIP-A', quantity: 60, eta: { earliest: '2026-10-01T00:00:00Z', latest: '2026-10-01T06:00:00Z' } },
      { ...request.shipments[0], shipmentId: 'SHIP-B', quantity: 40, eta: { earliest: '2026-10-02T00:00:00Z', latest: '2026-10-02T06:00:00Z' } },
    ];
    const row = evaluatePoExceptions(request).exceptions[0];
    expect(row.outstandingQuantity).toBe(100);
    expect(row.coverageEtaLatest).toBe('2026-10-02T06:00:00.000Z');
    expect(row.reasons).not.toContain('INSUFFICIENT_SHIPMENT_COVERAGE');
  });

  it('retains incomplete shipment coverage instead of inventing an ETA', () => {
    const request = base();
    request.shipments[0].quantity = 40;
    const row = evaluatePoExceptions(request).exceptions[0];
    expect(row.severity).toBe('HIGH');
    expect(row.reasons).toContain('INSUFFICIENT_SHIPMENT_COVERAGE');
    expect(row.candidateActions.map((item) => item.code)).toContain('CREATE_SHIPMENT_FOLLOWUP');
  });

  it('marks a missing shipment as a concrete exception', () => {
    const request = base();
    request.shipments = [];
    const row = evaluatePoExceptions(request).exceptions[0];
    expect(row.severity).toBe('HIGH');
    expect(row.reasons).toContain('NO_SHIPMENT');
    expect(row.productionImpact.status).toBe('NO_MODELLED_THREAT');
  });

  it('retains production impact as UNKNOWN when no inventory/schedule pair exists', () => {
    const request = base();
    request.inventory = [];
    request.production = [];
    const row = evaluatePoExceptions(request).exceptions[0];
    expect(row.productionImpact.status).toBe('UNKNOWN');
    expect(row.productionImpact.basis).toMatch(/No unique declared inventory/);
  });

  it('does not mutate caller input', () => {
    const request = base();
    const before = JSON.stringify(request);
    evaluatePoExceptions(request);
    expect(JSON.stringify(request)).toBe(before);
  });

  it('refuses shipments that reference an unknown PO', () => {
    const request = base();
    request.shipments[0].poId = 'PO-missing';
    expect(() => evaluatePoExceptions(request)).toThrow(/unknown PO/);
  });

  it('refuses duplicate operational identities', () => {
    const request = base();
    request.purchaseOrders.push({ ...request.purchaseOrders[0] });
    expect(() => evaluatePoExceptions(request)).toThrow(/duplicate PO identity/);
  });

  it('refuses future-dated carrier events relative to the decision cutoff', () => {
    const request = base();
    request.shipments[0].lastEventAt = '2026-09-30T00:00:00Z';
    expect(() => evaluatePoExceptions(request)).toThrow(/later than request asOf/);
  });
});
