import {describe,it,expect} from 'vitest';
import {inflateSync} from 'node:zlib';
import {TiffTileEncoder} from '../src/engine/tiff';
import {planTiffDirectory,validateTiffGeometry,validateTiffVariant} from '../src/core/tiff';
import {STANDARD_PROFILES} from '../src/core/color/icc';

// Independent test-side tag reader, not used by the exporter.
function fields(bytes:Uint8Array){const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),big=v.getUint16(2,true)===43,ifd=big?Number(v.getBigUint64(8,true)):v.getUint32(4,true),count=big?Number(v.getBigUint64(ifd,true)):v.getUint16(ifd,true),out=new Map<number,{type:number;count:number;data:Uint8Array;values:number[]}>();const tags:number[]=[];
 for(let i=0;i<count;i++){const at=ifd+(big?8:2)+i*(big?20:12),tag=v.getUint16(at,true),type=v.getUint16(at+2,true),n=big?Number(v.getBigUint64(at+4,true)):v.getUint32(at+4,true),size=type===3?2:type===4?4:type===5||type===16?8:1,slot=at+(big?12:8),start=n*size<=(big?8:4)?slot:big?Number(v.getBigUint64(slot,true)):v.getUint32(slot,true),data=bytes.slice(start,start+n*size),dv=new DataView(data.buffer),values=Array.from({length:n},(_,j)=>type===3?dv.getUint16(j*2,true):type===4?dv.getUint32(j*4,true):type===16?Number(dv.getBigUint64(j*8,true)):type===5?dv.getUint32(j*8,true)/dv.getUint32(j*8+4,true):data[j]);out.set(tag,{type,count:n,data,values});tags.push(tag);}
 return{big,ifd,out,tags,next:big?Number(v.getBigUint64(ifd+8+count*20,true)):v.getUint32(ifd+2+count*12,true)};
}
describe('lossless native TIFF containers',()=>{
 for(const variant of ['auto','classic','big'] as const)it(`writes ${variant} RGBA tiles with independent Deflate decode and ICC tags`,async()=>{
  const encoder=new TiffTileEncoder(16,16,variant),pixels=Uint8Array.from({length:16*16*4},(_,i)=>i%4===3?Math.floor(i/4):(i*37)%256),before=pixels.slice();await encoder.append(pixels);const blob=encoder.finish(),bytes=new Uint8Array(await blob.arrayBuffer()),parsed=fields(bytes);expect(blob.type).toBe('image/tiff');expect(parsed.big).toBe(variant==='big');expect(parsed.next).toBe(0);expect(parsed.tags).toEqual([...parsed.tags].sort((a,b)=>a-b));
  for(const[tag,value]of [[256,16],[257,16],[259,8],[262,2],[274,1],[277,4],[284,1],[296,2],[338,2]])expect(parsed.out.get(tag)!.values).toEqual([value]);expect(parsed.out.get(258)!.values).toEqual([8,8,8,8]);expect(parsed.out.get(282)!.values).toEqual([72]);expect(parsed.out.get(283)!.values).toEqual([72]);expect(parsed.out.get(34675)!.data).toEqual(STANDARD_PROFILES.srgb.iccBytes);expect(new TextDecoder().decode(parsed.out.get(305)!.data)).toBe('Canoli Studio\0');
  const offset=parsed.out.get(324)!.values[0],size=parsed.out.get(325)!.values[0];expect(parsed.out.get(324)!.type).toBe(variant==='big'?16:4);expect(offset%8).toBe(0);expect(new Uint8Array(inflateSync(bytes.subarray(offset,offset+size)))).toEqual(pixels);expect(pixels).toEqual(before);expect(()=>encoder.finish()).toThrow(/Incomplete/);await expect(encoder.append(pixels)).rejects.toThrow(/not accepting/);
 });
 it('retains tile order and padded edge geometry across both tile boundaries',async()=>{
  const encoder=new TiffTileEncoder(2049,65),sources=[];for(let i=0;i<encoder.totalTiles;i++){const data=new Uint8Array(encoder.tileWidth*encoder.tileHeight*4);data.fill(10+i);sources.push(data);await encoder.append(data);}const bytes=new Uint8Array(await encoder.finish().arrayBuffer()),parsed=fields(bytes);expect(encoder.totalTiles).toBe(4);expect(parsed.out.get(322)!.values).toEqual([2048]);expect(parsed.out.get(323)!.values).toEqual([64]);const offsets=parsed.out.get(324)!.values,counts=parsed.out.get(325)!.values;for(let i=0;i<4;i++)expect(Buffer.compare(inflateSync(bytes.subarray(offsets[i],offsets[i]+counts[i])),Buffer.from(sources[i]))).toBe(0);
 });
 it('selects BigTIFF from payload plus metadata growth without allocating a multi-GiB image',()=>{
  const payload=Math.floor((0xffffffff-8-64)/8)*8,input={width:16,height:16,tileWidth:16,tileHeight:16,offsets:[0],counts:[payload],payloadBytes:payload,profile:new Uint8Array(STANDARD_PROFILES.srgb.iccBytes!)};
  const result=planTiffDirectory(input);expect(result.bigTiff).toBe(true);expect(new DataView(result.header.buffer).getBigUint64(8,true)).toBe(BigInt(payload+16));expect(result.fileBytes).toBeGreaterThan(0xffffffff);expect(()=>planTiffDirectory({...input,variant:'classic'})).toThrow(/4 GiB/);
 });
 it('rejects invalid geometry, table overlaps, missing tiles and integer truncation',()=>{
  for(const n of [0,-1,.5,NaN,Infinity,0x100000000])expect(()=>validateTiffGeometry(n,16)).toThrow(/geometry/);expect(()=>validateTiffVariant('maybe')).toThrow(/container/);
  const good={width:16,height:16,tileWidth:16,tileHeight:16,offsets:[0],counts:[8],payloadBytes:8,profile:new Uint8Array([1])};
  for(const patch of [{tileWidth:15},{offsets:[]},{counts:[0]},{offsets:[1]},{counts:[9]},{payloadBytes:16},{payloadBytes:7},{profile:new Uint8Array()}])expect(()=>planTiffDirectory({...good,...patch})).toThrow();
 });
 it('does not resurrect an encoder aborted while compression is pending',async()=>{
  const encoder=new TiffTileEncoder(16,16),pending=encoder.append(new Uint8Array(1024));encoder.abort();await expect(pending).rejects.toThrow(/cancelled/);expect(()=>encoder.finish()).toThrow(/Incomplete/);
 });
 it('propagates an actual abort reason and accepts no later partial output',async()=>{
  const encoder=new TiffTileEncoder(16,16),abort=new AbortController(),reason=new Error('TIFF cancelled');abort.abort(reason);await expect(encoder.append(new Uint8Array(1024),{signal:abort.signal})).rejects.toBe(reason);expect(()=>encoder.finish()).toThrow(/Incomplete/);
 });
});
