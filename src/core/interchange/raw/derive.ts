import {parseRawDevelopmentOptions,type RawDecodeOptions,type RawImportControl} from './types';
import {rawBlobHash,ownRawSource} from './source';
import {validateRawDevelopmentResult,type RawDeveloped} from './result';
import build from './codec/build.json';

export type RawDeveloper=(blob:Blob,options:RawDecodeOptions,control:RawImportControl)=>Promise<RawDeveloped>;
/** Host-independent provenance and content validation; execution remains a private host job. */
export async function prepareRawDerivation(blob:Blob,name:string,options:RawDecodeOptions,control:RawImportControl,check:()=>void,develop:RawDeveloper){
  const settings=parseRawDevelopmentOptions(options),current=()=>{check();control.signal?.throwIfAborted();};current();
  const result=await validateRawDevelopmentResult(await develop(blob,settings,{signal:control.signal,onProgress:p=>{current();control.onProgress?.(p);current();}}),settings);current();
  const source=ownRawSource({version:1,original:{name,type:blob.type,byteLength:blob.size,sha256:await rawBlobHash(blob,current)},originalBlob:blob,settings,report:result.report,
    nativeWasmSha256:build.artifacts['canoli_raw_decoder.wasm'].sha256,...(result.lensWasmSha256?{lensWasmSha256:result.lensWasmSha256}:{}),outputSha256:await rawBlobHash(result.png,current)});
  current();return{png:result.png,source};
}
