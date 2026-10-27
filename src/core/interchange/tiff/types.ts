import {z} from 'zod';

export const tiffDecodeOptionsSchema=z.object({page:z.number().int().nonnegative().safe().default(0),allowPrecisionLoss:z.boolean().default(false),floatColorSpace:z.enum(['srgb','linear-srgb']).optional()}).strict();
export type TiffDecodeOptions=z.input<typeof tiffDecodeOptionsSchema>;
export type TiffDecodeSettings=z.output<typeof tiffDecodeOptionsSchema>;
export interface TiffImportProgress {phase:'inspecting'|'decoding';fraction:number|null}
export interface TiffImportControl {signal?:AbortSignal;onProgress?:(value:TiffImportProgress)=>void}
export const tiffPageReportSchema=z.object({index:z.number().int().nonnegative(),width:z.number().int().positive().safe(),height:z.number().int().positive().safe(),orientation:z.number().int().min(1).max(8),bits:z.number().int().positive(),samples:z.number().int().positive(),compression:z.number().int().nonnegative(),photometric:z.number().int().nonnegative(),planar:z.number().int().positive(),canDecode:z.boolean(),requiresPrecisionLoss:z.boolean(),hasIcc:z.boolean(),sampleFormat:z.number().int().positive().optional(),requiresColorAssumption:z.boolean().optional(),unsupported:z.array(z.string()),warnings:z.array(z.string())}).strict();
export type TiffPageReport=z.infer<typeof tiffPageReportSchema>;
export const tiffReportSchema=z.object({version:z.literal(1),bigTiff:z.boolean(),littleEndian:z.boolean(),pages:z.array(tiffPageReportSchema).min(1).max(256)}).strict();
export type TiffImportReport=z.infer<typeof tiffReportSchema>;
export const tiffFloatColorSchema=z.object({version:z.literal(1),engine:z.literal('Little CMS 2.19.1'),wasmSha256:z.string().regex(/^[a-f0-9]{64}$/),source:z.discriminatedUnion('kind',[
 z.object({kind:z.literal('icc'),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
 z.object({kind:z.literal('assumed'),id:z.enum(['srgb','linear-srgb']),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
]),outputSpace:z.literal('srgb8'),usesIntentFallback:z.boolean(),warnings:z.array(z.string().max(2048)).max(16)}).strict();
export type TiffFloatColor=z.infer<typeof tiffFloatColorSchema>;

export interface TiffDecoded{png:Blob;page:TiffPageReport;report:TiffImportReport;color?:TiffFloatColor}
