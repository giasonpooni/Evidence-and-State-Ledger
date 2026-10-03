import {afterEach,describe,it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {buildIntegrityManifest,verifyIntegrityManifest} from './integrity-manifest';
const roots:string[]=[];afterEach(()=>roots.splice(0).forEach(x=>rmSync(x,{recursive:true,force:true})));
function fixture(){const base=mkdtempSync(join(tmpdir(),'integrity-'));roots.push(base);const paths={} as Record<'refresh'|'intake'|'audit'|'static',string>;
  for(const name of ['refresh','intake','audit','static'] as const){paths[name]=join(base,name);mkdirSync(paths[name]);writeFileSync(join(paths[name],name+'.txt'),name);}
  return {base,paths};}
describe('integrity manifest',()=>{
  it('uses logical roots and verifies an unchanged snapshot',()=>{const f=fixture(),m=buildIntegrityManifest(f.paths,'2026-09-29T12:00:00.000Z');expect(m.entries.every(e=>!e.path.includes(f.base))).toBe(true);expect(verifyIntegrityManifest(f.paths,m).status).toBe('MATCH');});
  it('detects changed, added and removed bytes',()=>{const f=fixture(),m=buildIntegrityManifest(f.paths,'2026-09-29T12:00:00.000Z');writeFileSync(join(f.paths.intake,'intake.txt'),'changed');expect(verifyIntegrityManifest(f.paths,m).status).toBe('MISMATCH');});
  it('refuses symbolic paths',()=>{const f=fixture();symlinkSync(join(f.paths.intake,'intake.txt'),join(f.paths.audit,'link'));expect(()=>buildIntegrityManifest(f.paths,'2026-09-29T12:00:00.000Z')).toThrow(/INTEGRITY_SYMLINK_REFUSED/);});
  it('refuses a live lock instead of snapshotting an unstable root',()=>{const f=fixture();mkdirSync(join(f.paths.refresh,'lock'));expect(()=>buildIntegrityManifest(f.paths,'2026-09-29T12:00:00.000Z')).toThrow(/INTEGRITY_ROOT_BUSY/);});
});
