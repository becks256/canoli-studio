import {AffineTransform} from '../core/affine';
import {freeze} from '../core/immutable';
import {captureAssetSource,isFloatAsset,type AssetStore} from '../core/assets';
import {visitMaskAssets} from '../core/asset-references';
import {layerMaskSchema,type LayerMaskData} from '../core/masks';
import {compileMaskPlane,maskPlaneDisplaySteps,type MaskPlanePoseData} from '../core/mask-plane';
import {maskFieldGeometry} from '../core/mask-field';
import {captureFieldBounds} from '../core/projective-field';
import {validateWindow,type FloatSourceWindow} from '../core/float-source/types';
import {validateFloatAlpha} from '../core/float-shadow';
import {projectMappedFieldWindow,type MappedFieldSource} from './projective-field';
import {featherFloatMask} from './float-mask-feather';
import type {FloatProjectionControl} from './float-projection';
import type {PixelProcessor} from './processor';
import {BrushTextureSampler} from './brush-texture';
import {PlacedMaskCaptures} from './placed-mask';
import {maskCoverage} from './masks';
import {paintedMask} from './drawing';
import {createCanvas,release,type RenderSpace} from './canvas';
import {perspectiveMaskView} from './perspective-view';
import {checkRenderCurrent} from './render-control';
import {yieldTask} from '../core/task-yield';

export interface MaskPlaneCaptureOptions {filterMask?:boolean;documentTransform?:AffineTransform;nativeTarget?:boolean;rootTransform?:AffineTransform}
export interface CapturedMaskPlane {
 readonly mask:LayerMaskData;readonly bounds:Readonly<FloatSourceWindow>;readonly unbounded:boolean;readonly background:number;
 check():void;read(bounds:FloatSourceWindow,settings?:boolean):Promise<Float32Array<ArrayBuffer>>;dispose():void;
}
/** Render retained native coverage through one composed scalar pull mapping.
 * Native filter planes retain their original pre-projection byte feather phase;
 * ordinary document planes feather after transport in document pixels. */
export function captureMaskPlane(input:LayerMaskData,owner:MaskPlanePoseData,assets:AssetStore,processor:PixelProcessor,control:FloatProjectionControl={},options:MaskPlaneCaptureOptions={},textures?:BrushTextureSampler):CapturedMaskPlane {
 const mask=freeze(layerMaskSchema.parse(input)),plane=mask.plane;
 if(!plane)throw new Error('A retained mask plane is required.');
 if(options.nativeTarget&&plane.phase!=='native')throw new Error('Document-phase filter masks must mix after image projection.');
 const pins=new Map<string,ReturnType<typeof captureAssetSource>>();
 visitMaskAssets(mask,({assetId},role)=>{
  let pin=pins.get(assetId);if(!pin){pin=captureAssetSource(assets,assetId);pins.set(assetId,pin);}
  if(role!=='geometry'&&isFloatAsset(pin.asset))throw new Error('Mask pixels require native byte sources; a float thumbnail is display-only.');
 });
 const reference=plane.reference.kind==='asset'?pins.get(plane.reference.assetId)!.asset:plane.reference;
 const independent=mask.linked===false,post=options.nativeTarget&&!independent?undefined:options.documentTransform;
 const steps=maskPlaneDisplaySteps(mask,owner,!!options.filterMask,post);
 if(options.nativeTarget){
  const nativeOwner=independent&&options.rootTransform?{...owner,transform:options.rootTransform.multiply(AffineTransform.fromJSON(owner.transform)).toJSON()}:owner;
  steps.push({pose:nativeOwner,inverse:true});
 }
 const compiled=compileMaskPlane(plane,reference,steps),basis=compiled.basis;
 const {plane:_plane,x:_x,y:_y,basis:_basis,placedX:_px,placedY:_py,...geometryMask}=mask;
 const nativeFeather=plane.phase==='native'?(mask.feather??0):0;
 const raw=freeze({...geometryMask,x:0,y:0,linked:true,feather:nativeFeather,inverted:false,density:1})as LayerMaskData;
 const bitmap=mask.kind==='bitmap'?pins.get(mask.assetId)!.asset.bitmap:undefined;
 const geometry=maskFieldGeometry(raw,basis,bitmap),halo=3*Math.ceil(nativeFeather/3),bounds=Object.freeze(captureFieldBounds({x:geometry.bounds.x-halo,y:geometry.bounds.y-halo,width:geometry.bounds.width+halo*2,height:geometry.bounds.height+halo*2}));
 const sample=createCanvas(1,1,true);let background:number;
 try{const c=sample.getContext('2d')!;c.globalAlpha=geometry.background;c.fillStyle='#fff';c.fillRect(0,0,1,1);background=Math.fround(c.getImageData(0,0,1,1).data[3]/255);}finally{release(sample);}
 const lifetime=assets.captureLifetime(),signal=control.signal,isCancelled=control.isCancelled;let closed=false;
 const ownTextures=textures?undefined:new BrushTextureSampler(processor,4*1024*1024),sampler=textures??ownTextures!;
 const check=()=>{signal?.throwIfAborted();checkRenderCurrent(isCancelled);if(closed)throw new Error('Retained mask-plane capture is closed.');lifetime();for(const pin of pins.values())pin.check();};
 const placed=mask.strokes?.some(entry=>entry.mode!=='wet'&&entry.placement)?new PlacedMaskCaptures(assets,processor,sampler,()=>{check();return false;}):undefined;
 const readRaw=async(input:FloatSourceWindow):Promise<Float32Array<ArrayBuffer>>=>{
  check();const area=validateWindow(input),out=new Float32Array(area.width*area.height).fill(background);
  const left=geometry.unbounded?area.x:Math.max(area.x,bounds.x),top=geometry.unbounded?area.y:Math.max(area.y,bounds.y),right=geometry.unbounded?area.x+area.width:Math.min(area.x+area.width,bounds.x+bounds.width),bottom=geometry.unbounded?area.y+area.height:Math.min(area.y+area.height,bounds.y+bounds.height);let deadline=performance.now()+2;
  for(let y=top;y<bottom;y+=512)for(let x=left;x<right;x+=512){
   check();const width=Math.min(512,right-x),height=Math.min(512,bottom-y),space={x,y,width,height,sx:1,sy:1};
   const canvas=placed&&!nativeFeather?await paintedMask(raw,space,basis.e,basis.f,processor,basis,bitmap,assets,sampler,()=>{check();return false;},false,placed):await maskCoverage(raw,space,basis.e,basis.f,processor,undefined,basis,bitmap,assets,sampler,()=>{check();return false;});
   try{check();const bytes=canvas.getContext('2d')!.getImageData(0,0,width,height).data;for(let row=0;row<height;row++)for(let col=0;col<width;col++)out[(y-area.y+row)*area.width+x-area.x+col]=bytes[(row*width+col)*4+3]/255;}finally{release(canvas);}
   if(performance.now()>=deadline){await yieldTask();check();deadline=performance.now()+2;}
  }
  check();validateFloatAlpha(out,area.width*area.height);return out;
 };
 const source:MappedFieldSource={bounds:geometry.unbounded?undefined:bounds,background,readWindow:readRaw};
 const read=async(input:FloatSourceWindow,settings=true):Promise<Float32Array<ArrayBuffer>>=>{
  check();const area=validateWindow(input);if(!mask.enabled||settings&&mask.density===0)return new Float32Array(area.width*area.height).fill(1);
  const pull=(b:FloatSourceWindow)=>projectMappedFieldWindow(source,processor,compiled.mapping,b,{signal,isCancelled:()=>{check();return false;}});
  const alpha=plane.phase==='document'?await featherFloatMask(area,mask.feather??0,pull,processor,check):await pull(area);check();
  if(settings)for(let i=0;i<alpha.length;i++)alpha[i]=Math.max(0,Math.min(1,1-mask.density+mask.density*(mask.inverted?1-alpha[i]:alpha[i])));
  check();return alpha;
 };
 try{check();}catch(error){placed?.dispose();ownTextures?.dispose();throw error;}
 return Object.freeze({mask,bounds,unbounded:!!geometry.unbounded,background,check,read,dispose(){if(closed)return;closed=true;pins.clear();placed?.dispose();ownTextures?.dispose();}});
}

export async function maskPlaneCanvas(capture:CapturedMaskPlane,space:RenderSpace,processor:PixelProcessor,isCancelled?:()=>boolean,settings=true):Promise<HTMLCanvasElement>{
 const canvas=createCanvas(space.width,space.height,true),context=canvas.getContext('2d')!;
 try{
  for(let y=0;y<space.height;y+=512)for(let x=0;x<space.width;x+=512){
   checkRenderCurrent(isCancelled);const width=Math.min(512,space.width-x),height=Math.min(512,space.height-y),alpha=await perspectiveMaskView(b=>capture.read(b,settings),space,{x,y,width,height},processor,isCancelled);capture.check();
   const image=context.createImageData(width,height);for(let i=0;i<alpha.length;i++){image.data[i*4]=image.data[i*4+1]=image.data[i*4+2]=255;image.data[i*4+3]=Math.round(alpha[i]*255);}context.putImageData(image,x,y);
  }
  capture.check();return canvas;
 }catch(error){release(canvas);throw error;}
}
