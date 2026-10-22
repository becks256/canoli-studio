import {afterEach,beforeAll,expect,it,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import createRaw from '../src/core/interchange/raw/codec/canoli_raw_decoder.js';
import {rawDecoder} from '../src/core/interchange/raw/codec';
import build from '../src/core/interchange/raw/codec/build.json';
import {rawDecodeOptionsSchema} from '../src/core/interchange/raw/types';
import {ownRawSource,rawBlobHash,rawSourceMetadata,verifyRawSource,type RawImageSource} from '../src/core/interchange/raw/source';
import {Document,RasterLayer,RawDevelopment} from '../src/dom';
import {readProject,serializeProject} from '../src/core/project';
import {AssetStore} from '../src/core/assets';
import {serializeRecipePackage,readRecipePackage} from '../src/ai/recipes/package';
import type {Recipe} from '../src/ai/recipes/types';
import {ToolController} from '../src/tools';
import type {EditorApplication} from '../src/editor';
import {BrushTextureSourceOwner} from '../src/brushes/texture-source';
import {captureBrushPreset,exportBrushPack,parseBrushPack} from '../src/brushes/portable';
import {BrushPreset} from '../src/brushes/presets';
import {readBrushContainer} from '../src/brushes/container';
import {prepareBrushRecovery,parseBrushRecoveryFile} from '../src/brushes/recovery';

let asset:{id:string;name:string;width:number;height:number;blob:Blob;raw:RawImageSource};
beforeAll(async()=>{
  const bytes=new Uint8Array(await readFile('tests/fixtures/raw/bayer-rggb.dng')),originalBlob=new Blob([bytes],{type:'image/x-adobe-dng'}),blob=new Blob([new Uint8Array(await readFile('tests/fixtures/raw/bayer-rggb.png'))],{type:'image/png'});
  const report=rawDecoder(await createRaw({wasmBinary:new Uint8Array(await readFile('src/core/interchange/raw/codec/canoli_raw_decoder.wasm'))})).inspect(bytes);
  asset={id:'accepted-raw',name:'Sensor original.dng',width:report.displayWidth,height:report.displayHeight,blob,raw:ownRawSource({version:1,original:{name:'Sensor original.dng',type:originalBlob.type,byteLength:originalBlob.size,sha256:await rawBlobHash(originalBlob)},originalBlob,settings:rawDecodeOptionsSchema.parse({allowPrecisionLoss:true}),report,nativeWasmSha256:build.artifacts['canoli_raw_decoder.wasm'].sha256,outputSha256:await rawBlobHash(blob)})};
});
afterEach(()=>vi.unstubAllGlobals());
function artwork(){const document=new Document({width:asset.width,height:asset.height}),layer=document.layers.add(new RasterLayer({assetId:asset.id,width:asset.width,height:asset.height}));return{document,layer};}
async function inspectManifest(file:Blob){const header=new Uint8Array(await file.slice(0,48).arrayBuffer()),length=Number(new DataView(header.buffer).getBigUint64(8,true));return{header,length,manifest:JSON.parse(await file.slice(48,48+length).text())};}
async function changeManifest(file:Blob,mutate:(manifest:any)=>void){const {header,length,manifest}=await inspectManifest(file);mutate(manifest);const json=new TextEncoder().encode(JSON.stringify(manifest));new DataView(header.buffer).setBigUint64(8,BigInt(json.length),true);header.set(new Uint8Array(await crypto.subtle.digest('SHA-256',json)),16);return new Blob([header,json,file.slice(48+length)]);}

it('keeps accepted PNG and complete RAW original independently in projects and source-bearing recipes',async()=>{
  const {document,layer}=artwork(),source={get:()=>asset},data=document.toJSON();
  const project=await serializeProject(data,source),parsed=await readProject(project),{manifest}=await inspectManifest(project);
  expect(manifest.version).toBe(4);expect(manifest.rawOriginals).toHaveLength(1);expect(parsed.document).toEqual(data);
  const recipe:Recipe={schemaVersion:1,id:'raw-pixels',name:'Retained RAW',description:'Source-bearing layer',version:1,parameters:[],steps:[{id:'place',name:'Place RAW pixels',action:{type:'layer.add',layerTemplate:{...layer.toJSON()}}}]};
  const pack=await serializeRecipePackage(recipe,source),restored=await readRecipePackage(pack);expect((await inspectManifest(pack)).manifest.version).toBe(2);
  for(const entry of [parsed.entries[0],restored.assets[0]]){
    expect(rawSourceMetadata(entry.raw!)).toEqual(rawSourceMetadata(asset.raw));
    expect(await entry.blob.arrayBuffer()).toEqual(await asset.blob.arrayBuffer());
    expect(await entry.raw!.originalBlob.arrayBuffer()).toEqual(await asset.raw.originalBlob.arrayBuffer());
    expect(entry.raw!.originalBlob.type).toBe('image/x-adobe-dng');
  }
});

it('deduplicates a shared original across retained undo/redo outputs and preserves both accepted versions',async()=>{
  const {document,layer}=artwork(),before=document.toJSON();document.name='Later';const blob=new Blob([new Uint8Array(await readFile('tests/fixtures/raw/exposure-up.png'))],{type:'image/png'}),later={...asset,id:'redeveloped-raw',blob,raw:ownRawSource({...asset.raw,outputSha256:await rawBlobHash(blob),settings:rawDecodeOptionsSchema.parse({allowPrecisionLoss:true,development:{exposure:1.25,highlightPreservation:0.5}})})};
  layer.remove();document.layers.add(new RasterLayer({assetId:later.id,width:asset.width,height:asset.height}));
  const file=await serializeProject(document.toJSON(),{get:id=>id===asset.id?asset:later},{version:1,past:[{document:before,label:'Develop RAW',canvasChanged:true}],future:[]}),parsed=await readProject(file),{manifest}=await inspectManifest(file);
  expect(manifest.rawOriginals).toHaveLength(1);expect(parsed.entries).toHaveLength(2);expect(parsed.history?.past[0].document).toEqual(before);
  expect(parsed.entries.map(entry=>entry.raw!.settings.development.exposure).sort()).toEqual([0,1.25]);
});

for(const mode of ['original-bytes','output-bytes','settings','geometry','missing-original','overlap','old-container']as const)it(`rejects RAW ${mode} inconsistencies instead of flattening silently`,async()=>{
  const {document}=artwork(),file=await serializeProject(document.toJSON(),{get:()=>asset});let changed:Blob;
  if(mode.endsWith('bytes')){const bytes=new Uint8Array(await file.arrayBuffer()),{length,manifest}=await inspectManifest(file),offset=mode==='original-bytes'?manifest.rawOriginals[0].offset:manifest.assets[0].offset;bytes[48+length+offset+10]^=255;changed=new Blob([bytes]);}
  else changed=await changeManifest(file,manifest=>{
    if(mode==='settings')manifest.assets[0].raw.settings.development.exposure=99;
    if(mode==='geometry')manifest.assets[0].raw.report.displayWidth++;
    if(mode==='missing-original')manifest.rawOriginals=[];
    if(mode==='overlap')manifest.rawOriginals[0].offset=0;
    if(mode==='old-container')manifest.version=3;
  });
  await expect(readProject(changed)).rejects.toThrow();
});

it('owns parameter records and refuses replaced original/output bytes before accepting an asset',async()=>{
  const original=structuredClone(asset.raw),owned=ownRawSource(original),value=new RawDevelopment({exposure:0.75,multipliers:{red:2}}),settings=value.toJSON();
  original.settings.development.exposure=2;settings.multipliers.red=4;
  expect(owned.settings.development.exposure).toBe(0);expect(value.toJSON().multipliers.red).toBe(2);expect(Object.isFrozen(value)).toBe(true);expect(Object.isFrozen(owned.report.warnings)).toBe(true);
  await expect(verifyRawSource({...asset.raw,originalBlob:new Blob([new Uint8Array(asset.raw.originalBlob.size)],{type:asset.raw.originalBlob.type})},asset.blob)).rejects.toThrow(/checksum/);
  const store=new AssetStore();try{await expect(store.add(new Blob(['wrong'],{type:'image/png'}),'Bad output',undefined,false,{raw:asset.raw})).rejects.toThrow(/checksum/);expect(store.values()).toHaveLength(0);}finally{store.dispose();}
});

it('portable brush packs and library backups retain RAW sources after the originating document closes',async()=>{
  vi.stubGlobal('createImageBitmap',async()=>({width:asset.width,height:asset.height,close(){}}));
  const store=new AssetStore(),owner=new BrushTextureSourceOwner();
  try{
    const ready=await store.add(asset.blob,asset.name,asset.id,false,{raw:asset.raw});owner.capture(store,ready.id);store.dispose();
    const settings=new ToolController({}as EditorApplication).getSnapshot().settings,preset=await captureBrushPreset('RAW texture','brush',{...settings,texture:{channel:'luminance',invert:false}},owner);
    expect(preset.toJSON().version).toBe(6);expect(()=>new BrushPreset({...preset.toJSON(),version:5},preset.source)).toThrow(/version 6/);
    const pack=await exportBrushPack([preset,preset.duplicate()]),container=await readBrushContainer(pack);expect(container!.blobs).toHaveLength(2);
    const parsed=await parseBrushPack(pack);expect(parsed).toHaveLength(2);expect(await parsed[0].source!.raw!.originalBlob.arrayBuffer()).toEqual(await asset.raw.originalBlob.arrayBuffer());
    expect(rawSourceMetadata(parsed[0].source!.raw!)).toEqual(rawSourceMetadata(asset.raw));
    const backup=await prepareBrushRecovery([{preset:preset.toJSON(),source:preset.source}]),recovered=await parseBrushRecoveryFile(backup.blob);
    expect(recovered[0]).toHaveProperty('source.raw.originalBlob');
  }finally{owner.dispose();store.dispose();}
});

it('portable recipes deduplicate sensor bytes while preserving distinct original filenames',async()=>{
  const renamed={...asset,id:'other-name',raw:ownRawSource({...asset.raw,original:{...asset.raw.original,name:'Renamed camera source.dng'}})},first=new RasterLayer({name:'First',assetId:asset.id,width:asset.width,height:asset.height}),second=new RasterLayer({name:'Second',assetId:renamed.id,width:asset.width,height:asset.height});
  const recipe:Recipe={schemaVersion:1,id:'two-raw-names',name:'Two names',description:'Identical original bytes, separate names',version:1,parameters:[],steps:[first,second].map((layer,i)=>({id:`place-${i}`,name:layer.name,action:{type:'layer.add',layerTemplate:{...layer.toJSON()}}}))};
  const file=await serializeRecipePackage(recipe,{get:key=>key===asset.id?asset:renamed}),parsed=await readRecipePackage(file);
  expect(parsed.assets.map(asset=>asset.raw!.original.name)).toEqual(['Sensor original.dng','Renamed camera source.dng']);
  for(const entry of parsed.assets)expect(await entry.raw!.originalBlob.arrayBuffer()).toEqual(await asset.raw.originalBlob.arrayBuffer());
});
