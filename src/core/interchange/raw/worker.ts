import {hasLensCorrection,validateLensGeometry} from './lens';
import factory from './codec/canoli_raw_decoder.js';
import wasmUrl from './codec/canoli_raw_decoder.wasm?url';
import {rawDecoder} from './codec';
import {rawDecodeOptionsSchema} from './types';
import {encodeRawWorkingImage} from './working-output';

let started=false;
self.onmessage=async(event:MessageEvent)=>{
  try{
    if(started)throw new Error('This RAW worker already owns a source.');started=true;
    const request=event.data;
    if(!request||!(request.blob instanceof Blob)||!['inspect','develop'].includes(request.mode)||Object.keys(request).some(key=>!['blob','mode','options'].includes(key)))throw new Error('Invalid RAW worker request.');
    const settings=rawDecodeOptionsSchema.parse(request.options);
    if(request.mode==='develop'&&!settings.allowPrecisionLoss)throw new Error('RAW working output requires explicit 8-bit precision-loss consent. Original sensor bytes remain separate.');
    self.postMessage({progress:{phase:'inspecting',fraction:null}});
    const module=await factory({locateFile:()=>wasmUrl}),decoder=rawDecoder(module);
    let last=0,lastPhase='';
    module.canoliRawProgress=(stage)=>{
      const phase=stage<=4?'inspecting':'developing',now=performance.now();
      if(phase!==lastPhase||now-last>=50){last=now;lastPhase=phase;self.postMessage({progress:{phase,fraction:null}});}
    };
    const bytes=new Uint8Array(await request.blob.arrayBuffer());
    if(request.mode==='inspect')self.postMessage({report:decoder.inspect(bytes,settings.development.image)});
    else{
      if(hasLensCorrection(settings.development.lens)){const report=decoder.inspect(bytes,settings.development.image);validateLensGeometry(settings.development.lens!,report.displayWidth,report.displayHeight);}
      const image=decoder.develop(bytes,settings.development),report=image.report;
      const png=await encodeRawWorkingImage(image,fraction=>self.postMessage({progress:{phase:'encoding',fraction}}),settings.development.lens);
      self.postMessage({report,png});
    }
  }catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)});}
};
