import{describeFloatSource,prepareFloatTiles}from'./prepare';
import{tileCount,type FloatSourceInput}from'./types';
let resume:((value:unknown)=>void)|undefined;
self.onmessage=event=>{
 if(event.data?.kind==='continue'||event.data?.kind==='ack'){const next=resume;resume=undefined;next?.(event.data);return;}
 if(event.data?.kind!=='start')return;
 void(async()=>{try{
  const described=await describeFloatSource(event.data.input as FloatSourceInput,{onProgress:progress=>self.postMessage({kind:'progress',progress})});
  const pending=new Promise(resolve=>{resume=resolve;});self.postMessage({kind:'descriptor',descriptor:described.descriptor,key:described.key});await pending;
  let count=0;
  for await(const value of prepareFloatTiles(described)){
   if(value.kind==='prepared')self.postMessage({kind:'prepared',prepared:value.prepared});
   else{const ready=new Promise(resolve=>{resume=resolve;});self.postMessage({kind:'tile',tile:value.tile});await ready;count++;self.postMessage({kind:'progress',progress:{phase:'converting',fraction:count/tileCount(described.descriptor)}});}
  }
  self.postMessage({kind:'complete'});
 }catch(error){self.postMessage({kind:'error',error:String(error)});}finally{resume=undefined;}})();
};
