import {isImmutable,freeze} from '../core/immutable';
import {paintOperationSchema} from '../core/drawing';
import {AffineTransform} from '../core/affine';
import {captureAssetSource,isFloatAsset,type AssetStore} from '../core/assets';
import {captureFieldBounds} from '../core/projective-field';
import {perspectiveLocalQuad} from '../core/perspective';
import type {ProjectiveQuad} from '../core/projective';
import {validateWetField} from '../core/wet-field';
import {validateWetPaintTile,type WetAssetProvider} from '../core/wet-assets';
import type {WetPaintStrokeData} from '../core/wet-operation';
import {projectPerspectiveFieldWindow,type ProjectiveFieldSource} from './projective-field';
import {createCanvas,release,renderTransform,type RenderSpace} from './canvas';
import type {PixelProcessor} from './processor';
import {checkRenderCurrent} from './render-control';
import {yieldTask} from '../core/task-yield';

/** Pull the coupled prepared field into the existing native content lattice.
 * The original grid, complete finite field and homography stay fixed across
 * viewport/crop partitions. No image-quad clipping or pointer-only inversion. */
export async function compositeProjectedWetPaint(
 stroke:WetPaintStrokeData,assets:AssetStore,target:HTMLCanvasElement,space:RenderSpace,world:AffineTransform,
 processor:PixelProcessor,provider:WetAssetProvider,isCancelled?:()=>boolean,
){
 stroke=isImmutable(stroke)?stroke:freeze(paintOperationSchema.parse(stroke))as WetPaintStrokeData;space={...space};
 const targetWidth=target.width,targetHeight=target.height;
 const placement=stroke.placement;if(!placement)throw new Error('Missing placed wet mapping.');
 const alive=assets.captureLifetime(),pins=new Map<string,ReturnType<typeof captureAssetSource>>();
 for(const tile of stroke.tiles)for(const id of[tile.assetId,tile.coverage.assetId])if(!pins.has(id)){
  const pin=captureAssetSource(assets,id);if(isFloatAsset(pin.asset))throw new Error('Prepared wet fields require original byte PNG pixels.');pins.set(id,pin);
 }
 const check=()=>{checkRenderCurrent(isCancelled);if(target.width!==targetWidth||target.height!==targetHeight)throw new Error('Placed wet target changed during rendering.');alive();provider.check?.();for(const pin of pins.values())pin.check();};
 check();for(const tile of stroke.tiles){await validateWetPaintTile(tile,provider);check();}
 let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
 for(const tile of stroke.tiles){left=Math.min(left,tile.x);top=Math.min(top,tile.y);right=Math.max(right,tile.x+tile.width);bottom=Math.max(bottom,tile.y+tile.height);}
 const bounds=captureFieldBounds({x:left,y:top,width:right-left,height:bottom-top}),native=AffineTransform.fromJSON(stroke.nativeTransform),inverseNative=native.inverse();
 const frame=renderTransform(space,world),linear=new AffineTransform(frame.a,frame.b,frame.c,frame.d).inverse();
 const width=Math.ceil(placement.width),height=Math.ceil(placement.height);
 const input=AffineTransform.scale(width/placement.width,height/placement.height).multiply(AffineTransform.fromJSON(placement.basis)).multiply(linear);
 const corners=perspectiveLocalQuad(placement.width,placement.height,placement.perspective).map(p=>inverseNative.point(p))as unknown as ProjectiveQuad;
 let deadline=performance.now()+2;
 const source:ProjectiveFieldSource={width,height,channels:5,bounds,background:0,direction:'source-to-quad',input:{origin:{x:frame.e,y:frame.f},matrix:input.toJSON()},
  readWindow:async area=>{
   check();const output=new Float32Array(area.width*area.height*5);
   // Source windows may be long and narrow. Bound Canvas edges independently
   // of the complete original/prepared field and its native working ROI.
   for(let y=area.y;y<area.y+area.height;y+=256)for(let x=area.x;x<area.x+area.width;x+=256){
    check();const w=Math.min(256,area.x+area.width-x),h=Math.min(256,area.y+area.height-y);
    const color=createCanvas(w,h,true),coverage=createCanvas(w,h,true);
    try{
     const c=color.getContext('2d')!,m=coverage.getContext('2d')!;
     for(const tile of stroke.tiles){
      if(tile.x+tile.width<=x||tile.y+tile.height<=y||tile.x>=x+w||tile.y>=y+h)continue;
      const mask=pins.get(tile.coverage.assetId)!.asset.bitmap,image=pins.get(tile.assetId)!.asset.bitmap;
      c.globalCompositeOperation='destination-out';c.drawImage(mask,tile.x-x,tile.y-y);
      c.globalCompositeOperation='lighter';c.drawImage(image,tile.x-x,tile.y-y);
      m.drawImage(mask,tile.x-x,tile.y-y);
     }
     const rgba=c.getImageData(0,0,w,h).data,alpha=m.getImageData(0,0,w,h).data;
     for(let row=0;row<h;row++)for(let col=0;col<w;col++){
      const from=(row*w+col)*4,to=((y-area.y+row)*area.width+x-area.x+col)*5,a=rgba[from+3]/255;
      output[to]=rgba[from]/255*a;output[to+1]=rgba[from+1]/255*a;output[to+2]=rgba[from+2]/255*a;output[to+3]=a;output[to+4]=alpha[from+3]/255;
     }
    }finally{release(color);release(coverage);}
    if(performance.now()>=deadline){await yieldTask();check();deadline=performance.now()+2;}
   }
   check();validateWetField(output,area.width*area.height);return output;
  },
 };
 const context=target.getContext('2d')!;
 for(let y=0;y<target.height;y+=512)for(let x=0;x<target.width;x+=512){
  const w=Math.min(512,target.width-x),h=Math.min(512,target.height-y),field=await projectPerspectiveFieldWindow(source,processor,corners,{x,y,width:w,height:h},{isCancelled:()=>{check();return false;}});check();
  let changed=false;for(let i=4;i<field.length;i+=5)if(field[i]){changed=true;break;}if(!changed)continue;
  const raw=createCanvas(w,h,true),mask=createCanvas(w,h,true),replacement=createCanvas(w,h,true);
  try{
   const c=raw.getContext('2d')!,m=mask.getContext('2d')!,p=replacement.getContext('2d')!,colors=p.createImageData(w,h),coverage=m.createImageData(w,h);
   for(let i=0;i<w*h;i++){
    const a=field[i*5+3],at=i*4;colors.data[at+3]=Math.round(a*255);coverage.data[at+3]=Math.round(field[i*5+4]*255);
    for(let channel=0;channel<3;channel++)colors.data[at+channel]=a?Math.round(field[i*5+channel]/a*255):0;
   }
   p.putImageData(colors,0,0);m.putImageData(coverage,0,0);c.drawImage(target,x,y,w,h,0,0,w,h);
   const before=stroke.opacity===1?undefined:c.getImageData(0,0,w,h).data;
   c.globalCompositeOperation='destination-out';c.drawImage(mask,0,0);c.globalCompositeOperation='lighter';c.drawImage(replacement,0,0);
   if(before){
    const after=c.getImageData(0,0,w,h).data,amount=new Uint8ClampedArray(after.length);for(let i=0;i<amount.length;i+=4)if(before[i]!==after[i]||before[i+1]!==after[i+1]||before[i+2]!==after[i+2]||before[i+3]!==after[i+3])amount[i+3]=Math.round(stroke.opacity*255);
    const pixels=await processor.mixFiltered(before,after,amount);check();const image=c.createImageData(w,h);image.data.set(pixels);context.putImageData(image,x,y);
   }else context.putImageData(c.getImageData(0,0,w,h),x,y);
  }finally{release(raw);release(mask);release(replacement);}
  if(performance.now()>=deadline){await yieldTask();check();deadline=performance.now()+2;}
 }
 check();
}
