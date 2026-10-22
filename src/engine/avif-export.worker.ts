import factory from '@jsquash/avif/codec/enc/avif_enc.js';
import wasmUrl from '@jsquash/avif/codec/enc/avif_enc.wasm?url';
import {avifGeometry,avifSettings} from '../core/avif';
import {encodeAvifRgba} from './avif-codec';

let started=false;
self.onmessage=async(event:MessageEvent)=>{
  try{
    if(started)throw new Error('This AVIF worker already owns an export.');started=true;
    const request=event.data;
    if(!request||request.type!=='encode'||typeof request.requiresAlpha!=='boolean'||Object.keys(request).some(key=>!['type','width','height','buffer','settings','requiresAlpha'].includes(key)))throw new Error('Invalid AVIF encoding request.');
    const geometry=avifGeometry(request.width,request.height),settings=avifSettings(request.settings);
    if(!(request.buffer instanceof ArrayBuffer)||request.buffer.byteLength!==geometry.bytes)throw new Error('Invalid AVIF RGBA extent.');
    const module=await factory({locateFile:()=>wasmUrl});
    self.postMessage({type:'started'});
    const blob=encodeAvifRgba(module,request.buffer,geometry.width,geometry.height,settings,request.requiresAlpha);
    self.postMessage({type:'complete',width:geometry.width,height:geometry.height,blob});
  }catch(error){self.postMessage({type:'error',error:error instanceof Error?error.message:String(error)});}
};
