import {encodePackBitsInto} from '../core/interchange/psd/packbits';
import {mattePreviewChannel} from '../core/interchange/psd/composite';

export type PhotoshopChannelEncoding='layer'|'preview'|'both'|'mask';
export interface PhotoshopEncodedChannel {lengths:Uint32Array<ArrayBuffer>;data:Blob}

/** Runs in a private worker; consumes only an export-owned bounded pixel strip. */
export function encodePhotoshopStrip(pixels:Uint8ClampedArray,width:number,rows:number,encoding:PhotoshopChannelEncoding):PhotoshopEncodedChannel[]{
 if(!Number.isSafeInteger(width)||width<1||!Number.isSafeInteger(rows)||rows<1||pixels.length!==width*rows*4||!['layer','preview','both','mask'].includes(encoding))
  throw new Error('Invalid Photoshop encoding strip.');
 const channels:PhotoshopEncodedChannel[]=[],plane=new Uint8Array(width);
 // Reuse one worst-case packet buffer across rows and channels. Blob owns the
 // used bytes before this scratch is reused; no per-row buffer/Blob list survives.
 const packed=new Uint8Array((width*2+256)*rows);
 for(let channel=0;channel<(encoding==='mask'?1:encoding==='both'?7:4);channel++){
  const lengths=new Uint32Array(rows),color=encoding==='mask'?3:channel>=4?channel-4:channel,matte=channel>=4||(encoding==='preview'&&channel<3);let offset=0;
  for(let row=0;row<rows;row++){
   const base=row*width*4;
   for(let x=0;x<width;x++){const i=base+x*4,value=pixels[i+color];plane[x]=matte?mattePreviewChannel(value,pixels[i+3]):value;}
   const size=encodePackBitsInto(plane,packed,offset);lengths[row]=size;offset+=size;
  }
  channels.push({lengths,data:new Blob([packed.subarray(0,offset)])});
 }
 return channels;
}
