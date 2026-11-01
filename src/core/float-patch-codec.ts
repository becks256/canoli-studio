import {TiffTileEncoder} from './tiff-encoder';
import {STANDARD_PROFILES} from './color/icc';
import {validateFloatRetouchPixels,validateFloatRetouchMask} from './retouch/float-types';
import {validateFloatWetTile,type FloatWetTileControl} from './float-wet-tile';

/** A correction can span many fixed encoder tiles. No full-image Canvas or
 * renderer-tile-sized correction limit is introduced. Alpha is coverage. */
export async function encodeFloatPatchAsset(input:Float32Array,coverage:Float32Array,width:number,height:number,control:FloatWetTileControl={}):Promise<Blob>{
 const check=()=>{control.signal?.throwIfAborted();control.check?.();control.signal?.throwIfAborted();};check();validateFloatRetouchPixels(input,width,height);validateFloatRetouchMask(coverage,width,height);const pixels=input.slice(),mask=coverage.slice(),profile=new Uint8Array(STANDARD_PROFILES['linear-srgb'].iccBytes!),encoder=new TiffTileEncoder(width,height,'auto',profile,'rgba-float32');
 try{
  for(let y=0;y<height;y+=encoder.tileHeight)for(let x=0;x<width;x+=encoder.tileWidth){
   check();const w=Math.min(encoder.tileWidth,width-x),h=Math.min(encoder.tileHeight,height-y),tile=new Float32Array(encoder.tileWidth*encoder.tileHeight*4);
   for(let row=0;row<h;row++)for(let col=0;col<w;col++){const p=(y+row)*width+x+col,q=(row*encoder.tileWidth+col)*4;tile[q]=pixels[p*4];tile[q+1]=pixels[p*4+1];tile[q+2]=pixels[p*4+2];tile[q+3]=mask[p];}
   await encoder.append(tile,{signal:control.signal});check();
  }
  const blob=encoder.finish();check();await validateFloatWetTile(blob,width,height,{check});check();return blob;
 }catch(error){encoder.abort();throw error;}
}
