import{beforeAll,expect,it}from'vitest';
import{readFile}from'node:fs/promises';
import{gunzipSync}from'node:zlib';
import{createHash}from'node:crypto';
import{FloatPixelProcessor}from'../src/engine/float-pixels';
import{instantiateKernel}from'../src/engine/wasm';
import{compileFloatColor}from'../src/core/float-color';
import{Document,RasterLayer,AdjustmentLayer,PaintLayer}from'../src/dom';

const directory='tests/fixtures/float-color/',manifest=JSON.parse(await readFile(directory+'manifest.json','utf8'));
const floats=(b:Uint8Array)=>new Float32Array(new Uint8Array(b).buffer),words=(v:Float32Array)=>new Uint32Array(v.buffer,v.byteOffset,v.length),hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
let engine:FloatPixelProcessor;
beforeAll(async()=>{engine=new FloatPixelProcessor(await instantiateKernel(new Uint8Array(await readFile('public/wasm/pixels.wasm'))));});
for(const[rowIndex,row]of manifest.cases.entries())it('native continuous '+row.adjustment.kind+' '+rowIndex+' matches independent colors, exact alpha, ownership and partitions',async()=>{
 const source=floats(gunzipSync(await readFile(directory+'source.f32le.gz'))),before=source.slice(),expected=floats(gunzipSync(await readFile(directory+row.reference))),actual=engine.color(source,row.adjustment);let maximum=0;
 for(let i=0;i<source.length;i++){if(i%4===3)expect(words(actual)[i]).toBe(words(source)[i]);else{maximum=Math.max(maximum,Math.abs(actual[i]-expected[i]));expect(Number.isFinite(actual[i])&&actual[i]>=0&&actual[i]<=1).toBe(true);}}
 expect(maximum).toBeLessThanOrEqual(manifest.colorTolerance);expect(words(source)).toEqual(words(before));
 const split=1234*4,part=new Float32Array(source.length);part.set(engine.color(source.subarray(0,split),row.adjustment));part.set(engine.color(source.subarray(split),row.adjustment),split);expect(words(part)).toEqual(words(actual));
 if(row.neutral){expect(words(actual)).toEqual(words(source));const extended=floats(gunzipSync(await readFile(directory+'extended-source.f32le.gz')));expect(words(engine.color(extended,row.adjustment))).toEqual(words(extended));}
 if([3,30,39].includes(rowIndex))expect(new Set(actual.filter((_,i)=>i%4===0)).size).toBeGreaterThan(256);
});

it('active color domains, invalid alpha/nonfinite values and strict controls reject without changing inputs, and retry succeeds',()=>{
 const settings={kind:'hsl'as const,hue:37.25,saturation:-43.5,lightness:21.75},source=new Float32Array([.1,.2,.3,.5]),before=source.slice();
 for(const value of[-.1,1.1]){const input=source.slice();input[0]=value;expect(()=>engine.color(input,settings)).toThrow('normalized linear RGB');}
 for(const value of[NaN,Infinity]){const input=source.slice();input[0]=value;expect(()=>engine.color(input,settings)).toThrow('invalid');}
 expect(()=>engine.color(new Float32Array([.1,.2,.3,1.1]),settings)).toThrow('invalid');
 for(const invalid of[{...settings,hue:181},{...settings,lightness:NaN},{...settings,extra:1},{kind:'vibrance',vibrance:0},{kind:'color-balance',shadows:{red:0,green:0,blue:0}}])expect(()=>compileFloatColor(invalid as any)).toThrow();
 expect(engine.color(source,settings).every(Number.isFinite)).toBe(true);expect(words(source)).toEqual(words(before));
});

it('complete native windows and awkward partitions retain all color samples across memory growth',()=>{
 const source=new Float32Array(65539*4);for(let i=0;i<source.length;i++)source[i]=i%4===3?.375:Math.fround(((i*73)%65536)/65535);const setting={kind:'vibrance'as const,vibrance:37.25,saturation:-41.5},all=engine.color(source,setting),parts=new Float32Array(source.length);
 for(let at=0;at<source.length;at+=491*4)parts.set(engine.color(source.subarray(at,Math.min(source.length,at+491*4)),setting),at);expect(words(parts)).toEqual(words(all));
});

it('all three float color kinds share conversion, strict atomic edits, ownership, locking and exact history',()=>{
 const document=new Document(),raster=document.layers.add(new RasterLayer({assetId:'native-original',width:10,height:10}));for(const kind of['hsl','color-balance','vibrance']){const row=manifest.cases.find((r:any)=>r.adjustment.kind===kind&&!r.neutral);document.layers.add(new AdjustmentLayer({adjustment:row.adjustment}));}
 const byte=document.toJSON();document.convertToFloat();const converted=document.toJSON();expect(Document.fromJSON(converted).toJSON()).toEqual(converted);document.undo();expect(document.toJSON()).toEqual(byte);document.redo();expect(document.toJSON()).toEqual(converted);
 expect(()=>document.transaction('Rejected color edit',()=>{raster.opacity=.5;document.layers.add(new PaintLayer());})).toThrow();expect(document.toJSON()).toEqual(converted);const layer=document.layers.at(1)!;layer.locked=true;const locked=document.toJSON();expect(()=>layer.update({adjustment:{kind:'vibrance',vibrance:25,saturation:0}}as any)).toThrow(/lock/i);expect(document.toJSON()).toEqual(locked);
});

it('the independent corpus and every expected native word stream bind their declared bounds and inputs',async()=>{
 expect(manifest.colorTolerance).toBe(2**-22);expect(manifest.sceneColorTolerance).toBe(2**-22);expect(manifest.alphaTolerance).toBe(0);expect(manifest.integerColorTolerance).toBe(1);expect(manifest.cases).toHaveLength(41);expect(manifest.scenes).toHaveLength(177);expect(manifest.scalarVectorWordsExact).toBe(true);
 for(const[path,h]of Object.entries(manifest.inputs))expect(hash(await readFile(path))).toBe(h);
 for(const[name,row]of Object.entries(manifest.files)as[string,{bytes:number;sha256:string;rawSha256:string}][]){const data=await readFile(directory+name);expect(data.length).toBe(row.bytes);expect(hash(data)).toBe(row.sha256);expect(hash(gunzipSync(data))).toBe(row.rawSha256);}
});
