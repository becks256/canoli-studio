import {beforeAll,it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {ProjectiveTransform,type ProjectiveQuad} from '../src/core/projective';
import {compileProjectiveSample} from '../src/core/projective-sampling';
import {FloatPixelProcessor} from '../src/engine/float-pixels';
import {instantiateKernel} from '../src/engine/wasm';
import {projectPerspectiveWindow} from '../src/engine/projective-projection';
import type {FloatSourceWindow} from '../src/core/float-source/types';

const folder='tests/fixtures/projective/',manifest=JSON.parse(await readFile(folder+'manifest.json','utf8'));
let processor:FloatPixelProcessor,input:Float32Array;
beforeAll(async()=>{processor=new FloatPixelProcessor(await instantiateKernel(new Uint8Array(await readFile('public/wasm/pixels.wasm'))));input=new Float32Array(new Uint8Array(gunzipSync(await readFile(folder+'source.f32le.gz'))).buffer);});
const sampler={floatProjective:async(pixels:Float32Array,options:Parameters<FloatPixelProcessor['projective']>[1])=>processor.projective(pixels,options)};
function source(width=31,height=23){return{width,height,readWindow:async(b:FloatSourceWindow)=>{
  const out=new Float32Array(b.width*b.height*4);for(let y=0;y<b.height;y++)out.set(input.subarray(((b.y+y)*width+b.x)*4,((b.y+y)*width+b.x+b.width)*4),y*b.width*4);return out;
}};}
function compare(actual:Float32Array,expected:Float32Array){expect(actual.length).toBe(expected.length);let maximum=0;for(let i=0;i<actual.length;i++)maximum=Math.max(maximum,Math.abs(actual[i]-expected[i])/Math.max(1,Math.abs(expected[i])));expect(maximum).toBeLessThanOrEqual(manifest.colorErrorScale);}

for(const row of manifest.cases)it(`actual native projective sampling matches independent ${row.name} colors and coverage`,async()=>{
  const expected=new Float32Array(new Uint8Array(gunzipSync(await readFile(folder+row.reference))).buffer),before=input.slice();
  const actual=processor.projective(input,{sourceWidth:row.width,sourceHeight:row.height,source:{x:0,y:0,width:row.width,height:row.height},output:row.output,corners:row.corners});compare(actual,expected);expect(input).toEqual(before);
  const projected=await projectPerspectiveWindow(source(),sampler,row.corners,row.output);expect(new Uint32Array(projected.buffer)).toEqual(new Uint32Array(actual.buffer));
  const split=new Float32Array(actual.length);for(let y=0;y<row.output.height;y+=7)for(let x=0;x<row.output.width;x+=11){
    const bounds={x:row.output.x+x,y:row.output.y+y,width:Math.min(11,row.output.width-x),height:Math.min(7,row.output.height-y)},part=await projectPerspectiveWindow(source(),sampler,row.corners,bounds);
    for(let dy=0;dy<bounds.height;dy++)split.set(part.subarray(dy*bounds.width*4,(dy+1)*bounds.width*4),((y+dy)*row.output.width+x)*4);
  }
  expect(new Uint32Array(split.buffer)).toEqual(new Uint32Array(actual.buffer));
},30000);

it('homogeneous geometry retains four corners, reflection, inverse and composition without mutable aliases',()=>{
  const corners=[{x:2,y:3},{x:109,y:7},{x:97,y:83},{x:-8,y:64}] as const,m=ProjectiveTransform.rectangle(100,70,corners),inverse=m.inverse();
  const points=[{x:0,y:0},{x:100,y:0},{x:100,y:70},{x:0,y:70}];for(let i=0;i<4;i++){const actual=m.point(points[i]);expect(actual.x).toBeCloseTo(corners[i].x,11);expect(actual.y).toBeCloseTo(corners[i].y,11);}
  for(let y=0;y<=70;y+=7)for(let x=0;x<=100;x+=10){const p=inverse.point(m.point({x,y}));expect(p.x).toBeCloseTo(x,10);expect(p.y).toBeCloseTo(y,10);}
  const shift=ProjectiveTransform.fromAffine({a:1,b:0,c:0,d:1,e:15,f:-4}),a=shift.multiply(m).point({x:40,y:30}),b=shift.point(m.point({x:40,y:30}));expect(a.x).toBeCloseTo(b.x,11);expect(a.y).toBeCloseTo(b.y,11);
  expect(Object.isFrozen(m)).toBe(true);expect(Object.isFrozen(m.values)).toBe(true);
  const mutable=corners.map(p=>({x:Number(p.x),y:Number(p.y)})),captured=ProjectiveTransform.rectangle(100,70,mutable as unknown as ProjectiveQuad);mutable[0].x=999;expect(captured.point({x:0,y:0})).toEqual(m.point({x:0,y:0}));
});

for(const scale of [1e-300,1e-200,1e-160,1e160,1e200,1e300])it(`uniform ${scale} perspective scale retains a usable inverse without a scale cutoff`,()=>{
  const m=ProjectiveTransform.rectangle(10,10,[{x:0,y:0},{x:scale,y:0},{x:scale,y:scale},{x:0,y:scale}]),point=m.inverse().point({x:scale/2,y:scale/2});
  expect(point.x).toBeCloseTo(5,11);expect(point.y).toBeCloseTo(5,11);
});

it('homogeneous scalar representation preserves the same inverse mapping',()=>{
  const m=ProjectiveTransform.rectangle(100,70,[{x:2,y:3},{x:109,y:7},{x:97,y:83},{x:-8,y:64}]),point=m.point({x:40,y:30});
  for(const scale of [1e-200,1e200]){const inverse=new ProjectiveTransform(m.values.map(v=>v*scale)).inverse(),actual=inverse.point(point);expect(actual.x).toBeCloseTo(40,10);expect(actual.y).toBeCloseTo(30,10);}
});

it('folds, collinear corners, singular maps and image-crossing horizons reject before source reads',async()=>{
  for(const q of [[{x:0,y:0},{x:1,y:1},{x:1,y:0},{x:0,y:1}],[{x:0,y:0},{x:1,y:0},{x:2,y:0},{x:0,y:1}]])expect(()=>ProjectiveTransform.rectangle(100,70,q as unknown as ProjectiveQuad)).toThrow();
  expect(()=>new ProjectiveTransform([1,0,0,0,0,0,0,0,1]).inverse()).toThrow(/singular/);expect(()=>new ProjectiveTransform([1,0,0,0,1,0,.02,0,-1]).quad(100,70)).toThrow(/horizon/);
  let reads=0;await expect(projectPerspectiveWindow({width:100,height:70,readWindow:async()=>{reads++;return new Float32Array(4);}},sampler,[{x:0,y:0},{x:1,y:1},{x:1,y:0},{x:0,y:1}],{x:0,y:0,width:1,height:1})).rejects.toThrow(/convex/);expect(reads).toBe(0);
});

it('native coverage preserves signed colors, alpha, transparent support and owned input/output',()=>{
  const original=new Float32Array([-.5,2,.25,.75]),corners=[{x:.25,y:.5},{x:.75,y:.5},{x:.75,y:1},{x:.25,y:1}] as const;
  const result=processor.projective(original,{sourceWidth:1,sourceHeight:1,source:{x:0,y:0,width:1,height:1},output:{x:0,y:0,width:1,height:1},corners});expect([...result]).toEqual([-.5,2,.25,.1875]);result.fill(9);expect([...original]).toEqual([-.5,2,.25,.75]);
  const hidden=processor.projective(new Float32Array([1,2,-3,0]),{sourceWidth:1,sourceHeight:1,source:{x:0,y:0,width:1,height:1},output:{x:0,y:0,width:1,height:1},corners:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]});expect([...hidden]).toEqual([0,0,0,0]);
});

it('one minified pixel in a synthetic 50 MP extent reads only its native bilinear neighborhood',async()=>{
  const reads:FloatSourceWindow[]=[],width=10000,height=5000,corners=[{x:0,y:0},{x:1,y:0},{x:1,y:.5},{x:0,y:.5}] as const;
  const result=await projectPerspectiveWindow({width,height,readWindow:async b=>{reads.push(b);return new Float32Array(b.width*b.height*4).map((_,i)=>i%4===3?1:i%4===0?2:i%4===1?-1:.25);}},sampler,corners,{x:0,y:0,width:1,height:1});
  expect([...result]).toEqual([2,-1,.25,.5]);expect(reads).toHaveLength(1);expect(reads[0].width*reads[0].height).toBeLessThanOrEqual(16);
});

it('projection captures geometry before awaits and cancelled or malformed native work publishes no result',async()=>{
  const corners=[{x:0,y:0},{x:31,y:0},{x:31,y:23},{x:0,y:23}] as const,bounds={x:0,y:0,width:5,height:4},mutable=corners.map(p=>({x:Number(p.x),y:Number(p.y)})),pending=projectPerspectiveWindow(source(),sampler,mutable as unknown as ProjectiveQuad,bounds);bounds.width=1;mutable[0].x=900;expect((await pending).length).toBe(80);
  const abort=new AbortController();await expect(projectPerspectiveWindow({width:31,height:23,readWindow:async b=>{abort.abort();return new Float32Array(b.width*b.height*4);}},sampler,corners,{x:0,y:0,width:1,height:1},{signal:abort.signal})).rejects.toThrow();
  await expect(projectPerspectiveWindow(source(),{floatProjective:async()=>new Float32Array(1)},corners,{x:0,y:0,width:1,height:1})).rejects.toThrow();
  expect(()=>compileProjectiveSample({sourceWidth:31,sourceHeight:23,source:{x:30,y:0,width:2,height:1},output:{x:0,y:0,width:1,height:1},corners})).toThrow(/outside/);
  expect(()=>processor.projective(new Float32Array([NaN,0,0,1]),{sourceWidth:1,sourceHeight:1,source:{x:0,y:0,width:1,height:1},output:{x:0,y:0,width:1,height:1},corners})).toThrow(/invalid/);
});
