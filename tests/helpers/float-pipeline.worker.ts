/** Verification-only original float TIFF -> native ICC float -> native affine
 * and masked composition -> real float TIFF. No byte canvas or scene override. */
import{inspectTiff}from'../../src/core/interchange/tiff/inspect';
import{floatTiffRows}from'../../src/core/interchange/tiff/float-rows';
import{NativeIccEngine}from'../../src/core/color/icc-native';
import{STANDARD_PROFILES}from'../../src/core/color/icc';
import{FloatPixelProcessor}from'../../src/engine/float-pixels';
import{instantiateKernel}from'../../src/engine/wasm';
import{TiffTileEncoder}from'../../src/core/tiff-encoder';
self.onmessage=async({data}:{data:{source:Blob}})=>{
 let color:NativeIccEngine|undefined,float:FloatPixelProcessor|undefined,encoder:TiffTileEncoder|undefined;
 try{
  const source=data.source,inspection=await inspectTiff(source),page=inspection.pages[0],{width,height}=page.report;if(!page.icc)throw new Error('Tagged float source required.');
  const linear=new Uint8Array(STANDARD_PROFILES['linear-srgb'].iccBytes!);color=await NativeIccEngine.create();color.beginRgb(page.icc,linear,{inputFormat:'rgba-float32',outputFormat:'rgba-float32'});float=new FloatPixelProcessor(await instantiateKernel(await(await fetch('/wasm/pixels.wasm')).arrayBuffer()));encoder=new TiffTileEncoder(width,height,'big',linear,'rgba-float32');
  const batchRows=16,batch=new Float32Array(width*batchRows*4),band=new Float32Array(width*encoder.tileHeight*4),matrix=[4,0,0,-.125,0,4,0,-.25,0,0,4,.0625];let count=0,top=0,bandRows=0,windows=0,extended=0;
  for await(const row of floatTiffRows(inspection,page)){
   batch.set(row.samples,count*width*4);count++;
   if(count===batchRows||row.top+1===height){
    const native=color.applyWindow(batch.subarray(0,count*width*4));if(!(native instanceof Float32Array))throw new Error('Native float conversion returned bytes.');const adjusted=float.affine(native,matrix),backdrop=new Float32Array(adjusted.length),mask=new Float32Array(count*width);for(let i=0;i<mask.length;i++){backdrop.set([.25,.125,.75,.625],i*4);mask[i]=((i%width+(top+Math.floor(i/width))*7)%257)/256;}
    const result=float.composite(adjusted,backdrop,{mode:'normal',opacity:.71321,mask});for(let i=0;i<result.length;i++)if(i%4!==3&&(result[i]<0||result[i]>1))extended++;band.set(result,bandRows*width*4);bandRows+=count;top+=count;windows++;count=0;
    if(bandRows===encoder.tileHeight||top===height){for(let left=0;left<width;left+=encoder.tileWidth){const tile=new Float32Array(encoder.tileWidth*encoder.tileHeight*4),cols=Math.min(encoder.tileWidth,width-left);for(let y=0;y<bandRows;y++)tile.set(band.subarray((y*width+left)*4,(y*width+left+cols)*4),y*encoder.tileWidth*4);await encoder.append(tile);}band.fill(0);bandRows=0;}
   }
  }
  self.postMessage({tiff:encoder.finish(),width,height,windows,extended,sourceBytes:source.size});
 }catch(error){encoder?.abort();self.postMessage({error:String(error)});}finally{color?.dispose();float?.dispose();}
};
