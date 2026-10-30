import {Document,RasterLayer,AffineTransform} from '../src/dom';
import {AssetStore} from '../src/core/assets';
import {execute,type EditorCommand} from '../src/core/commands';
import {assertFloatSources,isFloatDocument} from '../src/core/float-document';
import {id,referencedAssets} from '../src/core/model';
import {captureRetainedHistory,retainedDocuments} from '../src/core/history';
import type {TiffDecodeOptions} from '../src/core/interchange/tiff/types';
import type {FloatSourceControl} from '../src/core/float-source/types';
import {ServerTiffService} from './tiff';

/** TIFF orientation applies to placement. Encoded original dimensions and raw
 * source-window coordinates stay intact, including quarter-turn orientations. */
export function tiffPlacement(orientation:number,width:number,height:number):[number,number,number,number,number,number]{
  const matrices:[number,number,number,number,number,number][]=[[1,0,0,1,0,0],[-1,0,0,1,width,0],[-1,0,0,-1,width,height],[1,0,0,-1,0,height],[0,1,1,0,0,0],[0,1,-1,0,height,0],[0,-1,-1,0,height,width],[0,-1,1,0,0,width]];
  if(!Number.isInteger(orientation)||orientation<1||orientation>8)throw new Error('Invalid original TIFF orientation.');return matrices[orientation-1];
}

/** Authored canvas geometry stays unchanged. The placed raster retains native
 * pixels; precision plus its layer commit as one shared command transaction. */
export async function importServerTiff(document:Document,assets:AssetStore,service:ServerTiffService,blob:Blob,name:string,options:TiffDecodeOptions,control:FloatSourceControl,check:()=>void,beforeCommit:()=>void){
  const commands:EditorCommand[]=[];
  if(!isFloatDocument(document._read())){const command={type:'document.precision.float' as const};assertFloatSources(execute(document._read(),command),assets);commands.push(command);}
  check();const source=await service.prepare(blob,options,{signal:control.signal,onProgress:value=>{check();control.onProgress?.(value);check();}});let assetId:string|undefined,retained=false;
  try{
    check();const d=source.manifest.descriptor,layer=new RasterLayer({name,assetId:id(),width:d.width,height:d.height});
    layer.transform=new AffineTransform(...tiffPlacement(d.orientation,d.width,d.height));commands.push({type:'layer.add',layer:layer.toJSON()});
    const command:EditorCommand={type:'transaction',label:'Import high-precision TIFF',commands};execute(document._read(),command);check();
    const thumbnail='data:image/png;base64,'+Buffer.from(await source.preview.arrayBuffer()).toString('base64');check();beforeCommit();
    assetId=layer.assetId;const asset=assets.installEncodedTiff({id:assetId,name,width:d.width,height:d.height,blob:source.original,tiff:d.tiff,tiffColor:source.color,thumbnail});service.bind(asset,source,document.id);
    document._dispatch(command);retained=true;return{layerId:layer.id,assetId,report:source.report,source:{format:'rgba-float32-le',colorSpace:'linear-srgb',sourceSha256:d.sourceSha256,page:d.tiff.page,orientation:d.orientation,nativeWasmSha256:d.nativeWasmSha256}};
  }finally{
    if(!retained&&assetId){const state=document.getSnapshot();retained=retainedDocuments(state.document,captureRetainedHistory(state)).some(value=>referencedAssets(value).has(assetId!));if(!retained&&assets.has(assetId))assets.remove(assetId);}
    if(!retained)await source.dispose();
  }
}
