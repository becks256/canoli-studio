import {beforeAll,afterAll,it,expect}from 'vitest';
import {readFile}from 'node:fs/promises';
import {createHash}from 'node:crypto';
import {NativeIccEngine,iccIntents}from '../src/core/color/icc-native';
import {STANDARD_PROFILES}from '../src/core/color/icc';
const root=new URL('../',import.meta.url),directory=new URL('tests/fixtures/icc-native/',root),fixture=JSON.parse(await readFile(new URL('manifest.json',directory),'utf8'))as{pixels:number;cases:{profile:string;mode:'convert'|'proof';intent:number;proofIntent:number;blackPointCompensation:boolean;pixels:string;reference:string}[];files:Record<string,{bytes:number;sha256:string}>};
let engine:NativeIccEngine;
beforeAll(async()=>{engine=await NativeIccEngine.create(new Uint8Array(await readFile(new URL('src/core/color/codec/canoli_icc.wasm',root))));});
afterAll(()=>engine?.dispose());
for(const row of fixture.cases)it(`native ICC ${row.profile} ${row.mode} intent ${row.intent}/${row.proofIntent} BPC ${row.blackPointCompensation} matches independent device pixels`,async()=>{
 const profile=new Uint8Array(await readFile(new URL(row.profile,directory))),source=new Uint8Array(await readFile(new URL('source.rgba',directory))),original=source.slice(),expected=await readFile(new URL(row.pixels,directory));
 engine.begin(profile,{mode:row.mode,intent:iccIntents[row.intent],blackPointCompensation:row.blackPointCompensation,...(row.mode==='proof'?{proofIntent:iccIntents[row.proofIntent]}:{})});const actual=engine.apply(source);let colorError=0,alphaError=0;
 for(let i=0;i<actual.length;i++){if(i%4===3)alphaError=Math.max(alphaError,Math.abs(actual[i]-expected[i]));else colorError=Math.max(colorError,Math.abs(actual[i]-expected[i]));}
 expect(actual.length).toBe(fixture.pixels*4);expect(alphaError).toBe(0);expect(colorError).toBeLessThanOrEqual(row.profile==='synthetic-cmyk.icc'&&row.reference==='Pillow 10.3.0 / Little CMS 2.16'?1:0);expect(source).toEqual(original);
});
it('native proofing applies an actual narrow-device gamut alarm and retains every alpha value',async()=>{
 const profile=new Uint8Array(await readFile(new URL('narrow-rgb.icc',directory))),source=new Uint8Array([255,0,0,128,0,0,255,1,128,128,128,255,255,255,255,0]);
 engine.begin(profile,{mode:'proof'});const ordinary=engine.apply(source);engine.begin(profile,{mode:'proof',gamutWarning:true,warningColor:'#ff00ff'});const alarm=engine.apply(source);
 expect(alarm.slice(0,3)).toEqual(new Uint8ClampedArray([255,0,255]));expect(alarm).not.toEqual(ordinary);expect([...alarm.filter((_,i)=>i%4===3)]).toEqual([128,1,255,0]);expect(alarm.slice(8,11)).toEqual(ordinary.slice(8,11));
});
it('complete CMYK profile inspection keeps four channels and RGB delivery rejects instead of dropping K',async()=>{
 const profile=new Uint8Array(await readFile(new URL('synthetic-cmyk.icc',directory))),report=engine.inspect(profile);expect(report).toMatchObject({colorSpace:'CMYK',connectionSpace:'Lab ',deviceClass:'prtr',channels:4,description:'Canoli synthetic CMYK LUT device'});expect(report.inputIntents).toContain('perceptual');expect(()=>engine.begin(profile,{mode:'convert'})).toThrow('RGB delivery requires an RGB output profile');expect(()=>engine.apply(new Uint8Array(4))).toThrow('Prepare an ICC transform');
});
it('valid omitted intent tables use native CMM fallback with an explicit preparation warning',async()=>{
 const profile=new Uint8Array(await readFile(new URL('synthetic-cmyk.icc',directory))),prepared=engine.begin(profile,{mode:'proof'});expect(prepared.usesIntentFallback).toBe(true);expect(prepared.warnings.join(' ')).toContain('fallback');expect(prepared.settings).toMatchObject({proofIntent:'relative-colorimetric'});expect(engine.apply(new Uint8Array([128,64,32,87]))[3]).toBe(87);
});
it('profile reports and converted windows own their data across native reuse and source mutation',()=>{
 const profile=new Uint8Array(STANDARD_PROFILES['display-p3'].iccBytes!),source=new Uint8Array([255,0,0,99]);const report=engine.begin(profile,{mode:'convert'}),first=engine.apply(source),expected=first.slice();profile.fill(0);source.fill(0);first.fill(0);expect(engine.apply(new Uint8Array([255,0,0,99]))).toEqual(expected);engine.inspect(STANDARD_PROFILES.srgb.iccBytes!);expect(report.profile.description).toBe('Display P3');
});
for(const invalid of [{mode:'convert',intent:'unclipped'},{mode:'convert',proofIntent:'perceptual'},{mode:'proof',gamutWarning:'true'},{mode:'proof',warningColor:'red'}])it('rejected transform settings cannot silently retain the previous profile: '+JSON.stringify(invalid),()=>{
 engine.begin(STANDARD_PROFILES.srgb.iccBytes!,{mode:'convert'});expect(()=>engine.begin(STANDARD_PROFILES.srgb.iccBytes!,invalid as never)).toThrow();expect(()=>engine.apply(new Uint8Array(4))).toThrow('Prepare an ICC transform');
});
for(const corruption of ['truncated','trailing','signature','declared-size','tag-count']as const)it(`malformed ICC ${corruption} rejects before publishing a profile or stale pixels`,()=>{
 const original=STANDARD_PROFILES.srgb.iccBytes!,source=corruption==='truncated'?original.slice(0,140):corruption==='trailing'?new Uint8Array([...original,0]):original.slice();
 if(corruption==='signature')source.fill(0,36,40);if(corruption==='declared-size')new DataView(source.buffer,source.byteOffset,source.byteLength).setUint32(0,0xffffffff,false);if(corruption==='tag-count')new DataView(source.buffer,source.byteOffset,source.byteLength).setUint32(128,0xffffffff,false);
 engine.begin(original,{mode:'convert'});expect(()=>engine.inspect(source)).toThrow();expect(()=>engine.apply(new Uint8Array(4))).toThrow('Prepare an ICC transform');
});
it('closed native owners reject reuse and disposal is idempotent',async()=>{
 const owner=await NativeIccEngine.create(new Uint8Array(await readFile(new URL('src/core/color/codec/canoli_icc.wasm',root))));owner.dispose();owner.dispose();expect(()=>owner.inspect(STANDARD_PROFILES.srgb.iccBytes!)).toThrow('closed');expect(()=>owner.begin(STANDARD_PROFILES.srgb.iccBytes!,{mode:'convert'})).toThrow('closed');expect(()=>owner.apply(new Uint8Array(4))).toThrow('closed');
});
it('independent profile/reference identities match their manifest and the actual built-in profile bytes',async()=>{
 for(const[name,entry]of Object.entries(fixture.files)){const data=await readFile(new URL(name,directory));expect(data.length).toBe(entry.bytes);expect(createHash('sha256').update(data).digest('hex')).toBe(entry.sha256);}
 for(const[name,profile]of Object.entries(STANDARD_PROFILES))expect(new Uint8Array(await readFile(new URL(name+'.icc',directory)))).toEqual(profile.iccBytes);
});
it('the shipped real WASM and maintained wrapper match the pinned build manifest',async()=>{
 const manifest=JSON.parse(await readFile(new URL('src/core/color/codec/build.json',root),'utf8'));expect(manifest.sourceRevisions.lcms).toBe('21c582a594fe5279f90c0b93437c398f93bf62b0');
 for(const[name,entry]of Object.entries(manifest.artifacts)as[string,{bytes:number;sha256:string}][]){const data=await readFile(new URL('src/core/color/codec/'+name,root));expect(data.length).toBe(entry.bytes);expect(createHash('sha256').update(data).digest('hex')).toBe(entry.sha256);}
 for(const[name,digest]of Object.entries(manifest.sourceFiles))expect(createHash('sha256').update(await readFile(new URL(name,root))).digest('hex')).toBe(digest);
});
