import {beforeAll,expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import createRaw,{type NativeRawModule} from '../src/core/interchange/raw/codec/canoli_raw_decoder.js';
import {rawDecoder} from '../src/core/interchange/raw/codec';
import {rawDevelopOptionsSchema} from '../src/core/interchange/raw/types';

const base='tests/fixtures/raw/';
const manifest=JSON.parse(await readFile(base+'manifest.json','utf8'))as {cases:{file:string;reference:string;width:number;height:number;channels:number;rawWidth:number;rawHeight:number;options:{whiteBalance:'camera'|'auto'}}[]};
let decoder:ReturnType<typeof rawDecoder>;
let native:NativeRawModule;
beforeAll(async()=>{native=await createRaw({wasmBinary:new Uint8Array(await readFile('src/core/interchange/raw/codec/canoli_raw_decoder.wasm'))});decoder=rawDecoder(native);});

for(const fixture of manifest.cases.filter(value=>!value.file.endsWith('.gz')))it(`develops ${fixture.file} against independent native linear RGB16 samples`,async()=>{
  const bytes=new Uint8Array(await readFile(base+fixture.file)),before=bytes.slice(),inspection=decoder.inspect(bytes);
  expect(inspection).toMatchObject({rawWidth:fixture.rawWidth,rawHeight:fixture.rawHeight,displayWidth:fixture.width,displayHeight:fixture.height,canDevelop:true,hasColorMatrix:true});
  const image=decoder.develop(bytes,fixture.options);
  try{
    expect([image.width,image.height,image.channels]).toEqual([fixture.width,fixture.height,fixture.channels]);
    const actual=image.readRows(0,image.height),ref=await readFile(base+fixture.reference),view=new DataView(ref.buffer,ref.byteOffset,ref.byteLength);
    expect(actual.byteLength).toBe(ref.byteLength);let maximum=0;
    for(let i=0;i<actual.length;i++)maximum=Math.max(maximum,Math.abs(actual[i]-view.getUint16(i*2,true)));
    expect(maximum).toBe(0);expect(bytes).toEqual(before);expect(Object.isFrozen(image)).toBe(true);expect(Object.isFrozen(image.report)).toBe(true);
    const first=image.readRows(0,1);first.fill(0);expect(image.readRows(0,1).some(value=>value>0)).toBe(true);
  }finally{image.dispose();image.dispose();}
  expect(()=>image.readRows(0,1)).toThrow(/disposed/);
});

it('requires camera calibration and an explicit alternative when camera white balance is missing',async()=>{
  const uncalibrated=new Uint8Array(await readFile(base+'no-calibration.dng'));
  expect(decoder.inspect(uncalibrated)).toMatchObject({canDevelop:false,hasColorMatrix:false});
  expect(()=>decoder.develop(uncalibrated)).toThrow(/calibration/);
  const missing=new Uint8Array(await readFile(base+'no-camera-wb.dng'));expect(decoder.inspect(missing).hasCameraWhiteBalance).toBe(false);
  expect(()=>decoder.develop(missing)).toThrow(/white balance/);
  const image=decoder.develop(missing,{whiteBalance:'daylight'});image.dispose();
});

it('strictly validates development choices and keeps previous output owned until release',async()=>{
  const bytes=new Uint8Array(await readFile(base+'bayer-rggb.dng')),image=decoder.develop(bytes);
  expect(()=>decoder.develop(bytes)).toThrow(/previous RAW image/);expect(()=>decoder.inspect(bytes)).toThrow(/previous RAW image/);
  for(const [top,rows]of [[-1,1],[0,0],[image.height,1],[0,0.5]])expect(()=>image.readRows(top,rows)).toThrow(/row interval/);
  image.dispose();
  for(const options of [{exposure:4},{exposure:NaN},{image:-1},{highlights:1.5},{whiteBalance:'invented'},{multipliers:{red:0}},{extra:true}])expect(()=>decoder.develop(bytes,options as never)).toThrow();
  expect(rawDevelopOptionsSchema.parse({})).toEqual({image:0,whiteBalance:'camera',demosaic:'ahd',exposure:0,highlightPreservation:0,highlights:0,multipliers:{red:1,green:1,blue:1}});
  const retry=decoder.develop(bytes);retry.dispose();
});

it('rejects malformed/truncated inputs and remains reusable without publishing partial sensor data',async()=>{
  const bytes=new Uint8Array(await readFile(base+'bayer-rggb.dng'));
  for(const value of [new Uint8Array(),bytes.slice(0,9),bytes.slice(0,bytes.length-3000)])expect(()=>decoder.develop(value)).toThrow();
  const retry=decoder.develop(bytes);expect(retry.readRows(0,1).length).toBe(64*3);retry.dispose();
});

it('rejects reentrant native preparation without replacing the active input or output',async()=>{
  const bytes=new Uint8Array(await readFile(base+'bayer-rggb.dng'));let attempted=false,error='';
  native.canoliRawProgress=()=>{if(attempted)return;attempted=true;try{decoder.inspect(bytes);}catch(cause){error=String(cause);}};
  try{const image=decoder.develop(bytes);image.dispose();}finally{delete native.canoliRawProgress;}
  expect(attempted).toBe(true);expect(error).toMatch(/previous RAW image/);
});

it('refuses to turn RAW extra-sample coverage into an opaque developed image',async()=>{
  const bytes=new Uint8Array(await readFile(base+'extra-samples.dng'));
  const report=decoder.inspect(bytes);expect(report).toMatchObject({hasExtraSamples:true,canDevelop:false});
  expect(()=>decoder.develop(bytes)).toThrow(/extra sample/);
});

it('rejects selected TIFF dimensions that cannot fit the native geometry fields instead of narrowing them',async()=>{
  const bytes=new Uint8Array(await readFile(base+'bayer-rggb.dng')),view=new DataView(bytes.buffer),ifd=view.getUint32(4,true),count=view.getUint16(ifd,true);
  for(let i=0;i<count;i++){const at=ifd+2+i*12;if(view.getUint16(at,true)===256)view.setUint32(at+8,100000,true);}
  expect(()=>decoder.inspect(bytes)).toThrow();expect(()=>decoder.develop(bytes)).toThrow();
  const retry=decoder.develop(new Uint8Array(await readFile(base+'bayer-rggb.dng')));retry.dispose();
});
