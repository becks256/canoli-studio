import {z} from 'zod';
import {rawDecodeOptionsSchema,rawImportReportSchema} from './types';

const sha256=z.string().regex(/^[a-f0-9]{64}$/);
/** The accepted pixels and the retained sensor original have independent identities. */
export const rawSourceMetadataSchema=z.object({
  version:z.literal(1),
  original:z.object({name:z.string().min(1),type:z.string(),byteLength:z.number().int().positive().safe(),sha256}).strict(),
  settings:rawDecodeOptionsSchema.refine(value=>value.allowPrecisionLoss,'Accepted RAW working output requires precision-loss consent.'),
  report:rawImportReportSchema,
  nativeWasmSha256:sha256,
  outputSha256:sha256,
}).strict().superRefine((value,context)=>{
  if(!value.report.canDevelop||value.report.image!==value.settings.development.image||value.settings.development.whiteBalance==='camera'&&value.report.channels>1&&!value.report.hasCameraWhiteBalance)
    context.addIssue({code:'custom',message:'RAW source settings do not match the accepted native report.'});
});
export type RawSourceMetadata=z.infer<typeof rawSourceMetadataSchema>;
export interface RawImageSource extends RawSourceMetadata {readonly originalBlob:Blob}
export const rawImageSourceSchema=rawSourceMetadataSchema.safeExtend({originalBlob:z.instanceof(Blob)});
const owned=new WeakSet<object>();
const hashes=new WeakMap<Blob,Promise<string>>();
export async function rawBlobHash(blob:Blob,check:()=>void=()=>{}):Promise<string>{
  check();let hash=hashes.get(blob);
  if(!hash){hash=blob.arrayBuffer().then(bytes=>crypto.subtle.digest('SHA-256',bytes)).then(bytes=>Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join(''));hashes.set(blob,hash);void hash.catch(()=>hashes.delete(blob));}
  const value=await hash;check();return value;
}
export function rawSourceMetadata(source:RawImageSource):RawSourceMetadata{
  const {originalBlob:_,...metadata}=source;return rawSourceMetadataSchema.parse(metadata);
}
export function ownRawSource(input:RawImageSource):Readonly<RawImageSource>{
  if(owned.has(input))return input;
  if(!input||!(input.originalBlob instanceof Blob))throw new Error('A retained RAW original Blob is required.');
  const metadata=rawSourceMetadata(input),blob=input.originalBlob;
  if(blob.size!==metadata.original.byteLength||blob.type!==metadata.original.type)throw new Error('RAW original extent or MIME type differs from its descriptor.');
  Object.freeze(metadata.original);Object.freeze(metadata.settings.development.multipliers);Object.freeze(metadata.settings.development);Object.freeze(metadata.settings);
  Object.freeze(metadata.report.unsupported);Object.freeze(metadata.report.warnings);Object.freeze(metadata.report);
  const result=Object.freeze({...metadata,originalBlob:blob});owned.add(result);return result;
}
export async function verifyRawSource(input:RawImageSource,output:Blob,width?:number,height?:number,check:()=>void=()=>{}):Promise<Readonly<RawImageSource>>{
  const source=ownRawSource(input);check();
  if(output.type!=='image/png'||width!==undefined&&source.report.displayWidth!==width||height!==undefined&&source.report.displayHeight!==height)throw new Error('RAW working image type or dimensions differ from the accepted output.');
  if(await rawBlobHash(source.originalBlob,check)!==source.original.sha256)throw new Error('Retained RAW original checksum mismatch.');
  if(await rawBlobHash(output,check)!==source.outputSha256)throw new Error('Accepted RAW working image checksum mismatch.');
  return source;
}
