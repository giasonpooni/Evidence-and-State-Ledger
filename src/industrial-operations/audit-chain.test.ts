import {afterEach,describe,it,expect} from 'vitest';
import {mkdtempSync,rmSync,writeFileSync,mkdirSync,readdirSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {appendAuditEvent,auditTail,verifyAuditChain} from './audit-chain';
const roots:string[]=[];afterEach(()=>roots.splice(0).forEach(x=>rmSync(x,{recursive:true,force:true})));
const root=()=>{const r=mkdtempSync(join(tmpdir(),'audit-chain-'));roots.push(r);return r;};
const event=(at:string,artifactDigest:string|null=null)=>({at,event:'DELIVERY_SUCCESS' as const,outcome:'SUCCESS' as const,actorRef:'credential:test',artifactDigest,payloadDigest:null,detailCode:null});
describe('industrial audit chain',()=>{
  it('appends a contiguous hash-linked sequence',()=>{const r=root(),a=appendAuditEvent(r,event('2026-09-29T12:00:00.000Z')),b=appendAuditEvent(r,event('2026-09-29T12:00:01.000Z','sha256:'+'1'.repeat(64)));
    expect(a.sequence).toBe(1);expect(b.previousDigest).toBe(a.digest);expect(verifyAuditChain(r)).toMatchObject({status:'VALID',eventCount:2,headDigest:b.digest});});
  it('never stores bearer material supplied nowhere in the event contract',()=>{const r=root();appendAuditEvent(r,event('2026-09-29T12:00:00.000Z'));expect(readFileSync(join(r,'chain',readdirSync(join(r,'chain'))[0]),'utf8')).not.toContain('esm_');});
  it('detects a changed retained event',()=>{const r=root();appendAuditEvent(r,event('2026-09-29T12:00:00.000Z'));const f=join(r,'chain','000000000001.json');const v=JSON.parse(readFileSync(f,'utf8'));v.actorRef='credential:other';writeFileSync(f,JSON.stringify(v));expect(()=>verifyAuditChain(r)).toThrow(/AUDIT_EVENT_HASH_MISMATCH/);});
  it('detects gaps and lock state',()=>{const r=root();appendAuditEvent(r,event('2026-09-29T12:00:00.000Z'));writeFileSync(join(r,'chain','000000000003.json'),'{}');expect(()=>auditTail(r)).toThrow(/AUDIT_CHAIN_GAP/);});
  it('refuses an existing writer lock',()=>{const r=root();mkdirSync(join(r,'audit.lock'));expect(()=>appendAuditEvent(r,event('2026-09-29T12:00:00.000Z'))).toThrow(/AUDIT_CHAIN_BUSY/);});
});
