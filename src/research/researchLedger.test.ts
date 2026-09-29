import { describe, expect, it } from 'vitest';
import { summarizeResearchLedger, validateResearchLedger, type ResearchLedger } from './researchLedger';
import ledger from '../../research/ledger.json';

function clone(): ResearchLedger {
  return structuredClone(ledger) as ResearchLedger;
}

describe('Notation Systems research ledger', () => {
  it('validates the committed cross-repository research graph', () => {
    const value = validateResearchLedger(clone());
    expect(value.schema).toBe('notations.research-ledger.v1');
    expect(value.claims.scientificTruthEstablished).toBe(false);
    expect(value.claims.automaticPromotionToAxiom).toBe(false);
  });

  it('separates experiments from principles and formal claims', () => {
    const value = validateResearchLedger(clone());
    expect(value.records.some((row) => row.kind === 'EXPERIMENT')).toBe(true);
    expect(value.records.some((row) => row.kind === 'PRINCIPLE')).toBe(true);
    expect(value.records.some((row) => row.kind === 'AXIOM')).toBe(false);
    expect(value.records.some((row) => row.kind === 'THEOREM')).toBe(false);
  });

  it('computes empirical domain coverage without calling it universality', () => {
    const summary = summarizeResearchLedger(clone());
    const principle = summary.coverage.find((row) => row.recordId === 'P-001');
    expect(principle).toBeDefined();
    expect(principle!.empiricalCoverage).not.toBeNull();
    expect(summary.claims.empiricalCoverageIsNotUniversalityProof).toBe(true);
  });

  it('retains a rejected over-generalization and its counterexample', () => {
    const value = validateResearchLedger(clone());
    const claim = value.records.find((row) => row.id === 'H-004');
    expect(claim?.status).toBe('REJECTED');
    expect(value.relations.some((row) =>
      row.kind === 'COUNTEREXAMPLE_TO' && row.target === 'H-004'
    )).toBe(true);
  });

  it('does not allow a theorem to be merely candidate', () => {
    const value = clone();
    value.records.push({
      id: 'TH-001',
      kind: 'THEOREM',
      title: 'Bad theorem',
      statement: 'Unproved theorem.',
      status: 'CANDIDATE',
      domains: [],
      testCorpus: [],
      repositoryRefs: [],
      evidenceRefs: [],
      notes: '',
    });
    expect(() => validateResearchLedger(value)).toThrow(/THEOREM|FORMALIZED|PROVED/);
  });

  it('does not allow an axiom to be auto-promoted from frequency', () => {
    const value = clone();
    value.records.push({
      id: 'AX-001',
      kind: 'AXIOM',
      title: 'Bad axiom',
      statement: 'Frequent pattern treated as axiom.',
      status: 'SUPPORTED',
      domains: ['test'],
      testCorpus: ['test'],
      repositoryRefs: [],
      evidenceRefs: [],
      notes: '',
    });
    expect(() => validateResearchLedger(value)).toThrow(/AXIOM/);
  });

  it('refuses dangling research relations', () => {
    const value = clone();
    value.relations.push({
      relationId: 'R-999',
      source: 'E-001',
      target: 'P-999',
      kind: 'TESTS',
      notes: '',
    });
    expect(() => validateResearchLedger(value)).toThrow(/endpoint/);
  });

  it('refuses duplicate research identities', () => {
    const value = clone();
    value.records.push(structuredClone(value.records[0]));
    expect(() => validateResearchLedger(value)).toThrow(/duplicate research record/);
  });

  it('requires exact repository revisions rather than branch names', () => {
    const value = clone();
    value.records[0].repositoryRefs[0].revision = 'main';
    expect(() => validateResearchLedger(value)).toThrow(/exact commit-like/);
  });
});
