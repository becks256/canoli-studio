import {AffineTransform} from '../core/affine';
import type {BrushStrokeData,FillData,Rect} from '../core/drawing';
import {strokeBounds} from '../core/drawing';
import {strokeStamps,paintStampSize,paintStampAlpha,paintStampGeometry,type PaintStampPoint} from '../core/paint-stamps';
import {createCanvas,release,applyTransform,renderTransform,canonicalCellOffset,projectedPixelOrigin,type RenderSpace} from './canvas';
import {primitiveCoverage} from './primitive-coverage';
import {blendCoveragePixel,blendCoverageInterval,gradientDither} from './paint-premultiplied';
import {checkRenderCurrent} from './render-control';
import {yieldTask} from './task-yield';

const CELL=256,WORK_PIXELS=4_000_000,WORK_EDGE=8192;
const intersects=(bounds:Rect,space:RenderSpace)=>bounds.x<space.x+space.width/space.sx&&bounds.x+bounds.width>space.x&&bounds.y<space.y+space.height/space.sy&&bounds.y+bounds.height>space.y;
const localView=(space:RenderSpace,world:AffineTransform)=>world.inverse().bounds({x:space.x,y:space.y,width:space.width/space.sx,height:space.height/space.sy});

function cellLayout(stroke:BrushStrokeData,space:RenderSpace,world:AffineTransform){
 const projection=renderTransform(space,world),radius=(stroke.kind==='pencil'?Math.SQRT2*Math.max(1,Math.round(stroke.size))/2:stroke.size/2)+1;
 let diameter=0;
 for(const copy of [new AffineTransform(),...(stroke.symmetry?.copies??[]).map(AffineTransform.fromJSON)]){
  const matrix=projection.multiply(copy);diameter=Math.max(diameter,2*radius*Math.max(Math.hypot(matrix.a,matrix.c),Math.hypot(matrix.b,matrix.d)));
 }
 // Complete contributing primitives fit inside the scratch, and its origin has
 // the same eight-pixel gradient phase as the canonical output lattice.
 const halo=Math.ceil((diameter+4)/8)*8,edge=CELL+2*halo;
 return Number.isSafeInteger(edge)&&edge<=WORK_EDGE&&edge*edge<=WORK_PIXELS?{halo,edge}:null;
}
function* cells(space:RenderSpace,halo:number){
 const offset=(origin:number,scale:number)=>canonicalCellOffset(origin,scale,CELL);
 for(let dy=offset(space.y,space.sy);dy<space.height;dy+=CELL)for(let dx=offset(space.x,space.sx);dx<space.width;dx+=CELL){
  const central={...space,x:space.x+dx/space.sx,y:space.y+dy/space.sy,width:CELL,height:CELL};
  yield{dx,dy,central,padded:{...central,x:central.x-halo/space.sx,y:central.y-halo/space.sy,width:CELL+2*halo,height:CELL+2*halo}};
 }
}

function stamp(
  context: CanvasRenderingContext2D,
  stroke: BrushStrokeData,
  point: PaintStampPoint,
) {
  const size = paintStampSize(stroke, point);
  const radius = size / 2;
  const prevAlpha = context.globalAlpha;
  const alpha = paintStampAlpha(stroke, point, prevAlpha);
  if(size<=0||alpha<=0)return;
  if (alpha !== prevAlpha) {
    context.globalAlpha = alpha;
  }
  const tip=stroke.tip||point.copy?paintStampGeometry(stroke,point):null;
  if(tip&&(point.copy||tip.rx!==tip.ry||tip.sin!==0)){
    context.save();
    try{
      context.translate(tip.cx,tip.cy);context.transform(tip.a,tip.b,tip.c,tip.d,0,0);
      const color=stroke.kind==='clone'||stroke.kind==='eraser'?'#000000':stroke.color;
      if(stroke.kind==='pencil'){context.fillStyle=color;context.fillRect(-tip.rx,-tip.ry,tip.rx*2,tip.ry*2);}
      else{
        context.scale(tip.rx,tip.ry);
        if(stroke.hardness>=0.999)context.fillStyle=color;
        else{const gradient=context.createRadialGradient(0,0,stroke.hardness,0,0,1);gradient.addColorStop(0,color);gradient.addColorStop(1,`${color}00`);context.fillStyle=gradient;}
        context.beginPath();context.arc(0,0,1,0,Math.PI*2);context.fill();
      }
    }finally{context.restore();if(alpha!==prevAlpha)context.globalAlpha=prevAlpha;}
    return;
  }
  if (stroke.kind === "pencil") {
    const width = Math.max(1, Math.round(size));
    context.fillStyle = stroke.color;
    context.fillRect(
      Math.floor(point.x - width / 2),
      Math.floor(point.y - width / 2),
      width,
      width,
    );
    if (alpha !== prevAlpha) context.globalAlpha = prevAlpha;
    return;
  }
  const color =
    stroke.kind === "clone" || stroke.kind === "eraser"
      ? "#000000"
      : stroke.color;
  if (stroke.hardness >= 0.999) context.fillStyle = color;
  else {
    const gradient = context.createRadialGradient(
      point.x,
      point.y,
      radius * stroke.hardness,
      point.x,
      point.y,
      radius,
    );
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, `${color}00`);
    context.fillStyle = gradient;
  }
  context.beginPath();
  context.arc(point.x, point.y, radius, 0, Math.PI * 2);
  context.fill();
  if (alpha !== prevAlpha) context.globalAlpha = prevAlpha;
}
function nativeStampPainter(context:CanvasRenderingContext2D,stroke:BrushStrokeData,space:RenderSpace,world:AffineTransform){
  const center=world.inverse().point({x:space.x+space.width/space.sx/2,y:space.y+space.height/space.sy/2});
  const origin={x:Math.floor(center.x/256)*256,y:Math.floor(center.y/256)*256};
  const forward=AffineTransform.translation(origin.x,origin.y),back=AffineTransform.translation(-origin.x,-origin.y);
  applyTransform(context,space,world.multiply(forward));
  const copies=new Map<AffineTransform,AffineTransform>(),local:PaintStampPoint={x:0,y:0,pressure:1};
  return(point:PaintStampPoint)=>{
    local.x=point.x-origin.x;local.y=point.y-origin.y;local.pressure=point.pressure;local.tilt=point.tilt;
    if(point.copy){let copy=copies.get(point.copy);if(!copy){copy=back.multiply(point.copy).multiply(forward);copies.set(point.copy,copy);}local.copy=copy;}
    else local.copy=undefined;
    stamp(context,stroke,local);
  };
}

/** One bounded scratch, shared by cold replay and the raw active viewport. */
export class RawStrokeCoverage {
 static retainedBytes(stroke:BrushStrokeData,space:RenderSpace,world:AffineTransform){const layout=cellLayout(stroke,space,world);return layout?layout.edge*layout.edge*4:0;}
 private scratch:HTMLCanvasElement|null=null;
 private cell(edge:number){
  if(!this.scratch||this.scratch.width!==edge||this.scratch.height!==edge){this.dispose();this.scratch=createCanvas(edge,edge);}
  const context=this.scratch.getContext('2d')!;context.resetTransform();context.globalAlpha=1;context.globalCompositeOperation='source-over';context.clearRect(0,0,edge,edge);return this.scratch;
 }
 canUseNative(stroke:BrushStrokeData,space:RenderSpace,world:AffineTransform){return cellLayout(stroke,space,world)!==null;}
 dispose(){if(this.scratch)release(this.scratch);this.scratch=null;}
 draw(stroke:BrushStrokeData,target:HTMLCanvasElement,space:RenderSpace,world:AffineTransform,from=0,cooperative=true,isCancelled?:()=>boolean):void|Promise<void>{
  space={...space};const width=target.width,height=target.height,parentCancelled=isCancelled;
  isCancelled=()=>target.width!==width||target.height!==height||!!parentCancelled?.();
  checkRenderCurrent(isCancelled);if(from>=stroke.points.length)return;
  const layout=cellLayout(stroke,space,world);
  if(!layout)return this.numericalStroke(stroke,target,space,world,from,isCancelled);
  const iterator=this.nativeCells(stroke,target,space,world,from,layout,cooperative,isCancelled);
  const advance=():void|Promise<void>=>{
   try{for(let step=iterator.next();!step.done;step=iterator.next())return step.value.then(advance,error=>{iterator.return(undefined);throw error;});}
   catch(error){iterator.return(undefined);throw error;}
  };
  return advance();
 }
 private *nativeCells(stroke:BrushStrokeData,target:HTMLCanvasElement,space:RenderSpace,world:AffineTransform,from:number,layout:{halo:number;edge:number},cooperative:boolean,isCancelled?:()=>boolean):Generator<Promise<void>,void>{
  const changed=from?{...stroke,points:stroke.points.slice(Math.max(0,from-1))}:stroke,bounds=world.bounds(strokeBounds(changed)),output=target.getContext('2d')!;
  let deadline=performance.now()+2;
  for(const frame of cells(space,layout.halo)){
   checkRenderCurrent(isCancelled);if(!intersects(bounds,frame.central))continue;
   const canvas=this.cell(layout.edge),context=canvas.getContext('2d')!;
   if(from){
    const left=Math.max(0,frame.dx),top=Math.max(0,frame.dy),right=Math.min(space.width,frame.dx+CELL),bottom=Math.min(space.height,frame.dy+CELL);
    if(right>left&&bottom>top){context.imageSmoothingEnabled=false;context.drawImage(target,left,top,right-left,bottom-top,layout.halo+left-frame.dx,layout.halo+top-frame.dy,right-left,bottom-top);}
   }
   const paint=nativeStampPainter(context,stroke,frame.padded,world),view={...frame.central,x:frame.central.x-2/space.sx,y:frame.central.y-2/space.sy,width:CELL+4,height:CELL+4};
   let count=0;
   for(const point of strokeStamps(stroke,localView(view,world),from)){
    paint(point);
    if(cooperative&&++count%32===0&&performance.now()>=deadline){yield yieldTask();checkRenderCurrent(isCancelled);deadline=performance.now()+2;}
   }
   output.save();try{
    output.resetTransform();output.globalAlpha=1;output.globalCompositeOperation='copy';output.imageSmoothingEnabled=false;
    output.beginPath();output.rect(frame.dx,frame.dy,CELL,CELL);output.clip();
    output.drawImage(canvas,layout.halo,layout.halo,CELL,CELL,frame.dx,frame.dy,CELL,CELL);
   }finally{output.restore();}
   if(cooperative&&performance.now()>=deadline){yield yieldTask();checkRenderCurrent(isCancelled);deadline=performance.now()+2;}
  }
 }
 fill(stroke:FillData,target:HTMLCanvasElement,space:RenderSpace,world:AffineTransform,isCancelled?:()=>boolean):void|Promise<void>{
  space={...space};const targetWidth=target.width,targetHeight=target.height,parentCancelled=isCancelled;
  isCancelled=()=>target.width!==targetWidth||target.height!==targetHeight||!!parentCancelled?.();
  checkRenderCurrent(isCancelled);const bounds=stroke.bounds;if(bounds.width<=0||bounds.height<=0)return;
  const frame=renderTransform(space,world).multiply(new AffineTransform(bounds.width/2,0,0,bounds.height/2,bounds.x+bounds.width/2,bounds.y+bounds.height/2));
  const output=target.getContext('2d')!;
  if(frame.b===0&&frame.c===0){
   const left=Math.max(0,frame.e-Math.abs(frame.a)),top=Math.max(0,frame.f-Math.abs(frame.d)),right=Math.min(space.width,frame.e+Math.abs(frame.a)),bottom=Math.min(space.height,frame.f+Math.abs(frame.d));
   if(right>left&&bottom>top){output.save();try{output.resetTransform();output.fillStyle=stroke.color;output.fillRect(left,top,right-left,bottom-top);}finally{output.restore();}}
   return;
  }
  const extent=frame.bounds({x:-1,y:-1,width:2,height:2}),left=Math.floor(extent.x)-2,top=Math.floor(extent.y)-2,width=Math.ceil(extent.x+extent.width)-left+2,height=Math.ceil(extent.y+extent.height)-top+2;
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width>WORK_EDGE||height>WORK_EDGE||width*height>WORK_PIXELS)
   return this.numericalPrimitive(output,frame,true,1,stroke.color,1,space,isCancelled);
  const canvas=createCanvas(width,height),context=canvas.getContext('2d')!;
  try{
   context.setTransform(frame.a,frame.b,frame.c,frame.d,frame.e-left,frame.f-top);context.fillStyle=stroke.color;context.fillRect(-1,-1,2,2);
   output.save();try{output.resetTransform();output.globalAlpha=1;output.globalCompositeOperation='source-over';output.imageSmoothingEnabled=false;output.drawImage(canvas,left,top);}finally{output.restore();}
  }finally{release(canvas);}
 }
 private async numericalStroke(stroke:BrushStrokeData,target:HTMLCanvasElement,space:RenderSpace,world:AffineTransform,from:number,isCancelled?:()=>boolean){
  const projection=renderTransform(space,world),output=target.getContext('2d')!,color=stroke.kind==='clone'||stroke.kind==='eraser'?'#000000':stroke.color;
  const view={...space,x:space.x-2/space.sx,y:space.y-2/space.sy,width:space.width+4,height:space.height+4};
  const budget={deadline:performance.now()+2};
  for(const point of strokeStamps(stroke,localView(view,world),from)){
   checkRenderCurrent(isCancelled);const g=paintStampGeometry(stroke,point),flow=paintStampAlpha(stroke,point);
   if(g.rx<=0||g.ry<=0||flow<=0)continue;
   const frame=projection.multiply(new AffineTransform(g.a*g.rx,g.b*g.rx,g.c*g.ry,g.d*g.ry,g.cx,g.cy));
   await this.numericalPrimitive(output,frame,stroke.kind==='pencil',stroke.hardness,color,flow,space,isCancelled,budget);
   if(performance.now()>=budget.deadline){await yieldTask();checkRenderCurrent(isCancelled);budget.deadline=performance.now()+2;}
  }
 }
 private async numericalPrimitive(output:CanvasRenderingContext2D,frame:AffineTransform,pencil:boolean,hardness:number,color:string,flow:number,space:RenderSpace,isCancelled?:()=>boolean,budget={deadline:performance.now()+2}){
  const fillSolid=(left:number,top:number,width:number,height:number)=>{
   if(width<=0||height<=0)return;
   output.save();try{output.resetTransform();output.globalCompositeOperation='source-over';output.globalAlpha=1;output.fillStyle=color;output.fillRect(left,top,width,height);}finally{output.restore();}
  };
  if(pencil&&flow===1&&frame.b===0&&frame.c===0&&frame.a!==0&&frame.d!==0){
   const left=Math.max(0,frame.e-Math.abs(frame.a)),top=Math.max(0,frame.f-Math.abs(frame.d)),right=Math.min(space.width,frame.e+Math.abs(frame.a)),bottom=Math.min(space.height,frame.f+Math.abs(frame.d));
   // Integer clipped rectangles contain only full/empty pixels. Native opaque
   // fill overwrites exactly the same bytes as numerical source-over.
   if([left,top,right,bottom].every(Number.isSafeInteger)){checkRenderCurrent(isCancelled);fillSolid(left,top,right-left,bottom-top);return;}
  }
  const coverage=primitiveCoverage(frame,pencil,hardness),soft=!pencil&&hardness<.999,shape=soft?primitiveCoverage(frame,false,1):null;
  const extent=frame.bounds({x:-1,y:-1,width:2,height:2}),left=Math.max(0,Math.floor(extent.x)),top=Math.max(0,Math.floor(extent.y)),right=Math.min(space.width,Math.ceil(extent.x+extent.width)),bottom=Math.min(space.height,Math.ceil(extent.y+extent.height));
  const rgb=[1,3,5].map(start=>parseInt(color.slice(start,start+2),16)),phaseX=Math.floor(projectedPixelOrigin(space.x,space.sx))%8,phaseY=Math.floor(projectedPixelOrigin(space.y,space.sy))%8;
  for(let y=top;y<bottom;y+=8){
   checkRenderCurrent(isCancelled);const height=Math.min(8,bottom-y);
   let solidLeft=left,solidRight=right;
   if(flow===1)for(let row=y;row<y+height;row++){
    const span=coverage.solidSpan(row,left,right);
    if(!span){solidRight=solidLeft;break;}
    solidLeft=Math.max(solidLeft,span[0]);solidRight=Math.min(solidRight,span[1]);
   }
   else solidRight=solidLeft;
   // Proven full coverage with unit flow writes opaque integer RGB. Ordered
   // noise is less than half a byte, so the stored result is exactly color.
   const segments=solidLeft<solidRight?[[left,solidLeft],[solidRight,right]]:[[left,right]];
   if(solidLeft<solidRight)fillSolid(solidLeft,y,solidRight-solidLeft,height);
   for(const [start,end]of segments)for(let x=start;x<end;x+=256){
   checkRenderCurrent(isCancelled);const width=Math.min(256,end-x),pixels=output.getImageData(x,y,width,height);
   for(let py=0;py<height;py++)for(let px=0;px<width;px++){
    const gx=x+px,gy=y+py,range=soft?coverage.interval(gx,gy):null;
    if(range&&blendCoverageInterval(pixels.data,(py*width+px)*4,rgb,range[0],range[1],flow,gradientDither(gx+phaseX,gy+phaseY)))continue;
    const alpha=coverage(gx,gy);if(!Number.isFinite(alpha))throw new Error('Primitive coverage exceeds working pixel precision.');if(alpha<=0)continue;
    const dither=shape?gradientDither(gx+phaseX,gy+phaseY)*shape(gx,gy):0;
    blendCoveragePixel(pixels.data,(py*width+px)*4,rgb,alpha,flow,dither);
   }
   output.putImageData(pixels,x,y);
   if(performance.now()>=budget.deadline){await yieldTask();checkRenderCurrent(isCancelled);budget.deadline=performance.now()+2;}
   }
   if(performance.now()>=budget.deadline){await yieldTask();checkRenderCurrent(isCancelled);budget.deadline=performance.now()+2;}
  }
 }
}
