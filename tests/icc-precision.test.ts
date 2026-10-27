import{beforeAll,afterAll,it,expect}from'vitest';
import{readFile}from'node:fs/promises';
import{createHash}from'node:crypto';
import{NativeIccEngine}from'../src/core/color/icc-native';
import{iccIntents,type IccSamples,type IccSampleFormat}from'../src/core/color/icc-types';
const directory=new URL('./fixtures/icc-precision/',import.meta.url),profiles=new URL('./fixtures/icc-native/',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('manifest.json',directory),'utf8'))as{cases:{source:string;destination:string;inputFormat:IccSampleFormat;outputFormat:IccSampleFormat;intent:number;blackPointCompensation:boolean;input:string;output:string;pixels:number}[];files:Record<string,{bytes:number;sha256:string}>;profileHashes:Record<string,string>;generatorSha256:string};
const wasm=new Uint8Array(await readFile(new URL('../src/core/color/codec/canoli_icc.wasm',import.meta.url))),profile=async(name:string)=>new Uint8Array(await readFile(new URL(name+'.icc',profiles)));
const samples=(bytes:Uint8Array,format:IccSampleFormat):IccSamples=>{const owned=new Uint8Array(bytes).buffer;return format==='rgba8'?new Uint8ClampedArray(owned):format==='rgba16'?new Uint16Array(owned):new Float32Array(owned);};
let engine:NativeIccEngine;
beforeAll(async()=>{engine=await NativeIccEngine.create(wasm);});afterAll(()=>engine?.dispose());
for(const row of manifest.cases)it(`explicit source ICC ${row.source} -> ${row.destination}, ${row.inputFormat} -> ${row.outputFormat}, intent ${row.intent}, BPC ${row.blackPointCompensation}`,async()=>{
 const input=samples(await readFile(new URL(row.input,directory)),row.inputFormat),original=input.slice(),expected=samples(await readFile(new URL(row.output,directory)),row.outputFormat);
 const prepared=engine.beginRgb(await profile(row.source),await profile(row.destination),{inputFormat:row.inputFormat,outputFormat:row.outputFormat,intent:iccIntents[row.intent],blackPointCompensation:row.blackPointCompensation}),actual=engine.applyWindow(input);
 expect(prepared.source.colorSpace).toBe('RGB ');expect(prepared.destination.colorSpace).toBe('RGB ');expect(actual.constructor).toBe(expected.constructor);expect(actual.length).toBe(row.pixels*4);
 let colorError=0,alphaError=0;for(let i=0;i<actual.length;i++){if(i%4===3)alphaError=Math.max(alphaError,Math.abs(actual[i]-expected[i]));else colorError=Math.max(colorError,Math.abs(actual[i]-expected[i]));}
 expect(alphaError).toBe(0);expect(colorError).toBeLessThanOrEqual(row.outputFormat==='rgba-float32'?2e-6:0);expect(input).toEqual(original);
});
it('genuine integer precision and extended linear float values survive identity conversion',async()=>{
 const srgb=await profile('srgb'),linear=await profile('linear-srgb'),ramp=new Uint16Array(4096*4);for(let i=0;i<4096;i++)ramp.set([i*16,i*16+1,i*16+2,65535-i],i*4);
 engine.beginRgb(srgb,srgb,{inputFormat:'rgba16'});const result=engine.applyWindow(ramp);expect(result).toBeInstanceOf(Uint16Array);expect(result).toEqual(ramp);expect(new Set(result.filter((_,i)=>i%4===0)).size).toBe(4096);
 const report=engine.beginRgb(linear,linear,{inputFormat:'rgba-float32'});report.settings.inputFormat='rgba8';report.settings.outputFormat='rgba16';const input=new Float32Array([-.125,2,.50001,.625,.50002,.50003,8,1]);expect(engine.applyWindow(input)).toEqual(input);
});
it('compiled pipelines, reports and outputs own data across source mutation and reuse',async()=>{
 const source=await profile('display-p3'),destination=await profile('adobe-rgb'),report=engine.beginRgb(source,destination,{inputFormat:'rgba16'}),input=new Uint16Array([12345,34567,56789,54321]),first=engine.applyWindow(input),copy=first.slice();
 source.fill(0);destination.fill(0);first.fill(0);expect(engine.applyWindow(input)).toEqual(copy);expect(report.source.description).toBe('Display P3');expect(report.destination.description).toBe('Adobe RGB (1998)');
 engine.begin(await profile('srgb'),{mode:'convert'});expect(()=>engine.applyWindow(input)).toThrow('Prepare an explicit RGB');expect(engine.apply(new Uint8Array([1,2,3,4]))).toEqual(new Uint8ClampedArray([1,2,3,4]));
});
for(const invalid of [new Float32Array([NaN,0,0,1]),new Float32Array([0,Infinity,0,1]),new Float32Array([0,0,0,-.1]),new Float32Array([0,0,0,1.1]),new Uint16Array(4),new Float32Array(3),new Float32Array(0)])it('invalid float samples/shape/type reject without invalidating a usable compiled transform',async()=>{
 const linear=await profile('linear-srgb');engine.beginRgb(linear,linear,{inputFormat:'rgba-float32'});expect(()=>engine.applyWindow(invalid)).toThrow();expect(engine.applyWindow(new Float32Array([-.25,2,0,1]))).toEqual(new Float32Array([-.25,2,0,1]));
});
it('invalid new settings or non-RGB source/destination never retain previous transforms',async()=>{
 const srgb=await profile('srgb'),cmyk=await profile('synthetic-cmyk');
 for(const[from,to,settings]of[[srgb,srgb,{inputFormat:'rgba32'}],[srgb,srgb,{intent:'unclipped'}],[cmyk,srgb,{}],[srgb,cmyk,{}],[srgb,srgb.slice(0,140),{}]]as const){engine.beginRgb(srgb,srgb);expect(()=>engine.beginRgb(from,to,settings as never)).toThrow();expect(()=>engine.applyWindow(new Uint8ClampedArray(4))).toThrow('Prepare an explicit RGB');expect(()=>engine.apply(new Uint8Array(4))).toThrow('Prepare an ICC');}
});
it('reference windows, complete profiles and independent generator match recorded hashes',async()=>{
 for(const[name,entry]of Object.entries(manifest.files)){const data=await readFile(new URL(name,directory));expect(data.length).toBe(entry.bytes);expect(createHash('sha256').update(data).digest('hex')).toBe(entry.sha256);}
 for(const[name,hash]of Object.entries(manifest.profileHashes))expect(createHash('sha256').update(await profile(name)).digest('hex')).toBe(hash);
 expect(createHash('sha256').update(await readFile(new URL('../scripts/generate-icc-precision-fixtures.py',import.meta.url))).digest('hex')).toBe(manifest.generatorSha256);
});
it('native C ABI independently rejects nonfinite samples and obsolete RGBA8 application of float transforms',async()=>{
 const{default:create}=await import('../src/core/color/codec/canoli_icc.js'),module=await create({wasmBinary:wasm}),linear=await profile('linear-srgb'),p=module._malloc(linear.length),input=module._malloc(16),output=module._malloc(16);
 try{
  module.HEAPU8.set(linear,p);expect(module._canoli_icc_begin_rgb(p,linear.length,p,linear.length,2,2,1,0)).toBe(1);
  new Float32Array(module.HEAPU8.buffer,input,4).set([NaN,0,0,1]);expect(module._canoli_icc_apply_window(input,output,1)).toBe(0);
  new Float32Array(module.HEAPU8.buffer,input,4).set([-.125,2,.50001,.625]);expect(module._canoli_icc_apply_window(input,output,1)).toBe(1);expect([...new Float32Array(module.HEAPU8.buffer,output,4)]).toEqual([...new Float32Array([-.125,2,.50001,.625])]);
  expect(module._canoli_icc_apply(input,output,1)).toBe(0);expect(module._canoli_icc_begin_rgb(p,linear.length,p,linear.length,3,2,1,0)).toBe(0);expect(module._canoli_icc_apply_window(input,output,1)).toBe(0);
 }finally{module._canoli_icc_close();module._free(p);module._free(input);module._free(output);}
});
it('the independent large-image reference retains exact original source and generator identities',async()=>{
 const large=JSON.parse(await readFile(new URL('large-reference.json',directory),'utf8'));expect(large.pixels).toBe(50000000);expect(large.windows*large.windowPixels).toBe(large.pixels);expect(Math.max(...large.inputChannelLevels)).toBeGreaterThan(256);
 expect(createHash('sha256').update(await readFile(new URL('./fixtures/raw/'+large.source,import.meta.url))).digest('hex')).toBe(large.compressedSourceSha256);
 expect(createHash('sha256').update(await readFile(new URL('../scripts/generate-icc-precision-large.py',import.meta.url))).digest('hex')).toBe(large.generatorSha256);
 for(const[name,hash]of Object.entries(large.sourceProfiles))expect(createHash('sha256').update(await profile(name)).digest('hex')).toBe(hash);
});
it('shared high-precision inputs reject without exposing shared or native output storage',async()=>{
 const linear=await profile('linear-srgb');engine.beginRgb(linear,linear,{inputFormat:'rgba-float32'});expect(()=>engine.applyWindow(new Float32Array(new SharedArrayBuffer(16)))).toThrow();
 const all=new Float32Array([9,9,9,9,.125,.50001,2,.625,9,9,9,9]),input=all.subarray(4,8),output=engine.applyWindow(input);expect(output).toEqual(input);expect(output.byteOffset).toBe(0);expect(output.buffer.byteLength).toBe(16);expect(output.buffer).not.toBe(input.buffer);
});
