import {describe,it,expect} from 'vitest';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,readdirSync,symlinkSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {byteDigest} from '../data-os/evidence-capture';
import {evaluateSourceUse} from '../data-os/source-policy';
import {industrialReviewPolicy,retainIndustrialCapture} from './industrial-review';
const at='2026-09-29T05:00:00.000Z';
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'industrial-review-')), capture=join(root,'capture');
 mkdirSync(capture);
 const names=['station.json','water-level.json','terrain-service.json','terrain.tif'];
 const artifacts=names.map((file,i)=>{const bytes=Buffer.from(i===3?'test-tiff-bytes':'{}');writeFileSync(join(capture,file),bytes);return {
 file,sourceId:i<2?'noaa-coops':'usgs-3dep',url:[
 'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/9414290.json',
 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?date=recent&station=9414290&product=water_level&datum=NAVD&time_zone=gmt&units=metric&application=NotationSystemsQualification&format=json',
 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer?f=pjson',
 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage?bbox=-122.55,37.72,-122.35,37.92&bboxSR=4269&imageSR=4269&size=129,129&format=tiff&pixelType=F32&noData=-999999&renderingRule=%7B%22rasterFunction%22%3A%22None%22%7D&interpolation=RSP_NearestNeighbor&adjustAspectRatio=false&f=image'
 ][i],
 requestedAt:at,retrievedAt:at,sha256:byteDigest(bytes),bytes:bytes.length,acquisitionKind:'LIVE_CAPTURE'};});
 const grid=Buffer.from(JSON.stringify({schema:'gsc.terrain-grid.v1',sourceArtifact:artifacts[3].sha256}));writeFileSync(join(capture,'terrain-grid.json'),grid);
 const manifest={schema:'gsc.industrial-capture.v1',status:'CAPTURED_UNADMITTED',canonicalAdmission:false,release:null as string|null,stationId:'9414290',capturedAt:at as string|null,
 artifacts,derived:{file:'terrain-grid.json',sha256:byteDigest(grid),bytes:grid.length,sourceArtifact:artifacts[3].sha256}};
 const save=()=>writeFileSync(join(capture,'capture.json'),JSON.stringify(manifest));save();
 return {root,capture,intake:join(root,'intake'),manifest,save,clean:()=>rmSync(root,{recursive:true,force:true})};
}
type TestManifest = ReturnType<typeof fixture>['manifest'];
describe('industrial capture review uses actual local evidence intake',()=>{
 it('retains five artifacts, reopens the actual store and is idempotent',()=>{const f=fixture();try{
  const a=retainIndustrialCapture(f.capture,f.intake,true,at), b=retainIndustrialCapture(f.capture,f.intake,true,at);
  expect(a).toEqual(b);expect(a.bindings).toHaveLength(5);expect(a.canonicalAdmission).toBe(false);expect(a.release).toBe(null);
  expect(a.integrity).toBe('RECOMPUTED_LOCAL');expect(readdirSync(join(f.intake,'acquisitions'))).toHaveLength(5);
 }finally{f.clean();}});
 for(const [name,mutate] of [
  ['unadmitted boundary',(m:TestManifest)=>m.canonicalAdmission=true],['release label',(m:TestManifest)=>m.release='fake-release'],
  ['station scope',(m:TestManifest)=>m.stationId='other'],['source identity',(m:TestManifest)=>m.artifacts[0].sourceId='person-data'],
  ['host scope',(m:TestManifest)=>m.artifacts[0].url='https://example.invalid/private'],['acquisition clock',(m:TestManifest)=>m.artifacts[0].retrievedAt='2026-09-30T00:00:00Z'],
  ['path traversal',(m:TestManifest)=>m.artifacts[0].file='../private'],['missing selection',(m:TestManifest)=>m.artifacts.pop()],
  ['digest mismatch',(m:TestManifest)=>m.artifacts[0].sha256='sha256:'+'0'.repeat(64)],['lineage mismatch',(m:TestManifest)=>m.derived.sourceArtifact='sha256:'+'0'.repeat(64)],
  ['hidden datum change',(m:TestManifest)=>m.artifacts[1].url=m.artifacts[1].url.replace('datum=NAVD','datum=MLLW')],
  ['duplicate query',(m:TestManifest)=>m.artifacts[1].url+='&datum=NAVD'],
  ['missing derived time',(m:TestManifest)=>m.capturedAt=null],
  ['terrain resampling',(m:TestManifest)=>m.artifacts[3].url=m.artifacts[3].url.replace('RSP_NearestNeighbor','RSP_BilinearInterpolation')],
 ] as const)it(`refuses ${name}`,()=>{const f=fixture();try{mutate(f.manifest);f.save();expect(()=>retainIndustrialCapture(f.capture,f.intake,true,at)).toThrow();}finally{f.clean();}});
 it('requires explicit qualification permission',()=>{const f=fixture();try{expect(()=>retainIndustrialCapture(f.capture,f.intake,false,at)).toThrow('EXPLICIT_INTERNAL_QUALIFICATION_REQUIRED');}finally{f.clean();}});
 it('does not repair corrupted retained bytes',()=>{const f=fixture();try{
  const report=retainIndustrialCapture(f.capture,f.intake,true,at);const acquired=join(f.intake,'acquisitions',byteDigest(Buffer.from(report.bindings[0].acquisitionId)).slice(7)+'.json');
  const payload=JSON.parse(readFileSync(acquired,'utf8'));payload.request.byteLength+=1;writeFileSync(acquired,JSON.stringify(payload));
  expect(()=>retainIndustrialCapture(f.capture,f.intake,true,at)).toThrow();
 }finally{f.clean();}});
 it('does not follow a captured-file symlink',()=>{const f=fixture();try{rmSync(join(f.capture,'station.json'));symlinkSync(join(f.capture,'water-level.json'),join(f.capture,'station.json'));expect(()=>retainIndustrialCapture(f.capture,f.intake,true,at)).toThrow();}finally{f.clean();}});
 it('source review does not permit public or customer export',()=>{for(const id of ['noaa-coops','usgs-3dep','gsc-usgs-grid'] as const){const policy=industrialReviewPolicy(id);for(const audience of ['PUBLIC','CUSTOMER'] as const)expect(evaluateSourceUse(policy,{requestId:'export',registrationId:policy.registrationId,purpose:'industrial-source-qualification',operation:'EXPORT',audience,requestedAt:at}).state).toBe('DENIED');}});
});
