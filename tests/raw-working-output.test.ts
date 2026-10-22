import {afterEach,expect,it,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import {rawLinearRowsToRgba8,encodeRawWorkingImage} from '../src/core/interchange/raw/working-output';
import type {OwnedRawImage} from '../src/core/interchange/raw/codec';
import {openPngRows} from '../server/png-rows';
afterEach(()=>vi.unstubAllGlobals());

it('matches the independent sRGB transfer at every linear16 sample and always produces opaque coverage',async()=>{
  const source=Uint16Array.from({length:65536},(_,i)=>i),expected=await readFile('tests/fixtures/raw/srgb8-lut.bin'),actual=rawLinearRowsToRgba8(source,1);
  let mismatch=0,alpha=0;for(let i=0;i<source.length;i++){for(let c=0;c<3;c++)if(actual[i*4+c]!==expected[i])mismatch++;if(actual[i*4+3]!==255)alpha++;}
  expect(mismatch).toBe(0);expect(alpha).toBe(0);expect(source[32768]).toBe(32768);
  expect([...rawLinearRowsToRgba8(new Uint16Array([65535,0,32768]),3)]).toEqual([255,0,expected[32768],255]);
  expect(()=>rawLinearRowsToRgba8(new Uint16Array(2),3)).toThrow();
});

function image(width=17,height=13){
  let disposed=0;const intervals:number[][]=[];
  const value={width,height,channels:3 as const,report:{}as OwnedRawImage['report'],readRows(top:number,rows:number){intervals.push([top,rows]);return Uint16Array.from({length:width*rows*3},(_,i)=>(top*width*3+i)%65536);},dispose(){disposed++;}};
  return{value,intervals,get disposed(){return disposed;}};
}
it('encodes actual row samples with sRGB identification and releases its native owner after completion',async()=>{
  const owned=image(),progress:number[]=[],blob=await encodeRawWorkingImage(owned.value,value=>progress.push(value)),bytes=new Uint8Array(await blob.arrayBuffer());
  const png=openPngRows(bytes);expect([png.width,png.height]).toEqual([17,13]);
  const chunks:Uint8ClampedArray[]=[];for await(const strip of png.strips)chunks.push(strip.pixels);
  const actual=new Uint8Array(chunks.reduce((size,part)=>size+part.length,0));let offset=0;for(const part of chunks){actual.set(part,offset);offset+=part.length;}
  expect(actual).toEqual(rawLinearRowsToRgba8(Uint16Array.from({length:17*13*3},(_,i)=>i),3));
  expect(String.fromCharCode(...bytes.slice(37,41))).toBe('sRGB');expect(progress[0]).toBe(0);expect(progress.at(-1)).toBe(1);expect(owned.disposed).toBe(1);
});
it('bounds row allocations independently of full image geometry',async()=>{
  const owned=image(10000,128);await encodeRawWorkingImage(owned.value);
  expect(owned.intervals.reduce((rows,[,count])=>rows+count,0)).toBe(128);
  expect(Math.max(...owned.intervals.map(([,count])=>count*(10000*14+1)))).toBeLessThanOrEqual(4_000_000);
  expect(owned.intervals.length).toBeGreaterThan(1);expect(owned.disposed).toBe(1);
});
it('releases native output on callback failure, missing compression support and row-read failure',async()=>{
  const callback=image();await expect(encodeRawWorkingImage(callback.value,()=>{throw new Error('Encoding cancelled');})).rejects.toThrow('Encoding cancelled');expect(callback.disposed).toBe(1);
  const failed=image();failed.value.readRows=()=>{throw new Error('Lost native output');};await expect(encodeRawWorkingImage(failed.value)).rejects.toThrow('Lost native output');expect(failed.disposed).toBe(1);
  vi.stubGlobal('CompressionStream',class{constructor(){throw new Error('Compression unavailable');}});
  const unavailable=image();await expect(encodeRawWorkingImage(unavailable.value)).rejects.toThrow('Compression unavailable');expect(unavailable.disposed).toBe(1);
});
