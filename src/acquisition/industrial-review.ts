/** Bounded internal review over the existing local evidence rail. No admission or release. */
import { readImmutableFile } from '../data-os/local-files';
import { parseReplayJson } from '../observation/json';
import type { SourceRegistration } from '../data-os/contracts';
import { byteDigest } from '../data-os/evidence-capture';
import { LocalEvidenceIntake } from '../data-os/local-intake';
import { localRecordDigest } from '../data-os/local-record';
import { evaluateSourceUse } from '../data-os/source-policy';

const FILES = ['station.json', 'water-level.json', 'terrain-service.json', 'terrain.tif'] as const;
const LIMIT = 8 * 1024 * 1024;
const PURPOSE = 'industrial-source-qualification';
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const SERVICE = '/arcgis/rest/services/3DEPElevation/ImageServer';
function validateUrl(url: URL, index: number): void {
  requireValue(!url.port && !url.username && !url.password && !url.hash, 'SOURCE_NOT_ALLOWLISTED');
  const expected = index === 0 ? '/mdapi/prod/webapi/stations/9414290.json' : index === 1 ? '/api/prod/datagetter' : index === 2 ? SERVICE : SERVICE + '/exportImage';
  requireValue(url.pathname === expected, 'SOURCE_SCOPE_MISMATCH');
  const params = [...url.searchParams.keys()];
  requireValue(new Set(params).size === params.length, 'DUPLICATE_QUERY_PARAMETER');
  if(index === 0) requireValue(params.length === 0,'SOURCE_SCOPE_MISMATCH');
  if(index === 1) {
    const spec = {date:'recent',station:'9414290',product:'water_level',datum:'NAVD',time_zone:'gmt',units:'metric',application:'NotationSystemsQualification',format:'json'};
    requireValue(params.length === Object.keys(spec).length && Object.entries(spec).every(([k,v])=>url.searchParams.get(k)===v),'SOURCE_SCOPE_MISMATCH');
  }
  if(index === 2) requireValue(params.length===1 && url.searchParams.get('f')==='pjson','SOURCE_SCOPE_MISMATCH');
  if(index === 3) {
    const spec = {bbox:'-122.55,37.72,-122.35,37.92',bboxSR:'4269',imageSR:'4269',size:'129,129',format:'tiff',pixelType:'F32',noData:'-999999',interpolation:'RSP_NearestNeighbor',adjustAspectRatio:'false',f:'image'};
    requireValue(params.length===Object.keys(spec).length+1 && Object.entries(spec).every(([k,v])=>url.searchParams.get(k)===v),'SOURCE_SCOPE_MISMATCH');
    const rendering=JSON.parse(url.searchParams.get('renderingRule')??'null');
    requireValue(rendering && Object.keys(rendering).length===1 && rendering.rasterFunction==='None','SOURCE_SCOPE_MISMATCH');
  }
}

function requireValue(ok: unknown, code: string): asserts ok { if (!ok) throw new Error(code); }
function readBounded(root: string, name: string): Buffer {
  const bytes = readImmutableFile(root, [name], LIMIT);
  requireValue(bytes && bytes.length > 0, 'INVALID_CAPTURE_FILE');
  return bytes;
}
export function industrialReviewPolicy(sourceId: 'noaa-coops'|'usgs-3dep'|'gsc-usgs-grid'): SourceRegistration {
  return {
    registrationId: `${sourceId}:industrial-review:20260929`, sourceId,
    displayName: `${sourceId} — internal industrial source review`,
    sourceClass: sourceId === 'gsc-usgs-grid' ? 'derived-elevation-grid' : 'public-government-environmental-source',
    licenseId: 'operator-internal-qualification:public-government-material', policyVersion: '2026-09-29.v1',
    effectiveFrom: '2026-09-29T00:00:00.000Z', permittedPurposes: [PURPOSE],
    allowedOperations: ['INGEST','DERIVE','RETRIEVE'], allowedAudiences: ['INTERNAL'], retention: {mode:'INDEFINITE'},
  };
}
export interface IndustrialReviewBinding {
  file: string; sourceId: string; contentDigest: string; byteLength: number;
  acquisitionId: string; acquisitionDigest: string; retrievedAt: string;
}
export interface IndustrialReview {
  schema: 'payload.industrial-source-review.v1'; audience: 'INTERNAL';
  captureManifestDigest: string; bindings: IndustrialReviewBinding[];
  inspectedAt: string; integrity: 'RECOMPUTED_LOCAL'; policyAuthority: 'OPERATOR_DECLARATION';
  canonicalAdmission: false; release: null; customerDistributionPermitted: false;
  sourceTruthClaimed: false; independentVerification: false; digest: string;
}
/** Reopen the same bounded source selection without intake, writes, or network. */
export function readIndustrialCapture(captureRoot: string, inspectedAt: string) {
  requireValue(Number.isFinite(Date.parse(inspectedAt)), 'INVALID_REVIEW_TIME');
  const manifestBytes = readBounded(captureRoot, 'capture.json');
  parseReplayJson(manifestBytes, LIMIT);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  requireValue(manifest.schema === 'gsc.industrial-capture.v1' && manifest.status === 'CAPTURED_UNADMITTED' &&
    manifest.canonicalAdmission === false && manifest.release === null && manifest.stationId === '9414290', 'INVALID_CAPTURE_MANIFEST');
  requireValue(Array.isArray(manifest.artifacts) && manifest.artifacts.length === FILES.length, 'INVALID_CAPTURE_SELECTION');
  const pending: { file:string; sourceId:'noaa-coops'|'usgs-3dep'|'gsc-usgs-grid'; bytes:Buffer; retrievedAt:string }[] = [];
  for (let i=0;i<FILES.length;i++) {
    const artifact = manifest.artifacts[i], file = FILES[i], sourceId = i < 2 ? 'noaa-coops' : 'usgs-3dep';
    requireValue(artifact.file === file && artifact.sourceId === sourceId && DIGEST.test(artifact.sha256), 'CAPTURE_BINDING_MISMATCH');
    const url = new URL(artifact.url);
    requireValue(url.protocol === 'https:' && !url.username && !url.password && !url.hash &&
      (i<2 ? url.hostname === 'api.tidesandcurrents.noaa.gov' : url.hostname === 'elevation.nationalmap.gov'), 'SOURCE_NOT_ALLOWLISTED');
    validateUrl(url,i);
    requireValue(artifact.acquisitionKind === 'LIVE_CAPTURE' && Number.isFinite(Date.parse(artifact.requestedAt)) &&
      Date.parse(artifact.requestedAt) <= Date.parse(artifact.retrievedAt) && Date.parse(artifact.retrievedAt) <= Date.parse(inspectedAt), 'INVALID_CAPTURE_TIME');
    const bytes = readBounded(captureRoot, file);
    requireValue(byteDigest(bytes) === artifact.sha256 && bytes.length === artifact.bytes, 'SOURCE_BYTES_MISMATCH');
    pending.push({file,sourceId,bytes,retrievedAt:artifact.retrievedAt});
  }
  const derived = manifest.derived, gridBytes = readBounded(captureRoot,'terrain-grid.json');
  requireValue(derived.file === 'terrain-grid.json' && byteDigest(gridBytes) === derived.sha256 && gridBytes.length === derived.bytes &&
    derived.sourceArtifact === manifest.artifacts[3].sha256, 'DERIVED_BINDING_MISMATCH');
  parseReplayJson(gridBytes, LIMIT);
  const grid = JSON.parse(gridBytes.toString('utf8'));
  requireValue(grid.schema === 'gsc.terrain-grid.v1' && grid.sourceArtifact === derived.sourceArtifact, 'DERIVED_LINEAGE_MISMATCH');
  requireValue(Number.isFinite(Date.parse(manifest.capturedAt)) && Date.parse(manifest.capturedAt)>=Math.max(...pending.map(p=>Date.parse(p.retrievedAt))) && Date.parse(manifest.capturedAt)<=Date.parse(inspectedAt),'INVALID_DERIVED_CAPTURE_TIME');
  pending.push({file:'terrain-grid.json',sourceId:'gsc-usgs-grid',bytes:gridBytes,retrievedAt:manifest.capturedAt});
  return { captureManifestDigest: byteDigest(manifestBytes), capturedAt: String(manifest.capturedAt), pending };
}
/** Explicit retention still uses the original intake and policy path. */
export function retainIndustrialCapture(captureRoot: string, intakeRoot: string, allowInternalQualification: boolean,
  inspectedAt = new Date().toISOString()): IndustrialReview {
  requireValue(allowInternalQualification === true, 'EXPLICIT_INTERNAL_QUALIFICATION_REQUIRED');
  const { captureManifestDigest, pending } = readIndustrialCapture(captureRoot, inspectedAt);
  const intake = new LocalEvidenceIntake(intakeRoot);
  // Preflight source permissions for the whole batch before the first retained write.
  for (const p of pending) for (const operation of ['INGEST','DERIVE','RETRIEVE'] as const) {
    const policy = industrialReviewPolicy(p.sourceId);
    requireValue(evaluateSourceUse(policy,{requestId: p.file+':'+operation, registrationId:policy.registrationId,
      purpose:PURPOSE,operation,audience:'INTERNAL',requestedAt:inspectedAt}).state === 'ALLOWED','INTERNAL_POLICY_DENIED');
  }
  const bindings: IndustrialReviewBinding[] = [];
  for (const p of pending) {
    const acquisitionId = `industrial:${captureManifestDigest.slice(7)}:${p.file}`;
    intake.capture({schema:'payload.local-intake-request.v1',acquisitionId,evidenceId:`evidence:${acquisitionId}`,
      sourceRegistration:industrialReviewPolicy(p.sourceId),purpose:PURPOSE,mediaType:p.file.endsWith('.tif')?'image/tiff':'application/json',
      capturedAt:p.retrievedAt},p.bytes,inspectedAt);
    const retained = intake.inspect(acquisitionId);
    requireValue(retained && retained.request.contentDigest === byteDigest(p.bytes),'INTAKE_REINSPECTION_FAILED');
    bindings.push({file:p.file,sourceId:p.sourceId,contentDigest:retained.request.contentDigest,byteLength:retained.request.byteLength,
      acquisitionId,acquisitionDigest:retained.digest,retrievedAt:p.retrievedAt});
  }
  const body = {schema:'payload.industrial-source-review.v1' as const,audience:'INTERNAL' as const,captureManifestDigest,
    bindings,inspectedAt,integrity:'RECOMPUTED_LOCAL' as const,policyAuthority:'OPERATOR_DECLARATION' as const,
    canonicalAdmission:false as const,release:null,customerDistributionPermitted:false as const,
    sourceTruthClaimed:false as const,independentVerification:false as const};
  return {...body,digest:localRecordDigest(body)};
}
