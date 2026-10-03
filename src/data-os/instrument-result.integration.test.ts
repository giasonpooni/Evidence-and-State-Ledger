import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { captureInstrumentResult, inspectInstrumentResult, type InstrumentCaptureRequest, type InstrumentReviewContext } from './instrument-result';
import type { InstrumentRuntime } from './instrument-result-verifier';
import { InMemoryContentAddressedStore, verifyEvidenceCapture } from './evidence-capture';

// Optional integration against a real pinned sibling checkout set. No stubs,
// downloads, registry mutation or physical persistent writes occur in this test.
const bundlePath = process.env.ESM_TELEMETRY_BUNDLE_FILE;
const runtimePath = process.env.ESM_TELEMETRY_RUNTIME_FILE;

describe.skipIf(!bundlePath || !runtimePath)('real CIW → SET → ESM candidate evidence boundary', () => {
  it('replays, captures an unadmitted envelope, and refuses tamper/withdrawal before writing', () => {
    const bytes = readFileSync(bundlePath!);
    const bundle = JSON.parse(bytes.toString('utf8'));
    const runtime = JSON.parse(readFileSync(runtimePath!, 'utf8')) as InstrumentRuntime;
    const at = new Date(Math.max(Date.now(), Date.parse(bundle.created_at)) + 1000).toISOString();
    const context: InstrumentReviewContext = {
      requestId: 'synthetic-instrument-integration', authority: 'role:test-reviewer', purpose: 'SYNTHETIC_TEST', retractions: [],
      sources: [{
        registration: {
          registrationId: 'synthetic-fixture-source-policy', sourceId: 'synthetic-ciw-source',
          displayName: 'Explicit synthetic test-only declaration', sourceClass: 'OPERATOR_DECLARATION',
          licenseId: 'synthetic-test-only', policyVersion: '1', effectiveFrom: '2026-09-01T00:00:00Z',
          allowedOperations: ['RETRIEVE', 'DERIVE', 'INGEST'], allowedAudiences: ['INTERNAL'],
          permittedPurposes: ['SYNTHETIC_TEST'], retention: { mode: 'INDEFINITE' },
        },
        evidence: bundle.source.evidence.map((item: { artifact_ref: string; sha256: string }) => ({ artifactRef: item.artifact_ref, digest: item.sha256 })),
      }],
    };
    const inspected = inspectInstrumentResult(bytes, context, runtime, at);
    expect(inspected.state, JSON.stringify(inspected.reasons)).toBe('ELIGIBLE_FOR_CANDIDATE_REVIEW');
    expect(inspected.candidate!.verification.outcome).toBe('passed');
    expect(inspected.candidate!.executionIds).toHaveLength(bundle.steps.length);
    expect(inspected.candidate!.numericalResultIds.length).toBeGreaterThanOrEqual(3);
    expect(inspected.canonicalAdmission).toBe('REFUSED');
    if (bundle.schema === 'ciw.calibrated-observable-session.v1') {
      const byRole = (role: string) => bundle.steps.find((step: { runtime_ref: string }) => step.runtime_ref === role);
      expect(inspected.candidate!.processAssessment).toMatchObject({
        stateResultId: byRole('gsie').result_id, stateId: byRole('gsie').result.data.state_id,
        reconciliationResultId: byRole('cbsr').result_id, faultResultId: byRole('fdir').result_id,
        observabilityStatus: 'observable', residualBasis: 'retained_gsie_prior_innovation',
        detectionStatus: byRole('fdir').result.data.detection.status,
        isolabilityStatus: byRole('fdir').result.data.isolability.status,
      });
      expect(inspected.candidate!.numericalResultIds).toContain(byRole('gsie').result.data.state_id);
    }
    const request: InstrumentCaptureRequest = {
      evidenceId: 'artifact:synthetic-replayed-candidate', workflowId: 'synthetic-retention', retainedAt: at,
      sourceRegistration: { ...context.sources[0].registration, registrationId: 'synthetic-derived-policy', sourceId: 'synthetic-derived-bundle' },
    };
    const store = new InMemoryContentAddressedStore();
    const retained = captureInstrumentResult(bytes, context, runtime, request, store);
    expect(retained.state, JSON.stringify(retained.reasons)).toBe('CANDIDATE_EVIDENCE_RETAINED');
    expect(verifyEvidenceCapture(retained.capture!, store)).toBe(true);
    const retainedBytes = store.get(retained.capture!.evidence.contentDigest);
    const envelope = JSON.parse(Buffer.from(retainedBytes!).toString('utf8'));
    expect(Buffer.from(envelope.bundleBytesBase64, 'base64')).toEqual(bytes);
    expect(envelope.inspection.canonicalAdmission).toBe('REFUSED');
    const put = vi.spyOn(store, 'put');
    const corrupted = structuredClone(bundle);
    corrupted.source.evidence[0].bytes_b64 = Buffer.from('tampered').toString('base64');
    const refused = captureInstrumentResult(Buffer.from(JSON.stringify(corrupted)), context, runtime, request, store);
    expect(refused.state).toBe('REFUSED');
    expect(put).not.toHaveBeenCalled();
    context.retractions = [{ retractionId: 'withdraw-synthetic-verification', targetKind: 'VERIFICATION',
      targetId: inspected.candidate!.verification.verification_id, subjectBundleDigest: inspected.candidate!.bundleDigest,
      knownAt: at, authority: 'role:test-reviewer', reason: 'Synthetic withdrawal test.' }];
    expect(captureInstrumentResult(bytes, context, runtime, request, store).state).toBe('REFUSED');
    expect(put).not.toHaveBeenCalled();
    expect(store.get(retained.capture!.evidence.contentDigest)).toEqual(retainedBytes);
  }, 900_000);
});
