import{FloatTileWindowReader}from'./window-reader';
import{freeze}from'../immutable';
import{validateManifest,validateWindow,type FloatSourceManifest,type FloatEncodedTile}from'./types';
let serial=Promise.resolve(),current:FloatSourceManifest|undefined;const cancelled=new Set<number>(),known=new Set<number>(),reader=new FloatTileWindowReader();
self.onmessage=event=>{
 const data=event.data,id=data?.id;
 if(data?.kind==='cancel'){if(known.has(id))cancelled.add(id);return;}
 if(!Number.isSafeInteger(id)||id<1||known.has(id)){self.postMessage({id,error:'Invalid float read request.'});return;}
 let manifest:FloatSourceManifest,bounds:ReturnType<typeof validateWindow>;
 try{if(data.manifest)current=freeze(validateManifest(data.manifest));if(!current||data.buildId&&current.buildId!==data.buildId)throw new Error('Float reader source identity is missing.');manifest=current;bounds=validateWindow(data.bounds);}catch(error){self.postMessage({id,error:String(error)});return;}
 known.add(id);
 serial=serial.catch(()=>{}).then(async()=>{const check=()=>{if(cancelled.has(id))throw new DOMException('Float read cancelled.','AbortError');};try{
  check();const output=await reader.read(manifest,bounds,data.tiles as FloatEncodedTile[],check);
  check();self.postMessage({id,pixels:output},{transfer:[output.buffer]});
 }catch(error){self.postMessage({id,error:String(error),corrupt:!(error instanceof DOMException&&error.name==='AbortError')});}finally{known.delete(id);cancelled.delete(id);}});
};
