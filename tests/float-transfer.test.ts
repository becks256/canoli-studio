import{it,expect,beforeAll}from'vitest';
import{readFile}from'node:fs/promises';
import{gunzipSync}from'node:zlib';
import{createHash}from'node:crypto';
import{instantiateKernel,type PixelKernel}from'../src/engine/wasm';
import{FloatPixelProcessor}from'../src/engine/float-pixels';
import{compileFloatTransfer}from'../src/core/float-transfer';
import{computeFloatHistogram}from'../src/core/histogram';
import{Document,RasterLayer,AdjustmentLayer}from'../src/dom';
import{defaultLevelChannel}from'../src/core/adjustments';
const directory='tests/fixtures/float-transfer/',manifest=JSON.parse(await readFile(directory+'manifest.json','utf8'));
let processor:FloatPixelProcessor,seed:PixelKernel;
beforeAll(async()=>{seed=await instantiateKernel(new Uint8Array(await readFile('public/wasm/pixels.wasm')));processor=new FloatPixelProcessor(seed);});
const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const floats=(raw:Uint8Array)=>new Float32Array(new Uint8Array(raw).buffer);
for(const row of manifest.cases)it('actual WASM transfer matches every independent native word and partition: '+row.name,async()=>{
 const input=floats(gunzipSync(await readFile(directory+'source.f32le.gz'))),original=hash(new Uint8Array(input.buffer)),expected=floats(gunzipSync(await readFile(directory+row.reference))),actual=processor.transfer(input,row.adjustment);let different=0,maximum=0;for(let i=0;i<actual.length;i++){if(actual[i]!==expected[i])different++;maximum=Math.max(maximum,Math.abs(actual[i]-expected[i]));}expect({different,maximum}).toEqual({different:0,maximum:0});expect(hash(new Uint8Array(actual.buffer))).toBe(row.rawSha256);const cut=1234*4,parts=new Float32Array(input.length);parts.set(processor.transfer(input.subarray(0,cut),row.adjustment));parts.set(processor.transfer(input.subarray(cut),row.adjustment),cut);expect(hash(new Uint8Array(parts.buffer))).toBe(row.rawSha256);expect(hash(new Uint8Array(input.buffer))).toBe(original);
});
it('identity transfer preserves signed/HDR hidden colors; malformed knots, invalid alpha, overflow and disposed work reject',()=>{
 const input=new Float32Array([-.125,3.5,1e-35,.5]),identity={kind:'curves' as const,rgb:[{x:0,y:0},{x:255,y:255}]};expect(processor.transfer(input,identity)).toEqual(input);const signed=new Float32Array([-0,3.5,-1e-40,-0]);expect(new Uint32Array(processor.transfer(signed,identity).buffer)).toEqual(new Uint32Array(signed.buffer));expect(()=>processor.transfer(new Float32Array([1,2,3,2]),identity)).toThrow('invalid');expect(()=>compileFloatTransfer({kind:'curves',rgb:[{x:20,y:1},{x:20,y:2}]})).toThrow();expect(()=>processor.transfer(new Float32Array([3e38,1,2,1]),{kind:'curves',rgb:[{x:0,y:0},{x:1,y:255}]})).toThrow('finite');expect(()=>compileFloatTransfer({kind:'levels',rgb:{...defaultLevelChannel(),gamma:0}})).toThrow();expect(processor.transfer(input,identity)).toEqual(input);const other=new FloatPixelProcessor(seed);other.dispose();expect(()=>other.transfer(input,identity)).toThrow('disposed');
});
it('float adjustments share strict atomic commands, lock behavior and exact Undo',()=>{
 const document=new Document({precision:'float32'});document.layers.add(new RasterLayer({assetId:'original',width:10,height:10}));const before=document.toJSON();document.transaction('Linear transfers',()=>{document.layers.add(new AdjustmentLayer({adjustment:{kind:'curves',rgb:[{x:0,y:16},{x:255,y:240}]}}));document.layers.add(new AdjustmentLayer({adjustment:{kind:'levels',rgb:{...defaultLevelChannel(),gamma:1.2}}}));});const after=document.toJSON();document.undo();expect(document.toJSON()).toEqual(before);document.redo();expect(document.toJSON()).toEqual(after);const selected=document.layers.at(2)!;selected.locked=true;expect(()=>selected.update({adjustment:{kind:'levels',rgb:defaultLevelChannel()}}as any)).toThrow();const current=document.toJSON();expect(()=>document.transaction('Invalid precision curve',()=>{document.layers.at(0)!.opacity=.5;document.layers.add(new AdjustmentLayer({adjustment:{kind:'curves',rgb:[{x:0,y:0},{x:Number.MIN_VALUE,y:255}]}}));})).toThrow('precision');expect(document.toJSON()).toEqual(current);
});
it('working-linear histogram counts extended RGB, excludes only zero alpha and never bins encoded preview colors',()=>{
 const result=computeFloatHistogram(new Float32Array([.5,.5,.5,1,-1,2,.25,1e-35,9,9,9,0]));expect(result).toMatchObject({encoding:'linear-srgb',belowRange:1,aboveRange:1,totalPixels:2});expect(result.red[128]).toBe(1);expect(result.red[0]).toBe(1);expect(result.green[255]).toBe(1);expect(()=>computeFloatHistogram(new Float32Array([NaN,0,0,1]))).toThrow('Invalid');
});
it('independent reference files bind every generator, oracle and complete native word stream',async()=>{
 const base='tests/fixtures/float-transfer/',m=JSON.parse(await readFile(base+'manifest.json','utf8'));expect(hash(await readFile('scripts/generate-float-transfer-fixtures.py'))).toBe(m.generatorSha256);expect(hash(await readFile('scripts/float_transfer_reference.py'))).toBe(m.oracleSha256);expect(hash(await readFile(m.sceneSource.path))).toBe(m.sceneSource.sha256);expect(hash(await readFile('scripts/float_clipping_reference.py'))).toBe(m.sceneOracleSha256);expect(hash(await readFile(base+'histogram.json'))).toBe(m.histogramSha256);for(const[name,row]of Object.entries(m.files)as[string,{sha256:string;rawSha256:string;bytes:number}][]){const data=await readFile(base+name);expect(data.length).toBe(row.bytes);expect(hash(data)).toBe(row.sha256);expect(hash(gunzipSync(data))).toBe(row.rawSha256);}
});
