/**
 * Server-side inspection of a CIW replay as candidate evidence. This module
 * deliberately has no store, corpus writer, domain-identity resolver or release
 * command. A recomputed numerical result is not a scalar corpus assertion.
 */
import { byteDigest, captureEvidence } from './evidence-capture';
import type { ContentAddressedStore, EvidenceCaptureResult, SourceRegistration, SourceUseDecision } from './contracts';
import { encodeLocalRecord, localJson, localRecordDigest } from './local-record';
import { evaluateSourceUse } from './source-policy';
import { parseISOInstant, requireIdentifier, requireText } from './validation';
import { recomputeInstrumentReplay, type InstrumentRuntime, type ReplayBinding } from './instrument-result-verifier';

const METHOD = 'notationsos.instrument-candidate-inspection.v1';
const MAX_PROJECTION_BYTES = 8 * 1024 * 1024;

export interface InstrumentSourcePolicy {
  /** Explicit source-policy mapping; never inferred from a filename or a URI. */
  registration: SourceRegistration;
  evidence: readonly { artifactRef: string; digest: string }[];
}

export interface InstrumentRetraction {
  retractionId: string;
  targetKind: 'EVIDENCE' | 'BUNDLE' | 'NUMERICAL_RESULT' | 'VERIFICATION';
  targetId: string;
  /** Required for verification withdrawals: rerunning may not revive its subject. */
  subjectBundleDigest?: string;
  knownAt: string;
  authority: string;
  reason: string;
}

export interface InstrumentReviewContext {
  requestId: string;
  authority: string;
  purpose: string;
  /** Operator-declared policies, not permissions provided by the instrument. */
  sources: readonly InstrumentSourcePolicy[];
  /** Supplied knowledge-time history; absence does not establish completeness. */
  retractions: readonly InstrumentRetraction[];
}

export interface InstrumentCandidateInspection {
  schema: 'payload.instrument-candidate-inspection.v1';
  method: typeof METHOD;
  requestId: string;
  inspectedAt: string;
  authority: string;
  bundleBytesDigest: string;
  contextDigest: string;
  state: 'ELIGIBLE_FOR_CANDIDATE_REVIEW' | 'REFUSED';
  candidate: null | {
    kind: 'INSTRUMENT_RESULT';
    state: 'UNADMITTED';
    bundleDigest: string;
    evidenceDigests: string[];
    evidence: ReplayBinding['evidence'];
    operationPins: ReplayBinding['operationPins'];
    executionIds: string[];
    numericalResultIds: string[];
    runtimePins: ReplayBinding['runtimePins'];
    interpreterSha256: string;
    reconciliation: ReplayBinding['reconciliation'];
    processAssessment?: ReplayBinding['processAssessment'];
    verification: ReplayBinding['verification'];
  };
  policyDecisions: SourceUseDecision[];
  applicableRetractions: InstrumentRetraction[];
  reasons: string[];
  canonicalAdmission: 'REFUSED';
  canonicalAdmissionReason: 'DOMAIN_ASSERTION_IDENTITY_CLOCKS_AND_EVIDENCE_CLASS_NOT_ESTABLISHED';
  canonicalStateMutated: false;
  evidenceRetained: false;
  releaseActivated: false;
  sourceTruthClaimed: false;
  cseDisposition: 'NOT_EVALUATED';
  independentlyVerified: false;
  retractionHistoryComplete: false;
  digest: string;
}

function digest(value: string): void {
  if (!/^sha256:[a-f0-9]{64}$/.test(value)) throw new Error('Expected a sha256 evidence digest.');
}

function authority(value: string): void {
  requireIdentifier(value, 'authority');
  if (!/^(role|person):[^:]+/.test(value)) throw new Error('Authority must explicitly name a role or person, not a producing process.');
}

function validateContext(context: InstrumentReviewContext, inspectedAt: string): void {
  requireIdentifier(context.requestId, 'requestId');
  requireText(context.purpose, 'purpose');
  authority(context.authority);
  parseISOInstant(inspectedAt, 'inspectedAt');
  if (!Array.isArray(context.sources) || context.sources.length === 0) throw new Error('Explicit source policies are required.');
  if (!Array.isArray(context.retractions)) throw new Error('An explicit retraction history is required.');
  const mapped = new Set<string>();
  for (const source of context.sources) {
    if (!Array.isArray(source.evidence) || source.evidence.length === 0) throw new Error('Every source policy must bind evidence references and bytes.');
    for (const item of source.evidence) {
      requireIdentifier(item.artifactRef, 'artifactRef');
      digest(item.digest);
      if (mapped.has(item.artifactRef)) throw new Error('An evidence reference may have only one declared source-policy binding.');
      mapped.add(item.artifactRef);
    }
  }
  const seen = new Set<string>();
  for (const item of context.retractions) {
    requireIdentifier(item.retractionId, 'retractionId');
    if (seen.has(item.retractionId)) throw new Error('Retraction identities must be unique.');
    seen.add(item.retractionId);
    if (!['EVIDENCE', 'BUNDLE', 'NUMERICAL_RESULT', 'VERIFICATION'].includes(item.targetKind)) throw new Error('Unsupported retraction target kind.');
    requireIdentifier(item.targetId, 'retraction.targetId');
    if (item.targetKind === 'VERIFICATION') {
      if (!item.subjectBundleDigest) throw new Error('Verification withdrawal must bind its subject bundle digest.');
      digest(item.subjectBundleDigest);
    } else if (item.subjectBundleDigest !== undefined) {
      throw new Error('Only verification withdrawals carry subjectBundleDigest.');
    }
    authority(item.authority);
    requireText(item.reason, 'retraction.reason');
    parseISOInstant(item.knownAt, 'retraction.knownAt');
  }
}

/** Fail policy/source mismatches before invoking a numerical producer. */
type RetractionTargets = Record<InstrumentRetraction['targetKind'], Set<string>>;

function applicableWithdrawals(items: readonly InstrumentRetraction[], targets: RetractionTargets, inspectedAt: string): InstrumentRetraction[] {
  return items.filter((item) => parseISOInstant(item.knownAt, 'knownAt') <= parseISOInstant(inspectedAt, 'inspectedAt') &&
    (targets[item.targetKind].has(item.targetId) || (item.targetKind === 'VERIFICATION' && targets.BUNDLE.has(item.subjectBundleDigest!))));
}

function preflightEvidence(bytes: Buffer, sources: readonly InstrumentSourcePolicy[]): RetractionTargets {
  if (bytes.length === 0 || bytes.length > MAX_PROJECTION_BYTES) throw new Error('BUNDLE_SIZE_LIMIT');
  const value = JSON.parse(bytes.toString('utf8')) as { source?: { evidence?: unknown }; bundle_digest?: string;
    steps?: { numerical_result_id?: string; runtime_ref?: string; result?: { numerical_result_id?: string;
      data?: { numerical_result_id?: string; state_id?: string }; result_artifact?: { numerical_result_id?: string } } }[];
    verification?: { verification_id?: string } };
  const evidence = value?.source?.evidence;
  if (!Array.isArray(evidence) || evidence.length === 0) throw new Error('RETAINED_SOURCE_EVIDENCE_REQUIRED');
  const declared = new Map(sources.flatMap((source) => source.evidence.map((item) => [item.artifactRef, item.digest] as const)));
  const seen = new Set<string>();
  for (const item of evidence) {
    if (!item || typeof item !== 'object' || typeof item.artifact_ref !== 'string' || seen.has(item.artifact_ref) ||
        typeof item.bytes_b64 !== 'string' || declared.get(item.artifact_ref) !== item.sha256 ||
        byteDigest(Buffer.from(item.bytes_b64, 'base64')) !== item.sha256) {
      throw new Error('SOURCE_EVIDENCE_BINDING_MISMATCH');
    }
    seen.add(item.artifact_ref);
  }
  if (seen.size !== declared.size) throw new Error('SOURCE_EVIDENCE_BINDING_MISMATCH');
  return {
    EVIDENCE: new Set([...declared.keys(), ...declared.values()]),
    BUNDLE: new Set([byteDigest(bytes), ...(typeof value.bundle_digest === 'string' ? [value.bundle_digest] : [])]),
    NUMERICAL_RESULT: new Set(Array.isArray(value.steps) ? value.steps.flatMap((step) =>
      [step?.numerical_result_id, step?.result?.numerical_result_id, step?.result?.result_artifact?.numerical_result_id,
        step?.result?.data?.numerical_result_id, ...(step?.runtime_ref === 'gsie' ? [step?.result?.data?.state_id] : [])]
        .filter((id): id is string => typeof id === 'string' && id.length > 0)) : []),
    VERIFICATION: new Set(typeof value.verification?.verification_id === 'string' ? [value.verification.verification_id] : []),
  };
}

/**
 * Re-runs the pinned operations and SET verifier; accepts no passed boolean,
 * supplied receipt, callback, import path or executable path from the bundle.
 * Each invocation produces a detached receipt. Callers may retain it using the
 * existing evidence rail under a separately evaluated INGEST policy; this
 * inspection performs no retention or admission write.
 */
export function inspectInstrumentResult(
  bundleBytes: Uint8Array,
  context: InstrumentReviewContext,
  runtime: InstrumentRuntime,
  inspectedAt: string,
): InstrumentCandidateInspection {
  const bytes = Buffer.from(bundleBytes);
  const bundleBytesDigest = byteDigest(bytes);
  // Snapshot before computation: later caller mutation cannot rewrite a ruling.
  const snapshot = JSON.parse(localJson(context)) as InstrumentReviewContext;
  const contextDigest = localRecordDigest(snapshot, MAX_PROJECTION_BYTES);
  const reasons: string[] = [];
  const policyDecisions: SourceUseDecision[] = [];
  let binding: ReplayBinding | null = null;
  let applicableRetractions: InstrumentRetraction[] = [];
  try {
    validateContext(snapshot, inspectedAt);
    // Recompute source-use decisions before executing any candidate workload.
    for (const [index, source] of snapshot.sources.entries()) {
      for (const operation of ['RETRIEVE', 'DERIVE'] as const) {
        const decision = evaluateSourceUse(source.registration, {
          requestId: `${snapshot.requestId}:source:${index}:${operation.toLowerCase()}`,
          registrationId: source.registration.registrationId,
          operation, audience: 'INTERNAL', purpose: snapshot.purpose, requestedAt: inspectedAt,
        });
        policyDecisions.push(decision);
        if (decision.state !== 'ALLOWED') reasons.push(`SOURCE_USE_${decision.state}:${source.registration.sourceId}:${operation}`);
      }
      const retention = source.registration.retention;
      if (retention.mode === 'UNTIL' && parseISOInstant(inspectedAt, 'inspectedAt') >= parseISOInstant(retention.until, 'retention.until')) {
        reasons.push(`SOURCE_RETENTION_EXPIRED:${source.registration.sourceId}`);
      }
    }
    if (reasons.length === 0) {
      const preliminaryTargets = preflightEvidence(bytes, snapshot.sources);
      applicableRetractions = applicableWithdrawals(snapshot.retractions, preliminaryTargets, inspectedAt);
      if (applicableRetractions.length) throw new Error('BOUND_DEPENDENCY_RETRACTED');
      binding = recomputeInstrumentReplay(bytes, runtime, inspectedAt);
      if (binding.bundleBytesDigest !== bundleBytesDigest) throw new Error('VERIFIER_BUNDLE_BYTES_MISMATCH');
      const sortEvidence = (items: ReplayBinding['evidence']) => [...items].sort((a, b) => a.artifactRef.localeCompare(b.artifactRef));
      const declared = snapshot.sources.flatMap((source) => [...source.evidence]);
      if (localJson(sortEvidence(declared)) !== localJson(sortEvidence(binding.evidence))) throw new Error('SOURCE_EVIDENCE_BINDING_MISMATCH');
      const targets: RetractionTargets = {
        EVIDENCE: new Set([...binding.evidenceDigests, ...binding.evidence.map((item) => item.artifactRef)]),
        BUNDLE: new Set([binding.bundleDigest, bundleBytesDigest]),
        NUMERICAL_RESULT: new Set(binding.numericalResultIds),
        VERIFICATION: new Set([binding.verification.verification_id]),
      };
      applicableRetractions = applicableWithdrawals(snapshot.retractions, targets, inspectedAt);
      if (applicableRetractions.length) reasons.push('BOUND_DEPENDENCY_RETRACTED');
    }
  } catch (error) {
    reasons.push(error instanceof Error ? error.message : 'INSTRUMENT_INSPECTION_FAILED');
  }
  const eligible = binding !== null && reasons.length === 0;
  const payload: Omit<InstrumentCandidateInspection, 'digest'> = {
    schema: 'payload.instrument-candidate-inspection.v1', method: METHOD,
    requestId: snapshot.requestId, authority: snapshot.authority, inspectedAt,
    bundleBytesDigest, contextDigest,
    state: eligible ? 'ELIGIBLE_FOR_CANDIDATE_REVIEW' : 'REFUSED',
    candidate: binding ? {
      kind: 'INSTRUMENT_RESULT', state: 'UNADMITTED', bundleDigest: binding.bundleDigest,
      evidenceDigests: binding.evidenceDigests, evidence: binding.evidence, operationPins: binding.operationPins,
      executionIds: binding.executionIds, numericalResultIds: binding.numericalResultIds,
      runtimePins: binding.runtimePins, interpreterSha256: binding.interpreterSha256,
      reconciliation: binding.reconciliation,
      ...(binding.processAssessment ? { processAssessment: binding.processAssessment } : {}),
      verification: binding.verification,
    } : null,
    policyDecisions, applicableRetractions,
    reasons: eligible ? ['RECOMPUTED_UNDER_DECLARED_SOURCE_POLICY', 'CANDIDATE_REVIEW_ONLY'] : reasons,
    canonicalAdmission: 'REFUSED',
    canonicalAdmissionReason: 'DOMAIN_ASSERTION_IDENTITY_CLOCKS_AND_EVIDENCE_CLASS_NOT_ESTABLISHED',
    canonicalStateMutated: false, evidenceRetained: false, releaseActivated: false,
    sourceTruthClaimed: false, cseDisposition: 'NOT_EVALUATED', independentlyVerified: false,
    retractionHistoryComplete: false,
  };
  return JSON.parse(localJson({ ...payload, digest: localRecordDigest(payload, MAX_PROJECTION_BYTES) })) as InstrumentCandidateInspection;
}

export interface InstrumentCaptureRequest {
  evidenceId: string;
  workflowId: string;
  retainedAt: string;
  /** A separately registered derived artifact; never inherit raw-source rights. */
  sourceRegistration: SourceRegistration;
}

export interface InstrumentCandidateCapture {
  state: 'CANDIDATE_EVIDENCE_RETAINED' | 'REFUSED';
  inspection: InstrumentCandidateInspection | null;
  capture: EvidenceCaptureResult | null;
  reasons: string[];
  canonicalAdmission: 'REFUSED';
  canonicalStateMutated: false;
  releaseActivated: false;
  sourceTruthClaimed: false;
}

function retentionEnd(registration: SourceRegistration): number {
  const policy = registration.retention;
  if (policy.mode === 'INDEFINITE') return Number.POSITIVE_INFINITY;
  const end = policy.mode === 'UNTIL' ? policy.until : registration.effectiveUntil;
  if (!end) throw new Error('FINITE_SOURCE_RETENTION_BOUND_REQUIRED');
  return parseISOInstant(end, 'source retention end');
}

/**
 * Optional candidate-evidence retention through the EXISTING object-store
 * seam. One self-contained envelope retains exact bundle bytes, source-policy
 * declarations and a fresh inspection. No scalar record or release is created.
 * Backend object-lock, retention expiry and physical durability remain the
 * existing store adapter's responsibility; this is not a new storage engine.
 */
export function captureInstrumentResult(
  bundleBytes: Uint8Array,
  context: InstrumentReviewContext,
  runtime: InstrumentRuntime,
  request: InstrumentCaptureRequest,
  store: ContentAddressedStore,
): InstrumentCandidateCapture {
  const bytes = Buffer.from(bundleBytes);
  const snapshot = JSON.parse(localJson(context)) as InstrumentReviewContext;
  const captureRequest = JSON.parse(localJson(request)) as InstrumentCaptureRequest;
  const reasons: string[] = [];
  const ingestDecisions: SourceUseDecision[] = [];
  let inspection: InstrumentCandidateInspection | null = null;
  try {
    validateContext(snapshot, captureRequest.retainedAt);
    requireIdentifier(captureRequest.evidenceId, 'evidenceId');
    requireIdentifier(captureRequest.workflowId, 'workflowId');
    if (snapshot.sources.some((source) => source.registration.sourceId === captureRequest.sourceRegistration.sourceId ||
        source.registration.registrationId === captureRequest.sourceRegistration.registrationId)) {
      throw new Error('DERIVED_BUNDLE_SOURCE_REGISTRATION_MUST_BE_DISTINCT');
    }
    const registrations = [...snapshot.sources.map((source) => source.registration), captureRequest.sourceRegistration];
    for (const [index, registration] of registrations.entries()) {
      const decision = evaluateSourceUse(registration, {
        requestId: `${captureRequest.workflowId}:ingest:${index}`,
        registrationId: registration.registrationId, purpose: snapshot.purpose,
        operation: 'INGEST', audience: 'INTERNAL', requestedAt: captureRequest.retainedAt,
      });
      ingestDecisions.push(decision);
      if (decision.state !== 'ALLOWED') reasons.push(`SOURCE_INGEST_${decision.state}:${registration.sourceId}`);
      if (parseISOInstant(captureRequest.retainedAt, 'retainedAt') >= retentionEnd(registration)) reasons.push(`SOURCE_RETENTION_EXPIRED:${registration.sourceId}`);
    }
    const bound = retentionEnd(captureRequest.sourceRegistration);
    if (snapshot.sources.some((source) => bound > retentionEnd(source.registration))) reasons.push('BUNDLE_RETENTION_EXCEEDS_SOURCE');
    if (reasons.length === 0) {
      inspection = inspectInstrumentResult(bytes, snapshot, runtime, captureRequest.retainedAt);
      if (inspection.state !== 'ELIGIBLE_FOR_CANDIDATE_REVIEW') reasons.push(...inspection.reasons);
    }
  } catch (error) {
    reasons.push(error instanceof Error ? error.message : 'CANDIDATE_CAPTURE_REFUSED');
  }
  const limits = { canonicalAdmission: 'REFUSED' as const, canonicalStateMutated: false as const,
    releaseActivated: false as const, sourceTruthClaimed: false as const };
  if (reasons.length || !inspection) return { state: 'REFUSED', inspection, capture: null, reasons, ...limits };
  const envelope = {
    schema: 'payload.instrument-candidate-evidence.v1', state: 'UNADMITTED',
    bundleBytesBase64: bytes.toString('base64'), context: snapshot,
    inspection, captureRequest, ingestDecisions,
    ...limits,
  };
  // Every policy, evidence, replay, withdrawal and time gate precedes this write.
  // Storage failures may occur after a put; captureEvidence requires readback and
  // never fabricates a successful receipt for an unverified physical write.
  const capture = captureEvidence({
    evidenceId: captureRequest.evidenceId, workflowId: captureRequest.workflowId,
    sourceRegistration: captureRequest.sourceRegistration,
    ingestDecision: ingestDecisions[ingestDecisions.length - 1],
    bytes: encodeLocalRecord(envelope, 16 * 1024 * 1024), mediaType: 'application/json',
    capturedAt: captureRequest.retainedAt, storedAt: captureRequest.retainedAt, store,
  });
  return { state: 'CANDIDATE_EVIDENCE_RETAINED', inspection, capture, reasons: ['FRESH_REPLAY_AND_EXPLICIT_INGEST', 'NO_CANONICAL_ADMISSION'], ...limits };
}
