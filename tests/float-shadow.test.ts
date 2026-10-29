import{beforeAll,expect,it}from'vitest';
import{readFile}from'node:fs/promises';
import{gunzipSync}from'node:zlib';
import{createHash}from'node:crypto';
import{FloatPixelProcessor}from'../src/engine/float-pixels';
import{instantiateKernel}from'../src/engine/wasm';
import{FloatShadowCache,renderFloatShadow}from'../src/engine/float-shadow';
import{defaultStyle}from'../src/core/drawing';
import{Document,RasterLayer,LayerGroup,AdjustmentLayer,LayerStyle}from'../src/dom';
const directory='tests/fixtures/float-shadow/',manifest=JSON.parse(await readFile(directory+'manifest.json','utf8'));
const words=(v:Float32Array)=>new Uint32Array(v.buffer,v.byteOffset,v.length),sha=(v:Uint8Array)=>createHash('sha256').update(v).digest('hex');
async function samples(name:string){return new Float32Array(new Uint8Array(gunzipSync(await readFile(directory+name))).buffer);}
let native:FloatPixelProcessor;
beforeAll(async()=>{native=new FloatPixelProcessor(await instantiateKernel(new Uint8Array(await readFile('public/wasm/pixels.wasm'))));});
for(const[rowIndex,row]of manifest.cases.entries())it('native finite Gaussian matches independent complete alpha plane '+rowIndex,async()=>{
 const source=await samples(row.source),before=source.slice(),expected=await samples(row.reference),actual=native.convolveAlpha(source,{width:row.width,height:row.height,sigma:row.sigma,axis:row.axis});
 expect(words(actual)).toEqual(words(expected));expect(words(source)).toEqual(words(before));expect(actual.buffer).not.toBe(source.buffer);
});
it('invalid alpha, incomplete halos and working allocations reject, then native work recovers',()=>{
 const alpha=new Float32Array(9).fill(.375),options={width:9,height:1,sigma:1,axis:'horizontal' as const};
 for(const value of[NaN,Infinity,-.01,1.01]){const invalid=alpha.slice();invalid[3]=value;expect(()=>native.convolveAlpha(invalid,options)).toThrow();}
 for(const settings of[{...options,width:6},{...options,sigma:-1},{...options,sigma:129},{...options,width:262145,sigma:0},{...options,axis:'bad'}])expect(()=>native.convolveAlpha(alpha,settings as any)).toThrow();
 const shared=new Float32Array(new SharedArrayBuffer(36));expect(()=>native.convolveAlpha(shared,options)).toThrow('owned');
 expect(native.convolveAlpha(alpha,options)).toEqual(new Float32Array(3).fill(.375));
 const exact=new Float32Array([0,-0,2**-149,1]);expect(words(native.convolveAlpha(exact,{width:4,height:1,sigma:0,axis:'horizontal'}))).toEqual(words(exact));
});
it('shadow tiling, alpha cache eviction and neutral settings preserve exact output and avoid redundant native work',async()=>{
 let sourceReads=0,calls=0;const source=async({x,y,width,height}:{x:number;y:number;width:number;height:number})=>{sourceReads++;const alpha=new Float32Array(width*height);for(let row=0;row<height;row++)for(let col=0;col<width;col++)if(x+col>=19&&x+col<178&&y+row>=7&&y+row<94)alpha[row*width+col]=.625;return alpha;};
 const processor={floatConvolveAlpha:async(...args:Parameters<FloatPixelProcessor['convolveAlpha']>)=>{calls++;return native.convolveAlpha(...args);}},settings={...defaultStyle().dropShadow,enabled:true,color:'#ad3f79',x:9.25,y:-4.75,blur:12},bounds={x:0,y:0,width:271,height:137},store=new FloatShadowCache();
 const full=await renderFloatShadow(bounds,settings,source,processor,()=>{},{store,key:'frozen-layer'}),reads=sourceReads,nativeCalls=calls;
 expect(words(await renderFloatShadow(bounds,settings,source,processor,()=>{},{store,key:'frozen-layer'}))).toEqual(words(full));expect(sourceReads).toBe(reads);expect(calls).toBe(nativeCalls);
 const partition=new Float32Array(full.length);for(let y=0;y<137;y+=17){const part=await renderFloatShadow({x:0,y,width:271,height:Math.min(17,137-y)},settings,source,processor,()=>{});partition.set(part,y*271*4);}expect(words(partition)).toEqual(words(full));
 store.clear();await renderFloatShadow(bounds,settings,source,processor,()=>{},{store,key:'frozen-layer'});expect(sourceReads).toBeGreaterThan(reads);
 const cache=new FloatShadowCache(8);cache.set('a',new Float32Array(1));cache.set('b',new Float32Array(1));expect(cache.get('a')).toBeTruthy();cache.set('c',new Float32Array(1));expect(cache.get('b')).toBeUndefined();cache.clear();expect(cache.get('a')).toBeUndefined();
 const before=calls;for(const settings2 of[{...settings,enabled:false},{...settings,opacity:0}])expect((await renderFloatShadow(bounds,settings2,source,processor,()=>{})).every(v=>v===0)).toBe(true);expect(calls).toBe(before);
});
it('shadow cancellation after a completed native band rejects before publication',async()=>{
 let canceled=false,calls=0;const settings={...defaultStyle().dropShadow,enabled:true,blur:128};
 await expect(renderFloatShadow({x:0,y:0,width:129,height:129},settings,async b=>new Float32Array(b.width*b.height).fill(.5),{floatConvolveAlpha:async(a,o)=>{calls++;const result=native.convolveAlpha(a,o);canceled=true;return result;}},()=>{if(canceled)throw new Error('closed shadow');})).rejects.toThrow('closed shadow');expect(calls).toBe(1);
});
it('validated empty halos skip native work within the original window budget and retain exact cached zeros',async()=>{
 let reads=0,calls=0,maximum=0;const store=new FloatShadowCache(),settings={...defaultStyle().dropShadow,enabled:true,blur:128},bounds={x:0,y:0,width:271,height:137},source=async(b:{x:number;y:number;width:number;height:number})=>{reads++;maximum=Math.max(maximum,b.width*b.height);return new Float32Array(b.width*b.height);},processor={floatConvolveAlpha:async()=>{calls++;throw new Error('Empty alpha must not enter native convolution.');}};
 const first=await renderFloatShadow(bounds,settings,source,processor,()=>{},{store,key:'empty'});expect(first.every(v=>v===0)).toBe(true);expect(maximum).toBeLessThanOrEqual(262144);expect(calls).toBe(0);const before=reads;
 expect(words(await renderFloatShadow(bounds,settings,source,processor,()=>{},{store,key:'empty'}))).toEqual(words(first));expect(reads).toBe(before);store.clear();await renderFloatShadow(bounds,settings,source,processor,()=>{},{store,key:'empty'});expect(reads).toBeGreaterThan(before);
});
it('empty shortcuts still reject malformed alpha and cancellation after an awaited source',async()=>{
 const bounds={x:0,y:0,width:128,height:64},settings={...defaultStyle().dropShadow,enabled:true,blur:2.5},processor={floatConvolveAlpha:async()=>{throw new Error('Unexpected native work.');}};
 await expect(renderFloatShadow(bounds,settings,async b=>{const alpha=new Float32Array(b.width*b.height);alpha[alpha.length-1]=NaN;return alpha;},processor,()=>{})).rejects.toThrow('finite');
 let closed=false;await expect(renderFloatShadow(bounds,settings,async b=>{closed=true;return new Float32Array(b.width*b.height);},processor,()=>{if(closed)throw new Error('closed source');})).rejects.toThrow('closed source');
});
it('public raster and isolated group shadows share exact Undo, conversion and transaction boundaries',()=>{
 const document=new Document(),raster=document.layers.add(new RasterLayer({assetId:'source',width:10,height:10})),group=document.layers.add(new LayerGroup()),adjustment=document.layers.add(new AdjustmentLayer());document.convertToFloat();const before=document.toJSON();
 document.transaction('Float shadows',()=>{raster.fillOpacity=0;raster.styles=new LayerStyle({dropShadow:{enabled:true,x:9.25,blur:128}});group.styles.dropShadow={enabled:true,y:-4.75};});const edited=document.toJSON();expect(Document.fromJSON(edited).toJSON()).toEqual(edited);document.undo();expect(document.toJSON()).toEqual(before);document.redo();expect(document.toJSON()).toEqual(edited);
 expect(()=>document.transaction('Rejected adjustment silhouette',()=>{raster.opacity=.125;adjustment.styles.dropShadow={enabled:true};})).toThrow('intrinsic shadow silhouette');expect(document.toJSON()).toEqual(edited);
 group.locked=true;expect(()=>group.styles.dropShadow={enabled:false}).toThrow(/lock/i);
});
it('independent shadow references bind every input and complete raw stream',async()=>{
 for(const[path,hash]of Object.entries(manifest.inputs))expect(sha(await readFile(path))).toBe(hash);
 for(const[name,row]of Object.entries(manifest.files)as[string,any][]){const bytes=await readFile(directory+name);expect(bytes.length).toBe(row.bytes);expect(sha(bytes)).toBe(row.sha256);expect(sha(gunzipSync(bytes))).toBe(row.rawSha256);}
});
