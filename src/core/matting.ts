import {z} from 'zod';
import {layerMaskSchema} from './masks';
import type {RasterLayerData} from './model';
import type {LayerMaskData} from './masks';
import type {SelectionModificationProgress} from './selection-modification';

const coordinate=z.number().finite().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
export const trimapStrokeSchema=z.object({
  mode:z.enum(['foreground','background','refine']),size:z.number().finite().min(.5).max(512),
  points:z.array(z.object({x:coordinate,y:coordinate}).strict()).min(1).max(20000),
}).strict();
export type TrimapStroke=z.infer<typeof trimapStrokeSchema>;
export const refineEdgeOptionsSchema=z.object({
  solver:z.enum(['closed-form','color-line']).default('closed-form'),
  radius:z.number().finite().min(0).max(50).default(10),
  smooth:z.number().finite().min(0).max(100).optional(),smoothness:z.number().finite().min(0).max(100).optional(),
  feather:z.number().finite().min(0).max(50).optional(),edgeFeather:z.number().finite().min(0).max(50).optional(),
  contrast:z.number().finite().min(-100).max(100).default(0),shiftEdge:z.number().finite().min(-100).max(100).default(0),
  decontaminate:z.boolean().default(false),decontaminateAmount:z.number().finite().min(0).max(1).default(1),
  outputTo:z.enum(['mask','new-layer']).optional(),trimap:z.instanceof(Uint8Array).optional(),trimapAssetId:z.string().min(1).max(240).optional(),
  trimapStrokes:z.array(trimapStrokeSchema).max(256).default([]),
  viewMode:z.enum(['marching-ants','overlay','on-black','on-white','on-transparency']).optional(),
  previewMode:z.enum(['marching-ants','overlay','on-black','on-white','on-transparency']).optional(),
}).strict().superRefine((value,context)=>{
  if(value.smooth!==undefined&&value.smoothness!==undefined&&value.smooth!==value.smoothness)context.addIssue({code:'custom',message:'smooth and smoothness must agree.'});
  if(value.feather!==undefined&&value.edgeFeather!==undefined&&value.feather!==value.edgeFeather)context.addIssue({code:'custom',message:'feather and edgeFeather must agree.'});
  if(value.trimap&&value.trimapAssetId)context.addIssue({code:'custom',message:'Choose a trimap buffer or asset, not both.'});
  if(value.decontaminate&&value.outputTo==='mask')context.addIssue({code:'custom',message:'Color decontamination requires new-layer output to preserve the original.'});
  if(value.trimapStrokes.reduce((n,stroke)=>n+stroke.points.length,0)>20000)context.addIssue({code:'custom',message:'Trimap strokes support at most 20,000 points.'});
}).transform(value=>({...value,smoothness:value.smoothness??value.smooth??10,edgeFeather:value.edgeFeather??value.feather??0,
  outputTo:value.outputTo??(value.decontaminate?'new-layer':'mask'),trimap:value.trimap?.slice()}));
export type RefineEdgeOptions=z.input<typeof refineEdgeOptionsSchema>;
export type RefineEdgeSettings=z.output<typeof refineEdgeOptionsSchema>;
export interface RefineEdgeProgress extends SelectionModificationProgress {phase?:'capture'|'solve'|'encode';iteration?:number;relativeResidual?:number}
export interface RefineEdgeControl {signal?:AbortSignal;onProgress?(progress:RefineEdgeProgress):void}
export const mattingRequestSchema=z.object({layerId:z.string().min(1).max(240),options:refineEdgeOptionsSchema}).strict();
export type MattingRequest={layerId:string;options:RefineEdgeSettings};
export interface MattingPlan {sourceId:string;mask:LayerMaskData;layer?:RasterLayerData;unresolvedPixels:number}
/** Host-only lease. Isolated runtimes receive just the serializable plan. */
export interface PreparedMatting {plan:MattingPlan;commit?(apply:()=>void):void;dispose?():void}
export const mattingPlanSchema=z.object({sourceId:z.string().min(1).max(240),mask:layerMaskSchema,layer:z.unknown().optional(),unresolvedPixels:z.number().int().nonnegative()}).strict();

/** Conservative finite support: shift/trimap, color estimation, smoothing, feather, decontamination. */
export function mattingHalo(options:RefineEdgeSettings):number{
  return Math.ceil(options.radius*Math.abs(options.shiftEdge)/100)+Math.ceil(options.radius)+Math.max(3,Math.min(25,Math.round(options.radius)))+
    Math.max(1,Math.min(5,Math.round(options.smoothness/20)))+3*Math.ceil(options.edgeFeather/3)+(options.decontaminate?8:0)+2;
}
