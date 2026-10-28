import{beforeAll,expect,it}from'vitest';
import{readFile}from'node:fs/promises';
import{gunzipSync}from'node:zlib';
import{createHash}from'node:crypto';
import{compileFloatWhiteBalance}from'../src/core/float-white-balance';
import{FloatPixelProcessor}from'../src/engine/float-pixels';
import{instantiateKernel}from'../src/engine/wasm';
import{Document,RasterLayer,AdjustmentLayer,PaintLayer}from'../src/dom';

const directory='tests/fixtures/float-white-balance/',manifest=JSON.parse(await readFile(directory+'manifest.json','utf8'));
const hash=(pixels:Uint8Array)=>createHash('sha256').update(pixels).digest('hex');
const words=(values:Float32Array)=>new Uint32Array(values.buffer,values.byteOffset,values.length);
const floats=(bytes:Uint8Array)=>new Float32Array(new Uint8Array(bytes).buffer);
let processor:FloatPixelProcessor;
beforeAll(async()=>{processor=new FloatPixelProcessor(await instantiateKernel(new Uint8Array(await readFile('public/wasm/pixels.wasm'))));});

for(const row of manifest.pixels)it(`native linear White Balance ${row.adjustment.temperature} K / ${row.adjustment.tint} retains independent signed colors, alpha and partitions`,async()=>{
 const source=floats(gunzipSync(await readFile(directory+'source.f32le.gz'))),before=source.slice(),matrix=compileFloatWhiteBalance(row.adjustment),expected=floats(gunzipSync(await readFile(directory+row.reference)));
 const apply=(pixels:Float32Array)=>matrix===null?pixels.slice():processor.affine(pixels,matrix),actual=apply(source);let maximum=0;
 for(let at=0;at<source.length;at+=4){const scale=Math.max(1,...source.subarray(at,at+3).map(Math.abs),...expected.subarray(at,at+3).map(Math.abs));for(let c=0;c<3;c++)maximum=Math.max(maximum,Math.abs(actual[at+c]-expected[at+c])/scale);expect(Object.is(actual[at+3],source[at+3])).toBe(true);}
 expect(maximum).toBeLessThanOrEqual(manifest.colorTolerance);expect(words(source)).toEqual(words(before));
 const special=manifest.subnormalExactPixel*4;expect(words(actual).subarray(special,special+4)).toEqual(words(expected).subarray(special,special+4));
 if(matrix===null)expect(words(actual)).toEqual(words(source));
 else{expect(actual.some((v,i)=>i%4!==3&&v<0)).toBe(true);expect(actual.some((v,i)=>i%4!==3&&v>1)).toBe(true);}
 const split=1234*4,partitioned=new Float32Array(source.length);partitioned.set(apply(source.subarray(0,split)));partitioned.set(apply(source.subarray(split)),split);expect(words(partitioned)).toEqual(words(actual));
});

it('float White Balance uses strict shared commands, precision conversion, locking, atomic rollback and exact history',()=>{
 const document=new Document(),raster=document.layers.add(new RasterLayer({assetId:'original',width:10,height:10})),balance=document.layers.add(new AdjustmentLayer({adjustment:{kind:'white-balance',temperature:4000.5,tint:-100}}));
 const byte=document.toJSON();document.convertToFloat();const converted=document.toJSON();expect(document.precision).toBe('float32');expect(Document.fromJSON(converted).toJSON()).toEqual(converted);document.undo();expect(document.toJSON()).toEqual(byte);document.redo();expect(document.toJSON()).toEqual(converted);
 const settings={kind:'white-balance' as const,temperature:10000,tint:100};balance.adjustment=settings;settings.tint=-100;expect(balance.adjustment).toMatchObject({tint:100});const edited=document.toJSON();document.undo();expect(document.toJSON()).toEqual(converted);document.redo();expect(document.toJSON()).toEqual(edited);
 for(const invalid of [{kind:'white-balance',temperature:1999,tint:0},{kind:'white-balance',temperature:25001,tint:0},{kind:'white-balance',temperature:6504,tint:101},{kind:'white-balance',temperature:NaN,tint:0},{kind:'white-balance',temperature:6504,tint:0,unexpected:true}]){expect(()=>balance.update({adjustment:invalid}as any)).toThrow();expect(document.toJSON()).toEqual(edited);}
 expect(()=>document.transaction('Rejected float edit',()=>{raster.opacity=.5;balance.adjustment={kind:'white-balance',temperature:2000,tint:100};document.layers.add(new PaintLayer());})).toThrow();expect(document.toJSON()).toEqual(edited);
 balance.locked=true;const locked=document.toJSON();expect(()=>{balance.adjustment={kind:'white-balance',temperature:6504,tint:0};}).toThrow(/lock/i);expect(document.toJSON()).toEqual(locked);
});

it('nonrepresentable native White Balance output rejects without mutating sources and the owner remains usable',()=>{
 const matrix=compileFloatWhiteBalance({kind:'white-balance',temperature:2000,tint:100})!,source=new Float32Array([0,0,3e38,.5]),before=source.slice();expect(()=>processor.affine(source,matrix)).toThrow('float32');expect(words(source)).toEqual(words(before));expect(processor.affine(new Float32Array([.1,.2,.3,.5]),matrix).every(Number.isFinite)).toBe(true);
});

it('independent White Balance samples and complete scene references bind their inputs and numerical requirements',async()=>{
 expect(manifest.colorTolerance).toBe(2**-20);expect(manifest.alphaTolerance).toBe(0);expect(manifest.integerColorTolerance).toBe(1);expect(manifest.pixels).toHaveLength(24);expect(manifest.scenes).toHaveLength(87);
 for(const[path,expected]of Object.entries(manifest.inputs))expect(hash(await readFile(path))).toBe(expected);
 for(const[name,row]of Object.entries(manifest.files)as[string,{bytes:number;sha256:string;rawSha256:string}][]){const data=await readFile(directory+name);expect(data.length).toBe(row.bytes);expect(hash(data)).toBe(row.sha256);expect(hash(gunzipSync(data))).toBe(row.rawSha256);}
});
