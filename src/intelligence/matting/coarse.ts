import {yieldTask} from '../../core/task-yield';

/** Private native graph storage. parent is reusable only after component classification. */
export interface CoarseRows {
  values:Float64Array;neighbors:Int32Array;parent:Int32Array;frozen:Uint8Array;
  /** Exact integer RGB24 * 512 + initial alpha byte, independently flagged by hasPrior. */
  sample:Float64Array;
}
export interface CoarseCorrection {
  blocks:number;bandwidth:number;estimatedBytes:number;ridge:number;
  correct?:(input:Float64Array,output:Float64Array)=>void;
}
export const noCoarseCorrection=():CoarseCorrection=>({blocks:0,bandwidth:0,estimatedBytes:0,ridge:0});

/** Q=P(E+ridge I)^-1 P^T, E=P^T A P; local columns are 1,R,G,B.
 * Neither the native matrix nor its hard constraints are changed. */
export async function prepareCoarseCorrection(graph:{
  width:number;count:number;chunkSize:number;rowStride:number;
  indices:ReadonlyMap<number,number>;chunks:readonly CoarseRows[];
  availableBytes:number;disposed:()=>boolean;
},x:Float64Array,residual:Float64Array):Promise<CoarseCorrection>{
  const {width,count,chunkSize,rowStride,indices,chunks,availableBytes}=graph;
  if(count<4096||availableBytes<1024)return noCoarseCorrection();
  const blockSize=16,columns=Math.ceil(width/blockSize),bookkeeping=384,fixedBytes=64;
  const row=(index:number)=>chunks[Math.floor(index/chunkSize)];
  const blockKey=(pixel:number)=>{
    const y=Math.floor(pixel/width),column=pixel-y*width;
    return Math.floor(y/blockSize)*columns+Math.floor(column/blockSize);
  };
  const blocks=new Map<number,number>();let lastYield=performance.now();
  const pause=async()=>{
    if(graph.disposed())throw new Error('Closed-form matting was disposed.');
    if(performance.now()-lastYield>=8){await yieldTask();lastYield=performance.now();}
    if(graph.disposed())throw new Error('Closed-form matting was disposed.');
  };
  const unavailable=(estimatedBytes:number):CoarseCorrection=>({...noCoarseCorrection(),estimatedBytes});
  for(const [pixel,index] of indices){
    if(row(index).frozen[index%chunkSize])continue;
    const key=blockKey(pixel);
    if(!blocks.has(key)){
      if((blocks.size+1)*bookkeeping+fixedBytes>availableBytes)return unavailable(blocks.size*bookkeeping+fixedBytes);
      blocks.set(key,0);
    }
  }
  const keys=[...blocks.keys()].sort((a,b)=>a-b),blockCount=keys.length;
  if(!blockCount)return noCoarseCorrection();
  keys.forEach((key,index)=>blocks.set(key,index));
  // All union roots/anchors were resolved before this call. Keep frozen rows out of P.
  for(const [pixel,index] of indices){const rows=row(index),i=index%chunkSize;rows.parent[i]=rows.frozen[i]?-1:blocks.get(blockKey(pixel))!;}
  let bandwidth=0;
  for(let chunk=0;chunk<chunks.length;chunk++){
    const rows=chunks[chunk],length=Math.min(chunkSize,count-chunk*chunkSize);
    for(let i=0;i<length;i++){
      const a=rows.parent[i];if(a<0)continue;
      for(let k=0;k<rowStride;k++){
        const j=rows.neighbors[i*rowStride+k];if(j<0)continue;
        const b=row(j).parent[j%chunkSize];if(b>=0)bandwidth=Math.max(bandwidth,Math.abs(a-b));
      }
    }
    await pause();
  }
  bandwidth=bandwidth*4+3;
  const n=blockCount*4,stride=bandwidth+1,estimatedBytes=n*(stride*8+8)+blockCount*bookkeeping+fixedBytes;
  // Bound optional band-factor work independently of document geometry/imports.
  if(!Number.isSafeInteger(estimatedBytes)||estimatedBytes>availableBytes||n*bandwidth*bandwidth>200_000_000)return unavailable(blockCount*bookkeeping+fixedBytes);
  let matrix:Float64Array,rhs:Float64Array,left:Float64Array,right:Float64Array;
  try{matrix=new Float64Array(n*stride);rhs=new Float64Array(n);left=new Float64Array(4);right=new Float64Array(4);}
  catch(error){if(error instanceof RangeError)return unavailable(estimatedBytes);throw error;}
  const color=(packed:number,out:Float64Array)=>{
    const rgb=Math.floor(packed/512);out[0]=1;out[1]=(rgb>>>16)/255;out[2]=((rgb>>>8)&255)/255;out[3]=(rgb&255)/255;
  };
  for(let chunk=0;chunk<chunks.length;chunk++){
    const rows=chunks[chunk],start=chunk*chunkSize,length=Math.min(chunkSize,count-start);
    for(let i=0;i<length;i++){
      const block=rows.parent[i];if(block<0)continue;
      const a=block*4;color(rows.sample[i],left);
      for(let u=0;u<4;u++)rhs[a+u]+=left[u]*residual[start+i];
      for(let k=0;k<rowStride;k++){
        const slot=i*rowStride+k,j=rows.neighbors[slot];if(j<0)continue;
        const other=row(j),blockJ=other.parent[j%chunkSize];if(blockJ<0||block<blockJ)continue;
        const b=blockJ*4,value=rows.values[slot];color(other.sample[j%chunkSize],right);
        for(let u=0;u<4;u++)for(let v=0;v<4;v++)if(a+u>=b+v)matrix[(a+u)*stride+a+u-b-v]+=value*left[u]*right[v];
      }
    }
    await pause();
  }
  // Local RGB columns can be dependent. Regularize only the coarse preconditioner.
  let largest=0;for(let i=0;i<n;i++)largest=Math.max(largest,matrix[i*stride]);
  const ridge=Math.max(1e-12,largest*1e-10);
  for(let i=0;i<n;i++)matrix[i*stride]+=ridge;
  for(let i=0;i<n;i++){
    const start=Math.max(0,i-bandwidth),scale=matrix[i*stride];
    for(let j=start;j<=i;j++){
      let value=matrix[i*stride+i-j];
      for(let k=start;k<j;k++)value-=matrix[i*stride+i-k]*matrix[j*stride+j-k];
      if(i===j){
        if(!Number.isFinite(value)||value<=Math.max(1e-14,scale*1e-12))return unavailable(estimatedBytes);
        matrix[i*stride]=Math.sqrt(value);
      }else matrix[i*stride+i-j]=value/matrix[j*stride];
    }
    await pause();
  }
  const solve=()=>{
    for(let i=0;i<n;i++){let value=rhs[i];for(let j=Math.max(0,i-bandwidth);j<i;j++)value-=matrix[i*stride+i-j]*rhs[j];rhs[i]=value/matrix[i*stride];}
    for(let i=n-1;i>=0;i--){let value=rhs[i];for(let j=i+1;j<=Math.min(n-1,i+bandwidth);j++)value-=matrix[j*stride+j-i]*rhs[j];rhs[i]=value/matrix[i*stride];}
    return rhs.every(Number.isFinite);
  };
  const prolong=(output:Float64Array)=>{
    for(let chunk=0;chunk<chunks.length;chunk++){
      const rows=chunks[chunk],start=chunk*chunkSize,length=Math.min(chunkSize,count-start);
      for(let i=0;i<length;i++)if(rows.parent[i]>=0){
        const id=rows.parent[i]*4,rgb=Math.floor(rows.sample[i]/512);
        output[start+i]+=rhs[id]+(rgb>>>16)/255*rhs[id+1]+((rgb>>>8)&255)/255*rhs[id+2]+(rgb&255)/255*rhs[id+3];
      }
    }
  };
  if(!solve())return unavailable(estimatedBytes);
  prolong(x);await pause();
  return{blocks:blockCount,bandwidth,estimatedBytes,ridge,correct(input,output){
    rhs.fill(0);
    for(let chunk=0;chunk<chunks.length;chunk++){
      const rows=chunks[chunk],start=chunk*chunkSize,length=Math.min(chunkSize,count-start);
      for(let i=0;i<length;i++)if(rows.parent[i]>=0){
        const id=rows.parent[i]*4,rgb=Math.floor(rows.sample[i]/512),value=input[start+i];
        rhs[id]+=value;rhs[id+1]+=(rgb>>>16)/255*value;rhs[id+2]+=((rgb>>>8)&255)/255*value;rhs[id+3]+=(rgb&255)/255*value;
      }
    }
    if(!solve())throw new Error('Coarse matting correction lost numerical precision.');
    prolong(output);
  }};
}
