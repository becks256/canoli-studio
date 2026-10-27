import{z}from'zod';
import factory from'./codec/canoli_raw_decoder.js';
import wasmUrl from'./codec/canoli_raw_decoder.wasm?url';
import rawBuild from'./codec/build.json';
import lensBuild from'../lens/codec/build.json';
import lensWasmUrl from'../lens/codec/canoli_lens_correction.wasm?url';
import iccBuild from'../../color/codec/build.json';
import{rawDecoder}from'./codec';
import{NativeIccEngine}from'../../color/icc-native';
import{prepareRawLens}from'./profile';
import{hasLensCorrection}from'./lens';
import{rawTiffSettingsSchema,rawTiffHash,rawTiffSettingsHash}from'./tiff-types';
import{encodeRawTiffImage,prepareRawTiffTransform}from'./tiff-output';
const requestSchema=z.object({blob:z.instanceof(Blob),settings:rawTiffSettingsSchema}).strict();let started=false;
self.onmessage=async(event:MessageEvent)=>{
 let engine:NativeIccEngine|undefined;
 try{
  if(started)throw new Error('This RAW TIFF worker already owns a source.');started=true;const{blob,settings}=requestSchema.parse(event.data);
  self.postMessage({progress:{phase:'inspecting',fraction:null}});engine=await NativeIccEngine.create();const{profile:outputProfile,prepared}=await prepareRawTiffTransform(settings,engine);
  const module=await factory({locateFile:()=>wasmUrl}),decoder=rawDecoder(module);let last=0,lastPhase='';module.canoliRawProgress=stage=>{const phase=stage<=4?'inspecting':'developing',now=performance.now();if(phase!==lastPhase||now-last>=50){last=now;lastPhase=phase;self.postMessage({progress:{phase,fraction:null}});}};
  const bytes=new Uint8Array(await blob.arrayBuffer()),sourceSha256=await rawTiffHash(bytes),settingsSha256=await rawTiffSettingsHash(settings),sourceReport=decoder.inspect(bytes,settings.development.image);
  if(!sourceReport.canDevelop||sourceReport.hasExtraSamples||!sourceReport.hasColorMatrix||sourceReport.unsupported.length>0||settings.development.whiteBalance==='camera'&&!sourceReport.hasCameraWhiteBalance&&sourceReport.channels>1)throw new Error('RAW TIFF requires supported calibrated development and an available selected white balance.');
  const lensProfile=hasLensCorrection(settings.development.lens)?await prepareRawLens(settings.development.lens,sourceReport,async()=>{const{default:createLens}=await import('../lens/codec/canoli_lens_correction.js');return createLens({locateFile:()=>lensWasmUrl});}):undefined;
  try{
   const image=decoder.develop(bytes,settings.development),report=image.report,tiff=await encodeRawTiffImage(image,settings,engine,outputProfile,fraction=>self.postMessage({progress:{phase:'encoding',fraction}}),lensProfile);
   self.postMessage({report,tiff,receipt:{version:1,sourceSpace:'linear-srgb16',sourceSha256,sourceBytes:blob.size,settingsSha256,rawWasmSha256:rawBuild.artifacts['canoli_raw_decoder.wasm'].sha256,...(lensProfile?{lensWasmSha256:lensBuild.artifacts['canoli_lens_correction.wasm'].sha256}:{}),iccWasmSha256:iccBuild.artifacts['canoli_icc.wasm'].sha256,profileSha256:settings.color.profile.sha256,profileBytes:outputProfile.length,profileName:settings.color.profile.name,intent:settings.color.intent,blackPointCompensation:settings.color.blackPointCompensation,sampleFormat:settings.sampleFormat,width:image.width,height:image.height,usesIntentFallback:prepared.usesIntentFallback,warnings:prepared.warnings}});
  }finally{lensProfile?.dispose();}
 }catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)});}
 finally{engine?.dispose();}
};
