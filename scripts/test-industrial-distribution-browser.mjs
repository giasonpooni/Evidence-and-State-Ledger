/** Tests the actual authenticated server against the existing GSV industrial build. */
import {mkdtempSync,readFileSync,writeFileSync,rmSync,mkdirSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';import {tmpdir} from 'node:os';import {randomBytes} from 'node:crypto';import {once} from 'node:events';import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {createDistributionServer,credentialForToken} from '../.stamp/industrial-distribution.mjs';
const [siteArg,viewArg,outputArg]=process.argv.slice(2);if(!siteArg||!viewArg||!outputArg)throw new Error('EXPECTED_SITE_VIEW_OUTPUT');
const site=resolve(siteArg),view=resolve(viewArg),output=resolve(outputArg);mkdirSync(output,{recursive:true});
const index=JSON.parse(readFileSync(join(view,'index.json'),'utf8')),root=mkdtempSync(join(tmpdir(),'esm-auth-browser-'));
const token='esm_'+randomBytes(32).toString('base64url'),at=new Date().toISOString(),end=new Date(Date.now()+600000).toISOString();
const config={schema:'payload.industrial-distribution.v1',credentials:[credentialForToken(token,'operator:qualification',index.sha256,at,end)],authorityKeys:[],resources:[{digest:index.sha256,kind:'REVIEW',file:join(view,index.file),requestFile:null,revoked:false}],activeReviewDigest:index.sha256};
const configFile=join(root,'access.json');const save=()=>writeFileSync(configFile,JSON.stringify(config));save();
const service=createDistributionServer({configFile,staticRoot:site,objectRoot:join(root,'objects'),auditRoot:root});service.listen();await once(service.server,'listening');
const base=`http://127.0.0.1:${service.server.address().port}`;
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--enable-unsafe-swiftshader','--use-angle=swiftshader']});
const scenarios=[],errors=[],outbound=[];let inspection;
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.route('**/*',async r=>{const u=new URL(r.request().url());if(u.origin===base)await r.continue();else{outbound.push(u.origin);await r.abort();}});
 assert.equal((await page.request.get(base+'/industrial-data/index.json')).status(),401);scenarios.push('unauthenticated data denied');
 await page.goto(base+'/login');await page.getByLabel('Access token').fill(token);await page.getByRole('button',{name:'Open review'}).click();
 await page.waitForFunction(()=>window.industrialReview!==undefined,undefined,{timeout:30000});inspection=await page.evaluate(()=>window.industrialReview.inspect());
 assert.equal(inspection.canonicalAdmission,false);assert.equal(inspection.release,null);assert(inspection.readings>0);assert.equal(inspection.gridCells,16641);
 const cookies=await page.context().cookies();assert(cookies.some(c=>c.name==='esm_session'&&c.httpOnly&&c.sameSite==='Strict'));assert.equal(await page.evaluate(()=>localStorage.length),0);
 scenarios.push('HttpOnly authenticated session renders real GSV review through same-origin credentials');
 const data=await page.request.get(base+'/industrial-data/'+index.file);assert.equal(data.status(),200);assert.equal(data.headers()['cache-control'],'no-store');assert.equal(data.headers()['x-artifact-digest'],index.sha256);
 const deliveries=readdirSync(join(root,'deliveries'));assert(deliveries.length>=3);for(const name of deliveries){const log=readFileSync(join(root,'deliveries',name),'utf8');assert(!log.includes(token));assert.equal(JSON.parse(log).artifactDigest,index.sha256);}
 scenarios.push('digest-bound data delivered with no-store and successful-access audit');
 await page.screenshot({path:join(output,'authenticated-desktop.png')});await page.setViewportSize({width:390,height:900});await page.waitForTimeout(150);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:join(output,'authenticated-mobile.png')});scenarios.push('mobile provenance and geometry view retained');
 config.credentials[0].revoked=true;save();assert.equal((await page.request.get(base+'/industrial-data/index.json')).status(),401);scenarios.push('revocation takes effect on next request without process restart');
 assert.deepEqual(errors,[]);assert.deepEqual(outbound,[]);
 writeFileSync(join(output,'browser-results.json'),JSON.stringify({scenarios,inspection,errors,outbound,expectedUnauthenticatedStatus:401,expectedRevokedStatus:401},null,2));
}catch(error){writeFileSync(join(output,'browser-results.json'),JSON.stringify({scenarios,errors,outbound,failure:String(error)},null,2));throw error;}
finally{await browser.close();service.server.closeAllConnections();await new Promise(r=>service.server.close(r));rmSync(root,{recursive:true,force:true});}
