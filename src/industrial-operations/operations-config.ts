import { lstatSync } from 'node:fs';
import { z } from 'zod';

export const operationsConfigSchema = z.object({
  root: z.string().min(1), intakeRoot: z.string().min(1), objectRoot: z.string().min(1),
  auditRoot: z.string().min(1), gscRoot: z.string().min(1), pythonExecutable: z.string().min(1),
  schedule: z.unknown(), authorityKeys: z.array(z.unknown()),
  distributionConfig: z.string().min(1), staticRoot: z.string().min(1),
  port: z.number().int().min(1024).max(65535),
  reviewReadiness: z.object({maxObservationAgeMs:z.number().int().positive().max(24*60*60*1000)}).strict().optional(),
}).strict();

export type OperationsConfig = z.infer<typeof operationsConfigSchema>;

/** Production configuration is expected to be owner-only on POSIX hosts. */
export function protectedConfigFile(path:string):boolean{
  try{const stat=lstatSync(path);return stat.isFile()&&!stat.isSymbolicLink()&&(process.platform==='win32'||(stat.mode&0o077)===0);}catch{return false;}
}
