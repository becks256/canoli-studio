/** Bounded input cursor; neither a compressed source block nor its decoded image is collected. */
export class Cursor {
 private reader:ReadableStreamDefaultReader<Uint8Array>;private chunk:Uint8Array=new Uint8Array();private at=0;
 constructor(stream:ReadableStream<Uint8Array>){this.reader=stream.getReader();}
 async byte(){while(this.at===this.chunk.length){const next=await this.reader.read();if(next.done)return -1;this.chunk=next.value;this.at=0;}return this.chunk[this.at++];}
 async read(length:number){const result=new Uint8Array(length);let offset=0;while(offset<length){if(this.at===this.chunk.length){const next=await this.reader.read();if(next.done)throw new Error('Truncated TIFF pixel block.');this.chunk=next.value;this.at=0;}const n=Math.min(length-offset,this.chunk.length-this.at);result.set(this.chunk.subarray(this.at,this.at+n),offset);this.at+=n;offset+=n;}return result;}
 async skip(length:number){while(length){if(this.at===this.chunk.length){const next=await this.reader.read();if(next.done)throw new Error('Truncated TIFF pixel padding.');this.chunk=next.value;this.at=0;}const n=Math.min(length,this.chunk.length-this.at);this.at+=n;length-=n;}}
 async end(){if(await this.byte()!==-1)throw new Error('TIFF pixel block exceeds its declared geometry.');}
 async close(){await this.reader.cancel().catch(()=>{});this.reader.releaseLock();}
}

async function* expand(blob:Blob,compression:number,expected:number):AsyncGenerator<Uint8Array>{
 const input=new Cursor(blob.stream()),buffer=new Uint8Array(65536);let used=0,total=0;
 const append=(value:number)=>{if(++total>expected)throw new Error('TIFF decompression exceeds its declared geometry.');buffer[used++]=value;};
 try{
  if(compression===32773){while(total<expected){const header=await input.byte();if(header<0)throw new Error('Truncated TIFF PackBits block.');if(header===128)continue;if(header<128){for(let i=0;i<=header;i++){const b=await input.byte();if(b<0)throw new Error('Truncated TIFF PackBits literal.');append(b);if(used===buffer.length){yield buffer.slice();used=0;}}}else{const value=await input.byte();if(value<0)throw new Error('Truncated TIFF PackBits run.');for(let i=0;i<257-header;i++){append(value);if(used===buffer.length){yield buffer.slice();used=0;}}}}// Only no-op bytes may follow a complete PackBits block.
   let tail;while((tail=await input.byte())!==-1)if(tail!==128)throw new Error('Trailing TIFF PackBits pixels.');
  }else{
   const prefix=new Uint16Array(4096),suffix=new Uint8Array(4096),stack=new Uint8Array(4097);let bits=9,next=258,previous=-1,bitBuffer=0,available=0,first=0,started=false;
   const code=async()=>{while(available<bits){const value=await input.byte();if(value<0)throw new Error('Truncated TIFF LZW code.');bitBuffer=bitBuffer*256+value;available+=8;}available-=bits;const value=Math.floor(bitBuffer/2**available);bitBuffer%=2**available;return value;};
   while(true){const value=await code();if(!started&&value!==256)throw new Error('TIFF LZW must start with a clear code.');started=true;if(value===256){bits=9;next=258;previous=-1;continue;}if(value===257)break;if(value>next||value===next&&previous<0||value>=4096)throw new Error('Invalid TIFF LZW dictionary reference.');let count=0,current=value;
    if(value===next){stack[count++]=first;current=previous;}
    let steps=0;while(current>=256){if(current>=next||++steps>4096)throw new Error('Cyclic TIFF LZW dictionary.');stack[count++]=suffix[current];current=prefix[current];}first=current;stack[count++]=first;
    while(count){append(stack[--count]);if(used===buffer.length){yield buffer.slice();used=0;}}
    if(previous>=0&&next<4096){prefix[next]=previous;suffix[next]=first;next++;if(next===(1<<bits)-1&&bits<12)bits++;}previous=value;
   }
   // An EOI may end mid-byte, but not leave further compressed bytes.
   await input.end();
  }
  if(total!==expected)throw new Error('TIFF decompression ended before its declared geometry.');if(used)yield buffer.slice(0,used);
 }finally{await input.close();}
}
export function decodedStream(blob:Blob,compression:number,expected:number):ReadableStream<Uint8Array>{
 if(compression===1)return blob.stream();if(compression===8||compression===32946)return blob.stream().pipeThrough(new DecompressionStream('deflate'));
 const iterator=expand(blob,compression,expected);return new ReadableStream({async pull(controller){try{const next=await iterator.next();if(next.done)controller.close();else controller.enqueue(next.value);}catch(error){controller.error(error);}},async cancel(){await iterator.return(undefined);}});
}
