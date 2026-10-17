import { quickSelectionRequestSchema, quickSelectionSeeds, type QuickSelectionRequest, type QuickSelectionControl } from '../core/quick-selection';
import { SelectionRows } from '../core/selection-rows';
import type { SelectionData } from '../core/drawing';
import type { PixelKernel } from './wasm';

/** One owned native source plane and a byte state plane; the frontier contains runs. */
export async function growQuickSelection(kernel:PixelKernel,pixels:Uint8ClampedArray,input:QuickSelectionRequest,progress:NonNullable<QuickSelectionControl['onProgress']>=()=>{}):Promise<SelectionData>{
  const request=quickSelectionRequestSchema.parse(input),{width,height}=request,count=width*height;
  if(!Number.isSafeInteger(count)||pixels.length!==count*4||pixels.length>0x7fffffff)throw new Error('Invalid native Quick Selection source or working-buffer geometry.');
  const spans=quickSelectionSeeds(request),capacity=4096,bandSize=Math.min(count,1_000_000);
  const source=kernel.bufferOffset(),state=source+pixels.length,spanOffset=Math.ceil((state+count)/8)*8,values=spanOffset+spans.byteLength;
  const params=Math.ceil(values/8)*8,frontier=params+96,output=frontier+capacity*8,required=output+bandSize;
  try{if(required>kernel.memory.buffer.byteLength)kernel.memory.grow(Math.ceil((required-kernel.memory.buffer.byteLength)/65536));}
  catch{throw new Error('Quick Selection ran out of working memory. Try Color Range or a manual selection.');}
  new Uint8ClampedArray(kernel.memory.buffer,source,pixels.length).set(pixels);pixels=new Uint8ClampedArray(0);
  new Uint32Array(kernel.memory.buffer,spanOffset,spans.length).set(spans);
  const data=new Float64Array(kernel.memory.buffer,params,12);data.fill(0);data[6]=request.edgeThreshold;
  progress({completed:0,total:count*2});
  kernel.quickSelectionInit(source,state,count,spanOffset,spans.length/2,params,request.tolerance);
  if(!data[7])throw new Error('Paint over visible source pixels to start Quick Selection.');
  const pending:number[]=[],emitted=new Int32Array(kernel.memory.buffer,frontier,capacity*2);
  let lastProgress=performance.now();
  const process=(start:number,end:number,dy:number,force:boolean)=>{
    let cursor=start;
    while(cursor<end){
      kernel.quickSelectionSpan(source,state,count,width,cursor,end,dy,params,frontier,capacity,force);
      for(let i=0;i<data[8]*2;i++)pending.push(emitted[i]);
      if(data[9]<=cursor)throw new Error('Quick Selection frontier made no progress.');cursor=data[9];
    }
  };
  for(let s=0;s<spans.length;s+=2){
    process(spans[s],spans[s+1],0,true);
    while(pending.length){
      const end=pending.pop()!,start=pending.pop()!;process(start,end,-width,false);process(start,end,width,false);
      if(performance.now()-lastProgress>=8){progress({completed:data[11],total:count*2});lastProgress=performance.now();}
    }
  }
  progress({completed:count,total:count*2});
  const rows=new SelectionRows({x:request.x,y:request.y,width,height});
  for(let start=0;start<count;start+=bandSize){
    const length=Math.min(bandSize,count-start);kernel.quickSelectionAlpha(source,state,start,length,output);
    await rows.append(new Uint8Array(kernel.memory.buffer,output,length));progress({completed:count+start+length,total:count*2});
  }
  return rows.finish();
}
