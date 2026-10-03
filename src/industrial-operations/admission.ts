import { parseReplayJson } from '../observation/json';
/** Qualification calls the existing gate; the optional write calls the existing SQL door. */
import { z } from 'zod';
import { admit, admittedRow, type AdmissionCandidate } from '../domain/admission';
import { bindReleaseRecord } from '../db/recordStorage';
import { LocalEvidenceIntake } from '../data-os/local-intake';
import { evaluateSourceUse } from '../data-os/source-policy';
import { publishImmutableFile } from '../data-os/local-files';
import { encodeLocalRecord } from '../data-os/local-record';
import { check, commitment, hash, id, instant, text, verifyApproval, LIMIT, type AuthorityKey } from './authority';
const candidate=z.object({candidateId:id,buildId:id.nullable(),recordId:id,subjectCanonicalId:id.nullable(),
  assertion:z.object({subjectId:id.nullable(),predicate:id.nullable(),value:z.union([text,z.number().finite()]).nullable(),unit:text.optional(),basis:text.optional()}).strict().nullable(),
  origin:z.enum(['MEASURED','REPORTED','ASSUMED','SIMULATED']).nullable(),
  evidenceClass:z.object({claimStrength:z.enum(['reported','estimated','representative','derived']).nullable(),productionClass:z.enum(['asserted','computed','derived','measured','unclassified']).nullable(),interest:z.enum(['disinterested','unknown','self_reported','negotiating_position']).nullable()}).strict().nullable(),
  provenance:z.object({artifactDigest:hash.nullable(),capturedAt:instant.nullable()}).strict(),provenanceClass:z.enum(['LIVE_CAPTURE','BACKFILLED']).nullable(),sourceTime:instant.nullable(),
  conditions:z.array(text).max(32),validFrom:instant.nullable(),knownAt:instant.nullable(),rightsDecision:z.enum(['PERMITTED','PROHIBITED','UNDECIDED']).nullable()}).strict();
const requestSchema=z.object({schema:z.literal('payload.industrial-admission-request.v1'),corpusId:id,releaseId:id,authority:id.nullable(),ruledAt:instant,purpose:text,
  members:z.array(z.object({acquisitionId:id,candidate,releaseRecord:z.unknown()}).strict()).min(1).max(128)}).strict();
export type AdmissionRequest=z.infer<typeof requestSchema>;
export function parseAdmissionRequest(raw:unknown):AdmissionRequest {const r=requestSchema.parse(raw);commitment(r);
  check(new Set(r.members.map(m=>m.candidate.recordId)).size===r.members.length&&new Set(r.members.map(m=>m.candidate.candidateId)).size===r.members.length,'DUPLICATE_MEMBER');return r;}
export function qualifyAdmission(raw:unknown,intakeRoot:string,at:string) {
  const r=parseAdmissionRequest(raw);instant.parse(at);const intake=new LocalEvidenceIntake(intakeRoot);
  const members=r.members.map(m=>{const c=m.candidate as AdmissionCandidate,ruling=admit(c,r.authority??'',r.ruledAt),errors:string[]=[];
    for(const time of [r.ruledAt,c.knownAt,c.sourceTime,c.provenance.capturedAt])if(time&&Date.parse(time)>Date.parse(at))errors.push('FUTURE_EVIDENCE_OR_RULING');
    for(const time of [c.knownAt,c.sourceTime,c.provenance.capturedAt])if(time&&Date.parse(time)>Date.parse(r.ruledAt))errors.push('RULING_PRECEDES_EVIDENCE');
    try {const acquisition=intake.inspect(m.acquisitionId);check(acquisition,'ACQUISITION_UNAVAILABLE');
      check(acquisition.request.contentDigest===c.provenance.artifactDigest&&acquisition.request.manifest.capturedAt===c.provenance.capturedAt,'ACQUISITION_BINDING_MISMATCH');
      const policy=acquisition.request.manifest.sourceRegistration;
      check(policy.sourceId==='noaa-coops','INDUSTRIAL_SOURCE_NOT_QUALIFIED');
      const bytes=intake.objects.get(acquisition.request.contentDigest);check(bytes,'SOURCE_BYTES_UNAVAILABLE');
      const raw=parseReplayJson(bytes,LIMIT) as {metadata?:{id?:string};data?:{t:string;v:string}[]};
      check(raw.metadata?.id==='9414290'&&Array.isArray(raw.data),'NOAA_SOURCE_SCOPE_MISMATCH');
      const matching=raw.data.filter(v=>new Date(v.t.replace(' ','T')+':00Z').toISOString()===c.validFrom);
      check(matching.length===1&&matching[0].v.trim()!==''&&Number(matching[0].v)===c.assertion?.value&&
        c.assertion.subjectId==='9414290'&&c.assertion.predicate==='water_level.height'&&c.assertion.unit==='m'&&c.assertion.basis==='NAVD88','SOURCE_ASSERTION_MISMATCH');
      check(evaluateSourceUse(policy,{requestId:'industrial-admission-review',registrationId:policy.registrationId,purpose:r.purpose,operation:'RETRIEVE',audience:'INTERNAL',requestedAt:at}).state==='ALLOWED','SOURCE_USE_REFUSED');
      if(policy.retention.mode==='UNTIL')check(Date.parse(at)<Date.parse(policy.retention.until!),'SOURCE_RETENTION_EXPIRED');
      check(policy.retention.mode!=='UNTIL_SOURCE_EXPIRY'||!!policy.effectiveUntil,'SOURCE_RETENTION_UNRESOLVED');
      const row=admittedRow(c,ruling).row;
      if(row){const projection=bindReleaseRecord(m.releaseRecord,c,row,r.releaseId);
        check(projection.provenance.sourceId===policy.sourceId,'RECORD_SOURCE_MISMATCH');}
    }catch{errors.push('RETAINED_EVIDENCE_OR_PROJECTION_INVALID');}
    return {recordId:c.recordId,ruling,errors};});
  return {schema:'payload.industrial-admission-qualification.v1' as const,requestDigest:commitment(r),at,
    ready:members.every(m=>m.errors.length===0&&m.ruling.outcome!=='REFUSED'),canonicalWritePerformed:false as const,members};
}
export async function executeAdmission(raw:unknown,approval:unknown,keys:readonly AuthorityKey[],intakeRoot:string,auditRoot:string,at:string){
  const r=parseAdmissionRequest(raw),a=verifyApproval(approval,'ADMIT',r,keys,at);check(r.authority!==null&&a.authorityId===r.authority&&r.ruledAt===a.issuedAt,'AUTHORITY_MISMATCH');
  const q=qualifyAdmission(r,intakeRoot,at),file=`qualification-${commitment(q).slice(7)}.json`;
  publishImmutableFile(auditRoot,['admission',file],encodeLocalRecord({qualification:q,approval:a},LIMIT),LIMIT);
  check(q.ready,'ADMISSION_NOT_QUALIFIED');
  // No replacement writer or callback supplied by a request. PostgreSQL config is mandatory.
  const {admitRecords}=await import('../db/admitRecords');
  const result=await admitRecords({corpusId:r.corpusId,releaseId:r.releaseId,authority:r.authority,ruledAt:r.ruledAt,
    candidates:r.members.map(m=>m.candidate),releaseRecords:r.members.map(m=>m.releaseRecord) as Parameters<typeof admitRecords>[0]['releaseRecords']});
  publishImmutableFile(auditRoot,['admission',`result-${commitment({request:r,result}).slice(7)}.json`],encodeLocalRecord({requestDigest:commitment(r),decisionId:a.decisionId,result},LIMIT),LIMIT);
  check(result.refused.length===0,'ADMISSION_WRITE_REFUSED');
  return result;
}
