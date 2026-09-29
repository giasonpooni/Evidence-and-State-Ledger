import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { credentialForToken } from './distribution';
import { assessIndustrialReadiness } from './readiness';
import * as refreshState from './refresh-state';
import * as refreshResult from './refresh-result';

const roots:string[]=[];
afterEach(()=>{vi.restoreAllMocks();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
const at='2026-09-29T12:05:00.000Z';
const digest='sha256:'+'a'.repeat(64);
const schedule={schema:'payload.capture-schedule.v1',scheduleId:'ready-fixture',sourceId:'industrial-noaa-usgs',
  minimumIntervalHours:1,notBefore:'2026-09-29T12:00:00.000Z',notAfter:'2026-09-29T16:00:00.000Z',maxRuns:3,enabled:true};
function fixture(){
  const root=mkdtempSync(join(tmpdir(),'esm-readiness-'));roots.push(root);
  const refresh=join(root,'refresh'),intake=join(root,'intake'),objects=join(intake,'objects'),audit=join(root,'audit'),site=join(root,'site');
  for(const p of [refresh,intake,objects,audit,site])mkdirSync(p,{recursive:true});
  writeFileSync(join(site,'industrial.html'),'viewer');
  const selectionFile=join(root,'selection.json');
  writeFileSync(selectionFile,JSON.stringify({schema:'payload.retained-review-selection.v1',refreshRoot:refresh,intakeRoot:intake,schedule,
    attemptId:'11111111-1111-4111-8111-111111111111',compiledDigest:digest}),{mode:0o600});
  const token='esm_'+Buffer.alloc(32,7).toString('base64url');
  const distribution={schema:'payload.industrial-distribution.v1',credentials:[credentialForToken(token,'operator:test',digest,'2026-09-29T12:00:00.000Z','2026-09-29T13:00:00.000Z')],
    authorityKeys:[],resources:[{digest,kind:'RETAINED_REVIEW',file:join(root,'review.json'),requestFile:selectionFile,revoked:false}],activeReviewDigest:digest};
  const distributionFile=join(root,'distribution.json');writeFileSync(distributionFile,JSON.stringify(distribution),{mode:0o600});
  const operationsFile=join(root,'operations.json');writeFileSync(operationsFile,'{}',{mode:0o600});
  const policy={schema:'payload.industrial-readiness-policy.v1',maxObservationAgeMs:600000,requireRefreshEnabled:true,requireProtectedFiles:true,requireActiveCredential:true};
  const options={operationsConfigFile:operationsFile,distributionConfigFile:distributionFile,root:refresh,intakeRoot:intake,objectRoot:objects,auditRoot:audit,staticRoot:site,schedule,authorityKeys:[],policy,at};
  return {root,options,distribution,distributionFile,operationsFile,selectionFile};
}
function healthyMocks(age=300000){
  vi.spyOn(refreshState,'inspectRefresh').mockReturnValue({schema:'payload.industrial-refresh-status.v1',verificationScope:'JOURNAL_ONLY',executionAuthorized:false,
    sourceFreshness:'NOT_CHECKED',canonicalAdmission:false,release:null,at,scheduleId:'ready-fixture',status:'INSPECTED',reasonCode:null,historyDigest:'sha256:'+'b'.repeat(64),
    plan:{decision:'NOT_DUE',runsSpent:1,runsRemaining:2,nextEligibleAt:'2026-09-29T13:00:00.000Z'},attempts:[],lastCapture:null} as any);
  vi.spyOn(refreshResult,'inspectRefreshResult').mockReturnValue({schema:'payload.industrial-retained-result-inspection.v1',status:'REINSPECTED',
    verificationScope:'RETAINED_BYTES_AND_DIRECT_BINDINGS',assessedAt:at,scheduleId:'ready-fixture',attemptId:'11111111-1111-4111-8111-111111111111',
    historyDigest:'sha256:'+'b'.repeat(64),receiptDigest:'sha256:'+'c'.repeat(64),result:{captureDigest:'sha256:'+'d'.repeat(64),reviewDigest:'sha256:'+'e'.repeat(64),compiledDigest:digest,canonicalAdmission:false,release:null},
    checked:{acquisitionCount:5,sourceBytes:1,compiledBytes:1,sourceDigests:[]},clocks:{},observations:{},
    freshness:{state:age<=600000?'FRESH':'STALE',basis:'LATEST_NUMERIC_OBSERVATION',policy:'GSC_DISPLAY_THRESHOLD_NOT_PROVIDER_SLA',staleAfterMs:1080000,observationAgeMs:age,retrievalAgeMs:1,journalAgeMs:1,publicationAgeMs:null,terrainSurveyAgeMs:null},
    sourceAuthenticated:false,rasterDecodePerformed:false,compilerExecuted:false,measurementAccuracyVerified:false,executionAuthorized:false,sourceFetchPerformed:false,canonicalAdmission:false,release:null,digest:'sha256:'+'f'.repeat(64)} as any);
}
describe('industrial readiness gate',()=>{
  it('is READY only when the selected retained result and operating envelope are usable',()=>{const f=fixture();healthyMocks();const r=assessIndustrialReadiness(f.options);expect(r.status).toBe('READY');expect(r.reasonCodes).toEqual([]);expect(r.components?.distribution.activeReaders).toBe(1);expect(r.executionAuthorized).toBe(false);});
  it('uses the explicit readiness age budget rather than the viewer display label',()=>{const f=fixture();healthyMocks(600001);const r=assessIndustrialReadiness(f.options);expect(r.status).toBe('NOT_READY');expect(r.reasonCodes).toContain('MEASUREMENT_TOO_OLD');});
  it('refuses an all-null measurement state',()=>{const f=fixture();healthyMocks();(refreshResult.inspectRefreshResult as any).mockReturnValueOnce({...refreshResult.inspectRefreshResult({} as any),freshness:{observationAgeMs:null}});const r=assessIndustrialReadiness(f.options);expect(r.status).toBe('NOT_READY');expect(r.reasonCodes).toContain('NO_NUMERIC_OBSERVATION');});
  it('refuses group/world-readable protected configuration',()=>{const f=fixture();healthyMocks();if(process.platform!=='win32')chmodSync(f.operationsFile,0o644);const r=assessIndustrialReadiness(f.options);if(process.platform!=='win32')expect(r.reasonCodes).toContain('CONFIG_FILE_UNSAFE');});
  it('refuses a disabled collector when policy requires it',()=>{const f=fixture();healthyMocks();f.options.schedule={...schedule,enabled:false};const selected=JSON.parse(require('node:fs').readFileSync(f.selectionFile,'utf8'));selected.schedule=f.options.schedule;writeFileSync(f.selectionFile,JSON.stringify(selected),{mode:0o600});const r=assessIndustrialReadiness(f.options);expect(r.reasonCodes).toContain('REFRESH_DISABLED');});
  it('refuses when no currently valid reader covers the active digest',()=>{const f=fixture();healthyMocks();f.distribution.credentials[0].revoked=true;writeFileSync(f.distributionFile,JSON.stringify(f.distribution),{mode:0o600});const r=assessIndustrialReadiness(f.options);expect(r.reasonCodes).toContain('NO_ACTIVE_READER');});
  it('refuses an artifact-only review as industrially ready retained evidence',()=>{const f=fixture();healthyMocks();f.distribution.resources[0].kind='REVIEW';f.distribution.resources[0].requestFile=null;writeFileSync(f.distributionFile,JSON.stringify(f.distribution),{mode:0o600});const r=assessIndustrialReadiness(f.options);expect(r.reasonCodes).toContain('ACTIVE_REVIEW_NOT_RETAINED');});
});
