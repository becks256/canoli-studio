import {z} from 'zod';
import {iccIntentSchema} from './icc-types';
/** Complete immutable file ownership in batch storage; never a live profile ID. */
export const colorOutputSourceSchema=z.object({
 version:z.literal(1),
 profile:z.object({name:z.string().min(1).max(240),sha256:z.string().regex(/^[a-f0-9]{64}$/),source:z.instanceof(Blob)}).strict(),
 intent:iccIntentSchema,
 blackPointCompensation:z.boolean(),
}).strict();
export type ColorOutputSource=z.infer<typeof colorOutputSourceSchema>;
/** JSON-safe statement of the actual prepared conversion, included in integrity checks. */
export const colorOutputReceiptSchema=z.object({
 version:z.literal(1),engine:z.literal('Little CMS 2.19.1'),wasmSha256:z.string().regex(/^[a-f0-9]{64}$/),sourceSpace:z.literal('srgb8'),
 profileName:z.string().min(1).max(240),profileSha256:z.string().regex(/^[a-f0-9]{64}$/),profileByteLength:z.number().int().positive().safe(),
 intent:iccIntentSchema,blackPointCompensation:z.boolean(),usesIntentFallback:z.boolean(),warnings:z.array(z.string().max(2048)).max(16),
}).strict();
export type ColorOutputReceipt=z.infer<typeof colorOutputReceiptSchema>;
