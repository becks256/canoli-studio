import {encodePhotoshopStrip} from './photoshop-strip';

self.onmessage=(event:MessageEvent)=>{
 const {id,pixels,width,rows,encoding}=event.data;
 try{
  const channels=encodePhotoshopStrip(pixels,width,rows,encoding);
  self.postMessage({id,channels},{transfer:channels.map(channel=>channel.lengths.buffer)});
 }catch(error){self.postMessage({id,error:error instanceof Error?error.message:String(error)});}
};
