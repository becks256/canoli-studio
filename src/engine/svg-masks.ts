import type {AssetStore} from '../core/assets';
import {planSvgMasks,type SvgDocument,type SvgMaskTile,type SvgRasterMasks} from '../core/svg-masks';
import {maskTransform} from '../core/masks';
import {yieldTask} from '../core/task-yield';
import type {DocumentRenderer} from './renderer';
import {applyMaskSettings} from './masks';
import {release} from './canvas';
import {checkExport,type ExportControl} from './export-control';
import {svgEffectRegion} from '../core/svg-styles';

async function pngDataUrl(canvas:HTMLCanvasElement):Promise<string>{
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('The browser could not encode an SVG mask tile.')),'image/png'));
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error??new Error('Cannot read encoded SVG mask tile.'));
    reader.onabort=()=>reject(new DOMException('Mask encoding aborted','AbortError'));reader.readAsDataURL(blob);
  });
}

/** Native mask coverage only; original image RGB is never embedded in these tiles. */
export async function prepareSvgMasks(document:SvgDocument,assets:AssetStore,renderer:DocumentRenderer,control?:ExportControl):Promise<SvgRasterMasks>{
  checkExport(control);
  const plans=planSvgMasks(document).filter(plan=>!plan.vector),output=new Map<string,SvgMaskTile[]>();
  if(!plans.length)return output;
  const renderMask=renderer.renderMaskCoverage?.bind(renderer);
  if(!renderMask)throw new Error('This renderer cannot prepare native mask coverage for SVG export.');
  const lifetime=assets.captureLifetime();
  const pinned=plans.flatMap(plan=>plan.mask.kind==='bitmap'?[assets.get(plan.mask.assetId)]:[]);
  const current=()=>{
    checkExport(control);lifetime();
    for(const source of pinned)if(!assets.has(source.id)||assets.get(source.id)!==source)
      throw new Error('A mask source changed during SVG export. Retry with the current assets.');
  };
  const support=svgEffectRegion(document),regions=plans.map(plan=>plan.region??support);
  const total=regions.reduce((count,region)=>count+Math.ceil(region.width/1024)*Math.ceil(region.height/1024),0);
  let completed=0;
  control?.onProgress?.({phase:'rendering',fraction:0});
  for(let i=0;i<plans.length;i++){
    const plan=plans[i],region=regions[i];
    const tiles:SvgMaskTile[]=[];output.set(plan.layerId,tiles);
    const world=maskTransform(plan.mask,plan.world),origin=world.point({x:0,y:0});
    for(let top=0;top<region.height;top+=1024)for(let left=0;left<region.width;left+=1024){
      current();
      const x=region.x+left,y=region.y+top,width=Math.min(1024,region.width-left),height=Math.min(1024,region.height-top);
      const canvas=await renderMask(plan.mask,{x,y,width,height,sx:1,sy:1},origin.x,origin.y,`svg:${plan.id}`,false,world,assets);
      try{
        current();applyMaskSettings(canvas,plan.mask);
        const context=canvas.getContext('2d')!;context.save();
        try{context.globalAlpha=1;context.globalCompositeOperation='source-in';context.fillStyle='#ffffff';context.fillRect(0,0,width,height);}finally{context.restore();}
        const dataUrl=await pngDataUrl(canvas);current();tiles.push({x,y,width,height,dataUrl});
      }finally{release(canvas);}
      control?.onProgress?.({phase:'rendering',fraction:++completed/total});
      await yieldTask();current();
    }
  }
  if(!total)control?.onProgress?.({phase:'rendering',fraction:1});
  current();
  return output;
}
