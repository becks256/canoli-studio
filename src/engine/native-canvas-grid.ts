import {canonicalCellOffset,createCanvas,release,type RenderSpace} from './canvas';
import type {Rect} from '../core/drawing';

export interface NativeCanvasCell {x:number;y:number;space:RenderSpace}
/** Preserve complete small footprints; larger requests crop fixed, full native
 * cells. Neither viewport clipping nor an export strip changes rasterization. */
export class NativeCanvasGrid {
 readonly canvas:HTMLCanvasElement;
 private readonly context:CanvasRenderingContext2D;
 private readonly complete:Rect|undefined;
 constructor(private readonly output:CanvasRenderingContext2D,private readonly space:RenderSpace,footprint?:Rect){
  if(footprint){
   const ox=canonicalCellOffset(space.x,space.sx,256),oy=canonicalCellOffset(space.y,space.sy,256);
   const x=ox+Math.floor((footprint.x-2-ox)/256)*256,y=oy+Math.floor((footprint.y-2-oy)/256)*256;
   const right=ox+Math.ceil((footprint.x+footprint.width+2-ox)/256)*256,bottom=oy+Math.ceil((footprint.y+footprint.height+2-oy)/256)*256;
   const width=right-x,height=bottom-y;
   if([x,y,right,bottom,width,height].every(Number.isSafeInteger)&&width>0&&height>0&&width+4<=8192&&height+4<=8192&&(width+4)*(height+4)<=4_000_000)this.complete={x,y,width,height};
  }
  this.canvas=createCanvas((this.complete?.width??256)+4,(this.complete?.height??256)+4);this.context=this.canvas.getContext('2d')!;this.context.imageSmoothingEnabled=output.imageSmoothingEnabled;this.context.imageSmoothingQuality=output.imageSmoothingQuality;
 }
 *cells(bounds?:Rect):Generator<NativeCanvasCell>{
  const s=this.space,full=this.complete;
  if(full){
   if(full.x+full.width<=0||full.y+full.height<=0||full.x>=s.width||full.y>=s.height)return;
   this.context.resetTransform();this.context.clearRect(0,0,this.canvas.width,this.canvas.height);
   yield{x:full.x,y:full.y,space:{...s,x:s.x+(full.x-2)/s.sx,y:s.y+(full.y-2)/s.sy,width:this.canvas.width,height:this.canvas.height}};return;
  }
  for(let y=canonicalCellOffset(s.y,s.sy,256);y<s.height;y+=256)for(let x=canonicalCellOffset(s.x,s.sx,256);x<s.width;x+=256){
   if(bounds&&(x+256<=bounds.x||y+256<=bounds.y||x>=bounds.x+bounds.width||y>=bounds.y+bounds.height))continue;
   this.context.resetTransform();this.context.clearRect(0,0,260,260);
   yield{x,y,space:{...s,x:s.x+(x-2)/s.sx,y:s.y+(y-2)/s.sy,width:260,height:260}};
  }
 }
 present(cell:NativeCanvasCell){
  const c=this.output,width=cell.space.width-4,height=cell.space.height-4;c.save();try{c.resetTransform();c.drawImage(this.canvas,2,2,width,height,cell.x,cell.y,width,height);}finally{c.restore();}
 }
 dispose(){release(this.canvas);}
}
