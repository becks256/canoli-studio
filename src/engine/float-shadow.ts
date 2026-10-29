import{compileFloatShadow,validateFloatAlpha}from'../core/float-shadow';
import type{LayerStyleData}from'../core/drawing';
import{validateWindow,type FloatSourceWindow}from'../core/float-source/types';
import type{PixelProcessor}from'./processor';
import{yieldTask}from'../core/task-yield';

/** Capture-local native alpha fields. Never stores authored/source color data. */
export class FloatShadowCache{
 private values=new Map<string,Float32Array>();private bytes=0;
 constructor(private readonly budget=16*1024*1024){}
 get(key:string){const value=this.values.get(key);if(value){this.values.delete(key);this.values.set(key,value);}return value;}
 set(key:string,value:Float32Array){if(value.byteLength>this.budget)return;const previous=this.values.get(key);if(previous){this.bytes-=previous.byteLength;this.values.delete(key);}this.values.set(key,value);this.bytes+=value.byteLength;while(this.bytes>this.budget){const oldest=this.values.keys().next().value!,old=this.values.get(oldest)!;this.values.delete(oldest);this.bytes-=old.byteLength;}}
 clear(){this.values.clear();this.bytes=0;}
}

/** Root-plane three-sigma Gaussian, then fractional offset sampling. Source
 * callbacks include intrinsic alpha/mask, excluding own Fill/styles/opacity.
 * Adaptive source bands and separate alpha planes bound every native request. */
export async function renderFloatShadow(input:FloatSourceWindow,settings:LayerStyleData['dropShadow'],source:(bounds:FloatSourceWindow)=>Promise<Float32Array>,processor:Pick<PixelProcessor,'floatConvolveAlpha'>,check:()=>void,cache?:{store:FloatShadowCache;key:string}):Promise<Float32Array<ArrayBuffer>>{
 check();const bounds=validateWindow(input),shadow=compileFloatShadow(settings),output=new Float32Array(bounds.width*bounds.height*4);
 if(!shadow.enabled||shadow.opacity===0)return output;
 const radius=shadow.radius;
 // Coalesce ordinary viewports instead of repeating source/worker round trips
 // for four small tiles. Even the complete vertical alpha input stays bounded:
 // edge * (edge + 2*radius) <= the existing 262144-sample wire budget.
 const edge=Math.floor(Math.sqrt(radius*radius+262144)-radius),tileWidth=edge-(Number.isInteger(shadow.x)?0:1),tileHeight=edge-(Number.isInteger(shadow.y)?0:1);
 for(let ty=0;ty<bounds.height;ty+=tileHeight)for(let tx=0;tx<bounds.width;tx+=tileWidth){
  check();const width=Math.min(tileWidth,bounds.width-tx),height=Math.min(tileHeight,bounds.height-ty),x=bounds.x+tx-shadow.x,y=bounds.y+ty-shadow.y,left=Math.floor(x),top=Math.floor(y),fx=x-left,fy=y-top,w=width+(fx!==0?1:0),h=height+(fy!==0?1:0),region={x:left,y:top,width:w,height:h};validateWindow(region);
  const key=JSON.stringify([cache?.key,shadow.blur,region]);let field=cache?.store.get(key);
  if(!field){
   if(radius===0){field=await source(region);check();validateFloatAlpha(field,w*h);}
   else{
    const horizontal=new Float32Array(w*(h+2*radius)),inputWidth=w+2*radius,bandRows=Math.max(1,Math.floor(262144/inputWidth));
    for(let row=0;row<h+2*radius;row+=bandRows){
     check();const rows=Math.min(bandRows,h+2*radius-row),area=validateWindow({x:left-radius,y:top-radius+row,width:inputWidth,height:rows}),alpha=await source(area);check();validateFloatAlpha(alpha,inputWidth*rows);
     // Positive normalized convolution cannot create coverage from a zero plane.
     // Validate the complete input before omitting otherwise redundant IPC/work.
     if(!alpha.some(value=>value!==0))continue;
     const filtered=await processor.floatConvolveAlpha(alpha,{width:inputWidth,height:rows,sigma:shadow.blur,axis:'horizontal'});check();validateFloatAlpha(filtered,w*rows);horizontal.set(filtered,row*w);
    }
    field=horizontal.some(value=>value!==0)?await processor.floatConvolveAlpha(horizontal,{width:w,height:h+2*radius,sigma:shadow.blur,axis:'vertical'}):new Float32Array(w*h);check();validateFloatAlpha(field,w*h);
   }
   cache?.store.set(key,field);
  }
  if(!field.some(value=>value!==0))continue;
  let deadline=performance.now()+2;
  for(let row=0;row<height;row++)for(let col=0;col<width;col++){
   let alpha=0;
   for(let dy=0;dy<(fy!==0?2:1);dy++)for(let dx=0;dx<(fx!==0?2:1);dx++)alpha+=field[(row+dy)*w+col+dx]*(dx?fx:1-fx)*(dy?fy:1-fy);
   const at=((ty+row)*bounds.width+tx+col)*4,value=Math.fround(Math.max(0,Math.min(1,alpha))*shadow.opacity);
   if(value>0){output[at]=shadow.rgb[0];output[at+1]=shadow.rgb[1];output[at+2]=shadow.rgb[2];output[at+3]=value;}
   if((col&31)===0&&performance.now()>=deadline){check();await yieldTask();check();deadline=performance.now()+2;}
  }
 }
 check();return output;
}
