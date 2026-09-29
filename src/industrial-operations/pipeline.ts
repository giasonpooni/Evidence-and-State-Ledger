/** Fixed, pinned GSC acquisition -> original ESM intake -> GSC projection. No solver or release. */
import { spawn } from 'node:child_process';
import { resolve, join } from 'node:path';
import { retainIndustrialCapture } from '../acquisition/industrial-review';
import { publishImmutableFile, readImmutableFile } from '../data-os/local-files';
import { encodeLocalRecord } from '../data-os/local-record';
import { byteDigest } from '../data-os/evidence-capture';
import { check, LIMIT } from './authority';
import type { RefreshResult } from './refresh';
export const GSC_PIN='98bd33bcca22efabe24de8be42642dc561fcfd17';
export const REFRESH_OPERATION={schema:'payload.industrial-refresh-operation.v1',gscCommit:GSC_PIN,
  sourceScope:'noaa-9414290-usgs-3dep-129x129',admission:'NEVER',release:'NEVER'} as const;
async function run(command:string,args:string[],cwd:string):Promise<string>{
  return new Promise((done,fail)=>{const p=spawn(command,args,{cwd,shell:false,timeout:180000,stdio:['ignore','pipe','pipe'],
    env:{PATH:process.env.PATH,HOME:process.env.HOME,PYTHONDONTWRITEBYTECODE:'1',NEXT_TELEMETRY_DISABLED:'1'}});
    let output='',size=0;const capture=(chunk:Buffer)=>{size+=chunk.length;if(size>32768){p.kill('SIGKILL');fail(new Error('PROCESS_OUTPUT_LIMIT'));return;}output+=chunk.toString('utf8');};
    p.stdout.on('data',capture);p.stderr.on('data',chunk=>{size+=chunk.length;if(size>32768)p.kill('SIGKILL');});
    p.on('error',()=>fail(new Error('PIPELINE_PROCESS_UNAVAILABLE')));p.on('close',code=>code===0?done(output):fail(new Error('PIPELINE_PROCESS_FAILED')));
  });
}
export function fixedRefreshPipeline(config:{gscRoot:string;pythonExecutable:string;intakeRoot:string}){
  const gsc=resolve(config.gscRoot),intake=resolve(config.intakeRoot);
  return async(attemptDirectory:string):Promise<RefreshResult>=>{
    check((await run('git',['rev-parse','HEAD'],gsc)).trim()===GSC_PIN,'GSC_PIN_MISMATCH');
    check((await run('git',['status','--porcelain','--untracked-files=all'],gsc)).trim()==='','GSC_WORKTREE_DIRTY');
    const capture=join(attemptDirectory,'capture'),view=join(attemptDirectory,'view');
    await run(config.pythonExecutable,['scripts/industrial/capture.py','--capture-live','--output',capture],gsc);
    await run(config.pythonExecutable,['scripts/industrial/verify_terrain.py',capture,'--output',join(attemptDirectory,'terrain-check.json')],gsc);
    const review=retainIndustrialCapture(capture,intake,true);
    publishImmutableFile(attemptDirectory,['esm-review.json'],encodeLocalRecord(review,LIMIT),LIMIT);
    await run(process.execPath,[join(gsc,'node_modules/tsx/dist/cli.mjs'),'scripts/industrial/compile.ts',capture,join(attemptDirectory,'esm-review.json'),view,'--internal-review-only'],gsc);
    const manifest=readImmutableFile(capture,['capture.json'],LIMIT),indexBytes=readImmutableFile(view,['index.json'],LIMIT);
    check(manifest&&indexBytes,'OUTPUT_UNAVAILABLE');const index=JSON.parse(indexBytes.toString('utf8'));
    check(index.schema==='gsc.industrial-review-index.v1'&&index.canonicalAdmission===false&&index.release===null&&/^review-[a-f0-9]{64}\.json$/.test(index.file),'OUTPUT_SCOPE_MISMATCH');
    const bytes=readImmutableFile(view,[index.file],LIMIT);check(bytes&&byteDigest(bytes)===index.sha256&&index.bytes===bytes.length,'OUTPUT_HASH_MISMATCH');
    return {captureDigest:byteDigest(manifest),reviewDigest:review.digest,compiledDigest:index.sha256,canonicalAdmission:false,release:null};
  };
}
