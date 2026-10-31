import {beforeAll,it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {instantiateKernel} from '../src/engine/wasm';
import {FloatPixelProcessor} from '../src/engine/float-pixels';
import {projectPerspectiveFieldWindow,type ProjectiveFieldSource} from '../src/engine/projective-field';
import {validateWetField} from '../src/core/wet-field';
import type {ProjectiveFieldOptions} from '../src/core/projective-field';
const base='tests/fixtures/projected-wet/',manifest=JSON.parse(await readFile(base+'manifest.json','utf8'));
const data=async(name:string)=>new Float32Array(new Uint8Array(gunzipSync(await readFile(base+name))).buffer);
let engine:FloatPixelProcessor,pixels:Float32Array;
beforeAll(async()=>{engine=new FloatPixelProcessor(await instantiateKernel(new Uint8Array(await readFile('public/wasm/pixels.wasm'))));pixels=await data('source.f32le.gz');});
const sampler={floatProjectiveField:async(p:Float32Array,o:ProjectiveFieldOptions)=>engine.projectiveField(p,o),floatProjectiveWet:async(p:Float32Array,o:ProjectiveFieldOptions)=>engine.projectiveWet(p,o)};
for(const row of manifest.cases)it(`coupled actual WASM matches independent ${row.name} replacement and coverage fields`,async()=>{
 const options=row.options as ProjectiveFieldOptions,before=pixels.slice(),expected=await data(row.reference),actual=engine.projectiveWet(pixels,options);
 let maximum=0;for(let i=0;i<actual.length;i++)maximum=Math.max(maximum,Math.abs(actual[i]-expected[i]));expect(maximum).toBeLessThanOrEqual(manifest.absoluteError);validateWetField(actual,options.output.width*options.output.height);expect(pixels).toEqual(before);
 const source:ProjectiveFieldSource={channels:5,width:options.sourceWidth,height:options.sourceHeight,bounds:options.field,background:0,direction:options.direction,input:options.input,readWindow:async b=>{
  const out=new Float32Array(b.width*b.height*5);for(let y=0;y<b.height;y++){const at=((b.y-options.field.y+y)*options.field.width+b.x-options.field.x)*5;out.set(pixels.subarray(at,at+b.width*5),y*b.width*5);}return out;
 }};
 const all=await projectPerspectiveFieldWindow(source,sampler,options.corners,options.output);expect(new Uint32Array(all.buffer)).toEqual(new Uint32Array(actual.buffer));
 const cut=new Float32Array(all.length);for(let y=0;y<options.output.height;y+=7){const h=Math.min(7,options.output.height-y);cut.set(await projectPerspectiveFieldWindow(source,sampler,options.corners,{...options.output,y:options.output.y+y,height:h}),y*options.output.width*5);}expect(new Uint32Array(cut.buffer)).toEqual(new Uint32Array(all.buffer));
});
it('rejects malformed replacement fields and supports a valid native retry without mutating input',()=>{
 const options=manifest.cases[0].options as ProjectiveFieldOptions,before=pixels.slice();for(const [at,value]of[[0,NaN],[0,-.1],[0,2],[3,2],[4,-.1],[4,0]]as const){const broken=pixels.slice();broken[at]=value;expect(()=>engine.projectiveWet(broken,options)).toThrow();}
 expect(()=>engine.projectiveWet(pixels,{...options,background:1})).toThrow();expect(()=>engine.projectiveWet(pixels.subarray(1),options)).toThrow();validateWetField(engine.projectiveWet(pixels,options),options.output.width*options.output.height);expect(pixels).toEqual(before);
});
it('pins independent generator and complete source/reference bytes',async()=>{
 const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');expect(sha(await readFile('scripts/generate-projected-wet-fixtures.py'))).toBe(manifest.generatorSha256);expect(sha(gunzipSync(await readFile(base+'source.f32le.gz')))).toBe(manifest.sourceSha256);for(const row of manifest.cases)expect(sha(gunzipSync(await readFile(base+row.reference)))).toBe(row.floatSha256);
});
