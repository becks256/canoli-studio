import type {PaintOperationData,BrushStrokeData,FillData} from '../core/drawing';
import {strokeBounds} from '../core/drawing';
import {srgbToLinear} from '../core/color/spaces';
import {AffineTransform} from '../core/affine';
import type {AssetStore} from '../core/assets';
import {validateWindow,type FloatSourceWindow} from '../core/float-source/types';
import type {PixelProcessor} from './processor';
import type {BrushTextureSampler} from './brush-texture';
import {drawPaint} from './drawing';
import {createCanvas,release,type RenderSpace} from './canvas';
import {yieldTask} from '../core/task-yield';
import {validateFloatAlpha} from '../core/float-shadow';
import {validateFloatWorkerWindow} from './float-pixels';
import type {WetPaintStrokeData} from '../core/wet-operation';
import {isActiveWetPaint} from '../core/wet-operation';
import {unionBounds} from '../core/spatial';
import {projectFloatWindow} from './float-projection';

export type FloatPaintOperation=BrushStrokeData|FillData;
export type FloatPaintCoverage=(operation:FloatPaintOperation,space:RenderSpace,world:AffineTransform,check:()=>void)=>Promise<Float32Array>;
export type FloatCloneRead=((stroke:BrushStrokeData,area:FloatSourceWindow,world:AffineTransform)=>Promise<Float32Array>)&{previewId?:string};

/** Only scalar coverage crosses Canvas. A fixed lattice retains crop parity;
 * opacity is deliberately removed here and applied once in float composition. */
export async function renderFloatPaintCoverage(operation:FloatPaintOperation,space:RenderSpace,world:AffineTransform,processor:PixelProcessor,assets:AssetStore,textures:BrushTextureSampler,check:()=>void):Promise<Float32Array>{
 check();space={...space};const cell=256,gutter=2;
 const neutral=operation.kind==='fill'?{...operation,color:'#ffffff',opacity:1,erase:false}:{...operation,precision:undefined,tiles:[],kind:operation.kind==='eraser'||operation.kind==='clone'?'brush' as const:operation.kind,color:'#ffffff',opacity:1};
 const pixelX=space.x*space.sx,pixelY=space.y*space.sy;
 if(![pixelX,pixelY,pixelX+space.width,pixelY+space.height].every(Number.isSafeInteger))throw new Error('Float paint coverage requires a native integer pixel window.');
 if(![space.sx,space.sy].every(value=>Number.isFinite(value)&&value>0))throw new Error('Invalid float paint coverage scale.');
 validateWindow({x:pixelX,y:pixelY,width:space.width,height:space.height});const output=new Float32Array(space.width*space.height),bounds=world.bounds(strokeBounds(neutral));
 for(let cy=Math.floor(pixelY/cell)*cell;cy<pixelY+space.height;cy+=cell)for(let cx=Math.floor(pixelX/cell)*cell;cx<pixelX+space.width;cx+=cell){
  check();const padded={...space,x:(cx-gutter)/space.sx,y:(cy-gutter)/space.sy,width:cell+2*gutter,height:cell+2*gutter};
  if(bounds.x>=padded.x+padded.width/padded.sx||bounds.y>=padded.y+padded.height/padded.sy||bounds.x+bounds.width<=padded.x||bounds.y+bounds.height<=padded.y)continue;
  const canvas=createCanvas(padded.width,padded.height,true);
  try{
   await drawPaint({id:'float-coverage',name:'Coverage',kind:'paint',x:0,y:0,visible:true,locked:false,opacity:1,blendMode:'normal',strokes:[neutral]},assets,canvas,padded,world,processor,undefined,undefined,undefined,undefined,()=>{check();return false;},textures);check();
   const left=Math.max(cx,pixelX),top=Math.max(cy,pixelY),width=Math.min(cx+cell,pixelX+space.width)-left,height=Math.min(cy+cell,pixelY+space.height)-top;
   const bytes=canvas.getContext('2d')!.getImageData(left-cx+gutter,top-cy+gutter,width,height).data;
   for(let y=0;y<height;y++)for(let x=0;x<width;x++)output[(top-pixelY+y)*space.width+left-pixelX+x]=bytes[(y*width+x)*4+3]/255;
  }finally{release(canvas);}
 }
 check();return output;
}

/** Ordered editable native paint. A wet reader supplies validated, captured
 * premultiplied pigment/alpha/removal, never display pixels or brush coverage. */
export async function replayFloatPaint(strokes:readonly PaintOperationData[],area:FloatSourceWindow,world:AffineTransform,coverage:FloatPaintCoverage,processor:Pick<PixelProcessor,'floatComposite'>&Partial<Pick<PixelProcessor,'floatCompositeHdrWet'>>,check:()=>void,wet?:(stroke:WetPaintStrokeData,area:FloatSourceWindow)=>Promise<Float64Array>,clone?:FloatCloneRead):Promise<Float32Array>{
 check();area=validateWindow(area);let output:Float32Array=new Float32Array(area.width*area.height*4);
 for(const stroke of strokes){
  check();if(stroke.kind==='clone'&&stroke.precision!=='float32')throw new Error('Float clone strokes require explicit native float sources.');
  if(stroke.kind==='wet'){
   if(stroke.precision!=='float32')throw new Error('Float paint replacements require explicit HDR wet paint.');
   if(stroke.opacity===0)continue;
   if(!wet||!processor.floatCompositeHdrWet)throw new Error('Float wet paint replay service is unavailable.');
   const field=await wet(stroke,area);check();
   const next=await processor.floatCompositeHdrWet(output,field,stroke.opacity);check();validateFloatWorkerWindow(next);if(next.length!==output.length)throw new Error('Float wet paint composition returned the wrong geometry.');output=next;continue;
  }
  if(stroke.opacity===0||stroke.kind!=='fill'&&stroke.flow===0)continue;
  const mask=await coverage(stroke,{...area,sx:1,sy:1},world,check);check();validateFloatAlpha(mask,area.width*area.height);
  if(stroke.kind!=='fill'&&(stroke.kind==='clone'||stroke.id===clone?.previewId)){
   if(!clone)throw new Error('Float clone source service is unavailable.');
   const source=await clone(stroke,area,world);check();validateFloatWorkerWindow(source);if(source.length!==output.length)throw new Error('Float clone source returned the wrong geometry.');
   const next=await processor.floatComposite(source,output,{mode:'normal',opacity:stroke.opacity,mask});check();validateFloatWorkerWindow(next);if(next.length!==output.length)throw new Error('Float clone composition returned the wrong geometry.');output=next;continue;
  }
  if(stroke.kind==='eraser'||stroke.kind==='fill'&&stroke.erase){
   output=output.slice();let deadline=performance.now()+2;
   for(let p=0;p<output.length;p+=4){output[p+3]=output[p+3]*(1-mask[p/4]*stroke.opacity);if((p&511)===0&&performance.now()>=deadline){check();await yieldTask();check();deadline=performance.now()+2;}}
  }else{
   const rgb=[1,3,5].map(start=>srgbToLinear(parseInt(stroke.color.slice(start,start+2),16)/255)),source=new Float32Array(output.length);
   let deadline=performance.now()+2;for(let p=0;p<source.length;p+=4){source[p]=rgb[0];source[p+1]=rgb[1];source[p+2]=rgb[2];source[p+3]=mask[p/4];if((p&511)===0&&performance.now()>=deadline){check();await yieldTask();check();deadline=performance.now()+2;}}
   const next=await processor.floatComposite(source,output,{mode:'normal',opacity:stroke.opacity});check();validateFloatWorkerWindow(next);if(next.length!==output.length)throw new Error('Float paint composition returned the wrong geometry.');output=next;
  }
 }
 check();return output;
}

/** Active replacements choose the same content-local reconstruction as byte
 * PaintLayers: all operations precede the current owner/ancestor affine. Inert
 * records must not change the established dry document-lattice rasterization. */
export async function renderFloatPaint(strokes:readonly PaintOperationData[],area:FloatSourceWindow,world:AffineTransform,coverage:FloatPaintCoverage,processor:Pick<PixelProcessor,'floatComposite'|'floatCompositeHdrWet'>,check:()=>void,wet:(stroke:WetPaintStrokeData,area:FloatSourceWindow)=>Promise<Float64Array>,clone?:FloatCloneRead):Promise<Float32Array>{
 check();if(!strokes.some(isActiveWetPaint))return replayFloatPaint(strokes,area,world,coverage,processor,check,undefined,clone);
 const bounds=unionBounds(strokes.filter(stroke=>stroke.kind!=='wet'||isActiveWetPaint(stroke)).map(strokeBounds));
 if(!bounds)return new Float32Array(validateWindow(area).width*area.height*4);
 const left=Math.floor(bounds.x)-2,top=Math.floor(bounds.y)-2,right=Math.ceil(bounds.x+bounds.width)+2,bottom=Math.ceil(bounds.y+bounds.height)+2,width=right-left,height=bottom-top;
 if(![left,top,right,bottom,width,height].every(Number.isSafeInteger)||width<=0||height<=0)throw new Error('Float wet paint content bounds exceed numeric precision.');
 return projectFloatWindow({width,height,readWindow:region=>replayFloatPaint(strokes,{...region,x:region.x+left,y:region.y+top},new AffineTransform(),coverage,processor,check,wet,clone)},world.multiply(AffineTransform.translation(left,top)),area,{isCancelled:()=>{check();return false;}});
}
