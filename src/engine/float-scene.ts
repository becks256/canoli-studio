import type{DocumentData,LayerData}from'../core/model';
import{validateDocument}from'../core/model';
import{floatSceneIssue,assertFloatSources}from'../core/float-document';
import{visitMaskAssets}from'../core/asset-references';
import type{AssetStore,ImageAsset}from'../core/assets';
import{freeze,isImmutable}from'../core/immutable';
import{FloatRasterSource}from'../core/float-source/source';
import{validateWindow,type FloatSourceControl,type FloatSourceWindow}from'../core/float-source/types';
import{AffineTransform}from'../core/affine';
import{localTransform}from'../core/spatial';
import{maskTransform,type LayerMaskData}from'../core/masks';
import{renderTransform,createCanvas,release,type RenderSpace}from'./canvas';
import{IccSession}from'../core/color/icc-client';
import{iccTarget}from'../core/color/profile-source';
import type{PixelProcessor}from'./processor';
import{projectFloatWindow,type FloatProjectionControl,type FloatWindowSource}from'./float-projection';
import{interpolateFloatBackdrops}from'./float-interpolate';
import{checkRenderCurrent}from'./render-control';
import{validateFloatWorkerWindow}from'./float-pixels';

export interface FloatSceneControl extends FloatSourceControl,FloatProjectionControl{}
export type FloatMaskService=(mask:LayerMaskData,space:RenderSpace,world:AffineTransform,check:()=>void)=>Promise<Float32Array>;
export interface FloatSceneFrame {region:{x:number;y:number;width:number;height:number};width:number;height:number;rootTransform?:AffineTransform}
export interface CapturedFloatScene {
 readonly document:DocumentData;
 readonly signal:AbortSignal;
 check():void;
 /** Bounds are indices on the complete frame's output-pixel lattice. Omitting
  * the frame gives the document's native pixel plane, including outside borders. */
 read(bounds:FloatSourceWindow,frame?:FloatSceneFrame):Promise<Float32Array<ArrayBuffer>>;
 dispose():void;
}
interface CachedSource{original:Blob;key:string;source:FloatRasterSource}

/** Owns original-source leases, not authored data or quantized color caches.
 * A captured scene pins its own shares across awaits and renderer-cache eviction. */
export class FloatSceneRenderer {
 private entries=new Map<Blob,Map<string,CachedSource>>();
 private lru=new Map<CachedSource,true>();private epoch=0;private closed=false;
 private captures=new Set<AbortController>();
 constructor(private processor:Pick<PixelProcessor,'floatComposite'|'floatAffine'>){}
 private source(store:AssetStore,asset:ImageAsset):FloatRasterSource{
  if(!asset.tiff||!asset.tiffColor)throw new Error('Float documents require retained original float TIFF sources. Byte editing proxies are not precision sources.');
  const key=JSON.stringify([asset.width,asset.height,asset.tiff,asset.tiffColor.source]);let entries=this.entries.get(asset.blob);if(!entries){entries=new Map();this.entries.set(asset.blob,entries);}let entry=entries.get(key);
  if(!entry){entry={original:asset.blob,key,source:store.captureFloatSource(asset.id)};entries.set(key,entry);}
  this.lru.delete(entry);this.lru.set(entry,true);const share=entry.source.share();
  while(this.lru.size>64){const oldest=this.lru.keys().next().value!;this.lru.delete(oldest);const group=this.entries.get(oldest.original)!;group.delete(oldest.key);if(!group.size)this.entries.delete(oldest.original);oldest.source.dispose();}
  return share;
 }
 clear(){this.epoch++;const captures=[...this.captures];this.captures.clear();for(const capture of captures)capture.abort(new Error('Float scene capture is closed or superseded.'));for(const entry of this.lru.keys())entry.source.dispose();this.lru.clear();this.entries.clear();}
 dispose(){this.closed=true;this.clear();}
 async render(document:DocumentData,assets:AssetStore,mask:FloatMaskService,frame:FloatSceneFrame,control:FloatSceneControl={},readback=false):Promise<HTMLCanvasElement>{
  const scene=await this.capture(document,assets,mask,control);let output:HTMLCanvasElement|undefined,display:IccSession|undefined,accepted=false;
  const check=()=>{control.signal?.throwIfAborted();scene.check();checkRenderCurrent(control.isCancelled);if(this.closed)throw new Error('Float scene renderer is closed.');};
  try{
   check();output=createCanvas(frame.width,frame.height,readback);const prepared=await IccSession.prepareRgb(iccTarget('linear-srgb').source,iccTarget('srgb').source,{inputFormat:'rgba-float32',outputFormat:'rgba8'},{signal:scene.signal,onProgress:check});display=prepared.session;check();const context=output.getContext('2d')!;
   for(let y=0;y<frame.height;y+=32)for(let x=0;x<frame.width;x+=2048){
    check();const width=Math.min(2048,frame.width-x),height=Math.min(32,frame.height-y),pixels=await scene.read({x,y,width,height},frame),bytes=await display.applyWindow(pixels);check();
    if(!(bytes instanceof Uint8ClampedArray)||!(bytes.buffer instanceof ArrayBuffer))throw new Error('Float display conversion did not return owned sRGB8 samples.');context.putImageData(new ImageData(new Uint8ClampedArray(bytes),width,height),x,y);
   }
   check();accepted=true;return output;
  }finally{display?.dispose();scene.dispose();if(output&&!accepted)release(output);}
 }
 async capture(input:DocumentData,assets:AssetStore,maskService:FloatMaskService,control:FloatSceneControl={}):Promise<CapturedFloatScene>{
  if(this.closed)throw new Error('Float scene renderer is closed.');const document=isImmutable(input)?input:freeze(structuredClone(input));validateDocument(document);const issue=floatSceneIssue(document);if(issue)throw new Error(issue);
  assertFloatSources(document,assets);
  const epoch=this.epoch,lifetime=assets.captureLifetime(),sources=new Map<string,{asset:ImageAsset;source:FloatRasterSource;tiff:ImageAsset['tiff'];color:ImageAsset['tiffColor']}>(),masks=new Map<string,{asset:ImageAsset;bitmap:ImageBitmap;blob:Blob;width:number;height:number}>();let closed=false;
  const abort=new AbortController(),incoming=control.signal,cancel=()=>abort.abort(incoming?.reason);incoming?.addEventListener('abort',cancel,{once:true});if(incoming?.aborted)cancel();this.captures.add(abort);control={...control,signal:abort.signal};
  const check=()=>{control.signal?.throwIfAborted();checkRenderCurrent(control.isCancelled);if(closed||this.closed||epoch!==this.epoch)throw new Error('Float scene capture is closed or superseded.');lifetime();
   for(const[id,value]of sources)if(!assets.has(id)||assets.get(id)!==value.asset||value.asset.blob!==value.source.original||value.asset.width!==value.source.width||value.asset.height!==value.source.height||value.asset.tiff!==value.tiff||value.asset.tiffColor!==value.color)throw new Error('Float scene source changed.');
   for(const[id,pin]of masks)if(!assets.has(id)||assets.get(id)!==pin.asset||pin.asset.bitmap!==pin.bitmap||pin.asset.blob!==pin.blob||pin.asset.width!==pin.width||pin.asset.height!==pin.height||pin.bitmap.width!==pin.width||pin.bitmap.height!==pin.height)throw new Error('Float scene mask source changed.');
  };
  const dispose=()=>{if(closed)return;closed=true;abort.abort(new Error('Float scene capture is closed.'));incoming?.removeEventListener('abort',cancel);this.captures.delete(abort);for(const value of sources.values())value.source.dispose();sources.clear();};
  const visit=(layers:LayerData[])=>{for(const layer of layers){
   visitMaskAssets(layer.mask,reference=>{if(!masks.has(reference.assetId)){const asset=assets.get(reference.assetId);masks.set(reference.assetId,{asset,bitmap:asset.bitmap,blob:asset.blob,width:asset.width,height:asset.height});}});
   if(layer.kind==='group')visit(layer.children);else if(layer.kind==='raster'&&!sources.has(layer.assetId)){const asset=assets.get(layer.assetId);sources.set(asset.id,{asset,source:this.source(assets,asset),tiff:asset.tiff,color:asset.tiffColor});}
  }};
  try{
   check();visit(document.children);check();
   // All source preparation precedes acquisition of any display/output CMM
   // session. Ready tiles need no native owner, avoiding semaphore deadlocks.
   for(const value of sources.values())await value.source.prepare({signal:control.signal,onProgress:progress=>{check();control.onProgress?.(progress);check();}});
   check();
   return{document,signal:abort.signal,check,dispose,read:async(input,frame={region:{x:0,y:0,width:document.width,height:document.height},width:document.width,height:document.height})=>{
    check();const bounds=validateWindow(input),r=frame.region;
    if(![r.x,r.y,r.width,r.height].every(Number.isFinite)||r.width<=0||r.height<=0||![frame.width,frame.height].every(v=>Number.isSafeInteger(v)&&v>0))throw new Error('Float scene frame geometry is invalid.');
    const full:RenderSpace={x:r.x,y:r.y,width:frame.width,height:frame.height,sx:frame.width/r.width,sy:frame.height/r.height},space:RenderSpace={x:r.x+bounds.x/full.sx,y:r.y+bounds.y/full.sy,width:bounds.width,height:bounds.height,sx:full.sx,sy:full.sy},root=frame.rootTransform??new AffineTransform();
    const mask=async(layer:LayerData,world:AffineTransform)=>{
     if(!layer.mask?.enabled||layer.mask.density===0)return undefined;check();const result=await maskService(layer.mask,space,maskTransform(layer.mask,world),check);check();if(!(result instanceof Float32Array)||result.length!==bounds.width*bounds.height)throw new Error('Float mask coverage differs from its working window.');for(const value of result)if(!Number.isFinite(value)||value<0||value>1)throw new Error('Float mask coverage is invalid.');return result;
    };
    const expose=async(pixels:Float32Array,stops:number)=>{
     if(stops===0)return pixels;check();const gain=2**stops,result=await this.processor.floatAffine(pixels,[gain,0,0,0,0,gain,0,0,0,0,gain,0]);check();return result;
    };
    const paint=async(layers:LayerData[],initial:Float32Array,parent:AffineTransform):Promise<Float32Array>=>{
     let backdrop=initial;
     for(const layer of layers){
      check();if(!layer.visible||layer.opacity===0)continue;const world=parent.multiply(localTransform(layer)),coverage=await mask(layer,world),opacity=layer.opacity*(layer.fillOpacity??1);
      if(layer.kind==='group'){
       if(layer.blendMode==='pass-through'){
        if(layer.opacity===1&&!coverage)backdrop=await paint(layer.children,backdrop,world);
        else{const after=await paint(layer.children,backdrop.slice(),world);backdrop=await interpolateFloatBackdrops(backdrop,after,layer.opacity,coverage,check);}
       }else{const pixels=await paint(layer.children,new Float32Array(backdrop.length),world);backdrop=await this.processor.floatComposite(pixels,backdrop,{opacity,mask:coverage});}
      }else if(layer.kind==='raster'){
       const source=sources.get(layer.assetId)!,placement=renderTransform(full,world).multiply(AffineTransform.scale(layer.width/source.source.width,layer.height/source.source.height));
       const effects=layer.effects.filter(effect=>effect.enabled&&effect.exposure!==0),adjusted:FloatWindowSource=effects.length?{width:source.source.width,height:source.source.height,readWindow:async(region,control)=>{let pixels:Float32Array=await source.source.readWindow(region,control);for(const effect of effects)pixels=await expose(pixels,effect.exposure);return pixels;}}:source.source;
       const pixels=await projectFloatWindow(adjusted,placement,bounds,{signal:control.signal,isCancelled:()=>{check();return false;}});
       check();backdrop=await this.processor.floatComposite(pixels,backdrop,{opacity,mask:coverage});
      }else if(layer.kind==='adjustment'&&layer.adjustment.kind==='tone'){
       const after=await expose(backdrop,layer.adjustment.exposure);backdrop=await interpolateFloatBackdrops(backdrop,after,opacity,coverage,check);
      }else throw new Error('Unsupported float scene layer.');
     }
     check();return backdrop;
    };
    const output=await paint(document.children,new Float32Array(bounds.width*bounds.height*4),root);check();validateFloatWorkerWindow(output);return output as Float32Array<ArrayBuffer>;
   }};
  }catch(error){dispose();throw error;}
 }
}
