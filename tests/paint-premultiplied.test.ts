import {expect,it} from 'vitest';
import {blendCoveragePixel,blendCoverageInterval,gradientDither} from '../src/engine/paint-premultiplied';
import {primitiveCoverage} from '../src/engine/primitive-coverage';
import {AffineTransform} from '../src/core/affine';

it('composites quarter-coverage red over half-transparent blue without rounding the source first',()=>{
 const pixels=new Uint8ClampedArray([0,0,255,128]);
 blendCoveragePixel(pixels,0,[255,0,0],.25,1);
 expect([...pixels]).toEqual([102,0,153,160]);
});
it('keeps zero coverage inert and opaque coverage replaces every destination alpha',()=>{
 for(let alpha=0;alpha<256;alpha++){
  const pixels=new Uint8ClampedArray([17,94,231,alpha]),before=pixels.slice();
  blendCoveragePixel(pixels,0,[200,40,90],0,.4);expect(pixels).toEqual(before);
  blendCoveragePixel(pixels,0,[200,40,90],1,1);expect([...pixels]).toEqual([200,40,90,255]);
 }
});
it('retains destination premultiplied bytes through the straight-RGBA readback representation',()=>{
 for(let alpha=1;alpha<256;alpha++)for(let channel=0;channel<=alpha;channel++){
  const encoded=Math.round(channel/alpha*255);
  expect(Math.round(encoded*alpha/255)).toBe(channel);
 }
});
it('anchors a complete, bounded ordered gradient phase to output pixels including negative origins',()=>{
 const values=[];for(let y=0;y<8;y++)for(let x=0;x<8;x++){
  const value=gradientDither(x,y);values.push(value);expect(gradientDither(x-16,y+24)).toBe(value);
 }
 expect(new Set(values).size).toBe(64);
 expect(Math.min(...values)).toBe(-63/128);expect(Math.max(...values)).toBe(63/128);
 expect(values.reduce((a,b)=>a+b,0)).toBe(0);
});

it('uses interval proofs only when the full integrated blend has identical stored RGBA bytes',()=>{
 const coverage=primitiveCoverage(new AffineTransform(2048,0,0,2048,-1500,256),false,.4),rgb=[204,34,68];let accepted=0;
 for(let y=0;y<180;y+=7)for(let x=0;x<320;x+=9){
  const range=coverage.interval(x,y);if(!range)continue;
  const alpha=(x*7+y*11)%256,before=new Uint8ClampedArray([17,94,231,alpha]),fast=before.slice(),full=before.slice(),noise=gradientDither(x,y);
  blendCoveragePixel(full,0,rgb,coverage(x,y),.4,noise);
  if(blendCoverageInterval(fast,0,rgb,range[0],range[1],.4,noise)){accepted++;expect(fast).toEqual(full);}else expect(fast).toEqual(before);
 }
 expect(accepted).toBeGreaterThan(100);
});

it('unit-flow full coverage always stores opaque integer source color despite dither and existing pixels',()=>{
 for(const rgb of [[0,0,0],[255,255,255],[204,34,68],[1,127,254]])for(const alpha of [0,1,64,127,255])for(let y=0;y<8;y++)for(let x=0;x<8;x++){
  const pixels=new Uint8ClampedArray([17,93,208,alpha]);blendCoveragePixel(pixels,0,rgb,1,1,gradientDither(x,y));
  expect([...pixels]).toEqual([...rgb,255]);
 }
});
