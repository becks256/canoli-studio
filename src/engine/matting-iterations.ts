import {forkPixelKernel,type PixelKernel} from './wasm';
import type {MattingIterationFactory,MattingIterations} from '../intelligence/matting/iterations';

/** Move packed matrix storage into private WASM memory a chunk at a time. The JS
 * fallback uses the same rebound views even if a later optional growth fails. */
export function wasmMattingIterations(source:PixelKernel):MattingIterationFactory {
  return graph=>{
    const {chunks,count,chunkSize,rowStride,diagonal,hasFactor,availableBytes}=graph;
    if(count<4096)return{estimatedBytes:0};
    const matrixBytes=chunkSize*rowStride*12,factorBytes=hasFactor?chunkSize*rowStride*8:0,metadataBytes=chunkSize*3;
    const chunkBytes=matrixBytes+metadataBytes+factorBytes;
    // Charge scratch, copied metadata, page rounding, descriptors and the largest
    // transient source chunk as well as the retained base graph/factor elsewhere.
    const extraBytes=count*24+chunks.length*(metadataBytes+512)+65536+matrixBytes+factorBytes;
    if(!Number.isSafeInteger(extraBytes)||extraBytes>availableBytes)return{estimatedBytes:0};
    let kernel:PixelKernel;
    try{kernel=forkPixelKernel(source);}catch(error){if(error instanceof RangeError)return{estimatedBytes:0};throw error;}
    const memory=kernel.memory,base=Math.ceil(kernel.bufferOffset()/8)*8;
    // Include the module's otherwise idle heap prefix in the optional estimate.
    const estimatedBytes=extraBytes+base;
    if(estimatedBytes>availableBytes)return{estimatedBytes:0};
    const inputPtr=base+chunks.length*chunkBytes,outputPtr=inputPtr+count*8,diagonalPtr=outputPtr+count*8,required=diagonalPtr+count*8;
    if(!Number.isSafeInteger(required)||required>256*1024*1024)return{estimatedBytes:0};
    let moved=0;
    const bind=()=>{
      for(let chunk=0;chunk<moved;chunk++){
        const rows=chunks[chunk],ptr=base+chunk*chunkBytes;
        rows.values=new Float64Array(memory.buffer,ptr,chunkSize*rowStride);
        rows.neighbors=new Int32Array(memory.buffer,ptr+chunkSize*rowStride*8,chunkSize*rowStride);
        if(hasFactor)rows.factor=new Float64Array(memory.buffer,ptr+matrixBytes+metadataBytes,chunkSize*rowStride);
      }
    };
    const grow=(bytes:number)=>{
      if(bytes>memory.buffer.byteLength){memory.grow(Math.ceil((bytes-memory.buffer.byteLength)/65536));bind();}
    };
    try{
      for(let chunk=0;chunk<chunks.length;chunk++){
        const rows=chunks[chunk],ptr=base+chunk*chunkBytes;grow(ptr+chunkBytes);
        const values=new Float64Array(memory.buffer,ptr,chunkSize*rowStride);values.set(rows.values);rows.values=values;
        const neighbors=new Int32Array(memory.buffer,ptr+chunkSize*rowStride*8,chunkSize*rowStride);neighbors.set(rows.neighbors);rows.neighbors=neighbors;
        if(hasFactor){const factor=new Float64Array(memory.buffer,ptr+matrixBytes+metadataBytes,chunkSize*rowStride);factor.set(rows.factor!);rows.factor=factor;}
        new Uint8Array(memory.buffer,ptr+matrixBytes,chunkSize).set(rows.rank);
        new Uint8Array(memory.buffer,ptr+matrixBytes+chunkSize,chunkSize).set(rows.anchor);
        new Uint8Array(memory.buffer,ptr+matrixBytes+chunkSize*2,chunkSize).set(rows.frozen);
        moved++;
      }
      grow(required);
    }catch(error){
      // Completed chunks remain accessible through their rebound views. No
      // original graph is lost, copied back, truncated or solved approximately.
      bind();if(error instanceof RangeError)return{estimatedBytes};throw error;
    }
    try{
      const input=new Float64Array(memory.buffer,inputPtr,count),output=new Float64Array(memory.buffer,outputPtr,count);
      new Float64Array(memory.buffer,diagonalPtr,count).set(diagonal);
      const result:MattingIterations={estimatedBytes,
        multiply(values,target){input.set(values);kernel.mattingMultiply(base,chunkSize,rowStride,chunkBytes,count,inputPtr,outputPtr);target.set(output);},
        condition(values,target){input.set(values);kernel.mattingCondition(base,chunkSize,rowStride,chunkBytes,count,inputPtr,outputPtr,diagonalPtr,hasFactor);target.set(output);},
      };
      return result;
    }catch(error){if(error instanceof RangeError)return{estimatedBytes};throw error;}
  };
}
