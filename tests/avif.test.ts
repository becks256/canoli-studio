import {beforeAll,afterEach,expect,it,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import encoderFactory from '@jsquash/avif/codec/enc/avif_enc.js';
import decoderFactory from '@jsquash/avif/codec/dec/avif_dec.js';
import {avifGeometry,avifSettings,inspectAvif,identifyAvifSrgb,assertAvifResult} from '../src/core/avif';
import {encodeAvifRgba} from '../src/engine/avif-codec';
import {encodeAvifFrame} from '../src/engine/avif-encoder';
import {exportAvif} from '../src/engine/avif';
import {AssetStore} from '../src/core/assets';
import {createDocument,createText} from '../src/core/model';
import {getExportCapabilityReport} from '../src/engine/export';
import type {DocumentRenderer} from '../src/engine/renderer';
import {deliveryVariantSpecSchema} from '../src/ai/batch/schema';

let encoder:Awaited<ReturnType<typeof encoderFactory>>,decoder:Awaited<ReturnType<typeof decoderFactory>>,fixture:Blob;
const rgba=(width:number,height:number,opaque=false)=>{const bytes=new Uint8Array(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++)bytes.set([(x*17+y*31)%256,(x*43+y*7)%256,(x*11+y*61)%256,opaque?255:(x+y*width)%256],(y*width+x)*4);return bytes;};
beforeAll(async()=>{
 encoder=await encoderFactory({wasmBinary:new Uint8Array(await readFile(new URL('../node_modules/@jsquash/avif/codec/enc/avif_enc.wasm',import.meta.url)))});
 decoder=await decoderFactory({wasmBinary:new Uint8Array(await readFile(new URL('../node_modules/@jsquash/avif/codec/dec/avif_dec.wasm',import.meta.url)))});
 fixture=encodeAvifRgba(encoder,rgba(4,4).buffer,4,4,{lossless:true,speed:10},true);
});
afterEach(()=>vi.unstubAllGlobals());

it('validates finite settings and native integer geometry without a source-resolution budget',()=>{
 expect(avifSettings()).toEqual({quality:.8,lossless:false,speed:8});expect(avifSettings({quality:1})).toEqual({quality:1,lossless:true,speed:8});expect(avifSettings({quality:.1,lossless:true,speed:0})).toEqual({quality:1,lossless:true,speed:0});
 for(const value of [null,{quality:0},{quality:1.01},{quality:NaN},{quality:'0.8'},{lossless:null},{speed:1.5},{speed:-1},{speed:11},{extra:1}])expect(()=>avifSettings(value)).toThrow();
 expect(avifGeometry(10000,5000)).toEqual({width:10000,height:5000,bytes:200000000});
 for(const [width,height]of [[0,1],[1,0],[NaN,1],[1.5,2],[Infinity,1],[0x80000000,1],[Number.MAX_SAFE_INTEGER,2]])expect(()=>avifGeometry(width,height)).toThrow(/dimensions/);
});
for(const [width,height]of [[1,1],[7,13],[33,19],[256,4]])it(`actual WASM lossless ${width}x${height} retains every RGBA byte with sRGB identification`,async()=>{
 const pixels=rgba(width,height),before=pixels.slice(),blob=encodeAvifRgba(encoder,pixels.buffer,width,height,{lossless:true,speed:10},true),bytes=new Uint8Array(await blob.arrayBuffer()),info=inspectAvif(bytes),image=decoder.decode(bytes,8)!;
 expect(image.width).toBe(width);expect(image.height).toBe(height);expect(image.data).toEqual(new Uint8ClampedArray(before));expect(pixels).toEqual(before);expect(blob.type).toBe('image/avif');
 expect(info).toMatchObject({width,height,alpha:true,bitDepth:8,colour:{primaries:1,transfer:13,matrix:0,fullRange:true}});assertAvifResult(info,width,height,true);
});
it('keeps alpha exact in lossy colour mode and reports compression losses honestly',async()=>{
 const pixels=rgba(256,4),blob=encodeAvifRgba(encoder,pixels.buffer,256,4,{quality:.35,speed:10},true),bytes=new Uint8Array(await blob.arrayBuffer()),image=decoder.decode(bytes,8)!;
 expect([...image.data].filter((_,index)=>index%4===3)).toEqual([...pixels].filter((_,index)=>index%4===3));expect(image.data.some((value:number,index:number)=>index%4!==3&&value!==pixels[index])).toBe(true);expect(inspectAvif(bytes).colour).toMatchObject({primaries:1,transfer:13,matrix:6});
 const report=getExportCapabilityReport(createDocument(),{format:'avif',quality:.35});expect(report.warnings.join(' ')).toMatch(/35%/);expect(report.featuresPreserved).toContain('Lossless 8-bit alpha transparency');expect(report.featuresDegradedOrOmitted).toContain('Bit-exact colour values in lossy mode');
 expect(getExportCapabilityReport(createDocument(),{format:'avif',avifLossless:true}).featuresPreserved).toContain('Lossless 8-bit colour samples');
});
it('supports opaque output and captures options without changing the codec-owned returned bytes',async()=>{
 const pixels=rgba(7,13,true),blob=encodeAvifRgba(encoder,pixels.buffer,7,13,{lossless:true,speed:10}),bytes=new Uint8Array(await blob.arrayBuffer());expect(inspectAvif(bytes).alpha).toBe(false);expect(decoder.decode(bytes,8)!.data).toEqual(new Uint8ClampedArray(pixels));
 const raw=encoder.encode(rgba(4,4),4,4,{quality:100,qualityAlpha:100,speed:10,subsample:3,denoiseLevel:0,tileRowsLog2:0,tileColsLog2:0,chromaDeltaQ:false,sharpness:0,tune:0,enableSharpYUV:false,bitDepth:8})!;
 const before=raw.slice();expect(inspectAvif(raw).colour.primaries).toBe(2);const result=encodeAvifRgba({encode:()=>raw},rgba(4,4).buffer,4,4,{lossless:true});expect(raw).toEqual(before);expect(inspectAvif(new Uint8Array(await result.arrayBuffer())).colour.primaries).toBe(1);
});
it('rejects malformed boxes, metadata budgets, missing payloads, wrong extents and unexpected colour without a fake file',async()=>{
 const valid=new Uint8Array(await fixture.arrayBuffer());
 for(const value of [new Uint8Array(),new Uint8Array([137,80,78,71]),valid.subarray(0,valid.length-1)])expect(()=>inspectAvif(value)).toThrow(/Invalid AVIF/);
 const wrongType=valid.slice();wrongType.set(new TextEncoder().encode('png '),8);const compatible=Buffer.from(wrongType).indexOf(Buffer.from('avif'),12);wrongType.set(new TextEncoder().encode('png '),compatible);expect(()=>inspectAvif(wrongType)).toThrow(/still AVIF/);
 const oversized=valid.slice();new DataView(oversized.buffer).setUint32(0,0x7fffffff);expect(()=>inspectAvif(oversized)).toThrow(/beyond/);
 const extended=valid.slice();new DataView(extended.buffer).setUint32(0,1);new DataView(extended.buffer).setBigUint64(8,BigInt(Number.MAX_SAFE_INTEGER)+1n);expect(()=>inspectAvif(extended)).toThrow(/unsafe/);
 const badColour=valid.slice(),info=inspectAvif(badColour);new DataView(badColour.buffer).setUint16(info.colour.offset,9);expect(()=>identifyAvifSrgb(badColour)).toThrow(/unexpected colour/);
 expect(()=>assertAvifResult(inspectAvif(valid),5,4,true)).toThrow(/dimensions/);
 const absentPayload=valid.slice();const mdat=Buffer.from(absentPayload).indexOf(Buffer.from('mdat'));absentPayload.set(new TextEncoder().encode('free'),mdat);expect(()=>inspectAvif(absentPayload)).toThrow(/missing/);
 const crowded=new Uint8Array(valid.length+8*4097);crowded.set(valid);for(let i=valid.length;i<crowded.length;i+=8){new DataView(crowded.buffer).setUint32(i,8);crowded.set(new TextEncoder().encode('free'),i+4);}expect(()=>inspectAvif(crowded)).toThrow(/box table/);
 expect(()=>encodeAvifRgba({encode:()=>null},rgba(4,4).buffer,4,4,{})).toThrow(/could not encode/);expect(()=>encodeAvifRgba(encoder,new ArrayBuffer(3),4,4,{})).toThrow(/RGBA8/);
});
it('validates delivery quality/AVIF options and keeps unrelated formats explicit',()=>{
 const variant={id:'avif',name:'AVIF',format:'avif',targetWidth:600,targetHeight:300,fit:'contain',quality:.8,avifLossless:true,avifSpeed:8};expect(deliveryVariantSpecSchema.parse(variant)).toEqual(variant);
 for(const patch of [{quality:NaN},{quality:0},{avifSpeed:1.5},{avifSpeed:11},{avifLossless:'yes'},{format:'png'},{format:'jpeg'}])expect(()=>deliveryVariantSpecSchema.parse({...variant,...patch})).toThrow();
 expect(deliveryVariantSpecSchema.parse({...variant,format:'webp',avifSpeed:undefined,avifLossless:undefined}).quality).toBe(.8);
});

class MockWorker {
 static instances:MockWorker[]=[];static posted:(worker:MockWorker)=>void=()=>{};
 onmessage:((event:MessageEvent)=>unknown)|null=null;onerror:((event:Event)=>unknown)|null=null;terminations=0;request:any;
 private messageError:(()=>void)|undefined;
 constructor(){MockWorker.instances.push(this);}
 addEventListener(type:string,callback:()=>void){if(type==='messageerror')this.messageError=callback;}
 removeEventListener(type:string,callback:()=>void){if(type==='messageerror'&&this.messageError===callback)this.messageError=undefined;}
 terminate(){this.terminations++;}
 postMessage(value:any,transfer:Transferable[]){this.request=structuredClone(value,{transfer});MockWorker.posted(this);}
 reply(value:unknown={type:'complete',width:4,height:4,blob:fixture}){this.onmessage?.({data:value}as MessageEvent);}
 corrupt(){this.messageError?.();}
}
function mock(posted:(worker:MockWorker)=>void=worker=>queueMicrotask(()=>worker.reply())){MockWorker.instances=[];MockWorker.posted=posted;vi.stubGlobal('Worker',MockWorker);}
function renderer(){const tiles:any[]=[],value:DocumentRenderer={async render(_doc,_assets,options){const width=options?.region?.width??4,height=options?.region?.height??4;const tile={width,height,getContext:()=>({getImageData:()=>({data:new Uint8ClampedArray(rgba(width,height))})})};tiles.push(tile);return tile as unknown as HTMLCanvasElement;},clearCache(){},dispose(){}};return{value,tiles};}
it('transfers only the owned private frame, validates the immutable result and terminates exactly once',async()=>{
 mock();const buffer=rgba(4,4).buffer,result=await encodeAvifFrame(buffer,4,4,{},true);expect(buffer.byteLength).toBe(0);expect(result).toBe(fixture);expect(MockWorker.instances[0].request.buffer.byteLength).toBe(64);expect(MockWorker.instances[0].terminations).toBe(1);expect(MockWorker.instances[0].onmessage).toBeNull();
});
it('rejects already aborted requests before creating a worker and cancels pending native work',async()=>{
 mock(()=>{});const early=new AbortController();early.abort();await expect(encodeAvifFrame(rgba(4,4).buffer,4,4,{},true,{signal:early.signal})).rejects.toThrow();expect(MockWorker.instances).toHaveLength(0);
 const controller=new AbortController(),pending=encodeAvifFrame(rgba(4,4).buffer,4,4,{},true,{signal:controller.signal});controller.abort(new Error('Cancelled AVIF'));await expect(pending).rejects.toThrow('Cancelled AVIF');expect(MockWorker.instances[0].terminations).toBe(1);MockWorker.instances[0].reply();
});
for(const action of ['bad-type','bad-dimensions','png','worker-error','message-error','guard']as const)it(`rejects ${action}, releases its worker and permits a later valid encode`,async()=>{
 mock(worker=>queueMicrotask(()=>{
  if(action==='worker-error'){worker.onerror?.(new Event('error'));return;}if(action==='message-error'){worker.corrupt();return;}
  worker.reply(action==='bad-type'?{type:'other'}:action==='bad-dimensions'?{type:'complete',width:5,height:4,blob:fixture}:action==='png'?{type:'complete',width:4,height:4,blob:new Blob([new Uint8Array([137,80,78,71])],{type:'image/avif'})}:undefined);
 }));let checks=0;
 await expect(encodeAvifFrame(rgba(4,4).buffer,4,4,{},true,undefined,()=>{if(action==='guard'&&++checks>1)throw new Error('Source revoked');})).rejects.toThrow();expect(MockWorker.instances[0].terminations).toBe(1);
 mock();expect(await encodeAvifFrame(rgba(4,4).buffer,4,4,{},true)).toBe(fixture);
});
it('serializes complete captures, cancels a queued request without rendering and preserves exact source state',async()=>{
 let entered!:()=>void;const firstEntered=new Promise<void>(resolve=>entered=resolve);mock(()=>entered());
 const assets=new AssetStore(),scene=createDocument('Scene',4,4),render=renderer(),firstController=new AbortController(),lastController=new AbortController();
 const first=exportAvif(scene,assets,render.value,{}, {signal:firstController.signal});await firstEntered;
 const queuedController=new AbortController(),queued=exportAvif(scene,assets,render.value,{}, {signal:queuedController.signal});queuedController.abort(new Error('Cancel queued'));
 await expect(queued).rejects.toThrow('Cancel queued');expect(render.tiles).toHaveLength(1);
 let lastEntered!:()=>void;const waiting=new Promise<void>(resolve=>lastEntered=resolve);MockWorker.posted=()=>lastEntered();const last=exportAvif(scene,assets,render.value,{}, {signal:lastController.signal});
 try{MockWorker.instances[0].reply();await first;await waiting;MockWorker.instances[1].reply();await last;expect(render.tiles).toHaveLength(2);expect(render.tiles.every(tile=>tile.width===0&&tile.height===0)).toBe(true);expect(assets.values()).toEqual([]);expect(MockWorker.instances.every(worker=>worker.terminations===1)).toBe(true);}
 finally{firstController.abort();lastController.abort();await Promise.allSettled([first,last]);assets.dispose();}
});
it('revokes a disposed source repository while the worker is busy and releases the capture lease',async()=>{
 let entered!:()=>void;const ready=new Promise<void>(resolve=>entered=resolve);mock(()=>entered());const assets=new AssetStore(),render=renderer(),scene=createDocument('Scene',4,4),pending=exportAvif(scene,assets,render.value,{});
 await ready;assets.dispose();await expect(pending).rejects.toThrow(/disposed|lifetime|closed/i);expect(MockWorker.instances[0].terminations).toBe(1);
 mock();const next=new AssetStore();expect(await exportAvif(scene,next,render.value,{})).toBe(fixture);next.dispose();
});
it('pins referenced fonts during native encoding and rejects changes without a partial result',async()=>{
 let entered!:()=>void;const ready=new Promise<void>(resolve=>entered=resolve);mock(()=>entered());const scene=createDocument('Text',4,4);scene.children.push(createText('Text','Text',{fontFamily:'Fixture',fontSize:12}));const face={family:'Fixture',status:'loaded'},fonts=Object.assign(new Set([face]),{check:()=>true});vi.stubGlobal('document',{fonts});
 const assets=new AssetStore(),pending=exportAvif(scene,assets,renderer().value,{});await ready;face.status='error';await expect(pending).rejects.toThrow(/font family changed/i);expect(MockWorker.instances[0].terminations).toBe(1);assets.dispose();
});
it('propagates callback/render failures before spawning a codec and lets a later export succeed',async()=>{
 mock();const scene=createDocument('Scene',4,4),assets=new AssetStore(),render=renderer();
 await expect(exportAvif(scene,assets,render.value,{}, {onProgress(){throw new Error('Callback failed');}})).rejects.toThrow('Callback failed');expect(MockWorker.instances).toHaveLength(0);
 await expect(exportAvif(scene,assets,{...render.value,async render(){throw new Error('Render failed');}},{})).rejects.toThrow('Render failed');expect(MockWorker.instances).toHaveLength(0);
 expect(await exportAvif(scene,assets,render.value,{})).toBe(fixture);assets.dispose();
});
