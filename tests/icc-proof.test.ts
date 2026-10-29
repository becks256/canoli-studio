import{beforeAll,afterAll,it,expect}from'vitest';
import{readFile}from'node:fs/promises';
import{createHash}from'node:crypto';
import{NativeIccEngine}from'../src/core/color/icc-native';
import{iccIntents,type IccSampleFormat,type IccSamples}from'../src/core/color/icc-types';

const directory=new URL('./fixtures/icc-proof/',import.meta.url),profiles=new URL('./fixtures/icc-native/',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('manifest.json',directory),'utf8'))as{
 cases:{source:string;destination:string;device:string;inputFormat:IccSampleFormat;outputFormat:IccSampleFormat;intent:number;proofIntent:number;blackPointCompensation:boolean;gamutWarning:boolean;warningColor:string;input:string;output:string;pixels:number}[];
 files:Record<string,{bytes:number;sha256:string}>;profileHashes:Record<string,string>;generatorSha256:string;directVersusByteProxyDifferentColorChannels:number;
};
const wasm=new Uint8Array(await readFile(new URL('../src/core/color/codec/canoli_icc.wasm',import.meta.url)));
const profile=async(name:string)=>new Uint8Array(await readFile(new URL(name+'.icc',profiles)));
function samples(bytes:Uint8Array,format:IccSampleFormat):IccSamples{
 const owned=new Uint8Array(bytes).buffer;
 return format==='rgba8'?new Uint8ClampedArray(owned):format==='rgba16'?new Uint16Array(owned):new Float32Array(owned);
}
let engine:NativeIccEngine;
beforeAll(async()=>{engine=await NativeIccEngine.create(wasm);});afterAll(()=>engine?.dispose());

for(const row of manifest.cases)it(`explicit native ${row.device} proof ${row.inputFormat} -> ${row.outputFormat}, intent ${row.intent}/${row.proofIntent}, BPC ${row.blackPointCompensation}, gamut ${row.gamutWarning}`,async()=>{
 const input=samples(await readFile(new URL(row.input,directory)),row.inputFormat),before=new Uint8Array(input.buffer).slice(),expected=samples(await readFile(new URL(row.output,directory)),row.outputFormat);
 const prepared=engine.beginProof(await profile(row.source),await profile(row.destination),await profile(row.device),{inputFormat:row.inputFormat,outputFormat:row.outputFormat,intent:iccIntents[row.intent],proofIntent:iccIntents[row.proofIntent],blackPointCompensation:row.blackPointCompensation,gamutWarning:row.gamutWarning,warningColor:row.warningColor});
 const actual=engine.applyWindow(input);expect(actual.constructor).toBe(expected.constructor);expect(actual.length).toBe(row.pixels*4);expect(prepared.proof.colorSpace).toBe(row.device==='synthetic-cmyk'?'CMYK':'RGB ');
 let colorError=0,alphaError=0;
 for(let i=0;i<actual.length;i++)if(i%4===3)alphaError=Math.max(alphaError,Math.abs(actual[i]-expected[i]));else colorError=Math.max(colorError,Math.abs(actual[i]-expected[i]));
 expect(alphaError).toBe(0);expect(colorError).toBeLessThanOrEqual(row.outputFormat==='rgba-float32'?2e-6:0);expect(new Uint8Array(input.buffer)).toEqual(before);
 if(row.inputFormat===row.outputFormat){
  const a=new Uint8Array(actual.buffer),b=new Uint8Array(input.buffer),word=input.BYTES_PER_ELEMENT;
  for(let i=0;i<input.length;i+=4)expect(a.slice((i+3)*word,(i+4)*word)).toEqual(b.slice((i+3)*word,(i+4)*word));
 }
});

it('direct linear-float proofing retains a native precision witness lost by an sRGB8 proof proxy',async()=>{
 const row=manifest.cases.find(r=>r.inputFormat==='rgba-float32'&&r.outputFormat==='rgba8'&&r.device==='narrow-rgb'&&!r.gamutWarning&&!r.blackPointCompensation)!,input=samples(await readFile(new URL(row.input,directory)),row.inputFormat),proxy=await readFile(new URL('quantized-display-proof.bin',directory));
 engine.beginProof(await profile('linear-srgb'),await profile('srgb'),await profile('narrow-rgb'));
 const actual=engine.applyWindow(input);let different=0;for(let i=0;i<actual.length;i++)if(i%4!==3&&actual[i]!==proxy[i])different++;
 expect(different).toBe(manifest.directVersusByteProxyDifferentColorChannels);expect(different).toBeGreaterThan(0);
});

it('proof options and native profiles own their state across returned-report and caller mutation',async()=>{
 const from=await profile('linear-srgb'),to=await profile('srgb'),device=await profile('narrow-rgb'),input=new Float32Array([1,0,0,.625,0,0,1,.5]);
 const prepared=engine.beginProof(from,to,device,{gamutWarning:true,warningColor:'#c731e9'}),first=engine.applyWindow(input),copy=first.slice();
 prepared.settings.inputFormat='rgba8';prepared.settings.outputFormat='rgba16';prepared.settings.gamutWarning=false;prepared.settings.warningColor='#000000';from.fill(0);to.fill(0);device.fill(0);first.fill(0);
 expect(engine.applyWindow(input)).toEqual(copy);expect([...copy.slice(0,3)]).toEqual([199,49,233]);expect(copy[3]).toBe(159);expect(()=>engine.apply(new Uint8Array(4))).toThrow('applyWindow');
});

it('malformed proof requests cannot retain a previous usable native transform',async()=>{
 const from=await profile('linear-srgb'),to=await profile('srgb'),device=await profile('narrow-rgb'),cmyk=await profile('synthetic-cmyk'),invalid=device.slice();invalid.set(new TextEncoder().encode('link'),12);
 const requests=[()=>engine.beginProof(from,to,device,{intent:'unclipped'}as never),()=>engine.beginProof(from,to,device,{mode:'proof'}as never),()=>engine.beginProof(cmyk,to,device),()=>engine.beginProof(from,cmyk,device),()=>engine.beginProof(from,to,invalid),()=>engine.beginProof(from,to,device.slice(0,140))];
 for(const run of requests){engine.beginProof(from,to,device);expect(()=>run()).toThrow();expect(()=>engine.applyWindow(new Float32Array([0,0,0,1]))).toThrow('Prepare');}
});

it('invalid float input rejects without publishing a window or destroying an otherwise usable proof',async()=>{
 engine.beginProof(await profile('linear-srgb'),await profile('srgb'),await profile('synthetic-cmyk'));
 for(const value of[new Float32Array([NaN,0,0,1]),new Float32Array([0,0,0,2]),new Float32Array(new SharedArrayBuffer(16)),new Uint16Array(4),new Float32Array(0)])expect(()=>engine.applyWindow(value)).toThrow();
 expect(engine.applyWindow(new Float32Array([.2,.3,.4,1]))).toHaveLength(4);
});

it('independent proof fixtures and complete profile sources retain their actual generator identities',async()=>{
 for(const[name,entry]of Object.entries(manifest.files)){const bytes=await readFile(new URL(name,directory));expect(bytes.length).toBe(entry.bytes);expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256);}
 for(const[name,digest]of Object.entries(manifest.profileHashes))expect(createHash('sha256').update(await profile(name)).digest('hex')).toBe(digest);
 expect(createHash('sha256').update(await readFile(new URL('../scripts/generate-icc-proof-fixtures.py',import.meta.url))).digest('hex')).toBe(manifest.generatorSha256);
});
