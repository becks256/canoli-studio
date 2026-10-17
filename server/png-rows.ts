import { Readable } from 'node:stream';
import { createInflate } from 'node:zlib';

const crcTable=Uint32Array.from({length:256},(_,i)=>{let value=i;for(let bit=0;bit<8;bit++)value=value&1?0xedb88320^(value>>>1):value>>>1;return value>>>0;});
function crc(bytes:Uint8Array){let value=0xffffffff;for(const byte of bytes)value=crcTable[(value^byte)&255]^(value>>>8);return(value^0xffffffff)>>>0;}
function paeth(a:number,b:number,c:number){const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;}
export interface PngStrip {width:number;height:number;y:number;pixels:Uint8ClampedArray}

/** Explicit headless subset: noninterlaced 8-bit PNG, unmarked or declared sRGB.
 * Inflation retains scanlines and a bounded strip, never the full RGBA image.
 */
export function openPngRows(bytes:Uint8Array):{width:number;height:number;strips:AsyncGenerator<PngStrip>} {
  if(bytes.length<8||![137,80,78,71,13,10,26,10].every((value,i)=>bytes[i]===value))throw new Error('Color Range REST sampling requires an 8-bit PNG source.');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),idats:Uint8Array[]=[],seen=new Set<string>();
  let width=0,height=0,type=-1,ended=false,idatClosed=false,palette:Uint8Array|undefined,transparency:Uint8Array|undefined;
  for(let offset=8;offset<bytes.length;){
    if(offset+12>bytes.length)throw new Error('Truncated PNG chunk.');
    const length=view.getUint32(offset),end=offset+12+length;
    if(length>0x7fffffff)throw new Error('PNG chunk length exceeds the format range.');
    if(end>bytes.length)throw new Error('Truncated PNG payload.');
    const name=String.fromCharCode(...bytes.subarray(offset+4,offset+8)),data=bytes.subarray(offset+8,end-4);
    if(!/^[A-Za-z]{4}$/.test(name)||name[2]!==name[2].toUpperCase())throw new Error('Invalid PNG chunk name.');
    if(crc(bytes.subarray(offset+4,end-4))!==view.getUint32(end-4))throw new Error('PNG checksum mismatch.');
    if(!seen.size&&name!=='IHDR')throw new Error('PNG must begin with IHDR.');
    if(name!=='IDAT'&&seen.has('IDAT'))idatClosed=true;
    if(['IHDR','PLTE','tRNS','sRGB','gAMA','cHRM','iCCP','cICP','IEND'].includes(name)&&seen.has(name))throw new Error(`Duplicate PNG ${name}.`);
    if(name==='IHDR'){
      if(length!==13)throw new Error('Invalid PNG header.');
      width=view.getUint32(offset+8);height=view.getUint32(offset+12);type=data[9];
      if(!width||!height||width>0x7fffffff||height>0x7fffffff||!Number.isSafeInteger(width*height*4))throw new Error('PNG geometry exceeds safe indexing.');
      if(data[8]!==8||![0,2,3,4,6].includes(type)||data[10]||data[11]||data[12])throw new Error('Color Range REST supports noninterlaced 8-bit PNG only.');
    }else if(name==='PLTE'){
      if(seen.has('IDAT')||seen.has('tRNS')||type===0||type===4||!length||length%3||length>768)throw new Error('Invalid PNG palette.');palette=data;
    }else if(name==='tRNS'){
      if(seen.has('IDAT')||![0,2,3].includes(type)||(type===0&&length!==2)||(type===2&&length!==6)||(type===3&&(!palette||!length||length>palette.length/3)))throw new Error('Invalid PNG transparency.');
      if(type!==3)for(let i=0;i<length;i+=2)if(data[i]!==0)throw new Error('PNG transparent sample exceeds 8-bit range.');transparency=data;
    }else if(name==='IDAT'){
      if(idatClosed||(type===3&&!palette))throw new Error('Invalid PNG data ordering.');idats.push(data);
    }else if(name==='IEND'){
      if(length||!seen.has('IDAT')||end!==bytes.length)throw new Error('Invalid PNG end.');ended=true;
    }else if(name==='sRGB'){
      if(length!==1||data[0]>3||seen.has('PLTE')||seen.has('IDAT'))throw new Error('Invalid PNG sRGB declaration.');
    }else if(name==='gAMA'||name==='cHRM'){
      if(length!==(name==='gAMA'?4:32)||seen.has('PLTE')||seen.has('IDAT'))throw new Error('Invalid PNG color declaration.');
    }else if(name==='iCCP'||name==='cICP'||name==='mDCV'||name==='cLLI'||name==='acTL'||name==='fcTL'||name==='fdAT'){
      throw new Error('Color Range REST does not decode profiled/HDR or animated PNG sources; supply an ordinary sRGB PNG.');
    }else if((name.charCodeAt(0)&32)===0)throw new Error(`Unsupported PNG critical chunk ${name}.`);
    seen.add(name);offset=end;
  }
  if(!ended||!idats.length)throw new Error('Incomplete PNG source.');
  if((seen.has('gAMA')||seen.has('cHRM'))&&!seen.has('sRGB'))throw new Error('Color Range REST requires unmarked or explicitly sRGB PNG; color-profile conversion is not implemented.');
  const channels=type===0||type===3?1:type===2?3:type===4?2:4,rowBytes=width*channels;
  async function* strips():AsyncGenerator<PngStrip>{
    const input=Readable.from(idats),inflate=createInflate();input.pipe(inflate);
    const iterator=inflate[Symbol.asyncIterator]();let chunk=new Uint8Array(),cursor=0;
    const read=async(target:Uint8Array)=>{let offset=0;while(offset<target.length){
      if(cursor===chunk.length){const next=await iterator.next();if(next.done)throw new Error('Truncated inflated PNG rows.');chunk=next.value;cursor=0;}
      const count=Math.min(target.length-offset,chunk.length-cursor);target.set(chunk.subarray(cursor,cursor+count),offset);offset+=count;cursor+=count;
    }};
    let previous=new Uint8Array(rowBytes),current=new Uint8Array(rowBytes);const filtered=new Uint8Array(rowBytes+1);
    const bandHeight=Math.max(1,Math.min(512,Math.floor(1_000_000/(width*4))));
    try{
      for(let y=0;y<height;y+=bandHeight){
        const h=Math.min(bandHeight,height-y),pixels=new Uint8ClampedArray(width*h*4);
        for(let row=0;row<h;row++){
          await read(filtered);const filter=filtered[0];if(filter>4)throw new Error('Invalid PNG row filter.');
          for(let i=0;i<rowBytes;i++){
            const a=i>=channels?current[i-channels]:0,b=previous[i],c=i>=channels?previous[i-channels]:0;
            current[i]=(filtered[i+1]+(filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):paeth(a,b,c)))&255;
          }
          for(let x=0;x<width;x++){
            const source=x*channels,target=(row*width+x)*4;let r=current[source],g=r,b=r,a=255;
            if(type===2||type===6){g=current[source+1];b=current[source+2];if(type===6)a=current[source+3];}
            else if(type===4)a=current[source+1];
            else if(type===3){if(r*3+2>=palette!.length)throw new Error('PNG palette index is out of range.');a=transparency?.[r]??255;const index=r*3;r=palette![index];g=palette![index+1];b=palette![index+2];}
            if(type===0&&transparency&&r===transparency[1])a=0;
            if(type===2&&transparency&&r===transparency[1]&&g===transparency[3]&&b===transparency[5])a=0;
            pixels[target]=r;pixels[target+1]=g;pixels[target+2]=b;pixels[target+3]=a;
          }
          [previous,current]=[current,previous];
        }
        yield{width,height:h,y,pixels};
      }
      if(cursor<chunk.length)throw new Error('PNG has extra inflated pixel data.');
      const extra=await iterator.next();if(!extra.done)throw new Error('PNG has extra inflated pixel data.');
    }finally{input.destroy();inflate.destroy();}
  }
  return{width,height,strips:strips()};
}
