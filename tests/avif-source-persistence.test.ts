import {expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {Document,RasterLayer} from '../src/dom';
import {readProject,serializeProject} from '../src/core/project';
import {readRecipePackage,serializeRecipePackage} from '../src/ai/recipes/package';
import {ownPresetSource,presetSourceMetadataSchema} from '../src/brushes/sources';
import type {Recipe} from '../src/ai/recipes/types';
import {AssetStore} from '../src/core/assets';
import {hasAvifBrand} from '../src/core/interchange/avif/sniff';

async function fixture(){
  const blob=new Blob([new Uint8Array(await readFile('tests/fixtures/avif-import/rgb-10.avif'))],{type:'image/avif'});
  const asset={id:'native-source',name:'Original AVIF',width:17,height:13,blob,avif:{allowPrecisionLoss:true,assumeSrgb:false}};
  const document=new Document({width:17,height:13});
  const layer=document.layers.add(new RasterLayer({assetId:asset.id,width:17,height:13}));
  const recipe:Recipe={schemaVersion:1,id:'avif-source',name:'Original AVIF',description:'Native source round trip',version:1,parameters:[],steps:[{id:'place',name:'Place source',action:{type:'layer.add',layerTemplate:{...layer.toJSON()}}}]};
  return{asset,document:document.toJSON(),source:{get:()=>asset},recipe};
}

it('native projects and portable recipes preserve original AVIF bytes and exact decoding choices',async()=>{
  const {asset,document,source,recipe}=await fixture();
  const project=await readProject(await serializeProject(document,source));
  const pack=await readRecipePackage(await serializeRecipePackage(recipe,source));
  for(const entry of [project.entries[0],pack.assets[0]]){
    expect(entry.avif).toEqual(asset.avif);expect(entry.blob.type).toBe('image/avif');
    expect(Buffer.compare(Buffer.from(await entry.blob.arrayBuffer()),Buffer.from(await asset.blob.arrayBuffer()))).toBe(0);
  }
  expect(project.document).toEqual(document);expect(pack.recipe).toEqual(recipe);
});

for(const mode of ['missing','foreign','invalid']as const)it(`rejects ${mode} AVIF choices before writing projects or recipes`,async()=>{
  const {asset,document,recipe}=await fixture();
  const changed={...asset,...(mode==='missing'?{avif:undefined}:mode==='foreign'?{blob:new Blob([asset.blob],{type:'image/png'})}:{avif:{allowPrecisionLoss:'yes',assumeSrgb:false}})};
  const source={get:()=>changed}as unknown as Parameters<typeof serializeProject>[1];
  await expect(serializeProject(document,source)).rejects.toThrow();
  await expect(serializeRecipePackage(recipe,source)).rejects.toThrow();
});

it('project readers reject missing or foreign AVIF choices even with a valid manifest checksum',async()=>{
  const {document,source}=await fixture(),file=await serializeProject(document,source);
  const original=new Uint8Array(await file.slice(0,48).arrayBuffer()),length=Number(new DataView(original.buffer).getBigUint64(8,true));
  const manifest=JSON.parse(await file.slice(48,48+length).text());
  for(const mode of ['missing','foreign']){
    const next=structuredClone(manifest);if(mode==='missing')delete next.assets[0].avif;else next.assets[0].type='image/png';
    const json=new TextEncoder().encode(JSON.stringify(next)),header=original.slice();
    new DataView(header.buffer).setBigUint64(8,BigInt(json.length),true);header.set(new Uint8Array(await crypto.subtle.digest('SHA-256',json)),16);
    await expect(readProject(new Blob([header,json,file.slice(48+length)]))).rejects.toThrow(/AVIF/);
  }
});

it('portable brush sources require matching choices, own them immutably and retain original bytes',async()=>{
  const {asset}=await fixture(),sha256=Buffer.from(await crypto.subtle.digest('SHA-256',await asset.blob.arrayBuffer())).toString('hex');
  const input={...asset,type:asset.blob.type,sha256},owned=ownPresetSource(input);
  input.avif.allowPrecisionLoss=false;expect(owned.avif).toEqual({allowPrecisionLoss:true,assumeSrgb:false});
  expect(Object.isFrozen(owned.avif)).toBe(true);expect(owned.blob).toBe(asset.blob);
  const {blob,...metadata}=input;void blob;
  expect(presetSourceMetadataSchema.safeParse({...metadata,avif:undefined}).success).toBe(false);
  expect(presetSourceMetadataSchema.safeParse({...metadata,type:'image/png'}).success).toBe(false);
  expect(presetSourceMetadataSchema.safeParse({...metadata,tiff:{page:0,allowPrecisionLoss:false}}).success).toBe(false);
});

it('recognizes AVIF brands through leading extended boxes without reading image payloads',async()=>{
  const {asset}=await fixture(),free=new Uint8Array(16),view=new DataView(free.buffer);view.setUint32(0,1);free.set(new TextEncoder().encode('free'),4);view.setBigUint64(8,16n);
  const blob=new Blob([free,asset.blob]),read=blob.slice.bind(blob);let largest=0;
  blob.slice=(start,end,type)=>{largest=Math.max(largest,(end??blob.size)-(start??0));return read(start,end,type);};
  expect(await hasAvifBrand(blob)).toBe(true);expect(largest).toBeLessThanOrEqual(4096);
  expect(await hasAvifBrand(new Blob(['Not an AVIF source']))).toBe(false);
});

for(const type of ['image/png','image/jpeg','image/webp','image/tiff'])it(`rejects actual AVIF bytes mislabeled as ${type} before browser decode`,async()=>{
  const {asset}=await fixture(),store=new AssetStore();
  try{await expect(store.add(new Blob([asset.blob],{type}),'Misleading source',undefined,false)).rejects.toThrow(/AVIF source bytes/);expect(store.values()).toHaveLength(0);}finally{store.dispose();}
});

it('never treats an oversized file-type table as permission to use generic browser decoding',async()=>{
  const bytes=new Uint8Array(4120),view=new DataView(bytes.buffer);view.setUint32(0,bytes.length);bytes.set(new TextEncoder().encode('ftypavif'),4);
  expect(await hasAvifBrand(new Blob([bytes]))).toBe(true);
  bytes.set(new TextEncoder().encode('mif1'),8);bytes.set(new TextEncoder().encode('avif'),4116);
  await expect(hasAvifBrand(new Blob([bytes]))).rejects.toThrow(/metadata budget/);
});
