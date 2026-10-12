import {it,expect,vi} from 'vitest';
import {encodeCapturedPng,encodeRgbaPng} from '../src/engine/png';

it('captured PNG falls back exactly when native encoding is unavailable or fails',async()=>{
 const pixels=new Uint8ClampedArray([255,0,0,255,0,0,0,0,20,40,60,128,0,255,0,255]);
 const expected=new Uint8Array(await (await encodeRgbaPng(new Uint8Array(pixels.buffer),2,2)).arrayBuffer());
 try {
  for(const native of [undefined,class {
   width=0;height=0;
   getContext(){return {putImageData(){}};}
   async convertToBlob(){throw Error('Encoding unavailable');}
  }]) {
   vi.stubGlobal('OffscreenCanvas',native);
   vi.stubGlobal('ImageData',class {});
   const blob=await encodeCapturedPng(pixels,2,2);
   expect(new Uint8Array(await blob.arrayBuffer())).toEqual(expected);
  }
 } finally {vi.unstubAllGlobals();}
});
it('captured PNG rejects mismatched dimensions',async()=>{
 await expect(encodeCapturedPng(new Uint8ClampedArray(4),2,2)).rejects.toThrow('dimensions');
 await expect(encodeCapturedPng(new Uint8ClampedArray(0),0,0)).rejects.toThrow('dimensions');
});
