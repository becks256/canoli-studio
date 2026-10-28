import{beforeAll,it,expect}from'vitest';
import{readFile}from'node:fs/promises';
import{gunzipSync}from'node:zlib';
import{instantiateKernel}from'../src/engine/wasm';
import{FloatPixelProcessor}from'../src/engine/float-pixels';
import{blendFloatAdjustment}from'../src/engine/float-adjustment-blend';
import{BLEND_MODES}from'../src/core/model';
let native:FloatPixelProcessor;
beforeAll(async()=>{native=new FloatPixelProcessor(await instantiateKernel(new Uint8Array(await readFile('public/wasm/pixels.wasm'))));});
for(const mode of BLEND_MODES)it('float adjustment '+mode+' preserves backdrop alpha and independently referenced masked colors',async()=>{
 const root='tests/fixtures/float-blend/',m=JSON.parse(await readFile(root+'manifest.json','utf8')),row=m.cases.find((x:any)=>x.mode===mode&&x.context==='adjustment');
 const source=new Float32Array(new Uint8Array(gunzipSync(await readFile('tests/fixtures/uint16-float/u16-all-levels-linear.f32le.gz'))).buffer),before=new Float32Array(131*79*4),mask=new Float32Array(131*79);
 for(let y=0;y<79;y++)for(let x=0;x<131;x++){const at=(y*131+x)*4;before.set(source.subarray((y*256+x)*4,(y*256+x)*4+4),at);const covered=x>=15&&x<105&&y>=10&&y<65;before[at+3]=Math.fround(.625*(covered?1:Math.fround(128/255)));mask[y*131+x]=x>=5&&x<105&&y>=15&&y<65?1:Math.fround(128/255);}
 const original=before.slice(),after=native.tone(before,{exposure:-.5,contrast:-20,saturation:-25}),actual=await blendFloatAdjustment(before,after,mode,.75*.625,mask,{floatComposite:async(s,b,o)=>native.composite(s,b,o)},()=>{}),expected=new Float32Array(new Uint8Array(gunzipSync(await readFile(root+row.reference))).buffer);let color=0;
 for(let i=0;i<actual.length;i++){if(i%4===3){expect(actual[i]).toBe(before[i]);expect(actual[i]).toBe(expected[i]);}else color=Math.max(color,Math.abs(actual[i]-expected[i]));}expect(color).toBeLessThanOrEqual(m.colorTolerance);expect(before).toEqual(original);
});
it('adjustment blending rejects alpha-changing, malformed, cancelled and out-of-domain results without publishing partial output',async()=>{
 const before=new Float32Array([.125,.25,.5,.375]),after=new Float32Array([.25,.5,.75,.375]),processor={floatComposite:async(s:Float32Array,b:Float32Array,o:any)=>native.composite(s,b,o)};
 await expect(blendFloatAdjustment(before,new Float32Array([.25,.5,.75,.5]),'screen',1,undefined,processor,()=>{})).rejects.toThrow('preserve backdrop alpha');
 await expect(blendFloatAdjustment(before,after,'screen',1,undefined,{floatComposite:async()=>new Float32Array(0)},()=>{})).rejects.toThrow('geometry');
 await expect(blendFloatAdjustment(before,after,'screen',1,undefined,{floatComposite:async()=>new Float32Array([0,0,0,.5])},()=>{})).rejects.toThrow('opaque');
 await expect(blendFloatAdjustment(before,after,'screen',1,undefined,processor,()=>{throw Error('Cancelled adjustment');})).rejects.toThrow('Cancelled');
 await expect(blendFloatAdjustment(before,new Float32Array([1.5,.5,.75,.375]),'screen',1,undefined,processor,()=>{})).rejects.toThrow('normalized');expect([...before]).toEqual([.125,.25,.5,.375]);
});
it('independent float blend fixtures retain complete original, reference and oracle fingerprints',async()=>{
 const{createHash}=await import('node:crypto'),root='tests/fixtures/float-blend/',m=JSON.parse(await readFile(root+'manifest.json','utf8')),sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');expect(m.modes).toEqual([...BLEND_MODES]);expect(m.cases).toHaveLength(108);for(const[path,hash]of Object.entries(m.inputs))expect(sha(await readFile(path))).toBe(hash);for(const[name,entry]of Object.entries(m.files)as[string,{bytes:number;sha256:string;rawSha256:string}][]){const data=await readFile(root+name);expect(data.length).toBe(entry.bytes);expect(sha(data)).toBe(entry.sha256);expect(sha(gunzipSync(data))).toBe(entry.rawSha256);}
});
