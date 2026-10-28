import {AffineTransform, type AffineData} from '../core/affine';
import {validateWindow, type FloatSourceWindow, type FloatSourceControl} from '../core/float-source/types';
import {validateFloatWorkerWindow} from './float-pixels';
import {primitiveCoverage} from './primitive-coverage';
import {yieldTask} from '../core/task-yield';
import {checkRenderCurrent} from './render-control';

/** Caller retains the source lease for the complete operation. Reads return
 * independent original-derived float samples in the chosen common encoding. */
export interface FloatWindowSource {
  readonly width:number;
  readonly height:number;
  readWindow(bounds:FloatSourceWindow, control?:FloatSourceControl):Promise<Float32Array>;
}
export interface FloatProjectionControl {signal?:AbortSignal;isCancelled?():boolean}

/** Straight float32 output, premultiplied bilinear filtering, clamped source
 * edges and analytic transformed-rectangle coverage. Geometry/weights use f64.
 * Adaptive native ROIs bound allocation even for extremely sparse projections;
 * this budget does not constrain the source or document dimensions. */
export async function projectFloatWindow(
  source:FloatWindowSource, transform:AffineData, region:FloatSourceWindow,
  control:FloatProjectionControl={},
):Promise<Float32Array<ArrayBuffer>> {
  const bounds=validateWindow(region),matrix=AffineTransform.fromJSON(transform),inverse=matrix.inverse();
  const width=source.width,height=source.height;
  if(![width,height].every(v=>Number.isSafeInteger(v)&&v>0))throw new Error('Float projection requires complete native source geometry.');
  const check=()=>{control.signal?.throwIfAborted();checkRenderCurrent(control.isCancelled);if(source.width!==width||source.height!==height)throw new Error('Float projection source changed.');};
  check();const output=new Float32Array(bounds.width*bounds.height*4);
  // A native integer lattice needs no interpolation. This is especially common
  // while composing complete native scenes before final frame resampling.
  if(matrix.a===1&&matrix.b===0&&matrix.c===0&&matrix.d===1&&Number.isSafeInteger(matrix.e)&&Number.isSafeInteger(matrix.f)){
    const nx=bounds.x-matrix.e,ny=bounds.y-matrix.f,left=Math.max(0,nx),top=Math.max(0,ny),right=Math.min(width,nx+bounds.width),bottom=Math.min(height,ny+bounds.height);
    if(right<=left||bottom<=top)return output;
    const w=right-left,h=bottom-top,native=await source.readWindow({x:left,y:top,width:w,height:h},{signal:control.signal,onProgress:check});check();validateFloatWorkerWindow(native);
    if(native.length!==w*h*4)throw new Error('Float projection read differs from requested native geometry.');
    if(w===bounds.width)output.set(native,(top-ny)*bounds.width*4);
    else for(let row=0;row<h;row++)output.set(native.subarray(row*w*4,(row+1)*w*4),((top-ny+row)*bounds.width+left-nx)*4);
    let deadline=performance.now()+2;
    for(let at=0;at<output.length;at+=4){
      // Keep the sampler's transparent and signed-zero canonicalization. A
      // completed artboard's separate aligned-frame API retains native words.
      if(output[at+3]===0)output[at]=output[at+1]=output[at+2]=output[at+3]=0;
      else for(let c=0;c<3;c++)if(output[at+c]===0)output[at+c]=0;
      if((at&127)===0&&performance.now()>=deadline){check();await yieldTask();check();deadline=performance.now()+2;}
    }
    check();return output;
  }
  const corners=[matrix.point({x:0,y:0}),matrix.point({x:width,y:0}),matrix.point({x:width,y:height}),matrix.point({x:0,y:height})];
  const left=Math.min(...corners.map(p=>p.x)),right=Math.max(...corners.map(p=>p.x)),top=Math.min(...corners.map(p=>p.y)),bottom=Math.max(...corners.map(p=>p.y));
  const axis=matrix.b===0&&matrix.c===0||matrix.a===0&&matrix.d===0;
  const center=matrix.point({x:width/2,y:height/2});
  const area=axis?undefined:primitiveCoverage({a:matrix.a*width/2,b:matrix.b*width/2,c:matrix.c*height/2,d:matrix.d*height/2,e:center.x,f:center.y},true,1);
  const point=(x:number,y:number)=>{
    // Subtract placement before multiplication to retain large-coordinate detail.
    const dx=x-matrix.e,dy=y-matrix.f,u=inverse.a*dx+inverse.c*dy,v=inverse.b*dx+inverse.d*dy;
    if(!Number.isFinite(u)||!Number.isFinite(v))throw new Error('Float projection exceeds coordinate precision.');
    return{x:Math.max(0,Math.min(width-1,u-.5)),y:Math.max(0,Math.min(height-1,v-.5))};
  };
  let deadline=performance.now()+2;
  const render=async(x:number,y:number,w:number,h:number):Promise<void>=>{
    check();if(x>=right||x+w<=left||y>=bottom||y+h<=top)return;
    const points=[point(x+.5,y+.5),point(x+w-.5,y+.5),point(x+w-.5,y+h-.5),point(x+.5,y+h-.5)];
    const sx=Math.floor(Math.min(...points.map(p=>p.x))),sy=Math.floor(Math.min(...points.map(p=>p.y))),ex=Math.min(width,Math.floor(Math.max(...points.map(p=>p.x)))+2),ey=Math.min(height,Math.floor(Math.max(...points.map(p=>p.y)))+2);
    if((ex-sx)*(ey-sy)>262144){
      if(w>=h&&w>1){const half=Math.floor(w/2);await render(x,y,half,h);await render(x+half,y,w-half,h);}
      else if(h>1){const half=Math.floor(h/2);await render(x,y,w,half);await render(x,y+half,w,h-half);}
      else throw new Error('Float projection cannot bound a native sample footprint.');
      return;
    }
    const native=await source.readWindow({x:sx,y:sy,width:ex-sx,height:ey-sy},{signal:control.signal,onProgress:check});check();
    validateFloatWorkerWindow(native);if(native.length!==(ex-sx)*(ey-sy)*4)throw new Error('Float projection read differs from requested native geometry.');
    for(let row=y;row<y+h;row++)for(let col=x;col<x+w;col++){
      const coverage=axis?Math.max(0,Math.min(col+1,right)-Math.max(col,left))*Math.max(0,Math.min(row+1,bottom)-Math.max(row,top)):area!(col,row);
      if(coverage>0){
        const p=point(col+.5,row+.5),ix=Math.floor(p.x),iy=Math.floor(p.y),fx=p.x-ix,fy=p.y-iy;let alpha=0,r=0,g=0,b=0;
        for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){
          const weight=(dx?fx:1-fx)*(dy?fy:1-fy);if(!weight)continue;
          const nx=Math.min(width-1,ix+dx),ny=Math.min(height-1,iy+dy),at=((ny-sy)*(ex-sx)+nx-sx)*4,a=native[at+3]*weight;
          alpha+=a;r+=native[at]*a;g+=native[at+1]*a;b+=native[at+2]*a;
        }
        const at=((row-bounds.y)*bounds.width+col-bounds.x)*4;
        if(alpha>0){output[at]=r/alpha;output[at+1]=g/alpha;output[at+2]=b/alpha;output[at+3]=alpha*coverage;}
      }
      if((col&31)===0&&performance.now()>=deadline){check();await yieldTask();check();deadline=performance.now()+2;}
    }
  };
  await render(bounds.x,bounds.y,bounds.width,bounds.height);check();validateFloatWorkerWindow(output);return output;
}
