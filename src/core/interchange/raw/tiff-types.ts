import{z}from'zod';
import{rawDevelopOptionsSchema,rawImportReportSchema,type RawDevelopOptions}from'./types';
import{iccIntentSchema}from'../../color/icc-types';
import{colorOutputSourceSchema}from'../../color/output-record';
import type{ColorOutput}from'../../color/color-settings';
import type{TiffVariant}from'../../tiff';
export interface RawTiffExportOptions{development?:RawDevelopOptions;sampleFormat?:'rgba16'|'rgba-float32';variant?:TiffVariant;color?:ColorOutput}
export const rawTiffSettingsSchema=z.object({development:rawDevelopOptionsSchema.prefault({}),sampleFormat:z.enum(['rgba16','rgba-float32']).default('rgba16'),variant:z.enum(['auto','classic','big']).default('auto'),color:colorOutputSourceSchema}).strict();
export type RawTiffSettings=z.infer<typeof rawTiffSettingsSchema>;
export const rawTiffProgressSchema=z.object({phase:z.enum(['waiting','inspecting','developing','encoding','verifying']),fraction:z.number().min(0).max(1).nullable()}).strict();
export interface RawTiffControl{signal?:AbortSignal;onProgress?:(progress:z.infer<typeof rawTiffProgressSchema>)=>void}
const hash=z.string().regex(/^[a-f0-9]{64}$/);
export const rawTiffReceiptSchema=z.object({version:z.literal(1),sourceSpace:z.literal('linear-srgb16'),sourceSha256:hash,sourceBytes:z.number().int().positive().safe(),settingsSha256:hash,rawWasmSha256:hash,lensWasmSha256:hash.optional(),iccWasmSha256:hash,profileSha256:hash,profileBytes:z.number().int().positive().safe(),profileName:z.string().min(1).max(240),intent:iccIntentSchema,blackPointCompensation:z.boolean(),sampleFormat:z.enum(['rgba16','rgba-float32']),width:z.number().int().positive().safe(),height:z.number().int().positive().safe(),usesIntentFallback:z.boolean(),warnings:z.array(z.string().max(2048)).max(32)}).strict();
export const rawTiffResultSchema=z.object({report:rawImportReportSchema,tiff:z.instanceof(Blob),receipt:rawTiffReceiptSchema}).strict();
export type RawTiffResult=z.infer<typeof rawTiffResultSchema>;
export async function rawTiffHash(bytes:Uint8Array<ArrayBuffer>|ArrayBuffer):Promise<string>{const digest=await crypto.subtle.digest('SHA-256',bytes);return[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('');}
export async function rawTiffSettingsHash(value:RawTiffSettings){const settings=rawTiffSettingsSchema.parse(value);return rawTiffHash(new TextEncoder().encode(JSON.stringify({...settings,color:{...settings.color,profile:{name:settings.color.profile.name,sha256:settings.color.profile.sha256,bytes:settings.color.profile.source.size}}})));}
