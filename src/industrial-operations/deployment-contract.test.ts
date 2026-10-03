import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read=(path:string)=>readFileSync(path,'utf8');
describe('industrial deployment contract',()=>{
  it('keeps review and acquisition services separated by write scope',()=>{
    const review=read('deploy/industrial-operations/industrial-review.service');
    const refresh=read('deploy/industrial-operations/industrial-refresh.service');
    expect(review).toContain('ExecStartPre=/usr/bin/node /opt/notation/esm/.stamp/industrial-operations.mjs doctor');
    expect(review).toContain('KillSignal=SIGTERM');
    expect(review).toContain('ReadWritePaths=/var/lib/notation/industrial-operations/audit');
    expect(review).toContain('/var/lib/notation/industrial-operations/refresh /var/lib/notation/industrial-operations/intake');
    expect(review).not.toMatch(/^ReadWritePaths=.*\/refresh/m);
    expect(refresh).toContain('Type=oneshot');
    expect(refresh).toContain('ReadWritePaths=/var/lib/notation/industrial-operations');
  });
  it('retains core systemd confinement in both services',()=>{
    for(const path of ['deploy/industrial-operations/industrial-review.service','deploy/industrial-operations/industrial-refresh.service']){
      const unit=read(path);
      for(const directive of ['NoNewPrivileges=true','PrivateTmp=true','PrivateDevices=true','ProtectSystem=strict',
        'ProtectHome=true','ProtectKernelTunables=true','ProtectKernelModules=true','ProtectControlGroups=true',
        'ProtectProc=invisible','RestrictSUIDSGID=true','CapabilityBoundingSet=','AmbientCapabilities=']){
        expect(unit, path+' missing '+directive).toContain(directive);
      }
    }
  });
  it('keeps the timer bounded by the application planner rather than making the service persistent',()=>{
    const timer=read('deploy/industrial-operations/industrial-refresh.timer');
    expect(timer).toContain('OnCalendar=hourly');expect(timer).toContain('Persistent=true');
    expect(timer).toContain('RandomizedDelaySec=5min');
  });
  it('keeps public CI synthetic and private live qualification guarded',()=>{
    const synthetic=read('.github/workflows/industrial-viewer-recheck.yml');
    const live=read('.github/workflows/industrial-operations.yml');
    expect(synthetic).toContain('Synthetic contract fixture; no external acquisition');
    expect(synthetic).toContain('qualify-industrial-viewer-fixture');
    expect(live).toContain('if: github.event.repository.private == true');
  });
});
