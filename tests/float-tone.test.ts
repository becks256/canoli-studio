import{it,expect,beforeAll}from'vitest';
import{readFile}from'node:fs/promises';
import{gunzipSync}from'node:zlib';
import{createHash}from'node:crypto';
import{instantiateKernel,type PixelKernel}from'../src/engine/wasm';
import{FloatPixelProcessor}from'../src/engine/float-pixels';
const directory='tests/fixtures/float-tone/',manifest=JSON.parse(await readFile(directory+'manifest.json','utf8'));
async function data(name:string){return new Float32Array(new Uint8Array(gunzipSync(await readFile(directory+name))).buffer);}
let seed:PixelKernel,engine:FloatPixelProcessor,source:Float32Array;
beforeAll(async()=>{seed=await instantiateKernel(new Uint8Array(await readFile('public/wasm/pixels.wasm')));engine=new FloatPixelProcessor(seed);source=await data('source.f32le.gz');});
for(const row of manifest.cases)it('native float tone matches every independent original/HDR/alpha word: '+JSON.stringify(row.options),async()=>{
 const before=new Uint32Array(source.slice().buffer),result=engine.tone(source,row.options),reference=await data(row.reference);expect(new Uint32Array(result.buffer)).toEqual(new Uint32Array(reference.buffer));expect(new Uint32Array(source.buffer)).toEqual(before);for(let i=3;i<result.length;i+=4)expect(Object.is(result[i],source[i])).toBe(true);
});
it('identity tone and exposure-only retain original sample words including subnormals, signed zero and hidden RGB',()=>{
 const result=engine.tone(source);expect(new Uint32Array(result.buffer)).toEqual(new Uint32Array(source.buffer));for(const exposure of[-3,-1,0,1,3]){const gain=2**exposure,reference=engine.affine(source,[gain,0,0,0,0,gain,0,0,0,0,gain,0]),actual=engine.tone(source,{exposure});for(let i=0;i<source.length;i++)if(source[i]!==0)expect(actual[i]).toBe(reference[i]);}
});
it('tone native windows are invariant under partitioning and private owner interleaving',()=>{
 const input=new Float32Array(65539*4);for(let i=0;i<input.length;i++)input[i]=source[i%source.length];const options={exposure:.7,contrast:37,saturation:-43},all=engine.tone(input,options),parts=new Float32Array(all.length),other=new FloatPixelProcessor(seed);other.tone(source,{saturation:-100});other.dispose();for(let at=0;at<input.length;at+=492*4)parts.set(engine.tone(input.subarray(at,Math.min(input.length,at+492*4)),options),at);expect(new Uint32Array(parts.buffer)).toEqual(new Uint32Array(all.buffer));
});
it('invalid parameters, samples and float32 overflow publish no result and a subsequent identity remains exact',()=>{
 const before=source.slice();for(const options of[{exposure:4},{contrast:101},{saturation:-101},{contrast:NaN},{saturation:Infinity},{unexpected:1}])expect(()=>engine.tone(source,options as any)).toThrow();for(const input of[new Float32Array([NaN,0,0,1]),new Float32Array([0,0,0,2])])expect(()=>engine.tone(input)).toThrow('invalid');const huge=new Float32Array([3e38,-3e38,1,1]);expect(()=>engine.tone(huge,{exposure:3})).toThrow('float32');expect(engine.tone(huge)).toEqual(huge);expect(source).toEqual(before);
});
it('independent tone fixtures bind their exact generator and original/reference bytes',async()=>{
 const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');expect(hash(await readFile('scripts/generate-float-tone-fixtures.py'))).toBe(manifest.generatorSha256);for(const[name,row]of Object.entries(manifest.files)as[string,{sha256:string;rawSha256:string;bytes:number}][]){const bytes=await readFile(directory+name);expect(bytes.length).toBe(row.bytes);expect(hash(bytes)).toBe(row.sha256);expect(hash(gunzipSync(bytes))).toBe(row.rawSha256);}
});
