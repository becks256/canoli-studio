import {STANDARD_PROFILES} from './color/icc';
import {inspectTiff,type InspectedTiff} from './interchange/tiff/inspect';
import {floatTiffRows} from './interchange/tiff/float-rows';
import {TiffTileEncoder} from './tiff-encoder';
import {validateWindow,type FloatSourceWindow} from './float-source/types';
import {validateIccSamples} from './color/icc-types';

/** Private prepared-asset codec, not a new document schema or TIFF import rule. */
export interface FloatWetTileControl {signal?:AbortSignal;check?():void}
const headers=new WeakMap<Blob,InspectedTiff>(),verified=new WeakSet<Blob>();
const linearProfile=new Uint8Array(STANDARD_PROFILES['linear-srgb'].iccBytes!);
function checker(control:FloatWetTileControl){const signal=control.signal,external=control.check;return()=>{signal?.throwIfAborted();external?.();signal?.throwIfAborted();};}
function geometry(width:number,height:number){if(![width,height,width*height*4].every(value=>Number.isSafeInteger(value)&&value>0))throw new Error('Float wet tile geometry is invalid.');}
async function header(blob:Blob,width:number,height:number,check:()=>void){
  check();geometry(width,height);if(!(blob instanceof Blob)||blob.type!=='image/tiff')throw new Error('A complete float wet TIFF Blob is required.');
  let inspection=headers.get(blob);
  if(!inspection){inspection=await inspectTiff(blob,check);check();headers.set(blob,inspection);}
  const page=inspection.pages[0],r=page.report,profile=linearProfile;
  if(inspection.pages.length!==1||!r.canDecode||r.width!==width||r.height!==height||r.orientation!==1||r.bits!==32||r.sampleFormat!==3||r.samples!==4||r.photometric!==2||r.planar!==1||page.alpha!==2||!page.icc||page.icc.length!==profile.length||page.icc.some((value,index)=>value!==profile[index]))throw new Error('Prepared float wet TIFF requires one native, unassociated RGBA32 page with the exact linear-sRGB profile.');
  return inspection;
}
/** Validate every original sample before a proof can be reused. A cancelled or
 * failed inspection/stream never becomes a completed asset proof. */
async function checkedTile(blob:Blob,width:number,height:number,control:FloatWetTileControl={}):Promise<InspectedTiff>{
  const check=checker(control),inspection=await header(blob,width,height,check);check();
  if(!verified.has(blob)){
    let rows=0;
    for await(const row of floatTiffRows(inspection,inspection.pages[0])){check();if(row.top!==rows++||row.samples.length!==width*4)throw new Error('Incomplete float wet TIFF sample stream.');}
    check();if(rows!==height)throw new Error('Incomplete float wet TIFF rows.');verified.add(blob);
  }
  check();return inspection;
}
export async function validateFloatWetTile(blob:Blob,width:number,height:number,control:FloatWetTileControl={}):Promise<void>{await checkedTile(blob,width,height,control);}
export async function* floatWetTileRows(blob:Blob,width:number,height:number,control:FloatWetTileControl={}):AsyncGenerator<Float32Array<ArrayBuffer>>{
  const check=checker(control),inspection=await checkedTile(blob,width,height,{check});
  for await(const row of floatTiffRows(inspection,inspection.pages[0])){check();yield row.samples;check();}
}
/** A bounded working read, with transparent zero outside the stored tile. */
export async function readFloatWetTileWindow(blob:Blob,width:number,height:number,input:FloatSourceWindow,control:FloatWetTileControl={}):Promise<Float32Array<ArrayBuffer>>{
  const check=checker(control),region=validateWindow(input),inspection=await checkedTile(blob,width,height,{check}),output=new Float32Array(region.width*region.height*4);check();
  const left=Math.max(0,region.x),right=Math.min(width,region.x+region.width),top=Math.max(0,region.y),bottom=Math.min(height,region.y+region.height);
  if(right<=left||bottom<=top)return output;
  for await(const row of floatTiffRows(inspection,inspection.pages[0])){check();if(row.top>=bottom)break;if(row.top>=top)output.set(row.samples.subarray(left*4,right*4),((row.top-region.y)*region.width+left-region.x)*4);}
  check();return output;
}
/** Encode owned straight working samples losslessly, including hidden RGB and
 * signed zero. The input allocation budget does not limit original images. */
export async function encodeFloatWetTile(pixels:Float32Array,width:number,height:number,control:FloatWetTileControl={}):Promise<Blob>{
  const signal=control.signal,check=checker(control);check();geometry(width,height);validateIccSamples(pixels,'rgba-float32');
  if(('resizable' in pixels.buffer&&pixels.buffer.resizable)||('detached' in pixels.buffer&&pixels.buffer.detached)||pixels.length>262144*4)throw new Error('Float wet encoding requires a fixed working window of at most 262144 pixels.');
  if(pixels.length!==width*height*4)throw new Error('Float wet tile samples differ from native geometry.');
  const owned=pixels.slice(),encoder=new TiffTileEncoder(width,height,'auto',linearProfile,'rgba-float32');
  try{
    for(let y=0;y<height;y+=encoder.tileHeight)for(let x=0;x<width;x+=encoder.tileWidth){
      check();const w=Math.min(encoder.tileWidth,width-x),h=Math.min(encoder.tileHeight,height-y),padded=new Float32Array(encoder.tileWidth*encoder.tileHeight*4);
      for(let row=0;row<h;row++)padded.set(owned.subarray(((y+row)*width+x)*4,((y+row)*width+x+w)*4),row*encoder.tileWidth*4);
      await encoder.append(padded,{signal});check();
    }
    const blob=encoder.finish();check();return blob;
  }catch(error){encoder.abort();throw error;}
}
