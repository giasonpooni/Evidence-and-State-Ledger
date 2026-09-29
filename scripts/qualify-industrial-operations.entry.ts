/** Real-source qualification: no production authority, signing key or admission is invented. */
import {mkdirSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {refreshOnce} from '../src/industrial-operations/refresh';
import {inspectRefresh} from '../src/industrial-operations/refresh-state';
import {inspectRefreshResult} from '../src/industrial-operations/refresh-result';
import {commitment} from '../src/industrial-operations/authority';
import {byteDigest} from '../src/data-os/evidence-capture';
import {fixedRefreshPipeline,REFRESH_OPERATION} from '../src/industrial-operations/pipeline';
import {retainIndustrialCapture,type IndustrialReview} from '../src/acquisition/industrial-review';
import {qualifyAdmission,type AdmissionRequest} from '../src/industrial-operations/admission';
const [mode,gscRoot,python,workPath]=process.argv.slice(2);
if(!['--live','--retained'].includes(mode)||!gscRoot||!python||!workPath)throw new Error('INVALID_QUALIFICATION_ARGUMENTS');
const work=resolve(workPath);mkdirSync(work,{recursive:true});const intakeRoot=join(work,'intake');
let review:IndustrialReview,captureRoot:string,refresh:unknown=null,secondInvocation:unknown=null,refreshInspection:unknown=null,resultInspection:unknown=null;
if(mode==='--live'){
 const now=new Date(),schedule={schema:'payload.capture-schedule.v1',scheduleId:'industrial-qualification',sourceId:'industrial-noaa-usgs',minimumIntervalHours:1,notBefore:now.toISOString(),notAfter:new Date(now.getTime()+3*3600000).toISOString(),maxRuns:2,enabled:true};
 const options={root:join(work,'refresh'),schedule,operation:REFRESH_OPERATION,now:()=>new Date().toISOString(),execute:fixedRefreshPipeline({gscRoot,pythonExecutable:python,intakeRoot})};
 writeFileSync(join(work,'declared-schedule.json'),JSON.stringify(schedule,null,2),{flag:'wx'});
 const run=await refreshOnce(options);if(run.receipt?.state!=='CAPTURED')throw new Error('REAL_REFRESH_FAILED');
 refresh=run;const second=await refreshOnce(options);if(second.plan.decision!=='NOT_DUE')throw new Error('REFRESH_REPLAY_DID_NOT_SUPPRESS_COLLECTION');secondInvocation=second;
 // Qualify the actual status command against the retained live journal; it must not alter any file.
 const journalSnapshot=()=>{const entries:Record<string,string>={};
  const walk=(dir:string,prefix='')=>{for(const entry of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
   const name=prefix+entry.name;if(entry.isSymbolicLink())throw new Error('UNSAFE_QUALIFICATION_JOURNAL');
   if(entry.isDirectory())walk(join(dir,entry.name),name+'/');else entries[name]=byteDigest(readFileSync(join(dir,entry.name)));
  }};walk(options.root);return commitment(entries);};
 const before=journalSnapshot(),status=inspectRefresh({root:options.root,schedule,operation:REFRESH_OPERATION,at:new Date().toISOString()});
 const after=journalSnapshot();
 if(status.status!=='INSPECTED'||status.plan?.decision!=='NOT_DUE'||status.plan.runsSpent!==1||before!==after)throw new Error('REFRESH_STATUS_QUALIFICATION_FAILED');
 refreshInspection={status,journalUnchanged:before===after,beforeDigest:before,afterDigest:after};
 writeFileSync(join(work,'refresh-status.json'),JSON.stringify(refreshInspection,null,2),{flag:'wx'});
 const path=join(options.root,schedule.scheduleId,'attempts',run.attemptId!);captureRoot=join(path,'capture');
 const intakeSnapshot=()=>{const entries:Record<string,string>={};
  const walk=(dir:string,prefix='')=>{for(const entry of readdirSync(dir,{withFileTypes:true})){
   if(entry.isSymbolicLink())throw new Error('UNSAFE_QUALIFICATION_INTAKE');
   if(entry.isDirectory())walk(join(dir,entry.name),prefix+entry.name+'/');else entries[prefix+entry.name]=byteDigest(readFileSync(join(dir,entry.name)));
  }};walk(intakeRoot);return commitment(entries);};
 const resultBefore=commitment({journal:journalSnapshot(),intake:intakeSnapshot()});
 const inspected=inspectRefreshResult({root:options.root,intakeRoot,schedule,attemptId:run.attemptId!,at:new Date().toISOString()});
 const resultAfter=commitment({journal:journalSnapshot(),intake:intakeSnapshot()});
 if(inspected.status!=='REINSPECTED'||resultBefore!==resultAfter||inspected.checked.acquisitionCount!==5||inspected.result.compiledDigest!==run.receipt.result!.compiledDigest)throw new Error('RETAINED_RESULT_QUALIFICATION_FAILED');
 resultInspection={report:inspected,sourceAndJournalBytesUnchanged:resultBefore===resultAfter,beforeDigest:resultBefore,afterDigest:resultAfter};
 writeFileSync(join(work,'retained-result.json'),JSON.stringify(resultInspection,null,2),{flag:'wx'});
 writeFileSync(join(work,'retained-selection.json'),JSON.stringify({schema:'payload.retained-review-selection.v1',refreshRoot:options.root,intakeRoot,schedule,attemptId:run.attemptId!,compiledDigest:inspected.result.compiledDigest},null,2),{flag:'wx'});

 review=JSON.parse(readFileSync(join(path,'esm-review.json'),'utf8'));
 mkdirSync(join(work,'view'));for(const file of (await import('node:fs')).readdirSync(join(path,'view')))writeFileSync(join(work,'view',file),readFileSync(join(path,'view',file)),{flag:'wx'});
}else{
 // In this mode the second argument is an already retained capture directory.
 captureRoot=resolve(gscRoot);review=retainIndustrialCapture(captureRoot,intakeRoot,true);
}
const raw=JSON.parse(readFileSync(join(captureRoot,'water-level.json'),'utf8')) as {data:{t:string;v:string}[]};
const sample=raw.data.filter(r=>r.v.trim()!==''&&Number.isFinite(Number(r.v))).at(-1);if(!sample)throw new Error('NO_NUMERIC_OBSERVATION');
const binding=review.bindings.find(b=>b.file==='water-level.json')!;
const request:AdmissionRequest={schema:'payload.industrial-admission-request.v1',corpusId:'proposed-industrial-corpus',releaseId:'proposed-industrial-release',authority:null,ruledAt:new Date().toISOString(),purpose:'industrial-source-qualification',members:[{
 acquisitionId:binding.acquisitionId,releaseRecord:null,candidate:{candidateId:'candidate:'+randomUUID(),buildId:null,recordId:'record:proposed:'+randomUUID(),subjectCanonicalId:null,
 assertion:{subjectId:'9414290',predicate:'water_level.height',value:Number(sample.v),unit:'m',basis:'NAVD88'},origin:'REPORTED',
 evidenceClass:{claimStrength:'reported',productionClass:'measured',interest:'disinterested'},provenance:{artifactDigest:binding.contentDigest,capturedAt:binding.retrievedAt},provenanceClass:'LIVE_CAPTURE',sourceTime:null,
 conditions:['Internal source review; source quality flags remain in retained evidence; no navigation or flood claim.'],validFrom:new Date(sample.t.replace(' ','T')+':00Z').toISOString(),knownAt:review.inspectedAt,rightsDecision:'UNDECIDED'}}]};
const qualification=qualifyAdmission(request,intakeRoot,new Date().toISOString());
if(qualification.ready)throw new Error('UNAUTHORIZED_REAL_ADMISSION');
const failed=qualification.members[0].ruling.failed.map(x=>x.check);
for(const expected of ['SOURCE_CLOCK_COHERENT','SUBJECT_IDENTIFIED','RIGHTS_DECIDED','AUTHORITY_IS_NOT_THE_PROCESS'] as const)if(!failed.includes(expected))throw new Error('MISSING_REFUSAL_BOUNDARY');
writeFileSync(join(work,'real-admission-request.json'),JSON.stringify(request,null,2),{flag:'wx'});
writeFileSync(join(work,'qualification-report.json'),JSON.stringify({mode:mode==='--live'?'NEW_LIVE_CAPTURE':'RETAINED_REINSPECTION',refresh,secondInvocation,refreshInspection,resultInspection,qualification,canonicalWritePerformed:false,releasePublished:false},null,2),{flag:'wx'});
console.log(JSON.stringify({mode,failedChecks:failed,realAdmission:false,releasePublished:false}));
