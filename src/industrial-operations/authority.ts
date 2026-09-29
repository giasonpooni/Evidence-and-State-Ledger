/** Operator decisions are distinct from capture, execution and verification identities. */
import { createPublicKey, verify } from 'node:crypto';
import { z } from 'zod';
import { encodeLocalRecord, localRecordDigest } from '../data-os/local-record';
export const LIMIT = 4 * 1024 * 1024;
export const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:._/-]{0,159}$/);
export const instant = z.string().refine(s => Number.isFinite(Date.parse(s)) && new Date(s).toISOString() === s);
export const text = z.string().min(1).max(512).refine(s => !!s.trim() && !/[\u0000-\u001f\u007f]/.test(s));
export const approvalSchema = z.object({schema:z.literal('payload.industrial-approval.v1'),decisionId:id,
  action:z.enum(['ADMIT','RELEASE']),authorityId:id,keyId:id,targetDigest:hash,
  issuedAt:instant,notAfter:instant,signature:z.string().regex(/^[A-Za-z0-9_-]{86}$/)}).strict();
export type Approval = z.infer<typeof approvalSchema>;
export interface AuthorityKey { keyId:string; authorityId:string; publicKeyPem:string; actions:readonly Approval['action'][];
  notBefore:string; notAfter:string; revoked:boolean; }
export function check(ok:unknown,code:string):asserts ok {if(!ok)throw new Error(code);}
export const commitment = (value:unknown) => localRecordDigest(value,LIMIT);
export function verifyApproval(value:unknown,action:Approval['action'],target:unknown,keys:readonly AuthorityKey[],at:string):Approval {
  const a=approvalSchema.parse(value);instant.parse(at);
  const matches=keys.filter(k=>k.keyId===a.keyId);check(matches.length===1,'AUTHORITY_UNKNOWN');const k=matches[0];
  instant.parse(k.notBefore);instant.parse(k.notAfter);
  check(k.authorityId===a.authorityId&&!k.authorityId.startsWith('notationsos.')&&!k.revoked&&k.actions.includes(action),'AUTHORITY_REFUSED');
  const now=Date.parse(at);check(a.action===action&&a.targetDigest===commitment(target),'APPROVAL_BINDING_MISMATCH');
  check(Date.parse(k.notBefore)<=Date.parse(a.issuedAt)&&Date.parse(a.issuedAt)<=now&&now<Date.parse(a.notAfter)&&
    Date.parse(a.issuedAt)<Date.parse(a.notAfter)&&Date.parse(a.notAfter)<=Date.parse(k.notAfter),'APPROVAL_EXPIRED_OR_FUTURE');
  const key=createPublicKey(k.publicKeyPem);check(key.asymmetricKeyType==='ed25519','AUTHORITY_KEY_TYPE');
  const {signature,...body}=a;
  // Domain separation is in the signed schema/action; no private key belongs here.
  check(verify(null,encodeLocalRecord(body),key,Buffer.from(signature,'base64url')),'APPROVAL_SIGNATURE_INVALID');return a;
}
