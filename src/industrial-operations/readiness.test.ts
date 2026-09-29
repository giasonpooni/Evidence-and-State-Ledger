import {afterEach,describe,it,expect} from 'vitest';
import {chmodSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {assessCollectorReadiness,assessInstrumentReadiness} from './readiness';
import {protectedConfigFile} from './operations-config';
const roots:string[]=[];afterEach(()=>roots.splice(0).forEach(x=>rmSync(x,{recursive:true,force:true})));
function config(enabled:boolean){const base=mkdtempSync(join(tmpdir(),'readiness-'));roots.push(base);for(const p of ['refresh','intake','audit','static'])mkdirSync(join(base,p));
 writeFileSync(join(base,'static','industrial.html'),'viewer');const dist=join(base,'distribution.json');writeFileSync(dist,JSON.stringify({schema:'payload.industrial-distribution.v1',credentials:[{credentialId:'credential:test',recipientId:'operator:test',tokenDigest:'sha256:'+'1'.repeat(64),notBefore:'2026-09-29T11:00:00.000Z',notAfter:'2026-09-29T13:00:00.000Z',revoked:false,artifacts:['sha256:'+'2'.repeat(64)]}],authorityKeys:[],resources:[],activeReviewDigest:null}));
 if(process.platform!=='win32')chmodSync(dist,0o600);
 return {root:join(base,'refresh'),intakeRoot:join(base,'intake'),objectRoot:join(base,'intake'),auditRoot:join(base,'audit'),gscRoot:base,pythonExecutable:'/usr/bin/python3',
 schedule:{schema:'payload.capture-schedule.v1',scheduleId:'test',sourceId:'industrial-noaa-usgs',minimumIntervalHours:1,notBefore:'2026-09-29T11:00:00.000Z',notAfter:'2026-09-29T14:00:00.000Z',maxRuns:2,enabled},authorityKeys:[],distributionConfig:dist,staticRoot:join(base,'static'),port:8081,reviewReadiness:{maxObservationAgeMs:600000}};}
describe('instrument readiness',()=>{
 it('an enabled uninitialized collector is ready to make its first bounded attempt',()=>{expect(assessCollectorReadiness(config(true),'2026-09-29T12:00:00.000Z').status).toBe('READY');});
 it('a disabled collector is an explicit hold',()=>{const r=assessCollectorReadiness(config(false),'2026-09-29T12:00:00.000Z');expect(r.status).toBe('HOLD');expect(r.checks).toContainEqual(expect.objectContaining({detailCode:'SCHEDULE_DISABLED'}));});
 it('does not claim production release readiness from software checks',()=>{const r=assessInstrumentReadiness(config(true),'2026-09-29T12:00:00.000Z');expect(r.productionRelease).toBe('HOLD_EXTERNAL');expect(r.external.map(x=>x.id)).toContain('geodetic-qualification');expect(r.external.map(x=>x.id)).toContain('pinned-candidate-replay');});
 it('requires an explicit numeric observation age policy',()=>{const c=config(true);delete c.reviewReadiness;const r=assessInstrumentReadiness(c,'2026-09-29T12:00:00.000Z');expect(r.review.checks).toContainEqual(expect.objectContaining({detailCode:'FRESHNESS_POLICY_REQUIRED'}));});
 it('recognizes owner-only configuration and rejects wider POSIX modes',()=>{const c=config(true);expect(protectedConfigFile(c.distributionConfig)).toBe(true);if(process.platform!=='win32'){chmodSync(c.distributionConfig,0o644);expect(protectedConfigFile(c.distributionConfig)).toBe(false);}});
});
