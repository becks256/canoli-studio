import {z} from 'zod';

export const tiffDecodeOptionsSchema=z.object({page:z.number().int().nonnegative().safe().default(0),allowPrecisionLoss:z.boolean().default(false)}).strict();
export type TiffDecodeOptions=z.input<typeof tiffDecodeOptionsSchema>;
export type TiffDecodeSettings=z.output<typeof tiffDecodeOptionsSchema>;
export interface TiffImportProgress {phase:'inspecting'|'decoding';fraction:number|null}
export interface TiffImportControl {signal?:AbortSignal;onProgress?:(value:TiffImportProgress)=>void}
export const tiffPageReportSchema=z.object({index:z.number().int().nonnegative(),width:z.number().int().positive().safe(),height:z.number().int().positive().safe(),orientation:z.number().int().min(1).max(8),bits:z.number().int().positive(),samples:z.number().int().positive(),compression:z.number().int().nonnegative(),photometric:z.number().int().nonnegative(),planar:z.number().int().positive(),canDecode:z.boolean(),requiresPrecisionLoss:z.boolean(),hasIcc:z.boolean(),unsupported:z.array(z.string()),warnings:z.array(z.string())}).strict();
export type TiffPageReport=z.infer<typeof tiffPageReportSchema>;
export const tiffReportSchema=z.object({version:z.literal(1),bigTiff:z.boolean(),littleEndian:z.boolean(),pages:z.array(tiffPageReportSchema).min(1).max(256)}).strict();
export type TiffImportReport=z.infer<typeof tiffReportSchema>;
