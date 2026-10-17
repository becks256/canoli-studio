import type {DocumentData,LayerData} from './model';
import type {LayerMaskData} from './masks';
import {maskTransform} from './masks';
import {AffineTransform} from './affine';
import {localTransform} from './spatial';
import {svgNumber,svgPathCommands} from './svg-path';
import {svgArtwork,svgEffectRegion} from './svg-styles';
import {svgPaintClipKey} from './svg-paint';
import {selectionRegionTransform,type Rect,type SelectionData} from './drawing';

/** Private read-only export view; these fields are never project/model data. */
export type SvgDocument = Pick<DocumentData,'width'|'height'|'children'> & {
  svgNativePrefixes?:ReadonlyMap<string,readonly LayerData[]>;
  svgSupport?:Rect;
};
export interface SvgMaskPlan {
  layerId:string;
  id:string;
  world:AffineTransform;
  mask:LayerMaskData;
  vector:boolean;
  /** Only zero-outside stroke selection coverage may use smaller native support. */
  region?:Rect;
}
export interface SvgMaskTile {x:number;y:number;width:number;height:number;dataUrl:string}
export type SvgRasterMasks = ReadonlyMap<string,readonly SvgMaskTile[]>;

function strokeClipRegion(selection:SelectionData,world:AffineTransform,support:Rect):Rect{
  let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
  // Union is conservative for ordered add/subtract/intersect regions. Outside
  // every transformed region, native selection coverage is necessarily zero.
  for(const region of selection.regions){
    const b=world.multiply(selectionRegionTransform(region)).bounds(region);
    left=Math.min(left,b.x);top=Math.min(top,b.y);
    right=Math.max(right,b.x+b.width);bottom=Math.max(bottom,b.y+b.height);
  }
  if(left===Infinity)return{x:support.x,y:support.y,width:0,height:0};
  const x=Math.max(support.x,Math.min(support.x+support.width,Math.floor(left-2)));
  const y=Math.max(support.y,Math.min(support.y+support.height,Math.floor(top-2)));
  return{x,y,width:Math.max(0,Math.min(support.x+support.width,Math.ceil(right+2))-x),height:Math.max(0,Math.min(support.y+support.height,Math.ceil(bottom+2))-y)};
}

/** Only masks belonging to extracted, visible artwork subtrees are relevant. */
export function planSvgMasks(document:SvgDocument):SvgMaskPlan[]{
  const plans:SvgMaskPlan[]=[],support=svgEffectRegion(document);
  function walk(nodes:LayerData[],parent:AffineTransform){
    for(const layer of nodes){
      if(!svgArtwork(layer))continue;
      const world=parent.multiply(localTransform(layer)),mask=layer.mask;
      if(mask?.enabled&&mask.density>0)plans.push({layerId:layer.id,id:`canoli-mask-${plans.length+1}`,world,mask,
        vector:mask.kind==='vector'&&!mask.strokes?.length&&!(mask.feather??0)});
      if(layer.kind==='paint')for(let i=0;i<layer.strokes.length;i++){
        const stroke=layer.strokes[i];if(!stroke.clip)continue;
        plans.push({layerId:svgPaintClipKey(layer.id,i),id:`canoli-mask-${plans.length+1}`,world,vector:false,region:strokeClipRegion(stroke.clip,world,support),mask:{kind:'selection',enabled:true,inverted:false,density:1,linked:true,selection:stroke.clip}});
      }
      if(layer.kind==='group')walk(layer.children,world);
    }
  }
  walk(document.children,new AffineTransform());return plans;
}
function matrix(m:AffineTransform){return[m.a,m.b,m.c,m.d,m.e,m.f].map(svgNumber).join(' ');}

/** Definitions use the referencing layer's local plane, with explicit canvas bounds. */
export function* svgMaskDefinitions(document:SvgDocument,plans:SvgMaskPlan[],raster?:SvgRasterMasks):Generator<string>{
  if(!plans.length)return;
  yield '<defs>\n';
  for(const plan of plans){
    const inverse=plan.world.inverse(),b=inverse.bounds(svgEffectRegion(document));
    const bounds=`x="${svgNumber(b.x)}" y="${svgNumber(b.y)}" width="${svgNumber(b.width)}" height="${svgNumber(b.height)}"`;
    const {mask}=plan;
    // Alpha transfer inverts coverage independently of RGB/luminance/color space.
    if(plan.vector&&mask.inverted)yield `<filter id="${plan.id}-coverage" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" ${bounds}><feComponentTransfer ${bounds}><feFuncA type="linear" slope="${svgNumber(-mask.density)}" intercept="1" /></feComponentTransfer></filter>\n`;
    yield `<mask id="${plan.id}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" ${bounds} style="mask-type:alpha">\n`;
    if(plan.vector&&mask.kind==='vector'){
      if(mask.fillRule!=='evenodd'&&mask.fillRule!=='nonzero')throw new Error('Unsupported SVG mask fill rule.');
      if(mask.inverted)yield `<g filter="url(#${plan.id}-coverage)"><rect ${bounds} fill="#ffffff" opacity="0" />\n`;
      else if(mask.density<1)yield `<rect ${bounds} fill="#ffffff" opacity="${svgNumber(1-mask.density)}" />\n`;
      yield `<path transform="matrix(${matrix(inverse.multiply(maskTransform(mask,plan.world)))})" fill="#ffffff" fill-rule="${mask.fillRule}" d="`;
      for(const path of mask.paths){yield* svgPathCommands({points:path.points,closed:true});yield ' ';}
      yield '" />\n';
      if(mask.inverted)yield '</g>\n';
    }else{
      const tiles=raster?.get(plan.layerId);
      if(!tiles)throw new Error('This mask requires native coverage preparation. Use host editor.export({format: "svg"}).');
      yield `<g transform="matrix(${matrix(inverse)})">\n`;
      for(const tile of tiles){
        if(!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(tile.dataUrl))throw new Error('SVG mask tile must contain an embedded PNG.');
        yield `<image x="${svgNumber(tile.x)}" y="${svgNumber(tile.y)}" width="${svgNumber(tile.width)}" height="${svgNumber(tile.height)}" preserveAspectRatio="none" href="`;
        for(let at=0;at<tile.dataUrl.length;at+=65536)yield tile.dataUrl.slice(at,at+65536);
        yield '" />\n';
      }
      yield '</g>\n';
    }
    yield '</mask>\n';
  }
  yield '</defs>\n';
}
