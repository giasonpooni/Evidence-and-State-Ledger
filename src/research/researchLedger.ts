/**
 * Cross-repository research ledger for the Notation Systems research programme.
 *
 * This module tracks evidence about architectural/research claims. It is not
 * scientific truth, peer review, state admission, or an automatic axiom engine.
 */

export const RESEARCH_LEDGER_SCHEMA = 'notations.research-ledger.v1' as const;

export const RECORD_KINDS = [
  'HYPOTHESIS',
  'EXPERIMENT',
  'OBSERVATION',
  'COUNTEREXAMPLE',
  'PATTERN',
  'PRINCIPLE',
  'PROPOSITION',
  'AXIOM',
  'THEOREM',
] as const;
export type RecordKind = typeof RECORD_KINDS[number];

export const STATUSES = [
  'OPEN',
  'CANDIDATE',
  'SUPPORTED',
  'CHALLENGED',
  'REFINED',
  'REJECTED',
  'FORMALIZED',
  'PROVED',
] as const;
export type ResearchStatus = typeof STATUSES[number];

export const RELATIONS = [
  'TESTS',
  'OBSERVES',
  'SUPPORTS',
  'CHALLENGES',
  'COUNTEREXAMPLE_TO',
  'MOTIVATES',
  'REFINES',
  'FORMALIZES',
  'DEPENDS_ON',
] as const;
export type RelationKind = typeof RELATIONS[number];

export interface RepositoryRef {
  repository: string;
  revision: string;
  path?: string;
  workflowRun?: string;
  pullRequest?: string;
}

export interface ResearchRecord {
  id: string;
  kind: RecordKind;
  title: string;
  statement: string;
  status: ResearchStatus;
  domains: string[];
  testCorpus: string[];
  repositoryRefs: RepositoryRef[];
  evidenceRefs: string[];
  notes: string;
}

export interface ResearchRelation {
  relationId: string;
  source: string;
  target: string;
  kind: RelationKind;
  notes: string;
}

export interface ResearchLedger {
  schema: typeof RESEARCH_LEDGER_SCHEMA;
  programme: {
    name: string;
    question: string;
    method: string;
  };
  records: ResearchRecord[];
  relations: ResearchRelation[];
  claims: {
    researchMetadataOnly: true;
    scientificTruthEstablished: false;
    peerReviewPerformed: false;
    automaticPromotionToAxiom: false;
  };
}

const MAX_RECORDS = 4096;
const MAX_RELATIONS = 16384;
const MAX_REFS = 128;
const RECORD_ID = /^(H|E|O|CE|PT|P|PROP|AX|TH)-[0-9]{3,6}$/;
const RELATION_ID = /^R-[0-9]{3,6}$/;
const REVISION = /^[0-9a-f]{7,64}$/i;

function requireObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function boundedText(value: unknown, label: string, limit = 8192): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > limit) {
    throw new Error(`${label} must be bounded nonempty text`);
  }
  return value;
}

function boundedOptionalText(value: unknown, label: string, limit = 8192): string {
  if (typeof value !== 'string' || value.length > limit) {
    throw new Error(`${label} must be bounded text`);
  }
  return value;
}

function uniqueStrings(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > MAX_REFS) {
    throw new Error(`${label} must be a bounded array`);
  }
  const result = value.map((item, index) => boundedText(item, `${label}[${index}]`, 512));
  if (new Set(result).size !== result.length) throw new Error(`${label} contains duplicates`);
  return result;
}

function recordPrefix(kind: RecordKind): string {
  return {
    HYPOTHESIS: 'H',
    EXPERIMENT: 'E',
    OBSERVATION: 'O',
    COUNTEREXAMPLE: 'CE',
    PATTERN: 'PT',
    PRINCIPLE: 'P',
    PROPOSITION: 'PROP',
    AXIOM: 'AX',
    THEOREM: 'TH',
  }[kind];
}

function validateRepoRef(value: unknown, label: string): RepositoryRef {
  requireObject(value, label);
  const allowed = new Set(['repository', 'revision', 'path', 'workflowRun', 'pullRequest']);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new Error(`${label} has unexpected fields`);
  }
  const repository = boundedText(value.repository, `${label}.repository`, 256);
  const revision = boundedText(value.revision, `${label}.revision`, 64);
  if (!REVISION.test(revision)) throw new Error(`${label}.revision must be an exact commit-like hex revision`);
  const result: RepositoryRef = { repository, revision: revision.toLowerCase() };
  if (value.path !== undefined) result.path = boundedText(value.path, `${label}.path`, 1024);
  if (value.workflowRun !== undefined) result.workflowRun = boundedText(value.workflowRun, `${label}.workflowRun`, 128);
  if (value.pullRequest !== undefined) result.pullRequest = boundedText(value.pullRequest, `${label}.pullRequest`, 128);
  return result;
}

function validateRecord(value: unknown, index: number): ResearchRecord {
  requireObject(value, `records[${index}]`);
  const expected = new Set(['id', 'kind', 'title', 'statement', 'status', 'domains', 'testCorpus', 'repositoryRefs', 'evidenceRefs', 'notes']);
  if (Object.keys(value).length !== expected.size || Object.keys(value).some((key) => !expected.has(key))) {
    throw new Error(`records[${index}] has unexpected/missing fields`);
  }
  const kind = value.kind as RecordKind;
  if (!RECORD_KINDS.includes(kind)) throw new Error(`records[${index}].kind is unknown`);
  const id = boundedText(value.id, `records[${index}].id`, 32);
  if (!RECORD_ID.test(id) || !id.startsWith(recordPrefix(kind) + '-')) {
    throw new Error(`records[${index}].id prefix does not match kind`);
  }
  const status = value.status as ResearchStatus;
  if (!STATUSES.includes(status)) throw new Error(`records[${index}].status is unknown`);
  if ((kind === 'AXIOM' || kind === 'THEOREM') && status !== 'PROVED' && status !== 'FORMALIZED') {
    throw new Error(`${kind} records require FORMALIZED or PROVED status; frequency alone cannot promote a claim`);
  }
  if (kind === 'THEOREM' && status !== 'PROVED') {
    throw new Error('THEOREM records require PROVED status');
  }
  const repositoryRefs = value.repositoryRefs;
  if (!Array.isArray(repositoryRefs) || repositoryRefs.length > MAX_REFS) {
    throw new Error(`records[${index}].repositoryRefs must be bounded`);
  }
  return {
    id,
    kind,
    title: boundedText(value.title, `records[${index}].title`, 512),
    statement: boundedText(value.statement, `records[${index}].statement`),
    status,
    domains: uniqueStrings(value.domains, `records[${index}].domains`),
    testCorpus: uniqueStrings(value.testCorpus, `records[${index}].testCorpus`),
    repositoryRefs: repositoryRefs.map((row, i) => validateRepoRef(row, `records[${index}].repositoryRefs[${i}]`)),
    evidenceRefs: uniqueStrings(value.evidenceRefs, `records[${index}].evidenceRefs`),
    notes: boundedOptionalText(value.notes, `records[${index}].notes`),
  };
}

export function validateResearchLedger(input: unknown): ResearchLedger {
  requireObject(input, 'ledger');
  const expected = new Set(['schema', 'programme', 'records', 'relations', 'claims']);
  if (Object.keys(input).length !== expected.size || Object.keys(input).some((key) => !expected.has(key))) {
    throw new Error('ledger has unexpected/missing fields');
  }
  if (input.schema !== RESEARCH_LEDGER_SCHEMA) throw new Error('unsupported research ledger schema');

  requireObject(input.programme, 'programme');
  const programmeExpected = new Set(['name', 'question', 'method']);
  if (Object.keys(input.programme).length !== programmeExpected.size || Object.keys(input.programme).some((key) => !programmeExpected.has(key))) {
    throw new Error('programme has unexpected/missing fields');
  }
  const programme = {
    name: boundedText(input.programme.name, 'programme.name', 512),
    question: boundedText(input.programme.question, 'programme.question', 8192),
    method: boundedText(input.programme.method, 'programme.method', 8192),
  };

  if (!Array.isArray(input.records) || input.records.length === 0 || input.records.length > MAX_RECORDS) {
    throw new Error('ledger requires 1..4096 research records');
  }
  const records = input.records.map(validateRecord);
  const recordIds = records.map((row) => row.id);
  if (new Set(recordIds).size !== recordIds.length) throw new Error('duplicate research record id');
  const byId = new Map(records.map((row) => [row.id, row]));

  if (!Array.isArray(input.relations) || input.relations.length > MAX_RELATIONS) {
    throw new Error('relations must be a bounded array');
  }
  const relationIds = new Set<string>();
  const relations: ResearchRelation[] = input.relations.map((value, index) => {
    requireObject(value, `relations[${index}]`);
    const relationExpected = new Set(['relationId', 'source', 'target', 'kind', 'notes']);
    if (Object.keys(value).length !== relationExpected.size || Object.keys(value).some((key) => !relationExpected.has(key))) {
      throw new Error(`relations[${index}] has unexpected/missing fields`);
    }
    const relationId = boundedText(value.relationId, `relations[${index}].relationId`, 32);
    if (!RELATION_ID.test(relationId) || relationIds.has(relationId)) throw new Error('invalid/duplicate relation id');
    relationIds.add(relationId);
    const source = boundedText(value.source, `relations[${index}].source`, 32);
    const target = boundedText(value.target, `relations[${index}].target`, 32);
    if (!byId.has(source) || !byId.has(target) || source === target) throw new Error('research relation endpoint missing/self-referential');
    const kind = value.kind as RelationKind;
    if (!RELATIONS.includes(kind)) throw new Error('unknown research relation kind');
    return {
      relationId,
      source,
      target,
      kind,
      notes: boundedOptionalText(value.notes, `relations[${index}].notes`),
    };
  });

  requireObject(input.claims, 'claims');
  const claims = {
    researchMetadataOnly: true,
    scientificTruthEstablished: false,
    peerReviewPerformed: false,
    automaticPromotionToAxiom: false,
  } as const;
  if (JSON.stringify(input.claims) !== JSON.stringify(claims)) {
    throw new Error('research ledger claims exceed metadata authority');
  }

  return structuredClone({
    schema: RESEARCH_LEDGER_SCHEMA,
    programme,
    records,
    relations,
    claims,
  });
}

export interface CoverageSummary {
  recordId: string;
  recordKind: RecordKind;
  status: ResearchStatus;
  declaredCorpus: string[];
  testedDomains: string[];
  empiricalCoverage: number | null;
  supportingRelations: number;
  challengingRelations: number;
  counterexamples: number;
}

export function summarizeResearchLedger(input: unknown) {
  const ledger = validateResearchLedger(input);
  const byId = new Map(ledger.records.map((row) => [row.id, row]));

  const coverage: CoverageSummary[] = ledger.records
    .filter((row) => ['HYPOTHESIS', 'PATTERN', 'PRINCIPLE', 'PROPOSITION'].includes(row.kind))
    .map((row) => {
      const directTests = ledger.relations.filter((relation) =>
        relation.kind === 'TESTS' && relation.target === row.id
      );
      const testedDomains = [...new Set(directTests.flatMap((relation) => {
        const source = byId.get(relation.source);
        return source?.kind === 'EXPERIMENT' ? source.domains : [];
      }))].sort();
      const declared = row.testCorpus;
      const empiricalCoverage = declared.length === 0
        ? null
        : declared.filter((domain) => testedDomains.includes(domain)).length / declared.length;
      return {
        recordId: row.id,
        recordKind: row.kind,
        status: row.status,
        declaredCorpus: [...declared],
        testedDomains,
        empiricalCoverage,
        supportingRelations: ledger.relations.filter((r) => r.target === row.id && r.kind === 'SUPPORTS').length,
        challengingRelations: ledger.relations.filter((r) => r.target === row.id && r.kind === 'CHALLENGES').length,
        counterexamples: ledger.relations.filter((r) => r.target === row.id && r.kind === 'COUNTEREXAMPLE_TO').length,
      };
    });

  return {
    schema: 'notations.research-ledger-summary.v1',
    programme: ledger.programme,
    recordCounts: Object.fromEntries(RECORD_KINDS.map((kind) => [
      kind,
      ledger.records.filter((row) => row.kind === kind).length,
    ])),
    relationCounts: Object.fromEntries(RELATIONS.map((kind) => [
      kind,
      ledger.relations.filter((row) => row.kind === kind).length,
    ])),
    coverage,
    claims: {
      empiricalCoverageIsNotUniversalityProof: true,
      automaticPromotionToAxiom: false,
      scientificTruthEstablished: false,
    },
  };
}
