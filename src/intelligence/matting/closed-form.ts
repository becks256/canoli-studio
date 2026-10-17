import type {MattingIterationFactory,MattingIterations} from './iterations';
import {yieldTask} from '../../core/task-yield';
import {noCoarseCorrection,prepareCoarseCorrection,type CoarseRows} from './coarse';

// Levin, Lischinski & Weiss, CVPR 2006, equations 12 and 13.
// Original implementation: hard constraints; clipped 3x3 visible-pixel windows.
const CHUNK=2048,STRIDE=25,EPSILON=1e-7;
const ROW_BYTES=STRIDE*12+8*9+8; // Matrix, PCG work, metadata; Map estimate below.
const FACTOR_ROW_BYTES=STRIDE*8;
const DEFAULT_BUDGET=192*1024*1024;
const INTERSECTION=new Int8Array(STRIDE*STRIDE).fill(-1);
for(let a=0;a<STRIDE;a++)for(let b=0;b<STRIDE;b++){const dx=b%5-a%5,dy=Math.floor(b/5)-Math.floor(a/5);if(Math.abs(dx)<=2&&Math.abs(dy)<=2)INTERSECTION[a*STRIDE+b]=(dy+2)*5+dx+2;}
export interface ClosedFormTile {
  x:number;y:number;width:number;height:number;sourceWidth:number;sourceHeight:number;
  core:{x:number;y:number;width:number;height:number};
  pixels:Uint8ClampedArray;labels:Uint8Array;initial?:Uint8Array;estimate?:Uint8Array;
}
export interface ClosedFormDiagnostics {unknownPixels:number;unresolvedPixels:number;iterations:number;relativeResidual:number;estimatedGraphBytes:number;preconditioner:'ic0'|'jacobi'|'none';preconditionerShift:number;coarseBlocks:number;coarseBandwidth:number;coarseBytes:number;coarseRidge:number;iterationBackend:'javascript'|'wasm';iterationBytes:number}
interface Rows extends CoarseRows {
  rank:Uint8Array;anchor:Uint8Array;hasPrior:Uint8Array;rhs:Float64Array;
  factor?:Float64Array;
}
/** Private worker state. Stores unknown rows only, preserving connections across capture tiles. */
export class ClosedFormMatting {
  private indices=new Map<number,number>();
  private chunks:Rows[]=[];
  private count=0;
  private centers=0;
  private nextX=0;
  private nextY=0;
  private bandHeight=0;
  private solved=false;
  private failed=false;
  private disposed=false;
  private packed=false;
  private solution?:Float64Array;
  constructor(readonly width:number,readonly height:number,private budget=DEFAULT_BUDGET){
    if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||!Number.isSafeInteger(width*height)||!Number.isFinite(budget)||budget<0)throw new Error('Invalid closed-form matting geometry or working budget.');
  }
  private row(index:number){return this.chunks[Math.floor(index/CHUNK)];}
  private root(index:number):number{
    let root=index;
    while(this.row(root).parent[root%CHUNK]!==root)root=this.row(root).parent[root%CHUNK];
    while(index!==root){const rows=this.row(index),offset=index%CHUNK,next=rows.parent[offset];rows.parent[offset]=root;index=next;}
    return root;
  }
  private union(a:number,b:number){
    a=this.root(a);b=this.root(b);if(a===b)return;
    let ar=this.row(a),br=this.row(b),ai=a%CHUNK,bi=b%CHUNK;
    if(ar.rank[ai]<br.rank[bi]){[a,b]=[b,a];[ar,br]=[br,ar];[ai,bi]=[bi,ai];}
    br.parent[bi]=a;ar.anchor[ai] ||= br.anchor[bi];if(ar.rank[ai]===br.rank[bi])ar.rank[ai]++;
  }
  private index(pixel:number,prior:number|undefined,rgb:number):number{
    const found=this.indices.get(pixel);if(found!==undefined)return found;
    const index=this.count,offset=index%CHUNK;
    if(offset===0){
      if((this.chunks.length+1)*CHUNK*(ROW_BYTES+64)>this.budget)throw new Error('Closed-form matting exceeds its 192 MiB graph working budget. Add known foreground/background marks or use Color line; the original image is unchanged.');
      const vector=()=>new Float64Array(CHUNK);
      this.chunks.push({values:new Float64Array(CHUNK*STRIDE),neighbors:new Int32Array(CHUNK*STRIDE).fill(-1),parent:new Int32Array(CHUNK),rank:new Uint8Array(CHUNK),anchor:new Uint8Array(CHUNK),hasPrior:new Uint8Array(CHUNK),frozen:new Uint8Array(CHUNK),sample:vector(),rhs:vector()});
    }
    const rows=this.row(index);rows.parent[offset]=index;rows.hasPrior[offset]=prior===undefined?0:1;rows.sample[offset]=rgb*512+(prior??0);
    this.count++;this.indices.set(pixel,index);return index;
  }
  /** Every native center must be submitted once in disjoint core regions. */
  add(tile:ClosedFormTile):void{
    if(this.solved||this.failed)throw new Error('Closed-form assembly is closed.');
    const {x,y,width,height,core,pixels,labels,initial,estimate}=tile;
    if(tile.sourceWidth!==this.width||tile.sourceHeight!==this.height||pixels.length!==width*height*4||labels.length!==width*height||(initial&&initial.length!==width*height)||(estimate&&estimate.length!==width*height)||
      ![x,y,width,height,core.x,core.y,core.width,core.height].every(Number.isSafeInteger)||core.width<1||core.height<1||core.x<1||core.y<1||core.x+core.width>=width||core.y+core.height>=height||x+core.x<0||y+core.y<0||x+core.x+core.width>this.width||y+core.y+core.height>this.height)throw new Error('Invalid closed-form capture tile.');
    if(x+core.x!==this.nextX||y+core.y!==this.nextY||(this.nextX&&core.height!==this.bandHeight))throw new Error('Closed-form cores must cover the source once in row-major bands.');
    if(!this.nextX)this.bandHeight=core.height;
    this.nextX+=core.width;if(this.nextX===this.width){this.nextX=0;this.nextY+=this.bandHeight;}
    if(!labels.some((label,i)=>label===128&&!!pixels[i*4+3]&&!(estimate&&!estimate[i]&&initial))){this.centers+=core.width*core.height;return;}
    const locations=new Int32Array(9),indices=new Int32Array(9),fixed=new Float64Array(9),colors=new Float64Array(27),whitened=new Float64Array(27);
    try{
      for(let cy=core.y;cy<core.y+core.height;cy++)for(let cx=core.x;cx<core.x+core.width;cx++){
        let n=0,unknown=0,meanR=0,meanG=0,meanB=0;
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
          const xx=x+cx+dx,yy=y+cy+dy;if(xx<0||yy<0||xx>=this.width||yy>=this.height)continue;
          const i=(cy+dy)*width+cx+dx;if(!pixels[i*4+3])continue;
          const label=labels[i];if(label!==0&&label!==128&&label!==255)throw new Error('Invalid closed-form trimap label.');
          const variable=label===128&&!(estimate&&!estimate[i]&&initial),r=pixels[i*4]/255,g=pixels[i*4+1]/255,b=pixels[i*4+2]/255;
          locations[n]=i;indices[n]=variable?this.index(yy*this.width+xx,initial?.[i],(pixels[i*4]<<16)|(pixels[i*4+1]<<8)|pixels[i*4+2]):-1;unknown+=variable?1:0;
          fixed[n]=label===128?(initial?.[i]??0)/255:label/255;
          colors[n*3]=r;colors[n*3+1]=g;colors[n*3+2]=b;meanR+=r;meanG+=g;meanB+=b;n++;
        }
        this.centers++;if(!unknown)continue;
        // Connected windows determine which components have actual hard constraints.
        let first=-1;
        for(let i=0;i<n;i++)if(indices[i]>=0){if(first<0)first=indices[i];else this.union(first,indices[i]);}
        if(n>unknown){const root=this.root(first);this.row(root).anchor[root%CHUNK]=1;}
        meanR/=n;meanG/=n;meanB/=n;
        let a=0,b=0,c=0,d=0,e=0,f=0;
        for(let i=0;i<n;i++){const r=colors[i*3]-meanR,g=colors[i*3+1]-meanG,blue=colors[i*3+2]-meanB;colors[i*3]=r;colors[i*3+1]=g;colors[i*3+2]=blue;a+=r*r;b+=r*g;c+=r*blue;d+=g*g;e+=g*blue;f+=blue*blue;}
        // Cholesky avoids an unstable explicit covariance inverse in nearly flat windows.
        const l00=Math.sqrt((a+EPSILON)/n),l10=b/n/l00,l20=c/n/l00,l11=Math.sqrt((d+EPSILON)/n-l10*l10),l21=(e/n-l20*l10)/l11,l22=Math.sqrt((f+EPSILON)/n-l20*l20-l21*l21);
        if(!Number.isFinite(l22)||l22<=0)throw new Error('Closed-form covariance lost numerical precision.');
        for(let i=0;i<n;i++){const z0=colors[i*3]/l00,z1=(colors[i*3+1]-l10*z0)/l11,z2=(colors[i*3+2]-l20*z0-l21*z1)/l22;whitened[i*3]=z0;whitened[i*3+1]=z1;whitened[i*3+2]=z2;}
        for(let i=0;i<n;i++){
          const index=indices[i];if(index<0)continue;const rows=this.row(index),offset=index%CHUNK;
          for(let j=0;j<n;j++){
            const value=(i===j?1:0)-(1+whitened[i*3]*whitened[j*3]+whitened[i*3+1]*whitened[j*3+1]+whitened[i*3+2]*whitened[j*3+2])/n;
            if(indices[j]<0)rows.rhs[offset]-=value*fixed[j];
            else{const dx=locations[j]%width-locations[i]%width,dy=Math.floor(locations[j]/width)-Math.floor(locations[i]/width),slot=offset*STRIDE+(dy+2)*5+dx+2;rows.values[slot]+=value;rows.neighbors[slot]=indices[j];}
          }
        }
      }
    }catch(error){this.failed=true;throw error;}
  }
  /** IC(0) changes only the preconditioner; the original Laplacian and residual stay intact. */
  private async incompleteCholesky(inverseDiagonal:Float64Array):Promise<number|undefined>{
    // Preserve the existing global Jacobi capacity when the extra IC(0) work would exceed budget.
    if(this.chunks.length*CHUNK*(ROW_BYTES+64+FACTOR_ROW_BYTES)>this.budget)return;
    try{for(const rows of this.chunks)rows.factor=new Float64Array(CHUNK*STRIDE);}
    catch(error){for(const rows of this.chunks)rows.factor=undefined;if(error instanceof RangeError)return;throw error;}
    const predecessors=new Int32Array(24);
    for(const shift of [0,1e-4,1e-3,1e-2,.1,1,10,100]){
      for(const rows of this.chunks)rows.factor!.fill(0);inverseDiagonal.fill(0);
      let valid=true,lastYield=performance.now();
      for(let index=0;index<this.count;index++){
        if(this.disposed)throw new Error('Closed-form matting was disposed.');
        const rows=this.row(index),i=index%CHUNK,base=i*STRIDE;
        if(rows.frozen[i]){inverseDiagonal[index]=1;continue;}
        let length=0;
        // Capture insertion order need not be geometric row order at native tile seams.
        for(let slot=0;slot<STRIDE;slot++){
          const other=rows.neighbors[base+slot];if(other<0||other>=index)continue;
          let at=length;while(at&&rows.neighbors[base+predecessors[at-1]]>other){predecessors[at]=predecessors[at-1];at--;}predecessors[at]=slot;length++;
        }
        let pivot=rows.values[base+12]*(1+shift);
        for(let a=0;a<length;a++){
          const slot=predecessors[a],other=rows.neighbors[base+slot],otherRows=this.row(other),otherBase=(other%CHUNK)*STRIDE;
          let value=rows.values[base+slot];
          for(let b=0;b<a;b++){
            const previous=predecessors[b],cross=INTERSECTION[slot*STRIDE+previous];if(cross<0||otherRows.neighbors[otherBase+cross]!==rows.neighbors[base+previous])continue;
            value-=rows.factor![base+previous]*otherRows.factor![otherBase+cross];
          }
          value*=inverseDiagonal[other];rows.factor![base+slot]=value;pivot-=value*value;
        }
        if(!Number.isFinite(pivot)||pivot<=Math.max(1e-14,rows.values[base+12]*1e-12)){valid=false;break;}
        inverseDiagonal[index]=1/Math.sqrt(pivot);
        if(performance.now()-lastYield>=8){await yieldTask();lastYield=performance.now();}
      }
      if(!valid)continue;
      // Store the transpose in unused upper slots for allocation-free triangular applications.
      for(let index=0;index<this.count;index++){
        const rows=this.row(index),base=(index%CHUNK)*STRIDE;
        for(let slot=0;slot<STRIDE;slot++){const other=rows.neighbors[base+slot];if(other>index)rows.factor![base+slot]=this.row(other).factor![(other%CHUNK)*STRIDE+24-slot];}
      }
      return shift;
    }
    for(const rows of this.chunks)rows.factor=undefined;return;
  }
  /** Union metadata is dead after constraints are classified; reuse its bytes for sparse bounds. */
  private packRows():void{
    for(let index=0;index<this.count;index++){
      const rows=this.row(index),i=index%CHUNK,base=i*STRIDE;
      if(rows.frozen[i]){rows.rank[i]=rows.anchor[i]=0;continue;}
      let count=0,lower=0;
      for(let slot=0;slot<STRIDE;slot++){
        const other=rows.neighbors[base+slot];if(other<0)continue;
        const value=rows.values[base+slot],factor=rows.factor?.[base+slot];
        let at=count;
        while(at&&rows.neighbors[base+at-1]>other){
          rows.neighbors[base+at]=rows.neighbors[base+at-1];rows.values[base+at]=rows.values[base+at-1];
          if(rows.factor)rows.factor[base+at]=rows.factor[base+at-1];at--;
        }
        rows.neighbors[base+at]=other;rows.values[base+at]=value;if(rows.factor)rows.factor[base+at]=factor!;
        count++;if(other<index)lower++;
      }
      // rank becomes entry count; anchor becomes strict-lower count. Both fit in one byte.
      rows.rank[i]=count;rows.anchor[i]=lower;
    }
    this.packed=true;
  }
  /** Solve the complete constrained system, never one independent matte per tile. */
  async solve(onIteration?:(iteration:number,residual:number)=>void,maxIterations=2000,preconditioner:'ic0'|'jacobi'='ic0',useCoarse=true,iterationFactory?:MattingIterationFactory):Promise<ClosedFormDiagnostics>{
    if(this.solved||this.failed||this.centers!==this.width*this.height)throw new Error('Incomplete or closed matting system.');
    if(!Number.isSafeInteger(maxIterations)||maxIterations<0)throw new Error('Invalid matting iteration budget.');
    this.failed=true; // A failed/aborted solve is not reusable.
    const x=new Float64Array(this.count),r=new Float64Array(this.count),z=new Float64Array(this.count),p=new Float64Array(this.count),ap=new Float64Array(this.count),diagonal=new Float64Array(this.count),rhs=new Float64Array(this.count);
    let unresolvedPixels=0,bNorm=0;
    for(let index=0;index<this.count;index++){
      const rows=this.row(index),i=index%CHUNK,root=this.root(index),unanchored=!this.row(root).anchor[root%CHUNK];
      if(unanchored&&!rows.hasPrior[i])throw new Error('Unknown trimap components need known foreground/background constraints or an initial mask.');
      rows.frozen[i]=unanchored?1:0;if(unanchored)unresolvedPixels++;
      x[index]=(rows.sample[i]%512)/255;diagonal[index]=unanchored?1:rows.values[i*STRIDE+12];
      if(!Number.isFinite(diagonal[index])||diagonal[index]<=0)throw new Error('Closed-form system is not positive definite.');
      rhs[index]=unanchored?x[index]:rows.rhs[i];bNorm+=rhs[index]*rhs[index];
    }
    const norm=Math.max(1,Math.sqrt(bNorm));
    let accelerated:MattingIterations|undefined;
    const multiply=(input:Float64Array)=>{
      if(accelerated?.multiply){accelerated.multiply(input,ap);return;}
      const packed=this.packed;
      for(let chunk=0;chunk<this.chunks.length;chunk++){
        const rows=this.chunks[chunk],base=chunk*CHUNK,length=Math.min(CHUNK,this.count-base),values=rows.values,neighbors=rows.neighbors,frozen=rows.frozen,counts=rows.rank;
        for(let i=0;i<length;i++){
          if(frozen[i]){ap[base+i]=input[base+i];continue;}
          let sum=0;const start=i*STRIDE,end=start+(packed?counts[i]:STRIDE);
          for(let slot=start;slot<end;slot++){const v=values[slot];if(v)sum+=v*input[neighbors[slot]];}
          ap[base+i]=sum;
        }
      }
    };
    multiply(x);let rz=0,residualSquared=0;
    for(let i=0;i<this.count;i++){r[i]=rhs[i]-ap[i];residualSquared+=r[i]*r[i];}
    let iterations=0,relativeResidual=Math.sqrt(residualSquared)/norm,lastYield=performance.now();onIteration?.(0,relativeResidual);
    const baseBytes=this.chunks.length*CHUNK*(ROW_BYTES+64),factorBytes=this.chunks.length*CHUNK*FACTOR_ROW_BYTES;
    const reservedFactor=preconditioner==='ic0'&&baseBytes+factorBytes<=this.budget?factorBytes:0;
    const coarse=useCoarse&&relativeResidual>1e-7?await prepareCoarseCorrection({width:this.width,count:this.count,chunkSize:CHUNK,rowStride:STRIDE,indices:this.indices,chunks:this.chunks,availableBytes:this.budget-baseBytes-reservedFactor,disposed:()=>this.disposed},x,r):noCoarseCorrection();
    const tolerance=coarse.blocks?1e-9:1e-7;
    if(coarse.correct){multiply(x);residualSquared=0;for(let i=0;i<this.count;i++){r[i]=rhs[i]-ap[i];residualSquared+=r[i]*r[i];}relativeResidual=Math.sqrt(residualSquared)/norm;}
    if(!Number.isFinite(relativeResidual))throw new Error('Closed-form matting produced a nonfinite initial solution.');
    const shift=preconditioner==='ic0'&&this.count&&relativeResidual>tolerance?await this.incompleteCholesky(diagonal):undefined;
    if(shift===undefined)for(let index=0;index<this.count;index++){const rows=this.row(index),i=index%CHUNK;diagonal[index]=rows.frozen[i]?1:rows.values[i*STRIDE+12];}
    this.packRows();
    accelerated=iterationFactory?.({chunks:this.chunks,count:this.count,chunkSize:CHUNK,rowStride:STRIDE,diagonal,hasFactor:shift!==undefined,availableBytes:this.budget-baseBytes-(shift===undefined?0:factorBytes)-coarse.estimatedBytes});
    const condition=()=>{
      if(accelerated?.condition){accelerated.condition(r,z);coarse.correct?.(r,z);return;}
      if(shift===undefined){for(let i=0;i<this.count;i++)z[i]=r[i]/diagonal[i];coarse.correct?.(r,z);return;}
      for(let chunk=0;chunk<this.chunks.length;chunk++){
        const rows=this.chunks[chunk],base=chunk*CHUNK,length=Math.min(CHUNK,this.count-base),factor=rows.factor!,neighbors=rows.neighbors,frozen=rows.frozen,lower=rows.anchor;
        for(let i=0;i<length;i++){
          const index=base+i;if(frozen[i]){z[index]=r[index];continue;}
          let value=r[index];const start=i*STRIDE,end=start+lower[i];
          for(let slot=start;slot<end;slot++)value-=factor[slot]*z[neighbors[slot]];
          z[index]=value*diagonal[index];
        }
      }
      for(let chunk=this.chunks.length-1;chunk>=0;chunk--){
        const rows=this.chunks[chunk],base=chunk*CHUNK,length=Math.min(CHUNK,this.count-base),factor=rows.factor!,neighbors=rows.neighbors,frozen=rows.frozen,lower=rows.anchor,counts=rows.rank;
        for(let i=length-1;i>=0;i--){
          const index=base+i;if(frozen[i])continue;
          let value=z[index];const start=i*STRIDE,end=start+counts[i];
          for(let slot=start+lower[i]+1;slot<end;slot++)value-=factor[slot]*z[neighbors[slot]];
          z[index]=value*diagonal[index];
        }
      }
      coarse.correct?.(r,z);
    };
    condition();for(let i=0;i<this.count;i++){p[i]=z[i];rz+=r[i]*z[i];}
    while(relativeResidual>tolerance&&iterations<maxIterations){
      if(this.disposed)throw new Error('Closed-form matting was disposed.');
      multiply(p);let denominator=0;
      for(let i=0;i<this.count;i++)denominator+=p[i]*ap[i];
      if(!Number.isFinite(denominator)||denominator<=0||!Number.isFinite(rz))throw new Error('Closed-form matting solver lost numerical precision.');
      const step=rz/denominator;residualSquared=0;
      for(let i=0;i<this.count;i++){x[i]+=step*p[i];r[i]-=step*ap[i];residualSquared+=r[i]*r[i];}
      iterations++;relativeResidual=Math.sqrt(residualSquared)/norm;
      if(!Number.isFinite(relativeResidual))throw new Error('Closed-form matting produced a nonfinite solution.');
      if(relativeResidual<=tolerance){
        // Recompute the actual residual, rather than trusting only the recursive CG estimate.
        multiply(x);residualSquared=0;for(let i=0;i<this.count;i++){r[i]=rhs[i]-ap[i];residualSquared+=r[i]*r[i];}relativeResidual=Math.sqrt(residualSquared)/norm;
      }
      let nextRz=0;
      condition();for(let i=0;i<this.count;i++)nextRz+=r[i]*z[i];
      const beta=nextRz/rz;
      for(let i=0;i<this.count;i++)p[i]=z[i]+beta*p[i];rz=nextRz;
      if(performance.now()-lastYield>=8){onIteration?.(iterations,relativeResidual);await yieldTask();lastYield=performance.now();}
    }
    if(relativeResidual>tolerance)throw new Error(`Closed-form matting did not converge after ${iterations} iterations. Add known foreground/background marks or use Color line.`);
    if(this.disposed)throw new Error('Closed-form matting was disposed.');
    this.solution=x;this.solved=true;this.failed=false;onIteration?.(iterations,relativeResidual);
    return{unknownPixels:this.count,unresolvedPixels,iterations,relativeResidual,estimatedGraphBytes:this.chunks.length*CHUNK*(ROW_BYTES+64+(shift===undefined?0:FACTOR_ROW_BYTES))+coarse.estimatedBytes+(accelerated?.estimatedBytes??0),iterationBackend:accelerated?.multiply?'wasm':'javascript',iterationBytes:accelerated?.estimatedBytes??0,preconditioner:this.count?(shift===undefined?'jacobi':'ic0'):'none',preconditionerShift:shift??0,coarseBlocks:coarse.blocks,coarseBandwidth:coarse.bandwidth,coarseBytes:coarse.estimatedBytes,coarseRidge:coarse.ridge};
  }
  sample(x:number,y:number):{alpha:number;unresolved:boolean}|undefined{
    if(!this.solved)throw new Error('Closed-form matting has not converged.');
    const index=this.indices.get(Math.max(0,Math.min(this.height-1,y))*this.width+Math.max(0,Math.min(this.width-1,x)));if(index===undefined)return;
    const rows=this.row(index),i=index%CHUNK;return{alpha:Math.round(Math.max(0,Math.min(1,this.solution![index]))*255),unresolved:!!rows.frozen[i]};
  }
  dispose(){this.failed=true;this.solved=false;this.disposed=true;this.solution=undefined;this.indices.clear();this.chunks=[];}
}
