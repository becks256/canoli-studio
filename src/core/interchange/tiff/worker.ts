import {inspectTiff} from './inspect';
import {decodeTiff} from './decode';
import {tiffDecodeOptionsSchema} from './types';
self.onmessage=async(event:MessageEvent)=>{
 try{const {blob,mode,options}=event.data;if(!(blob instanceof Blob)||!['inspect','decode'].includes(mode))throw new Error('Invalid TIFF worker request.');
  if(mode==='inspect'){const inspected=await inspectTiff(blob,()=>self.postMessage({progress:{phase:'inspecting',fraction:null}}));self.postMessage({report:inspected.report});}
  else{const decoded=await decodeTiff(blob,tiffDecodeOptionsSchema.parse(options),fraction=>self.postMessage({progress:{phase:'decoding',fraction}}));self.postMessage(decoded);}
 }catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)});}
};
