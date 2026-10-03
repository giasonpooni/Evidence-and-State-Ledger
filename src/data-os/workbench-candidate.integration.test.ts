import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { executeWorkbenchCandidate } from './workbench-candidate';
import type { InstrumentCandidateCapture } from './instrument-result';
import { FileContentAddressedStore } from './file-object-store';
import { verifyEvidenceCapture } from './evidence-capture';

const bundlePath = process.env.ESM_TELEMETRY_BUNDLE_FILE;
const runtimePath = process.env.ESM_TELEMETRY_RUNTIME_FILE;
describe.skipIf(!bundlePath || !runtimePath)('explicit workbench candidate bridge, real providers and disk store', () => {
  it('retains exact bytes as UNADMITTED and refuses missing policy without a disk write', () => {
    const bytes = readFileSync(bundlePath!);
    const bundle = JSON.parse(bytes.toString());
    const directory = mkdtempSync(join(tmpdir(), 'esm-workbench-'));
    const storeRoot = join(directory, 'objects');
    const registration = { registrationId: 'synthetic-raw-policy', sourceId: 'synthetic-raw',
      displayName: 'Synthetic fixture only', sourceClass: 'OPERATOR_DECLARATION',
      licenseId: 'synthetic-test-only', policyVersion: '1', effectiveFrom: '2026-09-01T00:00:00Z',
      allowedOperations: ['RETRIEVE', 'DERIVE', 'INGEST'], allowedAudiences: ['INTERNAL'],
      permittedPurposes: ['SYNTHETIC_TEST'], retention: { mode: 'INDEFINITE' } };
    const at = new Date(Math.max(Date.now(), Date.parse(bundle.created_at)) + 1000).toISOString();
    const payload = { action: 'capture', bundleBase64: bytes.toString('base64'), storeRoot,
      runtime: JSON.parse(readFileSync(runtimePath!, 'utf8')),
      context: { requestId: 'synthetic-workbench', authority: 'role:test-reviewer', purpose: 'SYNTHETIC_TEST', retractions: [],
        sources: [{ registration, evidence: bundle.source.evidence.map((item: { artifact_ref: string; sha256: string }) =>
          ({ artifactRef: item.artifact_ref, digest: item.sha256 })) }] },
      captureRequest: { evidenceId: 'artifact:synthetic-candidate', workflowId: 'synthetic-workbench-retention', retainedAt: at,
        sourceRegistration: { ...registration, registrationId: 'synthetic-derived-policy', sourceId: 'synthetic-derived' } } };
    try {
      expect((executeWorkbenchCandidate({ ...payload, context: { ...payload.context, sources: [] } }) as InstrumentCandidateCapture).state).toBe('REFUSED');
      expect(existsSync(storeRoot)).toBe(false);
      expect(() => executeWorkbenchCandidate({ ...payload, action: 'inspect', inspectedAt: at })).toThrow('INSPECTION_DOES_NOT_ACCEPT_STORAGE');
      const retained = executeWorkbenchCandidate(payload) as InstrumentCandidateCapture;
      expect(retained.state, JSON.stringify(retained.reasons)).toBe('CANDIDATE_EVIDENCE_RETAINED');
      const store = new FileContentAddressedStore(storeRoot);
      expect(verifyEvidenceCapture(retained.capture!, store)).toBe(true);
      const envelope = JSON.parse(Buffer.from(store.get(retained.capture!.evidence.contentDigest)!).toString());
      expect(Buffer.from(envelope.bundleBytesBase64, 'base64')).toEqual(bytes);
      expect(envelope.state).toBe('UNADMITTED');
      expect(envelope.canonicalAdmission).toBe('REFUSED');
      expect(envelope.canonicalStateMutated).toBe(false);
      expect(envelope.releaseActivated).toBe(false);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 900_000);
});
