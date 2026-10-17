import {expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {openPngRows} from '../server/png-rows';
import {crc32} from 'node:zlib';

it('headless PNG rows decode all five filters, palette/gray/RGB/alpha and tRNS against independent Pillow pixels',async()=>{
  const fixtures=JSON.parse(await readFile('tests/fixtures/color-range/png-reference.json','utf8'));
  expect(fixtures).toHaveLength(5);
  for(const fixture of fixtures){
    const png=openPngRows(new Uint8Array(await readFile('tests/fixtures/color-range/'+fixture.file)));
    expect([png.width,png.height]).toEqual([fixture.width,fixture.height]);const actual:number[]=[];
    for await(const strip of png.strips)actual.push(...strip.pixels);
    expect(actual,fixture.file).toEqual(fixture.expected);
  }
});

it('native 50 MP PNG decoding retains bounded strips, full geometry and distant source pixels',async()=>{
  const png=openPngRows(new Uint8Array(await readFile('tests/fixtures/color-range/native-50mp.png')));
  expect([png.width,png.height]).toEqual([10000,5000]);let rows=0,maxBytes=0;
  const samples:number[][]=[];
  for await(const strip of png.strips){
    expect(strip.y).toBe(rows);rows+=strip.height;maxBytes=Math.max(maxBytes,strip.pixels.byteLength);
    for(const [x,y] of [[0,0],[9999,0],[0,4999],[9999,4999]])if(y>=strip.y&&y<strip.y+strip.height){const offset=((y-strip.y)*10000+x)*4;samples.push(Array.from(strip.pixels.slice(offset,offset+4)));}
  }
  expect(rows).toBe(5000);expect(maxBytes).toBeLessThanOrEqual(1_000_000);
  expect(samples).toEqual([[255,0,0,255],[0,0,255,255],[0,0,255,255],[255,0,0,255]]);
},30000);

it('unsupported precision/profiles and corrupted PNG chunks reject explicitly',async()=>{
  for(const name of ['unsupported-16bit.png','unsupported-profile.png']){
    const bytes=new Uint8Array(await readFile('tests/fixtures/color-range/'+name));
    expect(()=>openPngRows(bytes)).toThrow(/8-bit|profiled/);
  }
  const valid=new Uint8Array(await readFile('tests/fixtures/color-range/filters-type-6.png'));
  const corrupt=valid.slice();corrupt[45]^=1;expect(()=>openPngRows(corrupt)).toThrow(/checksum/);
  expect(()=>openPngRows(valid.slice(0,-3))).toThrow(/Truncated|Incomplete/);
  const trailing=new Uint8Array(valid.length+1);trailing.set(valid);expect(()=>openPngRows(trailing)).toThrow(/end/);
});

it('rejects misplaced palette/color declarations and unsupported HDR metadata with valid chunk checksums',async()=>{
  const fixture=Buffer.from(await readFile('tests/fixtures/color-range/filters-type-2.png'));
  const chunks:Buffer[]=[];
  for(let offset=8;offset<fixture.length;){const end=offset+12+fixture.readUInt32BE(offset);chunks.push(fixture.subarray(offset,end));offset=end;}
  const chunk=(name:string,data:Buffer)=>{const out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);out.write(name,4,'ascii');data.copy(out,8);out.writeUInt32BE(crc32(out.subarray(4,-4)),out.length-4);return out;};
  const ihdr=chunks.find(value=>value.toString('ascii',4,8)==='IHDR')!;
  const pixels=chunks.filter(value=>['IDAT','IEND'].includes(value.toString('ascii',4,8)));
  const srgb=chunk('sRGB',Buffer.from([0])),palette=chunk('PLTE',Buffer.from([255,0,0]));
  const png=(metadata:Buffer[])=>Buffer.concat([fixture.subarray(0,8),ihdr,...metadata,...pixels]);
  const valid=openPngRows(png([srgb,palette]));let decoded=0;for await(const strip of valid.strips)decoded+=strip.height;expect(decoded).toBe(valid.height);
  expect(()=>openPngRows(png([palette,srgb]))).toThrow(/sRGB declaration/);
  for(const [name,length] of [['gAMA',4],['cHRM',32]] as const)
    expect(()=>openPngRows(png([srgb,palette,chunk(name,Buffer.alloc(length))]))).toThrow(/color declaration/);
  expect(()=>openPngRows(png([srgb,chunk('tRNS',Buffer.alloc(6)),palette]))).toThrow(/palette/);
  for(const [name,length] of [['cICP',4],['mDCV',24],['cLLI',8]] as const)
    expect(()=>openPngRows(png([srgb,chunk(name,Buffer.alloc(length))]))).toThrow(/profiled\/HDR/);
});
