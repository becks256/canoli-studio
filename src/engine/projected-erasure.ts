import {AffineTransform} from '../core/affine';
import {rasterErasureSchema,type RasterErasureData} from '../core/drawing';
import {freeze} from '../core/immutable';
import type {AssetStore} from '../core/assets';
import {perspectiveLocalQuad} from '../core/perspective';
import {captureFieldBounds} from '../core/projective-field';
import type {ProjectiveQuad} from '../core/projective';
import {validateWindow} from '../core/float-source/types';
import {capturePerspectiveMask} from './projective-mask';
import {projectPerspectiveFieldWindow,type ProjectiveFieldSource} from './projective-field';
import {createCanvas,release,renderTransform,type RenderSpace} from './canvas';
import type {PixelProcessor} from './processor';
import type {BrushTextureSampler} from './brush-texture';
import type {FloatProjectionControl} from './float-projection';
import {yieldTask} from '../core/task-yield';

export interface CapturedProjectedErasure {
  check():void;
  read(space:RenderSpace,world:AffineTransform,width:number,height:number):Promise<Float32Array>;
  dispose():void;
}

/** Request-owned leases; no global cache of document strokes or asset pins. */
export class ProjectedErasureCaptures {
  private entries=new Map<object,CapturedProjectedErasure>();
  constructor(private assets:AssetStore,private processor:PixelProcessor,private control:FloatProjectionControl={},private textures?:BrushTextureSampler){}
  get(entry:RasterErasureData,key:object=entry){let found=this.entries.get(key);if(!found){found=captureProjectedErasure(entry,this.assets,this.processor,this.control,this.textures);this.entries.set(key,found);}return found;}
  dispose(){for(const capture of this.entries.values())capture.dispose();this.entries.clear();}
}

/** Placed coverage is authored on a fixed, captured layer-pixel lattice. First
 * pull its complete coverage through the captured H onto the original plane;
 * only then sample that field through the current size/affine placement. Neither
 * a subsequent perspective edit nor a different viewport retargets the stroke.
 * Ceil gives fractional layer dimensions a deterministic pixel grid without an
 * asset store in isolated scripts or headless construction. No full grid is
 * allocated: both transports read bounded native windows. */
export function captureProjectedErasure(input:RasterErasureData,assets:AssetStore,processor:PixelProcessor,control:FloatProjectionControl={},textures?:BrushTextureSampler):CapturedProjectedErasure {
  const entry=freeze(rasterErasureSchema.parse(input)),placement=entry.placement;
  if(!placement||(entry.stroke.kind!=='eraser'&&!(entry.stroke.kind==='fill'&&entry.stroke.erase)))throw new Error('Projected erasure requires captured eraser or clear placement.');
  const width=Math.ceil(entry.width),height=Math.ceil(entry.height),sx=width/entry.width,sy=height/entry.height;
  const footprint=AffineTransform.scale(sx,sy).bounds(placement.bounds),x=Math.floor(footprint.x),y=Math.floor(footprint.y);
  const bounds=captureFieldBounds({x,y,width:Math.ceil(footprint.x+footprint.width)-x,height:Math.ceil(footprint.y+footprint.height)-y});
  const raw:import('../core/masks').LayerMaskData=entry.stroke.kind==='eraser'
    ?{kind:'paint',base:1,enabled:true,inverted:false,density:1,strokes:[{mode:'hide',stroke:{...entry.stroke,kind:'brush'}}]}
    :{kind:'raster-erasures',width:entry.width,height:entry.height,enabled:true,inverted:false,density:1,erasures:[{width:entry.width,height:entry.height,stroke:entry.stroke}]};
  const captured=capturePerspectiveMask(raw,
    {sourceWidth:width,sourceHeight:height,layerWidth:entry.width,layerHeight:entry.height,corners:perspectiveLocalQuad(width,height,placement.perspective),direction:'source-to-quad'},assets,processor,control,textures);
  const source:ProjectiveFieldSource={width,height,bounds,background:1,readWindow:async input=>{
    captured.check();const area=validateWindow(input),out=new Float32Array(area.width*area.height).fill(1);
    const left=Math.max(area.x,bounds.x),top=Math.max(area.y,bounds.y),right=Math.min(area.x+area.width,bounds.x+bounds.width),bottom=Math.min(area.y+area.height,bounds.y+bounds.height);
    if(right>left&&bottom>top){
      const pixels=await captured.read({x:left,y:top,width:right-left,height:bottom-top});captured.check();
      for(let row=0;row<bottom-top;row++)out.set(pixels.subarray(row*(right-left),(row+1)*(right-left)),(top-area.y+row)*area.width+left-area.x);
    }
    return out;
  }};
  return {check:()=>captured.check(),read:async(space,world,currentWidth,currentHeight)=>{
    captured.check();const mapping=renderTransform(space,world).multiply(AffineTransform.scale(currentWidth/width,currentHeight/height));
    const corners=[{x:0,y:0},{x:width,y:0},{x:width,y:height},{x:0,y:height}].map(p=>mapping.point(p)) as unknown as ProjectiveQuad;
    const output=await projectPerspectiveFieldWindow(source,processor,corners,{x:0,y:0,width:space.width,height:space.height},control);captured.check();return output;
  },dispose:()=>captured.dispose()};
}

/** Byte compositor rounds only after transporting the captured coverage. */
export async function drawProjectedErasure(captured:CapturedProjectedErasure,target:HTMLCanvasElement,space:RenderSpace,world:AffineTransform,width:number,height:number):Promise<void>{
  const coverage=await captured.read(space,world,width,height),mask=createCanvas(space.width,space.height,true);
  try{
    const c=mask.getContext('2d')!,image=c.createImageData(space.width,space.height);
    let deadline=performance.now()+2;
    for(let i=0;i<coverage.length;i++){
      image.data[i*4]=image.data[i*4+1]=image.data[i*4+2]=255;image.data[i*4+3]=Math.round(coverage[i]*255);
      if((i&127)===0&&performance.now()>=deadline){captured.check();await yieldTask();captured.check();deadline=performance.now()+2;}
    }
    captured.check();c.putImageData(image,0,0);
    const context=target.getContext('2d')!;context.save();try{context.resetTransform();context.globalAlpha=1;context.globalCompositeOperation='destination-in';context.drawImage(mask,0,0);}finally{context.restore();}
  }finally{release(mask);}
}
