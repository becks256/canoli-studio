import build from'../../color/codec/build.json' with{type:'json'};
import type{TiffFloatColor}from'./types';
import{NativeIccEngine}from'../../color/icc-native';
import{STANDARD_PROFILES}from'../../color/icc';
import{PngRowEncoder}from'../../png-stream';
import{floatTiffRows}from'./float-rows';
import type{InspectedTiff,TiffPage}from'./inspect';
import type{TiffDecodeSettings}from'./types';
export async function decodeFloatTiff(inspection:InspectedTiff,page:TiffPage,settings:TiffDecodeSettings,progress?:(fraction:number)=>void){
 if(!settings.allowPrecisionLoss)throw new Error('TIFF float import requires explicit 8-bit precision-loss consent.');
 if(!page.icc&&!settings.floatColorSpace)throw new Error('Choose an explicit float TIFF color-space interpretation for this unprofiled source.');
 const source=page.icc??new Uint8Array(STANDARD_PROFILES[settings.floatColorSpace!].iccBytes!),engine=await NativeIccEngine.create();let encoder:PngRowEncoder|undefined;
 try{
  const digest=await crypto.subtle.digest('SHA-256',new Uint8Array(source)),sha256=[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join(''),prepared=engine.beginRgb(source,new Uint8Array(STANDARD_PROFILES.srgb.iccBytes!),{inputFormat:'rgba-float32',outputFormat:'rgba8'});encoder=new PngRowEncoder(page.report.width,page.report.height);progress?.(0);
  const rows=Math.max(1,Math.min(64,Math.floor(4_000_000/(page.report.width*20)))),batch=new Float32Array(page.report.width*rows*4);let count=0;
  for await(const row of floatTiffRows(inspection,page)){
   for(let i=0;i<row.samples.length;i++)if(i%4!==3&&(row.samples[i]<0||row.samples[i]>1))throw new Error('TIFF float RGB exceeds normalized SDR [0,1]. HDR tone mapping is not implemented; original samples have not been changed.');
   batch.set(row.samples,count*page.report.width*4);count++;
   if(count===rows||row.top+1===page.report.height){const result=engine.applyWindow(batch.subarray(0,count*page.report.width*4));await encoder.append(new Uint8Array(result.buffer,result.byteOffset,result.byteLength),count);count=0;progress?.((row.top+1)/page.report.height);}
  }
  const color:TiffFloatColor={version:1,engine:'Little CMS 2.19.1',wasmSha256:build.artifacts['canoli_icc.wasm'].sha256,source:page.icc?{kind:'icc',sha256}:{kind:'assumed',id:settings.floatColorSpace!,sha256},outputSpace:'srgb8',usesIntentFallback:prepared.usesIntentFallback,warnings:prepared.warnings};
  return{png:await encoder.finish(),page:page.report,report:inspection.report,color};
 }catch(error){await encoder?.abort(error);throw error;}finally{engine.dispose();}
}
