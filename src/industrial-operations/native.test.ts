/** Uses the unchanged admission writer against actual isolated embedded PostgreSQL. All data is test fixture. */
import {afterAll,afterEach,beforeAll,beforeEach,it,expect,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';import {drizzle} from 'drizzle-orm/pglite';import {eq} from 'drizzle-orm';
import {generateKeyPairSync,sign,randomBytes} from 'node:crypto';import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import * as schema from '../db/schema';import {LocalEvidenceIntake} from '../data-os/local-intake';import {industrialReviewPolicy} from '../acquisition/industrial-review';
import {encodeLocalRecord} from '../data-os/local-record';import {FileContentAddressedStore} from '../data-os/file-object-store';
import type {CorpusRecord} from '../domain/corpus';import {qualifyAdmission,executeAdmission,type AdmissionRequest} from './admission';
import {prepareInternalRelease,publishInternalRelease,reinspectRelease,type ReleaseRequest} from './release';
import {commitment,type AuthorityKey} from './authority';
import {once} from 'node:events';
import {createDistributionServer,credentialForToken,type ServerConfig} from './distribution';
const current=vi.hoisted(()=>({db:null as unknown}));vi.mock('../db/index',()=>({get db(){return current.db;}}));
let client:PGlite,db:ReturnType<typeof drizzle<typeof schema>>,n=0,root:string,request:AdmissionRequest,keys:AuthorityKey[];
let signing:ReturnType<typeof generateKeyPairSync>;
const observed='2026-09-29T06:00:00.000Z',captured='2026-09-29T07:00:00.000Z',at='2026-09-29T08:00:00.000Z',expires='2026-09-29T09:00:00.000Z';
const purpose='industrial-source-qualification';
function approve(action:'ADMIT'|'RELEASE',target:unknown){const body={schema:'payload.industrial-approval.v1',decisionId:'decision:fixture',action,authorityId:'role:test-steward',keyId:'key:test',targetDigest:commitment(target),issuedAt:at,notAfter:expires};return {...body,signature:sign(null,encodeLocalRecord(body),signing.privateKey).toString('base64url')};}
function releaseRequest(exportAllowed=true):ReleaseRequest{
 const store=new FileContentAddressedStore(join(root,'intake','objects')),terms=store.put(Buffer.from('Synthetic test declaration: internal export only; not real NOAA permission evidence.'));
 const registration=industrialReviewPolicy('noaa-coops');if(exportAllowed)registration.allowedOperations=[...registration.allowedOperations,'EXPORT'];
 return {schema:'payload.industrial-release-request.v1',corpusId:'test-corpus',sourceReleaseId:'test-source-release',releaseId:'test-internal-release',recordIds:['record:fixture'],recipientId:'operator:fixture',purpose,issuedAt:at,notAfter:expires,sourceGrants:[{sourceId:'noaa-coops',registration,termsEvidenceDigest:terms.contentDigest}]};
}
beforeAll(async()=>{client=new PGlite();await client.waitReady;});afterAll(async()=>{await client?.close();});
beforeEach(async()=>{
 root=mkdtempSync(join(tmpdir(),'esm-native-operations-'));n++;
 await client.exec(`CREATE SCHEMA op_${n}; SET search_path TO op_${n};
 CREATE TABLE corpora (corpus_id text PRIMARY KEY, domain text NOT NULL, title text NOT NULL, description text NOT NULL, data jsonb NOT NULL);
 CREATE TABLE releases (release_id text PRIMARY KEY, corpus_id text NOT NULL REFERENCES corpora(corpus_id), status text NOT NULL, known_at timestamptz NOT NULL, data jsonb NOT NULL);
 CREATE TABLE records (record_id text PRIMARY KEY, corpus_id text NOT NULL REFERENCES corpora(corpus_id), subject_id text NOT NULL, predicate text NOT NULL, valid_from timestamptz NOT NULL, valid_to timestamptz, known_at timestamptz NOT NULL, source_time timestamptz NOT NULL, acquisition_time timestamptz NOT NULL, provenance text NOT NULL, subject_canonical_id text, conditions jsonb NOT NULL DEFAULT '[]', data jsonb NOT NULL);
 CREATE TABLE admission_ruling (ruling_id text PRIMARY KEY, candidate_id text NOT NULL, record_id text NOT NULL, outcome text NOT NULL, authority text NOT NULL, ruled_at timestamptz NOT NULL, data jsonb NOT NULL);
 CREATE TABLE record_ancestry (record_id text PRIMARY KEY, release_id text NOT NULL, candidate_id text NOT NULL, build_id text, ruled_at timestamptz NOT NULL, authority text NOT NULL);
 CREATE TABLE retractions (retraction_id text PRIMARY KEY, corpus_id text NOT NULL REFERENCES corpora(corpus_id), issued_at timestamptz NOT NULL, data jsonb NOT NULL);`);
 db=drizzle(client,{schema});current.db=db;
 await db.insert(schema.corpora).values({corpusId:'test-corpus',domain:'Caravan',title:'Synthetic test',description:'Synthetic PostgreSQL fixture',data:{}});
 await db.insert(schema.releases).values({corpusId:'test-corpus',releaseId:'test-source-release',status:'CURRENT',knownAt:at,data:{certification:{status:'CANDIDATE'}}});
 const intake=new LocalEvidenceIntake(join(root,'intake')),capt=intake.capture({schema:'payload.local-intake-request.v1',acquisitionId:'acquisition:fixture',evidenceId:'evidence:fixture',sourceRegistration:industrialReviewPolicy('noaa-coops'),purpose,mediaType:'application/json',capturedAt:captured},Buffer.from(JSON.stringify({metadata:{id:'9414290'},data:[{t:'2026-09-29 06:00',v:'1.25',q:'p'}]})),captured);
 const evidenceClass={claimStrength:'reported' as const,productionClass:'measured' as const,interest:'disinterested' as const};
 const projection:CorpusRecord={recordId:'record:fixture',canonicalId:'notation://record/fixture',firstReleaseId:'test-source-release',subjectId:'9414290',subjectCanonicalId:'notation://station/fixture',subjectType:'sensor_station',predicate:'water_level.height',title:'Synthetic test water level',value:1.25,unit:'m',basis:'NAVD88',validFrom:observed,knownAt:captured,observedAt:observed,evidenceClass,provenance:{sourceId:'noaa-coops',contentDigest:capt.acquisition.request.contentDigest},visibility:'INTERNAL_ONLY'};
 request={schema:'payload.industrial-admission-request.v1',corpusId:'test-corpus',releaseId:'test-source-release',authority:'role:test-steward',ruledAt:at,purpose,members:[{acquisitionId:'acquisition:fixture',releaseRecord:projection,candidate:{candidateId:'candidate:fixture',buildId:'build:fixture',recordId:projection.recordId,subjectCanonicalId:projection.subjectCanonicalId,assertion:{subjectId:projection.subjectId,predicate:projection.predicate,value:projection.value,unit:'m',basis:'NAVD88'},origin:'MEASURED',evidenceClass,provenance:{artifactDigest:capt.acquisition.request.contentDigest,capturedAt:captured},provenanceClass:'LIVE_CAPTURE',sourceTime:'2026-09-29T06:01:00.000Z',conditions:['Synthetic qualification only; preliminary source; not navigation.'],validFrom:observed,knownAt:captured,rightsDecision:'PERMITTED'}}]};
 signing=generateKeyPairSync('ed25519');keys=[{keyId:'key:test',authorityId:'role:test-steward',publicKeyPem:signing.publicKey.export({type:'spki',format:'pem'}).toString(),actions:['ADMIT','RELEASE'],notBefore:at,notAfter:expires,revoked:false}];
});
afterEach(()=>rmSync(root,{recursive:true,force:true}));
const admit=()=>executeAdmission(request,approve('ADMIT',request),keys,join(root,'intake'),join(root,'audit'),at);
it('qualifies retained evidence without writing, then signed admission uses actual SQL writer',async()=>{
 expect(qualifyAdmission(request,join(root,'intake'),at).ready).toBe(true);expect(await db.select().from(schema.records)).toHaveLength(0);
 expect((await admit()).inserted).toEqual(['record:fixture']);expect(await db.select().from(schema.records)).toHaveLength(1);expect(await db.select().from(schema.admissionRulings)).toHaveLength(1);expect(await db.select().from(schema.recordAncestry)).toHaveLength(1);
 expect((await admit()).existing).toEqual(['record:fixture']);
});
it('unknown source-publication time refuses even a correctly signed decision',async()=>{
 request.members[0].candidate.sourceTime=null;const q=qualifyAdmission(request,join(root,'intake'),at);expect(q.ready).toBe(false);expect(q.members[0].ruling.failed.map(x=>x.check)).toContain('SOURCE_CLOCK_COHERENT');await expect(admit()).rejects.toThrow('ADMISSION_NOT_QUALIFIED');expect(await db.select().from(schema.records)).toHaveLength(0);
});
it.each(['different-value','missing-identity','wrong-unit','projection-change','unknown-rights','changed-source','future-clock'])(`refuses %s without canonical writes`,async kind=>{
 const c=request.members[0].candidate;if(kind==='different-value')c.assertion!.value=7;if(kind==='missing-identity')c.subjectCanonicalId=null;if(kind==='wrong-unit')c.assertion!.unit='feet';if(kind==='projection-change')(request.members[0].releaseRecord as CorpusRecord).value=8;if(kind==='unknown-rights')c.rightsDecision='UNDECIDED';if(kind==='changed-source')c.provenance.artifactDigest=commitment('not-source');if(kind==='future-clock')c.knownAt=expires;
 expect(qualifyAdmission(request,join(root,'intake'),at).ready).toBe(false);await expect(admit()).rejects.toThrow();expect(await db.select().from(schema.records)).toHaveLength(0);
});
it('publishes an exact signed internal selection after real SQL admission and reinspection',async()=>{
 await admit();await certifyFixture();const r=releaseRequest(),objectRoot=join(root,'intake','objects'),body=await prepareInternalRelease(r,objectRoot,at),approval=approve('RELEASE',{requestDigest:commitment(r),body});
 const release=await publishInternalRelease(r,approval,keys,objectRoot,join(root,'audit'),at);const bytes=new FileContentAddressedStore(objectRoot).get(release.digest)!;
 expect(JSON.stringify(body)).not.toMatch(/candidate:fixture|build:fixture/);expect(body.canonicalAdmission).toBe(true);expect(body.corpusCertification).toBe('UNCHANGED');expect(body.records[0].admission?.conditions).toEqual(request.members[0].candidate.conditions);
 const envelope=JSON.parse(Buffer.from(bytes).toString('utf8'));expect((await reinspectRelease(r,envelope,keys,objectRoot,at)).records).toHaveLength(1);
 const same=await publishInternalRelease(r,approval,keys,objectRoot,join(root,'audit'),at);expect(same.digest).toBe(release.digest);
});
it('source review permission does not imply export permission',async()=>{await admit();await certifyFixture();await expect(prepareInternalRelease(releaseRequest(false),join(root,'intake','objects'),at)).rejects.toThrow('SOURCE_EXPORT_REFUSED');});
it('an admitted flag without native inventory cannot become a release',async()=>{await certifyFixture();await expect(prepareInternalRelease(releaseRequest(),join(root,'intake','objects'),at)).rejects.toThrow('MEMBER_UNAVAILABLE');});
it.each(['missing-ruling','missing-ancestry','withdrawn-release','retraction','expired','changed-record'])(`release reinspection refuses %s`,async kind=>{
 await admit();await certifyFixture();const r=releaseRequest(),objectRoot=join(root,'intake','objects'),body=await prepareInternalRelease(r,objectRoot,at),envelope={body,requestDigest:commitment(r),approval:approve('RELEASE',{requestDigest:commitment(r),body})};
 if(kind==='missing-ruling')await db.delete(schema.admissionRulings);if(kind==='missing-ancestry')await db.delete(schema.recordAncestry);if(kind==='withdrawn-release')await db.update(schema.releases).set({data:{certification:{status:'WITHDRAWN'}}});
 if(kind==='retraction')await db.insert(schema.retractions).values({retractionId:'withdrawal:fixture',corpusId:'test-corpus',issuedAt:at,data:{affectedRecordIds:['record:fixture']}});
 if(kind==='changed-record')await db.update(schema.records).set({predicate:'altered'}).where(eq(schema.records.recordId,'record:fixture'));
 await expect(reinspectRelease(r,envelope,keys,objectRoot,kind==='expired'?expires:at)).rejects.toThrow();
});

/** Explicit test setup only; no production operation silently certifies a corpus. */
async function certifyFixture(){await db.update(schema.releases).set({data:{certification:{status:'CERTIFIED'}}});}
it('CANDIDATE release cannot be exported even after records were admitted',async()=>{await admit();await expect(prepareInternalRelease(releaseRequest(),join(root,'intake','objects'),at)).rejects.toThrow('RELEASE_NOT_CERTIFIED');});

it('real HTTP release delivery reopens native PostgreSQL, scopes the recipient and rejects retraction',async()=>{
 await admit();await certifyFixture();const r=releaseRequest(),objectRoot=join(root,'intake','objects'),body=await prepareInternalRelease(r,objectRoot,at);
 const published=await publishInternalRelease(r,approve('RELEASE',{requestDigest:commitment(r),body}),keys,objectRoot,join(root,'audit'),at);
 const file=join(root,'release.json'),requestFile=join(root,'release-request.json');writeFileSync(file,new FileContentAddressedStore(objectRoot).get(published.digest)!);writeFileSync(requestFile,JSON.stringify(r));
 const token='esm_'+randomBytes(32).toString('base64url'),other='esm_'+randomBytes(32).toString('base64url');
 const config:ServerConfig={schema:'payload.industrial-distribution.v1',credentials:[credentialForToken(token,r.recipientId,published.digest,at,expires),credentialForToken(other,'operator:other',published.digest,at,expires)],authorityKeys:keys.map(k=>({...k,actions:[...k.actions]})),resources:[{digest:published.digest,kind:'RELEASE',file,requestFile,revoked:false}],activeReviewDigest:null};
 const configFile=join(root,'access.json');writeFileSync(configFile,JSON.stringify(config));
 const service=createDistributionServer({configFile,staticRoot:root,objectRoot,auditRoot:join(root,'audit'),now:()=>at});service.listen();await once(service.server,'listening');
 const address=service.server.address();if(!address||typeof address==='string')throw new Error('LISTENER_UNAVAILABLE');const url=`http://127.0.0.1:${address.port}/v1/artifacts/${published.digest.slice(7)}`;
 try{
  expect((await fetch(url)).status).toBe(401);expect((await fetch(url,{headers:{Authorization:'Bearer '+other}})).status).toBe(503);
  const response=await fetch(url,{headers:{Authorization:'Bearer '+token}});expect(response.status).toBe(200);expect((await response.json()).body.records).toHaveLength(1);
  await db.insert(schema.retractions).values({retractionId:'withdrawal:after-delivery',corpusId:r.corpusId,issuedAt:at,data:{affectedRecordIds:['record:fixture']}});
  expect((await fetch(url,{headers:{Authorization:'Bearer '+token}})).status).toBe(503);
 }finally{service.server.closeAllConnections();await new Promise<void>(resolve=>service.server.close(()=>resolve()));}
});
