/** Tests the actual authenticated server against the existing GSV industrial build. */
import {mkdtempSync,readFileSync,writeFileSync,rmSync,mkdirSync,readdirSync,cpSync} from 'node:fs';
import {resolve,join} from 'node:path';import {tmpdir} from 'node:os';import {randomBytes} from 'node:crypto';import {once} from 'node:events';import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {createDistributionServer,credentialForToken} from '../.stamp/industrial-distribution.mjs';
const [siteArg,viewArg,outputArg,selectionArg,dataModeArg]=process.argv.slice(2);if(!siteArg||!viewArg||!outputArg)throw new Error('EXPECTED_SITE_VIEW_OUTPUT');
const site=resolve(siteArg),view=resolve(viewArg),output=resolve(outputArg);mkdirSync(output,{recursive:true});
const index=JSON.parse(readFileSync(join(view,'index.json'),'utf8')),root=mkdtempSync(join(tmpdir(),'esm-auth-browser-'));
const token='esm_'+randomBytes(32).toString('base64url'),at=new Date().toISOString(),end=new Date(Date.now()+600000).toISOString();
const config={schema:'payload.industrial-distribution.v1',credentials:[credentialForToken(token,'operator:qualification',index.sha256,at,end)],authorityKeys:[],resources:[{digest:index.sha256,kind:selectionArg?'RETAINED_REVIEW':'REVIEW',file:join(view,index.file),requestFile:selectionArg?resolve(selectionArg):null,revoked:false}],activeReviewDigest:index.sha256};
const configFile=join(root,'access.json');const save=()=>writeFileSync(configFile,JSON.stringify(config));save();
const service=createDistributionServer({configFile,staticRoot:site,objectRoot:join(root,'objects'),auditRoot:root});service.listen();await once(service.server,'listening');
const base=`http://127.0.0.1:${service.server.address().port}`;
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--enable-unsafe-swiftshader','--use-angle=swiftshader']});
const dataMode=dataModeArg==='--synthetic'?'SYNTHETIC_CONTRACT_FIXTURE':'RETAINED_SOURCE_CAPTURE';
const scenarios=[],errors=[],outbound=[],expectedHttpErrors=[];let inspection;
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()!=='error')return;const url=m.location().url;
  if(url===base+'/industrial-data/'+index.file&&/^Failed to load resource: the server responded with a status of (401|503) /.test(m.text()))expectedHttpErrors.push(m.text());else errors.push(m.text());});
 await page.route('**/*',async r=>{const u=new URL(r.request().url());if(u.origin===base)await r.continue();else{outbound.push(u.origin);await r.abort();}});
 assert.equal((await page.request.get(base+'/industrial-data/index.json')).status(),401);scenarios.push('unauthenticated data denied');
 await page.goto(base+'/login');await page.getByLabel('Access token').fill(token);await page.getByRole('button',{name:'Open review'}).click();
 await page.waitForFunction(()=>window.industrialReview!==undefined,undefined,{timeout:30000});inspection=await page.evaluate(()=>window.industrialReview.inspect());
 assert.equal(inspection.canonicalAdmission,false);assert.equal(inspection.release,null);assert(inspection.readings>0);assert.equal(inspection.gridCells,16641);
 const cookies=await page.context().cookies();assert(cookies.some(c=>c.name==='esm_session'&&c.httpOnly&&c.sameSite==='Strict'));assert.equal(await page.evaluate(()=>localStorage.length),0);
 if(dataMode==='SYNTHETIC_CONTRACT_FIXTURE'){assert.equal(inspection.readings,2);assert.equal(inspection.minimumM,10);assert.equal(inspection.maximumM,10);await page.locator('#authority').evaluate(el=>{el.textContent='SYNTHETIC CONTRACT FIXTURE · INTERNAL · UNADMITTED';});}
 scenarios.push('HttpOnly authenticated session renders supplied GSV review through same-origin credentials');
 // Exercise the public viewer's actual recheck control, not an alternate HTTP client.
 const slider=page.getByRole('slider',{name:'Observed water-level sample'});await slider.focus();await slider.press('Home');
 await page.getByRole('button',{name:'Wireframe',exact:true}).click();await page.waitForTimeout(200);
 const beforeView=await page.evaluate(()=>window.industrialReview.view());
 const beforeAccess=await page.evaluate(()=>window.industrialReview.access());
 await page.getByRole('button',{name:'Recheck retained capture',exact:true}).click();
 await page.waitForFunction(()=>window.industrialReview.access().state==='READY');
 const afterView=await page.evaluate(()=>window.industrialReview.view()),afterAccess=await page.evaluate(()=>window.industrialReview.access());
 assert.equal(afterView.sampleIndex,beforeView.sampleIndex);assert.equal(afterView.wireframe,beforeView.wireframe);
 for(let i=0;i<3;i++)assert(Math.abs(beforeView.position[i]-afterView.position[i])<1e-8);
 assert.equal(afterAccess.selectedDigest,beforeAccess.selectedDigest);
 assert((await page.locator('#freshness').textContent()).includes('latest numeric age'));
 await page.getByRole('button',{name:'Wireframe',exact:true}).click();await slider.press('End');
 scenarios.push('explicit UI recheck preserves exact digest, selected observation, camera and wireframe');
 const data=await page.request.get(base+'/industrial-data/'+index.file);assert.equal(data.status(),200);assert.equal(data.headers()['cache-control'],'no-store');assert.equal(data.headers()['x-artifact-digest'],index.sha256);
 const deliveries=readdirSync(join(root,'deliveries'));assert(deliveries.length>=3);for(const name of deliveries){const log=readFileSync(join(root,'deliveries',name),'utf8');assert(!log.includes(token));assert.equal(JSON.parse(log).artifactDigest,index.sha256);}
 scenarios.push('digest-bound data delivered with no-store and successful-access audit');
 if(selectionArg){
  assert.equal(data.headers()['x-evidence-verification'],'RETAINED_BYTES_AND_DIRECT_BINDINGS');
  assert(['FRESH','STALE','NO_NUMERIC_OBSERVATIONS'].includes(data.headers()['x-observation-freshness']));
  const reportFile=join(root,'inspections',data.headers()['x-inspection-digest'].slice(7)+'.json');
  const report=JSON.parse(readFileSync(reportFile,'utf8'));assert.equal(report.checked.acquisitionCount,5);
  assert.equal(report.canonicalAdmission,false);assert.equal(report.rasterDecodePerformed,false);
  writeFileSync(join(output,'served-result-inspection.json'),JSON.stringify(report,null,2));
  scenarios.push('every authorized retained-review read reopens source dependencies and retains a separate inspection');
  assert.equal(afterAccess.delivery.scope,'RETAINED_BYTES_AND_DIRECT_BINDINGS');
  assert(afterAccess.delivery.inspectionDigest.startsWith('sha256:'));
  await page.getByText('Verification scope and clocks',{exact:true}).click();
  assert((await page.locator('.verification-clocks').textContent()).includes('Latest numeric observation'));
  await page.getByText('Verification scope and clocks',{exact:true}).click();
  // Corrupt only a scratch copy of the selected capture. Original inputs are never modified.
  const selected=JSON.parse(readFileSync(resolve(selectionArg),'utf8'));
  const copyRefresh=join(root,'scratch-refresh'),copyIntake=join(root,'scratch-intake');
  cpSync(selected.refreshRoot,copyRefresh,{recursive:true});cpSync(selected.intakeRoot,copyIntake,{recursive:true});
  const copySelection=join(root,'scratch-selection.json');writeFileSync(copySelection,JSON.stringify({...selected,refreshRoot:copyRefresh,intakeRoot:copyIntake}));
  const sourceRelative=[selected.schedule.scheduleId,'attempts',selected.attemptId,'capture','terrain.tif'];
  const original=readFileSync(join(selected.refreshRoot,...sourceRelative));
  writeFileSync(join(copyRefresh,...sourceRelative),'CORRUPTED SCRATCH COPY');config.resources[0].requestFile=copySelection;save();
  const successCount=readdirSync(join(root,'deliveries')).length;
  assert.equal((await page.request.get(base+'/industrial-data/'+index.file)).status(),503);
  assert.equal(readdirSync(join(root,'deliveries')).length,successCount);
  // The UI must also suppress the old capture after denied dependency reinspection.
  await page.getByRole('button',{name:'Recheck retained capture',exact:true}).click();
  await page.waitForFunction(()=>window.industrialReview.access().state==='UNAVAILABLE');
  assert.equal(await page.locator('#review-data').isVisible(),false);
  assert.equal((await page.evaluate(()=>window.industrialReview.inspect())).gridCells,0);
  assert.equal(await page.evaluate(()=>window.industrialReview.sample(-122.45,37.82)),null);
  assert.equal(readdirSync(join(root,'deliveries')).length,successCount);
  await page.screenshot({path:join(output,'failed-dependency-ui.png')});
  assert(original.equals(readFileSync(join(selected.refreshRoot,...sourceRelative))));
  config.resources[0].requestFile=resolve(selectionArg);save();
  await page.getByRole('button',{name:'Recheck retained capture',exact:true}).click();
  await page.waitForFunction(()=>window.industrialReview.access().state==='READY');
  assert(await page.locator('#review-data').isVisible());
  assert.equal((await page.evaluate(()=>window.industrialReview.access())).selectedDigest,index.sha256);
  scenarios.push('dependency failure hides prior data and sampling; explicit retry restores the same capture only');
  scenarios.push('damaged source copy blocks intact compiled artifact with503 and no successful-delivery audit; original evidence unchanged');
 }

 await page.screenshot({path:join(output,'authenticated-desktop.png')});await page.setViewportSize({width:390,height:900});await page.waitForTimeout(150);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));const panelBox=await page.locator('.panel').boundingBox(),valueBox=await page.locator('#water-value').boundingBox();assert(panelBox&&valueBox&&valueBox.y>=panelBox.y&&valueBox.y+valueBox.height<=panelBox.y+panelBox.height);await page.screenshot({path:join(output,'authenticated-mobile.png')});scenarios.push('mobile provenance, visible measurement and geometry view retained');
 config.credentials[0].revoked=true;save();assert.equal((await page.request.get(base+'/industrial-data/index.json')).status(),401);
 await page.getByRole('button',{name:'Recheck retained capture',exact:true}).click();
 await page.waitForFunction(()=>window.industrialReview.access().state==='UNAVAILABLE');
 assert.equal(await page.locator('#review-data').isVisible(),false);
 assert.equal((await page.evaluate(()=>window.industrialReview.inspect())).readings,0);
 await page.screenshot({path:join(output,'revoked-mobile-ui.png')});
 scenarios.push('revocation denies the next request and hides prior viewer data on explicit recheck');
 assert.deepEqual(errors,[]);assert.deepEqual(outbound,[]);assert.equal(expectedHttpErrors.length,selectionArg?2:1);
 writeFileSync(join(output,'browser-results.json'),JSON.stringify({dataMode,scenarios,inspection,errors,outbound,expectedHttpErrors,expectedUnauthenticatedStatus:401,expectedRevokedStatus:401},null,2));
}catch(error){writeFileSync(join(output,'browser-results.json'),JSON.stringify({dataMode,scenarios,errors,outbound,expectedHttpErrors,failure:String(error)},null,2));throw error;}
finally{await browser.close();service.server.closeAllConnections();await new Promise(r=>service.server.close(r));rmSync(root,{recursive:true,force:true});}
