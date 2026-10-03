/** Synthetic wire-contract fixture only. Never invokes NOAA, USGS, GSC capture, admission or release. */
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,cpSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {byteDigest} from '../src/data-os/evidence-capture';
import {retainIndustrialCapture} from '../src/acquisition/industrial-review';
import {refreshOnce} from '../src/industrial-operations/refresh';
import {REFRESH_OPERATION} from '../src/industrial-operations/pipeline';
const START = '2026-09-29T12:00:00.000Z', RETRIEVED = '2026-09-29T12:00:00.400Z';
const CAPTURED = '2026-09-29T12:00:00.500Z', REVIEWED = '2026-09-29T12:00:01.000Z';
const COMPILED = '2026-09-29T12:00:01.500Z', FINISHED = '2026-09-29T12:00:02.000Z', AT = '2026-09-29T12:05:00.000Z';
type RawRow = {t:string;v:string;s:string;f:string;q:string};
const rows = ():RawRow[] => [{t:'2026-09-29 11:54',v:'0.1',s:'0.02',f:'0,0,0,0',q:'p'},
  {t:'2026-09-29 12:00',v:'0.2',s:'0.01',f:'0,0,0,0',q:'v'}];
const json = (path:string) => JSON.parse(readFileSync(path,'utf8'));
const save = (path:string,value:unknown) => writeFileSync(path,JSON.stringify(value));
async function fixture(rawRows:RawRow[]=rows()) {
  const root=mkdtempSync(join(tmpdir(),'esm-retained-result-fixture-'));
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
  if(result.receipt?.state!=='CAPTURED')throw new Error('FIXTURE_BUILD_FAILED');
  const attemptId=result.attemptId!,control=join(refreshRoot,schedule.scheduleId),attempt=join(control,'attempts',attemptId);
  const options={root:refreshRoot,intakeRoot,schedule,attemptId,at:AT};
  return {root,attempt,control,options,indexFile:join(attempt,'view','index.json'),receiptFile:join(attempt,'receipt.json'),
    reviewFile:join(attempt,'esm-review.json'),sourceFile:(name:string)=>join(attempt,'capture',name)};
}
const output=process.argv[2];if(!output)throw new Error('FIXTURE_OUTPUT_REQUIRED');
globalThis.fetch=async()=>{throw new Error('FIXTURE_NETWORK_FORBIDDEN');};
const f=await fixture(),work=resolve(output);mkdirSync(work,{recursive:true});
cpSync(join(f.attempt,'view'),join(work,'view'),{recursive:true});
save(join(work,'retained-selection.json'),{schema:'payload.retained-review-selection.v1',refreshRoot:f.options.root,
 intakeRoot:f.options.intakeRoot,schedule:f.options.schedule,attemptId:f.options.attemptId,compiledDigest:json(f.indexFile).sha256});
save(join(work,'fixture-mode.json'),{mode:'SYNTHETIC_CONTRACT_FIXTURE',sourceRequests:0,realCapture:false,
 canonicalAdmission:false,release:null,rasterDecoded:false});
console.log('Synthetic contract fixture built; no source request or real admission performed.');
