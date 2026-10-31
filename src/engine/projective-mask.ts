import {z} from 'zod';
import {AffineTransform} from '../core/affine';
import {layerMaskSchema,maskTransform,type LayerMaskData} from '../core/masks';
import {maskFieldGeometry} from '../core/mask-field';
import {visitMaskAssets} from '../core/asset-references';
import {captureAssetSource,isFloatAsset,type AssetStore} from '../core/assets';
import {freeze} from '../core/immutable';
import {compileProjectiveField,fieldInputSchema,type ProjectiveFieldInput,type ProjectiveFieldDirection} from '../core/projective-field';
import type {ProjectiveQuad} from '../core/projective';
import {validateWindow,type FloatSourceWindow} from '../core/float-source/types';
import {validateFloatAlpha} from '../core/float-shadow';
import {projectPerspectiveFieldWindow,type ProjectiveFieldSource} from './projective-field';
import {featherFloatMask} from './float-mask-feather';
import type {FloatProjectionControl} from './float-projection';
import type {PixelProcessor} from './processor';
import {maskCoverage} from './masks';
import {paintedMask} from './drawing';
import {PlacedMaskCaptures} from './placed-mask';
import {BrushTextureSampler} from './brush-texture';
import {createCanvas,release} from './canvas';
import {checkRenderCurrent} from './render-control';
import {yieldTask} from '../core/task-yield';

const extent=z.number().int().positive().safe(),size=z.number().finite().positive().max(Number.MAX_SAFE_INTEGER);
const optionsSchema=z.object({sourceWidth:extent,sourceHeight:extent,layerWidth:size,layerHeight:size,
  corners:z.array(z.object({x:z.number().finite(),y:z.number().finite()}).strict()).length(4),direction:z.enum(['quad-to-source','source-to-quad']).optional()}).strict();
export interface PerspectiveMaskOptions {sourceWidth:number;sourceHeight:number;layerWidth:number;layerHeight:number;corners:ProjectiveQuad;direction?:ProjectiveFieldDirection}
export interface CapturedPerspectiveMask {
  readonly mask:LayerMaskData;readonly unbounded:boolean;readonly bounds:Readonly<FloatSourceWindow>;readonly background:number;
  check():void;read(bounds:FloatSourceWindow,input?:ProjectiveFieldInput):Promise<Float32Array<ArrayBuffer>>;dispose():void;
}

/** Capture existing mask geometry/assets into the original/reference pixel
 * plane. Linked fields use the selected direction of the exact image mapping;
 * unlinked fields stay in their independent plane. Reads return native output
 * coverage, with feather/settings applied after transport.
 * Private renderer adapter only; does not mutate layers or expose a script API. */
export function capturePerspectiveMask(
  input:LayerMaskData,settings:PerspectiveMaskOptions,assets:AssetStore,processor:PixelProcessor,
  control:FloatProjectionControl={},textures?:BrushTextureSampler,
):CapturedPerspectiveMask {
  const mask=freeze(layerMaskSchema.parse(input)),options=optionsSchema.parse(settings),linked=mask.linked!==false;
  const local=maskTransform(mask,new AffineTransform()),mapping=linked?AffineTransform.scale(options.sourceWidth/options.layerWidth,options.sourceHeight/options.layerHeight).multiply(local):local;
  mapping.inverse();
  const pins=new Map<string,ReturnType<typeof captureAssetSource>>();
  visitMaskAssets(mask,({assetId})=>{
    if(pins.has(assetId))return;const pin=captureAssetSource(assets,assetId);
    if(isFloatAsset(pin.asset))throw new Error('This operation requires native byte pixels. A float source thumbnail is display-only; use the float document renderer.');
    pins.set(assetId,pin);
  });
  const bitmap=mask.kind==='bitmap'?pins.get(mask.assetId)!.asset.bitmap:undefined;
  const geometry=maskFieldGeometry(mask,mapping,bitmap);
  const compiled=compileProjectiveField({sourceWidth:options.sourceWidth,sourceHeight:options.sourceHeight,direction:options.direction,corners:options.corners as unknown as ProjectiveQuad,
    field:geometry.bounds,source:{x:geometry.bounds.x,y:geometry.bounds.y,width:1,height:1},output:{x:0,y:0,width:1,height:1},background:geometry.background});
  // Match the existing byte mask rasterizer's constant alpha exactly. Using an
  // unquantized paint base outside finite support would introduce a visible seam.
  const sample=createCanvas(1,1,true);let background:number;
  try{const c=sample.getContext('2d')!;c.globalAlpha=geometry.background;c.fillStyle='#fff';c.fillRect(0,0,1,1);background=Math.fround(c.getImageData(0,0,1,1).data[3]/255);}finally{release(sample);}
  const raw=freeze({...mask,feather:0,inverted:false,density:1}),bounds=Object.freeze({...geometry.bounds});
  const lifetime=assets.captureLifetime(),signal=control.signal,isCancelled=control.isCancelled;
  let closed=false;const ownTextures=textures?undefined:new BrushTextureSampler(processor,4*1024*1024),sampler=textures??ownTextures!;
  const check=()=>{
    signal?.throwIfAborted();checkRenderCurrent(isCancelled);if(closed)throw new Error('Perspective mask capture is closed.');lifetime();
    for(const pin of pins.values()){pin.check();if(isFloatAsset(pin.asset))throw new Error('Mask source changed during projection.');}
  };
  const placed=mask.strokes?.some(entry=>entry.mode!=='wet'&&entry.placement)?new PlacedMaskCaptures(assets,processor,sampler,()=>{check();return false;}):undefined;
  const readRaw=async(input:FloatSourceWindow):Promise<Float32Array<ArrayBuffer>>=>{
    check();const area=validateWindow(input),out=new Float32Array(area.width*area.height).fill(background);
    const left=geometry.unbounded?area.x:Math.max(area.x,bounds.x),top=geometry.unbounded?area.y:Math.max(area.y,bounds.y),right=geometry.unbounded?area.x+area.width:Math.min(area.x+area.width,bounds.x+bounds.width),bottom=geometry.unbounded?area.y+area.height:Math.min(area.y+area.height,bounds.y+bounds.height);
    let deadline=performance.now()+2;
    for(let y=top;y<bottom;y+=512)for(let x=left;x<right;x+=512){
      check();const width=Math.min(512,right-x),height=Math.min(512,bottom-y);
      const space={x,y,width,height,sx:1,sy:1};
      const canvas=placed?await paintedMask(raw,space,mapping.e,mapping.f,processor,mapping,bitmap,assets,sampler,()=>{check();return false;},false,placed):await maskCoverage(raw,space,mapping.e,mapping.f,processor,undefined,mapping,bitmap,assets,sampler,()=>{check();return false;});
      try{
        check();const bytes=canvas.getContext('2d')!.getImageData(0,0,width,height).data;
        for(let row=0;row<height;row++)for(let col=0;col<width;col++)out[(y-area.y+row)*area.width+x-area.x+col]=bytes[(row*width+col)*4+3]/255;
      }finally{release(canvas);}
      if(performance.now()>=deadline){await yieldTask();check();deadline=performance.now()+2;}
    }
    check();validateFloatAlpha(out,area.width*area.height);return out;
  };
  const source:ProjectiveFieldSource={width:options.sourceWidth,height:options.sourceHeight,bounds:geometry.unbounded?undefined:bounds,background,direction:options.direction,readWindow:readRaw};
  const read=async(input:FloatSourceWindow,inputMapping?:ProjectiveFieldInput):Promise<Float32Array<ArrayBuffer>>=>{
    check();const area=validateWindow(input),current=inputMapping?{...source,input:fieldInputSchema.parse(inputMapping)}:source;
    if(!mask.enabled||mask.density===0)return new Float32Array(area.width*area.height).fill(1);
    const coverage=await featherFloatMask(area,mask.feather??0,linked?b=>projectPerspectiveFieldWindow(current,processor,compiled.options.corners,b,{signal,isCancelled:()=>{check();return false;}}):readRaw,processor,check);
    check();let deadline=performance.now()+2;
    for(let i=0;i<coverage.length;i++){
      coverage[i]=Math.max(0,Math.min(1,1-mask.density+mask.density*(mask.inverted?1-coverage[i]:coverage[i])));
      if((i&127)===0&&performance.now()>=deadline){await yieldTask();check();deadline=performance.now()+2;}
    }
    check();return coverage;
  };
  try{check();}catch(error){placed?.dispose();ownTextures?.dispose();throw error;}
  return Object.freeze({mask,bounds,unbounded:!!geometry.unbounded,background,check,read,dispose(){if(closed)return;closed=true;pins.clear();placed?.dispose();ownTextures?.dispose();}});
}
