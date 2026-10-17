import {PngRowEncoder} from '../../png-stream';
import {inspectTiff} from './inspect';
import {tiffDecodeOptionsSchema,type TiffDecodeOptions} from './types';

/** Bounded input cursor; neither a compressed source block nor its decoded image is collected. */
class Cursor {
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
function decodedStream(blob:Blob,compression:number,expected:number):ReadableStream<Uint8Array>{
 if(compression===1)return blob.stream();if(compression===8||compression===32946)return blob.stream().pipeThrough(new DecompressionStream('deflate'));
 const iterator=expand(blob,compression,expected);return new ReadableStream({async pull(controller){try{const next=await iterator.next();if(next.done)controller.close();else controller.enqueue(next.value);}catch(error){controller.error(error);}},async cancel(){await iterator.return(undefined);}});
}
async function compressedProfile(profile?:Uint8Array){if(!profile)return;const stream=new Blob([new Uint8Array(profile)]).stream().pipeThrough(new CompressionStream('deflate'));return new Uint8Array(await new Response(stream).arrayBuffer());}
function sample(row:Uint8Array,index:number,bits:number,little:boolean){if(bits===8)return row[index];if(bits===16){const at=index*2;return little?row[at]|row[at+1]<<8:row[at]<<8|row[at+1];}return row[Math.floor(index*bits/8)]>>(8-bits-index*bits%8)&((1<<bits)-1);}
function predict(row:Uint8Array,bits:number,channels:number,little:boolean){if(bits===8){for(let i=channels;i<row.length;i++)row[i]=(row[i]+row[i-channels])&255;}else{const v=new DataView(row.buffer,row.byteOffset,row.byteLength);for(let i=channels*2;i<row.length;i+=2)v.setUint16(i,(v.getUint16(i,little)+v.getUint16(i-channels*2,little))&65535,little);}}

export async function decodeTiff(blob:Blob,options:TiffDecodeOptions={},progress?:(fraction:number)=>void){
 const settings=tiffDecodeOptionsSchema.parse(options),inspection=await inspectTiff(blob),page=inspection.pages[settings.page];if(!page)throw new Error('TIFF page does not exist.');const r=page.report;if(!r.canDecode)throw new Error('Unsupported TIFF: '+r.unsupported.join('; '));if(r.requiresPrecisionLoss&&!settings.allowPrecisionLoss)throw new Error('TIFF 16-bit import requires explicit 8-bit precision-loss consent.');
 const encoder=new PngRowEncoder(r.width,r.height,await compressedProfile(page.icc)),cursors:Cursor[]=[],rowsPerBatch=Math.max(1,Math.min(64,Math.floor(4_000_000/(r.width*4)))),maximum=2**r.bits-1;let output=new Uint8Array(r.width*rowsPerBatch*4),rows=0;
 try{progress?.(0);
  for(let blockY=0;blockY<page.blocksDown;blockY++){
   const active:{cursor:Cursor;width:number;channels:number;rowBytes:number;plane:number;x:number}[]=[];
   const blockRows=Math.min(page.blockHeight,r.height-blockY*page.blockHeight),storedRows=page.fields.has(324)?page.blockHeight:blockRows;
   for(let plane=0;plane<(r.planar===2?r.samples:1);plane++)for(let column=0;column<page.blocksAcross;column++){
    const index=plane*page.blocksAcross*page.blocksDown+blockY*page.blocksAcross+column,width=Math.min(page.blockWidth,r.width-column*page.blockWidth),channels=r.planar===2?1:r.samples,rowBytes=Math.ceil(page.blockWidth*channels*r.bits/8),expected=rowBytes*storedRows,at=await page.fields.get(page.fields.has(324)?324:273)!.value(index),size=await page.fields.get(page.fields.has(324)?325:279)!.value(index);
    if(!Number.isSafeInteger(expected)||!size)throw new Error('Invalid TIFF decoded block extent.');await inspection.reader.bytes(at,0);if(!Number.isSafeInteger(at+size)||at+size>blob.size)throw new Error('TIFF pixel block is outside its file.');const cursor=new Cursor(decodedStream(blob.slice(at,at+size),r.compression,expected));cursors.push(cursor);active.push({cursor,width,channels,rowBytes,plane,x:column*page.blockWidth});
   }
   const predictor=page.fields.has(317)?await page.fields.get(317)!.value():1;
   for(let y=0;y<blockRows;y++){
    // Only one decoded source row per active plane/tile is retained. Padding is skipped as a stream.
    const sourceRows:Uint8Array[]=[];for(const source of active){const useful=Math.ceil(source.width*source.channels*r.bits/8),row=await source.cursor.read(useful);await source.cursor.skip(source.rowBytes-useful);if(predictor===2)predict(row,r.bits,source.channels,inspection.reader.little);sourceRows.push(row);}
    for(let column=0;column<page.blocksAcross;column++){const source=active[column],colorSamples=r.photometric===2?3:1;for(let x=0;x<source.width;x++){
     const get=(channel:number)=>r.planar===2?sample(sourceRows[channel*page.blocksAcross+column],x,r.bits,inspection.reader.little):sample(sourceRows[column],x*r.samples+channel,r.bits,inspection.reader.little),alphaSample=page.alpha?get(colorSamples):maximum,alpha=alphaSample/maximum,at=(rows*r.width+source.x+x)*4;
     for(let c=0;c<3;c++){let color:number;if(r.photometric===3){const palette=new DataView(page.palette!.buffer,page.palette!.byteOffset,page.palette!.byteLength);color=(palette.getUint16((c*2**r.bits+get(0))*2,inspection.reader.little)>>>8)/255;}else{color=get(r.photometric===2?c:0)/maximum;if(r.photometric===0)color=1-color;}if(page.alpha===1)color=alphaSample?(r.photometric===3?color*maximum:(r.photometric===0?maximum-get(0):get(r.photometric===2?c:0)))/alphaSample:0;output[at+c]=Math.max(0,Math.min(255,Math.round(color*255)));}output[at+3]=Math.round(alpha*255);
    }}
    rows++;const completed=blockY*page.blockHeight+y+1;if(rows===rowsPerBatch||completed===r.height){await encoder.append(output.subarray(0,rows*r.width*4),rows);rows=0;output=new Uint8Array(r.width*rowsPerBatch*4);progress?.(completed/r.height);}
   }
   for(const source of active){await source.cursor.skip(source.rowBytes*(storedRows-blockRows));await source.cursor.end();await source.cursor.close();cursors.splice(cursors.indexOf(source.cursor),1);}
  }
  return{png:await encoder.finish(),page:r,report:inspection.report};
 }catch(error){await encoder.abort(error);throw error;}
 finally{await Promise.allSettled(cursors.map(c=>c.close()));}
}
