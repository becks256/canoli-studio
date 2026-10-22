import type {NativeAvifModule} from './codec/canoli_avif_decoder.js';
import type {AvifDecoder,AvifDecodedImage} from './decode';

/** Checked C ABI. Never expose borrowed WASM memory after native source/output release. */
export function avifDecoder(module:NativeAvifModule):AvifDecoder{
  return{decode(bytes:Uint8Array):AvifDecodedImage{
    let input=0;
    try{
      if(!bytes.length||bytes.length>0xffffffff)throw new Error('AVIF source cannot be represented in the native WASM address space.');
      input=module._malloc(bytes.length)>>>0;
      if(!input||input+bytes.length>module.HEAPU8.length)throw new Error('AVIF source allocation failed.');
      module.HEAPU8.set(bytes,input);
      const status=module._canoli_avif_decode(input,bytes.length);
      if(status!==0){
        const heap=module.HEAPU8,pointer=module._canoli_avif_error()>>>0;
        if(!pointer||pointer>=heap.length)throw new Error(`AVIF native decoder failed (${status}).`);
        const message=heap.subarray(pointer,Math.min(pointer+1024,heap.length)),end=message.indexOf(0);
        if(end<0)throw new Error('Invalid AVIF native error result.');
        throw new Error(new TextDecoder().decode(message.subarray(0,end))||`AVIF native decoder failed (${status}).`);
      }
      const heap=module.HEAPU8,pointer=module._canoli_avif_info()>>>0;
      if(!pointer||pointer%4||pointer+48>heap.length)throw new Error('Invalid AVIF native information extent.');
      const info=new Uint32Array(heap.buffer,pointer,12),[version,width,height,bitDepth,alpha,primaries,transfer,matrix,fullRange,pixels,length,rowBytes]=info;
      if(version!==1||!width||!height||![8,10,12].includes(bitDepth)||alpha>1||fullRange>1||!Number.isSafeInteger(width*height*4)||length!==width*height*4||rowBytes!==width*4||!pixels||pixels+length>heap.length)throw new Error('Invalid AVIF native RGBA result.');
      return{width,height,bitDepth,alpha:!!alpha,color:{primaries,transfer,matrix,fullRange:!!fullRange},data:new Uint8ClampedArray(heap.subarray(pixels,pixels+length))};
    }finally{
      try{module._canoli_avif_release();}finally{if(input)module._free(input);}
    }
  }};
}
