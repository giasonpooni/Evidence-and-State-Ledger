import { parseReplayJson } from '../observation/json';
/** Loopback authenticated transport. No default-open mode, remote listener or client-selected paths. */
import { createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import { dirname, basename } from 'node:path';
import { z } from 'zod';
import { readImmutableFile, publishImmutableFile } from '../data-os/local-files';
import { encodeLocalRecord } from '../data-os/local-record';
import { byteDigest } from '../data-os/evidence-capture';
import { reinspectRelease } from './release';
import { retainedReviewRequestSchema, reinspectRefreshResult } from './refresh-result';
import { approvalAction, check, hash, id, instant, LIMIT, type AuthorityKey } from './authority';
const tokenPattern=/^esm_[A-Za-z0-9_-]{43}$/;
export const credentialSchema=z.object({credentialId:id,recipientId:id,tokenDigest:hash,notBefore:instant,notAfter:instant,
  revoked:z.boolean(),artifacts:z.array(hash).min(1).max(128)}).strict();
const keySchema=z.object({keyId:id,authorityId:id,publicKeyPem:z.string().min(1).max(4096),actions:z.array(approvalAction).min(1).max(3),notBefore:instant,notAfter:instant,revoked:z.boolean()}).strict();
export const serverConfigSchema=z.object({schema:z.literal('payload.industrial-distribution.v1'),
  credentials:z.array(credentialSchema).min(1).max(64),authorityKeys:z.array(keySchema).max(32),
  resources:z.array(z.object({digest:hash,kind:z.enum(['REVIEW','RELEASE','RETAINED_REVIEW']),file:z.string().min(1).max(2048),requestFile:z.string().max(2048).nullable(),revoked:z.boolean()}).strict()).max(128),
  activeReviewDigest:hash.nullable()}).strict();
export type ServerConfig=z.infer<typeof serverConfigSchema>;
export const tokenDigest=(token:string)=>byteDigest(Buffer.from(token,'utf8'));
function selectedToken(req:IncomingMessage):string|null{
  // Reject repeated credential headers rather than accept a proxy-dependent first/last value.
  const names=req.rawHeaders.filter((_,i)=>i%2===0).map(x=>x.toLowerCase());
  if(names.filter(x=>x==='authorization').length>1||names.filter(x=>x==='cookie').length>1)return null;
  const auth=req.headers.authorization;const cookies=(req.headers.cookie??'').split(';').map(x=>x.trim()).filter(x=>x.startsWith('esm_session='));
  if(cookies.length>1)return null;const cookie=cookies[0]?.slice(12);
  if(auth&&!/^Bearer esm_[A-Za-z0-9_-]{43}$/.test(auth))return null;
  const bearer=auth?.slice(7);if(bearer&&cookie&&bearer!==cookie)return null;
  const token=bearer??cookie;return token&&tokenPattern.test(token)?token:null;
}
function authenticate(req:IncomingMessage,config:ServerConfig,now:number){
  const token=selectedToken(req);const given=Buffer.from(tokenDigest(token??''));let match:ServerConfig['credentials'][number]|undefined;
  for(const c of config.credentials)if(timingSafeEqual(given,Buffer.from(c.tokenDigest)))match=c;
  if(!token||!match||match.revoked||Date.parse(match.notBefore)>now||now>=Date.parse(match.notAfter))return null;
  return {token,credential:match};
}
function readPath(path:string,max=LIMIT){const b=readImmutableFile(dirname(path),[basename(path)],max);check(b,'FILE_UNAVAILABLE');return b;}
const loginScript="document.querySelector('form').onsubmit=async e=>{e.preventDefault();const i=document.querySelector('input');let t=i.value;i.value='';try{const r=await fetch('/session',{method:'POST',headers:{Authorization:'Bearer '+t}});t='';if(!r.ok)throw Error();location.assign('/industrial.html');}catch{document.querySelector('output').textContent='Access denied or unavailable.';}};";
const loginHtml=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>ESM internal access</title><link rel="icon" href="data:,"><h1>Industrial source review</h1><p>Authenticated internal access. A credential does not admit or release evidence.</p><form><label>Access token <input type="password" autocomplete="off" maxlength="47" required></label><button>Open review</button></form><output></output><script>${loginScript}</script>`;
export interface DistributionReadinessProbe { status:'READY'|'NOT_READY'; assessedAt:string; reasonCodes:readonly string[]; }
export function createDistributionServer(options:{configFile:string;staticRoot:string;objectRoot:string;auditRoot:string;now?:()=>string;readiness?:()=>DistributionReadinessProbe|Promise<DistributionReadinessProbe>}){
  const now=options.now??(()=>new Date().toISOString());let boundPort=0;let count=0,windowStart=performance.now(),draining=false;
  const server=createServer({maxHeaderSize:8192},async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cross-Origin-Resource-Policy','same-origin');
    const deny=(status:number)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end('{"error":"ACCESS_UNAVAILABLE"}');};
    try{
      if(performance.now()-windowStart>=60000){count=0;windowStart=performance.now();}if(++count>240){deny(429);return;}
      const host=req.headers.host;check(host===`127.0.0.1:${boundPort}`||host===`localhost:${boundPort}`,'INVALID_HOST');
      check(!req.headers.origin||req.headers.origin===`http://${host}`,'CROSS_ORIGIN');
      check(!req.headers['sec-fetch-site']||['same-origin','none'].includes(String(req.headers['sec-fetch-site'])),'CROSS_ORIGIN');
      const path=req.url??'';check(path.length<=512&&!path.includes('?')&&!path.includes('%')&&!path.includes('..'),'INVALID_PATH');
      if(path==='/healthz'&&req.method==='GET'){
        res.statusCode=200;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({schema:'payload.industrial-health.v1',status:draining?'DRAINING':'ALIVE'}));return;
      }
      if(path==='/readyz'&&req.method==='GET'){
        const report=draining?{status:'NOT_READY' as const,assessedAt:instant.parse(now()),reasonCodes:['DRAINING']}:
          options.readiness?await options.readiness():{status:'NOT_READY' as const,assessedAt:instant.parse(now()),reasonCodes:['READINESS_NOT_CONFIGURED']};
        res.statusCode=report.status==='READY'?200:503;res.setHeader('Content-Type','application/json');
        res.end(JSON.stringify({schema:'payload.industrial-readiness-probe.v1',status:report.status,assessedAt:report.assessedAt,reasonCodes:report.reasonCodes}));return;
      }
      if(path==='/login'&&req.method==='GET'){
        res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Content-Security-Policy',`default-src 'none'; img-src data:; script-src 'sha256-${createHash('sha256').update(loginScript).digest('base64')}'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`);res.end(loginHtml);return;
      }
      const config=serverConfigSchema.parse(parseReplayJson(readPath(options.configFile,256*1024),256*1024));
      check(new Set(config.credentials.map(c=>c.tokenDigest)).size===config.credentials.length&&new Set(config.credentials.map(c=>c.credentialId)).size===config.credentials.length,'DUPLICATE_CREDENTIAL');
      check(new Set(config.resources.map(r=>r.digest)).size===config.resources.length,'DUPLICATE_RESOURCE');
      const at=instant.parse(now()),auth=authenticate(req,config,Date.parse(at));
      if(!auth){deny(401);return;}
      if(path==='/session'&&req.method==='POST'){
        check(req.headers.authorization&&!(Number(req.headers['content-length']??0)>0)&&!req.headers['transfer-encoding'],'INVALID_LOGIN');
        const age=Math.max(0,Math.min(3600,Math.floor((Date.parse(auth.credential.notAfter)-Date.parse(at))/1000)));
        res.setHeader('Set-Cookie',`esm_session=${auth.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}`);res.statusCode=204;res.end();return;
      }
      if(path==='/logout'&&req.method==='POST'){res.setHeader('Set-Cookie','esm_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');res.statusCode=204;res.end();return;}
      if(req.method!=='GET'){deny(405);return;}
      const match=/^\/(?:v1\/artifacts\/([a-f0-9]{64})|industrial-data\/review-([a-f0-9]{64})\.json)$/.exec(path);
      const index=path==='/industrial-data/index.json';
      if(index||match){
        const digest=index?config.activeReviewDigest:`sha256:${match![1]??match![2]}`;
        const resource=config.resources.find(r=>r.digest===digest);
        if(!digest||!resource||resource.revoked||!auth.credential.artifacts.includes(digest)){deny(403);return;}
        const bytes=readPath(resource.file);check(byteDigest(bytes)===digest,'ARTIFACT_HASH_MISMATCH');
        const value=parseReplayJson(bytes,LIMIT) as Record<string,unknown>;
        let retainedInspection: ReturnType<typeof reinspectRefreshResult>['report'] | null = null;
        if(resource.kind==='RETAINED_REVIEW'){
          check(resource.requestFile,'RETAINED_SELECTION_REQUIRED');
          const selected=retainedReviewRequestSchema.parse(parseReplayJson(readPath(resource.requestFile),LIMIT));
          check(selected.compiledDigest===digest,'RETAINED_SELECTION_MISMATCH');
          const verified=reinspectRefreshResult({root:selected.refreshRoot,intakeRoot:selected.intakeRoot,
            schedule:selected.schedule,attemptId:selected.attemptId,at,authorityKeys:config.authorityKeys as AuthorityKey[]});
          check(verified.report.result.compiledDigest===digest && verified.compiledBytes.equals(bytes),'RETAINED_SELECTION_MISMATCH');
          retainedInspection=verified.report;
        }else if(resource.kind==='REVIEW')check(value.schema==='gsc.industrial-review.v1'&&value.audience==='INTERNAL'&&value.status==='UNADMITTED_SOURCE_REVIEW'&&value.canonicalAdmission===false&&value.release===null,'NOT_AN_INTERNAL_REVIEW');
        else {
          check(!index&&!path.startsWith('/industrial-data/')&&resource.requestFile,'RELEASE_NOT_REVIEW');
          const request=parseReplayJson(readPath(resource.requestFile!),LIMIT);
          const release=await reinspectRelease(request,value,config.authorityKeys as AuthorityKey[],options.objectRoot,at);
          check(release.recipientId===auth.credential.recipientId,'RECIPIENT_MISMATCH');
        }
        if(retainedInspection)publishImmutableFile(options.auditRoot,['inspections',retainedInspection.digest.slice(7)+'.json'],encodeLocalRecord(retainedInspection),LIMIT);
        // A successful access is retained before a payload leaves. No token, cookie or raw URL enters this log.
        publishImmutableFile(options.auditRoot,['deliveries',`${randomUUID()}.json`],encodeLocalRecord({schema:'payload.industrial-delivery-audit.v1',at,credentialId:auth.credential.credentialId,recipientId:auth.credential.recipientId,artifactDigest:digest,kind:resource.kind,...(retainedInspection?{inspectionDigest:retainedInspection.digest,
          historyDigest:retainedInspection.historyDigest,freshness:retainedInspection.freshness}: {})}),LIMIT);
        const out=index?Buffer.from(JSON.stringify({schema:'gsc.industrial-review-index.v1',audience:'INTERNAL',file:`review-${digest.slice(7)}.json`,sha256:digest,bytes:bytes.length,canonicalAdmission:false,release:null})):bytes;
        res.setHeader('Content-Type','application/json');res.setHeader('X-Artifact-Digest',digest);
        res.setHeader('X-Evidence-Verification',retainedInspection?'RETAINED_BYTES_AND_DIRECT_BINDINGS':resource.kind==='REVIEW'?'ARTIFACT_ONLY':'NATIVE_RELEASE');
        if(retainedInspection){res.setHeader('X-Inspection-Digest',retainedInspection.digest);
          res.setHeader('X-Observation-Freshness',retainedInspection.freshness.state);
          res.setHeader('X-Observation-Age-Ms',retainedInspection.freshness.observationAgeMs===null?'unknown':String(retainedInspection.freshness.observationAgeMs));}
        res.end(out);return;
      }
      // Serve only the compiled viewer's known static path classes, never a directory or its embedded data.
      const name=path==='/'?'industrial.html':path.slice(1);
      check(name==='industrial.html'||/^assets\/[A-Za-z0-9_-]+\.(js|css)$/.test(name)||/^data\/(countries-110m|land-50m)\.json$/.test(name),'STATIC_PATH_REFUSED');
      const bytes=readImmutableFile(options.staticRoot,name.split('/'),LIMIT);check(bytes,'STATIC_UNAVAILABLE');
      res.setHeader('Content-Type',name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':'application/json');
      res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");res.end(bytes);
    }catch{if(!res.headersSent)deny(503);else res.end();}
  });
  server.requestTimeout=15000;server.headersTimeout=10000;server.keepAliveTimeout=5000;
  server.on('listening',()=>{const address=server.address();if(address&&typeof address!=='string')boundPort=address.port;});
  return {server,listen:(port=0)=>{check(Number.isInteger(port)&&port>=0&&port<=65535,'INVALID_PORT');return server.listen(port,'127.0.0.1');},
    beginDrain:()=>{draining=true;server.closeIdleConnections();},isDraining:()=>draining};
}
/** Raw key material is returned to the explicit provisioning caller, never written into config or logs. */
export function credentialForToken(token:string,recipientId:string,artifactDigest:string,notBefore:string,notAfter:string){
  check(tokenPattern.test(token),'TOKEN_REQUIRES_32_RANDOM_BYTES');return credentialSchema.parse({credentialId:`credential:${randomUUID()}`,recipientId,tokenDigest:tokenDigest(token),notBefore,notAfter,revoked:false,artifacts:[artifactDigest]});
}
