import{TiffTileEncoder}from'../../tiff-encoder';
import{NativeIccEngine}from'../../color/icc-native';
import{STANDARD_PROFILES}from'../../color/icc';
import{hasLensCorrection}from'./lens';
import{rawLensSampler}from'./lens-sampler';
import type{OwnedRawImage}from'./codec';
import type{OwnedLensCorrection}from'../lens/codec';
import type{RawTiffSettings}from'./tiff-types';
/** Native master pixels only: no Canvas/ImageData or 8-bit transfer table. */
export async function encodeRawTiffImage(image:OwnedRawImage,settings:RawTiffSettings,engine:NativeIccEngine,profile:Uint8Array,progress?:(fraction:number)=>void,lensProfile?:OwnedLensCorrection){
 let sampler:ReturnType<typeof rawLensSampler>|undefined,encoder:TiffTileEncoder|undefined;
 try{
  if(hasLensCorrection(settings.development.lens))sampler=rawLensSampler(image,settings.development.lens!,lensProfile);
  else if(lensProfile)throw new Error('Inactive lens settings cannot consume a native profile lease.');
  if(!sampler&&!image.readRegion)throw new Error('Native TIFF delivery requires bounded RAW region reads.');
  encoder=new TiffTileEncoder(image.width,image.height,settings.variant,profile,settings.sampleFormat);progress?.(0);let completed=0;
  for(let y=0;y<image.height;y+=encoder.tileHeight)for(let x=0;x<image.width;x+=encoder.tileWidth){
   const width=Math.min(encoder.tileWidth,image.width-x),height=Math.min(encoder.tileHeight,image.height-y),corrected=sampler?.region(x,y,width,height),rgb=corrected?.pixels??image.readRegion!(x,y,width,height),channels=corrected?3:image.channels;
   if(rgb.length!==width*height*channels)throw new Error('RAW native region does not match TIFF source geometry.');
   const rgba=new Uint16Array(width*height*4);
   for(let i=0;i<width*height;i++){rgba[i*4]=rgb[i*channels];rgba[i*4+1]=rgb[i*channels+(channels===1?0:1)];rgba[i*4+2]=rgb[i*channels+(channels===1?0:2)];rgba[i*4+3]=corrected?corrected.alpha[i]*257:65535;}
   const converted=engine.applyWindow(rgba),padded=settings.sampleFormat==='rgba16'?new Uint16Array(encoder.tileWidth*encoder.tileHeight*4):new Float32Array(encoder.tileWidth*encoder.tileHeight*4);
   for(let row=0;row<height;row++)padded.set(converted.subarray(row*width*4,(row+1)*width*4),(row*encoder.tileWidth)*4);
   await encoder.append(padded);progress?.(++completed/encoder.totalTiles);
  }
  return encoder.finish();
 }catch(error){encoder?.abort();throw error;}
 finally{sampler?.dispose();try{image.dispose();}finally{lensProfile?.dispose();}}
}
export async function prepareRawTiffTransform(settings:RawTiffSettings,engine:NativeIccEngine){
 const profile=new Uint8Array(await settings.color.profile.source.arrayBuffer());
 const{rawTiffHash}=await import('./tiff-types');if(await rawTiffHash(profile)!==settings.color.profile.sha256)throw new Error('RAW TIFF output profile differs from its complete source fingerprint.');
 const source=new Uint8Array(STANDARD_PROFILES['linear-srgb'].iccBytes!),prepared=engine.beginRgb(source,profile,{inputFormat:'rgba16',outputFormat:settings.sampleFormat,intent:settings.color.intent,blackPointCompensation:settings.color.blackPointCompensation});return{profile,prepared};
}
