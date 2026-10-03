/** Node-only, local, pinned CIW/SET bridge. No shell and no network operations. */
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { byteDigest } from './evidence-capture';
import { exactFields } from './local-record';
import { requireRecord } from './validation';

export interface InstrumentRuntime {
  /** Operator configuration, never read from candidate artifacts. */
  python: string;
  pythonSha256: string;
  helperPath: string;
  repositories: Readonly<Record<string, { path: string; revision: string }>>;
}

// Update only when the reviewed helper changes. A request cannot substitute its
// own verifier, even through an operator runtime file or a changed cwd.
const HELPER_SHA256 = '4eec0b10c2bff065cc37c3b39d4bd58796acfe64c6254a79179a2567497fd185';

function verifyExecutableFiles(runtime: InstrumentRuntime): void {
  if (typeof runtime.helperPath !== 'string' || !isAbsolute(runtime.helperPath) || !statSync(runtime.helperPath).isFile() ||
      byteDigest(readFileSync(runtime.helperPath)) !== `sha256:${HELPER_SHA256}`) throw new Error('TRUSTED_HELPER_PIN_MISMATCH');
  if (!statSync(runtime.python).isFile() || byteDigest(readFileSync(runtime.python)) !== `sha256:${runtime.pythonSha256}`) {
    throw new Error('INTERPRETER_PIN_MISMATCH');
  }
}

export interface ReplayBinding {
  bundleBytesDigest: string;
  bundleDigest: string;
  evidenceDigests: string[];
  evidence: { artifactRef: string; digest: string }[];
  operationPins: Record<string, unknown>[];
  executionIds: string[];
  numericalResultIds: string[];
  runtimePins: Record<string, string>;
  interpreterSha256: string;
  reconciliation: { status: 'not_run' | 'accepted' | 'held' | 'refused'; outputConstraintResidualZero: boolean | null };
  processAssessment?: {
    stateResultId: string; stateId: string; observabilityResultId: string; observabilityStatus: 'observable';
    reconciliationResultId: string; faultResultId: string; residualBasis: 'retained_gsie_prior_innovation';
    detectionStatus: 'nominal' | 'statistical_anomaly';
    isolabilityStatus: 'not_detected' | 'isolated' | 'ambiguous' | 'unresolved';
    crossCovariancePolicy: 'declared' | 'declared_zero' | 'unknown'; isolatedFault: string | null;
  };
  verification: { verification_id: string; outcome: string; independent: false; [key: string]: unknown };
}

function strings(value: unknown, field: string): asserts value is string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || !item.trim()) || new Set(value).size !== value.length) {
    throw new Error(`INVALID_VERIFIER_${field}`);
  }
}

export function recomputeInstrumentReplay(bytes: Buffer, runtime: InstrumentRuntime, inspectedAt: string): ReplayBinding {
  if (bytes.length === 0 || bytes.length > 8 * 1024 * 1024) throw new Error('BUNDLE_SIZE_LIMIT');
  if (typeof runtime.python !== 'string' || !isAbsolute(runtime.python)) throw new Error('PINNED_PYTHON_ABSOLUTE_PATH_REQUIRED');
  if (!/^[a-f0-9]{64}$/.test(runtime.pythonSha256)) throw new Error('PINNED_PYTHON_DIGEST_REQUIRED');
  verifyExecutableFiles(runtime);
  const child = spawnSync(runtime.python, ['-I', '-B', runtime.helperPath], {
    input: JSON.stringify({ bundleBase64: bytes.toString('base64'), runtime: runtime.repositories, pythonSha256: runtime.pythonSha256, inspectedAt }),
    encoding: 'utf8', windowsHide: true,
    timeout: JSON.parse(bytes.toString('utf8')).schema === 'ciw.calibrated-observable-session.v1' ? 300_000 : 90_000,
    maxBuffer: 16 * 1024 * 1024,
    // Python isolated mode ignores PYTHONPATH/user-site; script loads only the
    // approved checkout paths. Native thread counts bound this small replay.
    env: { ...process.env, OPENBLAS_NUM_THREADS: '1', OMP_NUM_THREADS: '1' },
  });
  if (child.error || child.status !== 0) throw new Error('TRUSTED_REPLAY_UNAVAILABLE_OR_REFUSED');
  verifyExecutableFiles(runtime);
  let value: unknown;
  try { value = JSON.parse(child.stdout); } catch { throw new Error('INVALID_VERIFIER_RESPONSE'); }
  exactFields(value, ['bundleBytesDigest', 'bundleDigest', 'evidenceDigests', 'evidence', 'operationPins', 'executionIds', 'numericalResultIds', 'runtimePins', 'interpreterSha256', 'reconciliation', 'verification'], ['processAssessment']);
  if (value.bundleBytesDigest !== byteDigest(bytes) || typeof value.bundleDigest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value.bundleDigest)) throw new Error('VERIFIER_BUNDLE_BYTES_MISMATCH');
  strings(value.evidenceDigests, 'EVIDENCE');
  if (value.evidenceDigests.some((item) => !/^sha256:[a-f0-9]{64}$/.test(item))) throw new Error('INVALID_VERIFIER_EVIDENCE');
  if (!Array.isArray(value.evidence) || value.evidence.length === 0) throw new Error('INVALID_VERIFIER_EVIDENCE_BINDINGS');
  const refs = new Set<string>();
  for (const item of value.evidence) {
    exactFields(item, ['artifactRef', 'digest']);
    if (typeof item.artifactRef !== 'string' || !item.artifactRef || refs.has(item.artifactRef) || !value.evidenceDigests.includes(String(item.digest))) throw new Error('INVALID_VERIFIER_EVIDENCE_BINDINGS');
    refs.add(item.artifactRef);
  }
  strings(value.executionIds, 'EXECUTIONS');
  strings(value.numericalResultIds, 'NUMERICAL_RESULTS');
  exactFields(value.reconciliation, ['status', 'outputConstraintResidualZero']);
  if (!['not_run', 'accepted', 'held', 'refused'].includes(String(value.reconciliation.status)) ||
      (value.reconciliation.status === 'not_run' ? value.reconciliation.outputConstraintResidualZero !== null : typeof value.reconciliation.outputConstraintResidualZero !== 'boolean')) {
    throw new Error('INVALID_VERIFIER_RECONCILIATION_STATUS');
  }
  if (!Array.isArray(value.operationPins) || value.operationPins.length === 0) throw new Error('INVALID_VERIFIER_OPERATIONS');
  const calibrated = JSON.parse(bytes.toString('utf8')).schema === 'ciw.calibrated-observable-session.v1';
  if (calibrated !== (value.processAssessment !== undefined)) throw new Error('PROCESS_ASSESSMENT_SCHEMA_MISMATCH');
  if (calibrated) {
    const assessment = value.processAssessment;
    exactFields(assessment, ['stateResultId', 'stateId', 'observabilityResultId', 'observabilityStatus',
      'reconciliationResultId', 'faultResultId', 'residualBasis', 'detectionStatus', 'isolabilityStatus',
      'crossCovariancePolicy', 'isolatedFault']);
    for (const key of ['stateResultId', 'stateId', 'observabilityResultId', 'reconciliationResultId', 'faultResultId']) {
      if (typeof assessment[key] !== 'string' || !assessment[key]) throw new Error('INVALID_PROCESS_IDENTITY');
    }
    if (assessment.observabilityStatus !== 'observable' || assessment.residualBasis !== 'retained_gsie_prior_innovation' ||
        !['nominal', 'statistical_anomaly'].includes(String(assessment.detectionStatus)) ||
        !['not_detected', 'isolated', 'ambiguous', 'unresolved'].includes(String(assessment.isolabilityStatus)) ||
        !['declared', 'declared_zero', 'unknown'].includes(String(assessment.crossCovariancePolicy)) ||
        (assessment.isolabilityStatus === 'isolated' ? typeof assessment.isolatedFault !== 'string' || !assessment.isolatedFault : assessment.isolatedFault !== null) ||
        (assessment.crossCovariancePolicy === 'unknown' && assessment.isolabilityStatus === 'isolated')) {
      throw new Error('INVALID_PROCESS_ASSESSMENT');
    }
  }
  requireRecord(value.runtimePins, 'runtimePins');
  if (value.interpreterSha256 !== runtime.pythonSha256 ||
      Object.keys(value.runtimePins).length !== Object.keys(runtime.repositories).length ||
      Object.entries(runtime.repositories).some(([role, pin]) => value.runtimePins && (value.runtimePins as Record<string, unknown>)[role] !== pin.revision)) {
    throw new Error('VERIFIER_RUNTIME_PIN_MISMATCH');
  }
  requireRecord(value.verification, 'verification');
  if (typeof value.verification.verification_id !== 'string' || !value.verification.verification_id || value.verification.outcome !== 'passed' || value.verification.independent !== false) throw new Error('REPLAY_VERIFICATION_NOT_PASSED');
  return value as unknown as ReplayBinding;
}
