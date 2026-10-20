import {describe,it,expect} from 'vitest';
import {decodePackBits,encodePackBitsInto} from '../src/core/interchange/psd/packbits';
import {encodePhotoshopStrip} from '../src/engine/photoshop-strip';

describe('private Photoshop encoding buffers',()=>{
 it('writes standard packet bytes at an offset without overwriting surrounding data',()=>{
  const source=new Uint8Array([3,3,3,8,9,10,10]),target=new Uint8Array(400).fill(77),before=source.slice();
  const length=encodePackBitsInto(source,target,4);
  expect([...target.subarray(4,4+length)]).toEqual([254,3,3,8,9,10,10]);
  expect([...target.subarray(0,4)]).toEqual([77,77,77,77]);expect(target[4+length]).toBe(77);expect(source).toEqual(before);
 });
 it('rejects undersized or overlapping destinations before writes',()=>{
  const source=new Uint8Array([1,2,3]),target=new Uint8Array(20).fill(88);
  expect(()=>encodePackBitsInto(source,target)).toThrow(/too small/);expect([...target]).toEqual(Array(20).fill(88));
  const shared=new Uint8Array(1024);expect(()=>encodePackBitsInto(shared.subarray(0,3),shared)).toThrow(/overlap/);
  expect(()=>encodePackBitsInto(source,new Uint8Array(400),.5)).toThrow(/offset/);
 });
 for(const mode of ['layer','preview','both'] as const)it(`${mode} owns packed Blob bytes despite scratch reuse and preserves every channel sample`,async()=>{
  const width=100000,rows=3,pixels=new Uint8ClampedArray(width*rows*4);
  for(let i=0;i<pixels.length;i++)pixels[i]=(i*37+Math.floor(i/(width*4))*13)%256;
  const before=pixels.slice(),channels=encodePhotoshopStrip(pixels,width,rows,mode);expect(channels).toHaveLength(mode==='both'?7:4);
  for(let c=0;c<channels.length;c++){
   const bytes=new Uint8Array(await channels[c].data.arrayBuffer());let offset=0;
   for(let row=0;row<rows;row++){
    const count=channels[c].lengths[row],plane=decodePackBits(bytes.subarray(offset,offset+count),width);offset+=count;
    if(c<3)expect(count).toBeGreaterThan(65535);
    for(let x=0;x<width;x++){
     const color=c>=4?c-4:c,i=(row*width+x)*4,value=pixels[i+color],alpha=pixels[i+3],expected=c>=4||(mode==='preview'&&c<3)?Math.round(value*alpha/255+255-alpha):value;
     if(plane[x]!==expected)throw new Error(`Incorrect ${mode} sample ${c}:${row}:${x}`);
    }
   }
   expect(offset).toBe(bytes.length);
  }
  expect(pixels).toEqual(before);
 });
 it('rejects malformed private strip requests',()=>{
  for(const [width,rows,mode] of [[0,1,'layer'],[1,-1,'both'],[1,1,'unknown'],[2,1,'preview']] as const)
   expect(()=>encodePhotoshopStrip(new Uint8ClampedArray(4),width,rows,mode as 'layer')).toThrow(/Invalid Photoshop/);
 });
});
