import {RASTER_EXPORT_COLUMNS,rasterExportRows} from './raster-export-grid';
import {captureRasterExportSources} from './raster-export-source';
import type {DocumentData} from '../core/model';
import type {AssetStore} from '../core/assets';
import type {DocumentRenderer} from './renderer';
import {STANDARD_PROFILES} from '../core/color/icc';
import {planTiffDirectory,validateTiffGeometry,validateTiffVariant,type TiffVariant} from '../core/tiff';
import {checkExport,type ExportControl} from './export-control';
import {release} from './canvas';
import {yieldTask} from '../core/task-yield';

async function deflateTile(pixels:Uint8Array,control?:ExportControl):Promise<Blob>{
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
 constructor(readonly width:number,readonly height:number,readonly variant:TiffVariant='auto'){
  validateTiffGeometry(width,height);validateTiffVariant(variant);this.tileWidth=Math.min(RASTER_EXPORT_COLUMNS,Math.ceil(width/16)*16);this.tileHeight=Math.min(64,Math.ceil(height/16)*16);this.totalTiles=Math.ceil(width/this.tileWidth)*Math.ceil(height/this.tileHeight);if(!Number.isSafeInteger(this.totalTiles))throw new Error('TIFF tile count exceeds exact file addressing.');
  this.profile=new Uint8Array(STANDARD_PROFILES.srgb.iccBytes!);
 }
 async append(pixels:Uint8Array,control?:ExportControl){
  if(this.state!=='open'||this.counts.length>=this.totalTiles)throw new Error('TIFF encoder is not accepting tiles.');
  if(pixels.length!==this.tileWidth*this.tileHeight*4)throw new Error('TIFF tile must contain its complete padded RGBA8 geometry.');
  this.state='busy';try{const blob=await deflateTile(pixels,control),padding=(8-blob.size%8)%8;if(this.state!=='busy')throw new Error('TIFF encoding was cancelled.');this.offsets.push(this.payloadBytes);this.counts.push(blob.size);this.parts.push(blob);if(padding)this.parts.push(new Uint8Array(padding));this.payloadBytes+=blob.size+padding;this.state='open';}
  catch(error){this.abort();throw error;}
 }
 finish():Blob{
  if(this.state!=='open'||this.counts.length!==this.totalTiles)throw new Error('Incomplete TIFF tiles.');
  const plan=planTiffDirectory({width:this.width,height:this.height,tileWidth:this.tileWidth,tileHeight:this.tileHeight,offsets:this.offsets,counts:this.counts,payloadBytes:this.payloadBytes,profile:this.profile,variant:this.variant});
  const blob=new Blob([plan.header,...this.parts,plan.directory],{type:'image/tiff'});if(blob.size!==plan.fileBytes)throw new Error('TIFF output size does not match its directory.');this.state='closed';this.parts=[];this.offsets=[];this.counts=[];return blob;
 }
 abort(){this.state='failed';this.parts=[];this.offsets=[];this.counts=[];}
}
export async function exportTiff(document:DocumentData,assets:AssetStore,renderer:DocumentRenderer,variant:TiffVariant='auto',control?:ExportControl):Promise<Blob>{
 checkExport(control);const encoder=new TiffTileEncoder(document.width,document.height,variant);const current=captureRasterExportSources(document,assets,control);let completed=0;
 try{
  control?.onProgress?.({phase:'rendering',fraction:0});current();
  for(let y=0;y<document.height;y+=encoder.tileHeight)for(let x=0;x<document.width;x+=encoder.tileWidth){
   current();const width=Math.min(encoder.tileWidth,document.width-x),height=Math.min(encoder.tileHeight,document.height-y),padded=new Uint8Array(encoder.tileWidth*encoder.tileHeight*4),rows=rasterExportRows(document.width);
   // Preserve PNG's native frame geometry even when the TIFF storage tile
   // crosses a narrow canonical strip. Crop pixels after rendering, never the
   // renderer frame itself: Canvas edge rounding can depend on that frame.
   for(let sourceY=Math.floor(y/rows)*rows;sourceY<y+height;sourceY+=rows){
    current();const nativeRows=Math.min(rows,document.height-sourceY),tile=await renderer.render(document,assets,{region:{x,y:sourceY,width,height:nativeRows},cache:false,readback:true,isCancelled:()=>!!control?.signal?.aborted});
    try{current();if(tile.width!==width||tile.height!==nativeRows)throw new Error('TIFF rendering did not return native-resolution pixels.');const pixels=tile.getContext('2d')!.getImageData(0,0,width,nativeRows).data;
     for(let row=Math.max(y,sourceY);row<Math.min(y+height,sourceY+nativeRows);row++)padded.set(pixels.subarray((row-sourceY)*width*4,(row-sourceY+1)*width*4),(row-y)*encoder.tileWidth*4);
    }finally{release(tile);}
   }
   await encoder.append(padded,control);current();control?.onProgress?.({phase:'rendering',fraction:++completed/encoder.totalTiles});current();await yieldTask();
  }
  current();control?.onProgress?.({phase:'encoding',fraction:null});current();const blob=encoder.finish();current();return blob;
 }catch(error){encoder.abort();throw error;}
}
