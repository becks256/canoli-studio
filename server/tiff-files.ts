import {open,constants} from 'node:fs/promises';
import {join} from 'node:path';
import {FloatCacheError} from '../src/core/float-source/errors';
import {FloatTileWindowReader} from '../src/core/float-source/window-reader';
import {windowTiles,type FloatSourceManifest,type FloatSourceWindow,type FloatEncodedTile} from '../src/core/float-source/types';

/** Only service-created directories and schema-checked numeric tile IDs enter
 * this boundary. File size is checked before any bounded allocation/read. */
export async function readTiffTile(directory:string,manifest:Readonly<FloatSourceManifest>,index:number,check:()=>void):Promise<FloatEncodedTile>{
  const meta=manifest.tiles[index];if(!meta||meta.index!==index)throw new FloatCacheError('Missing native TIFF tile identity.');
  check();const file=await open(join(directory,`${index}.tile`),constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{
    check();const before=await file.stat();if(!before.isFile()||before.size!==meta.encodedBytes)throw new FloatCacheError('Native TIFF tile extent changed.');
    const bytes=new Uint8Array(meta.encodedBytes);let used=0;
    while(used<bytes.length){check();const part=await file.read(bytes,used,bytes.length-used,used);check();if(!part.bytesRead)throw new FloatCacheError('Native TIFF tile is truncated.');used+=part.bytesRead;}
    const after=await file.stat();check();if(after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)throw new FloatCacheError('Native TIFF tile changed during reading.');
    return{meta,blob:new Blob([bytes],{type:'application/zlib'})};
  }finally{await file.close();}
}

export async function readTiffFileWindow(directory:string,manifest:Readonly<FloatSourceManifest>,bounds:FloatSourceWindow,reader:FloatTileWindowReader,check:()=>void,onProgress?:(fraction:number)=>void){
  const tiles:FloatEncodedTile[]=[],indices=windowTiles(manifest.descriptor,bounds);
  for(const index of indices){check();tiles.push(await readTiffTile(directory,manifest,index,check));onProgress?.(tiles.length/indices.length);check();}
  check();return reader.read(manifest,bounds,tiles,check);
}
