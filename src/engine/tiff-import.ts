import {AssetStore} from '../core/assets';
import {AffineTransform,Document,RasterLayer} from '../dom';
import {inspectTiffFile} from '../core/interchange/tiff/client';
import {tiffDecodeOptionsSchema,type TiffDecodeOptions,type TiffImportControl} from '../core/interchange/tiff/types';

/** Orientation is native non-destructive placement; source pixels/bytes stay in TIFF coordinates. */
export function tiffOrientation(value:number,width:number,height:number):AffineTransform{
 const transforms:Record<number,[number,number,number,number,number,number]>={1:[1,0,0,1,0,0],2:[-1,0,0,1,width,0],3:[-1,0,0,-1,width,height],4:[1,0,0,-1,0,height],5:[0,1,1,0,0,0],6:[0,1,-1,0,height,0],7:[0,-1,-1,0,height,width],8:[0,-1,1,0,0,width]};
 const matrix=transforms[value];if(!matrix)throw new Error('Unsupported TIFF orientation.');return new AffineTransform(...matrix);
}
export async function prepareTiffImport(file:File,options:TiffDecodeOptions={},control:TiffImportControl={},check:()=>void=()=>{}){
 const settings=tiffDecodeOptionsSchema.parse(options),current=()=>{control.signal?.throwIfAborted();check();},progress:TiffImportControl={signal:control.signal,onProgress:p=>{current();control.onProgress?.(p);current();}};current();
 const report=await inspectTiffFile(file,progress),page=report.pages[settings.page];current();if(!page)throw new Error('TIFF page does not exist.');if(!page.canDecode)throw new Error('Unsupported TIFF: '+page.unsupported.join('; '));if(page.requiresPrecisionLoss&&!settings.allowPrecisionLoss)throw new Error('TIFF high-precision import requires explicit 8-bit precision-loss consent.');
 if(page.requiresColorAssumption&&!settings.floatColorSpace)throw new Error('Choose an explicit color-space interpretation for this unprofiled float TIFF.');
 const assets=new AssetStore();try{
  const blob=file.type==='image/tiff'?file:file.slice(0,file.size,'image/tiff'),asset=await assets.add(blob,file.name,undefined,true,{...progress,tiff:settings});current();if(asset.width!==page.width||asset.height!==page.height)throw new Error('Decoded TIFF dimensions differ from the inspected source.');
  const swapped=page.orientation>=5,document=new Document({name:file.name.replace(/\.(tif|tiff)$/i,'').slice(0,240)||'Imported TIFF',width:swapped?page.height:page.width,height:swapped?page.width:page.height});const layer=new RasterLayer({name:report.pages.length>1?`Page ${settings.page+1}`:file.name.slice(0,240),assetId:asset.id,width:asset.width,height:asset.height});layer.transform=tiffOrientation(page.orientation,page.width,page.height);document.layers.add(layer);
  current();return{document:Document.fromJSON(document.toJSON()),assets,report};
 }catch(error){assets.dispose();throw error;}
}
