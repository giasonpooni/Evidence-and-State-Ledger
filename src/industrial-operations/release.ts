/** Exact internal selection release, additive to (never a relabelling of) fixture corpus releases. */
import { z } from 'zod';
import { and, eq, inArray } from 'drizzle-orm';
import { hydrateCorpusRecord, type AdmissionStorageDocument, timestamp } from '../db/recordStorage';
import { releaseLeaks } from '../domain/admission';
import { FileContentAddressedStore } from '../data-os/file-object-store';
import { publishImmutableFile } from '../data-os/local-files';
import { encodeLocalRecord, localJson } from '../data-os/local-record';
import { evaluateSourceUse, validateSourceRegistration } from '../data-os/source-policy';
import type { SourceRegistration } from '../data-os/contracts';
import { check, commitment, hash, id, instant, text, verifyApproval, LIMIT, type AuthorityKey } from './authority';
export const releaseRequestSchema=z.object({schema:z.literal('payload.industrial-release-request.v1'),corpusId:id,sourceReleaseId:id,
  releaseId:id,recordIds:z.array(id).min(1).max(128),recipientId:id,purpose:text,issuedAt:instant,notAfter:instant,
  sourceGrants:z.array(z.object({sourceId:id,registration:z.unknown(),termsEvidenceDigest:hash}).strict()).min(1).max(16)}).strict();
export type ReleaseRequest=z.infer<typeof releaseRequestSchema>;
/** Uses the real SQL inventory, ruling table and ancestry; never accepts caller-supplied admitted rows. */
export async function readNativeSelection(corpusId:string,releaseId:string,recordIds:string[]){
  id.parse(corpusId);id.parse(releaseId);check(recordIds.length>0&&recordIds.length<=128&&new Set(recordIds).size===recordIds.length,'INVALID_SELECTION');recordIds.forEach(x=>id.parse(x));
  const {db}=await import('../db/index');const s=await import('../db/schema');
  return db.transaction(async tx=>{
    const [corpus]=await tx.select().from(s.corpora).where(eq(s.corpora.corpusId,corpusId)).for('update');check(corpus,'CORPUS_UNAVAILABLE');
    const [release]=await tx.select().from(s.releases).where(and(eq(s.releases.releaseId,releaseId),eq(s.releases.corpusId,corpusId))).for('update');
    check(release&&release.status==='CURRENT','RELEASE_UNAVAILABLE');
    const cert=(release.data as {certification?:{status?:string}})?.certification?.status;
    check(cert==='CERTIFIED','RELEASE_NOT_CERTIFIED');
    const stored=await tx.select().from(s.records).where(and(eq(s.records.corpusId,corpusId),inArray(s.records.recordId,recordIds))).for('update');
    check(stored.length===recordIds.length,'MEMBER_UNAVAILABLE');
    const rulings=await tx.select().from(s.admissionRulings).where(inArray(s.admissionRulings.recordId,recordIds));
    const ancestry=await tx.select().from(s.recordAncestry).where(inArray(s.recordAncestry.recordId,recordIds));
    const withdrawals=await tx.select().from(s.retractions).where(eq(s.retractions.corpusId,corpusId));
    const records=stored.map(row=>{
      check(row.provenance==='LIVE_CAPTURE'||row.provenance==='BACKFILLED','NOT_PERSISTED_ADMISSION');
      const doc=row.data as AdmissionStorageDocument;check(doc.corpusId===corpusId&&doc.releaseId===releaseId,'MEMBERSHIP_MISMATCH');
      const record=hydrateCorpusRecord(row);check(record.admission&&record.firstReleaseId===releaseId,'ADMISSION_PROJECTION_UNAVAILABLE');
      check(record.visibility==='INTERNAL_ONLY'&&record.provenance.sourceId==='noaa-coops'&&record.subjectId==='9414290'&&record.predicate==='water_level.height','RECORD_OUTSIDE_QUALIFIED_SCOPE');
      check(!record.supersededByRecordId&&!record.retractedByRetractionId,'RECORD_WITHDRAWN');
      check(!withdrawals.some(w=>(w.data as {affectedRecordIds?:string[]})?.affectedRecordIds?.includes(row.recordId)),'RECORD_WITHDRAWN');
      const rule=rulings.filter(r=>r.recordId===row.recordId&&localJson((r.data as {candidate:unknown}).candidate)===localJson(doc.candidate)&&localJson((r.data as {ruling:unknown}).ruling)===localJson(doc.ruling));
      check(rule.length===1,'RULING_UNAVAILABLE_OR_AMBIGUOUS');
      const parents=ancestry.filter(a=>a.recordId===row.recordId&&a.releaseId===releaseId&&a.candidateId===doc.candidate.candidateId&&a.buildId===doc.candidate.buildId&&a.authority===doc.ruling.authority&&timestamp(a.ruledAt)===timestamp(doc.ruling.ruledAt));
      check(parents.length===1,'ANCESTRY_UNAVAILABLE');
      check(Date.parse(record.knownAt)<=Date.parse(release.knownAt),'RELEASE_CUTOFF');return record;
    }).sort((a,b)=>a.recordId.localeCompare(b.recordId));
    return {records,ancestry,releaseId,corpusId};
  });
}
export async function prepareInternalRelease(raw:unknown,objectRoot:string,at:string){
  const r=releaseRequestSchema.parse(raw);instant.parse(at);commitment(r);
  check(Date.parse(r.issuedAt)<=Date.parse(at)&&Date.parse(at)<Date.parse(r.notAfter),'RELEASE_OUTSIDE_WINDOW');
  const selected=await readNativeSelection(r.corpusId,r.sourceReleaseId,r.recordIds);
  const store=new FileContentAddressedStore(objectRoot),needed=new Set(selected.records.map(x=>x.provenance.sourceId));
  check(r.sourceGrants.length===needed.size&&new Set(r.sourceGrants.map(x=>x.sourceId)).size===needed.size,'SOURCE_COVERAGE_MISMATCH');
  for(const g of r.sourceGrants){check(needed.has(g.sourceId),'SOURCE_COVERAGE_MISMATCH');
    const p=g.registration as SourceRegistration;validateSourceRegistration(p);check(p.sourceId===g.sourceId,'SOURCE_MISMATCH');
    check(!!store.get(g.termsEvidenceDigest),'TERMS_EVIDENCE_UNAVAILABLE');
    check(evaluateSourceUse(p,{requestId:'industrial-release-export',registrationId:p.registrationId,purpose:r.purpose,operation:'EXPORT',audience:'INTERNAL',requestedAt:at}).state==='ALLOWED','SOURCE_EXPORT_REFUSED');
    check(!p.effectiveUntil||Date.parse(r.notAfter)<=Date.parse(p.effectiveUntil),'RELEASE_EXCEEDS_SOURCE_GRANT');
    check(p.retention.mode!=='UNTIL_SOURCE_EXPIRY'||!!p.effectiveUntil,'SOURCE_RETENTION_UNRESOLVED');
    check(p.retention.mode!=='UNTIL'||Date.parse(r.notAfter)<=Date.parse(p.retention.until!),'RELEASE_EXCEEDS_RETENTION');
  }
  for(const record of selected.records){check(Date.parse(record.admission!.ruledAt)<=Date.parse(r.issuedAt),'RELEASE_PRECEDES_ADMISSION');check(record.provenance.contentDigest&&store.get(record.provenance.contentDigest),'SOURCE_BYTES_UNAVAILABLE');}
  const body={schema:'payload.industrial-record-release.v1' as const,scope:'EXACT_INTERNAL_RECORD_SELECTION' as const,
    corpusCertification:'UNCHANGED' as const,canonicalAdmission:true as const,audience:'INTERNAL' as const,
    releaseId:r.releaseId,corpusId:r.corpusId,sourceReleaseId:r.sourceReleaseId,recipientId:r.recipientId,purpose:r.purpose,issuedAt:r.issuedAt,notAfter:r.notAfter,
    records:selected.records,sources:r.sourceGrants.map(g=>({sourceId:g.sourceId,policyDigest:commitment(g.registration),termsEvidenceDigest:g.termsEvidenceDigest})),
    independentVerification:false as const,sourceTruthClaimed:false as const};
  check(releaseLeaks(body,selected.ancestry).length===0,'RELEASE_LINEAGE_LEAK');commitment(body);return body;
}
export async function publishInternalRelease(raw:unknown,approval:unknown,keys:readonly AuthorityKey[],objectRoot:string,auditRoot:string,at:string){
  const request=releaseRequestSchema.parse(raw),body=await prepareInternalRelease(request,objectRoot,at);
  const requestDigest=commitment(request),a=verifyApproval(approval,'RELEASE',{requestDigest,body},keys,at),envelope={body,requestDigest,approval:a};
  check(Date.parse(body.issuedAt)<=Date.parse(a.issuedAt)&&Date.parse(body.notAfter)<=Date.parse(a.notAfter),'APPROVAL_RELEASE_WINDOW_MISMATCH');
  const store=new FileContentAddressedStore(objectRoot),stored=store.put(encodeLocalRecord(envelope,LIMIT));
  check(!!store.get(stored.contentDigest),'RELEASE_READBACK_FAILED');
  // The stable release ID cannot be rebound to different bytes. A failed publication may retain bytes only.
  publishImmutableFile(auditRoot,['releases',`${commitment(request.releaseId).slice(7)}.json`],encodeLocalRecord({releaseId:request.releaseId,digest:stored.contentDigest}),LIMIT);
  publishImmutableFile(auditRoot,['release-audit',`${stored.contentDigest.slice(7)}.json`],encodeLocalRecord({request,bodyDigest:commitment(body),decisionId:a.decisionId},LIMIT),LIMIT);
  return {digest:stored.contentDigest,releaseId:body.releaseId,status:'SIGNED_INTERNAL_SELECTION_RELEASE' as const};
}
/** Every delivery reopens the native rows and source evidence, not only a stored success label. */
export async function reinspectRelease(raw:unknown,envelope:unknown,keys:readonly AuthorityKey[],objectRoot:string,at:string){
  const e=z.object({body:z.unknown(),requestDigest:hash,approval:z.unknown()}).strict().parse(envelope);
  const request=releaseRequestSchema.parse(raw),body=await prepareInternalRelease(request,objectRoot,at);
  check(commitment(e.body)===commitment(body),'RELEASE_CHANGED_OR_RETRACTED');check(e.requestDigest===commitment(request),'RELEASE_REQUEST_MISMATCH');verifyApproval(e.approval,'RELEASE',{requestDigest:e.requestDigest,body},keys,at);return body;
}
