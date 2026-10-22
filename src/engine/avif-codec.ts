import type {AVIFModule} from '@jsquash/avif/codec/enc/avif_enc.js';
import {avifGeometry,avifSettings,identifyAvifSrgb,assertAvifResult} from '../core/avif';

/** Synchronous codec work belongs only in the private export worker. */
export function encodeAvifRgba(module:Pick<AVIFModule,'encode'>,buffer:ArrayBuffer,width:number,height:number,options:unknown,requiresAlpha=false):Blob {
  const geometry=avifGeometry(width,height),settings=avifSettings(options);
  if(!(buffer instanceof ArrayBuffer)||buffer.byteLength!==geometry.bytes)throw new Error('AVIF requires one complete private RGBA8 frame.');
  const encoded=module.encode(new Uint8Array(buffer),width,height,{
    quality:settings.lossless?100:Math.round(settings.quality*100),qualityAlpha:100,
    denoiseLevel:0,tileColsLog2:0,tileRowsLog2:0,speed:settings.speed,subsample:3,
    chromaDeltaQ:false,sharpness:0,tune:0,enableSharpYUV:false,bitDepth:8,
  });
  if(!(encoded instanceof Uint8Array)||!encoded.byteLength)throw new Error('AVIF could not encode this image. Save a project or choose another output format.');
  const bytes=new Uint8Array(encoded),info=identifyAvifSrgb(bytes);assertAvifResult(info,width,height,requiresAlpha);
  return new Blob([bytes],{type:'image/avif'});
}
