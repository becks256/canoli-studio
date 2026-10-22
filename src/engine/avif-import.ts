import {AssetStore} from '../core/assets';
import {Document,RasterLayer} from '../dom';
import {avifDecodeOptionsSchema,type AvifDecodeOptions,type AvifImportControl} from '../core/interchange/avif/types';

/** Decode the encoded presentation at native resolution, retaining the complete original source. */
export async function prepareAvifImport(file:File,options:AvifDecodeOptions={},control:AvifImportControl={},check:()=>void=()=>{}){
  const settings=avifDecodeOptionsSchema.parse(options),current=()=>{control.signal?.throwIfAborted();check();};current();
  const assets=new AssetStore();
  try{
    const blob=file.type==='image/avif'?file:file.slice(0,file.size,'image/avif');
    const asset=await assets.add(blob,file.name,undefined,true,{avif:settings,signal:control.signal,onProgress:value=>{current();control.onProgress?.(value);current();}});
    current();const report=asset.avifReport;if(!report)throw new Error('Missing decoded AVIF capability report.');
    const document=new Document({name:file.name.replace(/\.avif$/i,'').slice(0,240)||'Imported AVIF',width:asset.width,height:asset.height});
    document.layers.add(new RasterLayer({name:file.name.slice(0,240)||'AVIF image',assetId:asset.id,width:asset.width,height:asset.height}));
    current();return{document:Document.fromJSON(document.toJSON()),assets,report};
  }catch(error){assets.dispose();throw error;}
}
