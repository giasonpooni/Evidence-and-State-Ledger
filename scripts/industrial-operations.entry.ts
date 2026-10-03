/** Explicit local CLI. No server, collector or admission is activated by installation. */
import { dirname, basename } from 'node:path';
import { once } from 'node:events';
import { readImmutableFile } from '../src/data-os/local-files';
import { parseReplayJson } from '../src/observation/json';
import { qualifyAdmission, executeAdmission } from '../src/industrial-operations/admission';
import { prepareInternalRelease, publishInternalRelease } from '../src/industrial-operations/release';
import { refreshOnce } from '../src/industrial-operations/refresh';
import { inspectRefresh } from '../src/industrial-operations/refresh-state';
import { inspectRefreshResult } from '../src/industrial-operations/refresh-result';
import { prepareRefreshQuarantine, quarantineRefresh } from '../src/industrial-operations/refresh-quarantine';
import { fixedRefreshPipeline, REFRESH_OPERATION } from '../src/industrial-operations/pipeline';
import { createDistributionServer, serverConfigSchema } from '../src/industrial-operations/distribution';
import { operationsConfigSchema, protectedConfigFile } from '../src/industrial-operations/operations-config';
import { assessReviewReadiness, assessCollectorReadiness, assessInstrumentReadiness } from '../src/industrial-operations/readiness';
import { buildIntegrityManifest, verifyIntegrityManifest } from '../src/industrial-operations/integrity-manifest';
import { LIMIT, type AuthorityKey } from '../src/industrial-operations/authority';

function json(path:string){const bytes=readImmutableFile(dirname(path),[basename(path)],LIMIT);if(!bytes)throw new Error('FILE_UNAVAILABLE');return parseReplayJson(bytes,LIMIT);}
async function main(){
  const [command,configFile,requestFile,approvalFile,...extra]=process.argv.slice(2);
  if(command==='--help'||!command){console.log('industrial-operations qualify|admit|prepare-release|release CONFIG REQUEST [APPROVAL]\nindustrial-operations refresh|refresh-status|serve CONFIG\nindustrial-operations refresh-inspect CONFIG ATTEMPT_ID\nindustrial-operations prepare-refresh-quarantine CONFIG ATTEMPT_ID\nindustrial-operations quarantine-refresh CONFIG REQUEST APPROVAL\nindustrial-operations doctor CONFIG review|collector|all\nindustrial-operations integrity-snapshot CONFIG\nindustrial-operations integrity-verify CONFIG MANIFEST');return;}
  if(!configFile||extra.length)throw new Error('INVALID_ARGUMENTS');const c=operationsConfigSchema.parse(json(configFile));
  const keys=c.authorityKeys as AuthorityKey[],at=new Date().toISOString();let result:unknown;
  if(command==='refresh'){if(requestFile||approvalFile)throw new Error('INVALID_ARGUMENTS');
    result=await refreshOnce({root:c.root,schedule:c.schedule,operation:REFRESH_OPERATION,now:()=>new Date().toISOString(),authorityKeys:keys,execute:fixedRefreshPipeline(c)});
  }else if(command==='refresh-status'){if(requestFile||approvalFile)throw new Error('INVALID_ARGUMENTS');
    result=inspectRefresh({root:c.root,schedule:c.schedule,operation:REFRESH_OPERATION,authorityKeys:keys,at});
    if(['UNAVAILABLE','LOCKED','BLOCKED'].includes((result as {status:string}).status))process.exitCode=2;
  }else if(command==='refresh-inspect'){if(!requestFile||approvalFile)throw new Error('INVALID_ARGUMENTS');
    const inspected=inspectRefreshResult({root:c.root,intakeRoot:c.intakeRoot,schedule:c.schedule,authorityKeys:keys,at,attemptId:requestFile});
    result=inspected;if(inspected.status!=='REINSPECTED')process.exitCode=2;
  }else if(command==='prepare-refresh-quarantine'){if(!requestFile||approvalFile)throw new Error('INVALID_ARGUMENTS');
    result=prepareRefreshQuarantine({root:c.root,schedule:c.schedule,operation:REFRESH_OPERATION,authorityKeys:keys,at,attemptId:requestFile});
  }else if(command==='quarantine-refresh'){if(!requestFile||!approvalFile)throw new Error('INVALID_ARGUMENTS');
    result=quarantineRefresh({root:c.root,schedule:c.schedule,operation:REFRESH_OPERATION,authorityKeys:keys,at,request:json(requestFile),approval:json(approvalFile)});
  }else if(command==='doctor'){
    if(!requestFile||approvalFile||!['review','collector','all'].includes(requestFile))throw new Error('INVALID_ARGUMENTS');
    if(!protectedConfigFile(configFile))throw new Error('OPERATIONS_CONFIG_PERMISSIONS_UNSAFE');
    result=requestFile==='review'?assessReviewReadiness({distributionConfig:c.distributionConfig,staticRoot:c.staticRoot,auditRoot:c.auditRoot,at,maxObservationAgeMs:c.reviewReadiness?.maxObservationAgeMs}):
      requestFile==='collector'?assessCollectorReadiness(c,at):assessInstrumentReadiness(c,at);
    const status=requestFile==='all'?(result as {internalInstrument:string}).internalInstrument:(result as {status:string}).status;
    if(status!=='READY')process.exitCode=2;
  }else if(command==='integrity-snapshot'){
    if(requestFile||approvalFile)throw new Error('INVALID_ARGUMENTS');
    result=buildIntegrityManifest({refresh:c.root,intake:c.intakeRoot,audit:c.auditRoot,static:c.staticRoot},at);
  }else if(command==='integrity-verify'){
    if(!requestFile||approvalFile)throw new Error('INVALID_ARGUMENTS');
    result=verifyIntegrityManifest({refresh:c.root,intake:c.intakeRoot,audit:c.auditRoot,static:c.staticRoot},json(requestFile));
    if((result as {status:string}).status!=='MATCH')process.exitCode=2;
  }else if(command==='serve'){if(requestFile||approvalFile)throw new Error('INVALID_ARGUMENTS');serverConfigSchema.parse(json(c.distributionConfig));
    if(!protectedConfigFile(configFile))throw new Error('OPERATIONS_CONFIG_PERMISSIONS_UNSAFE');
    const preflight=assessReviewReadiness({distributionConfig:c.distributionConfig,staticRoot:c.staticRoot,auditRoot:c.auditRoot,at,maxObservationAgeMs:c.reviewReadiness?.maxObservationAgeMs});
    if(preflight.status!=='READY')throw new Error('INSTRUMENT_NOT_READY');
    const service=createDistributionServer({configFile:c.distributionConfig,staticRoot:c.staticRoot,objectRoot:c.objectRoot,auditRoot:c.auditRoot,maxObservationAgeMs:c.reviewReadiness?.maxObservationAgeMs});
    service.listen(c.port);await once(service.server,'listening');
    let stopping=false;const shutdown=()=>{if(stopping)return;stopping=true;service.beginDrain();const force=setTimeout(()=>service.server.closeAllConnections(),10000);force.unref();service.server.close(()=>clearTimeout(force));};
    process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
    console.log(JSON.stringify({status:'AUTHENTICATED_LOOPBACK_LISTENER',port:c.port,login:'/login',health:'/healthz',readiness:'/readyz',metrics:'/metrics'}));
    await once(service.server,'close');return;
  }else {if(!requestFile)throw new Error('REQUEST_REQUIRED');const request=json(requestFile);
    if(command==='qualify'&&!approvalFile)result=qualifyAdmission(request,c.intakeRoot,at);
    else if(command==='prepare-release'&&!approvalFile)result=await prepareInternalRelease(request,c.objectRoot,at);
    else if(command==='admit'&&approvalFile)result=await executeAdmission(request,json(approvalFile),keys,c.intakeRoot,c.auditRoot,at);
    else if(command==='release'&&approvalFile)result=await publishInternalRelease(request,json(approvalFile),keys,c.objectRoot,c.auditRoot,at);
    else throw new Error('INVALID_ARGUMENTS');
  }
  console.log(JSON.stringify(result,null,2));
}
void main().catch(error=>{const message=error instanceof Error&&/^[A-Z_]{3,80}$/.test(error.message)?error.message:'OPERATION_REFUSED';console.error(JSON.stringify({error:message}));process.exitCode=1;});
