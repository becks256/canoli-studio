import {expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {LensCorrection,RawDevelopment} from '../src/dom';
import {lensCorrectionSchema,validateLensGeometry} from '../src/core/interchange/raw/lens';
import {rawLensSampler} from '../src/core/interchange/raw/lens-sampler';
import {developServerRaw} from '../server/raw';
import {openPngRows} from '../server/png-rows';
import type {OwnedRawImage} from '../src/core/interchange/raw/codec';
async function rgba(blob:Blob){const image=openPngRows(new Uint8Array(await blob.arrayBuffer())),parts:Uint8ClampedArray[]=[];for await(const strip of image.strips)parts.push(strip.pixels);return Buffer.concat(parts.map(p=>Buffer.from(p)));}
it('owns immutable lens calibration values, leaves ordinary RAW settings compatible, and refuses unknown/non-finite fields',()=>{
 const lens=new LensCorrection({distortion:{k1:-.05}}),development=new RawDevelopment({lens}),saved=development.toJSON();saved.lens!.distortion.k1=1;
 expect(development.toJSON().lens!.distortion.k1).toBe(-.05);expect(lens.toJSON().distortion.k1).toBe(-.05);expect(new RawDevelopment().toJSON()).not.toHaveProperty('lens');
 for(const bad of [{distortion:{k1:Infinity}},{scale:0},{chromatic:{red:0}},{camera:'Automatic'}])expect(()=>new LensCorrection(bad as any)).toThrow();
 expect(Object.isFrozen(development)).toBe(true);expect(Object.isFrozen((development as any).settings.lens.distortion)).toBe(true);
});
it('rejects radial folds and nonpositive vignette attenuation across the whole image before reading native pixels',()=>{
 expect(()=>validateLensGeometry(lensCorrectionSchema.parse({distortion:{k1:-1}}),64,48)).toThrow(/folds/);
 expect(()=>validateLensGeometry(lensCorrectionSchema.parse({vignette:{k1:-1}}),64,48)).toThrow(/positive/);
 const image={width:64,height:48,channels:3,readRegion(){throw new Error('Must not read');}}as unknown as OwnedRawImage;
 expect(()=>rawLensSampler(image,lensCorrectionSchema.parse({distortion:{k1:-1}}))).toThrow(/folds/);
});
for(const name of ['barrel','pincushion','chromatic','vignette','combined'])it(`actual native linear RAW ${name} correction matches independent NumPy pixels and preserves the original`,async()=>{
 const manifest=JSON.parse(await readFile('tests/fixtures/raw-lens/manifest.json','utf8')),fixture=manifest.cases.find((value:{name:string})=>value.name===name),original=new Blob([new Uint8Array(await readFile('tests/fixtures/raw/bayer-rggb.dng'))],{type:'image/x-adobe-dng'}),before=await original.arrayBuffer();
 const result=await developServerRaw(original,{allowPrecisionLoss:true,development:{lens:fixture.options}}),reference=new Blob([new Uint8Array(await readFile('tests/fixtures/raw-lens/'+name+'.png'))],{type:'image/png'});
 expect(await rgba(result.png)).toEqual(await rgba(reference));expect(await original.arrayBuffer()).toEqual(before);
},30000);
it('neutral and disabled lens correction retain exact previous working pixels',async()=>{
 const original=new Blob([new Uint8Array(await readFile('tests/fixtures/raw/bayer-rggb.dng'))]),a=await developServerRaw(original,{allowPrecisionLoss:true});
 for(const lens of [{},{enabled:false,distortion:{k1:-1}}])expect(await rgba((await developServerRaw(original,{allowPrecisionLoss:true,development:{lens}})).png)).toEqual(await rgba(a.png));
},30000);

it('straightens independently inverse-distorted calibration lines instead of merely moving pixels',async()=>{
 const bytes=await readFile('tests/fixtures/raw-lens/distorted-grid.rgb16le'),plane=new Uint16Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/2).slice(),image={width:64,height:48,channels:3,readRegion(x:number,y:number,w:number,h:number){const tile=new Uint16Array(w*h*3);for(let row=0;row<h;row++)tile.set(plane.subarray(((y+row)*64+x)*3,((y+row)*64+x+w)*3),row*w*3);return tile;}}as unknown as OwnedRawImage;
 const sampler=rawLensSampler(image,lensCorrectionSchema.parse({distortion:{k1:-.07}})),output=sampler.rows(0,48).pixels;
 const error=(pixels:Uint16Array)=>{let sum=0,count=0;for(const line of [16,48])for(let y=8;y<40;y++){let mass=0,position=0;for(let x=line-4;x<=line+4;x++){const value=pixels[(y*64+x)*3+1];mass+=value;position+=x*value;}sum+=(position/mass-line)**2;count++;}return Math.sqrt(sum/count);};
 const before=error(plane),after=error(output);expect(before).toBeGreaterThan(.3);expect(after).toBeLessThan(before/4);sampler.dispose();
});

it('native region reads return owned accurate rectangles, validate bounds and expire with their image lease',async()=>{
 const {default:createRaw}=await import('../src/core/interchange/raw/codec/canoli_raw_decoder.js'),{rawDecoder}=await import('../src/core/interchange/raw/codec'),module=await createRaw({wasmBinary:new Uint8Array(await readFile('src/core/interchange/raw/codec/canoli_raw_decoder.wasm'))}),decoder=rawDecoder(module),input=new Uint8Array(await readFile('tests/fixtures/raw/bayer-rggb.dng')),image=decoder.develop(input),all=image.readRows(0,image.height),region=image.readRegion!(5,7,9,11);
 for(let y=0;y<11;y++)expect(region.subarray(y*9*3,(y+1)*9*3)).toEqual(all.subarray(((7+y)*64+5)*3,((7+y)*64+14)*3));
 region.fill(0);expect(image.readRegion!(5,7,9,11)).not.toEqual(region);expect(()=>image.readRegion!(-1,0,1,1)).toThrow(/region/);image.dispose();expect(()=>image.readRegion!(0,0,1,1)).toThrow(/disposed/);expect(decoder.inspect(input).canDevelop).toBe(true);
});

it('lens sampling bounds source rectangle allocation independently of original image width',()=>{
 const intervals:number[][]=[],image={width:10000,height:128,channels:3,readRegion(x:number,y:number,w:number,h:number){intervals.push([x,y,w,h]);return Uint16Array.from({length:w*h*3},(_,i)=>(x+y+i)%65536);}}as unknown as OwnedRawImage;
 const sampler=rawLensSampler(image,lensCorrectionSchema.parse({scale:1.01,vignette:{k1:-.1}}));sampler.rows(0,28);sampler.rows(28,28);expect(intervals.length).toBeGreaterThan(1);expect(intervals.every(([, ,w,h])=>w<=32&&h<=32)).toBe(true);sampler.dispose();
});
