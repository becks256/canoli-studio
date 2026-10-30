import {beforeAll,expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {FloatPixelProcessor} from '../src/engine/float-pixels';
import {instantiateKernel} from '../src/engine/wasm';
import {featherFloatMask} from '../src/engine/float-mask-feather';
import type {FloatSourceWindow} from '../src/core/float-source/types';

const folder='tests/fixtures/mask-feather/',manifest=JSON.parse(await readFile(folder+'manifest.json','utf8'));
let native:FloatPixelProcessor,source:Float32Array;
beforeAll(async()=>{native=new FloatPixelProcessor(await instantiateKernel(new Uint8Array(await readFile('public/wasm/pixels.wasm'))));source=new Float32Array(new Uint8Array(gunzipSync(await readFile(folder+'source.f32le.gz'))).buffer);});
const processor={floatConvolveAlpha:async(...args:Parameters<FloatPixelProcessor['convolveAlpha']>)=>native.convolveAlpha(...args)};
const read=async(b:FloatSourceWindow)=>{
  const s=manifest.source,out=new Float32Array(b.width*b.height);
  for(let y=0;y<b.height;y++)out.set(source.subarray((b.y-s.y+y)*s.width+b.x-s.x,(b.y-s.y+y)*s.width+b.x-s.x+b.width),y*b.width);
  return out;
};
for(const row of manifest.cases)it(`native document feather ${row.feather} matches independent six-pass float coverage and partitions`,async()=>{
  const bounds=manifest.output,expected=new Float32Array(new Uint8Array(gunzipSync(await readFile(folder+row.reference))).buffer);
  const actual=await featherFloatMask(bounds,row.feather,read,processor,()=>{});let error=0;
  for(let i=0;i<actual.length;i++)error=Math.max(error,Math.abs(actual[i]-expected[i]));expect(error).toBeLessThanOrEqual(manifest.absoluteError);
  const partition=new Float32Array(actual.length);
  for(let y=0;y<bounds.height;y+=43){const part=await featherFloatMask({...bounds,y:bounds.y+y,height:Math.min(43,bounds.height-y)},row.feather,read,processor,()=>{});partition.set(part,y*bounds.width);}
  expect(new Uint32Array(partition.buffer)).toEqual(new Uint32Array(actual.buffer));
},30000);

it('fractional box validation preserves Gaussian defaults and rejects incomplete halos, invalid kernels and radius fields',()=>{
  const alpha=new Float32Array(9).fill(.375);
  expect([...native.convolveAlpha(alpha,{width:9,height:1,kernel:'box',radius:1.25,axis:'horizontal'})]).toEqual(Array(5).fill(.375));
  for(const options of [{width:2,height:1,kernel:'box',radius:1,axis:'horizontal'},{width:9,height:1,kernel:'box',radius:-1,axis:'horizontal'},{width:9,height:1,kernel:'box',radius:129,axis:'horizontal'},{width:9,height:1,kernel:'box',radius:1,sigma:1,axis:'horizontal'},{width:9,height:1,kernel:'bad',sigma:1,axis:'horizontal'}])expect(()=>native.convolveAlpha(alpha,options as any)).toThrow();
});

it('constant masks stay exact, complete halos stay bounded and malformed/cancelled work never publishes coverage',async()=>{
  let maximum=0,calls=0;const untouched={floatConvolveAlpha:async()=>{calls++;throw new Error('Constant halo entered convolution.');}};
  const actual=await featherFloatMask({x:0,y:0,width:512,height:512},128,async b=>{maximum=Math.max(maximum,b.width*b.height);return new Float32Array(b.width*b.height).fill(.375);},untouched,()=>{});
  expect(actual.every(v=>v===.375)).toBe(true);expect(maximum).toBeLessThanOrEqual(262144);expect(calls).toBe(0);
  await expect(featherFloatMask({x:0,y:0,width:1,height:1},2,async b=>{const a=new Float32Array(b.width*b.height);a[0]=NaN;return a;},untouched,()=>{})).rejects.toThrow(/finite/);
  let closed=false;
  await expect(featherFloatMask({x:0,y:0,width:1,height:1},2,async b=>{closed=true;return new Float32Array(b.width*b.height);},untouched,()=>{if(closed)throw new Error('closed mask');})).rejects.toThrow('closed mask');
});
