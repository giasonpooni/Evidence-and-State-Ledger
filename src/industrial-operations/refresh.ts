import { parseReplayJson } from '../observation/json';
/** One external invocation, one durable schedule decision; no hidden timers or auto-admission. */
import { mkdirSync, readdirSync, rmdirSync, lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseCaptureSchedule, planCapture, type ScheduleRun } from '../acquisition/schedule';
import { publishImmutableFile, readImmutableFile } from '../data-os/local-files';
import { encodeLocalRecord } from '../data-os/local-record';
import { check, commitment, instant, id, hash, LIMIT } from './authority';
import { z } from 'zod';
const resultSchema=z.object({captureDigest:hash,reviewDigest:hash,compiledDigest:hash,canonicalAdmission:z.literal(false),release:z.null()}).strict();
const intentSchema=z.object({schema:z.literal('payload.industrial-refresh-intent.v1'),attemptId:id,scheduleDigest:hash,operationDigest:hash,startedAt:instant}).strict();
const receiptSchema=z.object({schema:z.literal('payload.industrial-refresh-receipt.v1'),intentDigest:hash,finishedAt:instant,state:z.enum(['CAPTURED','FAILED']),result:resultSchema.nullable(),reason:z.enum(['CAPTURE_PIPELINE_FAILED']).nullable(),digest:hash}).strict();
export type RefreshResult=z.infer<typeof resultSchema>;
export async function refreshOnce(options:{root:string;schedule:unknown;operation:unknown;now:()=>string;
  /** Trusted process adapter, never code taken from a schedule or HTTP request. */
  execute:(attemptDirectory:string)=>Promise<RefreshResult>}){
  const schedule=parseCaptureSchedule(options.schedule),at=instant.parse(options.now());
  check(schedule.sourceId==='industrial-noaa-usgs','SOURCE_SCOPE_MISMATCH');
  const root=resolve(options.root);mkdirSync(root,{recursive:true,mode:0o700});check(!lstatSync(root).isSymbolicLink(),'UNSAFE_REFRESH_ROOT');
  const control=join(root,schedule.scheduleId);mkdirSync(control,{recursive:true,mode:0o700});check(!lstatSync(control).isSymbolicLink(),'UNSAFE_REFRESH_ROOT');
  const lock=join(control,'lock');try{mkdirSync(lock,{mode:0o700});}catch{throw new Error('REFRESH_LOCKED');}
  try{
    // Enabled can change without resetting history; every other declaration is immutable for this ID.
    const {enabled,...identity}=schedule;void enabled;
    const binding={schedule:identity,operation:options.operation},bound=commitment(binding);
    publishImmutableFile(control,['binding.json'],encodeLocalRecord(binding,LIMIT),LIMIT);
    const attempts=join(control,'attempts');mkdirSync(attempts,{recursive:true,mode:0o700});check(!lstatSync(attempts).isSymbolicLink(),'UNSAFE_REFRESH_ROOT');
    const names=readdirSync(attempts);check(names.length<=1000,'HISTORY_LIMIT');const history:ScheduleRun[]=[];
    for(const name of names){check(/^[0-9a-f-]{36}$/.test(name),'INVALID_HISTORY_ENTRY');
      const raw=readImmutableFile(control,['attempts',name,'intent.json'],LIMIT);check(raw,'INCOMPLETE_HISTORY_ENTRY');
      const intent=intentSchema.parse(parseReplayJson(raw,LIMIT));check(intent.attemptId===name&&intent.scheduleDigest===bound&&intent.operationDigest===commitment(options.operation),'HISTORY_BINDING_MISMATCH');
      check(Date.parse(intent.startedAt)<=Date.parse(at),'HISTORY_FROM_FUTURE');
      const done=readImmutableFile(control,['attempts',name,'receipt.json'],LIMIT);
      if(!done){history.push({startedAt:intent.startedAt,state:'INCOMPLETE'});continue;}
      const receipt=receiptSchema.parse(parseReplayJson(done,LIMIT));const {digest:recordedDigest,...receiptBody}=receipt;check(commitment(receiptBody)===recordedDigest,'RECEIPT_HASH_MISMATCH');check(receipt.intentDigest===commitment(intent)&&Date.parse(receipt.finishedAt)>=Date.parse(intent.startedAt)&&Date.parse(receipt.finishedAt)<=Date.parse(at),'RECEIPT_BINDING_MISMATCH');
      check(receipt.state==='CAPTURED'?receipt.result!==null&&receipt.reason===null:receipt.result===null&&receipt.reason!==null,'RECEIPT_RESULT_MISMATCH');
      history.push({startedAt:intent.startedAt,state:receipt.state});
    }
    const plan=planCapture(schedule,history,at);if(!plan.collects)return {plan,attemptId:null,receipt:null};
    const attemptId=randomUUID(),intent={schema:'payload.industrial-refresh-intent.v1' as const,attemptId,scheduleDigest:bound,operationDigest:commitment(options.operation),startedAt:at};
    // Durable intent precedes execution. A killed process leaves an incomplete run and a lock, not a free slot.
    publishImmutableFile(control,['attempts',attemptId,'intent.json'],encodeLocalRecord(intent),LIMIT);
    let result:RefreshResult|null=null,reason:'CAPTURE_PIPELINE_FAILED'|null=null;
    try{result=resultSchema.parse(await options.execute(join(attempts,attemptId)));}catch{reason='CAPTURE_PIPELINE_FAILED';}
    const finishedAt=instant.parse(options.now());check(Date.parse(finishedAt)>=Date.parse(at),'CLOCK_ROLLBACK');
    const receiptBody={schema:'payload.industrial-refresh-receipt.v1' as const,intentDigest:commitment(intent),finishedAt,state:result?'CAPTURED' as const:'FAILED' as const,result,reason};
    const receipt={...receiptBody,digest:commitment(receiptBody)};
    publishImmutableFile(control,['attempts',attemptId,'receipt.json'],encodeLocalRecord(receipt),LIMIT);return {plan,attemptId,receipt};
  }finally{rmdirSync(lock);}
}
