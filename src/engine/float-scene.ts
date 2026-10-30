import{applyFloatStyle}from'./float-style';
import {activePerspective,perspectiveLocalQuad} from '../core/perspective';
import type {CapturedPerspectiveMask,PerspectiveMaskOptions} from './projective-mask';
import {projectPerspectiveWindow} from './projective-projection';
import {applyFloatTonal} from './float-tonal';
import type {BrushStrokeData} from '../core/drawing';
import{FloatAppearanceCache}from'./float-appearance';
import{isFloatColorAdjustment}from'../core/float-color';
import{compileFloatWhiteBalance}from'../core/float-white-balance';
import{projectFloatFrame,type FloatSceneFrame}from'./float-frame';
export type{FloatSceneFrame}from'./float-frame';
import{clippingStacks}from'../core/clipping';
import{prepareFloatClipping,restoreFloatClipping}from'./float-clipping';
import{applyFloatCoverage,floatAlphaPlane,fillFloatCoverage}from'./float-coverage';
import{renderFloatShadow,FloatShadowCache}from'./float-shadow';
import type{DocumentData,LayerData}from'../core/model';
import{validateDocument}from'../core/model';
import{floatSceneIssue,assertFloatSources}from'../core/float-document';
import{visitLayerAssets}from'../core/asset-references';
import type{AssetStore,ImageAsset}from'../core/assets';
import{freeze,isImmutable}from'../core/immutable';
import{FloatRasterSource}from'../core/float-source/source';
import{validateWindow,type FloatSourceControl,type FloatSourceWindow}from'../core/float-source/types';
import{AffineTransform}from'../core/affine';
import{localTransform}from'../core/spatial';
import{maskTransform,type LayerMaskData}from'../core/masks';
import{renderTransform,createCanvas,release,type RenderSpace}from'./canvas';
import{borrowFloatDisplay,retireFloatDisplay}from'./float-display';
import type{PixelProcessor,FloatLookupLease}from'./processor';
import{projectFloatWindow,type FloatProjectionControl,type FloatWindowSource}from'./float-projection';
import{interpolateFloatBackdrops}from'./float-interpolate';
import{blendFloatAdjustment}from'./float-adjustment-blend';
import{checkRenderCurrent}from'./render-control';
import{validateFloatWorkerWindow}from'./float-pixels';
import type{ColorProof}from'../core/color/color-settings';

export interface FloatSceneControl extends FloatSourceControl,FloatProjectionControl{}
export type FloatMaskService=((mask:LayerMaskData,space:RenderSpace,world:AffineTransform,check:()=>void)=>Promise<Float32Array>)&{perspective?(mask:LayerMaskData,options:PerspectiveMaskOptions,check:()=>void):CapturedPerspectiveMask};
export type FloatStrokeService=(brush:BrushStrokeData,space:RenderSpace,world:AffineTransform,check:()=>void)=>Promise<Float32Array>;
export interface CapturedFloatScene {
 readonly document:DocumentData;
 readonly signal:AbortSignal;
 check():void;
 /** Bounds are indices on the complete frame's output-pixel lattice. Omitting
  * the frame gives the native world plane, including outside borders. A frame
  * filters the completed native artboard, with one boundary coverage pass. */
 read(bounds:FloatSourceWindow,frame?:FloatSceneFrame):Promise<Float32Array<ArrayBuffer>>;
 dispose():void;
}
interface CachedSource{original:Blob;key:string;source:FloatRasterSource}

/** Owns original-source leases and a bounded native float preview cache, never authored data.
 * A captured scene pins its own shares across awaits and renderer-cache eviction. */
export class FloatSceneRenderer {
 private readonly displayOwner=Symbol('float display owner');
 private readonly appearance=new FloatAppearanceCache();
 private entries=new Map<Blob,Map<string,CachedSource>>();
 private lru=new Map<CachedSource,true>();private epoch=0;private closed=false;
 private captures=new Set<AbortController>();
 constructor(private processor:Pick<PixelProcessor,'floatProjective'|'floatTonal'|'floatConvolveAlpha'|'floatStyle'|'floatComposite'|'floatTone'|'floatTransfer'|'floatAffine'|'floatColor'|'floatGradient'|'prepareFloatLookup'>){}
 private source(store:AssetStore,asset:ImageAsset):FloatRasterSource{
  if(!asset.tiff||!asset.tiffColor)throw new Error('Float documents require retained original high-precision TIFF sources. Byte editing proxies are not precision sources.');
  const key=JSON.stringify([asset.width,asset.height,asset.tiff,asset.tiffColor.source]);let entries=this.entries.get(asset.blob);if(!entries){entries=new Map();this.entries.set(asset.blob,entries);}let entry=entries.get(key);
  if(!entry){entry={original:asset.blob,key,source:store.captureFloatSource(asset.id)};entries.set(key,entry);}
  this.lru.delete(entry);this.lru.set(entry,true);const share=entry.source.share();
  while(this.lru.size>64){const oldest=this.lru.keys().next().value!;this.lru.delete(oldest);const group=this.entries.get(oldest.original)!;group.delete(oldest.key);if(!group.size)this.entries.delete(oldest.original);oldest.source.dispose();}
  return share;
 }
 clear(){this.appearance.clear();this.epoch++;const captures=[...this.captures];this.captures.clear();for(const capture of captures)capture.abort(new Error('Float scene capture is closed or superseded.'));retireFloatDisplay(this.displayOwner);for(const entry of this.lru.keys())entry.source.dispose();this.lru.clear();this.entries.clear();}
 dispose(){this.closed=true;this.clear();}
 async render(document:DocumentData,assets:AssetStore,mask:FloatMaskService,frame:FloatSceneFrame,control:FloatSceneControl={},readback=false,proof:ColorProof|null=null,cache=true,strokeService?:FloatStrokeService):Promise<HTMLCanvasElement>{
  const capturedProof=proof?Object.freeze({...proof}):null;
  const scene=await this.capture(document,assets,mask,control,strokeService);let output:HTMLCanvasElement|undefined,display:Awaited<ReturnType<typeof borrowFloatDisplay>>|undefined,accepted=false;
  const check=()=>{control.signal?.throwIfAborted();scene.check();checkRenderCurrent(control.isCancelled);if(this.closed)throw new Error('Float scene renderer is closed.');};
  try{
   check();
   const plan=cache?this.appearance.plan(scene.document,assets,frame):undefined;
   let appearance=plan?this.appearance.get(plan):undefined;
   if(plan&&!appearance){
    // Complete native support includes artwork outside the artboard, so later
    // integer moves can reveal edge pixels. Preparation/read failures retain
    // the normal rejection boundary; incomplete appearances are never cached.
    const pixels=await scene.read(plan.world);check();appearance=this.appearance.put(plan,pixels);
   }
   check();output=createCanvas(frame.width,frame.height,readback);display=await borrowFloatDisplay(this.displayOwner,{signal:scene.signal,onProgress:check},capturedProof);check();const context=output.getContext('2d')!;
   // Keep the existing 65,536-pixel allocation ceiling while avoiding eight
   // source/worker round trips for a small 256-square frame. Native scene
   // evaluation still precedes frame filtering and the actual ICC transform.
   const columns=Math.min(2048,Math.max(1,frame.width)),rows=Math.min(2048,Math.floor(65536/columns));
   for(let y=0;y<frame.height;y+=rows)for(let x=0;x<frame.width;x+=columns){
    check();const width=Math.min(columns,frame.width-x),height=Math.min(rows,frame.height-y),pixels=plan&&appearance?this.appearance.read(plan,appearance,{x,y,width,height},frame,scene.document):await scene.read({x,y,width,height},frame),bytes=await display.applyWindow(pixels);check();
    if(!(bytes instanceof Uint8ClampedArray)||!(bytes.buffer instanceof ArrayBuffer))throw new Error('Float display conversion did not return owned sRGB8 samples.');context.putImageData(new ImageData(new Uint8ClampedArray(bytes),width,height),x,y);
   }
   check();accepted=true;return output;
  }finally{display?.release();scene.dispose();if(output&&!accepted)release(output);}
 }
 async capture(input:DocumentData,assets:AssetStore,maskService:FloatMaskService,control:FloatSceneControl={},strokeService?:FloatStrokeService):Promise<CapturedFloatScene>{
  if(this.closed)throw new Error('Float scene renderer is closed.');const document=isImmutable(input)?input:freeze(structuredClone(input));validateDocument(document);const issue=floatSceneIssue(document);if(issue)throw new Error(issue);
  assertFloatSources(document,assets);
  const epoch=this.epoch,lifetime=assets.captureLifetime(),sources=new Map<string,{asset:ImageAsset;source:FloatRasterSource;tiff:ImageAsset['tiff'];color:ImageAsset['tiffColor']}>(),masks=new Map<string,{asset:ImageAsset;bitmap:ImageBitmap;blob:Blob;width:number;height:number}>();let closed=false;
  const shadowCache=new FloatShadowCache();
  const perspectiveMasks=new Map<string,CapturedPerspectiveMask>();
  const whiteBalances=new Map<string,readonly number[]|null>();
  const lookups=new Map<string,FloatLookupLease>();
  const abort=new AbortController(),incoming=control.signal,cancel=()=>abort.abort(incoming?.reason);incoming?.addEventListener('abort',cancel,{once:true});if(incoming?.aborted)cancel();this.captures.add(abort);control={...control,signal:abort.signal};
  const check=()=>{control.signal?.throwIfAborted();checkRenderCurrent(control.isCancelled);if(closed||this.closed||epoch!==this.epoch)throw new Error('Float scene capture is closed or superseded.');lifetime();
   for(const[id,value]of sources)if(!assets.has(id)||assets.get(id)!==value.asset||value.asset.blob!==value.source.original||value.asset.width!==value.source.width||value.asset.height!==value.source.height||value.asset.tiff!==value.tiff||value.asset.tiffColor!==value.color)throw new Error('Float scene source changed.');
   for(const[id,pin]of masks)if(!assets.has(id)||assets.get(id)!==pin.asset||pin.asset.bitmap!==pin.bitmap||pin.asset.blob!==pin.blob||pin.asset.width!==pin.width||pin.asset.height!==pin.height||pin.bitmap.width!==pin.width||pin.bitmap.height!==pin.height)throw new Error('Float scene mask source changed.');
  };
  const dispose=()=>{if(closed)return;closed=true;abort.abort(new Error('Float scene capture is closed.'));incoming?.removeEventListener('abort',cancel);this.captures.delete(abort);for(const value of sources.values())value.source.dispose();sources.clear();masks.clear();for(const capture of perspectiveMasks.values())capture.dispose();perspectiveMasks.clear();shadowCache.clear();whiteBalances.clear();for(const lookup of lookups.values())lookup.dispose();lookups.clear();};
  const visit=(layers:LayerData[])=>{for(const layer of layers){
   visitLayerAssets(layer,reference=>{if(reference===layer&&layer.kind==='raster')return;if(!masks.has(reference.assetId)){const asset=assets.get(reference.assetId);masks.set(reference.assetId,{asset,bitmap:asset.bitmap,blob:asset.blob,width:asset.width,height:asset.height});}});
   if(layer.kind==='group')visit(layer.children);else if(layer.kind==='raster'&&!sources.has(layer.assetId)){const asset=assets.get(layer.assetId);sources.set(asset.id,{asset,source:this.source(assets,asset),tiff:asset.tiff,color:asset.tiffColor});}
   else if(layer.kind==='adjustment'&&layer.adjustment.kind==='white-balance')whiteBalances.set(layer.id,compileFloatWhiteBalance(layer.adjustment));
  }};
  try{
   check();visit(document.children);check();
   const prepareLookups=async(layers:LayerData[])=>{for(const layer of layers){if(layer.kind==='group')await prepareLookups(layer.children);else if(layer.kind==='adjustment'&&layer.adjustment.kind==='lut'){const lookup=await this.processor.prepareFloatLookup(layer.adjustment);try{check();lookups.set(layer.id,lookup);}catch(error){lookup.dispose();throw error;}}}};
   await prepareLookups(document.children);check();
   // All source preparation precedes acquisition of any display/output CMM
   // session. Ready tiles need no native owner, avoiding semaphore deadlocks.
   for(const value of sources.values())await value.source.prepare({signal:control.signal,onProgress:progress=>{check();control.onProgress?.(progress);check();}});
   check();
   const balance=async(id:string,pixels:Float32Array)=>{
    const matrix=whiteBalances.get(id);if(matrix===undefined)throw new Error('Float white balance was not captured.');
    // Neutral is an exact identity, including signed zero and hidden RGB.
    if(matrix===null)return pixels;
    check();const result=await this.processor.floatAffine(pixels,matrix);check();return result;
   };
   const compose=async(input:FloatSourceWindow):Promise<Float32Array<ArrayBuffer>>=>{
    check();const bounds=validateWindow(input),full:RenderSpace={x:0,y:0,width:document.width,height:document.height,sx:1,sy:1},root=new AffineTransform();
    const spaceFor=(area:FloatSourceWindow):RenderSpace=>({x:area.x,y:area.y,width:area.width,height:area.height,sx:1,sy:1});
    const mask=async(layer:LayerData,world:AffineTransform,area:FloatSourceWindow=bounds)=>{
     if(layer.kind==='raster'&&activePerspective(layer.perspective)&&layer.mask?.enabled&&layer.mask.density>0){
      let capture=perspectiveMasks.get(layer.id);
      if(!capture){
       if(!maskService.perspective)throw new Error('Perspective mask capture is unavailable.');const source=sources.get(layer.assetId)!.source;
       const corners=perspectiveLocalQuad(layer.width,layer.height,layer.perspective).map(p=>world.point(p)) as unknown as import('../core/projective').ProjectiveQuad;
       capture=maskService.perspective(layer.mask,{sourceWidth:source.width,sourceHeight:source.height,layerWidth:layer.width,layerHeight:layer.height,corners},check);perspectiveMasks.set(layer.id,capture);
      }
      const result=await capture.read(area);check();return result;
     }
     if(!layer.mask?.enabled||layer.mask.density===0)return undefined;check();const result=await maskService(layer.mask,spaceFor(area),maskTransform(layer.mask,world),check);check();if(!(result instanceof Float32Array)||result.length!==area.width*area.height)throw new Error('Float mask coverage differs from its working window.');for(const value of result)if(!Number.isFinite(value)||value<0||value>1)throw new Error('Float mask coverage is invalid.');return result;
    };
    const tone=async(pixels:Float32Array,settings:{exposure:number;contrast:number;saturation:number})=>{
     if(settings.exposure===0&&settings.contrast===0&&settings.saturation===0)return pixels;check();const result=await this.processor.floatTone(pixels,{exposure:settings.exposure,contrast:settings.contrast,saturation:settings.saturation});check();return result;
    };
    const raster=async(layer:Extract<LayerData,{kind:'raster'}>,world:AffineTransform,area:FloatSourceWindow=bounds):Promise<Float32Array>=>{
     const source=sources.get(layer.assetId)!,placement=renderTransform(full,world).multiply(AffineTransform.scale(layer.width/source.source.width,layer.height/source.source.height));
     const effects=layer.effects.filter(effect=>effect.enabled&&(effect.exposure!==0||effect.contrast!==0||effect.saturation!==0)),adjusted:FloatWindowSource=effects.length?{width:source.source.width,height:source.source.height,readWindow:async(region,control)=>{let pixels:Float32Array=await source.source.readWindow(region,control);for(const effect of effects)pixels=await tone(pixels,effect);return pixels;}}:source.source;
     if(activePerspective(layer.perspective)){
      const original=adjusted,worldToNative=AffineTransform.scale(source.source.width/layer.width,source.source.height/layer.height);
      const content:FloatWindowSource={width:original.width,height:original.height,readWindow:async(region,readControl)=>{
       let pixels:Float32Array=await original.readWindow(region,readControl);check();
       for(const entry of layer.erasures??[]){
        const coverage=new Float32Array(region.width*region.height);
        for(let y=0;y<region.height;y+=512)for(let x=0;x<region.width;x+=512){
         const width=Math.min(512,region.width-x),height=Math.min(512,region.height-y),alpha=await maskService({kind:'raster-erasures',width:layer.width,height:layer.height,erasures:[entry],enabled:true,inverted:false,density:1},{x:region.x+x,y:region.y+y,width,height,sx:1,sy:1},worldToNative,check);check();
         for(let row=0;row<height;row++)coverage.set(alpha.subarray(row*width,(row+1)*width),(y+row)*region.width+x);
        }
        pixels=await applyFloatCoverage(pixels,coverage,check);
       }
       return pixels;
      }};
      const corners=perspectiveLocalQuad(layer.width,layer.height,layer.perspective).map(p=>world.point(p)) as unknown as import('../core/projective').ProjectiveQuad;
      return projectPerspectiveWindow(content,this.processor,corners,area,{signal:control.signal,isCancelled:()=>{check();return false;}});
     }
     let pixels=await projectFloatWindow(adjusted,placement,area,{signal:control.signal,isCancelled:()=>{check();return false;}});
     // Capture dimensions belong to each authored stroke; later raster resizing
     // changes coverage placement without changing the original source geometry.
     for(const entry of layer.erasures??[]){
      check();const coverage=await maskService({kind:'raster-erasures',width:layer.width,height:layer.height,erasures:[entry],enabled:true,inverted:false,density:1},spaceFor(area),world,check);check();
      pixels=await applyFloatCoverage(pixels,coverage,check);
     }
     return pixels;
    };
    const paint=async(layers:LayerData[],initial:Float32Array,parent:AffineTransform,clippingMembers=false,area:FloatSourceWindow=bounds):Promise<Float32Array>=>{
     let backdrop=initial;
     const stacks=clippingMembers?layers.map(base=>({base,layers:[]as LayerData[]})):clippingStacks(layers);
     for(const stack of stacks){
      const layer=stack.base,clipped=stack.layers.filter(member=>member.visible&&member.opacity>0);
      check();if(!layer.visible||layer.opacity===0)continue;const world=parent.multiply(localTransform(layer)),coverage=await mask(layer,world,area),opacity=layer.opacity*(layer.fillOpacity??1),mode=layer.blendMode==='pass-through'?'normal':layer.blendMode;
      const shadow=layer.styles?.dropShadow,activeShadow=!!shadow?.enabled&&shadow.opacity>0;
      // Only an unmodified native raster has no remaining color/geometry work
      // whose validation could fail before zero Fill/mask coverage is applied.
      // Groups, tone effects, erasures and general affine projections keep the
      // complete intrinsic path, including hidden-color/overflow validation.
      let directRaster=false;
      if(activeShadow&&layer.kind==='raster'&&!activePerspective(layer.perspective)&&!layer.erasures?.length&&!layer.effects.some(effect=>effect.enabled&&(effect.exposure!==0||effect.contrast!==0||effect.saturation!==0))){
       const source=sources.get(layer.assetId)!.source,placement=renderTransform(full,world).multiply(AffineTransform.scale(layer.width/source.width,layer.height/source.height));
       directRaster=placement.a===1&&placement.b===0&&placement.c===0&&placement.d===1&&Number.isSafeInteger(placement.e)&&Number.isSafeInteger(placement.f);
      }
      const composite:PixelProcessor['floatComposite']=async(source,backdrop,options)=>{
       try{return await this.processor.floatComposite(source,backdrop,options);}
       catch(error){if(error instanceof Error&&error.message.startsWith('This blend mode requires normalized RGB'))throw new Error(`${layer.name} (${mode}): ${error.message}`);throw error;}
      };
      const readIntrinsic=async(region:FloatSourceWindow):Promise<Float32Array>=>{
       check();validateWindow(region);
       if(layer.kind==='raster')return raster(layer,world,region);
       if(layer.kind==='group')return paint(layer.children,new Float32Array(region.width*region.height*4),world,false,region);
       throw new Error('A shadow requires intrinsic artwork pixels.');
      };
      const compositeStyled=async(pixels:Float32Array|undefined,fill:number):Promise<Float32Array>=>{
       if(!activeShadow){if(!pixels)throw new Error('Float foreground pixels are missing.');const styled=await applyFloatStyle(layer,pixels,backdrop,coverage,this.processor,check);return composite(styled.pixels,backdrop,{mode,opacity:layer.opacity*fill,mask:styled.mask});}
       const field=await renderFloatShadow(area,shadow!,async region=>{
        if(directRaster){const coverage=await mask(layer,world,region);if(coverage&&!coverage.some(value=>value!==0)){check();return new Float32Array(region.width*region.height);}return floatAlphaPlane(await readIntrinsic(region),coverage,check);}
        const intrinsic=await readIntrinsic(region),coverage=await mask(layer,world,region);return floatAlphaPlane(intrinsic,coverage,check);
       },this.processor,check,{store:shadowCache,key:layer.id});check();
       let appearance:Float32Array;
       if(fill===0){
        // Foreground alpha is exactly zero. Intrinsic operations above/at the
        // call site still validate unless the original native raster is direct.
        // Normal zero-over is exact identity, including hidden backdrop words.
        if(mode==='normal'&&!field.some((value,index)=>index%4===3&&value!==0)){check();return backdrop;}
        appearance=field;
       }else{
        if(!pixels)throw new Error('Float foreground pixels are missing.');const foreground=await fillFloatCoverage(pixels,coverage,fill,check),overlay=await applyFloatStyle(layer,foreground,backdrop,undefined,this.processor,check,'overlay');
        appearance=await this.processor.floatComposite(overlay.pixels,field,{mode:'normal'});check();
       }
       const gated=await applyFloatStyle(layer,appearance,backdrop,undefined,this.processor,check,'blend-if');
       return composite(gated.pixels,backdrop,{mode,opacity:layer.opacity,mask:gated.mask});
      };
      if(clipped.length){
       // A pass-through base supplies isolated intrinsic coverage; member
       // pass-through groups still see this stack's working color plane.
       const intrinsic=layer.kind==='raster'||layer.kind==='group'?await readIntrinsic(area):null;
       if(!intrinsic)throw new Error('A clipping base requires intrinsic pixels.');
       const prepared=await prepareFloatClipping(intrinsic,layer.fillOpacity??1,check),colors=await paint(clipped,prepared.plane,parent,true,area),pixels=await restoreFloatClipping(colors,prepared.shape,check);
       backdrop=await compositeStyled(pixels,1);
      }else if(layer.kind==='group'){
       if(layer.blendMode==='pass-through'){
        if(layer.opacity===1&&!coverage)backdrop=await paint(layer.children,backdrop,world,false,area);
        else{const after=await paint(layer.children,backdrop.slice(),world,false,area);backdrop=await interpolateFloatBackdrops(backdrop,after,layer.opacity,coverage,check);}
       }else{const pixels=await readIntrinsic(area);backdrop=await compositeStyled(pixels,layer.fillOpacity??1);}
      }else if(layer.kind==='raster'){
       const fill=layer.fillOpacity??1,pixels=directRaster&&fill===0?undefined:await raster(layer,world,area);check();backdrop=await compositeStyled(pixels,fill);
      }else if(layer.kind==='adjustment'&&layer.adjustment.kind==='tonal'){
       let after=backdrop;
       for(const {brush,...options} of layer.adjustment.strokes){
        check();if(!strokeService)throw new Error('Float tonal rendering requires native brush coverage.');
        const coverage=await strokeService(brush,spaceFor(area),world,check);check();after=await applyFloatTonal(after,coverage,options,area.width,area.height,this.processor,check);check();
       }
       const styled=await applyFloatStyle(layer,after,backdrop,coverage,this.processor,check);backdrop=await blendFloatAdjustment(backdrop,styled.pixels,mode,opacity,styled.mask,{floatComposite:composite},check);
      }else if(layer.kind==='adjustment'&&(layer.adjustment.kind==='tone'||layer.adjustment.kind==='curves'||layer.adjustment.kind==='levels'||layer.adjustment.kind==='white-balance'||isFloatColorAdjustment(layer.adjustment)||layer.adjustment.kind==='gradient-map'||layer.adjustment.kind==='lut')){
       check();const after=layer.adjustment.kind==='tone'?await tone(backdrop,layer.adjustment):layer.adjustment.kind==='white-balance'?await balance(layer.id,backdrop):isFloatColorAdjustment(layer.adjustment)?await this.processor.floatColor(backdrop,layer.adjustment):layer.adjustment.kind==='gradient-map'?await this.processor.floatGradient(backdrop,layer.adjustment):layer.adjustment.kind==='lut'?await lookups.get(layer.id)!.apply(backdrop):await this.processor.floatTransfer(backdrop,layer.adjustment);check();const styled=await applyFloatStyle(layer,after,backdrop,coverage,this.processor,check);backdrop=await blendFloatAdjustment(backdrop,styled.pixels,mode,opacity,styled.mask,{floatComposite:composite},check);
      }else throw new Error('Unsupported float scene layer.');
     }
     check();return backdrop;
    };
    const output=await paint(document.children,new Float32Array(bounds.width*bounds.height*4),root);check();validateFloatWorkerWindow(output);return output as Float32Array<ArrayBuffer>;
   };
   const nativeRead=async(input:FloatSourceWindow):Promise<Float32Array<ArrayBuffer>>=>{
    check();const bounds=validateWindow(input);
    if(bounds.width<=2048&&bounds.height<=2048)return compose(bounds);
    // Wide/tall valid windows must not become a single coverage canvas. These
    // are allocation tiles, independent of original/artboard dimensions.
    const output=new Float32Array(bounds.width*bounds.height*4);
    for(let y=0;y<bounds.height;y+=128)for(let x=0;x<bounds.width;x+=2048){
     check();const width=Math.min(2048,bounds.width-x),height=Math.min(128,bounds.height-y),pixels=await compose({x:bounds.x+x,y:bounds.y+y,width,height});check();
     for(let row=0;row<height;row++)output.set(pixels.subarray(row*width*4,(row+1)*width*4),((y+row)*bounds.width+x)*4);
    }
    check();return output;
   };
   const nativeSource:FloatWindowSource={width:document.width,height:document.height,readWindow:nativeRead};
   return{document,signal:abort.signal,check,dispose,read:async(bounds,frame)=>{
    check();return frame?projectFloatFrame(nativeSource,bounds,frame,{signal:abort.signal,isCancelled:()=>{check();return false;}}):nativeRead(bounds);
   }};
  }catch(error){dispose();throw error;}
 }
}
