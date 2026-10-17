import type {RefineEdgeControl,RefineEdgeSettings} from '../core/matting';
import type {ClosedFormDiagnostics} from '../intelligence/matting/closed-form';
import type {MattingTileRequest,MattingTileResult} from './matting-tile';
import {encodeMattingOutput,mattingLayout,mattingRegions,type MattingRegion} from './matting-output';
import {yieldTask} from '../core/task-yield';

export interface MattingBackend {
  begin(width:number,height:number):Promise<void>;
  accumulate(pixels:Uint8ClampedArray,request:MattingTileRequest):Promise<void>;
  solve(progress?:(iteration:number,residual:number)=>void):Promise<ClosedFormDiagnostics>;
  tile(pixels:Uint8ClampedArray,request:MattingTileRequest):Promise<MattingTileResult>;
}
export const needsClosedForm=(options:RefineEdgeSettings)=>options.solver==='closed-form'&&!!(options.radius||options.trimap||options.trimapAssetId||options.trimapStrokes.some(stroke=>stroke.mode==='refine'));
/** Native global preparation precedes streamed postprocessing; display proxies use the same algorithm separately. */
export async function runMattingJob(width:number,height:number,settings:RefineEdgeSettings,capture:(region:MattingRegion)=>Promise<{pixels:Uint8ClampedArray;request:MattingTileRequest}>,backend:MattingBackend,control:RefineEdgeControl={},check:()=>void=()=>{}){
  const global=needsClosedForm(settings),{total:tiles}=mattingLayout(width,height),total=global?tiles*2+1:tiles;
  const current=()=>{control.signal?.throwIfAborted();check();};let completed=0,diagnostics:ClosedFormDiagnostics|undefined;
  if(global){
    current();control.onProgress?.({completed,total,phase:'capture'});await backend.begin(width,height);
    for(const region of mattingRegions(width,height,settings)){
      current();const tile=await capture(region);current();await backend.accumulate(tile.pixels,tile.request);current();control.onProgress?.({completed:++completed,total,phase:'capture'});await yieldTask();
    }
    diagnostics=await backend.solve((iteration,relativeResidual)=>{current();control.onProgress?.({completed,total,phase:'solve',iteration,relativeResidual});});current();completed++;
    if(!Number.isSafeInteger(diagnostics.unknownPixels)||diagnostics.unknownPixels<0||diagnostics.unknownPixels>width*height||
      !Number.isSafeInteger(diagnostics.unresolvedPixels)||diagnostics.unresolvedPixels<0||diagnostics.unresolvedPixels>diagnostics.unknownPixels||
      !Number.isSafeInteger(diagnostics.estimatedGraphBytes)||diagnostics.estimatedGraphBytes<0||diagnostics.estimatedGraphBytes>192*1024*1024||
      !['javascript','wasm'].includes(diagnostics.iterationBackend)||!Number.isSafeInteger(diagnostics.iterationBytes)||diagnostics.iterationBytes<0||diagnostics.iterationBytes>diagnostics.estimatedGraphBytes||(diagnostics.iterationBackend==='wasm'&&diagnostics.iterationBytes===0)||
      !['ic0','jacobi','none'].includes(diagnostics.preconditioner)||!Number.isFinite(diagnostics.preconditionerShift)||diagnostics.preconditionerShift<0||diagnostics.preconditionerShift>100||
      !Number.isSafeInteger(diagnostics.coarseBlocks)||diagnostics.coarseBlocks<0||diagnostics.coarseBlocks>diagnostics.unknownPixels||
      !Number.isSafeInteger(diagnostics.coarseBandwidth)||diagnostics.coarseBandwidth<0||(diagnostics.coarseBlocks?diagnostics.coarseBandwidth>=diagnostics.coarseBlocks*4:diagnostics.coarseBandwidth!==0)||
      !Number.isSafeInteger(diagnostics.coarseBytes)||diagnostics.coarseBytes<0||diagnostics.coarseBytes>diagnostics.estimatedGraphBytes||
      !Number.isFinite(diagnostics.coarseRidge)||diagnostics.coarseRidge<0||(diagnostics.coarseBlocks?diagnostics.coarseRidge===0||diagnostics.coarseBytes===0||diagnostics.relativeResidual>1e-9:diagnostics.coarseRidge!==0)||
      !Number.isSafeInteger(diagnostics.iterations)||diagnostics.iterations<0||diagnostics.iterations>2000||!Number.isFinite(diagnostics.relativeResidual)||diagnostics.relativeResidual<0||diagnostics.relativeResidual>1e-7)throw new Error('Invalid closed-form solver result.');
  }
  const offset=completed;
  const result=await encodeMattingOutput(width,height,settings,async region=>{current();const tile=await capture(region);current();return backend.tile(tile.pixels,tile.request);},{signal:control.signal,onProgress:progress=>control.onProgress?.({completed:offset+progress.completed,total,phase:'encode'})},current);
  return{...result,diagnostics};
}
