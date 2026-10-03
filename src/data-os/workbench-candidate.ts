/** Explicit local operator bridge; not a network or canonical-admission API. */
import { isAbsolute } from 'node:path';
import { captureInstrumentResult, inspectInstrumentResult, type InstrumentCaptureRequest, type InstrumentReviewContext } from './instrument-result';
import type { InstrumentRuntime } from './instrument-result-verifier';
import { FileContentAddressedStore } from './file-object-store';
import { exactFields } from './local-record';

export function executeWorkbenchCandidate(value: unknown): unknown {
  exactFields(value, ['action', 'bundleBase64', 'context', 'runtime'], ['inspectedAt', 'captureRequest', 'storeRoot']);
  if (typeof value.bundleBase64 !== 'string' || value.bundleBase64.length > 12 * 1024 * 1024) throw new Error('BUNDLE_SIZE_LIMIT');
  const bytes = Buffer.from(value.bundleBase64, 'base64');
  if (bytes.length === 0 || bytes.length > 8 * 1024 * 1024 || bytes.toString('base64') !== value.bundleBase64) {
    throw new Error('CANONICAL_BOUNDED_BUNDLE_BYTES_REQUIRED');
  }
  if (value.action === 'inspect') {
    if (typeof value.inspectedAt !== 'string' || value.captureRequest !== undefined || value.storeRoot !== undefined) {
      throw new Error('INSPECTION_DOES_NOT_ACCEPT_STORAGE');
    }
    return inspectInstrumentResult(bytes, value.context as InstrumentReviewContext,
      value.runtime as InstrumentRuntime, value.inspectedAt);
  }
  if (value.action === 'capture') {
    if (value.inspectedAt !== undefined || typeof value.storeRoot !== 'string' || !isAbsolute(value.storeRoot)) {
      throw new Error('EXPLICIT_OPERATOR_STORE_ROOT_REQUIRED');
    }
    exactFields(value.captureRequest, ['evidenceId', 'workflowId', 'retainedAt', 'sourceRegistration']);
    return captureInstrumentResult(bytes, value.context as InstrumentReviewContext, value.runtime as InstrumentRuntime,
      value.captureRequest as unknown as InstrumentCaptureRequest, new FileContentAddressedStore(value.storeRoot));
  }
  throw new Error('UNSUPPORTED_CANDIDATE_ACTION');
}
