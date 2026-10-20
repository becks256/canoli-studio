import {parsePsdAsync,getPsdCapabilityReport} from '../core/interchange/psd/parser';
import {psdToDocumentAsync} from '../core/interchange/psd/bridge';
import {isPhotoshopGroupOnlyDocument,photoshopOptionsSchema} from '../core/photoshop-import';
import {PngRowEncoder} from '../core/png-stream';

self.onmessage=async(event:MessageEvent)=>{
 try{
  const {blob,mode}=event.data,options=photoshopOptionsSchema.parse(event.data.options);
  if(!(blob instanceof Blob)||!['inspect','decode'].includes(mode))throw new Error('Invalid Photoshop import request.');
  self.postMessage({progress:{phase:mode==='inspect'?'inspecting':'decoding',fraction:null}});
  const bytes=new Uint8Array(await blob.arrayBuffer());
  if(mode==='inspect'){
   const parsed=await parsePsdAsync(bytes,options),report=getPsdCapabilityReport(parsed);
   // No ImageData, resource views or complete input buffers cross preflight.
   const layers=parsed.layers.map(({name,width,height,blendModeKey,opacity,isGroup,isGroupEnd})=>({name,width,height,blendModeKey,opacity,isGroup,isGroupEnd}));
   self.postMessage({inspection:{version:1,header:parsed.header,layers,resolution:parsed.resolution,report}});return;
  }
  const result=await psdToDocumentAsync(bytes,options),entries=[];
  if(!result.assets.size&&(!result.report.canImportAsLayers||!isPhotoshopGroupOnlyDocument(result.document)))throw new Error('This Photoshop file has no supported decoded pixels or editable folders.');
  let index=0;
  for(const [id,image] of result.assets){
   const encoder=new PngRowEncoder(image.width,image.height),rows=Math.max(1,Math.min(64,Math.floor(4_000_000/(image.width*4+1))));
   try{
    for(let y=0;y<image.height;y+=rows){const count=Math.min(rows,image.height-y);await encoder.append(new Uint8Array(image.data.buffer,image.data.byteOffset+y*image.width*4,count*image.width*4),count);self.postMessage({progress:{phase:'encoding',fraction:(index+(y+count)/image.height)/result.assets.size}});}
    const png=await encoder.finish();entries.push({id,width:image.width,height:image.height,png,pixels:image.data});index++;
   }catch(error){await encoder.abort(error);throw error;}
  }
  self.postMessage({decoded:{document:result.document,report:result.report,entries}},{transfer:entries.map(entry=>entry.pixels.buffer)});
 }catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)});}
};
