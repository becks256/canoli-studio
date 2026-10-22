import {z} from 'zod';
import {rawSourceMetadataSchema,rawImageSourceSchema,ownRawSource,verifyRawSource,rawSourceMetadata} from '../core/interchange/raw/source';
import {avifDecodeOptionsSchema} from '../core/interchange/avif/types';
import {tiffDecodeOptionsSchema} from '../core/interchange/tiff/types';
import {BrushTextureSourceOwner} from './texture-source';
import {hashBrushBlob} from './container';

export const presetSourceMetadataSchema=z.object({
  id:z.string().min(1).max(240),name:z.string().min(1),type:z.enum(['image/png','image/jpeg','image/webp','image/tiff','image/avif']),
  width:z.number().int().positive().safe(),height:z.number().int().positive().safe(),sha256:z.string().regex(/^[a-f0-9]{64}$/),
  tiff:tiffDecodeOptionsSchema.optional(),avif:avifDecodeOptionsSchema.optional(),
  raw:rawSourceMetadataSchema.optional(),
}).strict().refine(value=>value.type==='image/tiff'?value.tiff!==undefined:value.tiff===undefined,'TIFF sources require exact page/precision settings; other images cannot carry TIFF settings.').refine(value=>value.type==='image/avif'?value.avif!==undefined:value.avif===undefined,'AVIF sources require exact precision/color settings; other images cannot carry AVIF settings.');
export const presetSourceSchema=presetSourceMetadataSchema.safeExtend({blob:z.instanceof(Blob),raw:rawImageSourceSchema.optional()}).refine(value=>value.blob.size>0&&value.blob.type===value.type,'Source bytes and MIME type must match.');
export type PresetSource=Readonly<z.infer<typeof presetSourceSchema>>;
const ownedSources=new WeakSet<object>(),verifiedSources=new WeakSet<object>();
// Bounded metadata proofs only. Eviction causes verification/decode, never source rejection.
const decoded=new Map<string,true>();
const signature=(source:PresetSource)=>JSON.stringify([source.sha256,source.type,source.width,source.height,source.tiff??null,source.avif??null,source.raw?rawSourceMetadata(source.raw):null]);
function remember(source:PresetSource){verifiedSources.add(source);const key=signature(source);decoded.delete(key);decoded.set(key,true);while(decoded.size>256)decoded.delete(decoded.keys().next().value!);}
export function ownPresetSource(input:unknown):PresetSource{
  if(input&&typeof input==='object'&&ownedSources.has(input))return input as PresetSource;
  const source=presetSourceSchema.parse(input);if(source.tiff)Object.freeze(source.tiff);else delete source.tiff;if(source.avif)Object.freeze(source.avif);else delete source.avif;
  if(source.raw)source.raw=ownRawSource(source.raw);else delete source.raw;
  Object.freeze(source);ownedSources.add(source);return source;
}
export async function verifyPresetSource(input:unknown,signal?:AbortSignal):Promise<PresetSource>{
  const source=ownPresetSource(input);signal?.throwIfAborted();if(verifiedSources.has(source))return source;
  if(source.raw)await verifyRawSource(source.raw,source.blob,source.width,source.height,()=>signal?.throwIfAborted());
  if(await hashBrushBlob(source.blob,signal)!==source.sha256)throw new Error('Brush source checksum mismatch. Saved data was preserved.');
  const key=signature(source);
  if(!decoded.has(key)){
    if(typeof createImageBitmap==='undefined')throw new Error('Brush source validation requires the native browser image host.');
    const draft=new BrushTextureSourceOwner();
    try{const asset=await draft.import(source.blob,source.name,{signal,tiff:source.tiff,avif:source.avif,raw:source.raw});if(asset.width!==source.width||asset.height!==source.height)throw new Error('Brush source dimensions do not match its original pixels.');}
    finally{draft.dispose();}
  }
  signal?.throwIfAborted();remember(source);return source;
}
/** Retain a ready original across asynchronous hashing without re-decoding it. */
export async function capturePresetSource(owner:BrushTextureSourceOwner,signal?:AbortSignal):Promise<PresetSource>{
  signal?.throwIfAborted();const retained=new BrushTextureSourceOwner();
  try{
    const asset=retained.captureFrom(owner),sha256=await hashBrushBlob(asset.blob,signal);
    if(asset.bitmap.width!==asset.width||asset.bitmap.height!==asset.height)throw new Error('Brush source pixels changed during preset capture.');
    const source=ownPresetSource({id:crypto.randomUUID(),name:asset.name,type:asset.blob.type,width:asset.width,height:asset.height,sha256,blob:asset.blob,...(asset.tiff?{tiff:asset.tiff}:{}),...(asset.avif?{avif:asset.avif}:{}),...(asset.raw?{raw:asset.raw}:{})});
    remember(source);return source;
  }finally{retained.dispose();}
}
