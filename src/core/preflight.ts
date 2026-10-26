import {z} from 'zod';
import {characterFontFamilies} from './character-layout';
import type {PreflightDocumentView,PreflightLayerView,PreflightComponentView} from './preflight-view';
import {AffineTransform} from './affine';
import {unionBounds} from './spatial';
import {strokeBounds,pathBounds} from './drawing';
import {yieldTask} from './task-yield';

export const preflightOptionsSchema=z.object({
  outputDpi:z.number().finite().positive().default(72),
  minimumPpi:z.number().finite().positive().default(72),
  checkBounds:z.boolean().default(true),
  checkFonts:z.boolean().default(true),
  includeHidden:z.boolean().default(false),
}).strict();
export type PreflightOptions=z.input<typeof preflightOptionsSchema>;
export type PreflightSettings=z.output<typeof preflightOptionsSchema>;
export interface PreflightControl {signal?:AbortSignal}
export const fontStatusSchema=z.enum(['available','unavailable','unknown']);
export type PreflightFontStatus=z.infer<typeof fontStatusSchema>;
export const preflightAssetMetadataSchema=z.array(z.object({id:z.string().min(1),name:z.string().optional(),width:z.number().int().positive().safe(),height:z.number().int().positive().safe()}).strict());
const codes=['bounds-outside','low-resolution','asset-missing','asset-unchecked','font-unavailable','font-unchecked','measurement-unavailable'] as const;
const findingSchema=z.object({
  code:z.enum(codes),severity:z.enum(['error','warning','info']),
  layerId:z.string().min(1),layerName:z.string(),path:z.array(z.string()).min(1).max(64),
  message:z.string(),assetId:z.string().optional(),family:z.string().optional(),
  bounds:z.object({x:z.number().finite(),y:z.number().finite(),width:z.number().finite().nonnegative(),height:z.number().finite().nonnegative()}).strict().optional(),
  effectivePpi:z.number().finite().nonnegative().optional(),
}).strict();
export const preflightReportSchema=z.object({
  version:z.literal(1),documentId:z.string().min(1),revision:z.number().int().nonnegative(),
  options:preflightOptionsSchema,findings:z.array(findingSchema).max(512),
  totalFindings:z.number().int().nonnegative(),truncated:z.boolean(),layersChecked:z.number().int().nonnegative().max(4096),
  counts:z.object({error:z.number().int().nonnegative(),warning:z.number().int().nonnegative(),info:z.number().int().nonnegative()}).strict(),
  fonts:z.array(z.object({family:z.string(),status:fontStatusSchema}).strict()).max(4096),
  limitations:z.array(z.string()),
}).strict().superRefine((report,context)=>{
  if(report.counts.error+report.counts.warning+report.counts.info!==report.totalFindings||report.findings.length!==Math.min(512,report.totalFindings)||report.truncated!==(report.totalFindings>512))context.addIssue({code:'custom',message:'Inconsistent design-check counts.'});
});
export type PreflightReport=z.infer<typeof preflightReportSchema>;
export type PreflightFinding=z.infer<typeof findingSchema>;
export interface PreflightEnvironment {
  assets?:ReadonlyMap<string,{width:number;height:number}>;
  fonts?:ReadonlyMap<string,PreflightFontStatus>;
  signal?:AbortSignal;
}

/** Largest singular value, so shear/rotation cannot hide the worst sampling direction. */
export function maximumStretch(transform:AffineTransform):number {
  const scale=Math.max(Math.abs(transform.a),Math.abs(transform.b),Math.abs(transform.c),Math.abs(transform.d));
  if(!scale)return 0;
  const a=transform.a/scale,b=transform.b/scale,c=transform.c/scale,d=transform.d/scale;
  const x=a*a+b*b,y=c*c+d*d,cross=a*c+b*d;
  return scale*Math.sqrt((x+y+Math.hypot(x-y,2*cross))/2);
}

/** Read-only metadata/geometry inspection. No pixels, font files, mutations or inference. */
export async function inspectDesign(document:PreflightDocumentView,revision:number,options:PreflightOptions={},environment:PreflightEnvironment={}):Promise<PreflightReport>{
  const settings=preflightOptionsSchema.parse(options),findings:PreflightFinding[]=[],counts={error:0,warning:0,info:0},fonts=new Map<string,{family:string;status:PreflightFontStatus}>();
  let layersChecked=0,totalFindings=0,lastYield=performance.now();
  const alive=()=>environment.signal?.throwIfAborted();
  const add=(finding:PreflightFinding)=>{totalFindings++;counts[finding.severity]++;if(findings.length<512)findings.push(finding);};
  const raster=(assetId:string,width:number,height:number,world:AffineTransform,target:Pick<PreflightFinding,'layerId'|'layerName'|'path'>)=>{
    const source=environment.assets?.get(assetId);
    if(!source){add({...target,assetId,code:environment.assets?'asset-missing':'asset-unchecked',severity:environment.assets?'error':'info',message:environment.assets?'The referenced source asset is unavailable.':'No source metadata is connected; raster resolution was not checked.'});return;}
    if(![source.width,source.height].every(value=>Number.isSafeInteger(value)&&value>0))throw new Error('Invalid design-check source dimensions.');
    let stretch:number,effectivePpi:number;
    try{stretch=maximumStretch(world.multiply(AffineTransform.scale(width/source.width,height/source.height)));effectivePpi=settings.outputDpi/stretch;}
    catch{add({...target,assetId,code:'measurement-unavailable',severity:'info',message:'Raster placement exceeds numerical measurement precision.'});return;}
    if(!Number.isFinite(stretch)||stretch<=0||!Number.isFinite(effectivePpi)){add({...target,assetId,code:'measurement-unavailable',severity:'info',message:'Raster sampling exceeds numerical measurement precision.'});return;}
    if(effectivePpi<settings.minimumPpi*(1-1e-12))add({...target,assetId,code:'low-resolution',severity:'warning',effectivePpi,message:`Worst-direction sampling is ${effectivePpi.toPrecision(4)} PPI; the inspection policy requires ${settings.minimumPpi} PPI at ${settings.outputDpi} output DPI.`});
  };
  const walk=async(nodes:readonly PreflightLayerView[],parent:AffineTransform,definitions:ReadonlyMap<string,PreflightComponentView>,path:string[],rootId?:string,inMaster=false,names:string[]=[]):Promise<void>=>{
    for(const node of nodes){
      alive();if(!settings.includeHidden&&(!node.visible||node.opacity===0))continue;
      if(++layersChecked>4096||path.length>=64)throw new Error('Design checks exceed their 4096-node/64-level inspection budget; no document changes were made.');
      const next=[...path,node.id],nextNames=[...names,node.name],target={layerId:rootId??node.id,layerName:nextNames.join(' / '),path:next};
      let world:AffineTransform;
      try{world=parent.multiply(AffineTransform.translation(node.x,node.y).multiply(node.transform?AffineTransform.fromJSON(node.transform):new AffineTransform()));}
      catch{add({...target,code:'measurement-unavailable',severity:'info',message:'Layer placement exceeds numerical measurement precision.'});continue;}
      if(settings.checkBounds&&!inMaster&&node.kind!=='group'){
        try{
          const local=node.kind==='paint'?unionBounds(node.strokes.map(strokeBounds)):node.kind==='vector'?unionBounds(node.paths.map(pathBounds)):node.kind==='adjustment'?undefined:{x:node.kind==='text'?(node.textPathOrigin??node.textFrameOrigin)?.x??0:0,y:node.kind==='text'?(node.textPathOrigin??node.textFrameOrigin)?.y??0:0,width:node.width,height:node.height},bounds=local?world.bounds(local):undefined;
          if(bounds&&(bounds.x<-1e-7||bounds.y<-1e-7||bounds.x+bounds.width>document.width+1e-7||bounds.y+bounds.height>document.height+1e-7))add({...target,code:'bounds-outside',severity:'warning',bounds,message:'Authored bounds extend beyond the canvas. Review intentional bleed and clipping; masks, effects and occlusion are not evaluated.'});
        }catch{add({...target,code:'measurement-unavailable',severity:'info',message:'Authored bounds exceed numerical measurement precision.'});}
      }
      if(node.kind==='group')await walk(node.children,world,definitions,next,rootId,inMaster,nextNames);
      else if(node.kind==='text'&&node.text.trim()&&settings.checkFonts){
        for(const family of node.fontFamilies??characterFontFamilies(node)){
          const key=family.trim().toLowerCase(),status=environment.fonts?.get(key)??'unknown';fonts.set(key,{family,status});
          if(status!=='available')add({...target,family,code:status==='unavailable'?'font-unavailable':'font-unchecked',severity:status==='unavailable'?'warning':'info',message:status==='unavailable'?'The browser could not resolve this font family; fallback may be used.':'Font availability is unverified in this inspection environment.'});
        }
      }else if(node.kind==='raster')raster(node.assetId,node.width,node.height,world,target);
      else if(node.kind==='smart-object'){
        const master=definitions.get(node.componentId);
        if(!master)throw new Error('Design checks found an unresolved component reference.');
        if(master.source.kind==='asset')raster(master.source.assetId,node.width,node.height,world,target);
        else{
          const contents=master.source.document,scope=new Map(definitions);
          for(const definition of contents.components??[])scope.set(definition.id,definition);
          await walk(contents.children,world.multiply(AffineTransform.scale(node.width/contents.width,node.height/contents.height)),scope,next,rootId??node.id,true,nextNames);
        }
      }
      if(performance.now()-lastYield>=8){await yieldTask();alive();lastYield=performance.now();}
    }
  };
  alive();await walk(document.children,new AffineTransform(),new Map((document.components??[]).map(definition=>[definition.id,definition])),[]);alive();
  return preflightReportSchema.parse({version:1,documentId:document.id,revision,options:settings,findings,totalFindings,truncated:totalFindings>512,layersChecked,counts,fonts:[...fonts.values()].sort((a,b)=>a.family.localeCompare(b.family)),limitations:[
    'Bounds describe authored geometry, not rendered pixels. Masks, effects, clipping stacks, occlusion and intentional bleed require review.',
    'Embedded-master bounds are clipped by their artboards and are not classified against the root canvas. Reachable font/source references are checked conservatively.',
    'Inspection policy applies to native document dimensions, not separately resized exports.',
    'Resolution measures original source sampling under affine placement, including shear. It does not assess focus, compression, detail or generated quality.',
    'Font checks cover family resolution in the inspection environment, not exact face/weight fidelity, licensing or availability on another device.',
    'Bleed conformance, alignment, text legibility, contrast, print readiness and inferred design judgments are not evaluated.',
  ]});
}
