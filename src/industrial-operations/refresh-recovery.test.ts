import { afterEach, expect, it, vi } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeLocalRecord } from '../data-os/local-record';
import * as files from '../data-os/local-files';
import { commitment, verifyApproval, type AuthorityKey } from './authority';
import { refreshOnce } from './refresh';
import { inspectRefresh, readRefreshHistory, type QuarantineRequest } from './refresh-state';
import { prepareRefreshQuarantine, quarantineRefresh } from './refresh-quarantine';

const at = '2026-09-29T12:00:00.000Z', later = '2026-09-29T14:00:00.000Z', end = '2026-10-02T00:00:00.000Z';
const roots: string[] = [];
const temp = () => { const p = mkdtempSync(join(tmpdir(), 'esm-recovery-test-')); roots.push(p); return p; };
afterEach(() => { vi.restoreAllMocks(); roots.splice(0).forEach(p => rmSync(p, { recursive: true, force: true })); });
const schedule = () => ({ schema: 'payload.capture-schedule.v1', scheduleId: 'recovery-test', sourceId: 'industrial-noaa-usgs',
  minimumIntervalHours: 1, notBefore: at, notAfter: end, maxRuns: 3, enabled: true });
const operation = { schema: 'synthetic:recovery-operation.v1', admission: 'NEVER', release: 'NEVER' };
const result = { captureDigest: commitment('synthetic:capture'), reviewDigest: commitment('synthetic:review'),
  compiledDigest: commitment('synthetic:compiled'), canonicalAdmission: false as const, release: null };
function signing() {
  const pair = generateKeyPairSync('ed25519');
  const key: AuthorityKey = { keyId: 'key:recovery-test', authorityId: 'role:maintenance-test',
    publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    actions: ['QUARANTINE_REFRESH'], notBefore: at, notAfter: end, revoked: false };
  const approve = (request: unknown, issuedAt = later, notAfter = end) => {
    const body = { schema: 'payload.industrial-approval.v1' as const, decisionId: 'decision:synthetic-maintenance',
      action: 'QUARANTINE_REFRESH' as const, authorityId: key.authorityId, keyId: key.keyId,
      targetDigest: commitment(request), issuedAt, notAfter };
    return { ...body, signature: sign(null, encodeLocalRecord(body), pair.privateKey).toString('base64url') };
  };
  return { key, approve };
}
async function interrupted(maxRuns = 3) {
  const root = temp(), s = { ...schedule(), maxRuns }; let calls = 0;
  await expect(refreshOnce({ root, schedule: s, operation, now: () => ++calls === 1 ? at : 'INVALID', execute: async () => result })).rejects.toThrow();
  const attemptId = readdirSync(join(root, s.scheduleId, 'attempts'))[0];
  const state = { root, schedule: { ...s, enabled: false }, operation, at: later };
  return { root, s, attemptId, state, dir: join(root, s.scheduleId, 'attempts', attemptId) };
}
function bytesTree(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string, prefix = '') => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const name = prefix + item.name;
      if (item.isDirectory()) { out[name + '/'] = 'directory'; walk(join(dir, item.name), name + '/'); }
      else out[name] = readFileSync(join(dir, item.name)).toString('base64');
    }
  };
  walk(root); return out;
}
async function quarantined() {
  const x = await interrupted(), signer = signing();
  const request = prepareRefreshQuarantine({ ...x.state, attemptId: x.attemptId });
  const approval = signer.approve(request);
  const r = quarantineRefresh({ ...x.state, request, approval, authorityKeys: [signer.key] });
  return { ...x, ...signer, request, approval, r };
}

it('inspection of an absent root is read-only and distinguishes never-run from epoch', () => {
  const root = join(temp(), 'absent');
  const r = inspectRefresh({ root, schedule: schedule(), operation, at });
  expect(r.status).toBe('UNINITIALIZED'); expect(r.plan?.runsSpent).toBe(0);
  expect(r.lastCapture).toBe(null); expect(r.plan?.lastRunAt).toBe(null); expect(r.executionAuthorized).toBe(false);
  expect(existsSync(root)).toBe(false);
});
it('inspects exact v1 receipts without modifying bytes or implying source freshness', async () => {
  const root = temp(); await refreshOnce({ root, schedule: schedule(), operation, now: () => at, execute: async () => result });
  const before = bytesTree(root), r = inspectRefresh({ root, schedule: schedule(), operation, at: later });
  expect(r.status).toBe('INSPECTED'); expect(r.plan?.decision).toBe('DUE'); expect(r.plan?.runsSpent).toBe(1);
  expect(r.lastCapture?.journalAgeMs).toBe(7200000); expect(r.lastCapture?.result).toEqual(result);
  expect(r.sourceFreshness).toBe('NOT_CHECKED'); expect(r.verificationScope).toBe('JOURNAL_ONLY'); expect(bytesTree(root)).toEqual(before);
});
it('failed acquisition remains spent with no invented latest success', async () => {
  const root = temp(); await refreshOnce({ root, schedule: schedule(), operation, now: () => at, execute: async () => { throw Error('PRIVATE'); } });
  const r = inspectRefresh({ root, schedule: schedule(), operation, at: later });
  expect(r.attempts?.[0].executionState).toBe('FAILED'); expect(r.plan?.runsSpent).toBe(1); expect(r.lastCapture).toBe(null);
});
it('unresolved history blocks even a disabled schedule', async () => {
  const x = await interrupted(), before = bytesTree(x.root), r = inspectRefresh(x.state);
  expect(r.status).toBe('BLOCKED'); expect(r.plan?.decision).toBe('HISTORY_INCOMPLETE'); expect(bytesTree(x.root)).toEqual(before);
});
it('never treats an existing lock as proof that a worker is alive or dead', async () => {
  const x = await interrupted(); mkdirSync(join(x.root, x.s.scheduleId, 'lock'));
  const before = bytesTree(x.root), r = inspectRefresh(x.state);
  expect(r.status).toBe('LOCKED'); expect(r.reasonCode).toBe('LOCK_OWNER_NOT_ASSESSED'); expect(r.plan).toBe(null);
  expect(bytesTree(x.root)).toEqual(before);
  expect(() => prepareRefreshQuarantine({ ...x.state, attemptId: x.attemptId })).toThrow('REFRESH_LOCKED');
});
it('preparation is a reference-only unsigned request and creates nothing', async () => {
  const x = await interrupted(), before = bytesTree(x.root);
  const q = prepareRefreshQuarantine({ ...x.state, attemptId: x.attemptId });
  expect(q.expectedHistoryDigest).toBe(inspectRefresh(x.state).historyDigest);
  expect(q.executionOutcome).toBe('UNKNOWN'); expect(q.canonicalAdmission).toBe(false); expect(q.release).toBe(null);
  expect(bytesTree(x.root)).toEqual(before); expect(JSON.stringify(q)).not.toContain(x.root);
});
it('a separate signature quarantines the scheduling block without fabricating a receipt', async () => {
  const x = await interrupted(), signer = signing(), original = readFileSync(join(x.dir, 'intent.json'));
  const request = prepareRefreshQuarantine({ ...x.state, attemptId: x.attemptId });
  const r = quarantineRefresh({ ...x.state, request, approval: signer.approve(request), authorityKeys: [signer.key] });
  expect(r.plan.decision).toBe('DISABLED'); expect(r.plan.runsSpent).toBe(1); expect(r.slotReclaimed).toBe(false);
  expect(r.sourceEffects).toBe('UNKNOWN'); expect(r.captureExecuted).toBe(false);
  expect(readFileSync(join(x.dir, 'intent.json'))).toEqual(original); expect(existsSync(join(x.dir, 'receipt.json'))).toBe(false);
  const status = inspectRefresh({ ...x.state, authorityKeys: [signer.key] });
  expect(status.attempts?.[0]).toMatchObject({ executionState: 'INCOMPLETE', schedulerState: 'QUARANTINED' });
});
it('explicit re-enable continues at the original budget and cadence with a distinct attempt', async () => {
  const x = await quarantined(); let calls = 0;
  const r = await refreshOnce({ root: x.root, schedule: x.s, operation, now: () => later, authorityKeys: [x.key], execute: async () => { calls++; return result; } });
  expect(calls).toBe(1); expect(r.plan.runsSpent).toBe(1); expect(r.receipt?.state).toBe('CAPTURED'); expect(r.attemptId).not.toBe(x.attemptId);
  expect(inspectRefresh({ ...x.state, authorityKeys: [x.key] }).plan?.runsSpent).toBe(2);
});
it('quarantine never refunds an exhausted acquisition budget', async () => {
  const x = await interrupted(1), signer = signing(), request = prepareRefreshQuarantine({ ...x.state, attemptId: x.attemptId });
  quarantineRefresh({ ...x.state, request, approval: signer.approve(request), authorityKeys: [signer.key] });
  const r = await refreshOnce({ root: x.root, schedule: x.s, operation, now: () => later, authorityKeys: [signer.key], execute: async () => { throw Error('must not execute'); } });
  expect(r.plan.decision).toBe('RUN_BUDGET_SPENT'); expect(r.plan.runsRemaining).toBe(0);
});
it('an act remains verifiable after its approval expires but is not renewed', async () => {
  const x = await interrupted(), signer = signing(), request = prepareRefreshQuarantine({ ...x.state, attemptId: x.attemptId });
  const approval = signer.approve(request, later, '2026-09-29T14:01:00.000Z');
  quarantineRefresh({ ...x.state, request, approval, authorityKeys: [signer.key] });
  const r = inspectRefresh({ ...x.state, authorityKeys: [signer.key], at: '2026-09-29T15:00:00.000Z' });
  expect(r.status).toBe('INSPECTED'); expect(r.attempts?.[0].schedulerState).toBe('QUARANTINED');
});
it.each(['missing', 'revoked', 'role-removed'])('missing current trust (%s) blocks use of historical quarantine', async kind => {
  const x = await quarantined(); let keys = [x.key];
  if (kind === 'missing') keys = []; if (kind === 'revoked') x.key.revoked = true; if (kind === 'role-removed') x.key.actions = ['RELEASE'];
  const before = bytesTree(x.root), r = inspectRefresh({ ...x.state, authorityKeys: keys });
  expect(r.status).toBe('UNAVAILABLE'); expect(r.plan).toBe(null); expect(bytesTree(x.root)).toEqual(before);
  await expect(refreshOnce({ root: x.root, schedule: x.s, operation, now: () => later, authorityKeys: keys, execute: async () => result })).rejects.toThrow();
});
it.each(['ADMIT', 'RELEASE'] as const)('quarantine-only authority cannot authorize %s', async action => {
  const x = await quarantined(); expect(() => verifyApproval(x.approval, action, x.request, [x.key], later)).toThrow('AUTHORITY_REFUSED');
});
it.each(['wrong-signature', 'wrong-key', 'expired', 'future', 'wrong-action', 'altered-request'])('rejects %s without new history records', async kind => {
  const x = await interrupted(), signer = signing(), request = prepareRefreshQuarantine({ ...x.state, attemptId: x.attemptId });
  const approval = signer.approve(request); const keys = [signer.key];
  if (kind === 'wrong-signature') approval.signature = 'A'.repeat(86);
  if (kind === 'wrong-key') keys[0] = { ...signer.key, publicKeyPem: signing().key.publicKeyPem };
  if (kind === 'expired') approval.notAfter = later;
  if (kind === 'future') approval.issuedAt = '2026-09-29T15:00:00.000Z';
  if (kind === 'wrong-action') keys[0] = { ...signer.key, actions: ['ADMIT'] };
  if (kind === 'altered-request') request.preparedAt = at;
  const before = bytesTree(x.root);
  expect(() => quarantineRefresh({ ...x.state, request, approval, authorityKeys: keys })).toThrow(); expect(bytesTree(x.root)).toEqual(before);
});
it('enabled schedules cannot be prepared or quarantined', async () => {
  const x = await interrupted(), signer = signing(), request = prepareRefreshQuarantine({ ...x.state, attemptId: x.attemptId });
  expect(() => prepareRefreshQuarantine({ ...x.state, schedule: x.s, attemptId: x.attemptId })).toThrow('DISABLE_SCHEDULE_BEFORE_QUARANTINE');
  expect(() => quarantineRefresh({ ...x.state, schedule: x.s, request, approval: signer.approve(request), authorityKeys: [signer.key] })).toThrow('DISABLE_SCHEDULE_BEFORE_QUARANTINE');
});
it('a lock appearing after preparation is never removed or overridden', async () => {
  const x = await interrupted(), signer = signing(), request = prepareRefreshQuarantine({ ...x.state, attemptId: x.attemptId });
  mkdirSync(join(x.root, x.s.scheduleId, 'lock')); const before = bytesTree(x.root);
  expect(() => quarantineRefresh({ ...x.state, request, approval: signer.approve(request), authorityKeys: [signer.key] })).toThrow('REFRESH_LOCKED');
  expect(bytesTree(x.root)).toEqual(before);
});
it('a second signed act cannot replace the first terminal disposition', async () => {
  const x = await quarantined(), before = bytesTree(x.root);
  expect(() => quarantineRefresh({ ...x.state, request: x.request, approval: x.approval, authorityKeys: [x.key] })).toThrow('ATTEMPT_ALREADY_TERMINAL');
  expect(bytesTree(x.root)).toEqual(before);
});
it('a different journal snapshot invalidates even a valid operator signature', async () => {
  const x = await interrupted(), signer = signing(), request = prepareRefreshQuarantine({ ...x.state, attemptId: x.attemptId });
  const original = JSON.parse(readFileSync(join(x.dir, 'intent.json'), 'utf8'));
  const another = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  files.publishImmutableFile(join(x.root, x.s.scheduleId), ['attempts', another, 'intent.json'], encodeLocalRecord({ ...original, attemptId: another }), 4096);
  const before = bytesTree(x.root);
  expect(() => quarantineRefresh({ ...x.state, request, approval: signer.approve(request), authorityKeys: [signer.key] })).toThrow('HISTORY_CHANGED_SINCE_PREPARATION');
  expect(bytesTree(x.root)).toEqual(before);
});
it('observation effects cannot be renamed into an asserted failure in the request', async () => {
  const x = await interrupted(), signer = signing(), q = prepareRefreshQuarantine({ ...x.state, attemptId: x.attemptId });
  const request = { ...q, executionOutcome: 'FAILED' };
  expect(() => quarantineRefresh({ ...x.state, request, approval: signer.approve(request), authorityKeys: [signer.key] })).toThrow();
});
it('forbids backdating preparation before the original intent', async () => {
  const x = await interrupted(), signer = signing();
  const request: QuarantineRequest = { ...prepareRefreshQuarantine({ ...x.state, attemptId: x.attemptId }), preparedAt: '2026-09-29T11:00:00.000Z' };
  expect(() => quarantineRefresh({ ...x.state, request, approval: signer.approve(request), authorityKeys: [signer.key] })).toThrow('QUARANTINE_TIME_MISMATCH');
});
it('cannot sign a request before the recorded preparation time', async () => {
  const x = await interrupted(), signer = signing(), request = prepareRefreshQuarantine({ ...x.state, attemptId: x.attemptId });
  expect(() => quarantineRefresh({ ...x.state, request, approval: signer.approve(request, at), authorityKeys: [signer.key] })).toThrow('QUARANTINE_TIME_MISMATCH');
});
it('a late completion conflicts with quarantine rather than silently winning', async () => {
  const x = await quarantined(); const body = { schema: 'payload.industrial-refresh-receipt.v1',
    intentDigest: x.request.intentDigest, finishedAt: later, state: 'CAPTURED', result, reason: null };
  writeFileSync(join(x.dir, 'receipt.json'), encodeLocalRecord({ ...body, digest: commitment(body) }));
  const r = inspectRefresh({ ...x.state, authorityKeys: [x.key] });
  expect(r.status).toBe('UNAVAILABLE'); expect(r.reasonCode).toBe('CONFLICTING_TERMINAL_RECORDS'); expect(r.lastCapture).toBe(null);
});
it.each(['body', 'signature', 'attempt', 'clock'])('detects tampered quarantine %s', async kind => {
  const x = await quarantined(), file = join(x.dir, 'quarantine.json');
  const value = JSON.parse(readFileSync(file, 'utf8'));
  if (kind === 'body') value.request.expectedHistoryDigest = commitment('changed');
  if (kind === 'signature') { value.approval.signature = 'A'.repeat(86); const { digest, ...body } = value; void digest; value.digest = commitment(body); }
  if (kind === 'attempt') { value.request.attemptId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'; const { digest, ...body } = value; void digest; value.digest = commitment(body); }
  if (kind === 'clock') { value.recordedAt = end; const { digest, ...body } = value; void digest; value.digest = commitment(body); }
  writeFileSync(file, encodeLocalRecord(value)); const r = inspectRefresh({ ...x.state, authorityKeys: [x.key] });
  expect(r.status).toBe('UNAVAILABLE'); expect(r.plan).toBe(null);
});
it.each(['invalid-json', 'duplicate-json', 'future', 'missing-binding', 'unknown-entry', 'receipt-digest'])('refuses journal %s without diagnostic payload leakage', async kind => {
  const x = await interrupted();
  if (kind === 'invalid-json') writeFileSync(join(x.dir, 'intent.json'), 'SECRET_PRIVATE malformed');
  if (kind === 'duplicate-json') writeFileSync(join(x.dir, 'intent.json'), '{"attemptId":"SECRET_PRIVATE","attemptId":"x"}');
  if (kind === 'future') { const v = JSON.parse(readFileSync(join(x.dir, 'intent.json'), 'utf8')); v.startedAt = end; writeFileSync(join(x.dir, 'intent.json'), encodeLocalRecord(v)); }
  if (kind === 'missing-binding') rmSync(join(x.root, x.s.scheduleId, 'binding.json'));
  if (kind === 'unknown-entry') mkdirSync(join(x.root, x.s.scheduleId, 'attempts', 'SECRET_PRIVATE'));
  if (kind === 'receipt-digest') writeFileSync(join(x.dir, 'receipt.json'), encodeLocalRecord({ schema: 'payload.industrial-refresh-receipt.v1', intentDigest: commitment('bad'), finishedAt: later, state: 'CAPTURED', result, reason: null, digest: commitment('invalid') }));
  const before = bytesTree(x.root), r = inspectRefresh(x.state);
  expect(r.status).toBe('UNAVAILABLE'); expect(r.plan).toBe(null); expect(JSON.stringify(r)).not.toContain('SECRET_PRIVATE'); expect(bytesTree(x.root)).toEqual(before);
});
it('symlinked attempts never become a new journal', async () => {
  const root = temp(), other = temp(); mkdirSync(join(root, 'recovery-test')); symlinkSync(other, join(root, 'recovery-test', 'attempts'));
  const r = inspectRefresh({ root, schedule: schedule(), operation, at }); expect(r.status).toBe('UNAVAILABLE'); expect(r.reasonCode).toBe('UNSAFE_REFRESH_ROOT');
});
it('read-only status detects a concurrent journal change between snapshots', async () => {
  const x = await interrupted(), original = files.readImmutableFile; let reads = 0;
  vi.spyOn(files, 'readImmutableFile').mockImplementation((root, segments, max) => {
    if (segments[0] === 'binding.json' && ++reads === 2) {
      const v = JSON.parse(readFileSync(join(x.dir, 'intent.json'), 'utf8')), another = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
      mkdirSync(join(root, 'attempts', another)); writeFileSync(join(root, 'attempts', another, 'intent.json'), encodeLocalRecord({ ...v, attemptId: another }));
    }
    return original(root, segments, max);
  });
  expect(inspectRefresh(x.state)).toMatchObject({ status: 'UNAVAILABLE', reasonCode: 'HISTORY_CHANGED_DURING_READ', plan: null });
});
it('schedule rebinding cannot reset a recovered budget', async () => {
  const x = await quarantined(); expect(inspectRefresh({ ...x.state, schedule: { ...x.s, maxRuns: 20 }, authorityKeys: [x.key] }).reasonCode).toBe('HISTORY_BINDING_MISMATCH');
});
it('the normal journal reader and inspector agree on exact history digests', async () => {
  const x = await quarantined(), options = { ...x.state, authorityKeys: [x.key] };
  expect(readRefreshHistory(options).historyDigest).toBe(inspectRefresh(options).historyDigest);
});

it('a separately signed second quarantine still requires a distinct decision identity', async () => {
  const x = await quarantined(), v = JSON.parse(readFileSync(join(x.dir, 'intent.json'), 'utf8'));
  const attemptId = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';
  files.publishImmutableFile(join(x.root, x.s.scheduleId), ['attempts', attemptId, 'intent.json'], encodeLocalRecord({ ...v, attemptId }), 4096);
  const request = prepareRefreshQuarantine({ ...x.state, authorityKeys: [x.key], attemptId });
  expect(() => quarantineRefresh({ ...x.state, request, approval: x.approve(request), authorityKeys: [x.key] })).toThrow('QUARANTINE_DECISION_ID_REUSED');
  expect(existsSync(join(x.root, x.s.scheduleId, 'attempts', attemptId, 'quarantine.json'))).toBe(false);
});
