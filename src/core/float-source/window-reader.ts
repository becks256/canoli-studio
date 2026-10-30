import {decodeTile, verifyEncodedTile} from './codec';
import {floatTileMetaSchema, validateWindow, tileGeometry, windowTiles, type FloatSourceManifest, type FloatEncodedTile, type FloatSourceWindow} from './types';

/** Private common reader for actual browser and Node workers. Manifests are
 * validated/frozen by the owning worker before use. Cached pixels never escape. */
export class FloatTileWindowReader {
  private cache=new Map<string,Float32Array>();
  private bytes=0;
  async read(manifest:Readonly<FloatSourceManifest>,input:FloatSourceWindow,inputTiles:FloatEncodedTile[],check:()=>void):Promise<Float32Array<ArrayBuffer>>{
    const bounds=validateWindow(input),required=new Set(windowTiles(manifest.descriptor,bounds));
    if(!Array.isArray(inputTiles)||inputTiles.length!==required.size)throw new Error('Float read tile coverage is incomplete.');
    const tiles=inputTiles.map(tile=>({meta:floatTileMetaSchema.parse(tile?.meta),blob:tile?.blob})),seen=new Set<number>(),output=new Float32Array(bounds.width*bounds.height*4);
    for(const tile of tiles){
      check();const index=tile.meta.index;
      if(index>=manifest.tiles.length||seen.has(index)||!required.has(index))throw new Error('Invalid float read tile set.');
      seen.add(index);const expected=manifest.tiles[index],geometry=tileGeometry(manifest.descriptor,index),key=manifest.key+':'+manifest.buildId+':'+index+':'+expected.rawSha256;
      let pixels=this.cache.get(key);
      if(pixels){await verifyEncodedTile(tile,expected);check();this.cache.delete(key);this.cache.set(key,pixels);}
      else{
        pixels=await decodeTile(tile,expected);check();
        while(this.cache.size&&(this.bytes+pixels.byteLength>16*1024*1024||this.cache.size>=64)){const first=this.cache.keys().next().value!,old=this.cache.get(first)!;this.cache.delete(first);this.bytes-=old.byteLength;}
        this.cache.set(key,pixels);this.bytes+=pixels.byteLength;
      }
      const left=Math.max(bounds.x,geometry.x),right=Math.min(bounds.x+bounds.width,geometry.x+geometry.width),top=Math.max(bounds.y,geometry.y),bottom=Math.min(bounds.y+bounds.height,geometry.y+geometry.height);
      for(let y=top;y<bottom;y++){const start=((y-geometry.y)*geometry.width+left-geometry.x)*4;output.set(pixels.subarray(start,start+(right-left)*4),((y-bounds.y)*bounds.width+left-bounds.x)*4);}
    }
    check();return output;
  }
}
