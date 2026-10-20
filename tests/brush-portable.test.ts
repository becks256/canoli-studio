import {afterEach,expect,it,vi} from 'vitest';
import {BrushPreset,BUILTIN_BRUSH_PRESETS,exportBrushPresets,parseBrushPresets} from '../src/brushes/presets';
import {captureBrushPreset,exportBrushPack,parseBrushPack} from '../src/brushes/portable';
import {encodeBrushContainer,readBrushContainer,hashBrushBlob} from '../src/brushes/container';
import {prepareBrushRecovery,parseBrushRecoveryFile,serializeBrushRecovery} from '../src/brushes/recovery';
import {capturePresetSource,ownPresetSource} from '../src/brushes/sources';
import {BrushTextureSourceOwner} from '../src/brushes/texture-source';
import {AssetStore} from '../src/core/assets';
import {ToolController} from '../src/tools';
import {EditorApplication} from '../src/editor';
import {encodeRgbaPng} from '../src/engine/png';
import type {ToolSettings} from '../src/tools';

const stores:AssetStore[]=[],owners:BrushTextureSourceOwner[]=[];
const settings=()=>new ToolController({} as EditorApplication).getSnapshot().settings;
async function original(){
 const blob=await encodeRgbaPng(new Uint8Array([0,0,0,255,255,255,255,255,0,0,0,255,255,255,255,255]),2,2),store=new AssetStore();stores.push(store);
 const close=vi.fn(),bitmap={width:2,height:2,close} as unknown as ImageBitmap;
 store.install({id:'document-only-id',name:'Original image.png',blob,bitmap,width:2,height:2,thumbnail:'data:image/png;base64,'},false);
 const owner=new BrushTextureSourceOwner();owners.push(owner);owner.capture(store,'document-only-id');return{owner,store,blob,close};
}
afterEach(()=>{for(const owner of owners.splice(0))owner.dispose();for(const store of stores.splice(0))store.dispose();vi.unstubAllGlobals();});

it('preserves original blobs separately from preset metadata and round-trips source-bearing binary packs',async()=>{
 const {owner,blob}=await original(),preset=await captureBrushPreset('Portable','brush',{...settings(),texture:{channel:'alpha',invert:true}},owner,true);
 expect(preset.toJSON().version).toBe(4);expect(preset.toJSON()).not.toHaveProperty('source');expect(preset.source!.blob).toBe(blob);expect(preset.source!.id).not.toBe('document-only-id');expect(preset.texture).toEqual({sourceId:preset.source!.id,channel:'alpha',invert:true});expect(Object.isFrozen(preset.source)).toBe(true);
 expect(()=>exportBrushPresets([preset])).toThrow(/binary/);expect(()=>new BrushPreset(preset.toJSON())).toThrow(/source-bearing/);
 const file=await exportBrushPack([preset]),parsed=await parseBrushPack(file);
 expect(file.type).toBe('application/x-canoli-brush-pack');expect(parsed[0].source!.id).not.toBe(preset.source!.id);expect(parsed[0].source!.sha256).toBe(await hashBrushBlob(blob));expect(await parsed[0].source!.blob.arrayBuffer()).toEqual(await blob.arrayBuffer());expect(parsed[0].toToolSettings().texture).toEqual({channel:'alpha',invert:true});
 const duplicate=preset.duplicate();expect(duplicate.source).toBe(preset.source);expect(preset.with({name:'Renamed'}).source).toBe(preset.source);
});

it('plain JSON packs retain their legacy versions and source-free bytes',async()=>{
 const file=await exportBrushPack(BUILTIN_BRUSH_PRESETS);expect(file.type).toBe('application/json');expect(await file.text()).toBe(exportBrushPresets(BUILTIN_BRUSH_PRESETS));expect((await parseBrushPack(file)).map(p=>p.toJSON())).toEqual(BUILTIN_BRUSH_PRESETS.map(p=>p.toJSON()));
 expect(parseBrushPresets(await file.text())[0].toToolSettings().texture).toBeNull();
});

it('deduplicates complete source identities in packs and remaps conflicting local source IDs safely',async()=>{
 const {owner}=await original(),first=await captureBrushPreset('First','brush',{...settings(),texture:{channel:'luminance',invert:false}},owner),second=first.duplicate('Second'),file=await exportBrushPack([first,second]),container=await readBrushContainer(file);
 expect(container!.blobs).toHaveLength(1);const parsed=await parseBrushPack(file);expect(parsed[0].source!.id).toBe(parsed[1].source!.id);expect(parsed[0].id).not.toBe(parsed[1].id);
 const other=new BrushPreset({...second.toJSON(),texture:{...second.texture,sourceId:first.source!.id}},ownPresetSource({...first.source!,name:'Another original name.png'}));
 expect((await readBrushContainer(await exportBrushPack([first,other])))!.blobs).toHaveLength(2);
});

it('rejects texture metadata in old versions and missing or extra sources without silently importing',async()=>{
 const {owner}=await original(),preset=await captureBrushPreset('Native','brush',{...settings(),texture:{channel:'luminance',invert:false}},owner);
 expect(()=>new BrushPreset({...preset.toJSON(),version:3},preset.source)).toThrow(/version 4/);
 expect(()=>parseBrushPresets(JSON.stringify({format:'canoli-brush-presets',version:4,presets:[preset.toJSON()]}))).toThrow(/source-bearing/);
 const packed=(await readBrushContainer(await exportBrushPack([preset])))!,data=packed.data as {format:string;version:number;presets:ReturnType<BrushPreset['toJSON']>[];sources:unknown[]};
 const missing=await encodeBrushContainer({...data,presets:[{...data.presets[0],texture:{...data.presets[0].texture!,sourceId:'missing'}}]},packed.blobs,'application/x-canoli-brush-pack');await expect(parseBrushPack(missing.blob)).rejects.toThrow(/Missing original/);
 const unused=await encodeBrushContainer({...data,presets:[BUILTIN_BRUSH_PRESETS[0].toJSON()]},packed.blobs,'application/x-canoli-brush-pack');await expect(parseBrushPack(unused.blob)).rejects.toThrow(/unused/);
});

it('checks metadata and every original byte, exact extents and cancellation before publishing a pack',async()=>{
 const {owner}=await original(),preset=await captureBrushPreset('Checksums','brush',{...settings(),texture:{channel:'alpha',invert:false}},owner),file=await exportBrushPack([preset]),bytes=new Uint8Array(await file.arrayBuffer());
 const badManifest=bytes.slice();badManifest[50]^=1;await expect(parseBrushPack(new Blob([badManifest]))).rejects.toThrow(/manifest checksum/);
 const badSource=bytes.slice();badSource[badSource.length-1]^=1;await expect(parseBrushPack(new Blob([badSource]))).rejects.toThrow(/source checksum/);
 await expect(parseBrushPack(new Blob([bytes.slice(0,-1)]))).rejects.toThrow(/extent/);await expect(parseBrushPack(new Blob([bytes,new Uint8Array([0])]))).rejects.toThrow(/trailing/);
 const abort=new AbortController();abort.abort();await expect(exportBrushPack([preset],abort.signal)).rejects.toThrow();await expect(parseBrushPack(file,abort.signal)).rejects.toThrow();
});

it('retains a ready source through asynchronous hashing and refuses invalid combined capture before source work',async()=>{
 const {owner,store,close}=await original(),capture=capturePresetSource(owner);owner.clear();store.dispose();expect(close).not.toHaveBeenCalled();const source=await capture;expect(source.width).toBe(2);expect(close).toHaveBeenCalledTimes(1);
 const fail=vi.spyOn(owner,'captureFrom');await expect(captureBrushPreset('Bad','brush',{...settings(),tip:{roundness:0,angle:0},texture:{channel:'alpha',invert:false}},owner)).rejects.toThrow();expect(fail).not.toHaveBeenCalled();
 await expect(captureBrushPreset('Bad','brush',{...settings(),texture:{channel:'invalid',invert:false} as unknown as ToolSettings['texture']},owner)).rejects.toThrow();
});

it('binary recovery preserves invalid raw records and exact source blobs while legacy recovery stays JSON',async()=>{
 const blob=new Blob([new Uint8Array([0,255,42,1])],{type:'application/octet-stream'}),records=[{id:'invalid',preset:{unexpected:true},source:{blob,name:'Original invalid bytes'}},{id:'other',blob:new Blob([])}];
 expect(()=>serializeBrushRecovery(records)).toThrow(/non-JSON/);const backup=await prepareBrushRecovery(records),raw=await parseBrushRecoveryFile(backup.blob);
 expect(backup.blob.type).toBe('application/x-canoli-brush-recovery');expect((await prepareBrushRecovery(raw)).fingerprint).toBe(backup.fingerprint);
 const recovered=raw[0] as typeof records[0];expect(await recovered.source!.blob.arrayBuffer()).toEqual(await blob.arrayBuffer());expect(recovered.preset).toEqual({unexpected:true});
 const changed=await prepareBrushRecovery([{...records[0],source:{...records[0].source,blob:new Blob([new Uint8Array([0,255,42,2])],{type:blob.type})}}]);expect(changed.fingerprint).not.toBe(backup.fingerprint);
 const legacy=[{id:'bad',unsupported:true}];expect(await(await prepareBrushRecovery(legacy)).blob.text()).toBe(serializeBrushRecovery(legacy));
});

for(const value of [new Date(),undefined,NaN,1n])it(`refuses unsupported raw recovery values (${typeof value}) without silently erasing them`,async()=>{
 await expect(prepareBrushRecovery([{value,blob:new Blob(['source'])}])).rejects.toThrow(/non-JSON/);
});

it('rejects malformed recovery paths, references and non-JSON aliases without executing data',async()=>{
 const blob=new Blob(['exact'],{type:'image/png'}),backup=await encodeBrushContainer({format:'canoli-brush-library-recovery',version:2,records:[{blob:null}],paths:[['0','__proto__']]},[blob],'application/x-canoli-brush-recovery');await expect(parseBrushRecoveryFile(backup.blob)).rejects.toThrow(/path/);expect(Object.prototype).not.toHaveProperty('blob');
 const shared={name:'alias'};await expect(prepareBrushRecovery([{a:shared,b:shared,blob}])).rejects.toThrow(/non-JSON/);
});

it('binary recovery retains File identity metadata and distinguishes same-byte timestamp changes',async()=>{
 const a=new File(['same original bytes'],'original.png',{type:'image/png',lastModified:123456}),b=new File([a],'original.png',{type:a.type,lastModified:123457});
 const backup=await prepareBrushRecovery([{file:a}]),raw=await parseBrushRecoveryFile(backup.blob),file=(raw[0] as {file:File}).file;
 expect(file).toBeInstanceOf(File);expect(file.name).toBe(a.name);expect(file.lastModified).toBe(a.lastModified);expect(await file.text()).toBe(await a.text());expect((await prepareBrushRecovery(raw)).fingerprint).toBe(backup.fingerprint);
 expect((await prepareBrushRecovery([{file:b}])).fingerprint).not.toBe(backup.fingerprint);
 const named=new File([a],'renamed.png',{type:a.type,lastModified:a.lastModified});expect((await prepareBrushRecovery([{file:named}])).fingerprint).not.toBe(backup.fingerprint);
});

it('refuses unsupported File directory metadata rather than silently losing a raw value',async()=>{
 const file=new File(['original'],'image.png');Object.defineProperty(file,'webkitRelativePath',{value:'folder/image.png'});await expect(prepareBrushRecovery([{file}])).rejects.toThrow(/directory metadata/);
});

it('archives an own __proto__ blob key as ordinary data without changing object prototypes',async()=>{
 const value=JSON.parse('{"__proto__":null,"constructor":{"prototype":null}}') as Record<string,unknown>;Object.defineProperty(value,'__proto__',{value:new Blob(['original prototype-named data']),writable:true,enumerable:true,configurable:true});
 const backup=await prepareBrushRecovery([value]),raw=(await parseBrushRecoveryFile(backup.blob))[0] as Record<string,unknown>;
 expect(Object.getPrototypeOf(raw)).toBe(Object.prototype);expect(Object.hasOwn(raw,'__proto__')).toBe(true);expect(await(raw.__proto__ as Blob).text()).toBe('original prototype-named data');expect(Object.prototype).not.toHaveProperty('prototype');expect((await prepareBrushRecovery([raw])).fingerprint).toBe(backup.fingerprint);
});
