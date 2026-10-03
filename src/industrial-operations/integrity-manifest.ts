/** Hash-only integrity manifests for backup/restore verification; no evidence bytes are copied. */
import { createHash } from 'node:crypto';
import { closeSync, lstatSync, openSync, readSync, readdirSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import { z } from 'zod';
import { check, commitment, hash, instant } from './authority';

const rootId=z.enum(['refresh','intake','audit','static']);
const entrySchema=z.object({root:rootId,path:z.string().regex(/^[A-Za-z0-9._/-]{1,1024}$/),bytes:z.number().int().min(0),sha256:hash}).strict();
export const integrityManifestSchema=z.object({
  schema:z.literal('payload.industrial-integrity-manifest.v1'),createdAt:instant,
  entries:z.array(entrySchema).max(50000),totalFiles:z.number().int().min(0).max(50000),
  totalBytes:z.number().int().min(0).max(20_000_000_000),digest:hash,
}).strict();
export type IntegrityManifest=z.infer<typeof integrityManifestSchema>;
function fileDigest(path:string,size:number){
  const h=createHash('sha256'),fd=openSync(path,'r'),buf=Buffer.allocUnsafe(64*1024);let offset=0;
  try{while(offset<size){const n=readSync(fd,buf,0,Math.min(buf.length,size-offset),offset);check(n>0,'INTEGRITY_SHORT_READ');h.update(buf.subarray(0,n));offset+=n;}
    const after=lstatSync(path);check(after.isFile()&&!after.isSymbolicLink()&&after.size===size,'INTEGRITY_FILE_CHANGED');}
  finally{closeSync(fd);}return 'sha256:'+h.digest('hex');
}
export function buildIntegrityManifest(roots:Record<z.infer<typeof rootId>,string>,createdAt:string):IntegrityManifest{
  instant.parse(createdAt);const entries:z.infer<typeof entrySchema>[]=[];let totalBytes=0;
  for(const logical of rootId.options){
    const base=resolve(roots[logical]);const s=lstatSync(base);check(s.isDirectory()&&!s.isSymbolicLink(),'INTEGRITY_ROOT_UNSAFE');
    const walk=(dir:string)=>{for(const name of readdirSync(dir).sort()){check(!name.startsWith('.payload-'),'INTEGRITY_TEMPORARY_FILE');
      const path=join(dir,name),stat=lstatSync(path);check(!stat.isSymbolicLink(),'INTEGRITY_SYMLINK_REFUSED');
      if(stat.isDirectory()){check(name!=='lock'&&name!=='audit.lock','INTEGRITY_ROOT_BUSY');walk(path);}
      else {check(stat.isFile(),'INTEGRITY_NONFILE_REFUSED');const rel=relative(base,path).split(sep).join('/');entries.push({root:logical,path:rel,bytes:stat.size,sha256:fileDigest(path,stat.size)});totalBytes+=stat.size;
        check(entries.length<=50000&&totalBytes<=20_000_000_000,'INTEGRITY_MANIFEST_LIMIT');}}
    };walk(base);
  }
  entries.sort((a,b)=>a.root.localeCompare(b.root)||a.path.localeCompare(b.path));
  const body={schema:'payload.industrial-integrity-manifest.v1' as const,createdAt,entries,totalFiles:entries.length,totalBytes};
  return integrityManifestSchema.parse({...body,digest:commitment(body)});
}
export function verifyIntegrityManifest(roots:Record<z.infer<typeof rootId>,string>,raw:unknown){
  const expected=integrityManifestSchema.parse(raw);const {digest,...body}=expected;check(commitment(body)===digest,'INTEGRITY_MANIFEST_HASH_MISMATCH');
  const observed=buildIntegrityManifest(roots,expected.createdAt);
  const same=observed.digest===expected.digest;
  return {schema:'payload.industrial-integrity-verification.v1' as const,status:same?'MATCH' as const:'MISMATCH' as const,
    expectedDigest:expected.digest,observedDigest:observed.digest,totalFiles:observed.totalFiles,totalBytes:observed.totalBytes};
}
