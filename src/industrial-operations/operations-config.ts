import { z } from 'zod';

export const operationsConfigSchema = z.object({
  root: z.string().min(1), intakeRoot: z.string().min(1), objectRoot: z.string().min(1),
  auditRoot: z.string().min(1), gscRoot: z.string().min(1), pythonExecutable: z.string().min(1),
  schedule: z.unknown(), authorityKeys: z.array(z.unknown()),
  distributionConfig: z.string().min(1), staticRoot: z.string().min(1),
  port: z.number().int().min(1024).max(65535),
}).strict();

export type OperationsConfig = z.infer<typeof operationsConfigSchema>;
