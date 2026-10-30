import{describeFloatSource,prepareFloatTiles}from'./prepare';
import{tileCount,FLOAT_TILE_BATCH_SIZE,type FloatSourceInput,type FloatEncodedTile}from'./types';
let resume:((value:unknown)=>void)|undefined;
self.onmessage=event=>{
 if(event.data?.kind==='continue'||event.data?.kind==='ack'){const next=resume;resume=undefined;next?.(event.data);return;}
 if(event.data?.kind!=='start')return;
 void(async()=>{try{
  const described=await describeFloatSource(event.data.input as FloatSourceInput,{onProgress:progress=>self.postMessage({kind:'progress',progress})});
  const pending=new Promise(resolve=>{resume=resolve;});self.postMessage({kind:'descriptor',descriptor:described.descriptor,key:described.key});await pending;
  let count=0;let batch:FloatEncodedTile[]=[];
  const flush=async()=>{if(!batch.length)return;const stored=batch.length,ready=new Promise(resolve=>{resume=resolve;});self.postMessage({kind:'tiles',tiles:batch});batch=[];await ready;count+=stored;self.postMessage({kind:'progress',progress:{phase:'converting',fraction:count/tileCount(described.descriptor)}});};
  for await(const value of prepareFloatTiles(described)){
   if(value.kind==='prepared')self.postMessage({kind:'prepared',prepared:value.prepared});
   else{batch.push(value.tile);if(batch.length===FLOAT_TILE_BATCH_SIZE)await flush();}
  }
  await flush();
  self.postMessage({kind:'complete'});
 }catch(error){self.postMessage({kind:'error',error:String(error)});}finally{resume=undefined;}})();
};
