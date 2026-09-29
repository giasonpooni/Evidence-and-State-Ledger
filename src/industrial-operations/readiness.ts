/** Operational readiness is a read-only gate over already configured industrial review state. */
import { accessSync, constants, lstatSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { z } from 'zod';
import { parseReplayJson } from '../observation/json';
import { readImmutableFile } from '../data-os/local-files';
import { commitment, instant, LIMIT, type AuthorityKey } from './authority';
import { serverConfigSchema } from './distribution';
import { inspectRefresh } from './refresh-state';
import { retainedReviewRequestSchema, inspectRefreshResult } from './refresh-result';
import { REFRESH_OPERATION } from './pipeline';

export const readinessPolicySchema = z.object({
  schema: z.literal('payload.industrial-readiness-policy.v1'),
  maxObservationAgeMs: z.number().int().positive().max(24 * 60 * 60 * 1000),
  requireRefreshEnabled: z.boolean(),
  requireProtectedFiles: z.boolean(),
  requireActiveCredential: z.boolean(),
}).strict();
export type ReadinessPolicy = z.infer<typeof readinessPolicySchema>;

export interface ReadinessOptions {
  operationsConfigFile: string;
  distributionConfigFile: string;
  root: string;
  intakeRoot: string;
  objectRoot: string;
  auditRoot: string;
  staticRoot: string;
  schedule: unknown;
  authorityKeys: readonly AuthorityKey[];
  policy: unknown;
  at: string;
}
type Reason =
  | 'CONFIG_FILE_UNSAFE' | 'DISTRIBUTION_CONFIG_UNSAFE' | 'SELECTION_FILE_UNSAFE'
  | 'REFRESH_NOT_READY' | 'REFRESH_DISABLED' | 'ACTIVE_REVIEW_NOT_CONFIGURED'
  | 'ACTIVE_REVIEW_NOT_RETAINED' | 'ACTIVE_REVIEW_SELECTION_MISMATCH'
  | 'NO_ACTIVE_READER' | 'RETAINED_RESULT_UNAVAILABLE' | 'MEASUREMENT_TOO_OLD'
  | 'NO_NUMERIC_OBSERVATION' | 'STORAGE_ROOT_UNSAFE' | 'AUDIT_NOT_WRITABLE'
  | 'VIEWER_NOT_AVAILABLE' | 'INVALID_READINESS_CONFIGURATION';

const readJson = (path:string,max=LIMIT) => {
  const bytes=readImmutableFile(dirname(path),[basename(path)],max);
  if(!bytes)throw new Error('FILE_UNAVAILABLE');
  return parseReplayJson(bytes,max);
};
function safeFile(path:string,protectedMode:boolean):boolean {
  try{
    const s=lstatSync(path);
    if(!s.isFile()||s.isSymbolicLink())return false;
    return !protectedMode||process.platform==='win32'||(s.mode&0o077)===0;
  }catch{return false;}
}
function safeDirectory(path:string,writable=false):boolean {
  try{
    const s=lstatSync(path);
    if(!s.isDirectory()||s.isSymbolicLink())return false;
    if(writable)accessSync(path,constants.W_OK);
    return true;
  }catch{return false;}
}
function reasonPush(reasons:Reason[],reason:Reason,ok:boolean){if(!ok&&!reasons.includes(reason))reasons.push(reason);}

/** No writes, source acquisition, admission, release or credential mutation. */
export function assessIndustrialReadiness(options:ReadinessOptions){
  const reasons:Reason[]=[];
  let policy:ReadinessPolicy;
  try{instant.parse(options.at);policy=readinessPolicySchema.parse(options.policy);}
  catch{return {schema:'payload.industrial-readiness.v1' as const,status:'NOT_READY' as const,assessedAt:options.at,
    reasonCodes:['INVALID_READINESS_CONFIGURATION'] as Reason[],components:null,digest:null};}

  const protectedMode=policy.requireProtectedFiles;
  reasonPush(reasons,'CONFIG_FILE_UNSAFE',safeFile(options.operationsConfigFile,protectedMode));
  reasonPush(reasons,'DISTRIBUTION_CONFIG_UNSAFE',safeFile(options.distributionConfigFile,protectedMode));
  const storageOk=[options.root,options.intakeRoot,options.objectRoot].every(p=>safeDirectory(p));
  reasonPush(reasons,'STORAGE_ROOT_UNSAFE',storageOk);
  reasonPush(reasons,'AUDIT_NOT_WRITABLE',safeDirectory(options.auditRoot,true));
  reasonPush(reasons,'VIEWER_NOT_AVAILABLE',safeFile(join(options.staticRoot,'industrial.html'),false));

  const refresh=inspectRefresh({root:options.root,schedule:options.schedule,operation:REFRESH_OPERATION,
    authorityKeys:options.authorityKeys,at:options.at});
  const refreshOk=refresh.status==='INSPECTED'&&refresh.plan!==null&&refresh.plan.decision!=='HISTORY_INCOMPLETE';
  reasonPush(reasons,'REFRESH_NOT_READY',refreshOk);
  const scheduleEnabled=!!(options.schedule&&typeof options.schedule==='object'&&!Array.isArray(options.schedule)&&
    (options.schedule as Record<string,unknown>).enabled===true);
  reasonPush(reasons,'REFRESH_DISABLED',!policy.requireRefreshEnabled||scheduleEnabled);

  let activeDigest:string|null=null,resourceKind:string|null=null,activeReaders=0,selectionFileSafe=false;
  let evidenceStatus:'NOT_CHECKED'|'REINSPECTED'|'UNAVAILABLE'='NOT_CHECKED';
  let observationAgeMs:number|null=null,verificationScope:string|null=null,attemptId:string|null=null;
  try{
    const distribution=serverConfigSchema.parse(readJson(options.distributionConfigFile,256*1024));
    activeDigest=distribution.activeReviewDigest;
    const resource=activeDigest?distribution.resources.find(r=>r.digest===activeDigest):undefined;
    reasonPush(reasons,'ACTIVE_REVIEW_NOT_CONFIGURED',!!activeDigest&&!!resource&&!resource.revoked);
    reasonPush(reasons,'ACTIVE_REVIEW_NOT_RETAINED',!!resource&&resource.kind==='RETAINED_REVIEW'&&!!resource.requestFile);
    if(resource?.requestFile){
      selectionFileSafe=safeFile(resource.requestFile,protectedMode);
      reasonPush(reasons,'SELECTION_FILE_UNSAFE',selectionFileSafe);
      const selection=retainedReviewRequestSchema.parse(readJson(resource.requestFile));
      const sameRoots=selection.refreshRoot===options.root&&selection.intakeRoot===options.intakeRoot;
      const sameSchedule=commitment(selection.schedule)===commitment(options.schedule);
      const sameDigest=selection.compiledDigest===activeDigest;
      reasonPush(reasons,'ACTIVE_REVIEW_SELECTION_MISMATCH',sameRoots&&sameSchedule&&sameDigest);
      attemptId=selection.attemptId;
      if(sameRoots&&sameSchedule&&sameDigest){
        const inspected=inspectRefreshResult({root:options.root,intakeRoot:options.intakeRoot,schedule:options.schedule,
          attemptId:selection.attemptId,authorityKeys:options.authorityKeys,at:options.at});
        if(inspected.status==='REINSPECTED'){
          evidenceStatus='REINSPECTED';verificationScope=inspected.verificationScope;
          observationAgeMs=inspected.freshness.observationAgeMs;
          if(observationAgeMs===null)reasonPush(reasons,'NO_NUMERIC_OBSERVATION',false);
          else reasonPush(reasons,'MEASUREMENT_TOO_OLD',observationAgeMs<=policy.maxObservationAgeMs);
        }else{evidenceStatus='UNAVAILABLE';reasonPush(reasons,'RETAINED_RESULT_UNAVAILABLE',false);}
      }
    }
    if(activeDigest){
      activeReaders=distribution.credentials.filter(c=>!c.revoked&&c.artifacts.includes(activeDigest)&&
        Date.parse(c.notBefore)<=Date.parse(options.at)&&Date.parse(options.at)<Date.parse(c.notAfter)).length;
    }
    reasonPush(reasons,'NO_ACTIVE_READER',!policy.requireActiveCredential||activeReaders>0);
    resourceKind=resource?.kind??null;
  }catch{
    reasonPush(reasons,'ACTIVE_REVIEW_NOT_CONFIGURED',false);
    reasonPush(reasons,'RETAINED_RESULT_UNAVAILABLE',false);
  }

  const body={
    schema:'payload.industrial-readiness.v1' as const,status:reasons.length===0?'READY' as const:'NOT_READY' as const,
    assessedAt:options.at,reasonCodes:reasons,
    policy:{maxObservationAgeMs:policy.maxObservationAgeMs,requireRefreshEnabled:policy.requireRefreshEnabled,
      requireProtectedFiles:policy.requireProtectedFiles,requireActiveCredential:policy.requireActiveCredential},
    components:{
      filesystem:{operationsConfigProtected:safeFile(options.operationsConfigFile,protectedMode),
        distributionConfigProtected:safeFile(options.distributionConfigFile,protectedMode),selectionFileProtected:selectionFileSafe,
        storageRootsSafe:storageOk,auditWritable:safeDirectory(options.auditRoot,true),viewerAvailable:safeFile(join(options.staticRoot,'industrial.html'),false)},
      refresh:{status:refresh.status,decision:refresh.plan?.decision??null,enabled:scheduleEnabled,historyDigest:refresh.historyDigest},
      distribution:{activeDigest,resourceKind,activeReaders},
      evidence:{status:evidenceStatus,attemptId,verificationScope,observationAgeMs},
    },
    executionAuthorized:false,canonicalAdmission:false,release:null,
  };
  return {...body,digest:commitment(body)};
}

export function publicReadiness(report:ReturnType<typeof assessIndustrialReadiness>){
  return {schema:'payload.industrial-readiness-probe.v1' as const,status:report.status,assessedAt:report.assessedAt,
    reasonCodes:report.reasonCodes};
}
