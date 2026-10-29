import{beforeAll,expect,it}from'vitest';
import{readFile}from'node:fs/promises';
import{gunzipSync}from'node:zlib';
import{createHash}from'node:crypto';
import{FloatPixelProcessor}from'../src/engine/float-pixels';
import{instantiateKernel}from'../src/engine/wasm';
import{compileFloatStyle}from'../src/core/float-style';
import{defaultStyle}from'../src/core/drawing';
import{Document,RasterLayer,LayerGroup,AdjustmentLayer,LayerStyle}from'../src/dom';
const directory='tests/fixtures/float-style/',manifest=JSON.parse(await readFile(directory+'manifest.json','utf8'));
const floats=(b:Uint8Array)=>new Float32Array(new Uint8Array(b).buffer),words=(v:Float32Array)=>new Uint32Array(v.buffer,v.byteOffset,v.length),hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
async function samples(name:string){return floats(gunzipSync(await readFile(directory+name)));}
let native:FloatPixelProcessor;
beforeAll(async()=>{native=new FloatPixelProcessor(await instantiateKernel(new Uint8Array(await readFile('public/wasm/pixels.wasm'))));});
for(const[rowIndex,row]of manifest.cases.entries())it('native float appearance '+rowIndex+' retains independent color/coverage, alpha, inputs and partition identity',async()=>{
 const source=await samples('source.f32le.gz'),backdrop=await samples('backdrop.f32le.gz'),before=source.slice(),backBefore=backdrop.slice(),expected=await samples(row.pixels),coverage=await samples(row.coverage),actual=native.style(source,backdrop,row.style);let colorError=0,coverageError=0;
 for(let i=0;i<source.length;i++){if(i%4===3)expect(words(actual.pixels)[i]).toBe(words(source)[i]);else colorError=Math.max(colorError,Math.abs(actual.pixels[i]-expected[i])/Math.max(1,Math.abs(expected[i])));}
 for(let i=0;i<coverage.length;i++)coverageError=Math.max(coverageError,Math.abs(coverage[i]-actual.coverage[i]));
 if(row.style.colorOverlay.enabled&&row.style.colorOverlay.opacity>0)expect(actual.pixels.some((v,i)=>i%4!==3&&v!==source[i])).toBe(true);
 if(row.style.blendIf.enabled){expect(actual.coverage.some(v=>v>0)).toBe(true);if(JSON.stringify(row.style.blendIf.source)!=='[0,0,255,255]'||JSON.stringify(row.style.blendIf.underlying)!=='[0,0,255,255]')expect(actual.coverage.some(v=>v<1)).toBe(true);}
 expect(colorError).toBeLessThanOrEqual(manifest.colorTolerance);expect(coverageError).toBeLessThanOrEqual(manifest.coverageTolerance);expect(words(source)).toEqual(words(before));expect(words(backdrop)).toEqual(words(backBefore));
 const split=1234*4,a=native.style(source.subarray(0,split),backdrop.subarray(0,split),row.style),b=native.style(source.subarray(split),backdrop.subarray(split),row.style),partition=new Float32Array(source.length),masks=new Float32Array(source.length/4);partition.set(a.pixels);partition.set(b.pixels,split);masks.set(a.coverage);masks.set(b.coverage,split/4);expect(words(partition)).toEqual(words(actual.pixels));expect(words(masks)).toEqual(words(actual.coverage));
 if(!row.style.colorOverlay.enabled||row.style.colorOverlay.opacity===0)expect(words(actual.pixels)).toEqual(words(source));
 if(!row.style.blendIf.enabled||JSON.stringify(row.style.blendIf.source)==='[0,0,255,255]'&&JSON.stringify(row.style.blendIf.underlying)==='[0,0,255,255]')expect(actual.coverage.every(v=>v===1)).toBe(true);
});
it('native style windows cross memory growth without losing color, alpha or coverage words',()=>{
 const source=new Float32Array(65539*4),backdrop=new Float32Array(source.length);for(let i=0;i<source.length;i++){source[i]=i%4===3?.375:Math.fround(((i*73)%65536)/65535);backdrop[i]=i%4===3?.625:Math.fround(((i*97)%65536)/65535);}
 const style=manifest.cases.at(-1).style,full=native.style(source,backdrop,style),pixels=new Float32Array(source.length),coverage=new Float32Array(source.length/4);
 for(let at=0;at<source.length;at+=491*4){const end=Math.min(source.length,at+491*4),part=native.style(source.subarray(at,end),backdrop.subarray(at,end),style);pixels.set(part.pixels,at);coverage.set(part.coverage,at/4);}
 expect(words(pixels)).toEqual(words(full.pixels));expect(words(coverage)).toEqual(words(full.coverage));
});
it('invalid native pixels, alpha, controls and unsupported shadows reject, and healthy work can retry',()=>{
 const source=new Float32Array([.1,.2,.3,.5]),settings=defaultStyle();settings.colorOverlay.enabled=true;settings.colorOverlay.opacity=.375;
 for(const value of[NaN,Infinity]){const invalid=source.slice();invalid[0]=value;expect(()=>native.style(invalid,source,settings)).toThrow('invalid');expect(()=>native.style(source,invalid,settings)).toThrow('invalid');}
 expect(()=>native.style(new Float32Array([.1,.2,.3,1.01]),source,settings)).toThrow('invalid');expect(()=>native.style(source,new Float32Array(8),settings)).toThrow('geometry');
 for(const style of[{...settings,dropShadow:{...settings.dropShadow,enabled:true}},{...settings,colorOverlay:{...settings.colorOverlay,opacity:NaN}},{...settings,blendIf:{...settings.blendIf,source:[2,1,255,255]}}])expect(()=>compileFloatStyle(style as any)).toThrow();
 expect(native.style(source,source,settings).coverage[0]).toBe(1);expect(source).toEqual(new Float32Array([.1,.2,.3,.5]));
});
it('existing OO styles share float conversion, locks, transaction rollback, owned values and exact Undo/Redo',()=>{
 const document=new Document(),raster=document.layers.add(new RasterLayer({assetId:'original',width:10,height:10})),group=document.layers.add(new LayerGroup()),adjustment=document.layers.add(new AdjustmentLayer());raster.styles=new LayerStyle(manifest.cases.at(-1).style);const before=document.toJSON();document.convertToFloat();const converted=document.toJSON();expect(Document.fromJSON(converted).toJSON()).toEqual(converted);document.undo();expect(document.toJSON()).toEqual(before);document.redo();expect(document.toJSON()).toEqual(converted);
 document.transaction('Float appearance',()=>{group.styles=new LayerStyle(manifest.cases.at(-1).style);adjustment.styles=new LayerStyle(manifest.cases[2].style);});const edited=document.toJSON();document.undo();expect(document.toJSON()).toEqual(converted);document.redo();expect(document.toJSON()).toEqual(edited);
 const returned=raster.styles.colorOverlay;returned.opacity=0;expect(raster.styles.colorOverlay.opacity).not.toBe(0);
 expect(()=>document.transaction('Rejected shadow',()=>{raster.opacity=.125;raster.styles.dropShadow={enabled:true};})).toThrow('Drop shadows');expect(document.toJSON()).toEqual(edited);
 group.locked=true;const locked=document.toJSON();expect(()=>group.styles.colorOverlay={enabled:true}).toThrow(/lock/i);expect(document.toJSON()).toEqual(locked);
});
it('independent references bind the generator, original source and every complete sample stream',async()=>{
 expect(manifest.cases).toHaveLength(21);expect(manifest.scenes).toHaveLength(78);
 for(const[path,h]of Object.entries(manifest.inputs))expect(hash(await readFile(path))).toBe(h);
 for(const[name,row]of Object.entries(manifest.files)as[string,{bytes:number;sha256:string;rawSha256:string}][]){const bytes=await readFile(directory+name);expect(bytes.length).toBe(row.bytes);expect(hash(bytes)).toBe(row.sha256);expect(hash(gunzipSync(bytes))).toBe(row.rawSha256);}
});
