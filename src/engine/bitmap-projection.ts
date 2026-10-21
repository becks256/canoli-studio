import {AffineTransform} from '../core/affine';
import type {Rect} from '../core/drawing';
import {createCanvas,release} from './canvas';
import {primitiveCoverage} from './primitive-coverage';
import {checkRenderCurrent} from './render-control';
import {yieldTask} from './task-yield';

type Bitmap = ImageBitmap | HTMLCanvasElement;
export interface BitmapProjectionControl {
  signal?: AbortSignal;
  isCancelled?(): boolean;
}

/** This selects a precision fallback, never an image/document geometry limit.
 * Float32 projected coordinates beyond this range cannot retain subpixel edges. */
export function bitmapProjectionRequiresPrecision(matrix:AffineTransform,width:number,height:number):boolean {
  return [matrix.e,matrix.f,matrix.a*width,matrix.b*width,matrix.c*height,matrix.d*height]
    .some(value=>Math.abs(value)>2**20);
}

/** Native captures remain small even for anisotropic maps with huge source ROIs. */
class NativePixels {
  private tiles=new Map<string,{pixels:Uint8ClampedArray;width:number}>();
  private scratch:HTMLCanvasElement|undefined;
  readonly width:number;
  readonly height:number;
  constructor(readonly bitmap:ImageBitmap,private check:()=>void,private owned=false) {
    this.width=bitmap.width;this.height=bitmap.height;
    if(!Number.isSafeInteger(this.width)||!Number.isSafeInteger(this.height)||this.width<1||this.height<1)
      throw new Error('Bitmap projection requires a live native source.');
  }
  static async capture(source:Bitmap,check:()=>void){
    check();
    if(source instanceof ImageBitmap)return new NativePixels(source,check);
    // createImageBitmap captures mutable canvas pixels at invocation, before yielding.
    const bitmap=await createImageBitmap(source);
    try{check();return new NativePixels(bitmap,check,true);}catch(error){bitmap.close();throw error;}
  }
  private tile(x:number,y:number){
    const left=Math.floor(x/64)*64,top=Math.floor(y/64)*64,key=`${left},${top}`;
    let tile=this.tiles.get(key);
    if(tile){this.tiles.delete(key);this.tiles.set(key,tile);return tile;}
    this.check();
    const width=Math.min(64,this.width-left),height=Math.min(64,this.height-top);
    if(!this.scratch)this.scratch=createCanvas(64,64,true);
    const c=this.scratch.getContext('2d')!;c.clearRect(0,0,64,64);
    c.drawImage(this.bitmap,left,top,width,height,0,0,width,height);
    tile={pixels:c.getImageData(0,0,width,height).data,width};
    if(this.tiles.size>=64)this.tiles.delete(this.tiles.keys().next().value!);
    this.tiles.set(key,tile);this.check();return tile;
  }
  sample(u:number,v:number,smoothing:boolean,coverage:number,output:Uint8ClampedArray,index:number){
    u=Math.max(0,Math.min(this.width,u));v=Math.max(0,Math.min(this.height,v));
    const px=u-.5,py=v-.5,left=Math.floor(px),top=Math.floor(py),fx=px-left,fy=py-top;
    let r=0,g=0,b=0,a=0;
    for(let dy=0;dy<(smoothing?2:1);dy++)for(let dx=0;dx<(smoothing?2:1);dx++){
      const x=Math.max(0,Math.min(this.width-1,smoothing?left+dx:Math.floor(u))),
        y=Math.max(0,Math.min(this.height-1,smoothing?top+dy:Math.floor(v))),
        weight=smoothing?(dx?fx:1-fx)*(dy?fy:1-fy):1;
      if(!weight)continue;
      const tile=this.tile(x,y),offset=((y%64)*tile.width+x%64)*4,alpha=tile.pixels[offset+3];
      // Recover the source's actual premultiplied bytes before filtering.
      a+=alpha*weight;r+=Math.round(tile.pixels[offset]*alpha/255)*weight;g+=Math.round(tile.pixels[offset+1]*alpha/255)*weight;b+=Math.round(tile.pixels[offset+2]*alpha/255)*weight;
    }
    const storedAlpha=Math.round(a*coverage);
    const channel=(premultiplied:number)=>storedAlpha?Math.round(Math.min(storedAlpha,Math.round(premultiplied*coverage))*255/storedAlpha):0;
    output[index]=channel(r);output[index+1]=channel(g);output[index+2]=channel(b);output[index+3]=storedAlpha;
  }
  dispose(){this.tiles.clear();if(this.scratch)release(this.scratch);if(this.owned)this.bitmap.close();}
}

function projectionCheck(bitmap:Bitmap,control:BitmapProjectionControl){
  const width=bitmap.width,height=bitmap.height;
  return()=>{
    control.signal?.throwIfAborted();checkRenderCurrent(control.isCancelled);
    if(!width||!height||bitmap.width!==width||bitmap.height!==height)throw new Error('Bitmap source changed during projection.');
  };
}

async function pixels(source:NativePixels,matrix:AffineTransform,region:Rect,smoothing:boolean,supportOnly:boolean,check:()=>void):Promise<ImageData>{
  check();const {x,y,width,height}=region;
  if(![x,y,width,height,x+width,y+height].every(Number.isSafeInteger)||width<1||height<1||width*height>4_000_000||width>8192||height>8192)
    throw new Error('Bitmap projection requires a bounded integer working region.');
  const inverse=matrix.inverse(),result=new ImageData(width,height);
  const corners=[matrix.point({x:0,y:0}),matrix.point({x:source.width,y:0}),matrix.point({x:0,y:source.height}),matrix.point({x:source.width,y:source.height})];
  const left=Math.min(...corners.map(p=>p.x)),right=Math.max(...corners.map(p=>p.x)),top=Math.min(...corners.map(p=>p.y)),bottom=Math.max(...corners.map(p=>p.y));
  const axis=(matrix.b===0&&matrix.c===0)||(matrix.a===0&&matrix.d===0);
  const center=matrix.point({x:source.width/2,y:source.height/2});
  const area=axis?undefined:primitiveCoverage({a:matrix.a*source.width/2,b:matrix.b*source.width/2,c:matrix.c*source.height/2,d:matrix.d*source.height/2,e:center.x,f:center.y},true,1);
  let deadline=performance.now()+2,count=0;
  for(let row=0;row<height;row++)for(let column=0;column<width;column++){
    const ox=x+column,oy=y+row,cx=ox+.5,cy=oy+.5;
    // Canvas axis-aligned image rectangles snap half-pixel ties upward. Affine
    // edges use their actual pixel area rather than an enormous Canvas quad.
    const coverage=axis?Number(cx>left&&cx<=right&&cy>top&&cy<=bottom):area!(ox,oy);
    if(coverage>0){
      const index=(row*width+column)*4;
      if(supportOnly){result.data[index]=result.data[index+1]=result.data[index+2]=255;result.data[index+3]=Math.round(255*coverage);}
      else{
        const dx=cx-matrix.e,dy=cy-matrix.f;
        source.sample(inverse.a*dx+inverse.c*dy,inverse.b*dx+inverse.d*dy,smoothing,coverage,result.data,index);
      }
    }
    if((++count&31)===0&&performance.now()>=deadline){check();await yieldTask();check();deadline=performance.now()+2;}
  }
  check();return result;
}

/** Double-precision point sampling with bounded native reads. Native bitmap
 * pixels stay asset-owned; the returned RGBA region belongs to this caller. */
export async function projectBitmapPixels(bitmap:Bitmap,matrix:AffineTransform,region:Rect,smoothing=true,control:BitmapProjectionControl={},supportOnly=false):Promise<ImageData>{
  const check=projectionCheck(bitmap,control);check();const source=await NativePixels.capture(bitmap,check);
  try{return await pixels(source,matrix,region,smoothing,supportOnly,check);}finally{source.dispose();}
}

/** Keep the exact existing Canvas path for ordinary projections. Very enlarged
 * quads use small output patches and private native reads, never source resizing. */
export async function drawProjectedBitmap(context:CanvasRenderingContext2D,bitmap:Bitmap,matrix:AffineTransform,control:BitmapProjectionControl={}):Promise<void>{
  const check=projectionCheck(bitmap,control);check();
  if(!bitmapProjectionRequiresPrecision(matrix,bitmap.width,bitmap.height)){
    context.save();try{context.setTransform(matrix.a,matrix.b,matrix.c,matrix.d,matrix.e,matrix.f);context.drawImage(bitmap,0,0);}finally{context.restore();}return;
  }
  const smoothing=context.imageSmoothingEnabled,source=await NativePixels.capture(bitmap,check);let patch:HTMLCanvasElement|undefined;
  try{
    patch=createCanvas(256,128,true);const c=patch.getContext('2d')!;
    for(let y=0;y<context.canvas.height;y+=128)for(let x=0;x<context.canvas.width;x+=256){
      check();const width=Math.min(256,context.canvas.width-x),height=Math.min(128,context.canvas.height-y),image=await pixels(source,matrix,{x,y,width,height},smoothing,false,check);
      c.clearRect(0,0,256,128);c.putImageData(image,0,0);check();context.save();
      try{context.resetTransform();context.beginPath();context.rect(x,y,width,height);context.clip();context.drawImage(patch,x,y);}finally{context.restore();}
    }
  }finally{if(patch)release(patch);source.dispose();}
}
