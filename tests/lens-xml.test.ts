import {expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {parseLensDatabaseXml} from '../src/core/interchange/lens/xml';
import {lensProfileSchema} from '../src/core/interchange/lens/schema';
import createLens from '../src/core/interchange/lens/codec/canoli_lens_correction.js';
import {lensCorrectionCodec} from '../src/core/interchange/lens/codec';

const source=(xml:string)=>({name:'Local profiles.xml',type:'application/xml',byteLength:Buffer.byteLength(xml),sha256:createHash('sha256').update(xml).digest('hex')});
const lens='<lens><maker>Canoli Optics</maker><model>Reference 35 mm</model><mount>Canoli Test Mount</mount><cropfactor>1.5</cropfactor><calibration><distortion model="poly3" focal="35" k1="-0.02"/></calibration></lens>';
const document=(body:string,header='')=>header+'<lensdatabase version="2">'+body+'</lensdatabase>';
for(const model of ['poly3','poly5','ptlens'])it(`parses actual independent native ${model} XML into complete matching calibration tables`,async()=>{
  const xml=await readFile(`tests/fixtures/lens-core/${model}.xml`,'utf8'),descriptor=source(xml),catalog=parseLensDatabaseXml(xml,descriptor),manifest=JSON.parse(await readFile('tests/fixtures/lens-core/manifest.json','utf8'));
  expect(catalog.source).toEqual(descriptor);expect(catalog.lenses).toHaveLength(1);expect(catalog.lenses[0].issues).toEqual([]);
  expect(catalog.lenses[0].definition).toEqual({...lensProfileSchema.parse(manifest.profiles[model]),source:{name:descriptor.name,sha256:descriptor.sha256,index:0}});
  expect(catalog.cameras[0]).toMatchObject({maker:'Canoli synthetic',model:'Independent DNG fixture',mount:'Canoli Test Mount',cropFactor:1.5,issues:[]});expect(catalog.mounts[0]).toMatchObject({name:'Canoli Test Mount',compatible:[],issues:[]});
});
it('preserves canonical and translated identities, directional mount compatibility and source notices',()=>{
  const xml=document('<mount><name>Canoli</name><name lang="fr">Monture Canoli</name><compat>Adaptable</compat></mount><camera><maker>Recorded maker</maker><maker lang="en">Friendly maker</maker><model>Recorded model</model><model lang="fr">Modèle</model><variant>Variant</variant><mount>Canoli</mount><cropfactor>1.523</cropfactor></camera>'+lens.replace('<model>Reference 35 mm</model>','<model lang="en">Friendly lens</model><model>Reference 35 mm</model>').replace('<calibration>','<!-- Lens notice --><calibration>'),'<!-- Global notice -->');
  const catalog=parseLensDatabaseXml(xml,source(xml));expect(catalog.lenses[0]).toMatchObject({model:'Reference 35 mm',modelAliases:['Friendly lens'],issues:[]});expect(catalog.lenses[0].definition!.source!.notices).toBe('Global notice\n\nLens notice');expect(catalog.cameras[0]).toMatchObject({makerAliases:['Friendly maker'],modelAliases:['Modèle'],cropFactor:1.523,variant:'Variant'});expect(catalog.mounts[0]).toMatchObject({aliases:['Monture Canoli'],compatible:['Adaptable']});
});
it('inherits calibration frame declarations sequentially and merges native-equivalent cohorts',()=>{
  const xml=document(lens.replace('<calibration>','<aspect-ratio>4:3</aspect-ratio><calibration cropfactor="2" aspect-ratio="1.5">').replace('</calibration>','</calibration><calibration><tca model="linear" focal="35" kr="1.001"/></calibration><calibration cropfactor="1.5"><distortion model="poly3" focal="50"/></calibration>'));
  const catalog=parseLensDatabaseXml(xml,source(xml)),definition=catalog.lenses[0].definition!;expect(catalog.lenses[0].issues).toEqual([]);expect(definition.calibrations).toHaveLength(2);expect(definition.calibrations[0]).toMatchObject({cropFactor:2,aspectRatio:1.5,chromatic:[{model:'linear',terms:[1.001,1]}]});expect(definition.calibrations[1]).toMatchObject({cropFactor:1.5,aspectRatio:1.5,distortion:[{model:'poly3',focalLength:50,terms:[0]}]});
});
it('normalizes only identical native-effective repeated declarations and retains the original identity and a notice',()=>{
  const xml=document(lens.replace('</calibration>','</calibration><calibration cropfactor="1.50000000001"><distortion model="poly3" focal="35.000000001" a="-0.020000000001"/><tca model="linear" focal="35"/><tca model="linear" focal="35" kr="1" kb="1"/></calibration>'));
  const catalog=parseLensDatabaseXml(xml,source(xml)),row=catalog.lenses[0];expect(row.issues).toEqual([]);expect(row.definition!.calibrations).toHaveLength(1);expect(row.definition!.calibrations[0].distortion).toHaveLength(1);expect(row.definition!.calibrations[0].chromatic).toHaveLength(1);expect(row.definition!.source).toMatchObject({sha256:source(xml).sha256,notices:'Normalized 2 identical repeated calibration declarations; original XML retained.'});
});
it('keeps conflicting duplicates unavailable even when only the measured real focal declaration differs',()=>{
  const xml=document(lens.replace('</calibration>','<distortion model="poly3" focal="35" k1="-0.02" real-focal="35"/></calibration>'));
  const row=parseLensDatabaseXml(xml,source(xml)).lenses[0];expect(row.definition).toBeNull();expect(row.issues).toEqual(['Conflicting duplicate native calibration coordinates.']);
});
for(const mutation of [
  (value:string)=>value.replace('model="poly3"','model="acm"'),
  (value:string)=>value.replace('<cropfactor>','<type>fisheye</type><cropfactor>'),
  (value:string)=>value.replace('</calibration>','<crop mode="crop_circle" focal="35"/></calibration>'),
  (value:string)=>value.replace('</calibration>','<field_of_view focal="35" fov="70"/></calibration>'),
  (value:string)=>value.replace('focal="35"','focal="35mm"'),
  (value:string)=>value.replace('k1="-0.02"','k1="1e99"'),
  (value:string)=>value.replace('<model>','<model lang="en">Friendly</model><model lang="en">'),
  (value:string)=>value.replace('</calibration>','<tca model="linear" focal="35" kr="-1"/></calibration>'),
  (value:string)=>value.replace('</calibration>','<vignetting model="none" focal="35"/></calibration>'),
  (value:string)=>value.replace('</calibration>','<distortion model="poly3" focal="35"/></calibration>'),
  (value:string)=>value.replace('k1="-0.02"','k1="-0.02" a="-0.02"'),
])it('keeps unsupported or malformed lens records unavailable as a whole while preserving usable siblings',()=>{
  const xml=document(mutation(lens)+lens),catalog=parseLensDatabaseXml(xml,source(xml));expect(catalog.lenses).toHaveLength(2);expect(catalog.lenses[0].definition).toBeNull();expect(catalog.lenses[0].issues.length).toBeGreaterThan(0);expect(catalog.lenses[1].issues).toEqual([]);expect(catalog.lenses[1].definition!.source!.index).toBe(1);expect(catalog.source.sha256).toBe(source(xml).sha256);
});
for(const header of ['<!DOCTYPE lensdatabase [<!ENTITY ex SYSTEM "https://example.invalid/payload">]>','<!DOCTYPE lensdatabase SYSTEM "quoted>uri" [<!ATTLIST lens model CDATA "injected">]>'])it('rejects internal DTD subsets before XML parsing, including quoted greater-than characters',()=>{const xml=document(lens,header);expect(()=>parseLensDatabaseXml(xml,source(xml))).toThrow(/internal DTD/);});
it('allows inert external DTD identifiers, XML builtins, comments and literal CDATA',()=>{
  const xml=document(lens.replace('<maker>Canoli Optics</maker>','<maker>Canoli &amp; Optics</maker>').replace('<model>Reference 35 mm</model>','<model><![CDATA[Reference <!ENTITY literal> 35 mm]]></model>'),'<!DOCTYPE lensdatabase SYSTEM "https://example.invalid/never-fetched.dtd"><!-- <!ENTITY harmless comment> -->');const catalog=parseLensDatabaseXml(xml,source(xml));expect(catalog.lenses[0].issues).toEqual([]);expect(catalog.lenses[0].definition).toMatchObject({maker:'Canoli & Optics',model:'Reference <!ENTITY literal> 35 mm'});
});
for(const xml of ['<lensdatabase version="3"/>','<lensdatabase version="2"><include href="external.xml"/></lensdatabase>','<lensdatabase xmlns="urn:foreign" version="2"/>','<lensdatabase version="2"><lens></lensdatabase>','<?xml version="1.0" encoding="ISO-8859-1"?><lensdatabase version="2"/>',document(lens.replace('Reference 35 mm','&unknown;'))])it('rejects unsupported roots, operations, encodings and malformed XML without publishing partial catalogs',()=>{expect(()=>parseLensDatabaseXml(xml,source(xml))).toThrow();});
it('matches the complete independent native parser/modifier for inherited frames, default linear TCA and legacy aspect declarations',async()=>{
  const base='tests/fixtures/lens-xml/',xml=await readFile(base+'frame-inheritance.xml','utf8'),manifest=JSON.parse(await readFile(base+'manifest.json','utf8')),catalog=parseLensDatabaseXml(xml,source(xml));expect(catalog.lenses[0].issues).toEqual([]);
  const native=await createLens({wasmBinary:new Uint8Array(await readFile('src/core/interchange/lens/codec/canoli_lens_correction.wasm'))}),lease=lensCorrectionCodec(native).prepare({definition:catalog.lenses[0].definition!,focalLength:manifest.focalLength,cropFactor:manifest.cropFactor,aperture:manifest.aperture,focusDistance:manifest.focusDistance,distortion:true,chromatic:true,vignette:false},{width:64,height:48},manifest.scale);
  try{const bytes=await readFile(base+'frame-inheritance.f32le'),expected=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),coordinates=lease.coordinates(0,0,64,48),gains=lease.gains(0,0,64,48);let maximum=0;for(let i=0;i<coordinates.length;i++)maximum=Math.max(maximum,Math.abs(coordinates[i]-expected.getFloat32(i*4,true)));for(let i=0;i<gains.length;i++)maximum=Math.max(maximum,Math.abs(gains[i]-expected.getFloat32((coordinates.length+i)*4,true)));expect(maximum).toBe(0);expect(lease.report.chromaticModel).toBe(1);}finally{lease.dispose();}
});
it('selects independent family cohorts while preserving the global inferred focal range for native vignetting weights',async()=>{
  const base='tests/fixtures/lens-xml/',manifest=JSON.parse(await readFile(base+'manifest.json','utf8')),fixture=manifest.families,xml=await readFile(base+fixture.sourceXml,'utf8'),catalog=parseLensDatabaseXml(xml,source(xml));expect(catalog.lenses[0].issues).toEqual([]);
  const native=await createLens({wasmBinary:new Uint8Array(await readFile('src/core/interchange/lens/codec/canoli_lens_correction.wasm'))}),lease=lensCorrectionCodec(native).prepare({definition:catalog.lenses[0].definition!,focalLength:fixture.focalLength,cropFactor:fixture.cropFactor,aperture:fixture.aperture,focusDistance:fixture.focusDistance,distortion:true,chromatic:true,vignette:true},{width:64,height:48},fixture.scale);
  try{const bytes=await readFile(base+fixture.file),expected=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),coordinates=lease.coordinates(0,0,64,48),gains=lease.gains(0,0,64,48);let maximum=0;for(let i=0;i<coordinates.length;i++)maximum=Math.max(maximum,Math.abs(coordinates[i]-expected.getFloat32(i*4,true)));for(let i=0;i<gains.length;i++)maximum=Math.max(maximum,Math.abs(gains[i]-expected.getFloat32((coordinates.length+i)*4,true)));expect(maximum).toBe(0);expect([lease.report.coefficients[6],lease.report.coefficients[21],lease.report.coefficients[26]]).toEqual([Math.fround(1.5),Math.fround(2),Math.fround(1.8)]);}finally{lease.dispose();}
});
