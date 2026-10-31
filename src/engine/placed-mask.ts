import {strokeBounds} from '../core/drawing';
import {maskMappedBrushMapping} from '../core/mask-plane-brush';
import {pullMaskPlaneThrough,affineMaskPose} from '../core/mask-plane';
import {projectMappedFieldWindow} from './projective-field';
import {checkRenderCurrent} from './render-control';
import type {FieldMapping} from '../core/mapped-field';
import {AffineTransform} from '../core/affine';
import type {AssetStore} from '../core/assets';
import {maskStrokeSchema,type MaskOperationData,type MaskPerspectivePlacementData} from '../core/masks';
import {freeze} from '../core/immutable';
import {perspectiveLocalQuad} from '../core/perspective';
import type {PixelProcessor} from './processor';
import type {BrushTextureSampler} from './brush-texture';
import {capturePerspectiveMask,type CapturedPerspectiveMask} from './projective-mask';
import {createCanvas,release,renderTransform,type RenderSpace} from './canvas';
import {yieldTask} from '../core/task-yield';

/** Request-owned original-mask fields. Placed brush support may pull back to an
 * unbounded region; never clip it to the image frame or a guessed rectangle. */
export class PlacedMaskCaptures {
 private entries=new Map<object,{capture:CapturedPerspectiveMask;placement:MaskPerspectivePlacementData;mode:'hide'|'reveal'}>();
 private mapped=new Map<object,{capture:CapturedPerspectiveMask;mapping:FieldMapping;mode:'hide'|'reveal'}>();
 constructor(private assets:AssetStore,private processor:PixelProcessor,private textures?:BrushTextureSampler,private isCancelled?:()=>boolean){}
 async draw(input:MaskOperationData,target:HTMLCanvasElement,space:RenderSpace,world:AffineTransform){
  if(input.mode==='wet'||!input.placement)throw new Error('Placed mask painting requires brush coverage.');
  if('geometry'in input.placement)return this.drawMapped(input,target,space,world);
  let owned=this.entries.get(input);
  if(!owned){
   const entry=freeze(maskStrokeSchema.parse(input)),p=entry.placement!;if('geometry'in p)throw new Error('Unexpected mapped mask placement.');const width=Math.ceil(p.width),height=Math.ceil(p.height);
   const capture=capturePerspectiveMask({kind:'paint',base:0,enabled:true,inverted:false,density:1,strokes:[{mode:'reveal',stroke:entry.stroke}]},
    {sourceWidth:width,sourceHeight:height,layerWidth:p.width,layerHeight:p.height,corners:perspectiveLocalQuad(width,height,p.perspective),direction:'source-to-quad'},this.assets,this.processor,{isCancelled:this.isCancelled},this.textures);
   owned={capture,placement:p,mode:entry.mode};this.entries.set(input,owned);
  }
  const captured=owned.capture,p=owned.placement,frame=renderTransform(space,world),linear=new AffineTransform(frame.a,frame.b,frame.c,frame.d).inverse();
  const mapping=AffineTransform.scale(Math.ceil(p.width)/p.width,Math.ceil(p.height)/p.height).multiply(AffineTransform.fromJSON(p.basis)).multiply(linear);
  const canvas=createCanvas(space.width,space.height,true);
  try{
   const c=canvas.getContext('2d')!,inputMapping={origin:{x:frame.e,y:frame.f},matrix:mapping.toJSON()};let deadline=performance.now()+2;
   for(let y=0;y<space.height;y+=512)for(let x=0;x<space.width;x+=512){
    const width=Math.min(512,space.width-x),height=Math.min(512,space.height-y),alpha=await captured.read({x,y,width,height},inputMapping),image=c.createImageData(width,height);
    for(let i=0;i<alpha.length;i++){
     image.data[i*4]=image.data[i*4+1]=image.data[i*4+2]=255;image.data[i*4+3]=Math.round(alpha[i]*255);
     if((i&127)===0&&performance.now()>=deadline){captured.check();await yieldTask();captured.check();deadline=performance.now()+2;}
    }
    captured.check();c.putImageData(image,x,y);
   }
   captured.check();const context=target.getContext('2d')!;context.save();
   try{context.resetTransform();context.globalAlpha=1;context.globalCompositeOperation=owned.mode==='hide'?'destination-out':'source-over';context.drawImage(canvas,0,0);}finally{context.restore();}
  }finally{release(canvas);}
 }
 private async drawMapped(input:MaskOperationData,target:HTMLCanvasElement,space:RenderSpace,world:AffineTransform){
  let owned=this.mapped.get(input);
  if(!owned){
   if(input.mode==='wet')throw new Error('Mapped brush coverage requires a brush.');const entry=freeze(maskStrokeSchema.parse(input)),p=entry.placement!;if(!('geometry'in p))throw new Error('Missing mapped mask placement.');
   const width=Math.ceil(p.width),height=Math.ceil(p.height),mapping=maskMappedBrushMapping(p,strokeBounds(entry.stroke)).mapping;
   const capture=capturePerspectiveMask({kind:'paint',base:0,enabled:true,inverted:false,density:1,linked:false,basis:AffineTransform.scale(width/p.width,height/p.height).toJSON(),strokes:[{mode:'reveal',stroke:entry.stroke}]},
    {sourceWidth:width,sourceHeight:height,layerWidth:p.width,layerHeight:p.height,corners:[{x:0,y:0},{x:width,y:0},{x:width,y:height},{x:0,y:height}]},this.assets,this.processor,{isCancelled:this.isCancelled},this.textures);
   owned={capture,mapping,mode:entry.mode};this.mapped.set(input,owned);
  }
  const capture=owned.capture,mapping=pullMaskPlaneThrough(owned.mapping,{pose:affineMaskPose(renderTransform(space,world)),inverse:false}),targetWidth=target.width,targetHeight=target.height;
  const check=()=>{capture.check();checkRenderCurrent(this.isCancelled);if(target.width!==targetWidth||target.height!==targetHeight)throw new Error('Mapped mask target changed during rendering.');};
  const source={bounds:capture.unbounded?undefined:capture.bounds,background:0,readWindow:async(b:import('../core/float-source/types').FloatSourceWindow)=>{check();const alpha=await capture.read(b);check();return alpha;}},canvas=createCanvas(space.width,space.height,true);
  try{
   const c=canvas.getContext('2d')!;
   for(let y=0;y<space.height;y+=512)for(let x=0;x<space.width;x+=512){
    check();const width=Math.min(512,space.width-x),height=Math.min(512,space.height-y),alpha=await projectMappedFieldWindow(source,this.processor,mapping,{x,y,width,height},{isCancelled:()=>{check();return false;}}),image=c.createImageData(width,height);
    for(let i=0;i<alpha.length;i++){image.data[i*4]=image.data[i*4+1]=image.data[i*4+2]=255;image.data[i*4+3]=Math.round(alpha[i]*255);}check();c.putImageData(image,x,y);
   }
   check();const c2=target.getContext('2d')!;c2.save();try{c2.resetTransform();c2.globalAlpha=1;c2.globalCompositeOperation=owned.mode==='hide'?'destination-out':'source-over';c2.drawImage(canvas,0,0);}finally{c2.restore();}
  }finally{release(canvas);}
 }
 dispose(){for(const entry of this.entries.values())entry.capture.dispose();this.entries.clear();for(const entry of this.mapped.values())entry.capture.dispose();this.mapped.clear();}
}
