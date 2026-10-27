import {planTiffDirectory,validateTiffGeometry,validateTiffVariant,type TiffVariant,type TiffPageDirectoryInput,type TiffSampleFormat} from './tiff';
import {STANDARD_PROFILES} from './color/icc';
import {validateIccSamples} from './color/icc-types';
export interface TiffEncodingControl{signal?:AbortSignal}
const checkExport=(control?:TiffEncodingControl)=>control?.signal?.throwIfAborted();
const RASTER_EXPORT_COLUMNS=2048;
async function deflateTile(pixels:Uint8Array,control?:TiffEncodingControl):Promise<Blob>{
 checkExport(control);const stream=new CompressionStream('deflate'),writer=stream.writable.getWriter(),reader=stream.readable.getReader(),parts:BlobPart[]=[];
 const collect=(async()=>{while(true){const {done,value}=await reader.read();if(done)break;parts.push(new Uint8Array(value));}})();
 void collect.catch(error=>writer.abort(error).catch(()=>{}));
 const cancel=()=>{void Promise.allSettled([writer.abort(control?.signal?.reason),reader.cancel(control?.signal?.reason)]);};control?.signal?.addEventListener('abort',cancel,{once:true});
 try{checkExport(control);await writer.write(new Uint8Array(pixels));await writer.close();await collect;checkExport(control);return new Blob(parts);}
 catch(error){await Promise.allSettled([writer.abort(error),reader.cancel(error),collect]);checkExport(control);throw error;}
 finally{control?.signal?.removeEventListener('abort',cancel);writer.releaseLock();reader.releaseLock();}
}
/** Fixed native tiles and compressed Blob parts; never a full image/scanline. */
export class TiffTileEncoder {
 readonly tileWidth:number;readonly tileHeight:number;readonly totalTiles:number;
 private parts:BlobPart[]=[];private offsets:number[]=[];private counts:number[]=[];private payloadBytes=0;private state:'open'|'busy'|'closed'|'failed'='open';private profile:Uint8Array;
 constructor(readonly width:number,readonly height:number,readonly variant:TiffVariant='auto',profile?:Uint8Array,readonly sampleFormat:TiffSampleFormat='rgba8'){
  validateTiffGeometry(width,height);validateTiffVariant(variant);if(!['rgba8','rgba16','rgba-float32'].includes(sampleFormat))throw new Error('Invalid TIFF sample format.');this.tileWidth=Math.min(RASTER_EXPORT_COLUMNS,Math.ceil(width/16)*16);this.tileHeight=Math.min(64,Math.ceil(height/16)*16);this.totalTiles=Math.ceil(width/this.tileWidth)*Math.ceil(height/this.tileHeight);if(!Number.isSafeInteger(this.totalTiles))throw new Error('TIFF tile count exceeds exact file addressing.');
  this.profile=new Uint8Array(profile??STANDARD_PROFILES.srgb.iccBytes!);
 }
 async append(pixels:Uint8Array|Uint8ClampedArray|Uint16Array|Float32Array,control?:TiffEncodingControl){
  if(this.state!=='open'||this.counts.length>=this.totalTiles)throw new Error('TIFF encoder is not accepting tiles.');
  if(pixels.length!==this.tileWidth*this.tileHeight*4)throw new Error('TIFF tile must contain its complete padded RGBA geometry.');
  validateIccSamples(pixels instanceof Uint8Array?new Uint8ClampedArray(pixels.buffer,pixels.byteOffset,pixels.byteLength):pixels,this.sampleFormat);
  if(new Uint8Array(new Uint16Array([1]).buffer)[0]!==1)throw new Error('TIFF sample encoding requires a little-endian host.');
  this.state='busy';try{const blob=await deflateTile(new Uint8Array(pixels.buffer,pixels.byteOffset,pixels.byteLength),control),padding=(8-blob.size%8)%8;if(this.state!=='busy')throw new Error('TIFF encoding was cancelled.');this.offsets.push(this.payloadBytes);this.counts.push(blob.size);this.parts.push(blob);if(padding)this.parts.push(new Uint8Array(padding));this.payloadBytes+=blob.size+padding;this.state='open';}
  catch(error){this.abort();throw error;}
 }
 finishPage():{input:TiffPageDirectoryInput;payload:Blob}{
  if(this.state!=='open'||this.counts.length!==this.totalTiles)throw new Error('Incomplete TIFF tiles.');
  const input={width:this.width,height:this.height,tileWidth:this.tileWidth,tileHeight:this.tileHeight,offsets:this.offsets,counts:this.counts,payloadBytes:this.payloadBytes,profile:this.profile,...(this.sampleFormat!=='rgba8'?{sampleFormat:this.sampleFormat}:{})};
  const payload=new Blob(this.parts);this.state='closed';this.parts=[];this.offsets=[];this.counts=[];return{input,payload};
 }
 finish():Blob{
  const page=this.finishPage(),plan=planTiffDirectory({...page.input,variant:this.variant});
  const blob=new Blob([plan.header,page.payload,plan.directory],{type:'image/tiff'});if(blob.size!==plan.fileBytes)throw new Error('TIFF output size does not match its directory.');return blob;
 }
 abort(){this.state='failed';this.parts=[];this.offsets=[];this.counts=[];}
}
