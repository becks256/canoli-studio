import {refineEdgeOptionsSchema,type RefineEdgeSettings} from '../core/matting';
import {quickSelectionSeeds,quickSelectionRequestSchema} from '../core/quick-selection';
import {generateTrimapFromMask,dilateMask,erodeMask} from '../intelligence/matting/segmentation';
import {solveAlphaMatte,decontaminateColors} from '../intelligence/matting/engine';
import {featherAlpha,type PixelKernel} from './wasm';
import type {ClosedFormMatting} from '../intelligence/matting/closed-form';

export interface MattingTileRequest {
  x:number;y:number;width:number;height:number;sourceWidth:number;sourceHeight:number;
  core:{x:number;y:number;width:number;height:number};
  initial?:Uint8Array;labels?:Uint8Array;normalizeSourceAlpha?:boolean;
  options:RefineEdgeSettings;
}
export interface MattingTileResult {width:number;height:number;alpha:Uint8Array;rgba:Uint8ClampedArray;unresolvedPixels:number}

/** Same native labels for global assembly and output, independent of capture tile boundaries. */
export function prepareMattingTile(pixels:Uint8ClampedArray,input:MattingTileRequest){
  const {x,y,width,height,sourceWidth,sourceHeight,core}=input,count=width*height,options=refineEdgeOptionsSchema.parse(input.options);
  if(![x,y,width,height,sourceWidth,sourceHeight,core.x,core.y,core.width,core.height].every(Number.isSafeInteger)||width<1||height<1||sourceWidth<1||sourceHeight<1||!Number.isSafeInteger(count)||pixels.length!==count*4||
    core.x<0||core.y<0||core.width<1||core.height<1||core.x+core.width>width||core.y+core.height>height||
    (input.initial&&input.initial.length!==count)||(input.labels&&input.labels.length!==count))throw new Error('Invalid matting tile geometry.');
  const initial=input.initial?.slice(),explicit=input.labels?.slice();
  // Extend image edges, rather than inventing background outside an original source.
  for(let row=0;row<height;row++)for(let col=0;col<width;col++){
    const sx=Math.max(0,Math.min(sourceWidth-1,x+col))-x,sy=Math.max(0,Math.min(sourceHeight-1,y+row))-y;
    if(sx<0||sx>=width||sy<0||sy>=height)throw new Error('Matting tile does not contain its source-edge support.');
    const index=row*width+col,from=sy*width+sx;
    if(index!==from){pixels.set(pixels.subarray(from*4,from*4+4),index*4);if(initial)initial[index]=initial[from];if(explicit)explicit[index]=explicit[from];}
  }
  if(initial&&input.normalizeSourceAlpha)for(let i=0;i<count;i++)initial[i]=pixels[i*4+3]?Math.min(255,Math.round(initial[i]*255/pixels[i*4+3])):0;
  if(initial&&!explicit&&!options.trimapStrokes.length&&(initial[0]===0||initial[0]===255)&&initial.every(value=>value===initial[0])){
    return{pixels,initial,labels:new Uint8Array(count).fill(initial[0]),estimate:undefined,options};
  }
  let labels:Uint8Array;
  if(explicit){if(explicit.some(value=>value!==0&&value!==128&&value!==255))throw new Error('Trimap labels must be 0, 128 or 255.');labels=explicit;}
  else{
    if(!initial)throw new Error('Matting requires an initial mask or explicit trimap.');
    const radius=Math.round(options.radius*options.shiftEdge/100);
    const shifted=radius>0?dilateMask(initial,width,height,radius):radius<0?erodeMask(initial,width,height,-radius):initial;
    labels=options.radius>0?generateTrimapFromMask(shifted,width,height,Math.ceil(options.radius)).data:Uint8Array.from(shifted,value=>value===255?255:value===0?0:128);
  }
  const estimate=initial&&!explicit&&options.radius===0?new Uint8Array(count):undefined;
  for(const stroke of options.trimapStrokes){
    const spans=quickSelectionSeeds(quickSelectionRequestSchema.parse({x,y,width,height,points:stroke.points,size:stroke.size}));
    const label=stroke.mode==='foreground'?255:stroke.mode==='background'?0:128;
    for(let i=0;i<spans.length;i+=2){labels.fill(label,spans[i],spans[i+1]);if(estimate)estimate.fill(stroke.mode==='refine'?1:0,spans[i],spans[i+1]);}
  }
  return{pixels,initial,labels,estimate,options};
}

/** Worker-only postprocessing; global closed-form coverage never solves independently per tile. */
export function refineMattingTile(kernel:PixelKernel,pixels:Uint8ClampedArray,input:MattingTileRequest,global?:ClosedFormMatting):MattingTileResult {
  const {width,height,core}=input,{initial,labels,estimate,options}=prepareMattingTile(pixels,input),count=width*height;
  let prior=initial,estimation=estimate;const unresolved=new Uint8Array(count);
  if(options.solver==='closed-form'){
    prior=initial?.slice()??new Uint8Array(count);estimation=new Uint8Array(count);
    for(let i=0;i<count;i++)if(labels[i]===128&&pixels[i*4+3]&&!(estimate&&!estimate[i]&&initial)){
      if(!global)throw new Error('Closed-form matting requires a complete global preparation.');
      const value=global.sample(input.x+i%width,input.y+Math.floor(i/width));if(!value)throw new Error('Missing native closed-form coverage.');prior[i]=value.alpha;unresolved[i]=value.unresolved?1:0;
    }
  }
  const result=solveAlphaMatte(new Uint8Array(pixels.buffer,pixels.byteOffset,pixels.byteLength),{width,height,data:labels},{...options,trimap:undefined,edgeFeather:0,feather:0,decontaminate:false},prior,estimation);
  if(options.edgeFeather){
    const mask=new Uint8ClampedArray(count*4);for(let i=0;i<count;i++)mask[i*4+3]=result.alpha[i];
    const blurred=featherAlpha(kernel,mask,{width,height,radiusX:options.edgeFeather/3,radiusY:options.edgeFeather/3});
    for(let i=0;i<count;i++)if(labels[i]===128)result.alpha[i]=blurred[i*4+3];
  }
  for(let i=0;i<count;i++)if(labels[i]===128&&!pixels[i*4+3])result.alpha[i]=initial?.[i]??0;
  const rgba=options.decontaminate?decontaminateColors(new Uint8Array(pixels.buffer,pixels.byteOffset,pixels.byteLength),result.alpha,labels,width,height,options.decontaminateAmount):pixels;
  const alpha=new Uint8Array(core.width*core.height),output=new Uint8ClampedArray(alpha.length*4);let unresolvedPixels=0;
  for(let row=0;row<core.height;row++)for(let col=0;col<core.width;col++){
    const index=(core.y+row)*width+core.x+col,out=row*core.width+col;
    alpha[out]=result.alpha[index];for(let c=0;c<4;c++)output[out*4+c]=rgba[index*4+c];unresolvedPixels+=options.solver==='closed-form'?unresolved[index]:(result.unresolved?.[index]??0);
  }
  return{width:core.width,height:core.height,alpha,rgba:output,unresolvedPixels};
}
