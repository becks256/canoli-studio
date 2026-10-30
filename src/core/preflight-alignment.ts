import {z} from 'zod';
import {activePerspective} from './perspective';
import {layerAlignmentSchema,type LayerAlignment} from './layer-alignment-schema';
import {AffineTransform} from './affine';
import {localBounds,localTransform,placedGeometryBounds,unionBounds,type Bounds} from './spatial';
import type {PreflightDocumentView,PreflightLayerView} from './preflight-view';
import {yieldTask} from './task-yield';

const identifier=z.string().min(1).max(240);
export const preflightAlignmentTargetSchema=z.discriminatedUnion('type',[
  z.object({type:z.literal('canvas')}).strict(),
  z.object({type:z.literal('layer'),id:identifier}).strict(),
]);
export const preflightAlignmentRuleSchema=z.object({
  name:z.string().trim().min(1).max(80).optional(),
  layerIds:z.array(identifier).min(1).max(64).refine(ids=>new Set(ids).size===ids.length,'Alignment targets must be distinct.'),
  alignment:layerAlignmentSchema,
  target:preflightAlignmentTargetSchema,
  tolerance:z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER).default(.5),
}).strict();
export const preflightAlignmentRulesSchema=z.array(preflightAlignmentRuleSchema).max(32);
export type PreflightAlignmentRule=z.output<typeof preflightAlignmentRuleSchema>;
export type PreflightAlignmentInput=z.input<typeof preflightAlignmentRuleSchema>;
export const preflightBoundsSchema=z.object({x:z.number().finite(),y:z.number().finite(),width:z.number().finite().nonnegative(),height:z.number().finite().nonnegative()}).strict();
/** Root-only references. Embedded component IDs belong to separate scopes. */
export function preflightAlignmentGeometryIds(rules:readonly PreflightAlignmentRule[]=[]):ReadonlySet<string>{return new Set(rules.flatMap(rule=>[...rule.layerIds,...(rule.target.type==='layer'?[rule.target.id]:[])]));}
export const preflightAlignmentEvidenceSchema=z.object({
  ruleIndex:z.number().int().min(0).max(31),alignment:layerAlignmentSchema,target:preflightAlignmentTargetSchema,
  tolerance:z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER),
  actual:z.number().finite().optional(),expected:z.number().finite().optional(),delta:z.number().finite().optional(),
  numericalTolerance:z.number().finite().min(1e-7).optional(),referenceBounds:preflightBoundsSchema.optional(),
  reason:z.enum(['hidden','geometry','precision']).optional(),
}).strict();
export const preflightAlignmentSummarySchema=z.object({
  rules:z.number().int().min(0).max(32),requested:z.number().int().min(0).max(2048),
  matched:z.number().int().min(0).max(2048),mismatched:z.number().int().min(0).max(2048),
  unavailable:z.number().int().min(0).max(2048),excluded:z.number().int().min(0).max(2048),
}).strict();
export type PreflightAlignmentSummary=z.infer<typeof preflightAlignmentSummarySchema>;
export type PreflightAlignmentEvidence=z.infer<typeof preflightAlignmentEvidenceSchema>;
export interface AlignmentFinding {
  code:'alignment-mismatch'|'alignment-unchecked';severity:'warning'|'info';layerId:string;layerName:string;path:string[];
  message:string;bounds?:Bounds;alignment:PreflightAlignmentEvidence;
}
interface Placement {node:PreflightLayerView;path:string[];names:string[];visible:boolean;world?:AffineTransform;local?:Bounds;bounds?:Bounds;invalid:boolean}
const edgeNames:Record<LayerAlignment,string>={left:'Left edge',center:'Horizontal center',right:'Right edge',top:'Top edge',middle:'Vertical center',bottom:'Bottom edge'};
const ancestor=(a:Placement,b:Placement)=>b.path.length>a.path.length&&b.path[a.path.length-1]===a.node.id;
export const preflightAlignmentAnchor=(bounds:Bounds,alignment:LayerAlignment)=>alignment==='left'?bounds.x:alignment==='right'?bounds.x+bounds.width:alignment==='center'?bounds.x+bounds.width/2:alignment==='top'?bounds.y:alignment==='bottom'?bounds.y+bounds.height:bounds.y+bounds.height/2;

export const preflightAlignmentRoundoff=(a:Bounds,b:Bounds)=>Math.max(1e-7,Number.EPSILON*Math.max(1,...[a,b].flatMap(rect=>[Math.abs(rect.x),Math.abs(rect.y),Math.abs(rect.width),Math.abs(rect.height)]))*8);

/** Root-document authored frames only. Explicit policies do not infer design intent.
 * Cache local geometry once, sharing the editor's bounds and group arithmetic. */
export async function inspectPreflightAlignments(document:PreflightDocumentView,rules:readonly PreflightAlignmentRule[],includeHidden:boolean,add:(finding:AlignmentFinding)=>void,signal?:AbortSignal):Promise<PreflightAlignmentSummary>{
  const index=new Map<string,Placement>(),locals=new Map<PreflightLayerView,Placement>(),computed=new Set<PreflightLayerView>();let visited=0,deadline=performance.now()+8;
  const current=()=>signal?.throwIfAborted();
  const checkpoint=async()=>{current();if(performance.now()>=deadline){await yieldTask();current();deadline=performance.now()+8;}};
  const walk=async(nodes:readonly PreflightLayerView[],parent:AffineTransform|undefined,path:string[],names:string[],shown:boolean):Promise<void>=>{
    for(const node of nodes){
      current();if(++visited>4096||path.length>=64)throw new Error('Alignment checks exceed their 4096-node/64-level inspection budget.');
      if(index.has(node.id))throw new Error('Alignment checks require distinct root-document layer IDs.');
      const entry:Placement={node,path:[...path,node.id],names:[...names,node.name],visible:shown&&node.visible&&node.opacity>0,invalid:false};index.set(node.id,entry);locals.set(node,entry);
      let world:AffineTransform|undefined;try{world=parent?.multiply(localTransform(node));}catch{entry.invalid=true;}
      entry.world=world;if(!world)entry.invalid=true;
      if(node.kind==='group')await walk(node.children,world,entry.path,entry.names,entry.visible);
      await checkpoint();
    }
  };
  const measure=async(entry:Placement):Promise<Bounds|undefined>=>{
    if(computed.has(entry.node))return entry.bounds;
    current();computed.add(entry.node);
    try{
      const node=entry.node;
      if(node.kind==='group'){
        for(const child of node.children)await measure(locals.get(child)!);
        if(node.children.some(child=>locals.get(child)!.invalid))entry.invalid=true;
        if(!entry.invalid)entry.local=unionBounds(node.children.flatMap(child=>{const local=locals.get(child)?.local;if(!local)return[];return[(child.kind==='raster'||child.kind==='smart-object')&&activePerspective(child.perspective)?placedGeometryBounds(child,localTransform(child))!:localTransform(child).bounds(local)];}));
      }else if(!entry.invalid)entry.local=localBounds(node);
      if(entry.local)preflightBoundsSchema.parse(entry.local);
      if(entry.world&&entry.local)entry.bounds=preflightBoundsSchema.parse((node.kind==='raster'||node.kind==='smart-object')&&activePerspective(node.perspective)?placedGeometryBounds(node,entry.world):entry.world.bounds(entry.local));
    }catch{entry.invalid=true;entry.local=undefined;entry.bounds=undefined;}
    await checkpoint();return entry.bounds;
  };
  if(rules.length)await walk(document.children,new AffineTransform(),[],[],true);
  // Validate the entire declared policy before returning even a partial report.
  for(const rule of rules){
    const items=rule.layerIds.map(id=>{const item=index.get(id);if(!item)throw new Error('An alignment target no longer exists in this document.');return item;});
    if(items.some((a,i)=>items.slice(i+1).some(b=>ancestor(a,b)||ancestor(b,a))))throw new Error('Alignment targets must be independent; choose a group or its descendants.');
    if(rule.target.type==='layer'){
      const key=index.get(rule.target.id);if(!key)throw new Error('The alignment reference no longer exists in this document.');
      if(items.some(item=>item===key||ancestor(item,key)||ancestor(key,item)))throw new Error('The alignment reference must be independent of every checked layer.');
    }
    await checkpoint();
  }
  const summary:PreflightAlignmentSummary={rules:rules.length,requested:0,matched:0,mismatched:0,unavailable:0,excluded:0};
  for(const[ruleIndex,rule]of rules.entries()){
    current();const key=rule.target.type==='layer'?index.get(rule.target.id)!:undefined,reference=key?await measure(key):{x:0,y:0,width:document.width,height:document.height},label=rule.name??`Alignment rule ${ruleIndex+1}`;
    for(const id of rule.layerIds){
      current();summary.requested++;const item=index.get(id)!,base={layerId:id,layerName:item.names.join(' / '),path:item.path},evidence:PreflightAlignmentEvidence={ruleIndex,alignment:rule.alignment,target:rule.target,tolerance:rule.tolerance};
      const unchecked=(reason:NonNullable<PreflightAlignmentEvidence['reason']>,message:string)=>{if(reason==='hidden')summary.excluded++;else summary.unavailable++;add({...base,code:'alignment-unchecked',severity:'info',message:`${label}: ${message}`,bounds:item.bounds,alignment:{...evidence,reason}});};
      if(!includeHidden&&!item.visible){unchecked('hidden','The layer is hidden or in a zero-opacity subtree; enable Include hidden to measure it.');await checkpoint();continue;}
      await measure(item);
      if(!item.bounds||!reference){unchecked('geometry','A checked layer or its reference has no measurable authored frame.');await checkpoint();continue;}
      const actual=preflightAlignmentAnchor(item.bounds,rule.alignment),expected=preflightAlignmentAnchor(reference,rule.alignment),delta=expected-actual,numericalTolerance=preflightAlignmentRoundoff(item.bounds,reference);
      if(![actual,expected,delta,numericalTolerance].every(Number.isFinite)){unchecked('geometry','The authored placement exceeds numerical measurement precision.');await checkpoint();continue;}
      const difference=Math.abs(delta),limit=rule.tolerance+numericalTolerance;
      if(numericalTolerance>Math.max(1e-7,rule.tolerance)&&difference<=limit){unchecked('precision','Floating-point geometry cannot resolve the requested pixel tolerance.');await checkpoint();continue;}
      if(difference>limit){summary.mismatched++;add({...base,code:'alignment-mismatch',severity:'warning',bounds:item.bounds,alignment:{...evidence,actual,expected,delta,numericalTolerance,referenceBounds:reference},message:`${label}: ${edgeNames[rule.alignment]} differs by ${Number(difference.toPrecision(6))} document pixels from ${key?key.names.join(' / '):'the canvas'}; tolerance is ${rule.tolerance} pixels.`});}
      else summary.matched++;
      await checkpoint();
    }
  }
  current();return summary;
}
