import{beforeAll,expect,it,vi}from'vitest';
import{readFile}from'node:fs/promises';
import{createHash}from'node:crypto';
import{gunzipSync}from'node:zlib';
import{FloatPixelProcessor}from'../src/engine/float-pixels';
import{FloatLookupProcessor}from'../src/engine/float-lookup';
import{instantiateKernel,type PixelKernel}from'../src/engine/wasm';
import{Document,RasterLayer,AdjustmentLayer,PaintLayer}from'../src/dom';
import{defaultLutAdjustment}from'../src/core/lut';
const directory='tests/fixtures/float-palette/',manifest=JSON.parse(await readFile(directory+'manifest.json','utf8'));
const floats=(data:Uint8Array)=>new Float32Array(new Uint8Array(data).buffer),words=(data:Float32Array)=>new Uint32Array(data.buffer,data.byteOffset,data.length),sha=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');
let kernel:PixelKernel,gradient:FloatPixelProcessor;
beforeAll(async()=>{kernel=await instantiateKernel(new Uint8Array(await readFile('public/wasm/pixels.wasm')));gradient=new FloatPixelProcessor(kernel);});
for(const[index,row]of manifest.cases.entries())it('native continuous '+row.adjustment.kind+' '+index+' matches independent colors, exact alpha, source ownership and partitions',async()=>{
 const input=floats(gunzipSync(await readFile(directory+'source.f32le.gz'))),before=input.slice(),expected=floats(gunzipSync(await readFile(directory+row.reference))),owner=new FloatLookupProcessor(kernel),handle=row.adjustment.kind==='lut'?owner.prepare(row.adjustment):0;
 try{const apply=(pixels:Float32Array)=>handle?owner.apply(handle,pixels):gradient.gradient(pixels,row.adjustment),actual=apply(input);let maximum=0;for(let at=0;at<actual.length;at+=4){const scale=Math.max(1,...expected.subarray(at,at+3).map(Math.abs));for(let c=0;c<3;c++){expect(Number.isFinite(actual[at+c])).toBe(true);maximum=Math.max(maximum,Math.abs(actual[at+c]-expected[at+c])/scale);}expect(words(actual)[at+3]).toBe(words(input)[at+3]);}expect(maximum).toBeLessThanOrEqual(manifest.colorTolerance);expect(words(input)).toEqual(words(before));const split=1234*4,parts=new Float32Array(input.length);parts.set(apply(input.subarray(0,split)));parts.set(apply(input.subarray(split)),split);expect(words(parts)).toEqual(words(actual));if(row.adjustment.kind==='lut'&&row.adjustment.amount===0)expect(words(actual)).toEqual(words(input));if(index===2||index===12||index===18)expect(new Set(actual.filter((_,i)=>i%4===0)).size).toBeGreaterThan(256);
 }finally{if(handle)owner.release(handle);owner.dispose();}
});
it('captured lookup handles own controls, coexist across native cache changes, release idempotently and recover after errors',()=>{
 const owner=new FloatLookupProcessor(kernel),a=structuredClone(manifest.cases[12].adjustment),b=structuredClone(manifest.cases[18].adjustment),pixels=new Float32Array([-.25,.125,1.25,.375]);
 try{const first=owner.prepare(a),expected=owner.apply(first,pixels),second=owner.prepare(b),other=owner.apply(second,pixels);a.amount=0;a.lut.domainMin[0]=100;a.lut.data='';b.lut.data='';gradient.gradient(pixels,manifest.cases[2].adjustment);expect(words(owner.apply(first,pixels))).toEqual(words(expected));expect(words(owner.apply(second,pixels))).toEqual(words(other));owner.release(first);owner.release(first);expect(()=>owner.apply(first,pixels)).toThrow(/released/);expect(words(owner.apply(second,pixels))).toEqual(words(other));expect(()=>owner.apply(0,pixels)).toThrow();expect(()=>owner.release(NaN)).toThrow();for(const input of[new Float32Array([NaN,0,0,1]),new Float32Array([0,0,0,2])])expect(()=>owner.apply(second,input)).toThrow('invalid');expect(words(owner.apply(second,pixels))).toEqual(words(other));owner.release(second);}finally{owner.dispose();}expect(()=>owner.prepare(manifest.cases[12].adjustment)).toThrow('disposed');
});
it('exact identity tables preserve in-domain words while declared endpoints still map extended inputs',()=>{
 const owner=new FloatLookupProcessor(kernel),input=new Float32Array([-0.,2**-149,.25,-0.,-2,1.5,.5,.375]),settings=defaultLutAdjustment(),handle=owner.prepare(settings);
 try{const actual=owner.apply(handle,input);expect(words(actual).subarray(0,4)).toEqual(words(input).subarray(0,4));expect([...actual.subarray(4)]).toEqual([0,1,.5,.375]);const extended=structuredClone(manifest.cases[28].adjustment);extended.amount=100;const h=owner.prepare(extended),pixel=new Float32Array([-.25,.25,2,.625]);expect(words(owner.apply(h,pixel))).toEqual(words(pixel));}finally{owner.dispose();}
});
it('full-strength domain endpoints and every cube corner survive extreme unused finite values',()=>{
 const owner=new FloatLookupProcessor(kernel),base=defaultLutAdjustment(),mapped=[.25,.5,.75],expected=mapped.map(v=>Math.fround(((v+.055)/1.055)**2.4));
 try{
  const identity=owner.prepare(base);expect([...owner.apply(identity,new Float32Array([3e38,3e38,3e38,.375,-3e38,-3e38,-3e38,.625]))]).toEqual([1,1,1,.375,0,0,0,.625]);
  for(const dimension of[1,3]as const)for(let corner=0;corner<(dimension===1?2:8);corner++)for(const interpolation of['tetrahedral','trilinear']as const){
   const data=new Float32Array(3*(dimension===1?2:8));data.fill(-3e38);data.set(mapped,corner*3);
   const h=owner.prepare({...base,interpolation,lut:{...base.lut,dimension,size:2,data:Buffer.from(data.buffer).toString('base64')}}),pixel=new Float32Array(dimension===1?[corner,corner,corner,.375]:[corner&1,(corner>>1)&1,(corner>>2)&1,.375]);
   expect([...owner.apply(h,pixel)]).toEqual([...expected,.375]);owner.release(h);
  }
 }finally{owner.dispose();}
});
it('all finite table values validate before publication, output overflow rejects and zero amount recovers exact extended source',()=>{
 const owner=new FloatLookupProcessor(kernel),settings=defaultLutAdjustment(),raw=Buffer.from(settings.lut.data,'base64');raw.writeFloatLE(NaN,raw.length-4);expect(()=>owner.prepare({...settings,lut:{...settings.lut,data:raw.toString('base64')}})).toThrow('finite');
 const huge=Buffer.alloc(24);for(let at=0;at<24;at+=4)huge.writeFloatLE(3e38,at);const spec={...settings,lut:{...settings.lut,data:huge.toString('base64')}},pixels=new Float32Array([-0.,3e38,-2,.5]),h=owner.prepare(spec);try{expect(()=>owner.apply(h,new Float32Array([.1,.2,.3,1]))).toThrow('finite float32');const zero=owner.prepare({...spec,amount:0});expect(words(owner.apply(zero,pixels))).toEqual(words(pixels));}finally{owner.dispose();}
});
it('native palette windows retain all samples through memory growth and awkward partitions',()=>{
 const owner=new FloatLookupProcessor(kernel),settings=manifest.cases[18].adjustment,h=owner.prepare(settings),source=new Float32Array(131075*4);for(let i=0;i<source.length;i++)source[i]=i%4===3?.375:Math.fround(((i*73)%65536)/65535);try{const all=owner.apply(h,source),parts=new Float32Array(source.length);for(let at=0;at<source.length;at+=491*4)parts.set(owner.apply(h,source.subarray(at,Math.min(source.length,at+491*4))),at);expect(words(parts)).toEqual(words(all));}finally{owner.dispose();}
});
it('the existing format maxima execute natively and captured smaller lookups survive large-table reuse and release',()=>{
 const owner=new FloatLookupProcessor(kernel),base=defaultLutAdjustment(),pixels=new Float32Array([0,.5,1,.375,-.5,2,3,0]);
 try{const smallBytes=Buffer.alloc(3*65536*4),small=owner.prepare({...base,lut:{...base.lut,dimension:1,size:65536,data:smallBytes.toString('base64')}});expect([...owner.apply(small,pixels)]).toEqual([0,0,0,.375,0,0,0,0]);const bigBytes=Buffer.alloc(3*256**3*4);new Float32Array(bigBytes.buffer,bigBytes.byteOffset,bigBytes.byteLength/4).fill(.5);const big=owner.prepare({...base,lut:{...base.lut,dimension:3,size:256,data:bigBytes.toString('base64')}}),half=Math.fround(((.5+.055)/1.055)**2.4);expect([...owner.apply(big,pixels)]).toEqual([half,half,half,.375,half,half,half,0]);const decoded=vi.spyOn(globalThis,'atob');try{expect([...owner.apply(small,pixels)]).toEqual([0,0,0,.375,0,0,0,0]);expect([...owner.apply(big,pixels)]).toEqual([half,half,half,.375,half,half,half,0]);expect(decoded.mock.calls.length).toBe(0);}finally{decoded.mockRestore();}owner.release(big);expect([...owner.apply(small,pixels)]).toEqual([0,0,0,.375,0,0,0,0]);owner.release(small);}finally{owner.dispose();}
},60000);
it('float palette kinds share strict OO conversion, atomic rejection, locks, portable model and exact Undo',()=>{
 const doc=new Document(),raster=doc.layers.add(new RasterLayer({assetId:'native',width:10,height:10}));for(const index of[2,12,18])doc.layers.add(new AdjustmentLayer({adjustment:manifest.cases[index].adjustment}));const before=doc.toJSON();doc.convertToFloat();const converted=doc.toJSON();expect(Document.fromJSON(converted).toJSON()).toEqual(converted);doc.undo();expect(doc.toJSON()).toEqual(before);doc.redo();expect(doc.toJSON()).toEqual(converted);expect(()=>doc.transaction('Rejected palette',()=>{raster.opacity=.5;doc.layers.add(new PaintLayer());})).toThrow();expect(doc.toJSON()).toEqual(converted);const layer=doc.layers.at(1)!;layer.locked=true;expect(()=>layer.update({opacity:.5})).toThrow(/lock/i);
});
it('independent fixtures bind their methods, source bytes, unchanged bounds and every complete expected stream',async()=>{
 expect(manifest.cases).toHaveLength(40);expect(manifest.scenes).toHaveLength(192);expect(manifest.colorTolerance).toBe(2**-22);expect(manifest.integerColorTolerance).toBe(1);expect(manifest.alphaTolerance).toBe(0);expect(manifest.independentEnvironment.colour).toBe('0.4.6');for(const[path,h]of Object.entries(manifest.inputs))expect(sha(await readFile(path))).toBe(h);for(const[name,row]of Object.entries(manifest.files)as[string,any][]){const data=await readFile(directory+name);expect(data.length).toBe(row.bytes);expect(sha(data)).toBe(row.sha256);expect(sha(gunzipSync(data))).toBe(row.rawSha256);}
});
