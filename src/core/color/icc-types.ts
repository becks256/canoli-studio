import {z}from 'zod';

/** The ICC-defined codes; "unclipped" is not a rendering intent. */
export const iccIntents=['perceptual','relative-colorimetric','saturation','absolute-colorimetric']as const;
export const iccIntentSchema=z.enum(iccIntents);
export type IccIntent=z.infer<typeof iccIntentSchema>;
const common={intent:iccIntentSchema.default('relative-colorimetric'),blackPointCompensation:z.boolean().default(false)};
export const iccTransformOptionsSchema=z.discriminatedUnion('mode',[
 z.object({mode:z.literal('convert'),...common}).strict(),
 z.object({mode:z.literal('proof'),...common,proofIntent:iccIntentSchema.default('relative-colorimetric'),gamutWarning:z.boolean().default(false),warningColor:z.string().regex(/^#[0-9a-f]{6}$/i).transform(v=>v.toLowerCase()).default('#00ffff')}).strict(),
]);
export type IccTransformOptions=z.input<typeof iccTransformOptionsSchema>;
export const nativeIccReportSchema=z.object({
 version:z.literal(1),engine:z.literal('Little CMS 2.19.1'),nativeVersion:z.literal(2190),
 profileVersion:z.string().min(1),deviceClass:z.string().length(4),colorSpace:z.string().length(4),connectionSpace:z.string().length(4),channels:z.number().int().min(1).max(15),
 description:z.string().max(2048),copyright:z.string().max(2048),manufacturer:z.string().max(2048),model:z.string().max(2048),
 inputIntents:z.array(iccIntentSchema).max(4),outputIntents:z.array(iccIntentSchema).max(4),proofIntents:z.array(iccIntentSchema).max(4),
}).strict();
export type NativeIccReport=z.infer<typeof nativeIccReportSchema>;
export const iccPreparationSchema=z.object({profile:nativeIccReportSchema,settings:iccTransformOptionsSchema,usesIntentFallback:z.boolean(),warnings:z.array(z.string().max(2048)).max(16)}).strict();
export type IccPreparation=z.infer<typeof iccPreparationSchema>;
