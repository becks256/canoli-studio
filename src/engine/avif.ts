import type {DocumentData} from '../core/model';
import type {AssetStore} from '../core/assets';
import type {DocumentRenderer} from './renderer';
import {avifGeometry,avifSettings} from '../core/avif';
import {checkExport,type ExportControl} from './export-control';
import {captureRasterExportSources} from './raster-export-source';
import {RASTER_EXPORT_COLUMNS,rasterExportRows} from './raster-export-grid';
import {yieldTask} from '../core/task-yield';
import {release} from './canvas';
import {encodeAvifFrame} from './avif-encoder';

// One complete capture/codec job per application context; queued jobs own no RGBA frame.
let active=false;
const waiting:{start():void}[]=[];
const pump=()=>{if(!active)waiting.shift()?.start();};
function acquire(signal:AbortSignal):Promise<()=>void>{
  signal.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const cancel=()=>{const index=waiting.indexOf(entry);if(index>=0)waiting.splice(index,1);signal.removeEventListener('abort',cancel);reject(signal.reason);pump();};
    const entry={start(){
      if(signal.aborted){cancel();return;}
      active=true;signal.removeEventListener('abort',cancel);let released=false;
      resolve(()=>{if(released)return;released=true;active=false;pump();});
    }};
    waiting.push(entry);signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();else pump();
  });
}

/** Geometry belongs to the output; fitted batch renderers pin their real source document separately. */
export async function exportAvif(document:DocumentData,assets:AssetStore,renderer:DocumentRenderer,options:unknown={},control?:ExportControl,source:DocumentData=document):Promise<Blob>{
  checkExport(control);const geometry=avifGeometry(document.width,document.height),settings=avifSettings(options);
  const current=captureRasterExportSources(source,assets,control,'AVIF export'),owned=new AbortController();
  const abort=()=>owned.abort(control?.signal?.reason);control?.signal?.addEventListener('abort',abort,{once:true});if(control?.signal?.aborted)abort();
  // A native codec call blocks its worker; the host can still revoke sources/fonts promptly.
  const watch=setInterval(()=>{try{current();}catch(error){owned.abort(error);}},75);
  const inner:ExportControl={signal:owned.signal,onProgress:control?.onProgress};
  const check=()=>{checkExport(inner);current();};let relinquish:(()=>void)|undefined;
  try{
    check();inner.onProgress?.({phase:'rendering',fraction:0});check();relinquish=await acquire(owned.signal);check();
    let pixels:Uint8Array<ArrayBuffer>;
    try{pixels=new Uint8Array(geometry.bytes);}catch{throw new Error('Not enough memory for native-resolution AVIF. Save a project or choose PNG or TIFF.');}
    const rows=rasterExportRows(geometry.width),total=Math.ceil(geometry.width/RASTER_EXPORT_COLUMNS)*Math.ceil(geometry.height/rows);let completed=0,requiresAlpha=false;
    for(let y=0;y<geometry.height;y+=rows)for(let x=0;x<geometry.width;x+=RASTER_EXPORT_COLUMNS){
      check();const width=Math.min(RASTER_EXPORT_COLUMNS,geometry.width-x),height=Math.min(rows,geometry.height-y);
      const tile=await renderer.render(document,assets,{region:{x,y,width,height},cache:false,readback:true,isCancelled:()=>owned.signal.aborted});
      try{
        check();if(tile.width!==width||tile.height!==height)throw new Error('AVIF rendering did not return native-resolution pixels.');
        const rgba=tile.getContext('2d')!.getImageData(0,0,width,height).data;
        if(!(rgba instanceof Uint8ClampedArray)||rgba.length!==width*height*4)throw new Error('AVIF rendering returned invalid RGBA8 pixels.');
        for(let row=0;row<height;row++)pixels.set(rgba.subarray(row*width*4,(row+1)*width*4),((y+row)*geometry.width+x)*4);
        if(!requiresAlpha)for(let i=3;i<rgba.length;i+=4)if(rgba[i]!==255){requiresAlpha=true;break;}
      }finally{release(tile);}
      completed++;inner.onProgress?.({phase:'rendering',fraction:completed/total});check();await yieldTask();
    }
    check();inner.onProgress?.({phase:'encoding',fraction:null});check();
    const blob=await encodeAvifFrame(pixels.buffer,geometry.width,geometry.height,settings,requiresAlpha,inner,check);check();return blob;
  }finally{clearInterval(watch);control?.signal?.removeEventListener('abort',abort);relinquish?.();}
}
