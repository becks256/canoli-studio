import {createCanvas,release} from './canvas';
import {checkRenderCurrent} from './render-control';
import {yieldTask} from './task-yield';

/** Composite a clipping stack in an opaque color plane, then apply the base's
 * original alpha once. Repeated destination-in per member darkens soft edges.
 * The returned owned coverage also supplies the base's pre-fill shadow shape.
 */
export async function composeClippingStack(
  base:HTMLCanvasElement,
  fillOpacity:number,
  paint:(colorPlane:HTMLCanvasElement)=>Promise<void>,
  isCancelled?:()=>boolean,
):Promise<HTMLCanvasElement>{
  const coverage=createCanvas(base.width,base.height),context=base.getContext('2d')!;
  let retained=false;
  try{
    checkRenderCurrent(isCancelled);coverage.getContext('2d')!.drawImage(base,0,0);
    let deadline=performance.now()+6,occupied=false;
    for(let y=0;y<base.height;y+=512)for(let x=0;x<base.width;x+=512){
      checkRenderCurrent(isCancelled);
      const image=context.getImageData(x,y,Math.min(512,base.width-x),Math.min(512,base.height-y));
      let tileOccupied=false;
      for(let i=3;i<image.data.length;i+=4)if(image.data[i]){image.data[i]=255;tileOccupied=true;}
      if(tileOccupied){context.putImageData(image,x,y);occupied=true;}
      if(performance.now()>=deadline){await yieldTask();deadline=performance.now()+6;}
    }
    if(fillOpacity!==1){context.save();try{context.globalCompositeOperation='destination-in';context.globalAlpha=fillOpacity;context.fillStyle='#fff';context.fillRect(0,0,base.width,base.height);}finally{context.restore();}}
    if(occupied)await paint(base);checkRenderCurrent(isCancelled);
    context.save();try{context.globalCompositeOperation='destination-in';context.drawImage(coverage,0,0);}finally{context.restore();}
    retained=true;return coverage;
  }finally{if(!retained)release(coverage);}
}
