import {z} from 'zod';
import {BrushPreset,brushPresetPackSchema,exportBrushPresets,parseBrushPresets,type BrushTool} from './presets';
import {capturePresetSource,presetSourceMetadataSchema,verifyPresetSource,type PresetSource} from './sources';
import {encodeBrushContainer,readBrushContainer} from './container';
import type {ToolSettings} from '../tools';
import type {BrushTextureSourceOwner} from './texture-source';
import {brushTexturePreferenceSchema} from './texture-source';

const packSchema=z.object({format:z.literal('canoli-brush-presets'),version:z.union([z.literal(4),z.literal(5)]),presets:brushPresetPackSchema.shape.presets,
  sources:z.array(presetSourceMetadataSchema.safeExtend({blobIndex:z.number().int().nonnegative().safe()})).min(1),
}).strict();

export async function captureBrushPreset(name:string,tool:BrushTool,settings:ToolSettings,owner:BrushTextureSourceOwner,includeColor=false,signal?:AbortSignal){
  // Own and validate every combined scalar/dynamic field before asynchronous source work.
  const texture=brushTexturePreferenceSchema.parse(settings.texture??null),plain=BrushPreset.capture(name,tool,{...settings,texture:null},includeColor);
  if(!texture)return plain;
  const source=await capturePresetSource(owner,signal);signal?.throwIfAborted();
  return BrushPreset.capture(plain.name,plain.tool,{...settings,...plain.toToolSettings(),texture},includeColor,source);
}
export async function exportBrushPack(presets:readonly BrushPreset[],signal?:AbortSignal):Promise<Blob>{
  signal?.throwIfAborted();const owned=presets.map(p=>new BrushPreset(p.toJSON(),p.source));
  if(!owned.some(p=>p.texture))return new Blob([exportBrushPresets(owned)],{type:'application/json'});
  const sources:ReturnType<typeof packSchema.parse>['sources']=[],blobs:Blob[]=[],keys=new Map<string,string>(),data=[];
  for(const preset of owned){
    const value=preset.toJSON();
    if(preset.source){
      const source=await verifyPresetSource(preset.source,signal),{blob,id:oldId,...metadata}=source;
      const key=JSON.stringify(metadata);let id=keys.get(key);
      if(!id){id=crypto.randomUUID();keys.set(key,id);sources.push({...metadata,id,blobIndex:blobs.length});blobs.push(blob);}
      value.texture={...value.texture!,sourceId:id};void oldId;
    }
    data.push(value);
  }
  const checked=packSchema.parse({format:'canoli-brush-presets',version:data.reduce((version,preset)=>Math.max(version,preset.version),4),presets:data,sources});brushPresetPackSchema.parse({format:checked.format,version:checked.version,presets:checked.presets});
  return (await encodeBrushContainer(checked,blobs,'application/x-canoli-brush-pack',signal)).blob;
}
export async function parseBrushPack(file:Blob,signal?:AbortSignal):Promise<BrushPreset[]>{
  const container=await readBrushContainer(file,signal);
  if(!container){const text=await file.text();signal?.throwIfAborted();return parseBrushPresets(text);}
  const pack=packSchema.parse(container.data);brushPresetPackSchema.parse({format:pack.format,version:pack.version,presets:pack.presets});
  if(pack.sources.length!==container.blobs.length)throw new Error('Brush pack contains unreferenced source data.');
  const sources=new Map<string,PresetSource>(),indices=new Set<number>(),used=new Set<string>();
  const ids=new Set(pack.sources.map(source=>source.id));
  if(ids.size!==pack.sources.length)throw new Error('Duplicate brush source IDs.');
  for(const preset of pack.presets)if(preset.texture){if(!ids.has(preset.texture.sourceId))throw new Error('Missing original brush texture source.');used.add(preset.texture.sourceId);}
  if(used.size!==ids.size)throw new Error('Brush pack contains unused image sources.');
  for(const entry of pack.sources){
    if(sources.has(entry.id)||indices.has(entry.blobIndex)||entry.blobIndex>=container.blobs.length)throw new Error('Duplicate or missing brush source.');
    const {blobIndex,...metadata}=entry;indices.add(blobIndex);
    sources.set(entry.id,await verifyPresetSource({...metadata,blob:container.blobs[blobIndex]},signal));
  }
  const remap=new Map<string,PresetSource>();
  for(const [id,source] of sources)remap.set(id,{...source,id:crypto.randomUUID()});
  const presets=pack.presets.map(data=>{
    if(!data.texture)return new BrushPreset(data);
    used.add(data.texture.sourceId);const source=remap.get(data.texture.sourceId);if(!source)throw new Error('Missing original brush texture source.');
    return new BrushPreset({...data,texture:{...data.texture,sourceId:source.id}},source);
  });
  if(used.size!==sources.size)throw new Error('Brush pack contains unused image sources.');
  signal?.throwIfAborted();return presets;
}
