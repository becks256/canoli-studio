import {beforeAll,afterEach,expect,it,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {inflateSync} from 'node:zlib';
import factory from '../src/core/interchange/avif/codec/canoli_avif_decoder.js';
import {avifDecoder} from '../src/core/interchange/avif/codec';
import {openPngRows} from '../server/png-rows';
import {inspectAvifInput} from '../src/core/interchange/avif/inspect';
import {decodeAvifInput,type AvifDecoder,type AvifDecodedImage} from '../src/core/interchange/avif/decode';
import {inspectAvifFile,decodeAvifFile} from '../src/core/interchange/avif/client';
import {avifDecodeOptionsSchema,avifImportReportSchema,type AvifImportReport} from '../src/core/interchange/avif/types';

const base='tests/fixtures/avif-import/';
const manifest=JSON.parse(await readFile(base+'manifest.json','utf8')) as {cases:{file:string;reference:string;width:number;height:number;depth:number;sha256:string;assumeSrgb:boolean;nativeResolved?:string}[];rejections:{file:string;reason:string}[]};
let decoder:AvifDecoder,valid:Uint8Array<ArrayBuffer>,report:AvifImportReport,png:Blob;
beforeAll(async()=>{
  decoder=avifDecoder(await factory({wasmBinary:new Uint8Array(await readFile(new URL('../src/core/interchange/avif/codec/canoli_avif_decoder.wasm',import.meta.url)))}));
  valid=new Uint8Array(await readFile(base+'orientation-1.avif'));report=(await inspectAvifInput(new Blob([valid]))).report;
  png=(await decodeAvifInput(new Blob([valid]),decoder)).png;
});
afterEach(()=>vi.unstubAllGlobals());
const source=()=>new Blob([new Uint8Array(valid)],{type:'image/avif'});
function locate(bytes:Uint8Array,type:string){const at=Buffer.from(bytes).indexOf(Buffer.from(type));if(at<4)throw new Error('Missing test box '+type);return at+4;}
function changed(type:string,edit:(view:DataView,at:number,bytes:Uint8Array)=>void){const bytes=valid.slice(),at=locate(bytes,type);edit(new DataView(bytes.buffer),at,bytes);return new Blob([bytes]);}
async function pixels(bytes:Uint8Array){const result=openPngRows(bytes),parts:Uint8ClampedArray[]=[];for await(const strip of result.strips)parts.push(strip.pixels);return{width:result.width,height:result.height,data:Uint8ClampedArray.from(parts.flatMap(part=>[...part]))};}
// Profiled PNG is inspected without treating the samples as already display-converted sRGB.
function nativePng(blobBytes:Uint8Array){const view=new DataView(blobBytes.buffer,blobBytes.byteOffset,blobBytes.byteLength),parts:Uint8Array[]=[];let width=0,height=0,icc:Uint8Array|undefined;
  for(let at=8;at<blobBytes.length;){const length=view.getUint32(at),type=String.fromCharCode(...blobBytes.subarray(at+4,at+8)),data=blobBytes.subarray(at+8,at+8+length);if(type==='IHDR'){width=view.getUint32(at+8);height=view.getUint32(at+12);}if(type==='IDAT')parts.push(data);if(type==='iCCP'){const end=data.indexOf(0);icc=new Uint8Array(inflateSync(data.subarray(end+2)));}at+=length+12;}
  const filtered=inflateSync(Buffer.concat(parts)),data=new Uint8ClampedArray(width*height*4);for(let y=0;y<height;y++){expect(filtered[y*(width*4+1)]).toBe(0);data.set(filtered.subarray(y*(width*4+1)+1,(y+1)*(width*4+1)),y*width*4);}return{width,height,data,icc};
}
for(const fixture of manifest.cases)it(`decodes independent ${fixture.file} with native geometry, alpha and orientation`,async()=>{
  const bytes=new Uint8Array(await readFile(base+fixture.file)),before=bytes.slice();expect(createHash('sha256').update(bytes).digest('hex')).toBe(fixture.sha256);
  const inspection=await inspectAvifInput(new Blob([bytes])),checked=avifImportReportSchema.parse(inspection.report);
  expect(checked.canDecode).toBe(true);expect(checked.bitDepth).toBe(fixture.depth);expect(checked.requiresColorAssumption).toBe(fixture.assumeSrgb);
  const decoded=await decodeAvifInput(new Blob([bytes]),decoder,{allowPrecisionLoss:fixture.depth>8,assumeSrgb:fixture.assumeSrgb}),actual=nativePng(new Uint8Array(await decoded.png.arrayBuffer())),expected=await pixels(new Uint8Array(await readFile(base+fixture.reference)));
  if(fixture.nativeResolved){expect(decoded.report.color.kind).toBe(fixture.nativeResolved);expect(decoded.report.requiresColorAssumption).toBe(false);if(fixture.nativeResolved==='display-p3')expect(actual.icc).toBeDefined();}
  expect([actual.width,actual.height]).toEqual([fixture.width,fixture.height]);expect([actual.width,actual.height]).toEqual([expected.width,expected.height]);
  let maximum=0,alpha=0;for(let i=0;i<actual.data.length;i++){const delta=Math.abs(actual.data[i]-expected.data[i]);if(i%4===3)alpha=Math.max(alpha,delta);else maximum=Math.max(maximum,delta);}
  // Compare the same explicit built-in reconstruction mode in native/WASM libavif 1.3.
  // Native/WASM float conversion and unpremultiplication differ by two on this
  // fixture; all other fixtures retain the one-level reconstruction bound.
  expect(alpha).toBe(0);expect(maximum).toBeLessThanOrEqual(fixture.file==='premultiplied.avif'?2:1);
  if(fixture.file==='icc.avif')expect(actual.icc).toEqual(inspection.icc);expect(bytes).toEqual(before);
});
for(const fixture of manifest.rejections)it(`rejects native ${fixture.file} despite explicit unidentified-RGB/precision consent`,async()=>{
  const blob=new Blob([await readFile(base+fixture.file)]),inspection=await inspectAvifInput(blob);expect(inspection.report).toMatchObject({canDecode:true,color:{kind:'unspecified'},requiresColorAssumption:true});
  await expect(decodeAvifInput(blob,decoder,{allowPrecisionLoss:true,assumeSrgb:true})).rejects.toThrow(/HDR/);
});
it('validates options and requires precision/color consent before calling the native decoder',async()=>{
  expect(avifDecodeOptionsSchema.parse({})).toEqual({allowPrecisionLoss:false,assumeSrgb:false});
  for(const value of [null,{allowPrecisionLoss:1},{assumeSrgb:'yes'},{extra:true}])expect(()=>avifDecodeOptionsSchema.parse(value)).toThrow();
  const decode=vi.fn(()=>null);
  for(const depth of [10,12])await expect(decodeAvifInput(new Blob([await readFile(base+`rgb-${depth}.avif`)]),{decode})).rejects.toThrow(/precision-loss consent/);
  await expect(decodeAvifInput(new Blob([await readFile(base+'unspecified.avif')]),{decode})).rejects.toThrow(/sRGB assumption/);expect(decode).not.toHaveBeenCalled();
});
it('rejects malformed box headers, missing brands, item IDs, associations and out-of-file payloads',async()=>{
  for(const bytes of [new Uint8Array(),valid.subarray(0,7),valid.subarray(0,valid.length-1)])await expect(inspectAvifInput(new Blob([bytes]))).rejects.toThrow(/Invalid AVIF/);
  await expect(inspectAvifInput(changed('ftyp',(v,at)=>v.setUint32(at-8,0x7fffffff)))).rejects.toThrow(/beyond/);
  await expect(inspectAvifInput(changed('pitm',(v,at)=>v.setUint16(at+4,65535)))).rejects.toThrow(/does not exist/);
  await expect(inspectAvifInput(changed('ipma',(v,at)=>v.setUint8(at+11,127)))).rejects.toThrow(/property reference/);
  await expect(inspectAvifInput(changed('iloc',(v,at)=>v.setUint32(at+16,0xffffffff)))).rejects.toThrow(/outside/);
  await expect(inspectAvifInput(changed('av1C',(v,at)=>v.setUint8(at,0)))).rejects.toThrow(/AV1 configuration/);
  await expect(inspectAvifInput(changed('pixi',(v,at)=>v.setUint8(at+5,10)))).rejects.toThrow(/pixel depth/);
});
it('does not confuse unrelated image properties with those associated with the primary item',async()=>{
  const blob=changed('ispe',(v,at)=>{v.setUint32(at+4,0);});await expect(inspectAvifInput(blob)).rejects.toThrow(/geometry/);
  // The alpha property is a distinct item association, rather than a global alpha heuristic.
  const noAlpha=changed('auxC',(_v,at,bytes)=>{bytes[at+4]=120;});expect((await inspectAvifInput(noAlpha)).report.alpha).toBe(false);
});
it('reports HDR and unknown essential properties without calling the codec',async()=>{
  const hdr=changed('colr',(v,at)=>{v.setUint16(at+4,9);v.setUint16(at+6,16);});expect((await inspectAvifInput(hdr)).report).toMatchObject({canDecode:false,color:{kind:'unsupported',transfer:16}});
  const decode=vi.fn(()=>null);await expect(decodeAvifInput(hdr,{decode})).rejects.toThrow(/HDR/);expect(decode).not.toHaveBeenCalled();
  const unknown=changed('av1C',(_v,at,bytes)=>bytes.set(new TextEncoder().encode('test'),at-4));const inspected=await inspectAvifInput(unknown).catch(error=>error);expect(inspected instanceof Error).toBe(true);
});
it('reports unknown derived-image precision without inventing an 8-bit decoding claim',async()=>{
  const bytes=valid.slice(),at=Buffer.from(bytes).indexOf(Buffer.from('av01'));bytes.set(new TextEncoder().encode('tmap'),at);
  const inspection=await inspectAvifInput(new Blob([bytes]));expect(avifImportReportSchema.parse(inspection.report)).toMatchObject({canDecode:false,bitDepth:null});expect(inspection.report.unsupported.join(' ')).toMatch(/tmap/);
});
it('retains P3/linear ICC identification, rather than tagging their unchanged RGB samples as sRGB',async()=>{
  for(const [primaries,transfer,kind]of [[12,13,'display-p3'],[1,8,'linear-srgb']] as const){
    const blob=changed('colr',(v,at)=>{v.setUint16(at+4,primaries);v.setUint16(at+6,transfer);}),decoded=await decodeAvifInput(blob,decoder),actual=nativePng(new Uint8Array(await decoded.png.arrayBuffer()));
    expect(decoded.report.color.kind).toBe(kind);expect(actual.icc).toBeDefined();expect(String.fromCharCode(...actual.icc!.subarray(16,20))).toBe('RGB ');
  }
});
it('rejects inconsistent/missing codec pixels and propagates progress exceptions without a result',async()=>{
  for(const image of [null,{width:18,height:13,data:new Uint8ClampedArray(18*13*4)},{width:17,height:13,data:new Uint8ClampedArray(1)}])await expect(decodeAvifInput(source(),{decode:()=>image as AvifDecodedImage|null})).rejects.toThrow(/native image pixels/);
  await expect(decodeAvifInput(source(),decoder,{},()=>{throw new Error('Progress failed');})).rejects.toThrow('Progress failed');
});
it('propagates actual native YUV/RGB conversion failure instead of publishing an allocated false image',()=>{
  const bytes=valid.slice(),at=locate(bytes,'colr');new DataView(bytes.buffer).setUint16(at+8,10);
  expect(()=>decoder.decode(bytes,8)).toThrow(/YUV\/RGB conversion failed/);
  expect(decoder.decode(valid,8)?.width).toBe(17);
});
it('parses beyond the old default pixel guard and rejects native pointer overflow before decoding',async()=>{
  const bytes=new Uint8Array(await readFile(base+'opaque-444.avif')),at=locate(bytes,'ispe'),v=new DataView(bytes.buffer);v.setUint32(at+4,50000);v.setUint32(at+8,11000);
  // Metadata intentionally does not match the tiny coded image. The assertion
  // proves pre-decode representation rejection, not a functional 550 MP import.
  expect(()=>decoder.decode(bytes,8)).toThrow(/native pointer-difference representation/);
  expect(decoder.decode(valid,8)?.width).toBe(17);
});
it('preserves native 50 MP inspection geometry without reading or allocating decoded image planes',async()=>{
  // Deliberately metadata-only: this does not claim the unchanged AV1 payload is 50 MP.
  // Use an opaque independent file so this test does not alter a shared alpha property.
  const bytes=new Uint8Array(await readFile(base+'opaque-444.avif')),at=locate(bytes,'ispe'),v=new DataView(bytes.buffer);v.setUint32(at+4,10000);v.setUint32(at+8,5000);
  const report=(await inspectAvifInput(new Blob([bytes]))).report;expect([report.width,report.height]).toEqual([10000,5000]);expect(report.canDecode).toBe(true);
});
it('contains deterministic malformed metadata mutations and never leaks DataView/stack errors',async()=>{
  let seed=0x7417;for(let i=0;i<240;i++){
    const bytes=valid.slice();seed=(Math.imul(seed,1664525)+1013904223)>>>0;const at=seed%Math.min(bytes.length,600);bytes[at]^=1<<(i%8);
    try{avifImportReportSchema.parse((await inspectAvifInput(new Blob([bytes]))).report);}catch(error){expect(error).toBeInstanceOf(Error);expect(String(error)).not.toMatch(/RangeError|TypeError|Maximum call stack/);}
  }
});

class MockWorker {
  static instances:MockWorker[]=[];static posted:(worker:MockWorker)=>void=()=>{};
  onmessage:((event:MessageEvent)=>void)|null=null;onerror:(()=>void)|null=null;onmessageerror:(()=>void)|null=null;
  request:any;terminations=0;
  constructor(){MockWorker.instances.push(this);}
  postMessage(value:unknown){this.request=value;MockWorker.posted(this);}
  terminate(){this.terminations++;}
  reply(value:unknown){this.onmessage?.({data:value}as MessageEvent);}
}
function mock(posted:(worker:MockWorker)=>void){MockWorker.instances=[];MockWorker.posted=posted;vi.stubGlobal('Worker',MockWorker);}
it('owns one immutable source per worker, validates PNG/header/schema and terminates on success',async()=>{
  mock(worker=>queueMicrotask(()=>worker.reply({report,png})));const blob=source(),result=await decodeAvifFile(blob);
  expect(result.report).toEqual(report);expect(MockWorker.instances[0].request.blob).toBe(blob);expect(MockWorker.instances[0].terminations).toBe(1);expect(MockWorker.instances[0].onmessage).toBeNull();
  mock(worker=>queueMicrotask(()=>worker.reply({report})));expect(await inspectAvifFile(blob)).toEqual(report);expect(MockWorker.instances[0].terminations).toBe(1);
});
it('cancels pre-start and in-flight workers without accepting late results',async()=>{
  mock(()=>{});const early=new AbortController();early.abort();await expect(inspectAvifFile(source(),{signal:early.signal})).rejects.toThrow();expect(MockWorker.instances).toHaveLength(0);
  const abort=new AbortController(),pending=decodeAvifFile(source(),{}, {signal:abort.signal});abort.abort(new Error('Import cancelled'));await expect(pending).rejects.toThrow('Import cancelled');expect(MockWorker.instances[0].terminations).toBe(1);MockWorker.instances[0].reply({report,png});
});
it('keeps cancellation live after worker completion while the PNG result is being validated',async()=>{
  let release!:(buffer:ArrayBuffer)=>void;const held=new Promise<ArrayBuffer>(resolve=>release=resolve),blob=new Blob([await png.arrayBuffer()],{type:'image/png'});
  vi.spyOn(blob,'slice').mockReturnValue({arrayBuffer:()=>held}as Blob);
  mock(worker=>queueMicrotask(()=>worker.reply({report,png:blob})));
  const abort=new AbortController(),pending=decodeAvifFile(source(),{}, {signal:abort.signal});await Promise.resolve();abort.abort(new Error('Cancel validation'));
  await expect(pending).rejects.toThrow('Cancel validation');expect(MockWorker.instances[0].terminations).toBe(1);release(await png.slice(0,33).arrayBuffer());
});
for(const kind of ['error','message-error','invalid-schema','wrong-png','wrong-geometry','unconsented','callback-error','post-error'] as const)it(`contains ${kind} and permits a fresh worker`,async()=>{
  mock(worker=>{
    if(kind==='post-error')throw new Error('Post failed');queueMicrotask(()=>{
      if(kind==='error')worker.onerror?.();else if(kind==='message-error')worker.onmessageerror?.();
      else if(kind==='callback-error')worker.reply({progress:{phase:'decoding',fraction:0}});
      else worker.reply(kind==='invalid-schema'?{report:{...report,extra:1},png}:kind==='wrong-png'?{report,png:new Blob(['wrong'],{type:'image/png'})}:kind==='wrong-geometry'?{report:{...report,displayWidth:18},png}:kind==='unconsented'?{report:{...report,requiresPrecisionLoss:true},png}:{report,png});
    });
  });
  await expect(decodeAvifFile(source(),{}, {onProgress(){throw new Error('Progress failed');}})).rejects.toThrow();expect(MockWorker.instances[0].terminations).toBe(1);
  mock(worker=>queueMicrotask(()=>worker.reply({report,png})));expect((await decodeAvifFile(source())).report).toEqual(report);
});
