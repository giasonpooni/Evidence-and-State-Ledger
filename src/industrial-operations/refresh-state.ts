/** Read and account for the existing refresh journal; never acquire or repair it. */
import { lstatSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { parseReplayJson } from '../observation/json';
import { parseCaptureSchedule, planCapture, type CaptureSchedule, type ScheduleRun } from '../acquisition/schedule';
import { readImmutableFile } from '../data-os/local-files';
import { byteDigest } from '../data-os/evidence-capture';
import { approvalSchema, check, commitment, hash, id, instant, LIMIT, verifyApproval, type AuthorityKey } from './authority';

export const attemptIdSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
export const refreshResultSchema = z.object({
  captureDigest: hash, reviewDigest: hash, compiledDigest: hash,
  canonicalAdmission: z.literal(false), release: z.null(),
}).strict();
export const refreshIntentSchema = z.object({
  schema: z.literal('payload.industrial-refresh-intent.v1'), attemptId: id,
  scheduleDigest: hash, operationDigest: hash, startedAt: instant,
}).strict();
export const refreshReceiptSchema = z.object({
  schema: z.literal('payload.industrial-refresh-receipt.v1'), intentDigest: hash,
  finishedAt: instant, state: z.enum(['CAPTURED', 'FAILED']),
  result: refreshResultSchema.nullable(), reason: z.enum(['CAPTURE_PIPELINE_FAILED']).nullable(), digest: hash,
}).strict();
export const quarantineRequestSchema = z.object({
  schema: z.literal('payload.industrial-refresh-quarantine-request.v1'),
  scheduleId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
  scheduleDigest: hash, operationDigest: hash, expectedHistoryDigest: hash,
  attemptId: attemptIdSchema, intentDigest: hash, preparedAt: instant,
  disposition: z.literal('QUARANTINED'), executionOutcome: z.literal('UNKNOWN'),
  maintenance: z.literal('EXECUTION_STOPPED_CONFIRMED_BY_OPERATOR'),
  canonicalAdmission: z.literal(false), release: z.null(),
}).strict();
export const quarantineRecordSchema = z.object({
  schema: z.literal('payload.industrial-refresh-quarantine.v1'),
  request: quarantineRequestSchema, approval: approvalSchema, recordedAt: instant, digest: hash,
}).strict();
export type RefreshResult = z.infer<typeof refreshResultSchema>;
export type RefreshIntent = z.infer<typeof refreshIntentSchema>;
export type RefreshReceipt = z.infer<typeof refreshReceiptSchema>;
export type QuarantineRequest = z.infer<typeof quarantineRequestSchema>;
export type QuarantineRecord = z.infer<typeof quarantineRecordSchema>;
export interface RefreshSlot {
  attemptId: string;
  intent: RefreshIntent;
  receipt: RefreshReceipt | null;
  quarantine: QuarantineRecord | null;
  /** Scheduling disposition, never a retrospective assertion of source effects. */
  schedulerState: ScheduleRun['state'];
}
export interface RefreshHistory {
  initialized: boolean;
  schedule: CaptureSchedule;
  control: string;
  scheduleDigest: string;
  operationDigest: string;
  historyDigest: string;
  slots: RefreshSlot[];
}
export interface RefreshReadOptions {
  root: string; schedule: unknown; operation: unknown; at: string;
  authorityKeys?: readonly AuthorityKey[];
}

/** Missing is distinct from unsafe. This helper never creates a directory. */
export function regularDirectory(path: string): boolean {
  try {
    const stat = lstatSync(path);
    check(stat.isDirectory() && !stat.isSymbolicLink(), 'UNSAFE_REFRESH_ROOT');
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
export function refreshBinding(raw: unknown, operation: unknown) {
  const schedule = parseCaptureSchedule(raw);
  check(schedule.sourceId === 'industrial-noaa-usgs', 'SOURCE_SCOPE_MISMATCH');
  // Preserve the v1 identity: enabling a schedule never resets its budget.
  const { enabled, ...identity } = schedule;
  void enabled;
  const binding = { schedule: identity, operation };
  return { schedule, binding, scheduleDigest: commitment(binding), operationDigest: commitment(operation) };
}
export function lockPresent(root: string, scheduleId: string): boolean {
  const base = resolve(root);
  if (!regularDirectory(base)) return false;
  const control = join(base, scheduleId);
  return regularDirectory(control) && regularDirectory(join(control, 'lock'));
}

/** Shared by the runner under its lock and the read-only inspector. */
export function readRefreshHistory(options: RefreshReadOptions): RefreshHistory {
  instant.parse(options.at);
  const at = Date.parse(options.at);
  const selected = refreshBinding(options.schedule, options.operation);
  const { schedule, scheduleDigest, operationDigest } = selected;
  const root = resolve(options.root), control = join(root, schedule.scheduleId);
  const exists = regularDirectory(root) && regularDirectory(control);
  const boundBytes = exists ? readImmutableFile(control, ['binding.json'], LIMIT) : undefined;
  if (boundBytes) check(commitment(parseReplayJson(boundBytes, LIMIT)) === scheduleDigest, 'HISTORY_BINDING_MISMATCH');
  const attempts = join(control, 'attempts');
  const names = exists && regularDirectory(attempts) ? readdirSync(attempts).sort() : [];
  check(names.length <= 1000, 'HISTORY_LIMIT');
  check(boundBytes || names.length === 0, 'HISTORY_BINDING_MISMATCH');
  const fingerprints: { attemptId: string; intent: string; receipt: string | null; quarantine: string | null }[] = [];
  const slots: RefreshSlot[] = [];
  const decisionIds = new Set<string>();
  for (const name of names) {
    check(attemptIdSchema.safeParse(name).success, 'INVALID_HISTORY_ENTRY');
    const raw = readImmutableFile(control, ['attempts', name, 'intent.json'], LIMIT);
    check(raw, 'INCOMPLETE_HISTORY_ENTRY');
    const intent = refreshIntentSchema.parse(parseReplayJson(raw, LIMIT));
    check(intent.attemptId === name && intent.scheduleDigest === scheduleDigest && intent.operationDigest === operationDigest, 'HISTORY_BINDING_MISMATCH');
    check(Date.parse(intent.startedAt) <= at, 'HISTORY_FROM_FUTURE');
    const done = readImmutableFile(control, ['attempts', name, 'receipt.json'], LIMIT);
    const isolated = readImmutableFile(control, ['attempts', name, 'quarantine.json'], LIMIT);
    // A late completion after quarantine is a conflict, not a silently preferred outcome.
    check(!(done && isolated), 'CONFLICTING_TERMINAL_RECORDS');
    let receipt: RefreshReceipt | null = null, quarantine: QuarantineRecord | null = null;
    let schedulerState: ScheduleRun['state'] = 'INCOMPLETE';
    if (done) {
      receipt = refreshReceiptSchema.parse(parseReplayJson(done, LIMIT));
      const { digest, ...body } = receipt;
      check(commitment(body) === digest, 'RECEIPT_HASH_MISMATCH');
      check(receipt.intentDigest === commitment(intent) && Date.parse(receipt.finishedAt) >= Date.parse(intent.startedAt) && Date.parse(receipt.finishedAt) <= at, 'RECEIPT_BINDING_MISMATCH');
      check(receipt.state === 'CAPTURED' ? receipt.result !== null && receipt.reason === null : receipt.result === null && receipt.reason !== null, 'RECEIPT_RESULT_MISMATCH');
      schedulerState = receipt.state;
    }
    if (isolated) {
      quarantine = quarantineRecordSchema.parse(parseReplayJson(isolated, LIMIT));
      const { digest, ...body } = quarantine;
      check(commitment(body) === digest, 'QUARANTINE_HASH_MISMATCH');
      const q = quarantine.request;
      check(q.scheduleId === schedule.scheduleId && q.scheduleDigest === scheduleDigest && q.operationDigest === operationDigest && q.attemptId === name && q.intentDigest === commitment(intent), 'QUARANTINE_BINDING_MISMATCH');
      check(Date.parse(q.preparedAt) >= Date.parse(intent.startedAt) && Date.parse(q.preparedAt) <= Date.parse(quarantine.approval.issuedAt) && Date.parse(quarantine.recordedAt) <= at, 'QUARANTINE_TIME_MISMATCH');
      // Verify at the recorded act, with the currently configured trust keys.
      // Expiry does not erase a past act. Revocation/missing trust blocks use of it.
      verifyApproval(quarantine.approval, 'QUARANTINE_REFRESH', q, options.authorityKeys ?? [], quarantine.recordedAt);
      check(!decisionIds.has(quarantine.approval.decisionId), 'QUARANTINE_DECISION_ID_REUSED');
      decisionIds.add(quarantine.approval.decisionId);
      schedulerState = 'QUARANTINED';
    }
    slots.push({ attemptId: name, intent, receipt, quarantine, schedulerState });
    fingerprints.push({ attemptId: name, intent: byteDigest(raw), receipt: done ? byteDigest(done) : null, quarantine: isolated ? byteDigest(isolated) : null });
  }
  return { initialized: !!boundBytes, schedule, control, scheduleDigest, operationDigest, slots,
    historyDigest: commitment({ schema: 'payload.industrial-refresh-history.v1', binding: boundBytes ? byteDigest(boundBytes) : null, scheduleDigest, operationDigest, entries: fingerprints }) };
}
export function historyPlan(history: RefreshHistory, at: string) {
  return planCapture(history.schedule, history.slots.map(s => ({ startedAt: s.intent.startedAt, state: s.schedulerState })), at);
}

const READ_REASONS = new Set([
  'UNSAFE_REFRESH_ROOT', 'SOURCE_SCOPE_MISMATCH', 'HISTORY_LIMIT', 'INVALID_HISTORY_ENTRY',
  'INCOMPLETE_HISTORY_ENTRY', 'HISTORY_BINDING_MISMATCH', 'HISTORY_FROM_FUTURE',
  'RECEIPT_HASH_MISMATCH', 'RECEIPT_BINDING_MISMATCH', 'RECEIPT_RESULT_MISMATCH',
  'CONFLICTING_TERMINAL_RECORDS', 'QUARANTINE_HASH_MISMATCH', 'QUARANTINE_BINDING_MISMATCH',
  'QUARANTINE_TIME_MISMATCH', 'AUTHORITY_UNKNOWN', 'AUTHORITY_REFUSED',
  'APPROVAL_BINDING_MISMATCH', 'APPROVAL_EXPIRED_OR_FUTURE', 'APPROVAL_SIGNATURE_INVALID',
  'AUTHORITY_KEY_TYPE', 'HISTORY_CHANGED_DURING_READ', 'QUARANTINE_DECISION_ID_REUSED',
]);
/** A point-in-time journal read, not a lease, acquisition, source check or release. */
export function inspectRefresh(options: RefreshReadOptions) {
  const base = { schema: 'payload.industrial-refresh-status.v1' as const,
    verificationScope: 'JOURNAL_ONLY' as const, executionAuthorized: false,
    sourceFreshness: 'NOT_CHECKED' as const, canonicalAdmission: false, release: null };
  try {
    instant.parse(options.at);
    const { schedule } = refreshBinding(options.schedule, options.operation);
    const blocked = () => ({ ...base, at: options.at, scheduleId: schedule.scheduleId,
      status: 'LOCKED' as const, reasonCode: 'LOCK_OWNER_NOT_ASSESSED', historyDigest: null, plan: null, attempts: null, lastCapture: null });
    if (lockPresent(options.root, schedule.scheduleId)) return blocked();
    const history = readRefreshHistory(options);
    const confirm = readRefreshHistory(options);
    if (lockPresent(options.root, schedule.scheduleId)) return blocked();
    check(history.historyDigest === confirm.historyDigest, 'HISTORY_CHANGED_DURING_READ');
    const captures = history.slots.filter(s => s.receipt?.state === 'CAPTURED').sort((a, b) => a.receipt!.finishedAt.localeCompare(b.receipt!.finishedAt));
    const last = captures.at(-1);
    const plan = historyPlan(history, options.at);
    return { ...base, at: options.at, scheduleId: schedule.scheduleId,
      status: !history.initialized ? 'UNINITIALIZED' as const : plan.decision === 'HISTORY_INCOMPLETE' ? 'BLOCKED' as const : 'INSPECTED' as const,
      reasonCode: null, historyDigest: history.historyDigest, plan,
      attempts: history.slots.map(s => ({ attemptId: s.attemptId, startedAt: s.intent.startedAt,
        executionState: s.receipt?.state ?? 'INCOMPLETE', schedulerState: s.schedulerState,
        quarantineDigest: s.quarantine?.digest ?? null })),
      lastCapture: last ? { attemptId: last.attemptId, finishedAt: last.receipt!.finishedAt,
        journalAgeMs: Date.parse(options.at) - Date.parse(last.receipt!.finishedAt),
        result: last.receipt!.result } : null };
  } catch (error) {
    const code = error instanceof Error && READ_REASONS.has(error.message) ? error.message : 'INVALID_REFRESH_JOURNAL';
    return { ...base, status: 'UNAVAILABLE' as const, reasonCode: code, historyDigest: null,
      plan: null, attempts: null, lastCapture: null };
  }
}
