import {AssetStore} from '../core/assets';
import {findLayer,id,type DocumentData,type LayerData} from '../core/model';
import {refineEdgeOptionsSchema,mattingHalo,type RefineEdgeOptions} from '../core/matting';
import {createCanvas,release} from './canvas';
import {MattingSource} from './matting-source';
import {needsClosedForm} from './matting-workflow';

/** A display proxy only; it is never installed or reused for final native output. */
export async function previewMatting(document:DocumentData,assets:AssetStore,layerId:string,input:RefineEdgeOptions,signal:AbortSignal,assertCurrent:()=>void=()=>{}){
  const layer=findLayer(document,layerId);if(layer?.kind!=='raster')throw new Error('Select a raster layer to refine its edge.');
  const original=assets.get(layer.assetId),factor=Math.min(1,512/original.width,512/original.height),width=Math.max(1,Math.round(original.width*factor)),height=Math.max(1,Math.round(original.height*factor));
  const alive=assets.captureLifetime(),view=new AssetStore();let source:MattingSource|undefined;
  const check=()=>{signal.throwIfAborted();alive();assertCurrent();if(assets.get(original.id)!==original)throw new Error('Preview source changed.');};
  const cancel=()=>source?.dispose();signal.addEventListener('abort',cancel,{once:true});
  const proxy=async(assetId:string,nearest=false)=>{
    check();const asset=assets.get(assetId),canvas=createCanvas(width,height,true);
    try{
      const context=canvas.getContext('2d')!;context.imageSmoothingEnabled=!nearest;context.drawImage(asset.bitmap,0,0,width,height);
      const bitmap=await createImageBitmap(canvas),key=id();try{check();view.install({...asset,id:key,width,height,bitmap},false);return key;}catch(error){bitmap.close();throw error;}
    }finally{release(canvas);}
  };
  try{
    for(const asset of assets.values())assets.shareTo(view,asset.id,asset.id);
    const settings=refineEdgeOptionsSchema.parse(input),key=await proxy(original.id),sx=width/original.width,sy=height/original.height;
    const walk=(nodes:LayerData[]):LayerData[]=>nodes.map(node=>node.id===layerId?{...node,assetId:key} as LayerData:node.kind==='group'?{...node,children:walk(node.children)}:node);
    const snapshot={...document,children:walk(document.children)};
    const trimap=settings.trimap?new Uint8Array(width*height):undefined;
    if(trimap)for(let y=0;y<height;y++)for(let x=0;x<width;x++)trimap[y*width+x]=settings.trimap![Math.min(original.height-1,Math.floor((y+.5)/sy))*original.width+Math.min(original.width-1,Math.floor((x+.5)/sx))];
    const options=refineEdgeOptionsSchema.parse({...settings,smooth:undefined,feather:undefined,radius:settings.radius*factor,edgeFeather:settings.edgeFeather*factor,trimap,trimapAssetId:settings.trimapAssetId?await proxy(settings.trimapAssetId,true):undefined,
      trimapStrokes:settings.trimapStrokes.map(stroke=>({...stroke,size:Math.max(.5,stroke.size*factor),points:stroke.points.map(point=>({x:point.x*sx,y:point.y*sy}))}))});
    source=new MattingSource(snapshot,view,{layerId,options},check,true);await source.initialize(signal,true);check();
    const halo=mattingHalo(options),region={x:-halo,y:-halo,width:width+2*halo,height:height+2*halo,core:{x:halo,y:halo,width,height}};let tile=await source.captureTile(region);
    if(needsClosedForm(options)){await source.processor.beginMatting(width,height);await source.processor.accumulateMatting(tile.pixels,tile.request);await source.processor.solveMatting();check();tile=await source.captureTile(region);}
    const result=await source.processor.mattingTile(tile.pixels,tile.request);check();return result;
  }finally{signal.removeEventListener('abort',cancel);source?.dispose();view.dispose();}
}
