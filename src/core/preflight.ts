import {preflightAlignmentRulesSchema,preflightAlignmentEvidenceSchema,preflightAlignmentSummarySchema,preflightBoundsSchema,preflightAlignmentAnchor,preflightAlignmentRoundoff,inspectPreflightAlignments} from './preflight-alignment';
export type {PreflightAlignmentRule,PreflightAlignmentInput,PreflightAlignmentSummary} from './preflight-alignment';
import {z} from 'zod';
import {characterFontFamilies} from './character-layout';
import type {PreflightDocumentView,PreflightLayerView,PreflightComponentView} from './preflight-view';
import {AffineTransform} from './affine';
import {placedGeometryBounds} from './spatial';
import {yieldTask} from './task-yield';

const legacyPreflightOptionsSchema=z.object({
  outputDpi:z.number().finite().positive().default(72),
  minimumPpi:z.number().finite().positive().default(72),
  checkBounds:z.boolean().default(true),
  checkFonts:z.boolean().default(true),
  includeHidden:z.boolean().default(false),
}).strict();
const preflightOptionsInputSchema=legacyPreflightOptionsSchema.extend({alignments:preflightAlignmentRulesSchema.optional()}).strict();
export const preflightOptionsSchema=preflightOptionsInputSchema.transform(options=>{if(options.alignments===undefined)delete options.alignments;return options;});
export type PreflightOptions=z.input<typeof preflightOptionsSchema>;
export type PreflightSettings=z.output<typeof preflightOptionsSchema>;
export interface PreflightControl {signal?:AbortSignal}
export const fontStatusSchema=z.enum(['available','unavailable','unknown']);
export type PreflightFontStatus=z.infer<typeof fontStatusSchema>;
export const preflightAssetMetadataSchema=z.array(z.object({id:z.string().min(1),name:z.string().optional(),width:z.number().int().positive().safe(),height:z.number().int().positive().safe()}).strict());
const legacyCodes=['bounds-outside','low-resolution','asset-missing','asset-unchecked','font-unavailable','font-unchecked','measurement-unavailable'] as const;
const legacyFindingSchema=z.object({
  code:z.enum(legacyCodes),severity:z.enum(['error','warning','info']),
  layerId:z.string().min(1),layerName:z.string(),path:z.array(z.string()).min(1).max(64),
  message:z.string(),assetId:z.string().optional(),family:z.string().optional(),
  bounds:preflightBoundsSchema.optional(),
  effectivePpi:z.number().finite().nonnegative().optional(),
}).strict();
const findingSchema=legacyFindingSchema.extend({code:z.enum([...legacyCodes,'alignment-mismatch','alignment-unchecked']),alignment:preflightAlignmentEvidenceSchema.optional()}).strict();
const reportShape={documentId:z.string().min(1),revision:z.number().int().nonnegative(),
  findings:z.array(legacyFindingSchema).max(512),
  totalFindings:z.number().int().nonnegative(),truncated:z.boolean(),layersChecked:z.number().int().nonnegative().max(4096),
  counts:z.object({error:z.number().int().nonnegative(),warning:z.number().int().nonnegative(),info:z.number().int().nonnegative()}).strict(),
  fonts:z.array(z.object({family:z.string(),status:fontStatusSchema}).strict()).max(4096),limitations:z.array(z.string()),
};
const legacyReportSchema=z.object({...reportShape,version:z.literal(1),options:legacyPreflightOptionsSchema}).strict();
const alignmentReportSchema=z.object({...reportShape,version:z.literal(2),options:preflightOptionsInputSchema.extend({alignments:preflightAlignmentRulesSchema}),findings:z.array(findingSchema).max(512),alignment:preflightAlignmentSummarySchema}).strict();
export const preflightReportSchema=z.discriminatedUnion('version',[legacyReportSchema,alignmentReportSchema]).superRefine((report,context)=>{
  const invalid=(message:string)=>context.addIssue({code:'custom',message});
  if(report.counts.error+report.counts.warning+report.counts.info!==report.totalFindings||report.findings.length!==Math.min(512,report.totalFindings)||report.truncated!==(report.totalFindings>512))invalid('Inconsistent design-check counts.');
  for(const severity of ['error','warning','info']as const){const retained=report.findings.filter(finding=>finding.severity===severity).length;if(retained>report.counts[severity]||!report.truncated&&retained!==report.counts[severity])invalid('Finding severities disagree with summary counts.');}
  if(report.version!==2)return;
  const summary=report.alignment,rules=report.options.alignments,requested=rules.reduce((n,rule)=>n+rule.layerIds.length,0);
  if(summary.rules!==rules.length||summary.requested!==requested||summary.matched+summary.mismatched+summary.unavailable+summary.excluded!==requested)invalid('Inconsistent alignment-check coverage.');
  let mismatch=0,unchecked=0,excluded=0,unavailable=0;const seen=new Set<string>();
  for(const finding of report.findings){
    if(!['alignment-mismatch','alignment-unchecked'].includes(finding.code)){if(finding.alignment)invalid('Alignment evidence requires an alignment finding.');continue;}
    const evidence=finding.alignment,rule=evidence&&rules[evidence.ruleIndex];
    if(!evidence||!rule){invalid('Alignment findings require a declared rule.');continue;}
    const key=`${evidence.ruleIndex}:${finding.layerId}`;if(seen.has(key))invalid('Duplicate alignment finding.');seen.add(key);
    if(!rule.layerIds.includes(finding.layerId)||finding.path.at(-1)!==finding.layerId||evidence.alignment!==rule.alignment||JSON.stringify(evidence.target)!==JSON.stringify(rule.target)||evidence.tolerance!==rule.tolerance)invalid('Alignment evidence does not match its rule and target.');
    if(finding.code==='alignment-mismatch'){
      mismatch++;
      if(finding.severity!=='warning'||evidence.reason!==undefined||!finding.bounds||!evidence.referenceBounds||evidence.actual===undefined||evidence.expected===undefined||evidence.delta===undefined||evidence.numericalTolerance===undefined||evidence.delta!==evidence.expected-evidence.actual||evidence.actual!==preflightAlignmentAnchor(finding.bounds,evidence.alignment)||evidence.expected!==preflightAlignmentAnchor(evidence.referenceBounds,evidence.alignment)||evidence.numericalTolerance!==preflightAlignmentRoundoff(finding.bounds,evidence.referenceBounds)||Math.abs(evidence.delta)<=evidence.tolerance+evidence.numericalTolerance)invalid('Invalid measured alignment evidence.');
    }else{
      unchecked++;if(evidence.reason==='hidden'){excluded++;if(report.options.includeHidden)invalid('Included layers cannot be excluded by visibility.');}else unavailable++;
      if(finding.severity!=='info'||!evidence.reason||evidence.actual!==undefined||evidence.expected!==undefined||evidence.delta!==undefined||evidence.referenceBounds!==undefined||evidence.numericalTolerance!==undefined)invalid('Unmeasured alignment must not fabricate measurements.');
    }
  }
  if(excluded>summary.excluded||unavailable>summary.unavailable||!report.truncated&&(excluded!==summary.excluded||unavailable!==summary.unavailable))invalid('Unverified alignment reasons disagree with coverage counts.');
  if(summary.mismatched>report.counts.warning||summary.unavailable+summary.excluded>report.counts.info)invalid('Alignment coverage exceeds severity counts.');
  if(mismatch>summary.mismatched||unchecked>summary.unavailable+summary.excluded||!report.truncated&&(mismatch!==summary.mismatched||unchecked!==summary.unavailable+summary.excluded))invalid('Alignment findings disagree with coverage counts.');
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
          const bounds=placedGeometryBounds(node,world);
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
  const alignment=settings.alignments===undefined?undefined:await inspectPreflightAlignments(document,settings.alignments,settings.includeHidden,add,environment.signal);alive();
  return preflightReportSchema.parse({version:alignment?2:1,...(alignment?{alignment}:{}),documentId:document.id,revision,options:settings,findings,totalFindings,truncated:totalFindings>512,layersChecked,counts,fonts:[...fonts.values()].sort((a,b)=>a.family.localeCompare(b.family)),limitations:[
    'Bounds describe authored geometry, not rendered pixels. Masks, effects, clipping stacks, occlusion and intentional bleed require review.',
    'Embedded-master bounds are clipped by their artboards and are not classified against the root canvas. Reachable font/source references are checked conservatively.',
    'Inspection policy applies to native document dimensions, not separately resized exports.',
    'Resolution measures original source sampling under affine placement, including shear. It does not assess focus, compression, detail or generated quality.',
    'Font checks cover family resolution in the inspection environment, not exact face/weight fidelity, licensing or availability on another device.',
    ...(alignment?['Alignment checks compare only declared root-document targets against canvas or independent key-layer authored frames. Masks, effects and visible pixels are not measured. Group bounds include hidden child geometry, matching the editor alignment tools; hidden key references remain usable.', 'Alignment uses a 1e-7 document-pixel numerical floor plus floating-point roundoff. Unresolved precision is reported as unverified instead of passing the rule.', 'Bleed conformance, inferred alignment intent, text legibility, contrast and print readiness are not evaluated.']:['Bleed conformance, alignment, text legibility, contrast, print readiness and inferred design judgments are not evaluated.']),
  ]});
}
