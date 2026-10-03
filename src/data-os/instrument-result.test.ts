import { beforeEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { captureInstrumentResult, inspectInstrumentResult, type InstrumentCaptureRequest, type InstrumentReviewContext } from './instrument-result';
import type { InstrumentRuntime, ReplayBinding } from './instrument-result-verifier';
import { byteDigest, InMemoryContentAddressedStore, verifyEvidenceCapture } from './evidence-capture';
import { localJson, localRecordDigest } from './local-record';

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }));
const spawn = vi.mocked(spawnSync);
const AT = '2026-09-20T12:00:00Z';
const LATER = '2026-09-20T13:00:00Z';
const EVIDENCE_BYTES = Buffer.from('retained synthetic telemetry');
const EVIDENCE = byteDigest(EVIDENCE_BYTES);
const bytes = Buffer.from(JSON.stringify({ schema: 'ciw.telemetry-session.v1', untrustedReceipt: { passed: true },
  bundle_digest: `sha256:${'2'.repeat(64)}`, steps: [{ numerical_result_id: `sha256:${'3'.repeat(64)}` }],
  source: { evidence: [{ artifact_ref: 'artifact:sensor-1', sha256: EVIDENCE, bytes_b64: EVIDENCE_BYTES.toString('base64') }] } }));
const BUNDLE = `sha256:${'2'.repeat(64)}`;
const RESULT = `sha256:${'3'.repeat(64)}`;
// The child is mocked in this unit suite. Use a small real file to exercise
// pre-spawn byte commitments without repeatedly hashing a large Node binary.
const trustedFile = resolve(process.cwd(), 'scripts/instrument-replay-verify.py');
const runtime: InstrumentRuntime = { python: trustedFile, pythonSha256: byteDigest(readFileSync(trustedFile)).slice(7),
  helperPath: trustedFile, repositories: {} };

function context(): InstrumentReviewContext {
  return {
    requestId: 'instrument-review-1', authority: 'role:instrument-reviewer', purpose: 'INSTRUMENT_REVIEW', retractions: [],
    sources: [{
      evidence: [{ artifactRef: 'artifact:sensor-1', digest: EVIDENCE }],
      registration: {
        registrationId: 'sensor-policy-1', sourceId: 'sensor-1', displayName: 'Declared test sensor',
        sourceClass: 'OPERATOR_DECLARATION', licenseId: 'internal-test-use', policyVersion: '1',
        effectiveFrom: '2026-09-01T00:00:00Z', allowedOperations: ['RETRIEVE', 'DERIVE'],
        permittedPurposes: ['INSTRUMENT_REVIEW'], allowedAudiences: ['INTERNAL'], retention: { mode: 'INDEFINITE' },
      },
    }],
  };
}

function binding(): ReplayBinding {
  return {
    bundleBytesDigest: byteDigest(bytes), bundleDigest: BUNDLE,
    evidence: [{ artifactRef: 'artifact:sensor-1', digest: EVIDENCE }], evidenceDigests: [EVIDENCE],
    operationPins: [{ operation_id: 'gsie.linear-update.v1', runtime_ref: 'gsie', runtime_digest: `sha256:${'4'.repeat(64)}` }],
    executionIds: ['execution:test-1'], numericalResultIds: [RESULT],
    runtimePins: {}, interpreterSha256: runtime.pythonSha256,
    reconciliation: { status: 'not_run', outputConstraintResidualZero: null },
    verification: { verification_id: 'verification:test-1', outcome: 'passed', independent: false },
  };
}

function respond(value: ReplayBinding = binding()) {
  spawn.mockReturnValue({ status: 0, signal: null, output: [], pid: 1, stdout: JSON.stringify(value), stderr: '' });
}

beforeEach(() => { spawn.mockReset(); respond(); });

describe('calibrated process evidence keeps native uncertainty and fault scope', () => {
  function calibrated() {
    const payload = JSON.parse(bytes.toString());
    payload.schema = 'ciw.calibrated-observable-session.v1';
    payload.steps = [{ runtime_ref: 'gsie', numerical_result_id: RESULT,
      result: { data: { state_id: 'state:native-gsie', numerical_result_id: 'numerical:native-gsie' } } }];
    const raw = Buffer.from(JSON.stringify(payload));
    const value = binding(); value.bundleBytesDigest = byteDigest(raw);
    value.numericalResultIds.push('state:native-gsie', 'numerical:native-gsie');
    value.reconciliation = { status: 'held', outputConstraintResidualZero: false };
    value.processAssessment = { stateResultId: 'result:gsie', stateId: 'state:native-gsie',
      observabilityResultId: 'result:oit', observabilityStatus: 'observable', reconciliationResultId: 'result:cbsr',
      faultResultId: 'result:fdir', residualBasis: 'retained_gsie_prior_innovation', detectionStatus: 'statistical_anomaly',
      isolabilityStatus: 'ambiguous', crossCovariancePolicy: 'unknown', isolatedFault: null };
    return { raw, value };
  }
  it('retains held reconciliation and ambiguous unknown-covariance faults without admitting state', () => {
    const { raw, value } = calibrated(); respond(value);
    const review = inspectInstrumentResult(raw, context(), runtime, AT);
    expect(review.state).toBe('ELIGIBLE_FOR_CANDIDATE_REVIEW');
    expect(review.candidate!.processAssessment).toEqual(value.processAssessment);
    expect(review.candidate!.reconciliation.status).toBe('held');
    expect(review.canonicalAdmission).toBe('REFUSED');
    expect(spawn.mock.calls[0][2]).toMatchObject({ timeout: 300_000 });
  });
  it.each(['missing', 'isolated-unknown', 'unobservable', 'wrong-residual'])('refuses %s process assessment', (defect) => {
    const { raw, value } = calibrated();
    if (defect === 'missing') delete value.processAssessment;
    if (defect === 'isolated-unknown') { value.processAssessment!.isolabilityStatus = 'isolated'; value.processAssessment!.isolatedFault = 'sensor-a'; }
    if (defect === 'unobservable') (value.processAssessment as unknown as { observabilityStatus: string }).observabilityStatus = 'unobservable';
    if (defect === 'wrong-residual') (value.processAssessment as unknown as { residualBasis: string }).residualBasis = 'rebuilt-estimator';
    respond(value);
    expect(inspectInstrumentResult(raw, context(), runtime, AT).state).toBe('REFUSED');
  });
  it.each(['state:native-gsie', 'numerical:native-gsie'])('withdraws wrapped native identity %s before replay', (targetId) => {
    const { raw, value } = calibrated(); respond(value);
    const declared = context();
    declared.retractions = [{ retractionId: 'withdraw-native-state', targetKind: 'NUMERICAL_RESULT', targetId,
      knownAt: AT, authority: 'role:reviewer', reason: 'Synthetic withdrawn support.' }];
    expect(inspectInstrumentResult(raw, declared, runtime, AT).state).toBe('REFUSED');
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe('instrument candidate evidence is inspected, never self-admitted', () => {
  it('recomputes policy and invokes an isolated verifier, preserving distinct identities', () => {
    const review = inspectInstrumentResult(bytes, context(), runtime, AT);
    expect(review.state).toBe('ELIGIBLE_FOR_CANDIDATE_REVIEW');
    expect(review.policyDecisions.map((decision) => decision.request.operation)).toEqual(['RETRIEVE', 'DERIVE']);
    expect(review.candidate).toMatchObject({
      kind: 'INSTRUMENT_RESULT', state: 'UNADMITTED', bundleDigest: BUNDLE,
      evidenceDigests: [EVIDENCE], executionIds: ['execution:test-1'], numericalResultIds: [RESULT],
      verification: { verification_id: 'verification:test-1', outcome: 'passed', independent: false },
    });
    expect(review).toMatchObject({ canonicalAdmission: 'REFUSED', canonicalStateMutated: false,
      evidenceRetained: false, releaseActivated: false, sourceTruthClaimed: false,
      cseDisposition: 'NOT_EVALUATED', independentlyVerified: false, retractionHistoryComplete: false });
    const [python, args, options] = spawn.mock.calls[0];
    expect(python).toBe(runtime.python);
    expect(args).toEqual(['-I', '-B', expect.stringContaining('scripts/instrument-replay-verify.py')]);
    expect(options).toMatchObject({ timeout: 90_000, maxBuffer: 16 * 1024 * 1024 });
    expect(options).not.toHaveProperty('shell');
    const sent = JSON.parse(options!.input as string);
    expect(Buffer.from(sent.bundleBase64, 'base64')).toEqual(bytes);
    expect(sent.runtime).toEqual(runtime.repositories);
  });

  it('never trusts the subject-provided passed flag when the fresh verifier refuses', () => {
    spawn.mockReturnValue({ status: 1, signal: null, output: [], pid: 1, stdout: '', stderr: 'sensitive diagnostics' });
    const review = inspectInstrumentResult(bytes, context(), runtime, AT);
    expect(review.state).toBe('REFUSED');
    expect(review.candidate).toBeNull();
    expect(review.reasons).toContain('TRUSTED_REPLAY_UNAVAILABLE_OR_REFUSED');
    expect(JSON.stringify(review)).not.toContain('sensitive diagnostics');
  });

  it.each(['failed', 'indeterminate', 'refused'])('rejects a fresh %s verification receipt', (outcome) => {
    const value = binding(); value.verification.outcome = outcome; respond(value);
    expect(inspectInstrumentResult(bytes, context(), runtime, AT).state).toBe('REFUSED');
  });

  it('refuses a copied valid receipt attached to different exact bundle bytes', () => {
    const review = inspectInstrumentResult(Buffer.concat([bytes, Buffer.from(' ')]), context(), runtime, AT);
    expect(review.state).toBe('REFUSED');
    expect(review.reasons).toContain('VERIFIER_BUNDLE_BYTES_MISMATCH');
  });

  it.each(['missing-policy', 'wrong-digest', 'wrong-ref', 'duplicate-ref'])('refuses %s evidence-to-policy binding', (defect) => {
    const declared = context();
    if (defect === 'missing-policy') declared.sources = [];
    if (defect === 'wrong-digest') declared.sources[0].evidence = [{ artifactRef: 'artifact:sensor-1', digest: BUNDLE }];
    if (defect === 'wrong-ref') declared.sources[0].evidence = [{ artifactRef: 'artifact:other', digest: EVIDENCE }];
    if (defect === 'duplicate-ref') declared.sources = [declared.sources[0], structuredClone(declared.sources[0])];
    const review = inspectInstrumentResult(bytes, declared, runtime, AT);
    expect(review.state).toBe('REFUSED');
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each(['purpose', 'audience', 'operation', 'expired', 'approval', 'retention'])('refuses %s policy before running numerical code', (defect) => {
    const declared = context();
    const registration = declared.sources[0].registration;
    if (defect === 'purpose') declared.purpose = 'CUSTOMER_EXPORT';
    if (defect === 'audience') registration.allowedAudiences = ['PUBLIC'];
    if (defect === 'operation') registration.allowedOperations = ['INGEST'];
    if (defect === 'expired') registration.effectiveUntil = AT;
    if (defect === 'approval') { registration.allowedOperations = ['RETRIEVE']; registration.approvalRequiredOperations = ['DERIVE']; }
    if (defect === 'retention') registration.retention = { mode: 'UNTIL', until: AT };
    expect(inspectInstrumentResult(bytes, declared, runtime, AT).state).toBe('REFUSED');
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each(['notationsos.instrument-candidate-inspection.v1', 'ciw:process', ''])('refuses self-admission authority %s', (authority) => {
    const declared = context(); declared.authority = authority;
    expect(inspectInstrumentResult(bytes, declared, runtime, AT).state).toBe('REFUSED');
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each([
    ['EVIDENCE', EVIDENCE], ['EVIDENCE', 'artifact:sensor-1'], ['BUNDLE', BUNDLE], ['NUMERICAL_RESULT', RESULT], ['VERIFICATION', 'verification:historical-1'],
  ] as const)('withdraws candidate eligibility when bound %s support is retracted', (targetKind, targetId) => {
    const declared = context();
    declared.retractions = [{ retractionId: 'withdrawal-1', targetKind, targetId,
      ...(targetKind === 'VERIFICATION' ? { subjectBundleDigest: BUNDLE } : {}),
      knownAt: LATER, authority: 'role:evidence-steward', reason: 'Withdrawn support; no contrary world claim.' }];
    const historical = inspectInstrumentResult(bytes, declared, runtime, AT);
    const historicalBytes = localJson(historical);
    expect(spawn).toHaveBeenCalledOnce();
    const fresh = binding(); fresh.verification.verification_id = 'verification:fresh-occurrence-2'; respond(fresh);
    const current = inspectInstrumentResult(bytes, declared, runtime, LATER);
    expect(historical.state).toBe('ELIGIBLE_FOR_CANDIDATE_REVIEW');
    expect(current.state).toBe('REFUSED');
    expect(current.reasons).toContain('BOUND_DEPENDENCY_RETRACTED');
    expect(spawn).toHaveBeenCalledOnce();
    expect(current.applicableRetractions).toEqual(declared.retractions);
    expect(localJson(historical)).toBe(historicalBytes);
    respond();
    expect(inspectInstrumentResult(bytes, declared, runtime, AT)).toEqual(historical);
    expect(historical.digest).not.toBe(current.digest);
  });

  it('retains independent source references even when two references name identical bytes', () => {
    const declared = context();
    declared.sources = [declared.sources[0], { registration: { ...declared.sources[0].registration, sourceId: 'sensor-2', registrationId: 'sensor-policy-2' },
      evidence: [{ artifactRef: 'artifact:sensor-2', digest: EVIDENCE }] }];
    const value = binding(); value.evidence.push({ artifactRef: 'artifact:sensor-2', digest: EVIDENCE }); respond(value);
    const source = JSON.parse(bytes.toString('utf8'));
    source.source.evidence.push({ ...source.source.evidence[0], artifact_ref: 'artifact:sensor-2' });
    const sharedBytes = Buffer.from(JSON.stringify(source));
    value.bundleBytesDigest = byteDigest(sharedBytes); respond(value);
    const review = inspectInstrumentResult(sharedBytes, declared, runtime, AT);
    expect(review.state).toBe('ELIGIBLE_FOR_CANDIDATE_REVIEW');
    expect(review.candidate!.evidence).toHaveLength(2);
    // Distinct references are not a claim of statistically independent sensors.
    expect(review.policyDecisions).toHaveLength(4);
  });

  it('detaches the receipt from mutable caller declarations and binds its local policy context', () => {
    const declared = context();
    const expectedContext = localRecordDigest(declared);
    const review = inspectInstrumentResult(bytes, declared, runtime, AT);
    const before = localJson(review);
    declared.sources[0].registration.allowedOperations = ['PUBLISH'];
    declared.sources[0].evidence = [];
    expect(review.contextDigest).toBe(expectedContext);
    expect(localJson(review)).toBe(before);
    const { digest, ...payload } = review;
    expect(localRecordDigest(payload)).toBe(digest);
  });

  it('requires an operator-pinned interpreter and ignores bundle executable hints', () => {
    expect(inspectInstrumentResult(bytes, context(), { ...runtime, python: 'python3' }, AT).state).toBe('REFUSED');
    expect(inspectInstrumentResult(bytes, context(), { ...runtime, pythonSha256: '' }, AT).state).toBe('REFUSED');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('refuses substituted helper/interpreter bytes and cwd-relative helper paths before execution', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'esm-helper-substitution-'));
    try {
      const forged = resolve(directory, 'instrument-replay-verify.py');
      writeFileSync(forged, 'print("forged verification")\n');
      expect(inspectInstrumentResult(bytes, context(), { ...runtime, helperPath: forged }, AT).reasons).toContain('TRUSTED_HELPER_PIN_MISMATCH');
      expect(inspectInstrumentResult(bytes, context(), { ...runtime, python: forged }, AT).reasons).toContain('INTERPRETER_PIN_MISMATCH');
      expect(spawn).not.toHaveBeenCalled();
      expect(inspectInstrumentResult(bytes, context(), { ...runtime, helperPath: 'scripts/instrument-replay-verify.py' }, AT).state).toBe('REFUSED');
      expect(spawn).not.toHaveBeenCalled();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});

describe('candidate retention uses the existing content-addressed evidence seam', () => {
  function allowedCapture() {
    const declared = context();
    declared.sources[0].registration.allowedOperations = ['INGEST', 'RETRIEVE', 'DERIVE'];
    const request: InstrumentCaptureRequest = {
      evidenceId: 'artifact:instrument-candidate-1', workflowId: 'retain-instrument-1', retainedAt: AT,
      sourceRegistration: { ...declared.sources[0].registration,
        registrationId: 'derived-instrument-registration', sourceId: 'ciw-derived-candidate', allowedOperations: ['INGEST'] },
    };
    const store = new InMemoryContentAddressedStore();
    return { declared, request, store };
  }

  it('retains one self-contained unadmitted envelope and verifies exact-byte readback', () => {
    const { declared, request, store } = allowedCapture();
    const put = vi.spyOn(store, 'put');
    const output = captureInstrumentResult(bytes, declared, runtime, request, store);
    expect(output.state).toBe('CANDIDATE_EVIDENCE_RETAINED');
    expect(output.canonicalAdmission).toBe('REFUSED');
    expect(put).toHaveBeenCalledOnce();
    expect(verifyEvidenceCapture(output.capture!, store)).toBe(true);
    const stored = store.get(output.capture!.evidence.contentDigest)!;
    const envelope = JSON.parse(Buffer.from(stored).toString('utf8'));
    expect(Buffer.from(envelope.bundleBytesBase64, 'base64')).toEqual(bytes);
    expect(envelope.context).toEqual(declared);
    expect(envelope.captureRequest).toEqual(request);
    expect(envelope.inspection).toEqual(output.inspection);
    expect(envelope.ingestDecisions).toHaveLength(2);
    expect(envelope).toMatchObject({ schema: 'payload.instrument-candidate-evidence.v1', state: 'UNADMITTED', canonicalAdmission: 'REFUSED', releaseActivated: false });
    const again = captureInstrumentResult(bytes, declared, runtime, request, store);
    expect(again.capture).toEqual(output.capture);
    expect(store.get(output.capture!.evidence.contentDigest)).toEqual(stored);
  });

  it.each(['held', 'refused'] as const)('can retain a reproducible %s reconciliation as diagnostic evidence, never an accepted state', (status) => {
    const { declared, request, store } = allowedCapture();
    const value = binding(); value.reconciliation = { status, outputConstraintResidualZero: false }; respond(value);
    const output = captureInstrumentResult(bytes, declared, runtime, request, store);
    expect(output.state).toBe('CANDIDATE_EVIDENCE_RETAINED');
    expect(output.inspection!.candidate!.reconciliation).toEqual({ status, outputConstraintResidualZero: false });
    expect(output.canonicalAdmission).toBe('REFUSED');
    expect(output.sourceTruthClaimed).toBe(false);
  });

  it.each(['raw-ingest', 'bundle-ingest', 'same-source', 'approval', 'expired', 'retention-widened', 'tampered', 'retracted'])('writes nothing for %s', (defect) => {
    const { declared, request, store } = allowedCapture();
    let content = bytes;
    if (defect === 'raw-ingest') declared.sources[0].registration.allowedOperations = ['RETRIEVE', 'DERIVE'];
    if (defect === 'bundle-ingest') request.sourceRegistration.allowedOperations = ['RETRIEVE'];
    if (defect === 'same-source') request.sourceRegistration = declared.sources[0].registration;
    if (defect === 'approval') { request.sourceRegistration.allowedOperations = ['RETRIEVE']; request.sourceRegistration.approvalRequiredOperations = ['INGEST']; }
    if (defect === 'expired') request.sourceRegistration.effectiveUntil = AT;
    if (defect === 'retention-widened') declared.sources[0].registration.retention = { mode: 'UNTIL', until: LATER };
    if (defect === 'tampered') {
      const data = JSON.parse(bytes.toString('utf8')); data.source.evidence[0].bytes_b64 = Buffer.from('changed').toString('base64');
      content = Buffer.from(JSON.stringify(data));
    }
    if (defect === 'retracted') declared.retractions = [{ retractionId: 'withdrawal-1', targetKind: 'EVIDENCE', targetId: EVIDENCE, knownAt: AT,
      authority: 'role:evidence-steward', reason: 'Sensor calibration withdrawn.' }];
    const put = vi.spyOn(store, 'put');
    const output = captureInstrumentResult(content, declared, runtime, request, store);
    expect(output.state).toBe('REFUSED');
    expect(output.capture).toBeNull();
    expect(put).not.toHaveBeenCalled();
  });

  it('does not let fresh verification erase a retained historical withdrawal', () => {
    const { declared, request, store } = allowedCapture();
    const old = captureInstrumentResult(bytes, declared, runtime, request, store);
    const originalBytes = store.get(old.capture!.evidence.contentDigest);
    declared.retractions = [{ retractionId: 'verification-withdrawal', targetKind: 'VERIFICATION', targetId: old.inspection!.candidate!.verification.verification_id,
      subjectBundleDigest: BUNDLE, knownAt: LATER, authority: 'role:verification-reviewer', reason: 'Withdraw this verification support.' }];
    const fresh = binding(); fresh.verification.verification_id = 'verification:new-occurrence'; respond(fresh);
    const put = vi.spyOn(store, 'put');
    const later = captureInstrumentResult(bytes, declared, runtime, { ...request, retainedAt: LATER }, store);
    expect(later.state).toBe('REFUSED');
    expect(put).not.toHaveBeenCalled();
    expect(store.get(old.capture!.evidence.contentDigest)).toEqual(originalBytes);
    expect(old.state).toBe('CANDIDATE_EVIDENCE_RETAINED');
  });

  it.each(['direct', 'result_artifact'])('refuses a withdrawn producer-issued numerical ID in %s results before replay or write', (location) => {
    const { declared, request, store } = allowedCapture();
    const supplied = JSON.parse(bytes.toString('utf8'));
    const native = 'gsie-native:numerical-1';
    supplied.steps[0].result = location === 'direct' ? { numerical_result_id: native } : { result_artifact: { numerical_result_id: native } };
    declared.retractions = [{ retractionId: 'withdraw-native-result', targetKind: 'NUMERICAL_RESULT', targetId: native,
      knownAt: AT, authority: 'role:result-reviewer', reason: 'Withdraw native numerical output.' }];
    const put = vi.spyOn(store, 'put');
    const output = captureInstrumentResult(Buffer.from(JSON.stringify(supplied)), declared, runtime, request, store);
    expect(output.state).toBe('REFUSED');
    expect(output.reasons).toContain('BOUND_DEPENDENCY_RETRACTED');
    expect(spawn).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });
});
