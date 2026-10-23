import {z} from 'zod';
import {rawImportReportSchema,type RawDecodeSettings} from './types';
import lensBuild from '../lens/codec/build.json';

export const rawProgressSchema=z.object({phase:z.enum(['inspecting','developing','encoding']),fraction:z.number().min(0).max(1).nullable()}).strict();
export const rawInspectedSchema=z.object({report:rawImportReportSchema}).strict();
export const rawDevelopedSchema=rawInspectedSchema.extend({png:z.instanceof(Blob),lensWasmSha256:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict();
export type RawDeveloped=z.infer<typeof rawDevelopedSchema>;
/** Validate either host's private native reply before it can become accepted artwork. */
export async function validateRawDevelopmentResult(value:unknown,settings:RawDecodeSettings):Promise<RawDeveloped>{
  const decoded=rawDevelopedSchema.parse(value),report=decoded.report;
  const calibrated=!!(settings.development.lens?.enabled&&settings.development.lens.profile);
  if(calibrated?decoded.lensWasmSha256!==lensBuild.artifacts['canoli_lens_correction.wasm'].sha256:decoded.lensWasmSha256!==undefined)throw new Error('RAW lens correction native provenance differs from its requested settings.');
  if(!settings.allowPrecisionLoss||report.image!==settings.development.image||!report.canDevelop||decoded.png.type!=='image/png'||settings.development.whiteBalance==='camera'&&!report.hasCameraWhiteBalance&&report.channels>1)
    throw new Error('Invalid RAW developed result, consent or unavailable camera white balance.');
  const buffer=await decoded.png.slice(0,46).arrayBuffer(),bytes=new Uint8Array(buffer),view=new DataView(buffer);
  if(bytes.length!==46||[137,80,78,71,13,10,26,10].some((n,i)=>bytes[i]!==n)||view.getUint32(8)!==13||view.getUint32(12)!==0x49484452||view.getUint32(16)!==report.displayWidth||view.getUint32(20)!==report.displayHeight||bytes[24]!==8||bytes[25]!==6||view.getUint32(33)!==1||view.getUint32(37)!==0x73524742||bytes[41]!==0||view.getUint32(42)!==0xaece1ce9)
    throw new Error('RAW PNG geometry, precision or sRGB identification differs from its contract.');
  return decoded;
}
