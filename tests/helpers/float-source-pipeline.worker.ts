/** Verification-only original -> persistent float tiles -> bounded reads ->
 * native-precision TIFF. No bitmap, byte preview or document mutation. */
import{FloatRasterSource}from'../../src/core/float-source/source';
import{STANDARD_PROFILES}from'../../src/core/color/icc';
import{TiffTileEncoder}from'../../src/core/tiff-encoder';
self.onmessage=async({data}:{data:{original:Blob}})=>{
 let source:FloatRasterSource|undefined,encoder:TiffTileEncoder|undefined;
 try{
  source=await FloatRasterSource.openTiff(data.original);const manifest=await source.prepare(),{width,height}=source;
  const other=source.share();source.dispose();source=other;
  encoder=new TiffTileEncoder(width,height,'big',new Uint8Array(STANDARD_PROFILES['linear-srgb'].iccBytes!),'rgba-float32');let windows=0;
  for(let top=0;top<height;top+=encoder.tileHeight)for(let left=0;left<width;left+=encoder.tileWidth){
   const cols=Math.min(encoder.tileWidth,width-left),rows=Math.min(encoder.tileHeight,height-top),pixels=await source.readWindow({x:left,y:top,width:cols,height:rows}),tile=new Float32Array(encoder.tileWidth*encoder.tileHeight*4);
   for(let y=0;y<rows;y++)tile.set(pixels.subarray(y*cols*4,(y+1)*cols*4),y*encoder.tileWidth*4);await encoder.append(tile);windows++;
  }
  self.postMessage({tiff:encoder.finish(),width,height,windows,manifest,originalBytes:source.original.size});
 }catch(error){encoder?.abort();self.postMessage({error:String(error)});}finally{source?.dispose();}
};
