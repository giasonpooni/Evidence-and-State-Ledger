/** Real process interruption and mutual exclusion, using synthetic source results only. */
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { buildSync } from 'esbuild';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, rmdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { commitment, type AuthorityKey } from './authority';
import { encodeLocalRecord } from '../data-os/local-record';
import { inspectRefresh } from './refresh-state';
import { prepareRefreshQuarantine, quarantineRefresh } from './refresh-quarantine';

const at = '2026-09-29T12:00:00.000Z', later = '2026-09-29T14:00:00.000Z', end = '2026-10-02T00:00:00.000Z';
const schedule = { schema: 'payload.capture-schedule.v1', scheduleId: 'process-test', sourceId: 'industrial-noaa-usgs',
  minimumIntervalHours: 1, notBefore: at, notAfter: end, maxRuns: 3, enabled: true };
const operation = { schema: 'synthetic:process-recovery.v1', admission: 'NEVER', release: 'NEVER' };
const result = { captureDigest: commitment('synthetic:capture'), reviewDigest: commitment('synthetic:review'),
  compiledDigest: commitment('synthetic:compiled'), canonicalAdmission: false, release: null };
let worker = '', bundleRoot = '';
const roots: string[] = [], children: ChildProcess[] = [];
const temp = () => { const dir = mkdtempSync(join(tmpdir(), 'esm-refresh-process-')); roots.push(dir); return dir; };
beforeAll(() => {
  bundleRoot = mkdtempSync(join(tmpdir(), 'esm-refresh-worker-')); worker = join(bundleRoot, 'worker.mjs');
  buildSync({ stdin: { resolveDir: process.cwd(), contents: `
    import {refreshOnce} from ${JSON.stringify(resolve('src/industrial-operations/refresh.ts'))};
    const schedule=${JSON.stringify(schedule)}, operation=${JSON.stringify(operation)}, result=${JSON.stringify(result)};
    try {
      const output=await refreshOnce({root:process.argv[2],schedule,operation,now:()=>${JSON.stringify(at)},execute:async()=>{
        if(process.argv[3]==='hold'){
          process.send?.({kind:'INTENT_RETAINED'});
          await new Promise(()=>{setInterval(()=>{},1000);});
        }
        return result;
      }});
      console.log(JSON.stringify({decision:output.plan.decision}));
    } catch(error) {console.log(JSON.stringify({error:error.message}));process.exitCode=1;}
  ` }, outfile: worker, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
});
afterEach(async () => {
  for (const child of children.splice(0)) if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await once(child, 'exit'); }
  roots.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true }));
});
afterAll(() => rmSync(bundleRoot, { recursive: true, force: true }));
async function heldWorker(root: string) {
  const child = spawn(process.execPath, [worker, root, 'hold'], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  children.push(child);
  await new Promise<void>((done, fail) => {
    const timer = setTimeout(() => { cleanup(); fail(Error('WORKER_READINESS_TIMEOUT')); }, 10000);
    const ready = (value: unknown) => { if ((value as { kind?: string }).kind === 'INTENT_RETAINED') { cleanup(); done(); } };
    const error = () => { cleanup(); fail(Error('WORKER_START_FAILED')); };
    const cleanup = () => { clearTimeout(timer); child.off('message', ready); child.off('error', error); child.off('exit', error); };
    child.on('message', ready); child.on('error', error); child.on('exit', error);
  });
  return child;
}
const options = (root: string) => ({ root, schedule: { ...schedule, enabled: false }, operation, at: later });

it('two separate processes cannot execute inside the same refresh slot', async () => {
  const root = temp(); await heldWorker(root);
  const second = spawnSync(process.execPath, [worker, root, 'capture'], { encoding: 'utf8', timeout: 15000 });
  expect(second.status).toBe(1); expect(JSON.parse(second.stdout).error).toBe('REFRESH_LOCKED');
  expect(readdirSync(join(root, schedule.scheduleId, 'attempts'))).toHaveLength(1);
  expect(inspectRefresh(options(root)).status).toBe('LOCKED');
});
it('SIGKILL leaves a visible orphan lock that no recovery command auto-clears', async () => {
  const root = temp(), child = await heldWorker(root);
  child.kill('SIGKILL'); await once(child, 'exit');
  const attemptId = readdirSync(join(root, schedule.scheduleId, 'attempts'))[0];
  expect(inspectRefresh(options(root))).toMatchObject({ status: 'LOCKED', reasonCode: 'LOCK_OWNER_NOT_ASSESSED', plan: null });
  expect(() => prepareRefreshQuarantine({ ...options(root), attemptId })).toThrow('REFRESH_LOCKED');
  expect(existsSync(join(root, schedule.scheduleId, 'lock'))).toBe(true);
  expect(existsSync(join(root, schedule.scheduleId, 'attempts', attemptId, 'receipt.json'))).toBe(false);
});
it('after proven worker exit, explicit fixture maintenance and signing retain the unresolved attempt', async () => {
  const root = temp(), child = await heldWorker(root);
  child.kill('SIGKILL'); await once(child, 'exit');
  const attemptId = readdirSync(join(root, schedule.scheduleId, 'attempts'))[0], dir = join(root, schedule.scheduleId, 'attempts', attemptId);
  const original = readFileSync(join(dir, 'intent.json'));
  // Administrative fixture action AFTER the OS reports exit. The product has no unlock command.
  rmdirSync(join(root, schedule.scheduleId, 'lock'));
  expect(inspectRefresh(options(root)).status).toBe('BLOCKED');
  const request = prepareRefreshQuarantine({ ...options(root), attemptId });
  const pair = generateKeyPairSync('ed25519');
  const key: AuthorityKey = { keyId: 'key:process-fixture', authorityId: 'role:maintenance-fixture', actions: ['QUARANTINE_REFRESH'],
    publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(), notBefore: at, notAfter: end, revoked: false };
  const body = { schema: 'payload.industrial-approval.v1', decisionId: 'decision:process-fixture', action: 'QUARANTINE_REFRESH',
    authorityId: key.authorityId, keyId: key.keyId, targetDigest: commitment(request), issuedAt: later, notAfter: end };
  const approval = { ...body, signature: sign(null, encodeLocalRecord(body), pair.privateKey).toString('base64url') };
  const r = quarantineRefresh({ ...options(root), request, approval, authorityKeys: [key] });
  expect(r.plan.runsSpent).toBe(1); expect(r.plan.decision).toBe('DISABLED'); expect(r.sourceEffects).toBe('UNKNOWN');
  expect(readFileSync(join(dir, 'intent.json'))).toEqual(original); expect(existsSync(join(dir, 'receipt.json'))).toBe(false);
  expect(inspectRefresh({ ...options(root), authorityKeys: [key] }).attempts?.[0]).toMatchObject({ executionState: 'INCOMPLETE', schedulerState: 'QUARANTINED' });
});
