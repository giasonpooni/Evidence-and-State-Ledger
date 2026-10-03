import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync, lstatSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { byteDigest } from '../data-os/evidence-capture';
import { retainIndustrialCapture } from '../acquisition/industrial-review';
import { LocalEvidenceIntake } from '../data-os/local-intake';
import { commitment } from './authority';
import { refreshOnce } from './refresh';
import { REFRESH_OPERATION } from './pipeline';
import { inspectRefresh } from './refresh-state';
import * as historyModule from './refresh-state';
import { inspectRefreshResult, reinspectRefreshResult, retainedReviewRequestSchema } from './refresh-result';
import { createDistributionServer, credentialForToken, type ServerConfig } from './distribution';

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); for (const r of roots.splice(0)) rmSync(r,{recursive:true,force:true}); });
const START = '2026-09-29T12:00:00.000Z', RETRIEVED = '2026-09-29T12:00:00.400Z';
const CAPTURED = '2026-09-29T12:00:00.500Z', REVIEWED = '2026-09-29T12:00:01.000Z';
const COMPILED = '2026-09-29T12:00:01.500Z', FINISHED = '2026-09-29T12:00:02.000Z', AT = '2026-09-29T12:05:00.000Z';
type RawRow = {t:string;v:string;s:string;f:string;q:string};
const rows = ():RawRow[] => [{t:'2026-09-29 11:54',v:'0.1',s:'0.02',f:'0,0,0,0',q:'p'},
  {t:'2026-09-29 12:00',v:'0.2',s:'0.01',f:'0,0,0,0',q:'v'}];
const json = (path:string) => JSON.parse(readFileSync(path,'utf8'));
const save = (path:string,value:unknown) => writeFileSync(path,JSON.stringify(value));
function fingerprints(root:string):Record<string,string> {
  const out:Record<string,string>={};
  const walk=(path:string,relative:string)=>{for(const name of readdirSync(path).sort()){
    const target=join(path,name),key=relative+'/'+name;if(lstatSync(target).isDirectory())walk(target,key);else out[key]=byteDigest(readFileSync(target));
  }};walk(root,'');return out;
}
/** Explicit synthetic contract bytes. The TIFF marker is NOT a real decoded elevation source.
 * The inspector must therefore never report rasterDecodePerformed or measurementAccuracyVerified.
 */
async function fixture(rawRows:RawRow[]=rows()) {
  const root=mkdtempSync(join(tmpdir(),'esm-retained-result-fixture-'));roots.push(root);
  const intakeRoot=join(root,'intake'),refreshRoot=join(root,'refresh');
  const schedule={schema:'payload.capture-schedule.v1',scheduleId:'result-fixture',sourceId:'industrial-noaa-usgs',
    minimumIntervalHours:1,notBefore:START,notAfter:'2026-09-29T16:00:00.000Z',maxRuns:3,enabled:true};
  let clock=START;
  const result=await refreshOnce({root:refreshRoot,schedule,operation:REFRESH_OPERATION,now:()=>clock,execute:async attempt=>{
    const cap=join(attempt,'capture');mkdirSync(cap,{recursive:true});mkdirSync(join(attempt,'view'));
    const files=['station.json','water-level.json','terrain-service.json','terrain.tif'];
    const urls=['https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/9414290.json',
      'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?date=recent&station=9414290&product=water_level&datum=NAVD&time_zone=gmt&units=metric&application=NotationSystemsQualification&format=json',
      'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer?f=pjson',
      'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage?bbox=-122.55,37.72,-122.35,37.92&bboxSR=4269&imageSR=4269&size=129,129&format=tiff&pixelType=F32&noData=-999999&renderingRule=%7B%22rasterFunction%22%3A%22None%22%7D&interpolation=RSP_NearestNeighbor&adjustAspectRatio=false&f=image'];
    const documents=[{stations:[{id:'9414290',name:'San Francisco',lat:37.8063,lng:-122.4659}]},
      {metadata:{id:'9414290'},data:rawRows},{pixelType:'F32',bandCount:1}];
    const artifacts=files.map((file,i)=>{const bytes=i===3?Buffer.from('SYNTHETIC TIFF CONTRACT MARKER — NOT A RASTER'):Buffer.from(JSON.stringify(documents[i]));writeFileSync(join(cap,file),bytes);
      return {file,sourceId:i<2?'noaa-coops':'usgs-3dep',url:urls[i],requestedAt:START,retrievedAt:RETRIEVED,
        sha256:byteDigest(bytes),bytes:bytes.length,sourcePublishedAt:null,acquisitionKind:'LIVE_CAPTURE'};});
    const grid={schema:'gsc.terrain-grid.v1',width:129,height:129,affine:[.2/129,0,-122.55,0,-.2/129,37.92],bounds:[-122.55,37.72,-122.35,37.92],
      horizontalCrs:'EPSG:4269',axisOrder:'longitude-latitude',verticalDatum:'NAVD88',units:'m',pixelInterpretation:'area-center',rowOrder:'north-to-south',resampling:'provider-nearest',
      surveyedAt:null,sourceArtifact:artifacts[3].sha256,heights:Array<number|null>(16641).fill(10),minimumM:10,maximumM:10,missingCells:0};
    const gridBytes=Buffer.from(JSON.stringify(grid));writeFileSync(join(cap,'terrain-grid.json'),gridBytes);
    save(join(cap,'capture.json'),{schema:'gsc.industrial-capture.v1',capturedAt:CAPTURED,stationId:'9414290',status:'CAPTURED_UNADMITTED',canonicalAdmission:false,release:null,
      artifacts,derived:{file:'terrain-grid.json',sha256:byteDigest(gridBytes),bytes:gridBytes.length,sourceArtifact:artifacts[3].sha256}});
    const review=retainIndustrialCapture(cap,intakeRoot,true,REVIEWED);save(join(attempt,'esm-review.json'),review);
    const samples=rawRows.map(r=>({time:r.t.replace(' ','T')+':00.000Z',valueM:r.v===''?null:Number(r.v),sigmaM:r.s===''?null:Number(r.s),
      quality:r.q==='p'?'preliminary':'verified',flags:r.f,firstFlagRole:r.q==='p'?'outlier_count':'inferred'}));
    const view={schema:'gsc.industrial-review.v1',audience:'INTERNAL',status:'UNADMITTED_SOURCE_REVIEW',canonicalAdmission:false,release:null,
      compiledAt:COMPILED,captureManifestDigest:review.captureManifestDigest,esmReviewDigest:review.digest,operation:'gsc.industrial-source-review.compile.v1',
      executionId:'execution:synthetic-fixture',verification:'LOCAL_HASH_BINDINGS_ONLY',
      sources:review.bindings.map(b=>({file:b.file,sourceId:b.sourceId,digest:b.contentDigest,retrievedAt:b.retrievedAt,acquisitionDigest:b.acquisitionDigest})),
      station:{id:'9414290',name:'San Francisco',latitude:37.8063,longitude:-122.4659,horizontalDatum:'not-declared-by-response',markerAltitudeM:null},
      water:{unit:'m',verticalDatum:'NAVD88',sourcePublishedAt:null,retrievedAt:RETRIEVED,samples,expectedCadenceMs:360000,staleAfterMs:1080000,
        sigmaMeaning:'standard-deviation-of-1-second-samples',latestObservedAt:samples.at(-1)?.time??null},
      terrain:{width:grid.width,height:grid.height,affine:grid.affine,bounds:grid.bounds,horizontalCrs:grid.horizontalCrs,verticalDatum:grid.verticalDatum,
        unit:grid.units,heights:grid.heights,pixelInterpretation:grid.pixelInterpretation,resampling:grid.resampling,surveyedAt:null,retrievedAt:RETRIEVED,
        rawArtifactDigest:artifacts[3].sha256,gridDigest:byteDigest(gridBytes),minimumM:10,maximumM:10,missingCells:0},
      nonclaims:{sourceAuthenticated:false,independentVerification:false,datumTransformation:false,floodModel:false,navigation:false,releaseAuthorization:false}};
    const bytes=Buffer.from(JSON.stringify(view)),digest=byteDigest(bytes),file=`review-${digest.slice(7)}.json`;
    writeFileSync(join(attempt,'view',file),bytes);save(join(attempt,'view','index.json'),{schema:'gsc.industrial-review-index.v1',audience:'INTERNAL',file,sha256:digest,bytes:bytes.length,canonicalAdmission:false,release:null});
    clock=FINISHED;return {captureDigest:review.captureManifestDigest,reviewDigest:review.digest,compiledDigest:digest,canonicalAdmission:false,release:null};
  }});
  expect(result.receipt?.state).toBe('CAPTURED');
  const attemptId=result.attemptId!,control=join(refreshRoot,schedule.scheduleId),attempt=join(control,'attempts',attemptId);
  const options={root:refreshRoot,intakeRoot,schedule,attemptId,at:AT};
  return {root,attempt,control,options,indexFile:join(attempt,'view','index.json'),receiptFile:join(attempt,'receipt.json'),
    reviewFile:join(attempt,'esm-review.json'),sourceFile:(name:string)=>join(attempt,'capture',name)};
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
/** Test adversary rebinds the compiled digest and journal: only direct source checks can catch the inconsistency. */
function editCompiled(f:Fixture,mutate:(d:Record<string,unknown>)=>void) {
  const index=json(f.indexFile),v=json(join(f.attempt,'view',index.file));mutate(v);
  const bytes=Buffer.from(JSON.stringify(v)),digest=byteDigest(bytes);index.sha256=digest;index.file=`review-${digest.slice(7)}.json`;index.bytes=bytes.length;
  writeFileSync(join(f.attempt,'view',index.file),bytes);save(f.indexFile,index);
  const receipt=json(f.receiptFile);receipt.result.compiledDigest=digest;const {digest:old,...body}=receipt;void old;receipt.digest=commitment(body);save(f.receiptFile,receipt);
}
const obj=(x:unknown)=>x as Record<string,unknown>;
function unavailable(f:Fixture,code?:string) {const r=inspectRefreshResult(f.options);expect(r.status).toBe('UNAVAILABLE');if(code)expect(r).toHaveProperty('reasonCode',code);expect(r.result).toBe(null);expect(r.freshness).toBe(null);expect(JSON.stringify(r)).not.toContain(f.root);return r;}

describe('exact retained result inspection',()=>{
  it('reopens the original intake and reports three distinct ages, with no fetch or writes',async()=>{
    const f=await fixture(),before=fingerprints(f.root),fetchSpy=vi.fn(()=>{throw Error('NETWORK_FORBIDDEN');});vi.stubGlobal('fetch',fetchSpy);
    const r=reinspectRefreshResult(f.options).report;
    expect(r.checked.acquisitionCount).toBe(5);expect(r.freshness).toMatchObject({state:'FRESH',observationAgeMs:300000,retrievalAgeMs:299600,journalAgeMs:298000,publicationAgeMs:null,terrainSurveyAgeMs:null});
    expect(r).toMatchObject({canonicalAdmission:false,release:null,sourceFetchPerformed:false,rasterDecodePerformed:false,compilerExecuted:false,measurementAccuracyVerified:false});
    expect(fingerprints(f.root)).toEqual(before);expect(fetchSpy).not.toHaveBeenCalled();
    const {digest,...body}=r;expect(commitment(body)).toBe(digest);expect(reinspectRefreshResult(f.options).report).toEqual(r);
  });
  it('preserves a healthy journal but refuses corrupted source bytes',async()=>{
    const f=await fixture(),viewHash=byteDigest(readFileSync(join(f.attempt,'view',json(f.indexFile).file)));
    writeFileSync(f.sourceFile('water-level.json'),'PRIVATE_CORRUPTION');
    expect(inspectRefresh({...f.options,operation:REFRESH_OPERATION}).status).toBe('INSPECTED');unavailable(f,'SOURCE_BYTES_MISMATCH');
    expect(byteDigest(readFileSync(join(f.attempt,'view',json(f.indexFile).file)))).toBe(viewHash);
  });
  for(const name of ['station.json','water-level.json','terrain-service.json','terrain.tif','terrain-grid.json','capture.json'])it(`refuses missing ${name} without repairing it`,async()=>{
    const f=await fixture();rmSync(f.sourceFile(name));const before=fingerprints(f.root);unavailable(f);expect(fingerprints(f.root)).toEqual(before);
  });
  it('reopens content-addressed intake bytes, not only captured directory copies',async()=>{
    const f=await fixture(),b=json(f.reviewFile).bindings[1];const files=fingerprints(join(f.root,'intake','objects'));const name=Object.keys(files).find(p=>files[p]===b.contentDigest)!;
    writeFileSync(join(f.root,'intake','objects',name),'DAMAGED');unavailable(f);
  });
  it('refuses missing original acquisition receipts',async()=>{const f=await fixture();const id=json(f.reviewFile).bindings[0].acquisitionId;rmSync(join(f.root,'intake','acquisitions',byteDigest(Buffer.from(id)).slice(7)+'.json'));unavailable(f,'ACQUISITION_BINDING_MISMATCH');});
  it('rejects symbolic source directories',async()=>{const f=await fixture();const cap=join(f.attempt,'capture');const target=join(f.root,'elsewhere');mkdirSync(target);rmSync(cap,{recursive:true});symlinkSync(target,cap);unavailable(f);});
  it('refuses a wrong exact attempt rather than selecting a last good one',async()=>{const f=await fixture();f.options.attemptId='00000000-0000-0000-0000-000000000000';unavailable(f,'ATTEMPT_NOT_FOUND');});
  it('does not reinterpret an incomplete attempt as a successful capture',async()=>{const f=await fixture();rmSync(f.receiptFile);unavailable(f,'ATTEMPT_NOT_CAPTURED');});
  it('refuses while a worker lock exists',async()=>{const f=await fixture();mkdirSync(join(f.control,'lock'));unavailable(f,'REFRESH_LOCKED');expect(lstatSync(join(f.control,'lock')).isDirectory()).toBe(true);});
  it('refuses a journal that changes during source reinspection',async()=>{
    const f=await fixture(),original=historyModule.readRefreshHistory;let reads=0;
    vi.spyOn(historyModule,'readRefreshHistory').mockImplementation(o=>{const r=original(o);return ++reads===2?{...r,historyDigest:'sha256:'+'0'.repeat(64)}:r;});
    unavailable(f,'HISTORY_CHANGED_DURING_READ');
  });
  it('detects a lock introduced while acquisitions are being reopened',async()=>{
    const f=await fixture(),original=LocalEvidenceIntake.prototype.inspect;let once=false;
    vi.spyOn(LocalEvidenceIntake.prototype,'inspect').mockImplementation(function(this:LocalEvidenceIntake,id){if(!once){mkdirSync(join(f.control,'lock'));once=true;}return original.call(this,id);});
    unavailable(f,'REFRESH_LOCKED');
  });
  for(const [name,mutate] of [
    ['changed scalar',(d:Record<string,unknown>)=>{const samples=obj(d.water).samples as Record<string,unknown>[];samples[1].valueM=4;}],
    ['changed sigma',(d:Record<string,unknown>)=>{const samples=obj(d.water).samples as Record<string,unknown>[];samples[1].sigmaM=4;}],
    ['changed quality',(d:Record<string,unknown>)=>{const samples=obj(d.water).samples as Record<string,unknown>[];samples[0].quality='verified';}],
    ['changed observation time',(d:Record<string,unknown>)=>{const samples=obj(d.water).samples as Record<string,unknown>[];samples[1].time='2026-09-29T11:59:00.000Z';}],
    ['changed terrain cell',(d:Record<string,unknown>)=>{const cells=obj(d.terrain).heights as number[];cells[10]=12;}],
    ['changed affine',(d:Record<string,unknown>)=>{const affine=obj(d.terrain).affine as number[];affine[0]=1;}],
    ['changed station',(d:Record<string,unknown>)=>{obj(d.station).latitude=0;}],
    ['invented publication',(d:Record<string,unknown>)=>{obj(d.water).sourcePublishedAt=RETRIEVED;}],
    ['invented survey',(d:Record<string,unknown>)=>{obj(d.terrain).surveyedAt=RETRIEVED;}],
    ['future compilation',(d:Record<string,unknown>)=>{d.compiledAt='2026-09-30T12:00:00.000Z';}],
    ['missing source',(d:Record<string,unknown>)=>{(d.sources as unknown[]).pop();}],
    ['fake admission',(d:Record<string,unknown>)=>{d.canonicalAdmission=true;}],
    ['extra raw payload',(d:Record<string,unknown>)=>{d.private='DO_NOT_ECHO';}],
  ] as const)it(`catches ${name} even with recomputed artifact and receipt digests`,async()=>{const f=await fixture();editCompiled(f,mutate);const r=unavailable(f);expect(JSON.stringify(r)).not.toContain('DO_NOT_ECHO');});
  it('never calls a fresh retrieval a fresh numeric observation when the last rows are null',async()=>{
    const f=await fixture([{t:'2026-09-29 11:00',v:'0.3',s:'0.02',f:'0,0,0,0',q:'p'}, {t:'2026-09-29 12:00',v:'',s:'',f:'0,0,0,0',q:'p'}]);
    const r=reinspectRefreshResult(f.options).report;expect(r.freshness.state).toBe('STALE');expect(r.observations.latestRowAt).toBe(START);expect(r.observations.latestNumericAt).toBe('2026-09-29T11:00:00.000Z');expect(r.observations.missingValueCount).toBe(1);
  });
  for(const values of [[],[{t:'2026-09-29 12:00',v:'',s:'',f:'0,0,0,0',q:'p'}]])it(`returns unknown numeric age with ${values.length} empty or null rows`,async()=>{
    const r=reinspectRefreshResult((await fixture(values)).options).report;expect(r.freshness.state).toBe('NO_NUMERIC_OBSERVATIONS');expect(r.freshness.observationAgeMs).toBe(null);expect(r.observations.numericCount).toBe(0);
  });
  it('keeps zero as a numeric measurement',async()=>{const r=reinspectRefreshResult((await fixture([{...rows()[1],v:'0'}])).options).report;expect(r.observations.numericCount).toBe(1);expect(r.freshness.state).toBe('FRESH');});
  it('separates stale from corrupt, with an exact display-threshold boundary',async()=>{const f=await fixture();f.options.at='2026-09-29T12:18:00.000Z';expect(reinspectRefreshResult(f.options).report.freshness.state).toBe('FRESH');f.options.at='2026-09-29T12:18:00.001Z';expect(reinspectRefreshResult(f.options).report.freshness.state).toBe('STALE');});
  it('does not trust future observation times',async()=>{const f=await fixture([{...rows()[1],t:'2026-09-29 12:06'}]);unavailable(f,'OBSERVATION_CLOCK_MISMATCH');});
  it('detects duplicate manifest keys before trusting the last parsed value',async()=>{const f=await fixture();const path=f.sourceFile('capture.json'),text=readFileSync(path,'utf8');writeFileSync(path,text.replace('{','{"stationId":"other",'));unavailable(f);});
  it('requires a configured exact result selection without source or URL injection fields',()=>{expect(()=>retainedReviewRequestSchema.parse({schema:'payload.retained-review-selection.v1',refreshRoot:'/a',intakeRoot:'/b',schedule:{},attemptId:'x',compiledDigest:'sha256:'+'0'.repeat(64),url:'https://example.invalid'})).toThrow();});
});

describe('authenticated retained-review delivery',()=>{
  it('reopens dependencies per request, retains the report, and does not downgrade on corruption',async()=>{
    const f=await fixture(),index=json(f.indexFile),token='esm_'+randomBytes(32).toString('base64url');
    const requestFile=join(f.root,'selection.json');save(requestFile,{schema:'payload.retained-review-selection.v1',refreshRoot:f.options.root,intakeRoot:f.options.intakeRoot,schedule:f.options.schedule,attemptId:f.options.attemptId,compiledDigest:index.sha256});
    const config:ServerConfig={schema:'payload.industrial-distribution.v1',credentials:[credentialForToken(token,'operator:test',index.sha256,START,'2026-09-29T16:00:00.000Z')],authorityKeys:[],resources:[{digest:index.sha256,kind:'RETAINED_REVIEW',file:join(f.attempt,'view',index.file),requestFile,revoked:false}],activeReviewDigest:index.sha256};
    const configFile=join(f.root,'config.json');save(configFile,config);
    const server=createDistributionServer({configFile,staticRoot:join(f.root,'static'),objectRoot:join(f.root,'objects'),auditRoot:join(f.root,'audit'),now:()=>AT});server.listen();await once(server.server,'listening');
    const address=server.server.address();if(!address||typeof address==='string')throw Error('NO_PORT');const base=`http://127.0.0.1:${address.port}`,headers={Authorization:'Bearer '+token};
    try {
      expect((await fetch(base+'/industrial-data/index.json')).status).toBe(401);
      const a=await fetch(base+'/industrial-data/index.json',{headers});expect(a.status).toBe(200);expect(a.headers.get('x-evidence-verification')).toBe('RETAINED_BYTES_AND_DIRECT_BINDINGS');expect(a.headers.get('x-observation-freshness')).toBe('FRESH');expect(a.headers.get('cache-control')).toBe('no-store');
      expect(await a.json()).toMatchObject({sha256:index.sha256,canonicalAdmission:false});
      const reports=readdirSync(join(f.root,'audit','inspections'));expect(reports).toHaveLength(1);const retained=json(join(f.root,'audit','inspections',reports[0]));expect(retained.digest).toBe(a.headers.get('x-inspection-digest'));
      const deliveries=readdirSync(join(f.root,'audit','deliveries')).length;
      writeFileSync(f.sourceFile('terrain.tif'),'DAMAGED_SOURCE');
      const b=await fetch(base+'/industrial-data/'+index.file,{headers});expect(b.status).toBe(503);expect(await b.text()).not.toContain(f.root);expect(readdirSync(join(f.root,'audit','deliveries'))).toHaveLength(deliveries);
      expect((await fetch(base+'/v1/artifacts/'+index.sha256.slice(7),{headers})).status).toBe(503);
      config.credentials[0].revoked=true;save(configFile,config);expect((await fetch(base+'/industrial-data/index.json',{headers})).status).toBe(401);
    } finally {server.server.closeAllConnections();await new Promise<void>(r=>server.server.close(()=>r()));}
  });
});
