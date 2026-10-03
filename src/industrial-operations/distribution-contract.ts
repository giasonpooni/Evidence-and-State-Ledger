import { z } from 'zod';
import { approvalAction, hash, id, instant } from './authority';

export const credentialSchema = z.object({
  credentialId: id, recipientId: id, tokenDigest: hash, notBefore: instant, notAfter: instant,
  revoked: z.boolean(), artifacts: z.array(hash).min(1).max(128),
}).strict();

export const authorityKeySchema = z.object({
  keyId: id, authorityId: id, publicKeyPem: z.string().min(1).max(4096),
  actions: z.array(approvalAction).min(1).max(3), notBefore: instant, notAfter: instant,
  revoked: z.boolean(),
}).strict();

export const serverResourceSchema = z.object({
  digest: hash, kind: z.enum(['REVIEW','RELEASE','RETAINED_REVIEW']),
  file: z.string().min(1).max(2048), requestFile: z.string().max(2048).nullable(), revoked: z.boolean(),
}).strict();

export const serverConfigSchema = z.object({
  schema: z.literal('payload.industrial-distribution.v1'),
  credentials: z.array(credentialSchema).min(1).max(64),
  authorityKeys: z.array(authorityKeySchema).max(32),
  resources: z.array(serverResourceSchema).max(128),
  activeReviewDigest: hash.nullable(),
}).strict();

export type ServerConfig = z.infer<typeof serverConfigSchema>;
