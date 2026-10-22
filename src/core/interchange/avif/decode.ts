import {buildStandardIccProfile} from '../../color/icc';
import {PngRowEncoder} from '../../png-stream';
import {inspectAvifInput} from './inspect';
import {avifDecodeOptionsSchema,avifRgbKind,avifUnidentifiedColorWarning,type AvifDecodeOptions,type AvifDecodeSettings,type AvifImportReport} from './types';

/** Native, untransformed, unmanaged, unassociated samples plus checked source metadata. */
export interface AvifDecodedImage {width:number;height:number;bitDepth:number;alpha:boolean;color:{primaries:number;transfer:number;matrix:number;fullRange:boolean};data:Uint8ClampedArray}
export interface AvifDecoder {decode(bytes:Uint8Array,depth:8):AvifDecodedImage|null}
export function assertAvifImportAllowed(report:AvifImportReport,settings:AvifDecodeSettings):void{
  if(!report.canDecode)throw new Error('Unsupported AVIF: '+report.unsupported.join('; '));
  if(report.requiresPrecisionLoss&&!settings.allowPrecisionLoss)throw new Error(`AVIF ${report.bitDepth}-bit import requires explicit 8-bit precision-loss consent.`);
  if(report.requiresColorAssumption&&!settings.assumeSrgb)throw new Error('AVIF without a complete RGB colour identification requires explicit sRGB assumption.');
}
export async function decodeAvifInput(blob:Blob,decoder:AvifDecoder,options:AvifDecodeOptions={},progress?:(fraction:number)=>void){
  const settings=avifDecodeOptionsSchema.parse(options),{report,icc}=await inspectAvifInput(blob);
  assertAvifImportAllowed(report,settings);
  progress?.(0);
  const image=decoder.decode(new Uint8Array(await blob.arrayBuffer()),8);
  if(!image||image.width!==report.width||image.height!==report.height||image.bitDepth!==report.bitDepth||image.alpha!==report.alpha||!(image.data instanceof Uint8ClampedArray)||image.data.length!==report.width*report.height*4)throw new Error('AVIF decoder returned missing or inconsistent native image pixels.');
  for(const key of ['primaries','transfer','matrix','fullRange'] as const)if(report.color[key]!==null&&report.color[key]!==image.color[key])throw new Error('AVIF decoded color identification differs from its container.');
  if(image.color.transfer===16||image.color.transfer===18)throw new Error('Unsupported AVIF HDR PQ/HLG in the AV1 stream; an explicit tone-mapping pipeline is required.');
  let resolved=report;
  if(!icc&&report.color.kind==='unspecified'){
    const kind=avifRgbKind(image.color.primaries,image.color.transfer);
    if(kind==='unsupported')throw new Error(`Unsupported AVIF RGB identification in the AV1 stream: primaries ${image.color.primaries}, transfer ${image.color.transfer}.`);
    if(kind!=='unspecified')resolved={...report,color:{kind,...image.color},requiresColorAssumption:false,
      warnings:[...report.warnings.filter(warning=>warning!==avifUnidentifiedColorWarning),`RGB identification resolved from the native AV1 stream (${kind}); identified source color takes precedence over an assumption.`,
        ...(kind==='display-p3'||kind==='linear-srgb'?['The decoded PNG retains an RGB ICC profile for browser conversion to the current 8-bit editing space; wide-gamut/HDR editing is not implied.']:[])]};
  }
  // The checked codec converts 10/12-bit planes to RGBA8 only after consent.
  // The source Blob is immutable and is never replaced by this editing proxy.
  const profile=icc??(resolved.color.kind==='display-p3'||resolved.color.kind==='linear-srgb'?buildStandardIccProfile(resolved.color.kind,'AVIF source'):undefined);
  const compressedProfile=profile?new Uint8Array(await new Response(new Blob([new Uint8Array(profile)]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer()):undefined;
  const encoder=new PngRowEncoder(report.displayWidth,report.displayHeight,compressedProfile,'AVIF source'),rowsPerBatch=Math.max(1,Math.min(64,Math.floor(4_000_000/(report.displayWidth*4))));
  try{
    const {crop,rotation,mirror}=report,w=report.displayWidth,h=report.displayHeight;
    for(let y=0;y<h;y+=rowsPerBatch){
      const rows=Math.min(rowsPerBatch,h-y),output=new Uint8Array(w*rows*4);
      for(let row=0;row<rows;row++)for(let x=0;x<w;x++){
        // HEIF imir: 0 exchanges top/bottom; 1 exchanges left/right.
        const dx=mirror===1?w-1-x:x,dy=mirror===0?h-1-(y+row):y+row;
        const sx=rotation===0?dx:rotation===1?crop.width-1-dy:rotation===2?crop.width-1-dx:dy;
        const sy=rotation===0?dy:rotation===1?dx:rotation===2?crop.height-1-dy:crop.height-1-dx;
        const from=((crop.y+sy)*report.width+crop.x+sx)*4,to=(row*w+x)*4;
        output[to]=image.data[from];output[to+1]=image.data[from+1];output[to+2]=image.data[from+2];output[to+3]=image.data[from+3];
      }
      await encoder.append(output,rows);progress?.((y+rows)/h);
    }
    return{png:await encoder.finish(),report:resolved};
  }catch(error){await encoder.abort(error);throw error;}
}
