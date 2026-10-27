import{isFloatDocument}from'../core/float-document';
import{freeze,isImmutable}from'../core/immutable';
import{validateDocument}from'../core/model';
import{normalizeColorOutput,type ColorOutput}from'../core/color/color-settings';
import{planTiffDirectories,type TiffPrecision,type TiffVariant,type TiffSampleFormat,type TiffPageDirectoryInput}from'../core/tiff';
import{TiffTileEncoder}from'../core/tiff-encoder';
import type{TiffExportPage}from'./tiff';
import{prepareFloatDelivery,type FloatDelivery}from'./float-delivery';
import{prepareIccOutput,type IccOutput}from'./icc-output';
import type{CapturedFloatScene}from'./float-scene';
import{captureRasterExportSources}from'./raster-export-source';
import{checkExport,type ExportControl}from'./export-control';
import{release}from'./canvas';
import{rasterExportRows}from'./raster-export-grid';
import{yieldTask}from'../core/task-yield';

/** Full mixed-page RGB8 delivery and real uint16/float32 output from float pages.
 * Every source is pinned/prepared before any output CMM owner is acquired. */
export async function exportFloatTiffPages(input:readonly TiffExportPage[],variant:TiffVariant,precision:TiffPrecision,control?:ExportControl,color?:ColorOutput):Promise<Blob>{
 checkExport(control);color=color?normalizeColorOutput(color):undefined;
 const format:TiffSampleFormat=precision==='uint8'?'rgba8':precision==='uint16'?'rgba16':'rgba-float32';
 const pages:{page:TiffExportPage;current:ReturnType<typeof captureRasterExportSources>;scene?:CapturedFloatScene;encoder?:TiffTileEncoder}[]=[],encoded:{input:TiffPageDirectoryInput;payload:Blob}[]=[];
 let accepted=false;
 const current=()=>{checkExport(control);for(const page of pages)page.current();};
 try{
  // Complete snapshots and native dependency guards precede progress callbacks.
  for(const incoming of input){const document=isImmutable(incoming.document)?incoming.document:freeze(structuredClone(incoming.document));validateDocument(document);if(precision!=='uint8'&&!isFloatDocument(document))throw new Error('High-precision TIFF delivery requires float32 documents on every selected page.');const page={...incoming,document};pages.push({page,current:captureRasterExportSources(document,page.assets,control,'float TIFF export')});}
  for(const value of pages)if(isFloatDocument(value.page.document)){
   if(!value.page.renderer.captureFloatScene)throw new Error('This renderer cannot deliver native float document samples.');
   value.scene=await value.page.renderer.captureFloatScene(value.page.document,value.page.assets,{signal:control?.signal,isCancelled:()=>!!control?.signal?.aborted,onProgress:()=>{current();control?.onProgress?.({phase:'rendering',fraction:null});current();}});current();
  }
  const total=pages.reduce((sum,value)=>sum+Math.ceil(value.page.document.width/2048)*Math.ceil(value.page.document.height/64),0);if(!Number.isSafeInteger(total))throw new Error('TIFF tile count exceeds exact file addressing.');let completed=0;
  for(const value of pages){
   current();const{document,assets,renderer}=value.page;let float:FloatDelivery<TiffSampleFormat>|undefined,bytes:IccOutput|null=null;
   try{
    if(value.scene)float=await prepareFloatDelivery(document,assets,renderer,format,control,color,value.scene);else bytes=await prepareIccOutput(color,control);
    current();const encoder=value.encoder=new TiffTileEncoder(document.width,document.height,variant,float?.profile??bytes?.profile,format);
    for(let y=0;y<document.height;y+=encoder.tileHeight)for(let x=0;x<document.width;x+=encoder.tileWidth){
     current();const width=Math.min(encoder.tileWidth,document.width-x),height=Math.min(encoder.tileHeight,document.height-y),length=encoder.tileWidth*encoder.tileHeight*4,padded=format==='rgba-float32'?new Float32Array(length):format==='rgba16'?new Uint16Array(length):new Uint8Array(length);
     if(float){const pixels=await float.read({x,y,width,height});current();for(let row=0;row<height;row++)padded.set(pixels.subarray(row*width*4,(row+1)*width*4),row*encoder.tileWidth*4);}
     else{
      const rows=rasterExportRows(document.width);
      for(let sourceY=Math.floor(y/rows)*rows;sourceY<y+height;sourceY+=rows){
       current();const nativeRows=Math.min(rows,document.height-sourceY),tile=await renderer.render(document,assets,{region:{x,y:sourceY,width,height:nativeRows},cache:false,readback:true,isCancelled:()=>!!control?.signal?.aborted});
       try{current();if(tile.width!==width||tile.height!==nativeRows)throw new Error('TIFF rendering did not return native-resolution pixels.');let pixels=tile.getContext('2d')!.getImageData(0,0,width,nativeRows).data;if(bytes)pixels=await bytes.apply(pixels);current();for(let row=Math.max(y,sourceY);row<Math.min(y+height,sourceY+nativeRows);row++)padded.set(pixels.subarray((row-sourceY)*width*4,(row-sourceY+1)*width*4),(row-y)*encoder.tileWidth*4);}finally{release(tile);}
      }
     }
     await encoder.append(padded,control);current();control?.onProgress?.({phase:'rendering',fraction:++completed/total});current();await yieldTask();
    }
    encoded.push(encoder.finishPage());
   }finally{float?.dispose();bytes?.dispose();}
  }
  current();control?.onProgress?.({phase:'encoding',fraction:null});current();const plan=planTiffDirectories(encoded.map(page=>page.input),variant),result=new Blob([plan.header,...encoded.map(page=>page.payload),...plan.directories],{type:'image/tiff'});if(result.size!==plan.fileBytes)throw new Error('Float TIFF output size differs from its complete directories.');current();accepted=true;return result;
 }finally{for(const value of pages){value.scene?.dispose();if(!accepted)value.encoder?.abort();value.current.release();}encoded.length=0;}
}
