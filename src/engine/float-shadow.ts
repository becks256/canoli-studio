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
 * Narrow source bands and separate alpha planes bound every native request. */
export async function renderFloatShadow(input:FloatSourceWindow,settings:LayerStyleData['dropShadow'],source:(bounds:FloatSourceWindow)=>Promise<Float32Array>,processor:Pick<PixelProcessor,'floatConvolveAlpha'>,check:()=>void,cache?:{store:FloatShadowCache;key:string}):Promise<Float32Array<ArrayBuffer>>{
 check();const bounds=validateWindow(input),shadow=compileFloatShadow(settings),output=new Float32Array(bounds.width*bounds.height*4);
 if(!shadow.enabled||shadow.opacity===0)return output;
 const radius=shadow.radius;
 for(let ty=0;ty<bounds.height;ty+=128)for(let tx=0;tx<bounds.width;tx+=128){
  check();const width=Math.min(128,bounds.width-tx),height=Math.min(128,bounds.height-ty),x=bounds.x+tx-shadow.x,y=bounds.y+ty-shadow.y,left=Math.floor(x),top=Math.floor(y),fx=x-left,fy=y-top,w=width+(fx!==0?1:0),h=height+(fy!==0?1:0),region={x:left,y:top,width:w,height:h};validateWindow(region);
  const key=JSON.stringify([cache?.key,shadow.blur,region]);let field=cache?.store.get(key);
  if(!field){
   if(radius===0){field=await source(region);check();validateFloatAlpha(field,w*h);}
   else{
    const horizontal=new Float32Array(w*(h+2*radius)),inputWidth=w+2*radius;
    for(let row=0;row<h+2*radius;row+=32){
     check();const rows=Math.min(32,h+2*radius-row),area=validateWindow({x:left-radius,y:top-radius+row,width:inputWidth,height:rows}),alpha=await source(area);check();validateFloatAlpha(alpha,inputWidth*rows);
     const filtered=await processor.floatConvolveAlpha(alpha,{width:inputWidth,height:rows,sigma:shadow.blur,axis:'horizontal'});check();validateFloatAlpha(filtered,w*rows);horizontal.set(filtered,row*w);
    }
    field=await processor.floatConvolveAlpha(horizontal,{width:w,height:h+2*radius,sigma:shadow.blur,axis:'vertical'});check();validateFloatAlpha(field,w*h);
   }
   cache?.store.set(key,field);
  }
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
