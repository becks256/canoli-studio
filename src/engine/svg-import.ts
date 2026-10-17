import {z} from 'zod';
import {Document,LayerMask,RasterLayer,VectorPath,AffineTransform} from '../dom';
import {AssetStore} from '../core/assets';
import {allLayers,referencedAssets} from '../core/model';
import type {SvgInspection,SvgImportControl,SvgImportOptions,SvgImportReport} from '../core/svg-import';
import {svgViewBox} from '../core/svg-path-import';
import {exportPng} from './png';
import {CanvasRenderer} from './renderer';

const positive=z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const count=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const messages=z.array(z.string().max(1000)).max(256);
const reportSchema=z.object({version:z.literal(1),width:positive,height:positive,canImportEditable:z.boolean(),featuresPreserved:messages,featuresDegraded:messages,unsupportedFeatures:messages,additionalIssues:count,elements:count,layers:count,images:count}).strict();
const inspectionSchema=z.object({report:reportSchema,document:z.unknown().optional(),flat:z.instanceof(Blob),assets:z.array(z.object({id:z.string().uuid(),name:z.string().max(240),blob:z.instanceof(Blob)}).strict()).max(64),images:z.array(z.object({layerId:z.string(),assetId:z.string(),viewportWidth:z.number().positive().max(Number.MAX_SAFE_INTEGER).nullable(),viewportHeight:z.number().positive().max(Number.MAX_SAFE_INTEGER).nullable(),aspect:z.string()}).strict()).max(64)}).strict();
export const svgImportOptionsSchema=z.object({mode:z.enum(['editable','flatten']).default('editable')}).strict();

/** Validate worker transport before admitting any source assets or model. */
export function validateSvgInspection(value:unknown):SvgInspection{
 const parsed=inspectionSchema.parse(value),r=parsed.report;
 if(parsed.flat.type!=='image/svg+xml;charset=utf-8'||r.canImportEditable!==(r.unsupportedFeatures.length===0&&r.additionalIssues===0))throw new Error('Invalid SVG capability result.');
 if(r.canImportEditable){
  const doc=Document.fromJSON(parsed.document),layers=allLayers(doc.toJSON().children),ids=new Set(parsed.assets.map(a=>a.id)),placements=new Set(parsed.images.map(i=>i.layerId));
  if(doc.width!==r.width||doc.height!==r.height||ids.size!==parsed.assets.length||r.images!==parsed.assets.length||placements.size!==parsed.images.length||layers.length!==r.layers)throw new Error('Invalid SVG import model.');
  for(const id of referencedAssets(doc.toJSON()))if(!ids.has(id))throw new Error('Missing embedded SVG asset.');
  for(const asset of parsed.assets)if(!['image/png','image/jpeg','image/webp'].includes(asset.blob.type))throw new Error('Invalid embedded SVG asset type.');
  for(const p of parsed.images){const layer=doc.getLayer(p.layerId);if(!(layer instanceof RasterLayer)||layer.assetId!==p.assetId||!ids.has(p.assetId))throw new Error('Invalid SVG image placement.');}
  if(layers.some(l=>l.kind==='raster'&&!placements.has(l.id)))throw new Error('Missing SVG image placement.');
 }else if(parsed.document!==undefined||parsed.assets.length||parsed.images.length)throw new Error('Unsupported SVG cannot publish partial editable content.');
 return parsed as SvgInspection;
}

export function inspectSvgFile(file:File,control:SvgImportControl={},check:()=>void=()=>{}):Promise<SvgInspection>{
 const current=()=>{control.signal?.throwIfAborted();check();};current();
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./svg-import.worker.ts',import.meta.url),{type:'module'});let settled=false;
  const finish=(error?:unknown,value?:unknown)=>{if(settled)return;settled=true;worker.terminate();control.signal?.removeEventListener('abort',cancel);try{current();if(error)throw error;resolve(validateSvgInspection(value));}catch(cause){reject(cause);}};
  const cancel=()=>finish(control.signal?.reason??new Error('SVG import cancelled.'));
  control.signal?.addEventListener('abort',cancel,{once:true});
  worker.onmessage=event=>{try{current();const data=event.data;if(data.error)finish(new Error(String(data.error)));else if(data.progress){const progress=z.object({phase:z.enum(['reading','inspecting']),fraction:z.null()}).strict().parse(data.progress);control.onProgress?.(progress);current();}else finish(undefined,data.inspection);}catch(error){finish(error);}};
  worker.onerror=()=>finish(new Error('SVG inspection worker failed.'));
  worker.onmessageerror=()=>finish(new Error('Invalid SVG worker message.'));
  try{current();worker.postMessage({file});}catch(error){finish(error);}
 });
}

/** Decode inert image content only. Never insert SVG markup into the live DOM. */
async function decodeSvg(blob:Blob,control:SvgImportControl,check:()=>void):Promise<ImageBitmap>{
 const url=URL.createObjectURL(blob),image=new Image();let bitmap:ImageBitmap|undefined;
 const current=()=>{control.signal?.throwIfAborted();check();};
 try{
  current();image.src=url;
  await new Promise<void>((resolve,reject)=>{
   const abort=()=>{image.src='';reject(control.signal?.reason??new Error('SVG import cancelled.'));};
   control.signal?.addEventListener('abort',abort,{once:true});
   void image.decode().then(resolve,()=>reject(new Error('The browser could not decode this SVG viewport. Check the file and available device memory.'))).finally(()=>control.signal?.removeEventListener('abort',abort));
   if(control.signal?.aborted)abort();
  });
  current();bitmap=await createImageBitmap(image);current();const result=bitmap;bitmap=undefined;return result;
 }finally{bitmap?.close();image.src='';URL.revokeObjectURL(url);}
}

/** Prepare an isolated OO document; caller alone publishes the complete tab. */
export async function prepareSvgImport(file:File,options:SvgImportOptions={},control:SvgImportControl={},check:()=>void=()=>{}):Promise<{document:Document;assets:AssetStore;report:SvgImportReport}>{
 const {mode}=svgImportOptionsSchema.parse(options),inspection=await inspectSvgFile(file,control,check),assets=new AssetStore();
 const current=()=>{control.signal?.throwIfAborted();check();};
 const progress=(phase:'decoding'|'rendering',fraction:number|null)=>{current();control.onProgress?.({phase,fraction});current();};
 try{
  current();let doc:Document;
  if(mode==='editable'){
   if(!inspection.report.canImportEditable)throw new Error('This SVG has unsupported editable features. Review the report and explicitly choose flattened import.');
   doc=Document.fromJSON(inspection.document);
   const referenced=new Set(referencedAssets(doc.toJSON()));
   for(const [index,source] of inspection.assets.entries())if(referenced.has(source.id)){progress('decoding',index/Math.max(1,inspection.assets.length));await assets.add(source.blob,source.name,source.id);current();}
   for(const p of inspection.images){
    const layer=doc.getLayer(p.layerId) as RasterLayer,source=assets.get(p.assetId),w=p.viewportWidth??(p.viewportHeight===null?source.width:p.viewportHeight*source.width/source.height),h=p.viewportHeight??w*source.height/source.width;
    const view=svgViewBox(w,h,[0,0,source.width,source.height],p.aspect);
    layer.width=source.width*view.a;layer.height=source.height*view.d;
    layer.transform=layer.transform.multiply(AffineTransform.translation(view.e,view.f));
    if(/\bslice\s*$/.test(p.aspect))layer.mask=new LayerMask({paths:[VectorPath.rectangle({x:-view.e,y:-view.f,width:w,height:h})]});
   }
  }else{
   progress('decoding',null);const bitmap=await decodeSvg(inspection.flat,control,check),temporary=new AssetStore(),renderer=new CanvasRenderer();
   let png:Blob;
   try{
    if(bitmap.width!==inspection.report.width||bitmap.height!==inspection.report.height)throw new Error('Decoded SVG dimensions differ from the inspected viewport.');
    const source=temporary.install({id:crypto.randomUUID(),name:'SVG image decoder',blob:inspection.flat,bitmap,width:bitmap.width,height:bitmap.height,thumbnail:''},false);
    const raster=new Document({name:'SVG image decoder',width:source.width,height:source.height});raster.layers.add(new RasterLayer({assetId:source.id,width:source.width,height:source.height}));
    png=await exportPng(raster.toJSON(),temporary,renderer,{signal:control.signal,onProgress:p=>progress('rendering',p.fraction)});current();
   }finally{if(!temporary.values().length)bitmap.close();temporary.dispose();renderer.dispose();}
   progress('decoding',null);const source=await assets.add(png,file.name.replace(/\.svg$/i,'')+'.png');current();
   doc=new Document({name:file.name.replace(/\.svg$/i,'').slice(0,240)||'Imported SVG',width:source.width,height:source.height});doc.layers.add(new RasterLayer({name:'Flattened SVG',assetId:source.id,width:source.width,height:source.height}));
  }
  // Opening a file establishes a clean baseline, rather than exposing preparation history.
  doc=Document.fromJSON(doc.toJSON());current();return{document:doc,assets,report:inspection.report};
 }catch(error){assets.dispose();throw error;}
}
