import {beforeAll,it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {compileProjectiveField,type ProjectiveFieldOptions} from '../src/core/projective-field';
import {FloatPixelProcessor} from '../src/engine/float-pixels';
import {instantiateKernel} from '../src/engine/wasm';
import {projectPerspectiveFieldWindow,type ProjectiveFieldSource} from '../src/engine/projective-field';
import type {FloatSourceWindow} from '../src/core/float-source/types';

const folder='tests/fixtures/projective-field/',manifest=JSON.parse(await readFile(folder+'manifest.json','utf8'));
let processor:FloatPixelProcessor,input:Float32Array;
beforeAll(async()=>{
  processor=new FloatPixelProcessor(await instantiateKernel(new Uint8Array(await readFile('public/wasm/pixels.wasm'))));
  input=new Float32Array(new Uint8Array(gunzipSync(await readFile(folder+'source.f32le.gz'))).buffer);
});
const sampler={floatProjectiveField:async(alpha:Float32Array,options:ProjectiveFieldOptions)=>processor.projectiveField(alpha,options)};
function source(options:ProjectiveFieldOptions):ProjectiveFieldSource {
  const field=options.field;
  return {width:options.sourceWidth,height:options.sourceHeight,bounds:{...field},background:options.background,readWindow:async b=>{
    const out=new Float32Array(b.width*b.height);
    for(let y=0;y<b.height;y++)out.set(input.subarray((b.y-field.y+y)*field.width+b.x-field.x,(b.y-field.y+y)*field.width+b.x-field.x+b.width),y*b.width);
    return out;
  }};
}
function compare(actual:Float32Array,expected:Float32Array){
  expect(actual.length).toBe(expected.length);let maximum=0;
  for(let i=0;i<actual.length;i++)maximum=Math.max(maximum,Math.abs(actual[i]-expected[i]));
  expect(maximum).toBeLessThanOrEqual(manifest.absoluteError);
}

for(const row of manifest.cases)it(`actual native infinite field matches independent ${row.name} coverage, including partitions`,async()=>{
  const options=row.options as ProjectiveFieldOptions,bounds=options.output,before=input.slice();
  const actual=processor.projectiveField(input,options),expected=new Float32Array(new Uint8Array(gunzipSync(await readFile(folder+row.reference))).buffer);
  compare(actual,expected);expect(input).toEqual(before);
  const projected=await projectPerspectiveFieldWindow(source(options),sampler,options.corners,bounds);
  expect(new Uint32Array(projected.buffer)).toEqual(new Uint32Array(actual.buffer));
  const split=new Float32Array(actual.length);
  for(let y=0;y<bounds.height;y+=7)for(let x=0;x<bounds.width;x+=11){
    const b={x:bounds.x+x,y:bounds.y+y,width:Math.min(11,bounds.width-x),height:Math.min(7,bounds.height-y)};
    const part=await projectPerspectiveFieldWindow(source(options),sampler,options.corners,b);
    for(let row=0;row<b.height;row++)split.set(part.subarray(row*b.width,(row+1)*b.width),(y+row)*bounds.width+x);
  }
  expect(new Uint32Array(split.buffer)).toEqual(new Uint32Array(actual.buffer));
},30000);

const identity={sourceWidth:1,sourceHeight:1,corners:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],
  field:{x:-1,y:-1,width:3,height:3},source:{x:-1,y:-1,width:3,height:3},output:{x:-2,y:-2,width:5,height:5},background:0} as const;

it('a mask extending outside image corners remains present and blends with constant border neighbors',()=>{
  const actual=processor.projectiveField(new Float32Array(9).fill(.5),identity);
  expect([...actual]).toEqual([0,0,0,0,0,0,.5,.5,.5,0,0,.5,.5,.5,0,0,.5,.5,.5,0,0,0,0,0,0]);
  const options={...identity,corners:[{x:.5,y:0},{x:1.5,y:0},{x:1.5,y:1},{x:.5,y:1}] as const,background:1};
  const shifted=processor.projectiveField(new Float32Array(9).fill(.5),options);
  expect([...shifted.subarray(5,10)]).toEqual([1,.75,.5,.5,.75]);
});

it('exact inverse-horizon pixels have constant background while finite support on both sides survives',()=>{
  const row=manifest.cases.find((c:{name:string})=>c.name==='inverse-horizon'),actual=processor.projectiveField(input,row.options);
  const b=row.options.output,horizonRow=7-b.y;
  expect([...actual.subarray(horizonRow*b.width,(horizonRow+1)*b.width)]).toEqual(Array(b.width).fill(1));
  expect(actual.subarray(0,horizonRow*b.width).some(v=>v<.99)).toBe(true);
  expect(actual.subarray((horizonRow+1)*b.width).some(v=>v<.99)).toBe(true);
});

it('a 50 MP reference/support extent minifies with a bounded native neighborhood and no image clipping',async()=>{
  const reads:FloatSourceWindow[]=[],field={x:0,y:0,width:10000,height:5000};
  const actual=await projectPerspectiveFieldWindow({width:10000,height:5000,bounds:field,background:1,
    readWindow:async b=>{reads.push({...b});return new Float32Array(b.width*b.height).fill(.25);}},sampler,
  [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],{x:0,y:0,width:1,height:1});
  expect([...actual]).toEqual([.25]);expect(reads).toHaveLength(1);expect(reads[0].width*reads[0].height).toBeLessThanOrEqual(16);
});

it('sparse footprints split reads while preserving one-pixel native results over a 50 MP support extent',async()=>{
  const reads:FloatSourceWindow[]=[],bounds={x:0,y:0,width:10000,height:5000},corners=[{x:0,y:0},{x:65,y:0},{x:61,y:37},{x:2,y:34}] as const;
  const native=(b:FloatSourceWindow)=>Float32Array.from({length:b.width*b.height},(_,i)=>((b.x+i%b.width)*7+(b.y+Math.floor(i/b.width))*13)%31/30);
  const actual=await projectPerspectiveFieldWindow({width:10000,height:5000,bounds,background:0,readWindow:async b=>{reads.push({...b});return native(b);}},sampler,corners,{x:0,y:0,width:65,height:37});
  expect(reads.length).toBeGreaterThan(1);expect(Math.max(...reads.map(b=>b.width*b.height))).toBeLessThanOrEqual(262144);
  for(const [x,y] of [[1,1],[32,18],[62,35]]){
    const one=await projectPerspectiveFieldWindow({width:10000,height:5000,bounds,background:0,readWindow:async b=>native(b)},sampler,corners,{x,y,width:1,height:1});
    expect(actual[y*65+x]).toBe(one[0]);
  }
},30000);

it('invalid coverage, unknown settings, source omissions and unsupported allocations reject without partial output',()=>{
  expect(()=>processor.projectiveField(new Float32Array(9).fill(NaN),identity)).toThrow(/coverage/);
  expect(()=>processor.projectiveField(new Float32Array(9).fill(1.1),identity)).toThrow(/coverage/);
  expect(()=>processor.projectiveField(new Float32Array(8),identity)).toThrow(/expected length/);
  expect(()=>compileProjectiveField({...identity,unexpected:true} as ProjectiveFieldOptions)).toThrow();
  expect(()=>compileProjectiveField({...identity,source:{x:3,y:0,width:1,height:1}})).toThrow(/outside/);
  expect(()=>compileProjectiveField({...identity,output:{x:0,y:0,width:513,height:512}})).toThrow(/budget/);
  expect(()=>processor.projectiveField(new Float32Array(1),{...identity,source:{x:0,y:0,width:1,height:1}})).toThrow(/captured field/);
});

it('field projection captures caller options and rejects changed sources, cancellation and malformed native replies',async()=>{
  const row=manifest.cases[0],options=structuredClone(row.options) as ProjectiveFieldOptions;
  const pending=projectPerspectiveFieldWindow(source(options),sampler,options.corners,options.output);
  options.output.width=1;options.corners[0].x=500;expect((await pending).length).toBe(row.options.output.width*row.options.output.height);
  const changing=source(row.options),read=changing.readWindow;
  changing.readWindow=async b=>{const alpha=await read(b);changing.bounds.width++;return alpha;};
  await expect(projectPerspectiveFieldWindow(changing,sampler,row.options.corners,row.options.output)).rejects.toThrow(/geometry changed/);
  const abort=new AbortController(),cancelled=source(row.options),original=cancelled.readWindow;
  cancelled.readWindow=async b=>{const alpha=await original(b);abort.abort();return alpha;};
  await expect(projectPerspectiveFieldWindow(cancelled,sampler,row.options.corners,row.options.output,{signal:abort.signal})).rejects.toThrow();
  await expect(projectPerspectiveFieldWindow(source(row.options),{floatProjectiveField:async()=>new Float32Array(0)},row.options.corners,row.options.output)).rejects.toThrow(/expected length/);
  const fresh=processor.projectiveField(input,row.options);expect(fresh.length).toBe(row.options.output.width*row.options.output.height);
});
