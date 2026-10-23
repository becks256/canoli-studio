import {expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {LensProfile,RawDevelopment} from '../src/dom';
import {developServerRaw} from '../server/raw';
import {openPngRows} from '../server/png-rows';
import {prepareRawDerivation} from '../src/core/interchange/raw/derive';
import {rawSourceMetadataSchema} from '../src/core/interchange/raw/source';
import {validateRawDevelopmentResult} from '../src/core/interchange/raw/result';
import {rawDecodeOptionsSchema} from '../src/core/interchange/raw/types';
import {prepareRawLens} from '../src/core/interchange/raw/profile';
import {rawLensSampler} from '../src/core/interchange/raw/lens-sampler';
import type {OwnedRawImage} from '../src/core/interchange/raw/codec';
import lensBuild from '../src/core/interchange/lens/codec/build.json';

const base='tests/fixtures/raw-profile/',manifest=JSON.parse(await readFile(base+'manifest.json','utf8'));
async function original(name='bayer-rggb.dng'){return new Blob([new Uint8Array(await readFile('tests/fixtures/raw/'+name))],{type:'image/x-adobe-dng'});}
async function rgba(blob:Blob){const image=openPngRows(new Uint8Array(await blob.arrayBuffer())),parts:Uint8ClampedArray[]=[];for await(const strip of image.strips)parts.push(strip.pixels);return Buffer.concat(parts.map(p=>Buffer.from(p)));}

for(const fixture of manifest.cases.filter((value:{source:string})=>!value.source.endsWith('.gz')))it(`native profile ${fixture.file} preserves every independent linear-light sample`,async()=>{
  const blob=await original(fixture.source),before=await blob.arrayBuffer();
  const result=await developServerRaw(blob,{allowPrecisionLoss:true,development:{lens:fixture.options}});
  expect(await rgba(result.png)).toEqual(await rgba(new Blob([new Uint8Array(await readFile(base+fixture.file))])));
  expect(result.report).toMatchObject({displayWidth:fixture.width,displayHeight:fixture.height,flip:fixture.flip});
  expect(result.lensWasmSha256).toBe(lensBuild.artifacts['canoli_lens_correction.wasm'].sha256);expect(await blob.arrayBuffer()).toEqual(before);
},30000);

it('owns complete immutable profiles and correction settings without inferring focal length or crop',()=>{
  const definition=structuredClone(manifest.cases[0].options.profile.definition),profile=new LensProfile(definition);
  definition.calibrations[0].distortion[0].terms[0]=1;const copy=profile.toJSON();copy.calibrations[0].distortion[0].terms[0]=1;
  const correction=profile.correction({focalLength:43,cropFactor:1.5}),development=new RawDevelopment({lens:correction}),saved=development.toJSON();
  expect(saved.lens!.profile).toMatchObject({focalLength:43,cropFactor:1.5,distortion:true,chromatic:true,vignette:false,aperture:null,focusDistance:null});
  expect(saved.lens!.profile!.definition.calibrations[0].distortion[0].terms[0]).not.toBe(1);expect(Object.isFrozen((profile as any).definition.calibrations[0].distortion[0].terms)).toBe(true);
  saved.lens!.profile!.definition.model='Altered';expect(development.toJSON().lens!.profile!.definition.model).not.toBe('Altered');
  for(const bad of [{cropFactor:1.5},{focalLength:43},{focalLength:0,cropFactor:1.5},{focalLength:43,cropFactor:1e-99},{focalLength:43,cropFactor:1.5,vignette:true},{focalLength:43,cropFactor:1.5,unknown:1}])expect(()=>profile.correction(bad as any)).toThrow();
  expect(()=>new RawDevelopment({lens:{profile:manifest.cases[0].options.profile,distortion:{k1:.01}}})).toThrow(/combined/);
});

it('retains calibrated source provenance and rejects missing or spurious native identities',async()=>{
  const blob=await original(),options={allowPrecisionLoss:true,development:{lens:manifest.cases[0].options}},settings=rawDecodeOptionsSchema.parse(options);
  const result=await developServerRaw(blob,options);for(const identity of [undefined,'0'.repeat(64)])await expect(validateRawDevelopmentResult({...result,lensWasmSha256:identity},settings)).rejects.toThrow(/provenance/);
  const prepared=await prepareRawDerivation(blob,'Profile.dng',options,{},()=>{},developServerRaw),{originalBlob,...metadata}=prepared.source;expect(originalBlob).toBe(blob);
  expect(metadata.lensWasmSha256).toBe(result.lensWasmSha256);expect(Object.isFrozen(metadata.settings.development.lens!.profile!.definition.calibrations)).toBe(true);
  expect(()=>rawSourceMetadataSchema.parse(metadata)).not.toThrow();expect(()=>rawSourceMetadataSchema.parse({...metadata,lensWasmSha256:undefined})).toThrow(/provenance/);
  await expect(validateRawDevelopmentResult(result,rawDecodeOptionsSchema.parse({allowPrecisionLoss:true}))).rejects.toThrow(/provenance/);
},30000);

it('disabled and neutral profiles preserve prior pixels and disabled profiles do no native lens work',async()=>{
  const blob=await original(),plain=await developServerRaw(blob,{allowPrecisionLoss:true}),lens=manifest.cases[0].options;
  const disabled=await developServerRaw(blob,{allowPrecisionLoss:true,development:{lens:{...lens,enabled:false}}});expect(disabled).not.toHaveProperty('lensWasmSha256');expect(await rgba(disabled.png)).toEqual(await rgba(plain.png));
  const inactive=new RawDevelopment({lens:{...lens,enabled:false}}).toJSON().lens;
  expect(await prepareRawLens(inactive,plain.report,()=>{throw new Error('Must not load');})).toBeUndefined();
  const neutral=await developServerRaw(blob,{allowPrecisionLoss:true,development:{lens:{profile:{...lens.profile,distortion:false,chromatic:false,vignette:false}}}});
  expect(await rgba(neutral.png)).toEqual(await rgba(plain.png));expect(neutral).toHaveProperty('lensWasmSha256');
},30000);

it('rejects monochrome TCA and folded profile geometry before demosaicing, then permits clean retry',async()=>{
  const options=structuredClone(manifest.cases[0].options),blob=await original('monochrome16.dng');let developed=false;
  await expect(developServerRaw(blob,{allowPrecisionLoss:true,development:{lens:options}},{onProgress:value=>{if(value.phase==='developing')developed=true;}})).rejects.toThrow(/color RAW/);expect(developed).toBe(false);
  for(const frame of options.profile.definition.calibrations)for(const point of frame.distortion)point.terms=[-1];
  await expect(developServerRaw(await original(),{allowPrecisionLoss:true,development:{lens:options}},{onProgress:value=>{if(value.phase==='developing')developed=true;}})).rejects.toThrow(/folds/);expect(developed).toBe(false);
  const retry=await developServerRaw(blob,{allowPrecisionLoss:true,development:{lens:{...manifest.cases[0].options,profile:{...manifest.cases[0].options.profile,chromatic:false}}}});expect(retry.report.canDevelop).toBe(true);
},30000);

it('never samples a profile as manual correction when its native context is unavailable',()=>{
  const lens=new RawDevelopment({lens:manifest.cases[0].options}).toJSON().lens!,image={width:64,height:48,channels:3,readRegion(){throw new Error('Must not read');}}as unknown as OwnedRawImage;
  expect(()=>rawLensSampler(image,lens)).toThrow(/native profile lease/);
});
