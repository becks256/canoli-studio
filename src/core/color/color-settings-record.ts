import {z}from 'zod';
import {iccIntentSchema}from './icc-types';
export const builtinIccIdSchema=z.enum(['srgb','display-p3','adobe-rgb','linear-srgb']);
export const iccTargetRecordSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('builtin'),id:builtinIccIdSchema}).strict(),
 z.object({kind:z.literal('icc'),name:z.string().min(1).max(240),sha256:z.string().regex(/^[a-f0-9]{64}$/),source:z.instanceof(Blob)}).strict(),
]);
const common={intent:iccIntentSchema,blackPointCompensation:z.boolean()};
export const colorSettingsRecordSchema=z.object({version:z.literal(1),output:z.object({profile:iccTargetRecordSchema,...common}).strict(),proof:z.object({profile:iccTargetRecordSchema,...common,proofIntent:iccIntentSchema,gamutWarning:z.boolean(),warningColor:z.string().regex(/^#[a-f0-9]{6}$/)}).strict().nullable()}).strict();
export type IccTargetRecord=z.infer<typeof iccTargetRecordSchema>;
export type ColorSettingsRecord=z.infer<typeof colorSettingsRecordSchema>;
