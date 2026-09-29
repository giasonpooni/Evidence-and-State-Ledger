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
import type { OperationsConfig } from './operations-config';

type State='PASS'|'HOLD'|'EXTERNAL';
type Item={id:string;state:State;detailCode:string};
const item=(id:string,state:State,detailCode:string):Item=>({id,state,detailCode});
function readPath(path:string,max=LIMIT){const b=readImmutableFile(dirname(path),[basename(path)],max);check(b,'READINESS_FILE_UNAVAILABLE');return b;}

export function assessReviewReadiness(options:{distributionConfig:string;staticRoot:string;auditRoot:string;at:string}){
  instant.parse(options.at);const checks:Item[]=[];
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
    const tail=auditTail(options.auditRoot);const auditOk=!tail.locked;
    checks.push(item('audit-tail',auditOk?'PASS':'HOLD',auditOk?'AUDIT_TAIL_AVAILABLE':'AUDIT_CHAIN_BUSY'));
    if(exact&&resource?.requestFile){
      const selected=retainedReviewRequestSchema.parse(parseReplayJson(readPath(resource.requestFile),LIMIT));
      const inspected=reinspectRefreshResult({root:selected.refreshRoot,intakeRoot:selected.intakeRoot,schedule:selected.schedule,
        attemptId:selected.attemptId,at:options.at,authorityKeys:config.authorityKeys as AuthorityKey[]});
      const ok=inspected.report.status==='REINSPECTED'&&inspected.report.result.compiledDigest===active;
      checks.push(item('retained-dependencies',ok?'PASS':'HOLD',ok?'RETAINED_DEPENDENCIES_REINSPECTED':'RETAINED_DEPENDENCIES_UNAVAILABLE'));
    }else checks.push(item('retained-dependencies','HOLD','RETAINED_SELECTION_UNAVAILABLE'));
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
  const review=assessReviewReadiness({distributionConfig:c.distributionConfig,staticRoot:c.staticRoot,auditRoot:c.auditRoot,at});
  const collector=assessCollectorReadiness(c,at);
  let audit:{status:string,eventCount:number,headDigest:string|null,chainDigest?:string}|null=null;
  try{audit=verifyAuditChain(c.auditRoot);}catch{audit={status:'INVALID',eventCount:0,headDigest:null};}
  const softwareReady=review.status==='READY'&&collector.status==='READY'&&audit.status==='VALID';
  const external:Item[]=[
    item('canonical-admission-authority','EXTERNAL','OPERATOR_IDENTITY_RIGHTS_AND_SOURCE_CLOCK_REQUIRED'),
    item('customer-release-authority','EXTERNAL','CERTIFIED_RELEASE_AND_RIGHTS_REQUIRED'),
    item('remote-access-boundary','EXTERNAL','TLS_IDP_OR_MTLS_REQUIRED_FOR_REMOTE_ACCESS'),
    item('geodetic-qualification','EXTERNAL','DATUM_TRANSFORM_AND_ACCURACY_VALIDATION_REQUIRED'),
    item('durable-backup','EXTERNAL','OFF_HOST_IMMUTABLE_BACKUP_REQUIRED'),
  ];
  return {schema:'payload.industrial-instrument-readiness.v1' as const,at,
    internalInstrument:softwareReady?'READY' as const:'HOLD' as const,productionRelease:'HOLD_EXTERNAL' as const,
    review,collector,audit,external,canonicalAdmission:false,release:null};
}
