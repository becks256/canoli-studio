import factory from './codec/canoli_avif_decoder.js';
import wasmUrl from './codec/canoli_avif_decoder.wasm?url';
import {avifDecoder} from './codec';
import {inspectAvifInput} from './inspect';
import {decodeAvifInput,assertAvifImportAllowed} from './decode';
import {avifDecodeOptionsSchema} from './types';

let started=false;
self.onmessage=async(event:MessageEvent)=>{
  try{
    if(started)throw new Error('This AVIF worker already owns an import.');started=true;
    const request=event.data;
    if(!request||!(request.blob instanceof Blob)||!['inspect','decode'].includes(request.mode)||Object.keys(request).some(key=>!['blob','mode','options'].includes(key)))throw new Error('Invalid AVIF worker request.');
    const settings=avifDecodeOptionsSchema.parse(request.options);
    self.postMessage({progress:{phase:'inspecting',fraction:null}});
    if(request.mode==='inspect')self.postMessage({report:(await inspectAvifInput(request.blob)).report});
    else{
      assertAvifImportAllowed((await inspectAvifInput(request.blob)).report,settings);
      const decoder=avifDecoder(await factory({locateFile:()=>wasmUrl}));
      self.postMessage(await decodeAvifInput(request.blob,decoder,settings,fraction=>self.postMessage({progress:{phase:'decoding',fraction}})));
    }
  }catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)});}
};
