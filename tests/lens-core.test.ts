import {expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import createLens from '../src/core/interchange/lens/codec/canoli_lens_correction.js';
import {lensCorrectionCodec} from '../src/core/interchange/lens/codec';
import {lensProfileSchema,type LensProfileOptions} from '../src/core/interchange/lens/schema';

const base='tests/fixtures/lens-core/',manifest=JSON.parse(await readFile(base+'manifest.json','utf8'));
async function module(){return createLens({wasmBinary:new Uint8Array(await readFile('src/core/interchange/lens/codec/canoli_lens_correction.wasm'))});}
const options=(definition=manifest.profiles.ptlens)=>({definition,focalLength:43,cropFactor:1.5,aperture:5.6,focusDistance:10,distortion:true,chromatic:true,vignette:true});
for(const fixture of manifest.cases)it(`native Lensfun ${fixture.file} coordinates and gains match the complete independent library`,async()=>{
 const codec=lensCorrectionCodec(await module()),lease=codec.prepare({...options(manifest.profiles[fixture.model]),focalLength:fixture.focalLength,cropFactor:fixture.cropFactor,aperture:fixture.aperture,focusDistance:fixture.focusDistance},{width:fixture.width,height:fixture.height,flip:fixture.flip},fixture.scale);
 try{
  const body=await readFile(base+fixture.file),reference=new DataView(body.buffer,body.byteOffset,body.byteLength),coordinates=lease.coordinates(fixture.left,fixture.top,64,48),gains=lease.gains(fixture.left,fixture.top,64,48);let maximum=0;
  for(let i=0;i<coordinates.length;i++)maximum=Math.max(maximum,Math.abs(coordinates[i]-reference.getFloat32(i*4,true)));
  for(let i=0;i<gains.length;i++)maximum=Math.max(maximum,Math.abs(gains[i]-reference.getFloat32((coordinates.length+i)*4,true)));
  expect(maximum).toBe(0);expect(lease.report.applied).toBe(43);expect(Object.isFrozen(lease.report.coefficients)).toBe(true);
 }finally{lease.dispose();}
});

it('preserves exact absolute coordinates and gains across irregular job partitions',async()=>{
 const lease=lensCorrectionCodec(await module()).prepare(options(),{width:10000,height:5000},1.05),whole=lease.coordinates(8192,3072,64,48),gains=lease.gains(8192,3072,64,48);
 try{for(const[x,y,w,h]of [[0,0,13,11],[13,0,51,11],[0,11,64,37],[7,9,41,23]]){
  const piece=lease.coordinates(8192+x,3072+y,w,h),g=lease.gains(8192+x,3072+y,w,h);
  for(let row=0;row<h;row++){expect(piece.subarray(row*w*6,(row+1)*w*6)).toEqual(whole.subarray(((y+row)*64+x)*6,((y+row)*64+x+w)*6));expect(g.subarray(row*w,(row+1)*w)).toEqual(gains.subarray((y+row)*64+x,(y+row)*64+x+w));}
 }}finally{lease.dispose();}
});

it('owns copied outputs across heap growth, enforces one output lifetime and admits clean reuse',async()=>{
 const native=await module(),codec=lensCorrectionCodec(native),lease=codec.prepare(options(),{width:128,height:64}),coordinates=lease.coordinates(0,0,64,48),before=coordinates.slice();
 expect(()=>codec.prepare(options(),{width:64,height:48})).toThrow(/previous lens/);lease.gains(0,0,64,48);const pointer=native._malloc(20000000);try{expect(coordinates).toEqual(before);}finally{if(pointer)native._free(pointer);}
 coordinates.fill(0);expect(lease.coordinates(0,0,64,48)).not.toEqual(coordinates);lease.dispose();lease.dispose();expect(()=>lease.gains(0,0,1,1)).toThrow(/disposed/);const next=codec.prepare(options(),{width:64,height:48});next.dispose();
});

it('keeps scratch budgets independent of full original geometry and rejects invalid intervals',async()=>{
 const lease=lensCorrectionCodec(await module()).prepare(options(),{width:10000,height:5000});
 try{for(const region of [[-1,0,1,1],[0,0,0,1],[9999,4999,2,1],[0,0,10000,100]])expect(()=>lease.coordinates(...region as [number,number,number,number])).toThrow(/region|budget/);expect(lease.coordinates(9999,4999,1,1)).toHaveLength(6);}finally{lease.dispose();}
});

it('neutral calibrated values preserve exact integer coordinates and unit gains',async()=>{
 const definition=structuredClone(manifest.profiles.poly3);for(const frame of definition.calibrations){for(const point of frame.distortion)point.terms=[0];for(const point of frame.chromatic)point.terms=[1,1,0,0,0,0];for(const point of frame.vignette)point.terms=[0,0,0];}
 const lease=lensCorrectionCodec(await module()).prepare(options(definition),{width:64,height:48});
 try{expect(lease.report.applied).toBe(0);const coordinates=lease.coordinates(3,4,5,7);for(let y=0;y<7;y++)for(let x=0;x<5;x++)for(let c=0;c<3;c++)expect([...coordinates.subarray((y*5+x)*6+c*2,(y*5+x)*6+c*2+2)]).toEqual([3+x,4+y]);expect([...lease.gains(3,4,5,7)]).toEqual(Array(35).fill(1));}finally{lease.dispose();}
});

for(const kind of ['distortion','chromatic','vignette']as const)it(`rejects invalid ${kind} geometry before creating active output and permits clean retry`,async()=>{
 const codec=lensCorrectionCodec(await module()),definition=structuredClone(manifest.profiles.poly3);
 for(const set of definition.calibrations)for(const point of set[kind])point.terms=kind==='distortion'?[-1]:kind==='chromatic'?[1,1,-1,-1,0,0]:[-1,0,0];
 expect(()=>codec.prepare(options(definition),{width:64,height:48})).toThrow(/folds|attenuation/);const retry=codec.prepare(options(),{width:64,height:48});retry.dispose();
});

it('refuses duplicate and mixed-model native calibration coordinates and unsupported models',()=>{
 const definition=structuredClone(manifest.profiles.poly3);definition.calibrations[0].distortion.push({...definition.calibrations[0].distortion[0]});expect(()=>lensProfileSchema.parse(definition)).toThrow(/Duplicate/);
 definition.calibrations[0].distortion.pop();definition.calibrations[0].distortion[1]={model:'poly5',focalLength:35,terms:[0,0]};expect(()=>lensProfileSchema.parse(definition)).toThrow(/Mixed/);
 expect(()=>lensProfileSchema.parse({...manifest.profiles.poly3,type:'fisheye'})).toThrow();expect(()=>lensProfileSchema.parse({...manifest.profiles.poly3,code:'execute'}as LensProfileOptions)).toThrow();
});
