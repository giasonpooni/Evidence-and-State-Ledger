/** Operational readiness is a machine check, not evidence admission or release authority. */
import { dirname, basename } from 'node:path';
import { readImmutableFile } from '../data-os/local-files';
import { parseReplayJson } from '../observation/json';
import { auditTail, verifyAuditChain } from './audit-chain';
import { serverConfigSchema } from './distribution-contract';
import { retainedReviewRequestSchema, reinspectRefreshResult } from './refresh-result';
import { inspectRefresh } from './refresh-state';
import { REFRESH_OPERATION } from './pipeline';
import { check, instant, LIMIT, type AuthorityKey } from './authority';
import { protectedConfigFile, type OperationsConfig } from './operations-config';

type State='PASS'|'HOLD'|'EXTERNAL';
type Item={id:string;state:State;detailCode:string};
const item=(id:string,state:State,detailCode:string):Item=>({id,state,detailCode});
function readPath(path:string,max=LIMIT){const b=readImmutableFile(dirname(path),[basename(path)],max);check(b,'READINESS_FILE_UNAVAILABLE');return b;}
function agePolicy(value:unknown):value is number{return Number.isInteger(value)&&Number(value)>0&&Number(value)<=24*60*60*1000;}

export function assessReviewReadiness(options:{distributionConfig:string;staticRoot:string;auditRoot:string;at:string;maxObservationAgeMs?:number}){
  instant.parse(options.at);const checks:Item[]=[];
  const policyOk=agePolicy(options.maxObservationAgeMs);
  checks.push(item('measurement-age-policy',policyOk?'PASS':'HOLD',policyOk?'MEASUREMENT_AGE_POLICY_BOUND':'FRESHNESS_POLICY_REQUIRED'));
  checks.push(item('distribution-config-protection',protectedConfigFile(options.distributionConfig)?'PASS':'HOLD',
    protectedConfigFile(options.distributionConfig)?'DISTRIBUTION_CONFIG_PROTECTED':'DISTRIBUTION_CONFIG_PERMISSIONS_UNSAFE'));
  try{
    const config=serverConfigSchema.parse(parseReplayJson(readPath(options.distributionConfig,256*1024),256*1024));
    const unique=config.credentials.length===new Set(config.credentials.map(x=>x.credentialId)).size&&
      config.credentials.length===new Set(config.credentials.map(x=>x.tokenDigest)).size&&
      config.resources.length===new Set(config.resources.map(x=>x.digest)).size;
    checks.push(item('credential-resource-registry',unique?'PASS':'HOLD',unique?'REGISTRY_UNIQUE':'DUPLICATE_CREDENTIAL_OR_RESOURCE'));
    const active=config.activeReviewDigest,resource=active?config.resources.find(r=>r.digest===active):undefined;
    const exact=!!active&&!!resource&&!resource.revoked&&resource.kind==='RETAINED_REVIEW'&&!!resource.requestFile;
    checks.push(item('active-retained-review',exact?'PASS':'HOLD',exact?'ACTIVE_RETAINED_REVIEW_BOUND':'ACTIVE_RETAINED_REVIEW_REQUIRED'));
    const current=!!active&&config.credentials.some(x=>!x.revoked&&Date.parse(x.notBefore)<=Date.parse(options.at)&&Date.parse(options.at)<Date.parse(x.notAfter)&&x.artifacts.includes(active));
    checks.push(item('active-reader',current?'PASS':'HOLD',current?'ACTIVE_READER_AVAILABLE':'ACTIVE_READER_REQUIRED'));
    const viewer=readImmutableFile(options.staticRoot,['industrial.html'],LIMIT);
    checks.push(item('viewer-build',viewer?'PASS':'HOLD',viewer?'VIEWER_BUILD_PRESENT':'VIEWER_BUILD_MISSING'));
    const tail=auditTail(options.auditRoot);
    if(tail.locked)checks.push(item('audit-chain','HOLD','AUDIT_CHAIN_BUSY'));
    else{
      const verified=verifyAuditChain(options.auditRoot);
      checks.push(item('audit-chain',verified.status==='VALID'?'PASS':'HOLD',verified.status==='VALID'?'AUDIT_CHAIN_VERIFIED':'AUDIT_CHAIN_INVALID'));
    }
    if(exact&&resource?.requestFile){
      const selectionProtected=protectedConfigFile(resource.requestFile);
      checks.push(item('retained-selection-protection',selectionProtected?'PASS':'HOLD',selectionProtected?'RETAINED_SELECTION_PROTECTED':'RETAINED_SELECTION_PERMISSIONS_UNSAFE'));
      const selected=retainedReviewRequestSchema.parse(parseReplayJson(readPath(resource.requestFile),LIMIT));
      const inspected=reinspectRefreshResult({root:selected.refreshRoot,intakeRoot:selected.intakeRoot,schedule:selected.schedule,
        attemptId:selected.attemptId,at:options.at,authorityKeys:config.authorityKeys as AuthorityKey[]});
      const ok=inspected.report.status==='REINSPECTED'&&inspected.report.result.compiledDigest===active;
      checks.push(item('retained-dependencies',ok?'PASS':'HOLD',ok?'RETAINED_DEPENDENCIES_REINSPECTED':'RETAINED_DEPENDENCIES_UNAVAILABLE'));
      if(ok){
        const age=inspected.report.freshness.observationAgeMs;
        checks.push(item('numeric-observation',age!==null?'PASS':'HOLD',age!==null?'NUMERIC_OBSERVATION_PRESENT':'NUMERIC_OBSERVATION_REQUIRED'));
        const fresh=policyOk&&age!==null&&age<=options.maxObservationAgeMs!;
        checks.push(item('measurement-freshness',fresh?'PASS':'HOLD',fresh?'MEASUREMENT_WITHIN_OPERATOR_BUDGET':'MEASUREMENT_TOO_OLD'));
      }else{
        checks.push(item('numeric-observation','HOLD','NUMERIC_OBSERVATION_UNAVAILABLE'));
        checks.push(item('measurement-freshness','HOLD','MEASUREMENT_FRESHNESS_UNAVAILABLE'));
      }
    }else{
      checks.push(item('retained-selection-protection','HOLD','RETAINED_SELECTION_UNAVAILABLE'));
      checks.push(item('retained-dependencies','HOLD','RETAINED_SELECTION_UNAVAILABLE'));
      checks.push(item('numeric-observation','HOLD','NUMERIC_OBSERVATION_UNAVAILABLE'));
      checks.push(item('measurement-freshness','HOLD','MEASUREMENT_FRESHNESS_UNAVAILABLE'));
    }
  }catch{checks.push(item('configuration','HOLD','REVIEW_CONFIGURATION_UNAVAILABLE'));}
  return {schema:'payload.industrial-review-readiness.v1' as const,at:options.at,status:checks.every(x=>x.state==='PASS')?'READY' as const:'HOLD' as const,checks};
}

export function assessCollectorReadiness(c:OperationsConfig,at:string){
  instant.parse(at);const status=inspectRefresh({root:c.root,schedule:c.schedule,operation:REFRESH_OPERATION,authorityKeys:c.authorityKeys as AuthorityKey[],at});
  const schedule=(c.schedule??{}) as {enabled?:unknown};
  const checks:Item[]=[item('schedule-enabled',schedule.enabled===true?'PASS':'HOLD',schedule.enabled===true?'SCHEDULE_ENABLED':'SCHEDULE_DISABLED')];
  const readable=['INSPECTED','UNINITIALIZED'].includes(status.status);
  checks.push(item('journal',readable?'PASS':'HOLD',readable?'REFRESH_JOURNAL_READABLE':status.reasonCode??status.status));
  const plan=(status as {plan?:{decision?:string}|null}).plan;const windowOk=!plan||!['WINDOW_CLOSED','RUN_LIMIT_REACHED'].includes(plan.decision??'');
  checks.push(item('future-capacity',windowOk?'PASS':'HOLD',windowOk?'REFRESH_CAPACITY_AVAILABLE':plan?.decision??'REFRESH_CAPACITY_UNAVAILABLE'));
  return {schema:'payload.industrial-collector-readiness.v1' as const,at,status:checks.every(x=>x.state==='PASS')?'READY' as const:'HOLD' as const,checks,journal:status};
}

export function assessInstrumentReadiness(c:OperationsConfig,at:string){
  const review=assessReviewReadiness({distributionConfig:c.distributionConfig,staticRoot:c.staticRoot,auditRoot:c.auditRoot,at,
    maxObservationAgeMs:c.reviewReadiness?.maxObservationAgeMs});
  const collector=assessCollectorReadiness(c,at);
  let audit:{status:string,eventCount:number,headDigest:string|null,chainDigest?:string}|null=null;
  try{audit=verifyAuditChain(c.auditRoot);}catch{audit={status:'INVALID',eventCount:0,headDigest:null};}
  const softwareReady=review.status==='READY'&&collector.status==='READY'&&audit.status==='VALID';
  const external:Item[]=[
    item('canonical-admission-authority','EXTERNAL','OPERATOR_IDENTITY_RIGHTS_AND_SOURCE_CLOCK_REQUIRED'),
    item('customer-release-authority','EXTERNAL','CERTIFIED_RELEASE_AND_RIGHTS_REQUIRED'),
    item('pinned-candidate-replay','EXTERNAL','AUTHORIZED_PRIVATE_DEPENDENCY_REPLAY_REQUIRED'),
    item('remote-access-boundary','EXTERNAL','TLS_IDP_OR_MTLS_REQUIRED_FOR_REMOTE_ACCESS'),
    item('geodetic-qualification','EXTERNAL','DATUM_TRANSFORM_AND_ACCURACY_VALIDATION_REQUIRED'),
    item('durable-backup','EXTERNAL','OFF_HOST_IMMUTABLE_BACKUP_REQUIRED'),
  ];
  return {schema:'payload.industrial-instrument-readiness.v1' as const,at,
    internalInstrument:softwareReady?'READY' as const:'HOLD' as const,productionRelease:'HOLD_EXTERNAL' as const,
    review,collector,audit,external,canonicalAdmission:false,release:null};
}
