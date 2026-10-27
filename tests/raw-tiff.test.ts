import{beforeAll,afterAll,it,expect,vi,afterEach}from'vitest';
import{readFile,writeFile,mkdtemp,rm}from'node:fs/promises';
import{tmpdir}from'node:os';
import{join}from'node:path';
import{spawnSync}from'node:child_process';
import createRaw from'../src/core/interchange/raw/codec/canoli_raw_decoder.js';
import{rawDecoder}from'../src/core/interchange/raw/codec';
import{NativeIccEngine}from'../src/core/color/icc-native';
import{iccTarget}from'../src/core/color/profile-source';
import{rawTiffHash,rawTiffSettingsSchema,rawTiffSettingsHash,type RawTiffSettings,type RawTiffResult}from'../src/core/interchange/raw/tiff-types';
import{encodeRawTiffImage,prepareRawTiffTransform}from'../src/core/interchange/raw/tiff-output';
import{validateRawTiffResult}from'../src/core/interchange/raw/tiff-client';
import{TiffReader}from'../src/core/interchange/tiff/inspect';
import{deflateSync}from'node:zlib';
import{planTiffDirectory}from'../src/core/tiff';
import{TiffTileEncoder}from'../src/core/tiff-encoder';
import{exportRawTiffFile,inspectRawFile}from'../src/core/interchange/raw/client';
import{acquireIccOwner}from'../src/core/color/icc-client';
import rawBuild from'../src/core/interchange/raw/codec/build.json';
import iccBuild from'../src/core/color/codec/build.json';
let decoder:ReturnType<typeof rawDecoder>,engine:NativeIccEngine,source:Blob,settings:RawTiffSettings,valid:RawTiffResult;
beforeAll(async()=>{
 decoder=rawDecoder(await createRaw({wasmBinary:new Uint8Array(await readFile('src/core/interchange/raw/codec/canoli_raw_decoder.wasm'))}));engine=await NativeIccEngine.create(new Uint8Array(await readFile('src/core/color/codec/canoli_icc.wasm')));
 source=new Blob([new Uint8Array(await readFile('tests/fixtures/raw/bayer-rggb.dng'))],{type:'image/x-adobe-dng'});settings=await options('linear-srgb');valid=await encode(source,settings);
});
afterAll(()=>engine?.dispose());afterEach(()=>vi.unstubAllGlobals());
async function options(target:'linear-srgb'|'display-p3'='linear-srgb',sampleFormat:'rgba16'|'rgba-float32'='rgba16',extra:Record<string,unknown>={}):Promise<RawTiffSettings>{const profile=iccTarget(target);return rawTiffSettingsSchema.parse({color:{version:1,profile:{name:profile.name,sha256:await rawTiffHash(await profile.source.arrayBuffer()),source:profile.source},intent:'relative-colorimetric',blackPointCompensation:false},sampleFormat,...extra});}
async function encode(blob:Blob,value:RawTiffSettings):Promise<RawTiffResult>{
 const{profile,prepared}=await prepareRawTiffTransform(value,engine),bytes=new Uint8Array(await blob.arrayBuffer()),image=decoder.develop(bytes,value.development),report=image.report,tiff=await encodeRawTiffImage(image,value,engine,profile);
 return{report,tiff,receipt:{version:1,sourceSpace:'linear-srgb16',sourceSha256:await rawTiffHash(bytes),sourceBytes:blob.size,settingsSha256:await rawTiffSettingsHash(value),rawWasmSha256:rawBuild.artifacts['canoli_raw_decoder.wasm'].sha256,iccWasmSha256:iccBuild.artifacts['canoli_icc.wasm'].sha256,profileSha256:value.color.profile.sha256,profileBytes:profile.length,profileName:value.color.profile.name,intent:value.color.intent,blackPointCompensation:value.color.blackPointCompensation,sampleFormat:value.sampleFormat,width:image.width,height:image.height,usesIntentFallback:prepared.usesIntentFallback,warnings:prepared.warnings}};
}
for(const[target,format,variant]of[['linear-srgb','rgba16','classic'],['display-p3','rgba16','big'],['display-p3','rgba-float32','classic'],['linear-srgb','rgba-float32','big']]as const)it(`native RAW -> ${target} ${format} ${variant} preserves every independently decoded sample`,async()=>{
 const value=await options(target,format,{variant}),result=await encode(source,value);expect(await validateRawTiffResult(result,source,value)).toMatchObject({receipt:{sampleFormat:format,width:64,height:48}});
 const temporary=await mkdtemp(join(tmpdir(),'canoli-raw-tiff-unit-'));try{
  const path=join(temporary,'output.tif');await writeFile(path,new Uint8Array(await result.tiff.arrayBuffer()));const check=spawnSync('python3',['scripts/check-raw-tiff.py',path,'--rgb16','tests/fixtures/raw/bayer-rggb.rgb16le','--width','64','--height','48','--profile','tests/fixtures/icc-native/'+target+'.icc','--native-lcms','/tmp/canoli-color-lcms2.19.1-native.so',...(format==='rgba-float32'?['--float']:[])],{encoding:'utf8'});expect(check.status,check.stderr||check.stdout).toBe(0);const independent=JSON.parse(check.stdout);expect(independent.maximumAlphaError).toBe(0);expect(independent.maximumColorError).toBeLessThanOrEqual(format==='rgba16'?0:2e-6);expect(independent.samplesCompared).toBe(64*48*4);
 }finally{await rm(temporary,{recursive:true,force:true});}
});
it('the generic TIFF encoder preserves genuine sub-byte integer and finite extended float samples',async()=>{
 for(const format of ['rgba16','rgba-float32']as const){const encoder=new TiffTileEncoder(16,16,'classic',undefined,format),samples=format==='rgba16'?new Uint16Array(1024):new Float32Array(1024);for(let i=0;i<256;i++)samples.set(format==='rgba16'?[i*16,i*16+1,i*16+2,65535-i]:[-.125,2,.50001+i*.000001,.625],i*4);await encoder.append(samples);const blob=encoder.finish(),reader=new TiffReader(blob),directory=await reader.directory(await reader.header()),offset=await directory.fields.get(324)!.value(),size=await directory.fields.get(325)!.value(),bytes=await new Response(blob.slice(offset,offset+size).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer();expect(new Uint8Array(bytes)).toEqual(new Uint8Array(samples.buffer));}
});
it('invalid typed samples, nonfinite float and alpha reject before a file is published',async()=>{
 const encoder=new TiffTileEncoder(16,16,'classic',undefined,'rgba-float32');await expect(encoder.append(new Uint16Array(1024))).rejects.toThrow();const samples=new Float32Array(1024);samples[3]=2;await expect(encoder.append(samples)).rejects.toThrow();samples[3]=1;samples[0]=NaN;await expect(encoder.append(samples)).rejects.toThrow();expect(()=>encoder.finish()).toThrow('Incomplete');
});
for(const field of ['sourceSha256','settingsSha256','profileSha256','rawWasmSha256','iccWasmSha256','sampleFormat','width','lensWasmSha256']as const)it('rejects a mismatched conversion receipt '+field,async()=>{
 const receipt={...valid.receipt,[field]:field==='sampleFormat'?'rgba-float32':field==='width'?65:'0'.repeat(64)};await expect(validateRawTiffResult({...valid,receipt},source,settings)).rejects.toThrow();
});
it('validates actual embedded ICC bytes and every compressed tile rather than accepting labels',async()=>{
 const bytes=new Uint8Array(await valid.tiff.arrayBuffer()),reader=new TiffReader(valid.tiff),directory=await reader.directory(await reader.header()),profile=directory.fields.get(34675)!;
 const changed=bytes.slice();changed[profile.address+100]^=1;await expect(validateRawTiffResult({...valid,tiff:new Blob([changed],{type:'image/tiff'})},source,settings)).rejects.toThrow('complete original');
 const corrupt=bytes.slice(),offset=await directory.fields.get(324)!.value();corrupt[offset]=0;await expect(validateRawTiffResult({...valid,tiff:new Blob([corrupt],{type:'image/tiff'})},source,settings)).rejects.toThrow();
 const hashWrong={...settings,color:{...settings.color,profile:{...settings.color.profile,source:new Blob([changed.subarray(profile.address,profile.address+profile.count)])}}};await expect(validateRawTiffResult(valid,source,hashWrong)).rejects.toThrow();
});
it('bounded RAW TIFF conversion releases the image on callback failure before publishing a file',async()=>{
 const value=await options(),prepared=await prepareRawTiffTransform(value,engine),image=decoder.develop(new Uint8Array(await source.arrayBuffer())),dispose=vi.fn(()=>image.dispose()),owned={...image,dispose};await expect(encodeRawTiffImage(owned,value,engine,prepared.profile,()=>{throw new Error('Progress failed');})).rejects.toThrow('Progress failed');expect(dispose).toHaveBeenCalledTimes(1);
});
class MockWorker{
 static instances:MockWorker[]=[];static posted:(worker:MockWorker)=>void=worker=>queueMicrotask(()=>worker.reply(valid));
 onmessage:((event:{data:unknown})=>void)|null=null;onerror:(()=>void)|null=null;onmessageerror:(()=>void)|null=null;terminations=0;request:any;
 constructor(readonly url:URL){MockWorker.instances.push(this);}postMessage(value:unknown){this.request=value;MockWorker.posted(this);}terminate(){this.terminations++;}reply(data:unknown){this.onmessage?.({data});}
}
function mock(posted=MockWorker.posted){MockWorker.instances=[];MockWorker.posted=posted;vi.stubGlobal('Worker',MockWorker);}
it('client result/callback errors and cancellation release both native ownership pools',async()=>{
 mock(worker=>queueMicrotask(()=>worker.reply(valid)));const progress:string[]=[];expect((await exportRawTiffFile(source,settings,{onProgress:p=>progress.push(p.phase)})).receipt.sourceSha256).toBe(valid.receipt.sourceSha256);expect(progress).toContain('verifying');expect(MockWorker.instances[0].terminations).toBe(1);
 for(const phase of ['waiting','verifying']as const){await expect(exportRawTiffFile(source,settings,{onProgress:p=>{if(p.phase===phase)throw new Error('Callback failed');}})).rejects.toThrow('Callback failed');}
 mock(()=>{});const abort=new AbortController(),pending=exportRawTiffFile(source,settings,{signal:abort.signal});await vi.waitFor(()=>expect(MockWorker.instances).toHaveLength(1));abort.abort();await expect(pending).rejects.toThrow();expect(MockWorker.instances[0].terminations).toBe(1);
 mock(worker=>queueMicrotask(()=>worker.reply(valid)));await expect(exportRawTiffFile(source,settings)).resolves.toHaveProperty('tiff');
});
it('RAW TIFF waits behind ordinary RAW inspection and queued cancellation allocates no worker',async()=>{
 mock(()=>{});const inspect=inspectRawFile(source);await vi.waitFor(()=>expect(MockWorker.instances).toHaveLength(1));const abort=new AbortController(),queued=exportRawTiffFile(source,settings,{signal:abort.signal});abort.abort();await expect(queued).rejects.toThrow();expect(MockWorker.instances).toHaveLength(1);MockWorker.instances[0].reply({report:valid.report});await inspect;
 mock(worker=>queueMicrotask(()=>worker.reply(valid)));await expect(exportRawTiffFile(source,settings)).resolves.toHaveProperty('tiff');
});

it('a TIFF job cannot allocate a third native ICC owner and cancelling that wait releases the RAW queue',async()=>{
 mock(worker=>queueMicrotask(()=>worker.reply({report:valid.report})));const first=await acquireIccOwner(),second=await acquireIccOwner();
 try{const abort=new AbortController(),pending=exportRawTiffFile(source,settings,{signal:abort.signal});await new Promise(resolve=>setTimeout(resolve,20));expect(MockWorker.instances).toHaveLength(0);abort.abort();await expect(pending).rejects.toThrow();expect((await inspectRawFile(source)).displayWidth).toBe(64);expect(MockWorker.instances).toHaveLength(1);}finally{first();second();}
});
it('TIFF samples use bounded native source rectangles without full-width or full-frame readback',async()=>{
 const value=await options(),prepared=await prepareRawTiffTransform(value,engine),regions:number[][]=[],dispose=vi.fn(),image={width:10000,height:128,channels:3 as const,report:valid.report,readRows(){throw new Error('Full-row reads are not allowed');},readRegion(x:number,y:number,w:number,h:number){regions.push([x,y,w,h]);return new Uint16Array(w*h*3).fill(12345);},dispose};
 await encodeRawTiffImage(image,value,engine,prepared.profile);expect(dispose).toHaveBeenCalledTimes(1);expect(regions.reduce((sum,[,,w,h])=>sum+w*h,0)).toBe(1280000);expect(Math.max(...regions.map(([,,w,h])=>w*h*8))).toBeLessThanOrEqual(2048*64*8);
});

it('manual lens-corrected integer TIFF retains native color and established coverage against independent NumPy/libtiff',async()=>{
 const lens={enabled:true,scale:1.1,center:{x:.48,y:.52},distortion:{k1:-.06,k2:.008,k3:.001},chromatic:{red:.998,blue:1.002},vignette:{k1:-.15,k2:.03}},value=await options('linear-srgb','rgba16',{development:{lens}}),result=await encode(source,value),temporary=await mkdtemp(join(tmpdir(),'canoli-raw-tiff-lens-'));
 try{const path=join(temporary,'lens.tif'),settingsPath=join(temporary,'lens.json');await writeFile(path,new Uint8Array(await result.tiff.arrayBuffer()));await writeFile(settingsPath,JSON.stringify(lens));const checked=spawnSync('python3',['scripts/check-raw-tiff.py',path,'--rgb16','tests/fixtures/raw/bayer-rggb.rgb16le','--width','64','--height','48','--profile','tests/fixtures/icc-native/linear-srgb.icc','--native-lcms','/tmp/canoli-color-lcms2.19.1-native.so','--lens-json',settingsPath],{encoding:'utf8'});expect(checked.status,checked.stderr||checked.stdout).toBe(0);const reference=JSON.parse(checked.stdout);expect(reference.maximumAlphaError).toBe(0);expect(reference.maximumColorError).toBeLessThanOrEqual(1);}finally{await rm(temporary,{recursive:true,force:true});}
});
it('native calibrated lens samples retain exact source coordinates across offset rectangles',async()=>{
 const{default:createLens}=await import('../src/core/interchange/lens/codec/canoli_lens_correction.js'),{prepareRawLens}=await import('../src/core/interchange/raw/profile'),{rawLensSampler}=await import('../src/core/interchange/raw/lens-sampler'),{lensCorrectionSchema}=await import('../src/core/interchange/raw/lens');
 const fixture=JSON.parse(await readFile('tests/fixtures/raw-profile/manifest.json','utf8')).cases[0],lens=lensCorrectionSchema.parse(fixture.options),bytes=new Uint8Array(await source.arrayBuffer()),report=decoder.inspect(bytes),lensBytes=new Uint8Array(await readFile('src/core/interchange/lens/codec/canoli_lens_correction.wasm')),profile=await prepareRawLens(lens,report,()=>createLens({wasmBinary:lensBytes})),image=decoder.develop(bytes),sampler=rawLensSampler(image,lens,profile);
 try{const full=sampler.rows(0,image.height),pixels=new Uint16Array(full.pixels.length),alpha=new Uint8Array(full.alpha.length);for(let y=0;y<image.height;y+=7)for(let x=0;x<image.width;x+=13){const width=Math.min(13,image.width-x),height=Math.min(7,image.height-y),region=sampler.region(x,y,width,height);for(let row=0;row<height;row++){pixels.set(region.pixels.subarray(row*width*3,(row+1)*width*3),((y+row)*image.width+x)*3);alpha.set(region.alpha.subarray(row*width,(row+1)*width),(y+row)*image.width+x);}}expect(pixels).toEqual(full.pixels);expect(alpha).toEqual(full.alpha);}finally{sampler.dispose();image.dispose();profile?.dispose();}
});

for(const change of[{hasExtraSamples:true},{hasColorMatrix:false},{hasCameraWhiteBalance:false},{unsupported:['Unsupported source calibration']}])it('contradictory native source reports cannot certify TIFF delivery '+JSON.stringify(change),async()=>{await expect(validateRawTiffResult({...valid,report:{...valid.report,...change}},source,settings)).rejects.toThrow();});
for(const change of[{intent:'perceptual'},{blackPointCompensation:true},{profileName:'Relabeled profile'}])it('actual output receipt settings cannot be relabeled '+JSON.stringify(change),async()=>{await expect(validateRawTiffResult({...valid,receipt:{...valid.receipt,...change}},source,settings)).rejects.toThrow();});
it('oversized Deflate expansion and nonfinite float samples reject within the fixed tile allocation',async()=>{
 for(const kind of['oversized','nonfinite']as const){const value=kind==='oversized'?settings:await options('linear-srgb','rgba-float32'),result=kind==='oversized'?valid:await encode(source,value),profile=new Uint8Array(await value.color.profile.source.arrayBuffer()),length=64*48*4*(kind==='oversized'?2:4),raw=new Uint8Array(length+(kind==='oversized'?1:0));if(kind==='nonfinite')new DataView(raw.buffer).setFloat32(0,NaN,true);const compressed=new Uint8Array(deflateSync(raw)),padding=new Uint8Array((8-compressed.length%8)%8),plan=planTiffDirectory({width:64,height:48,tileWidth:64,tileHeight:48,offsets:[0],counts:[compressed.length],payloadBytes:compressed.length+padding.length,profile,sampleFormat:value.sampleFormat}),tiff=new Blob([plan.header,compressed,padding,plan.directory],{type:'image/tiff'});await expect(validateRawTiffResult({...result,tiff},source,value)).rejects.toThrow();}
});
