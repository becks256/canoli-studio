import {expect,it} from 'vitest';
import {AffineTransform} from '../src/core/affine';
import {primitiveCoverage} from '../src/engine/primitive-coverage';

it('integrates a subpixel rectangle exactly rather than losing a thin tip between samples',()=>{
 const coverage=primitiveCoverage(new AffineTransform(.002,0,0,.4,.513,.5),true,1);
 expect(coverage(0,0)).toBeCloseTo(.004*.8,12);
 expect(coverage(1,0)).toBe(0);
});
for(const hardness of [0,.4,1])it(`preserves the analytic total alpha area of affine disks with hardness ${hardness}`,()=>{
 for(const frame of [new AffineTransform(4,0,0,2,8.23,9.37),new AffineTransform(3,2,-.4,1.8,8.23,9.37),new AffineTransform(.002,0,.3,4,8.23,9.37)]){
  const coverage=primitiveCoverage(frame,false,hardness);let area=0;
  for(let y=0;y<20;y++)for(let x=0;x<20;x++)area+=coverage(x,y);
  const expected=Math.PI*Math.abs(frame.a*frame.d-frame.b*frame.c)*(1+hardness+hardness*hardness)/3;
  expect(Math.abs(area-expected)).toBeLessThan(2e-4);
 }
});
it('preserves transformed rectangle area and mirrors without phase-dependent clipping',()=>{
 for(const frame of [new AffineTransform(3,2,-.4,1.8,8.23,9.37),new AffineTransform(-3,2,.4,1.8,8.23,9.37)]){
  const coverage=primitiveCoverage(frame,true,1);let area=0;
  for(let y=0;y<20;y++)for(let x=0;x<20;x++)area+=coverage(x,y);
  expect(area).toBeCloseTo(4*Math.abs(frame.a*frame.d-frame.b*frame.c),10);
 }
});
it('retains exact full/empty pixels and fractional coverage at very large footprints',()=>{
 const coverage=primitiveCoverage(new AffineTransform(1e12,0,0,1e12,-1e12+.25,.5),false,1);
 expect(coverage(0,0)).toBeCloseTo(.25,3);
 expect(coverage(-1,0)).toBe(1);
 expect(coverage(1,0)).toBe(0);
});

it('computes identical coverage when integer crops rebase the same output pixel',()=>{
 for(const pencil of [false,true])for(const hardness of [0,.4,1]){
  const frame=new AffineTransform(17.5,4.25,-3.5,9.75,256.25,128.5);
  const full=primitiveCoverage(frame,pencil,hardness),crop=primitiveCoverage(new AffineTransform(frame.a,frame.b,frame.c,frame.d,frame.e-254,frame.f-62),pencil,hardness);
  for(let y=114;y<144;y++)for(let x=234;x<279;x++)expect(crop(x-254,y-62)).toBe(full(x,y));
 }
});

it('preserves area for subpixel soft disks without a sampling-grid minimum thickness',()=>{
 for(const hardness of [0,.4,1]){
  const coverage=primitiveCoverage(new AffineTransform(.000002,0,0,.4,.513,.5),false,hardness);
  const expected=Math.PI*.000002*.4*(1+hardness+hardness*hardness)/3;
  expect(coverage(0,0)).toBeCloseTo(expected,8);
  expect(coverage(1,0)).toBe(0);
 }
});

it('rejects singular transforms instead of silently erasing their coverage',()=>{
 expect(()=>primitiveCoverage(new AffineTransform(0,0,0,0),false,1)).toThrow(/singular/);
 expect(()=>primitiveCoverage(new AffineTransform(1,2,2,4),true,1)).toThrow(/singular/);
});

it('bounds the full soft-pixel integral using the actual affine pixel variance',()=>{
 for(const frame of [new AffineTransform(2048,0,0,2048,-1500,256),new AffineTransform(2048,128,-64,1800,-1200,64)]){
  const coverage=primitiveCoverage(frame,false,.4);let bounded=0;
  for(let y=0;y<180;y+=11)for(let x=0;x<320;x+=13){
   const range=coverage.interval(x,y);if(!range)continue;bounded++;
   const actual=coverage(x,y);expect(actual).toBeGreaterThanOrEqual(range[0]-1e-12);expect(actual).toBeLessThanOrEqual(range[1]+1e-12);
  }
  expect(bounded).toBeGreaterThan(100);
 }
});

it('certified solid spans contain every pixel corner in affine disks, soft cores and rectangles',()=>{
 const frames=[new AffineTransform(12,3,-4,9,16,16),new AffineTransform(-10,4,3,15,14.25,16.5),new AffineTransform(2048,0,0,2048,-1500,256)];
 let certified=0;
 for(const frame of frames)for(const pencil of [false,true])for(const hardness of [.4,1]){
  const sample=primitiveCoverage(frame,pencil,hardness),inverse=frame.inverse();
  for(let y=0;y<32;y++){
   const span=sample.solidSpan(y,0,40);if(!span)continue;
   expect(Number.isInteger(span[0])&&Number.isInteger(span[1])&&span[0]>=0&&span[1]<=40&&span[0]<span[1]).toBe(true);
   for(let x=span[0];x<span[1];x++){
    certified++;
    for(const dx of [0,1])for(const dy of [0,1]){
     const p=inverse.point({x:x+dx,y:y+dy});
     expect(pencil?Math.max(Math.abs(p.x),Math.abs(p.y)):Math.hypot(p.x,p.y)).toBeLessThanOrEqual(pencil||hardness>=.999?1:hardness);
    }
    expect(sample(x,y)).toBeCloseTo(1,12);
   }
  }
 }
 expect(certified).toBeGreaterThan(1000);
});

it('canonical lattice indices recover inverse-scaled integral crop positions at fractional zoom',async()=>{
 const {projectedPixelOrigin,canonicalCellOffset}=await import('../src/engine/canvas');
 for(const scale of [.1,.29,.37,.83,1.1,1.3,Math.PI/4])for(const pixel of [-10001,-510,-254,-2,0,62,254,510,9999,100001]){
  const origin=pixel/scale;
  expect(projectedPixelOrigin(origin,scale)).toBe(pixel);
  expect(canonicalCellOffset(origin,scale,256)).toBe(-((pixel%256+256)%256));
 }
});

it('lattice index normalization preserves genuinely fractional authored origins, including large coordinates',async()=>{
 const {projectedPixelOrigin,canonicalCellOffset}=await import('../src/engine/canvas');
 for(const origin of [.125,.25,255.875,256.125,1e15+.125,1e15-.125]){
  expect(projectedPixelOrigin(origin,1)).toBe(origin);
  const remainder=origin%256;
  expect(canonicalCellOffset(origin,1,256)).toBe(-Math.floor(remainder<0?remainder+256:remainder));
 }
});
