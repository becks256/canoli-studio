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

export const iccSampleFormats=['rgba8','rgba16','rgba-float32']as const;
export const iccSampleFormatSchema=z.enum(iccSampleFormats);
export type IccSampleFormat=z.infer<typeof iccSampleFormatSchema>;
export type IccSamples=Uint8ClampedArray|Uint16Array|Float32Array;
export const iccRgbOptionsSchema=z.object({...common,inputFormat:iccSampleFormatSchema.default('rgba8'),outputFormat:iccSampleFormatSchema.optional()}).strict().transform(v=>({...v,outputFormat:v.outputFormat??v.inputFormat}));
export type IccRgbOptions=z.input<typeof iccRgbOptionsSchema>;
export const iccRgbPreparationSchema=z.object({source:nativeIccReportSchema,destination:nativeIccReportSchema,settings:iccRgbOptionsSchema,usesIntentFallback:z.boolean(),warnings:z.array(z.string().max(2048)).max(16)}).strict();
export type IccRgbPreparation=z.infer<typeof iccRgbPreparationSchema>;
export function iccSampleFormat(samples:unknown):IccSampleFormat|undefined{
 if(samples instanceof Uint8ClampedArray)return'rgba8';if(samples instanceof Uint16Array)return'rgba16';if(samples instanceof Float32Array)return'rgba-float32';
}
export function validateIccSamples(samples:unknown,format:IccSampleFormat):asserts samples is IccSamples{
 if(iccSampleFormat(samples)!==format||!(ArrayBuffer.isView(samples))||!(samples.buffer instanceof ArrayBuffer)||!samples.byteLength||samples.byteLength>0x7fffffff||(samples as IccSamples).length%4)throw new Error('ICC conversion requires a complete nonempty sample window matching its input format.');
 if(samples instanceof Float32Array)for(let i=0;i<samples.length;i++)if(!Number.isFinite(samples[i])||(i%4===3&&(samples[i]<0||samples[i]>1)))throw new Error('ICC float samples must be finite with alpha in [0,1].');
}
