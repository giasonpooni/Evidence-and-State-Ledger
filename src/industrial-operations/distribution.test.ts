import {it,expect,afterEach} from 'vitest';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {once} from 'node:events';
import {byteDigest} from '../data-os/evidence-capture';
import {createDistributionServer,credentialForToken,type ServerConfig} from './distribution';
const at='2026-09-29T12:00:00.000Z',end='2026-09-29T13:00:00.000Z';
const roots:string[]=[];afterEach(()=>roots.splice(0).forEach(p=>rmSync(p,{recursive:true,force:true})));
async function fixture(){
 const root=mkdtempSync(join(tmpdir(),'esm-distribution-'));roots.push(root);const site=join(root,'site');mkdirSync(site);writeFileSync(join(site,'industrial.html'),'public viewer code');
 const bytes=Buffer.from(JSON.stringify({schema:'gsc.industrial-review.v1',status:'UNADMITTED_SOURCE_REVIEW',audience:'INTERNAL',canonicalAdmission:false,release:null,marker:'test-only'}));
 const digest=byteDigest(bytes),file=join(root,'review.json');writeFileSync(file,bytes);const token='esm_'+randomBytes(32).toString('base64url');
 const config:ServerConfig={schema:'payload.industrial-distribution.v1',credentials:[credentialForToken(token,'operator:test',digest,at,end)],authorityKeys:[],resources:[{digest,kind:'REVIEW',file,requestFile:null,revoked:false}],activeReviewDigest:digest};
 const configFile=join(root,'access.json');const save=()=>writeFileSync(configFile,JSON.stringify(config));save();let now=at;
 const app=createDistributionServer({configFile,staticRoot:site,objectRoot:join(root,'objects'),auditRoot:root,now:()=>now,readiness:()=>({status:'READY',assessedAt:now,reasonCodes:[]})});app.listen();await once(app.server,'listening');const address=app.server.address();if(!address||typeof address==='string')throw new Error('listen');
 const base=`http://127.0.0.1:${address.port}`,path='/v1/artifacts/'+digest.slice(7);return {root,config,save,file,token,bytes,path,base,app,request:(p=path,init:RequestInit={})=>fetch(base+p,init),auth:{Authorization:'Bearer '+token},clock:(value:string)=>{now=value;},close:async()=>{app.server.closeAllConnections();await new Promise<void>(r=>app.server.close(()=>r()));}};
}
it('real HTTP denies unauthenticated data and serves an authenticated exact artifact',async()=>{const f=await fixture();try{
 expect((await f.request()).status).toBe(401);const r=await f.request(f.path,{headers:f.auth});expect(r.status).toBe(200);expect(Buffer.from(await r.arrayBuffer())).toEqual(f.bytes);expect(r.headers.get('cache-control')).toBe('no-store');
 const files=readdirSync(join(f.root,'deliveries'));expect(files.length).toBe(1);expect(readFileSync(join(f.root,'deliveries',files[0]),'utf8')).not.toContain(f.token);
}finally{await f.close();}});
it('same-origin login sets an HttpOnly cookie and serves the unmodified viewer paths',async()=>{const f=await fixture();try{
 const login=await f.request('/session',{method:'POST',headers:f.auth});expect(login.status).toBe(204);const cookie=login.headers.get('set-cookie')!;expect(cookie).toContain('HttpOnly');expect(cookie).toContain('SameSite=Strict');
 const headers={Cookie:cookie.split(';')[0]};expect((await f.request('/industrial.html',{headers})).status).toBe(200);expect((await f.request('/industrial-data/index.json',{headers})).status).toBe(200);
 expect((await f.request('/industrial-data/review-'+f.config.activeReviewDigest!.slice(7)+'.json',{headers})).status).toBe(200);
}finally{await f.close();}});
it.each(['revoked-token','expired-token','revoked-resource','wrong-scope','tampered-bytes','empty-config','duplicate-token'])(`live config recheck refuses %s`,async kind=>{const f=await fixture();try{
 if(kind==='revoked-token')f.config.credentials[0].revoked=true;if(kind==='expired-token')f.clock(end);if(kind==='revoked-resource')f.config.resources[0].revoked=true;
 if(kind==='wrong-scope')f.config.credentials[0].artifacts=['sha256:'+'a'.repeat(64)];if(kind==='tampered-bytes')writeFileSync(f.file,'altered');if(kind==='empty-config')f.config.credentials=[];if(kind==='duplicate-token')f.config.credentials.push(f.config.credentials[0]);f.save();
 expect((await f.request(f.path,{headers:f.auth})).status).toBeGreaterThanOrEqual(400);
}finally{await f.close();}});
it.each(['/industrial-data/private.json','/access.json','/v1/artifacts/latest','/industrial-data/index.json?token=secret','/src/private.ts'])('does not expose %s',async path=>{const f=await fixture();try{expect((await f.request(path,{headers:f.auth})).status).toBeGreaterThanOrEqual(400);}finally{await f.close();}});
it('foreign origin and malformed/ambiguous credentials fail',async()=>{const f=await fixture();try{
 for(const headers of [{...f.auth,Origin:'https://hostile.invalid'},{Authorization:'Bearer invalid'},{...f.auth,Cookie:'esm_session=esm_'+randomBytes(32).toString('base64url')}])expect((await f.request(f.path,{headers})).status).toBeGreaterThanOrEqual(400);
 expect((await f.request(f.path,{method:'POST',headers:f.auth})).status).toBe(405);
}finally{await f.close();}});
it('a review cannot acquire released status by choosing the release route',async()=>{const f=await fixture();try{f.config.resources[0].kind='RELEASE';f.save();expect((await f.request(f.path,{headers:f.auth})).status).toBe(503);}finally{await f.close();}});

it('exposes minimal loopback liveness/readiness and drains before shutdown',async()=>{const f=await fixture();try{
 const health=await f.request('/healthz');expect(health.status).toBe(200);expect(await health.json()).toEqual({schema:'payload.industrial-health.v1',status:'ALIVE'});
 const ready=await f.request('/readyz');expect(ready.status).toBe(200);expect(await ready.json()).toMatchObject({schema:'payload.industrial-readiness-probe.v1',status:'READY',reasonCodes:[]});
 f.app.beginDrain();const draining=await f.request('/readyz');expect(draining.status).toBe(503);expect(await draining.json()).toMatchObject({status:'NOT_READY',reasonCodes:['DRAINING']});
 const after=await f.request('/healthz');expect(await after.json()).toMatchObject({status:'DRAINING'});
}finally{await f.close();}});
