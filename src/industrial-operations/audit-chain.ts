/** Tamper-evident local operations journal. This is not physical WORM storage. */
import { mkdirSync, readdirSync, rmdirSync, lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { parseReplayJson } from '../observation/json';
import { readImmutableFile, publishImmutableFile } from '../data-os/local-files';
import { encodeLocalRecord } from '../data-os/local-record';
import { check, commitment, hash, id, instant, LIMIT } from './authority';

const eventType = z.enum([
  'SESSION_ISSUED','SESSION_CLEARED','DELIVERY_SUCCESS','REQUEST_REFUSED',
  'READINESS_CHECK','INTEGRITY_SNAPSHOT','INTEGRITY_VERIFY',
]);
const outcome = z.enum(['SUCCESS','REFUSED','ERROR']);
const detail = z.string().regex(/^[A-Z0-9_]{3,80}$/);

export const auditEventSchema = z.object({
  schema: z.literal('payload.industrial-audit-event.v1'),
  sequence: z.number().int().positive().max(1_000_000_000),
  previousDigest: hash.nullable(), at: instant, event: eventType, outcome,
  actorRef: id.nullable(), artifactDigest: hash.nullable(), payloadDigest: hash.nullable(),
  detailCode: detail.nullable(), digest: hash,
}).strict();
export type AuditEvent = z.infer<typeof auditEventSchema>;
export type AuditEventInput = Omit<AuditEvent,'schema'|'sequence'|'previousDigest'|'digest'>;

function errno(error: unknown) { return (error as NodeJS.ErrnoException)?.code; }
function directory(path: string, create=false): boolean {
  try {
    const s=lstatSync(path); check(s.isDirectory()&&!s.isSymbolicLink(),'AUDIT_UNSAFE_DIRECTORY'); return true;
  } catch(error) {
    if(errno(error)!=='ENOENT') throw error;
    if(!create) return false;
    mkdirSync(path,{recursive:true,mode:0o700});
    const s=lstatSync(path); check(s.isDirectory()&&!s.isSymbolicLink(),'AUDIT_UNSAFE_DIRECTORY'); return true;
  }
}
function chainDirectory(root:string,create=false){const base=resolve(root);if(!directory(base,create))return null;const chain=join(base,'chain');return directory(chain,create)?chain:null;}
function names(chain:string):string[]{
  const values=readdirSync(chain).sort();
  check(values.length<=100000,'AUDIT_CHAIN_LIMIT');
  values.forEach((name,i)=>check(name===String(i+1).padStart(12,'0')+'.json','AUDIT_CHAIN_GAP'));
  return values;
}
function readEvent(chain:string,name:string):AuditEvent{
  const bytes=readImmutableFile(chain,[name],LIMIT);check(bytes,'AUDIT_EVENT_MISSING');
  const event=auditEventSchema.parse(parseReplayJson(bytes,LIMIT));
  const {digest,...body}=event;check(commitment(body)===digest,'AUDIT_EVENT_HASH_MISMATCH');
  return event;
}
export function auditTail(root:string){
  const chain=chainDirectory(root,false);if(!chain)return {eventCount:0,headDigest:null as string|null,locked:false};
  const base=resolve(root),locked=directory(join(base,'audit.lock'),false);
  const list=names(chain);if(!list.length)return {eventCount:0,headDigest:null as string|null,locked};
  const event=readEvent(chain,list.at(-1)!);
  check(event.sequence===list.length,'AUDIT_CHAIN_GAP');
  return {eventCount:list.length,headDigest:event.digest,locked};
}
export function verifyAuditChain(root:string){
  const chain=chainDirectory(root,false);if(!chain)return {status:'VALID' as const,eventCount:0,headDigest:null as string|null,chainDigest:commitment({schema:'payload.industrial-audit-chain.v1',events:[]})};
  const list=names(chain);let previous:string|null=null;const digests:string[]=[];
  list.forEach((name,i)=>{const e=readEvent(chain,name);check(e.sequence===i+1&&e.previousDigest===previous,'AUDIT_CHAIN_LINK_MISMATCH');previous=e.digest;digests.push(e.digest);});
  return {status:'VALID' as const,eventCount:list.length,headDigest:previous,chainDigest:commitment({schema:'payload.industrial-audit-chain.v1',events:digests})};
}
export function appendAuditEvent(root:string,input:AuditEventInput):AuditEvent{
  instant.parse(input.at);eventType.parse(input.event);outcome.parse(input.outcome);
  if(input.actorRef!==null)id.parse(input.actorRef);if(input.artifactDigest!==null)hash.parse(input.artifactDigest);
  if(input.payloadDigest!==null)hash.parse(input.payloadDigest);if(input.detailCode!==null)detail.parse(input.detailCode);
  const base=resolve(root);directory(base,true);chainDirectory(base,true);
  const lock=join(base,'audit.lock');try{mkdirSync(lock,{mode:0o700});}catch{throw new Error('AUDIT_CHAIN_BUSY');}
  try{
    const tail=auditTail(base);check(!tail.locked||directory(lock,false),'AUDIT_CHAIN_BUSY');
    const body={schema:'payload.industrial-audit-event.v1' as const,sequence:tail.eventCount+1,previousDigest:tail.headDigest,...input};
    const event={...body,digest:commitment(body)};auditEventSchema.parse(event);
    publishImmutableFile(join(base,'chain'),[String(event.sequence).padStart(12,'0')+'.json'],encodeLocalRecord(event),LIMIT);
    const confirm=auditTail(base);check(confirm.eventCount===event.sequence&&confirm.headDigest===event.digest,'AUDIT_APPEND_NOT_VISIBLE');
    return event;
  } finally {rmdirSync(lock);}
}
