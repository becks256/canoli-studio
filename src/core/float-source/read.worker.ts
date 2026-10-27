import{decodeTile,verifyEncodedTile}from'./codec';
import{validateManifest,validateWindow,tileGeometry,windowTiles,type FloatSourceManifest,type FloatEncodedTile}from'./types';
let serial=Promise.resolve(),current:FloatSourceManifest|undefined;const cancelled=new Set<number>(),known=new Set<number>(),cache=new Map<string,Float32Array>();let bytes=0;
self.onmessage=event=>{
 const data=event.data,id=data?.id;
 if(data?.kind==='cancel'){if(known.has(id))cancelled.add(id);return;}
 if(!Number.isSafeInteger(id)||id<1||known.has(id)){self.postMessage({id,error:'Invalid float read request.'});return;}
 let manifest:FloatSourceManifest,bounds:ReturnType<typeof validateWindow>;
 try{if(data.manifest)current=validateManifest(data.manifest);if(!current||data.buildId&&current.buildId!==data.buildId)throw new Error('Float reader source identity is missing.');manifest=current;bounds=validateWindow(data.bounds);}catch(error){self.postMessage({id,error:String(error)});return;}
 known.add(id);
 serial=serial.catch(()=>{}).then(async()=>{const check=()=>{if(cancelled.has(id))throw new DOMException('Float read cancelled.','AbortError');};try{
  check();const tiles=data.tiles as FloatEncodedTile[],output=new Float32Array(bounds.width*bounds.height*4),seen=new Set<number>(),required=new Set(windowTiles(manifest.descriptor,bounds));if(!Array.isArray(tiles)||tiles.length!==required.size)throw new Error('Float read tile coverage is incomplete.');
  for(const tile of tiles){check();const index=tile?.meta?.index;if(!Number.isSafeInteger(index)||index<0||index>=manifest.tiles.length||seen.has(index)||!required.has(index))throw new Error('Invalid float read tile set.');seen.add(index);const expected=manifest.tiles[index],geometry=tileGeometry(manifest.descriptor,index),key=manifest.buildId+':'+index+':'+expected.rawSha256;let pixels=cache.get(key);
   if(pixels){await verifyEncodedTile(tile,expected);check();cache.delete(key);cache.set(key,pixels);}else{pixels=await decodeTile(tile,expected);check();while(cache.size&&(bytes+pixels.byteLength>16*1024*1024||cache.size>=64)){const first=cache.keys().next().value!,old=cache.get(first)!;cache.delete(first);bytes-=old.byteLength;}cache.set(key,pixels);bytes+=pixels.byteLength;}
   const left=Math.max(bounds.x,geometry.x),right=Math.min(bounds.x+bounds.width,geometry.x+geometry.width),top=Math.max(bounds.y,geometry.y),bottom=Math.min(bounds.y+bounds.height,geometry.y+geometry.height);
   for(let y=top;y<bottom;y++){const start=((y-geometry.y)*geometry.width+left-geometry.x)*4;output.set(pixels.subarray(start,start+(right-left)*4),((y-bounds.y)*bounds.width+left-bounds.x)*4);}
  }
  check();self.postMessage({id,pixels:output},{transfer:[output.buffer]});
 }catch(error){self.postMessage({id,error:String(error),corrupt:!(error instanceof DOMException&&error.name==='AbortError')});}finally{known.delete(id);cancelled.delete(id);}});
};
