import type {AssetStore} from '../core/assets';
import type {DocumentData} from '../core/model';
import {selectionRegionTransform,selectionSchema,translateSelection,strokeBounds,type SelectionData,type Point,type BrushStrokeData} from '../core/drawing';
import {maskStrokeSchema} from '../core/masks';
import type {PatchOptions,PoissonBlendOptions,RetouchSamplingOptions} from '../core/retouch/types';
import {captureFloatPoissonOptions,validateFloatRetouchPixels} from '../core/retouch/float-types';
import type {DocumentRenderer,RenderRegion} from './renderer';
import type {CapturedFloatScene} from './float-scene';
import type {PixelProcessor} from './processor';
import {retouchSampleDocument} from './retouch-sampling';
import {renderRetouchCoverage} from './retouch';
import {yieldTask} from '../core/task-yield';

export interface PreparedFloatPatch {
 precision:'float32';bounds:RenderRegion;pixels:Float32Array;correctedPixels:Float32Array;
 coverage:Float32Array;iterations:number;residual:number;
}

/** Native document samples before SDR/proof, cropped to the artboard. A repair
 * may assemble several fixed native tiles without allocating a color Canvas. */
async function sample(scene:CapturedFloatScene,document:DocumentData,area:RenderRegion,check:()=>void):Promise<Float32Array>{
 check();if(![area.x,area.y,area.width,area.height,area.x+area.width,area.y+area.height,area.width*area.height*4].every(Number.isSafeInteger)||area.width<1||area.height<1)throw new Error('Native retouch sampling requires safe integer geometry.');const output=new Float32Array(area.width*area.height*4),left=Math.max(0,area.x),top=Math.max(0,area.y),right=Math.min(document.width,area.x+area.width),bottom=Math.min(document.height,area.y+area.height);let deadline=performance.now()+4;
 for(let y=top;y<bottom;y+=512)for(let x=left;x<right;x+=512){
  check();const width=Math.min(512,right-x),height=Math.min(512,bottom-y),pixels=await scene.read({x,y,width,height});check();validateFloatRetouchPixels(pixels,width,height);if(pixels.byteOffset||pixels.byteLength!==pixels.buffer.byteLength)throw new Error('Native retouch sampling returned an incomplete window.');
  for(let row=0;row<height;row++)output.set(pixels.subarray(row*width*4,(row+1)*width*4),((y-area.y+row)*area.width+x-area.x)*4);
  if(performance.now()>=deadline){await yieldTask();check();deadline=performance.now()+4;}
 }
 check();return output;
}

async function solve(scene:CapturedFloatScene,document:DocumentData,processor:PixelProcessor,bounds:RenderRegion,inputCoverage:Float32Array,offset:Point,options:PoissonBlendOptions,check:()=>void,captured?:{region:RenderRegion;pixels:Float32Array}):Promise<PreparedFloatPatch>{
 const read=async(area:RenderRegion)=>{
  check();const window=captured?.region;
  if(window&&area.x>=window.x&&area.y>=window.y&&area.x+area.width<=window.x+window.width&&area.y+area.height<=window.y+window.height){
   const pixels=new Float32Array(area.width*area.height*4);
   for(let row=0;row<area.height;row++){const start=((area.y-window.y+row)*window.width+area.x-window.x)*4;pixels.set(captured!.pixels.subarray(start,start+area.width*4),row*area.width*4);}
   check();return pixels;
  }
  return sample(scene,document,area,check);
 };
 check();const coverage=inputCoverage.slice(),target=await read(bounds),donor=await read({...bounds,x:bounds.x+offset.x,y:bounds.y+offset.y});check();let active=false;
 for(let p=0;p<coverage.length;p++){if(target[p*4+3]===0)coverage[p]=0;else if(coverage[p])active=true;}
 if(!active)throw new Error('Native repair has no visible selected target pixels.');
 const solved=await processor.floatPoissonBlend(target,donor,bounds.width,bounds.height,Uint8Array.from(coverage,value=>value?255:0),options);check();if(!solved.converged)throw new Error(`Native patch solver did not converge (linear residual ${solved.residual}). No patch was committed.`);
 const pixels=solved.pixels.slice();for(let p=0;p<coverage.length;p++)for(let c=0;c<3;c++){const at=p*4+c;if(coverage[p]!==1&&!Object.is(target[at],pixels[at]))pixels[at]=target[at]+coverage[p]*(pixels[at]-target[at]);}
 validateFloatRetouchPixels(pixels,bounds.width,bounds.height);check();return{precision:'float32',bounds:{...bounds},pixels,correctedPixels:solved.pixels,coverage,iterations:solved.iterations,residual:solved.residual};
}

async function capture(document:DocumentData,assets:AssetStore,renderer:DocumentRenderer,signal?:AbortSignal,current?:()=>void){
 signal?.throwIfAborted();current?.();if(!renderer.captureFloatScene)throw new Error('Native retouch requires the original float scene service.');return renderer.captureFloatScene(document,assets,{signal,isCancelled:()=>{current?.();return false;}});
}

export async function prepareFloatRetouchPatch(input:DocumentData,assets:AssetStore,renderer:DocumentRenderer,processor:PixelProcessor,selection:SelectionData,sourceOffset:Point,sampling:RetouchSamplingOptions,options:PatchOptions={},signal?:AbortSignal,current?:()=>void):Promise<PreparedFloatPatch>{
 const document=retouchSampleDocument(input,sampling),offset={...sourceOffset},{direction='source',...solverInput}=options,solver=captureFloatPoissonOptions(solverInput);let captured=selectionSchema.parse(selection);
 if(direction!=='source'&&direction!=='destination')throw new Error('Unknown patch direction.');if(![offset.x,offset.y].every(Number.isSafeInteger))throw new Error('Patch source offset must use safe integer pixels.');
 if(direction==='destination'){captured=selectionSchema.parse(translateSelection(captured,offset.x,offset.y));offset.x=-offset.x;offset.y=-offset.y;}
 const additions=captured.regions.filter(r=>r.operation==='add').map(r=>selectionRegionTransform(r).bounds(r));if(!additions.length)throw new Error('Patch selection is empty.');
 const left=Math.max(0,Math.floor(Math.min(...additions.map(r=>r.x)))),top=Math.max(0,Math.floor(Math.min(...additions.map(r=>r.y)))),right=Math.min(document.width,Math.ceil(Math.max(...additions.map(r=>r.x+r.width)))),bottom=Math.min(document.height,Math.ceil(Math.max(...additions.map(r=>r.y+r.height))));if(right<=left||bottom<=top)throw new Error('Patch selection does not intersect the canvas.');
 const bounds={x:left-1,y:top-1,width:right-left+2,height:bottom-top+2},scene=await capture(document,assets,renderer,signal,current),check=()=>{signal?.throwIfAborted();current?.();scene.check();};
 try{
  check();const mask=await processor.selection({selection:captured,...bounds,stepX:1,stepY:1});check();if(!(mask instanceof Uint8ClampedArray)||mask.length!==bounds.width*bounds.height*4)throw new Error('Patch selection returned incorrect native coverage geometry.');
  const coverage=new Float32Array(bounds.width*bounds.height);let selected=0;
  for(let row=1;row<bounds.height-1;row++)for(let col=1;col<bounds.width-1;col++){const p=row*bounds.width+col;coverage[p]=mask[p*4+3]/255;if(!coverage[p])continue;const x=bounds.x+col+offset.x,y=bounds.y+row+offset.y;if(![x,y].every(Number.isSafeInteger)||x<0||y<0||x>=document.width||y>=document.height)throw new Error('Patch donor pixels fall outside the canvas.');selected++;}
  if(!selected)throw new Error('Patch selection is empty.');return await solve(scene,document,processor,bounds,coverage,offset,solver,check);
 }finally{scene.dispose();}
}

export async function prepareFloatHealingStroke(input:DocumentData,assets:AssetStore,renderer:DocumentRenderer,processor:PixelProcessor,brush:BrushStrokeData,sampling:RetouchSamplingOptions,options:PoissonBlendOptions={},radius=64,signal?:AbortSignal,current?:()=>void):Promise<PreparedFloatPatch>{
 if(!Number.isSafeInteger(radius)||radius<1)throw new Error('Healing search radius must be a positive safe integer.');const document=retouchSampleDocument(input,sampling),captured=maskStrokeSchema.parse({mode:'reveal',stroke:brush}).stroke,solver=captureFloatPoissonOptions(options),area=strokeBounds(captured),left=Math.max(0,Math.floor(area.x)),top=Math.max(0,Math.floor(area.y)),right=Math.min(document.width,Math.ceil(area.x+area.width)),bottom=Math.min(document.height,Math.ceil(area.y+area.height));if(right<=left||bottom<=top)throw new Error('Healing stroke does not intersect the canvas.');
 const bounds={x:left-1,y:top-1,width:right-left+2,height:bottom-top+2},x=Math.max(0,left-radius-1),y=Math.max(0,top-radius-1),window={x,y,width:Math.min(document.width,right+radius+1)-x,height:Math.min(document.height,bottom+radius+1)-y},scene=await capture(document,assets,renderer,signal,current),check=()=>{signal?.throwIfAborted();current?.();scene.check();};
 try{
  check();const geometry=await renderRetouchCoverage({...captured,opacity:1},{...window,sx:1,sy:1},processor,undefined,assets,undefined,()=>{check();return false;}),coverage=Float32Array.from(geometry,value=>value/255*captured.opacity);check();
  const pixels=await sample(scene,document,window,check);check();const donor=await processor.findFloatDonor(pixels,window.width,window.height,Uint8Array.from(coverage,value=>value?255:0),{radius});check();
  const patchCoverage=new Float32Array(bounds.width*bounds.height);for(let row=1;row<bounds.height-1;row++)for(let col=1;col<bounds.width-1;col++)patchCoverage[row*bounds.width+col]=coverage[(bounds.y+row-y)*window.width+bounds.x+col-x];
  return await solve(scene,document,processor,bounds,patchCoverage,donor,solver,check,{region:window,pixels});
 }finally{scene.dispose();}
}
