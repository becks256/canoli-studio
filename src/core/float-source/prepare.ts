import{inspectTiff}from'../interchange/tiff/inspect';
import{floatTiffRows}from'../interchange/tiff/float-rows';
import{supportsFloatTiff}from'../interchange/tiff/types';
import{iccTarget}from'../color/profile-source';
import{NativeIccEngine}from'../color/icc-native';
import{descriptorKey,FLOAT_SOURCE_NATIVE_SHA,floatSourceInputSchema,floatSourceDescriptorSchema,type FloatSourceInput,type FloatSourceDescriptor,type FloatSourceControl}from'./types';
import{hashBlob,encodeTile}from'./codec';
export async function describeFloatSource(value:FloatSourceInput,control:FloatSourceControl={},hashOriginal:typeof hashBlob=hashBlob){
 const input=floatSourceInputSchema.parse(value),check=()=>control.signal?.throwIfAborted();check();const inspection=await inspectTiff(input.original),page=inspection.pages[input.tiff.page];check();
 if(!page||!supportsFloatTiff(page.report)||page.report.width!==input.width||page.report.height!==input.height)throw new Error('A retained original unsigned 16-bit or float32 TIFF with exact native geometry is required.');
 if(!page.icc&&!input.tiff.floatColorSpace)throw new Error('Unprofiled float source requires its explicit original color interpretation.');
 const sourceProfile=page.icc??new Uint8Array(await iccTarget(input.tiff.floatColorSpace!).source.arrayBuffer()),sourceProfileSha256=await hashBlob(new Blob([new Uint8Array(sourceProfile)]),control.signal),targetProfileSha256=await hashBlob(input.target,control.signal);
 if(input.expectedSource.kind!==(page.icc?'icc':'assumed')||input.expectedSource.sha256!==sourceProfileSha256||!page.icc&&(input.expectedSource.kind!=='assumed'||input.expectedSource.id!==input.tiff.floatColorSpace))throw new Error('Float source color identity differs from the retained original.');
 const sourceSha256=await hashOriginal(input.original,control.signal,fraction=>control.onProgress?.({phase:'hashing',fraction}));check();
 const descriptor:FloatSourceDescriptor=floatSourceDescriptorSchema.parse({version:1,format:'rgba-float32-le',sourceSha256,sourceBytes:input.original.size,width:input.width,height:input.height,orientation:page.report.orientation,tiff:input.tiff,sourceProfileSha256,targetProfileSha256,intent:input.intent,blackPointCompensation:input.blackPointCompensation,nativeWasmSha256:FLOAT_SOURCE_NATIVE_SHA,tileWidth:Math.min(256,input.width),tileHeight:Math.max(1,Math.min(64,input.height,Math.floor(8*1024*1024/(input.width*16))))});
 return{input,inspection,page,sourceProfile,descriptor,key:descriptorKey(descriptor)};
}
export async function* prepareFloatTiles(described:Awaited<ReturnType<typeof describeFloatSource>>,control:FloatSourceControl={},createEngine:()=>Promise<NativeIccEngine>=()=>NativeIccEngine.create()){
 const{input,inspection,page,descriptor:d,sourceProfile}=described,engine=await createEngine();const check=()=>control.signal?.throwIfAborted();
 try{
  check();const prepared=engine.beginRgb(sourceProfile,new Uint8Array(await input.target.arrayBuffer()),{inputFormat:'rgba-float32',outputFormat:'rgba-float32',intent:input.intent,blackPointCompensation:input.blackPointCompensation});const band=new Float32Array(d.width*d.tileHeight*4);let rows=0,index=0;
  yield{kind:'prepared' as const,prepared};
  for await(const row of floatTiffRows(inspection,page)){
   check();const pixels=engine.applyWindow(row.samples);if(!(pixels instanceof Float32Array))throw new Error('Float source conversion returned byte pixels.');band.set(pixels,rows*d.width*4);rows++;
   if(rows===d.tileHeight||row.top+1===d.height){for(let left=0;left<d.width;left+=d.tileWidth){check();const width=Math.min(d.tileWidth,d.width-left),tile=new Float32Array(width*rows*4);for(let y=0;y<rows;y++)tile.set(band.subarray((y*d.width+left)*4,(y*d.width+left+width)*4),y*width*4);const encoded=await encodeTile(index++,width,rows,tile);check();yield{kind:'tile' as const,tile:encoded};}rows=0;}
  }
 }finally{engine.dispose();}
}
