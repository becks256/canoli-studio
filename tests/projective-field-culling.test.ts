import {beforeAll,expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {instantiateKernel} from '../src/engine/wasm';
import {FloatPixelProcessor} from '../src/engine/float-pixels';
import {projectPerspectiveFieldWindow,type ProjectiveFieldSource} from '../src/engine/projective-field';
import type {ProjectiveFieldOptions} from '../src/core/projective-field';
import type {ProjectiveQuad} from '../src/core/projective';

let engine:FloatPixelProcessor;
beforeAll(async()=>{engine=new FloatPixelProcessor(await instantiateKernel(new Uint8Array(await readFile('public/wasm/pixels.wasm'))));});
function run(options:ProjectiveFieldOptions,channels:1|5){
 const f=options.field,values=new Float32Array(f.width*f.height*channels),calls={reads:0,samples:0};
 for(let i=0;i<f.width*f.height;i++){
  const alpha=Math.fround((32+(i*37)%192)/255);
  if(channels===1)values[i]=alpha;
  else values.set([alpha*.25,alpha*.5,0,alpha,Math.min(1,alpha+.125)],i*5);
 }
 const source:ProjectiveFieldSource={channels,width:options.sourceWidth,height:options.sourceHeight,bounds:f,background:options.background,direction:options.direction,input:options.input,readWindow:async b=>{
  calls.reads++;const result=new Float32Array(b.width*b.height*channels);for(let y=0;y<b.height;y++){const start=((b.y-f.y+y)*f.width+b.x-f.x)*channels;result.set(values.subarray(start,start+b.width*channels),y*b.width*channels);}return result;
 }};
 const sampler={floatProjectiveField:async(p:Float32Array,o:ProjectiveFieldOptions)=>{calls.samples++;return engine.projectiveField(p,o);},floatProjectiveWet:async(p:Float32Array,o:ProjectiveFieldOptions)=>{calls.samples++;return engine.projectiveWet(p,o);}};
 const expected=channels===5?engine.projectiveWet(values,{...options,source:f}):engine.projectiveField(values,{...options,source:f});
 return{calls,expected,actual:()=>projectPerspectiveFieldWindow(source,sampler,options.corners,options.output)};
}
function exact(actual:Float32Array,expected:Float32Array){
 const a=new Uint32Array(actual.buffer,actual.byteOffset,actual.length),b=new Uint32Array(expected.buffer,expected.byteOffset,expected.length);
 if(a.length!==b.length||!a.every((v,i)=>v===b[i]))throw Error('Conservative field culling changed an actual native float word.');
}
const trace:ProjectiveFieldOptions={sourceWidth:300,sourceHeight:80,corners:[{x:0,y:0},{x:300,y:0},{x:270,y:80},{x:15,y:80}],field:{x:13,y:29,width:6,height:6},background:0,direction:'source-to-quad',input:{origin:{x:258,y:2},matrix:{a:1,b:0,c:0,d:1,e:0,f:0}},source:{x:13,y:29,width:6,height:6},output:{x:0,y:0,width:260,height:260}};
it('the measured filter-mask side window returns exact empty coupled output without native sampling',async()=>{
 const test=run(trace,5),actual=await test.actual();exact(actual,test.expected);expect(actual.every(v=>v===0)).toBe(true);expect(test.calls).toEqual({reads:0,samples:0});
});
it('diagonal scalar footprints preserve the exact infinite background without reading a disjoint finite field',async()=>{
 for(const background of[0,-0,.375,1]){
  const options:ProjectiveFieldOptions={sourceWidth:100,sourceHeight:100,corners:[{x:0,y:0},{x:100,y:100},{x:100,y:200},{x:0,y:100}],direction:'source-to-quad',field:{x:0,y:30,width:3,height:3},source:{x:0,y:30,width:3,height:3},background,output:{x:0,y:0,width:20,height:20}},test=run(options,1),actual=await test.actual();exact(actual,test.expected);expect(actual.every(v=>v===background)).toBe(true);expect(test.calls).toEqual({reads:0,samples:0});
 }
});
it('grazing and degenerate native windows retain every fractional border neighbor',async()=>{
 for(const channels of[1,5]as const)for(const output of[{x:0,y:0,width:20,height:20},{x:0,y:19,width:1,height:1},{x:0,y:15,width:1,height:5},{x:0,y:19,width:5,height:1}]){
  const options:ProjectiveFieldOptions={sourceWidth:100,sourceHeight:100,corners:[{x:0,y:0},{x:100,y:100},{x:100,y:200},{x:0,y:100}],direction:'source-to-quad',field:{x:0,y:20,width:1,height:1},source:{x:0,y:20,width:1,height:1},background:0,output},test=run(options,channels),actual=await test.actual();exact(actual,test.expected);expect(actual.some(v=>v>0)).toBe(true);expect(test.calls.reads).toBeGreaterThan(0);
 }
});
it('bounded streaming agrees with complete actual native fields through both directions, affine inputs, reflection, large origins and subpixel phases',async()=>{
 let compared=0,nonempty=0,empty=0;
 for(let i=0;i<36;i++)for(const direction of['quad-to-source','source-to-quad']as const)for(const channels of[1,5]as const){
  const angle=i*.47,c=Math.cos(angle),s=Math.sin(angle),reflection=i%3===0?-1:1,large=i%9===0,ox=large?2**40:0,oy=large?-(2**41):0;
  const point=(x:number,y:number)=>({x:ox+reflection*c*x-s*y+.2,y:oy+reflection*s*x+c*y-.3});
  const corners=[point(0,0),point(31,0),point(23+(i%5)*2,23),point(4,23)]as ProjectiveQuad;
  const field=direction==='quad-to-source'?{x:3,y:2,width:11,height:9}:{x:ox-5,y:oy+3,width:11,height:9};
  const origin=direction==='source-to-quad'&&i%2?{x:2**39+.125,y:-(2**39)+.375}:{x:0,y:0};
  const output=direction==='quad-to-source'?{x:ox-9+i%7,y:oy-7+i%5,width:17,height:13}:{x:Math.floor(origin.x)-9+i%7,y:Math.floor(origin.y)-7+i%5,width:i%4===0?1:17,height:i%6===0?1:13};
  const options:ProjectiveFieldOptions={sourceWidth:31,sourceHeight:23,corners,field,source:field,output,direction,background:channels===5?0:(i%3)/2,...(direction==='source-to-quad'?{input:{origin,matrix:{a:1,b:.125,c:-.25,d:1,e:.375,f:-.125}}}:{})};
  const test=run(options,channels),actual=await test.actual();exact(actual,test.expected);compared++;
  if(actual.some(v=>v!==options.background))nonempty++;else empty++;
 }
 expect(compared).toBe(144);expect(nonempty).toBeGreaterThan(0);expect(empty).toBeGreaterThan(0);
},30000);
