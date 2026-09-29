/** Explicit local CLI. No server, collector or admission is activated by installation. */
import { dirname, basename } from 'node:path';
import { once } from 'node:events';
import { readImmutableFile } from '../src/data-os/local-files';
import { z } from 'zod';
import { parseReplayJson } from '../src/observation/json';
import { qualifyAdmission, executeAdmission } from '../src/industrial-operations/admission';
import { prepareInternalRelease, publishInternalRelease } from '../src/industrial-operations/release';
import { refreshOnce } from '../src/industrial-operations/refresh';
import { inspectRefresh } from '../src/industrial-operations/refresh-state';
import { inspectRefreshResult } from '../src/industrial-operations/refresh-result';
import { prepareRefreshQuarantine, quarantineRefresh } from '../src/industrial-operations/refresh-quarantine';
import { fixedRefreshPipeline, REFRESH_OPERATION } from '../src/industrial-operations/pipeline';
import { createDistributionServer, serverConfigSchema } from '../src/industrial-operations/distribution';
import { assessIndustrialReadiness, publicReadiness, readinessPolicySchema } from '../src/industrial-operations/readiness';
import { LIMIT, type AuthorityKey } from '../src/industrial-operations/authority';
const configSchema=z.object({root:z.string().min(1),intakeRoot:z.string().min(1),objectRoot:z.string().min(1),auditRoot:z.string().min(1),
  gscRoot:z.string().min(1),pythonExecutable:z.string().min(1),schedule:z.unknown(),authorityKeys:z.array(z.unknown()),
  distributionConfig:z.string().min(1),staticRoot:z.string().min(1),port:z.number().int().min(1024).max(65535),
  readinessPolicy:readinessPolicySchema.optional()}).strict();
function json(path:string){const bytes=readImmutableFile(dirname(path),[basename(path)],LIMIT);if(!bytes)throw new Error('FILE_UNAVAILABLE');return parseReplayJson(bytes,LIMIT);}
async function main(){
  const [command,configFile,requestFile,approvalFile,...extra]=process.argv.slice(2);
  if(command==='--help'||!command){console.log('industrial-operations qualify|admit|prepare-release|release CONFIG REQUEST [APPROVAL]\nindustrial-operations refresh|refresh-status|readiness|serve CONFIG\nindustrial-operations refresh-inspect CONFIG ATTEMPT_ID\nindustrial-operations prepare-refresh-quarantine CONFIG ATTEMPT_ID\nindustrial-operations quarantine-refresh CONFIG REQUEST APPROVAL');return;}
  if(!configFile||extra.length)throw new Error('INVALID_ARGUMENTS');const c=configSchema.parse(json(configFile));
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
  }else if(command==='readiness'){if(requestFile||approvalFile)throw new Error('INVALID_ARGUMENTS');if(!c.readinessPolicy)throw new Error('READINESS_POLICY_REQUIRED');
    result=assessIndustrialReadiness({operationsConfigFile:configFile,distributionConfigFile:c.distributionConfig,root:c.root,intakeRoot:c.intakeRoot,
      objectRoot:c.objectRoot,auditRoot:c.auditRoot,staticRoot:c.staticRoot,schedule:c.schedule,authorityKeys:keys,policy:c.readinessPolicy,at});
    if((result as {status:string}).status!=='READY')process.exitCode=2;
  }else if(command==='serve'){if(requestFile||approvalFile)throw new Error('INVALID_ARGUMENTS');serverConfigSchema.parse(json(c.distributionConfig));if(!c.readinessPolicy)throw new Error('READINESS_POLICY_REQUIRED');
    const readiness=()=>publicReadiness(assessIndustrialReadiness({operationsConfigFile:configFile,distributionConfigFile:c.distributionConfig,root:c.root,intakeRoot:c.intakeRoot,
      objectRoot:c.objectRoot,auditRoot:c.auditRoot,staticRoot:c.staticRoot,schedule:c.schedule,authorityKeys:keys,policy:c.readinessPolicy,at:new Date().toISOString()}));
    const initial=await readiness();if(initial.status!=='READY')throw new Error('INSTRUMENT_NOT_READY');
    const service=createDistributionServer({configFile:c.distributionConfig,staticRoot:c.staticRoot,objectRoot:c.objectRoot,auditRoot:c.auditRoot,readiness});
    service.listen(c.port);await once(service.server,'listening');
    let stopping=false;const shutdown=()=>{if(stopping)return;stopping=true;service.beginDrain();const force=setTimeout(()=>service.server.closeAllConnections(),10000);force.unref();service.server.close(()=>clearTimeout(force));};
    process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
    console.log(JSON.stringify({status:'AUTHENTICATED_LOOPBACK_LISTENER',port:c.port,login:'/login',health:'/healthz',readiness:'/readyz'}));return;
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
