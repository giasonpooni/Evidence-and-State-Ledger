/** Explicit scheduling recovery. Never deletes a lock or fabricates a capture receipt. */
import { mkdirSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { publishImmutableFile } from '../data-os/local-files';
import { encodeLocalRecord } from '../data-os/local-record';
import { check, commitment, instant, LIMIT, verifyApproval } from './authority';
import { attemptIdSchema, historyPlan, lockPresent, quarantineRequestSchema, readRefreshHistory,
  refreshBinding, type QuarantineRecord, type RefreshReadOptions } from './refresh-state';

export function prepareRefreshQuarantine(options: RefreshReadOptions & { attemptId: string }) {
  const { schedule } = refreshBinding(options.schedule, options.operation);
  check(!schedule.enabled, 'DISABLE_SCHEDULE_BEFORE_QUARANTINE');
  attemptIdSchema.parse(options.attemptId);
  check(!lockPresent(options.root, schedule.scheduleId), 'REFRESH_LOCKED');
  const h = readRefreshHistory(options);
  check(h.initialized, 'REFRESH_NOT_INITIALIZED');
  const s = h.slots.find(s => s.attemptId === options.attemptId);
  check(s, 'ATTEMPT_NOT_FOUND');
  check(s.schedulerState === 'INCOMPLETE', 'ATTEMPT_ALREADY_TERMINAL');
  const confirm = readRefreshHistory(options);
  check(!lockPresent(options.root, schedule.scheduleId), 'REFRESH_LOCKED');
  check(confirm.historyDigest === h.historyDigest, 'HISTORY_CHANGED_DURING_READ');
  return quarantineRequestSchema.parse({ schema: 'payload.industrial-refresh-quarantine-request.v1',
    scheduleId: schedule.scheduleId, scheduleDigest: h.scheduleDigest, operationDigest: h.operationDigest,
    expectedHistoryDigest: h.historyDigest, attemptId: s.attemptId, intentDigest: commitment(s.intent), preparedAt: options.at,
    disposition: 'QUARANTINED', executionOutcome: 'UNKNOWN', maintenance: 'EXECUTION_STOPPED_CONFIRMED_BY_OPERATOR',
    canonicalAdmission: false, release: null });
}

export function quarantineRefresh(options: RefreshReadOptions & { request: unknown; approval: unknown }) {
  instant.parse(options.at);
  const request = quarantineRequestSchema.parse(options.request);
  const { schedule } = refreshBinding(options.schedule, options.operation);
  check(!schedule.enabled, 'DISABLE_SCHEDULE_BEFORE_QUARANTINE');
  // Read first: a miss must not create a new journal or become a reset command.
  const initial = readRefreshHistory(options);
  check(initial.initialized, 'REFRESH_NOT_INITIALIZED');
  const lock = join(initial.control, 'lock');
  try { mkdirSync(lock, { mode: 0o700 }); } catch { throw new Error('REFRESH_LOCKED'); }
  try {
    const h = readRefreshHistory(options);
    check(request.scheduleId === h.schedule.scheduleId && request.scheduleDigest === h.scheduleDigest && request.operationDigest === h.operationDigest, 'QUARANTINE_BINDING_MISMATCH');
    const s = h.slots.find(s => s.attemptId === request.attemptId);
    check(s, 'ATTEMPT_NOT_FOUND');
    check(s.schedulerState === 'INCOMPLETE', 'ATTEMPT_ALREADY_TERMINAL');
    check(request.intentDigest === commitment(s.intent), 'QUARANTINE_BINDING_MISMATCH');
    check(request.expectedHistoryDigest === h.historyDigest, 'HISTORY_CHANGED_SINCE_PREPARATION');
    check(Date.parse(s.intent.startedAt) <= Date.parse(request.preparedAt), 'QUARANTINE_TIME_MISMATCH');
    const approval = verifyApproval(options.approval, 'QUARANTINE_REFRESH', request, options.authorityKeys ?? [], options.at);
    check(Date.parse(request.preparedAt) <= Date.parse(approval.issuedAt), 'QUARANTINE_TIME_MISMATCH');
    check(!h.slots.some(s => s.quarantine?.approval.decisionId === approval.decisionId), 'QUARANTINE_DECISION_ID_REUSED');
    const body = { schema: 'payload.industrial-refresh-quarantine.v1' as const, request, approval, recordedAt: options.at };
    const record: QuarantineRecord = { ...body, digest: commitment(body) };
    publishImmutableFile(h.control, ['attempts', s.attemptId, 'quarantine.json'], encodeLocalRecord(record, LIMIT), LIMIT);
    // Reopen through the same verifier the normal refresh runner will use.
    const after = readRefreshHistory(options);
    return { schema: 'payload.industrial-refresh-quarantine-result.v1' as const, status: 'QUARANTINED' as const,
      attemptId: s.attemptId, record, historyDigest: after.historyDigest, plan: historyPlan(after, options.at),
      sourceEffects: 'UNKNOWN' as const, slotReclaimed: false, captureExecuted: false, canonicalAdmission: false, release: null };
  } finally {
    // This call owns only the newly acquired empty lock, never an abandoned worker's lock.
    rmdirSync(lock);
  }
}
