import{expect,it,beforeAll}from'vitest';
import{readFile}from'node:fs/promises';
import{instantiateKernel}from'../src/engine/wasm';
import{FloatPixelProcessor}from'../src/engine/float-pixels';
import{prepareFloatClipping,restoreFloatClipping}from'../src/engine/float-clipping';
import{Document,RasterLayer,LayerGroup,AdjustmentLayer}from'../src/dom';
let processor:FloatPixelProcessor;
beforeAll(async()=>{processor=new FloatPixelProcessor(await instantiateKernel(new Uint8Array(await readFile('public/wasm/pixels.wasm'))));});
it('multiple native members retain one soft intrinsic boundary and signed/HDR color precision',async()=>{
 const base=new Float32Array([2.125,-.25,4.5,.25]),original=base.slice(),clip=await prepareFloatClipping(base,1,()=>{}),a=new Float32Array([-.125,3.75,1.000031,.5]),b=new Float32Array([5.25,-.5,2,.625]);let plane=processor.composite(a,clip.plane);plane=processor.composite(b,plane);const result=await restoreFloatClipping(plane,clip.shape,()=>{});expect(result[3]).toBe(.25);expect([...result.subarray(0,3)]).toEqual([...plane.subarray(0,3)]);expect(base).toEqual(original);expect(result.some(v=>v>1)).toBe(true);expect(new Set(result.subarray(0,3)).size).toBe(3);
});
it('zero base fill hides its color while members can reveal the original clipping shape',async()=>{
 const base=new Float32Array([2,1,3,.375,5,6,7,0]),clip=await prepareFloatClipping(base,0,()=>{});expect([...clip.plane]).toEqual([2,1,3,0,0,0,0,0]);const plane=processor.composite(new Float32Array([.123456,.3,2,.5,1,2,3,1]),clip.plane),output=await restoreFloatClipping(plane,clip.shape,()=>{});expect(output[3]).toBe(.1875);expect(output[0]).toBe(Math.fround(.123456));expect([...output.subarray(4)]).toEqual([0,0,0,0]);
});
it('clipping buffers are independently owned and invalid shape/fill/cancellation cannot mutate inputs',async()=>{
 const source=new Float32Array([1,2,3,.5]),prepared=await prepareFloatClipping(source,.375,()=>{});source.fill(9);expect([...prepared.shape]).toEqual([.5]);expect([...prepared.plane]).toEqual([1,2,3,.375]);const original=prepared.plane.slice();await expect(prepareFloatClipping(original,2,()=>{})).rejects.toThrow('fill');await expect(restoreFloatClipping(original,new Float32Array([NaN]),()=>{})).rejects.toThrow('invalid');await expect(restoreFloatClipping(original,new Float32Array(2),()=>{})).rejects.toThrow('differs');await expect(restoreFloatClipping(original,prepared.shape,()=>{throw new Error('Cancelled clipping');})).rejects.toThrow('Cancelled');expect(prepared.plane).toEqual(original);
});
it('float sibling membership uses shared commands, preserves group boundaries and remains strict and undoable',()=>{
 const doc=new Document({precision:'float32'}),base=doc.layers.add(new RasterLayer({assetId:'a',width:10,height:10})),member=doc.layers.add(new RasterLayer({assetId:'a',width:10,height:10})),before=doc.toJSON();member.clipped=true;const clipped=doc.toJSON();doc.undo();expect(doc.toJSON()).toEqual(before);doc.redo();expect(doc.toJSON()).toEqual(clipped);const group=doc.layers.add(new LayerGroup({blendMode:'pass-through'}));group.layers.add(new AdjustmentLayer({adjustment:{kind:'tone',exposure:0,contrast:20,saturation:-25},clipped:true}));expect(group.layers.at(0)?.clipped).toBe(true);expect(base.clipped).toBe(false);expect(()=>member.update({clipped:'true' as any})).toThrow();
});
it('independent clipping references bind every generator, native source and output byte',async()=>{
 const{createHash}=await import('node:crypto'),{gunzipSync}=await import('node:zlib'),directory='tests/fixtures/float-clipping/',manifest=JSON.parse(await readFile(directory+'manifest.json','utf8')),hash=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');expect(hash(await readFile('scripts/generate-float-clipping-fixtures.py'))).toBe(manifest.generatorSha256);expect(hash(await readFile('scripts/float_clipping_reference.py'))).toBe(manifest.oracleSha256);expect(hash(await readFile(manifest.sourceReference))).toBe(manifest.sourceReferenceSha256);for(const[name,row]of Object.entries(manifest.files)as[string,{bytes:number;sha256:string;rawSha256:string}][]){const data=await readFile(directory+name);expect(data.length).toBe(row.bytes);expect(hash(data)).toBe(row.sha256);expect(hash(gunzipSync(data))).toBe(row.rawSha256);}
});
