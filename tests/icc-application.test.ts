import {afterEach,beforeAll,it,expect,vi}from 'vitest';
import {readFile}from 'node:fs/promises';
import {inflateSync}from 'node:zlib';
import {NativeIccEngine}from '../src/core/color/icc-native';
import {IccSession}from '../src/core/color/icc-client';
import {IccProfile,iccTarget}from '../src/core/color/profile-source';
import {normalizeColorSettings,DEFAULT_COLOR_SETTINGS,serializeColorSettings,restoreColorSettings}from '../src/core/color/color-settings';
import {workspaceSchema}from '../src/workspace/repository';
import {EditorApplication}from '../src/editor';
import {Document}from '../src/dom';
import {AssetStore}from '../src/core/assets';
import {exportDocument,getExportCapabilityReport}from '../src/engine/export';
import {IccProofProcessor}from '../src/engine/icc-proof';
let wasm:Uint8Array<ArrayBuffer>,profileBytes:Uint8Array<ArrayBuffer>;
beforeAll(async()=>{wasm=new Uint8Array(await readFile('src/core/color/codec/canoli_icc.wasm'));profileBytes=new Uint8Array(await readFile('tests/fixtures/icc-native/narrow-rgb.icc'));});
/** Browser-host protocol exercised with the actual shipped WASM, not a color stub. */
class NativeWorker{
 static owners:NativeWorker[]=[];
 onmessage:((event:{data:unknown})=>void)|null=null;onerror:unknown;onmessageerror:unknown;
 engine?:NativeIccEngine;closed=false;
 constructor(private url:URL){NativeWorker.owners.push(this);}
 addEventListener(){}removeEventListener(){}
 postMessage(message:any){
  if(!String(this.url).includes('icc.worker'))return;
  void(async()=>{
   let reply:unknown;
   try{
    if(message.operation==='apply')reply={id:message.id,kind:'pixels',pixels:this.engine!.apply(message.pixels)};
    else{
     this.engine=await NativeIccEngine.create(wasm);if(this.closed){this.engine.dispose();return;}
     const bytes=new Uint8Array(await message.source.arrayBuffer());
     reply=message.operation==='inspect'?{id:message.id,kind:'report',report:this.engine.inspect(bytes)}:{id:message.id,kind:'prepared',prepared:this.engine.begin(bytes,message.settings)};
    }
   }catch(error){reply={id:message.id,kind:'error',error:error instanceof Error?error.message:'Native failure'};}
   if(!this.closed)this.onmessage?.({data:reply});
  })();
 }
 terminate(){this.closed=true;this.engine?.dispose();}
}
function install(){vi.stubGlobal('Worker',NativeWorker);}
afterEach(()=>{NativeWorker.owners.splice(0).forEach(owner=>owner.terminate());vi.unstubAllGlobals();});
function png(bytes:Uint8Array){
 const chunks=new Map<string,Uint8Array[]>();for(let at=8;at<bytes.length;){const view=new DataView(bytes.buffer,bytes.byteOffset+at),length=view.getUint32(0),type=new TextDecoder().decode(bytes.subarray(at+4,at+8));chunks.set(type,[...(chunks.get(type)??[]),bytes.slice(at+8,at+8+length)]);at+=12+length;}return chunks;
}
it('inspected resources own exact source bytes, keep reports private, reject forged/CMYK output and detect substituted persisted bytes',async()=>{
 install();const input=profileBytes.slice(),profile=await IccProfile.inspect(new Blob([input]),'Narrow');input.fill(0);
 expect(new Uint8Array(await profile.source.arrayBuffer())).toEqual(profileBytes);
 const report=profile.report;report.colorSpace='CMYK';report.outputIntents.length=0;expect(profile.report.colorSpace).toBe('RGB ');expect(profile.report.outputIntents.length).toBeGreaterThan(0);
 iccTarget(profile).report!.colorSpace='CMYK';expect(profile.report.colorSpace).toBe('RGB ');
 expect(()=>normalizeColorSettings({...DEFAULT_COLOR_SETTINGS,output:{...DEFAULT_COLOR_SETTINGS.output,profile:{...profile}as never}})).toThrow();
 const record=serializeColorSettings(normalizeColorSettings({...DEFAULT_COLOR_SETTINGS,output:{...DEFAULT_COLOR_SETTINGS.output,profile}}));
 const restored=await restoreColorSettings(structuredClone(record));expect(iccTarget(restored.output.profile).key).toBe(profile.sha256);
 const altered=structuredClone(record);if(altered.output.profile.kind!=='icc')throw new Error('Fixture');altered.output.profile.sha256='0'.repeat(64);await expect(restoreColorSettings(altered)).rejects.toThrow('fingerprint');
 const cmyk=await IccProfile.inspect(new Blob([await readFile('tests/fixtures/icc-native/synthetic-cmyk.icc')]));expect(()=>normalizeColorSettings({...DEFAULT_COLOR_SETTINGS,output:{...DEFAULT_COLOR_SETTINGS.output,profile:cmyk}})).toThrow('RGB output');
});
it('workspace v3 requires complete color settings and keeps earlier version links valid',()=>{
 const entry={project:new Blob(),selectedIds:[],view:{zoom:1,pan:{x:0,y:0},initialized:false}},workspace={savedAt:0,activeIndex:0,documents:[entry]};
 expect(workspaceSchema.safeParse({...workspace,version:3}).success).toBe(false);
 const documents=[{...entry,colorSettings:serializeColorSettings(DEFAULT_COLOR_SETTINGS)}];expect(workspaceSchema.parse({...workspace,version:3,documents}).documents[0].colorSettings).toBeDefined();
 expect(workspaceSchema.safeParse({...workspace,version:2,documents}).success).toBe(false);expect(workspaceSchema.parse({...workspace,version:2}).version).toBe(2);
});
it('host preflight cancellation, callbacks, superseding settings and tab changes leave document/history and prior preferences untouched',async()=>{
 install();const editor=new EditorApplication();
 try{
  const document=editor.document,before=document.getSnapshot(),settings=editor.colorSettings;
  const target=normalizeColorSettings({...settings,output:{...settings.output,profile:'display-p3'}});
  const abort=new AbortController();abort.abort();await expect(editor.setColorSettings(target,{signal:abort.signal})).rejects.toThrow();expect(editor.colorSettings).toBe(settings);
  await expect(editor.setColorSettings(target,{onProgress:()=>{throw new Error('callback failure');}})).rejects.toThrow('callback failure');expect(editor.colorSettings).toBe(settings);
  await expect(editor.setColorSettings(target,{onProgress:phase=>{if(phase==='preparing')editor.setColorProfile('linear-srgb');}})).rejects.toThrow('changed');expect(editor.colorSettings.output.profile).toBe('linear-srgb');
  editor.setColorProfile('srgb');await expect(editor.setColorSettings(target,{onProgress:phase=>{if(phase==='preparing')editor.newDocument();}})).rejects.toThrow('changed');expect(document.getSnapshot()).toBe(before);
  await editor.setColorSettings(target);expect(editor.colorSettings.output.profile).toBe('display-p3');expect(editor.document.getSnapshot().revision).toBe(0);
 }finally{editor.dispose();}
});
it('PNG converts straight RGB bytes before encoding, embeds exact ICC bytes and snapshots callback-mutated options',async()=>{
 install();const assets=new AssetStore(),document=new Document({width:2,height:1}),pixels=new Uint8ClampedArray([255,0,0,1,12,34,56,0]);const surfaces:any[]=[];
 const renderer={render:async()=>{const tile={width:2,height:1,getContext:()=>({getImageData:()=>({data:pixels.slice()})})};surfaces.push(tile);return tile;}};
 const color={profile:'display-p3' as const,intent:'relative-colorimetric' as const},engine=await NativeIccEngine.create(wasm);
 try{
  engine.begin(new Uint8Array(await iccTarget(color.profile).source.arrayBuffer()),{mode:'convert'});const expected=engine.apply(pixels);
  const options={format:'png' as const,color},result=await exportDocument(document._read(),assets,renderer as never,options,{onProgress:()=>{(color as {profile:string}).profile='linear-srgb';}}),chunks=png(new Uint8Array(await result.blob.arrayBuffer()));
  expect(chunks.has('sRGB')).toBe(false);const profile=chunks.get('iCCP')![0],zero=profile.indexOf(0);expect(new Uint8Array(inflateSync(profile.slice(zero+2)))).toEqual(new Uint8Array(await iccTarget('display-p3').source.arrayBuffer()));
  const raw=inflateSync(Buffer.concat(chunks.get('IDAT')!));expect([...raw.subarray(1)]).toEqual([...expected]);expect(expected[3]).toBe(1);expect(expected[7]).toBe(0);expect(surfaces.every(tile=>tile.width===0)).toBe(true);
  for(const format of ['svg','jpeg','webp','avif','psd','psb']as const){expect(()=>getExportCapabilityReport(document._read(),{format,color})).toThrow('PNG, TIFF and PDF');await expect(exportDocument(document._read(),assets,renderer as never,{format,color})).rejects.toThrow('PNG, TIFF and PDF');}
 }finally{engine.dispose();assets.dispose();}
});
it('a failed or superseded proof cannot publish a partially transformed frame or retain its owner',async()=>{
 install();const processor=new IccProofProcessor(),profile=await IccProfile.inspect(new Blob([profileBytes]));const proof=normalizeColorSettings({...DEFAULT_COLOR_SETTINGS,proof:{profile,intent:'relative-colorimetric',proofIntent:'relative-colorimetric',blackPointCompensation:false,gamutWarning:true,warningColor:'#ff00ff'}}).proof!;
 const writes:number[][]=[],surface={width:1,height:1,getContext:()=>({getImageData:()=>({data:new Uint8ClampedArray([255,0,0,87])}),putImageData:(image:{data:Uint8ClampedArray})=>writes.push([...image.data])})};
 try{await processor.apply(surface as never,proof);expect(writes).toEqual([[255,0,255,87]]);const pending=processor.apply(surface as never,proof,()=>true);await expect(pending).rejects.toThrow('superseded');expect(writes).toHaveLength(1);processor.reset();await processor.apply(surface as never,proof);expect(writes).toHaveLength(2);}
 finally{processor.reset();}
 const owner=await IccSession.prepare(new Blob([profileBytes]),{mode:'proof'});owner.session.dispose();
});
