/** One external invocation, one durable schedule decision; no hidden timers or auto-admission. */
import { mkdirSync, rmdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { publishImmutableFile } from '../data-os/local-files';
import { encodeLocalRecord } from '../data-os/local-record';
import { check, commitment, instant, LIMIT, type AuthorityKey } from './authority';
import { historyPlan, readRefreshHistory, refreshBinding, refreshResultSchema, regularDirectory } from './refresh-state';
import type { RefreshResult } from './refresh-state';
export type { RefreshResult } from './refresh-state';

export async function refreshOnce(options: { root: string; schedule: unknown; operation: unknown; now: () => string;
  authorityKeys?: readonly AuthorityKey[];
  /** Trusted process adapter, never code taken from a schedule or HTTP request. */
  execute: (attemptDirectory: string) => Promise<RefreshResult> }) {
  const { schedule, binding, scheduleDigest, operationDigest } = refreshBinding(options.schedule, options.operation);
  const at = instant.parse(options.now());
  const root = resolve(options.root);
  mkdirSync(root, { recursive: true, mode: 0o700 }); regularDirectory(root);
  const control = join(root, schedule.scheduleId);
  mkdirSync(control, { recursive: true, mode: 0o700 }); regularDirectory(control);
  const lock = join(control, 'lock');
  try { mkdirSync(lock, { mode: 0o700 }); } catch { throw new Error('REFRESH_LOCKED'); }
  try {
    publishImmutableFile(control, ['binding.json'], encodeLocalRecord(binding, LIMIT), LIMIT);
    const attempts = join(control, 'attempts');
    mkdirSync(attempts, { recursive: true, mode: 0o700 }); regularDirectory(attempts);
    const history = readRefreshHistory({ ...options, at });
    const plan = historyPlan(history, at);
    if (!plan.collects) return { plan, attemptId: null, receipt: null };
    const attemptId = randomUUID(), intent = { schema: 'payload.industrial-refresh-intent.v1' as const,
      attemptId, scheduleDigest, operationDigest, startedAt: at };
    // Same v1 bytes. An interrupted process still leaves INCOMPLETE, never an inferred failure.
    publishImmutableFile(control, ['attempts', attemptId, 'intent.json'], encodeLocalRecord(intent), LIMIT);
    let result: RefreshResult | null = null, reason: 'CAPTURE_PIPELINE_FAILED' | null = null;
    try { result = refreshResultSchema.parse(await options.execute(join(attempts, attemptId))); }
    catch { reason = 'CAPTURE_PIPELINE_FAILED'; }
    const finishedAt = instant.parse(options.now());
    check(Date.parse(finishedAt) >= Date.parse(at), 'CLOCK_ROLLBACK');
    const body = { schema: 'payload.industrial-refresh-receipt.v1' as const, intentDigest: commitment(intent),
      finishedAt, state: result ? 'CAPTURED' as const : 'FAILED' as const, result, reason };
    const receipt = { ...body, digest: commitment(body) };
    publishImmutableFile(control, ['attempts', attemptId, 'receipt.json'], encodeLocalRecord(receipt), LIMIT);
    return { plan, attemptId, receipt };
  } finally { rmdirSync(lock); }
}
