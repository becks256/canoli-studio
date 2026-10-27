import {prepareIccOutput,type IccOutput} from './icc-output';
import {normalizeColorOutput,type ColorOutput} from '../core/color/color-settings';
import {rasterExportRows} from './raster-export-grid';
import {captureRasterExportSources} from './raster-export-source';
import {validateDocument,type DocumentData} from '../core/model';
import {freeze,isImmutable} from '../core/immutable';
import type {AssetStore} from '../core/assets';
import type {DocumentRenderer} from './renderer';
import {planTiffDirectories,validateTiffVariant,type TiffVariant,type TiffPageDirectoryInput} from '../core/tiff';
import {checkExport,type ExportControl} from './export-control';
import {release} from './canvas';
import {yieldTask} from '../core/task-yield';

import {TiffTileEncoder} from '../core/tiff-encoder';
export {TiffTileEncoder} from '../core/tiff-encoder';
export interface TiffExportPage {document:DocumentData;assets:AssetStore;renderer:DocumentRenderer}
/** All page snapshots and dependencies are captured before the first callback. */
export async function exportTiffPages(input:readonly TiffExportPage[],variant:TiffVariant='auto',control?:ExportControl,color?:ColorOutput):Promise<Blob>{
 checkExport(control);variant=validateTiffVariant(variant);color=color?normalizeColorOutput(color):undefined;let output:IccOutput|null=null;
 if(!Array.isArray(input)||!input.length)throw new Error('Choose at least one TIFF page.');
 const pages:{document:DocumentData;assets:AssetStore;renderer:DocumentRenderer;encoder:TiffTileEncoder;check:import('./export-fonts').FontSourceCapture}[]=[];
 try{for(const page of input){
  const document=isImmutable(page.document)?page.document:freeze(structuredClone(page.document));validateDocument(document);
  const encoder=new TiffTileEncoder(document.width,document.height,variant);
  pages.push({document,assets:page.assets,renderer:page.renderer,encoder,check:captureRasterExportSources(document,page.assets,control,'multipage TIFF export')});
 }
 const current=()=>{checkExport(control);for(const page of pages)page.check();};
 output=await prepareIccOutput(color,control);current();
 if(output)for(const page of pages){page.encoder=new TiffTileEncoder(page.document.width,page.document.height,variant,output.profile);}
 const encoded:{input:TiffPageDirectoryInput;payload:Blob}[]=[];
 const total=pages.reduce((sum,page)=>sum+page.encoder.totalTiles,0);
 if(!Number.isSafeInteger(total))throw new Error('TIFF tile count exceeds exact file addressing.');
 let completed=0;
 try{
  control?.onProgress?.({phase:'rendering',fraction:0});current();
  for(const{document,assets,renderer,encoder}of pages){
   for(let y=0;y<document.height;y+=encoder.tileHeight)for(let x=0;x<document.width;x+=encoder.tileWidth){
    current();const width=Math.min(encoder.tileWidth,document.width-x),height=Math.min(encoder.tileHeight,document.height-y),padded=new Uint8Array(encoder.tileWidth*encoder.tileHeight*4),rows=rasterExportRows(document.width);
    // Match the canonical PNG render grid before cropping into TIFF storage tiles.
    for(let sourceY=Math.floor(y/rows)*rows;sourceY<y+height;sourceY+=rows){
     current();const nativeRows=Math.min(rows,document.height-sourceY),tile=await renderer.render(document,assets,{region:{x,y:sourceY,width,height:nativeRows},cache:false,readback:true,isCancelled:()=>!!control?.signal?.aborted});
     try{current();if(tile.width!==width||tile.height!==nativeRows)throw new Error('TIFF rendering did not return native-resolution pixels.');let pixels=tile.getContext('2d')!.getImageData(0,0,width,nativeRows).data;
      if(output){pixels=await output.apply(pixels);current();}
      for(let row=Math.max(y,sourceY);row<Math.min(y+height,sourceY+nativeRows);row++)padded.set(pixels.subarray((row-sourceY)*width*4,(row-sourceY+1)*width*4),(row-y)*encoder.tileWidth*4);
     }finally{release(tile);}
    }
    await encoder.append(padded,control);current();control?.onProgress?.({phase:'rendering',fraction:++completed/total});current();await yieldTask();
   }
   current();encoded.push(encoder.finishPage());
  }
  current();control?.onProgress?.({phase:'encoding',fraction:null});current();
  const plan=planTiffDirectories(encoded.map(page=>page.input),variant);
  const blob=new Blob([plan.header,...encoded.map(page=>page.payload),...plan.directories],{type:'image/tiff'});
  if(blob.size!==plan.fileBytes)throw new Error('TIFF output size does not match its directories.');current();return blob;
 }catch(error){for(const page of pages)page.encoder.abort();throw error;}
 finally{encoded.length=0;}
 }finally{output?.dispose();for(const page of pages)page.check.release();}
}
export async function exportTiff(document:DocumentData,assets:AssetStore,renderer:DocumentRenderer,variant:TiffVariant='auto',control?:ExportControl,color?:ColorOutput):Promise<Blob>{
 return exportTiffPages([{document,assets,renderer}],variant,control,color);
}
