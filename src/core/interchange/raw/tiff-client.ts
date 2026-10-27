import{validateIccSamples}from'../../color/icc-types';
import{TiffReader}from'../tiff/inspect';
import{hasLensCorrection}from'./lens';
import{rawTiffHash,rawTiffSettingsHash,rawTiffResultSchema,rawTiffProgressSchema,type RawTiffSettings,type RawTiffResult,type RawTiffControl}from'./tiff-types';
import rawBuild from'./codec/build.json' with{type:'json'};
import lensBuild from'../lens/codec/build.json' with{type:'json'};
import iccBuild from'../../color/codec/build.json' with{type:'json'};
async function decodedTile(source:Blob,length:number,signal?:AbortSignal):Promise<Uint8Array<ArrayBuffer>>{
 const reader=source.stream().pipeThrough(new DecompressionStream('deflate')).getReader(),output=new Uint8Array(length);let at=0;
 try{for(;;){signal?.throwIfAborted();const{done,value}=await reader.read();if(done)break;if(value.length>length-at)throw new Error('RAW TIFF compressed tile exceeds its sample geometry.');output.set(value,at);at+=value.length;}if(at!==length)throw new Error('RAW TIFF compressed tile has incomplete sample geometry.');return output;}
 finally{try{await reader.cancel();}catch{/* Preserve the decoding failure. */}reader.releaseLock();}
}
export async function validateRawTiffResult(value:unknown,source:Blob,settings:RawTiffSettings,signal?:AbortSignal,onProgress?:(fraction:number)=>void):Promise<RawTiffResult>{
 signal?.throwIfAborted();const result=rawTiffResultSchema.parse(value),{report,receipt,tiff}=result;
 if(report.image!==settings.development.image||!report.canDevelop||report.hasExtraSamples||!report.hasColorMatrix||report.unsupported.length>0||settings.development.whiteBalance==='camera'&&!report.hasCameraWhiteBalance&&report.channels>1||report.displayWidth!==receipt.width||report.displayHeight!==receipt.height||tiff.type!=='image/tiff'||receipt.sourceBytes!==source.size||receipt.sourceSpace!=='linear-srgb16'||receipt.sampleFormat!==settings.sampleFormat||receipt.profileSha256!==settings.color.profile.sha256||receipt.profileBytes!==settings.color.profile.source.size||receipt.profileName!==settings.color.profile.name||receipt.intent!==settings.color.intent||receipt.blackPointCompensation!==settings.color.blackPointCompensation||receipt.rawWasmSha256!==rawBuild.artifacts['canoli_raw_decoder.wasm'].sha256||receipt.iccWasmSha256!==iccBuild.artifacts['canoli_icc.wasm'].sha256)throw new Error('RAW TIFF result differs from its source, development or color contract.');
 const calibrated=hasLensCorrection(settings.development.lens)&&!!settings.development.lens?.profile;
 if(receipt.lensWasmSha256!==(calibrated?lensBuild.artifacts['canoli_lens_correction.wasm'].sha256:undefined)||receipt.settingsSha256!==await rawTiffSettingsHash(settings)||receipt.sourceSha256!==await rawTiffHash(await source.arrayBuffer())||receipt.profileSha256!==await rawTiffHash(await settings.color.profile.source.arrayBuffer()))throw new Error('RAW TIFF conversion receipt differs from the captured source/settings/engines.');
 signal?.throwIfAborted();const reader=new TiffReader(tiff),first=await reader.header(),directory=await reader.directory(first),fields=directory.fields;
 if(directory.next||!reader.little||settings.variant==='classic'&&reader.big||settings.variant==='big'&&!reader.big)throw new Error('RAW TIFF container differs from its requested layout.');
 const values=async(tag:number,expected:number[])=>{const f=fields.get(tag);if(!f||f.count!==expected.length)throw new Error('RAW TIFF has an invalid sample/directory field.');for(let i=0;i<expected.length;i++)if(await f.value(i)!==expected[i])throw new Error('RAW TIFF sample/directory field does not match its receipt.');};
 await values(256,[receipt.width]);await values(257,[receipt.height]);await values(258,Array(4).fill(settings.sampleFormat==='rgba16'?16:32));
 for(const[tag,value]of[[259,8],[262,2],[274,1],[277,4],[284,1],[338,2]]as const)await values(tag,[value]);
 await values(339,Array(4).fill(settings.sampleFormat==='rgba16'?1:3));
 const tw=Math.min(2048,Math.ceil(receipt.width/16)*16),th=Math.min(64,Math.ceil(receipt.height/16)*16);await values(322,[tw]);await values(323,[th]);
 const count=Math.ceil(receipt.width/tw)*Math.ceil(receipt.height/th),offsets=fields.get(324),counts=fields.get(325),profile=fields.get(34675);
 if(offsets?.count!==count||counts?.count!==count||profile?.type!==7||profile.count!==settings.color.profile.source.size)throw new Error('RAW TIFF pixel tables/profile differ from the accepted geometry/source.');
 let end=reader.big?16:8;
 for(let i=0;i<count;i++){signal?.throwIfAborted();const offset=await offsets.value(i),bytes=await counts.value(i);if(offset!==end||!bytes||!Number.isSafeInteger(offset+bytes)||offset+bytes>first)throw new Error('RAW TIFF has invalid pixel payload extents.');end=Math.ceil((offset+bytes)/8)*8;
  const decoded=await decodedTile(tiff.slice(offset,offset+bytes),tw*th*4*(settings.sampleFormat==='rgba16'?2:4),signal);signal?.throwIfAborted();
  validateIccSamples(settings.sampleFormat==='rgba16'?new Uint16Array(decoded.buffer):new Float32Array(decoded.buffer),settings.sampleFormat);onProgress?.((i+1)/count);signal?.throwIfAborted();
 }
 if(end!==first)throw new Error('RAW TIFF has an unaccounted pixel payload.');
 for(let at=0;at<profile.count;at+=65536){signal?.throwIfAborted();const length=Math.min(65536,profile.count-at),actual=await reader.bytes(profile.address+at,length),expected=new Uint8Array(await settings.color.profile.source.slice(at,at+length).arrayBuffer());if(actual.length!==expected.length||!actual.every((v,i)=>v===expected[i]))throw new Error('RAW TIFF did not embed the complete original target ICC profile.');}
 signal?.throwIfAborted();return result;
}
export function runRawTiffWorker(source:Blob,settings:RawTiffSettings,control:RawTiffControl):Promise<RawTiffResult>{
 control.signal?.throwIfAborted();if(typeof Worker==='undefined')return Promise.reject(new Error('RAW TIFF delivery requires the browser worker host.'));
 return new Promise((resolve,reject)=>{
  let worker:Worker;try{worker=new Worker(new URL('./tiff.worker.ts',import.meta.url),{type:'module'});}catch(error){reject(error);return;}
  let settled=false,received=false,terminated=false;
  const terminate=()=>{if(!terminated){terminated=true;try{worker.terminate();}catch{/* Host lease still releases. */}}};
  const cleanup=()=>{terminate();worker.onmessage=null;worker.onerror=null;worker.onmessageerror=null;control.signal?.removeEventListener('abort',cancel);};
  const fail=(error:unknown)=>{if(settled)return;settled=true;cleanup();reject(error);},cancel=()=>fail(control.signal?.reason??new DOMException('RAW TIFF delivery cancelled','AbortError'));
  worker.onmessage=event=>{
   if(settled||received)return;try{
    const data=event.data;if(data&&typeof data.error==='string')throw new Error(data.error);
    if(data&&'progress'in data){control.onProgress?.(rawTiffProgressSchema.parse(data.progress));control.signal?.throwIfAborted();return;}
    received=true;terminate();control.onProgress?.({phase:'verifying',fraction:0});control.signal?.throwIfAborted();void validateRawTiffResult(data,source,settings,control.signal,fraction=>{control.onProgress?.({phase:'verifying',fraction});control.signal?.throwIfAborted();}).then(result=>{if(settled)return;settled=true;cleanup();resolve(result);},fail);
   }catch(error){fail(error);}
  };
  worker.onerror=()=>fail(new Error('RAW TIFF worker failed. Check source, codec availability and device memory.'));worker.onmessageerror=()=>fail(new Error('Invalid RAW TIFF worker message.'));
  control.signal?.addEventListener('abort',cancel,{once:true});try{control.signal?.throwIfAborted();worker.postMessage({blob:source,settings});}catch(error){fail(error);}
 });
}
