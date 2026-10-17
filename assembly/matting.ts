// Host-owned packed 25-entry sparse rows. No allocation, callbacks or f32 arithmetic.
export function mattingMultiply(graph:usize,chunkSize:i32,rowStride:i32,chunkBytes:i32,count:i32,input:usize,output:usize):void {
  const chunks=(count+chunkSize-1)/chunkSize;
  for(let chunk=0;chunk<chunks;chunk++){
    const base=chunk*chunkSize,rows=graph+<usize>(chunk*chunkBytes),neighbors=rows+<usize>(chunkSize*rowStride*8);
    // Counts/lower/frozen precede the optional factor, so both layouts share this ABI.
    const counts=neighbors+<usize>(chunkSize*rowStride*4),frozen=counts+<usize>(chunkSize*2);
    const length=min(chunkSize,count-base);
    for(let i=0;i<length;i++){
      const index=base+i;
      if(load<u8>(frozen+<usize>i)){store<f64>(output+<usize>(index*8),load<f64>(input+<usize>(index*8)));continue;}
      let sum:f64=0;const start=i*rowStride,end=start+<i32>load<u8>(counts+<usize>i);
      for(let slot=start;slot<end;slot++){
        const value=load<f64>(rows+<usize>(slot*8));
        if(value!=0)sum+=value*load<f64>(input+<usize>(load<i32>(neighbors+<usize>(slot*4))*8));
      }
      store<f64>(output+<usize>(index*8),sum);
    }
  }
}

export function mattingCondition(graph:usize,chunkSize:i32,rowStride:i32,chunkBytes:i32,count:i32,input:usize,output:usize,diagonal:usize,hasFactor:bool):void {
  if(!hasFactor){for(let i=0;i<count;i++)store<f64>(output+<usize>(i*8),load<f64>(input+<usize>(i*8))/load<f64>(diagonal+<usize>(i*8)));return;}
  const chunks=(count+chunkSize-1)/chunkSize;
  for(let chunk=0;chunk<chunks;chunk++){
    const base=chunk*chunkSize,rows=graph+<usize>(chunk*chunkBytes),neighbors=rows+<usize>(chunkSize*rowStride*8);
    const counts=neighbors+<usize>(chunkSize*rowStride*4),lower=counts+<usize>chunkSize,frozen=lower+<usize>chunkSize,factor=frozen+<usize>chunkSize;
    const length=min(chunkSize,count-base);
    for(let i=0;i<length;i++){
      const index=base+i;let value=load<f64>(input+<usize>(index*8));
      if(load<u8>(frozen+<usize>i)){store<f64>(output+<usize>(index*8),value);continue;}
      const start=i*rowStride,end=start+<i32>load<u8>(lower+<usize>i);
      for(let slot=start;slot<end;slot++)value-=load<f64>(factor+<usize>(slot*8))*load<f64>(output+<usize>(load<i32>(neighbors+<usize>(slot*4))*8));
      store<f64>(output+<usize>(index*8),value*load<f64>(diagonal+<usize>(index*8)));
    }
  }
  for(let chunk=chunks-1;chunk>=0;chunk--){
    const base=chunk*chunkSize,rows=graph+<usize>(chunk*chunkBytes),neighbors=rows+<usize>(chunkSize*rowStride*8);
    const counts=neighbors+<usize>(chunkSize*rowStride*4),lower=counts+<usize>chunkSize,frozen=lower+<usize>chunkSize,factor=frozen+<usize>chunkSize;
    const length=min(chunkSize,count-base);
    for(let i=length-1;i>=0;i--){
      if(load<u8>(frozen+<usize>i))continue;
      const index=base+i,start=i*rowStride,end=start+<i32>load<u8>(counts+<usize>i);let value=load<f64>(output+<usize>(index*8));
      for(let slot=start+<i32>load<u8>(lower+<usize>i)+1;slot<end;slot++)value-=load<f64>(factor+<usize>(slot*8))*load<f64>(output+<usize>(load<i32>(neighbors+<usize>(slot*4))*8));
      store<f64>(output+<usize>(index*8),value*load<f64>(diagonal+<usize>(index*8)));
    }
  }
}
