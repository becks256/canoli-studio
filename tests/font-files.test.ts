import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {Document,FontFile,TextLayer,ParagraphStyle} from '../src/dom';
import {AssetStore} from '../src/core/assets';
import {validateDocument} from '../src/core/model';
import {captureRetainedHistory} from '../src/core/history';
import {loadProject,readProject,serializeProject} from '../src/core/project';
import {prepareFontBytes} from '../src/fonts/parser';
import {getExportCapabilityReport} from '../src/engine/export';
import type {FontResourcePreparer} from '../src/fonts/store';

const fixture=(name='Regular.ttf')=>new Blob([readFileSync(`tests/fixtures/fonts/${name}`)]);
const prepare:FontResourcePreparer=async(source,options)=>prepareFontBytes(new Uint8Array(await source.arrayBuffer()),options);
const sourceOptions={nativeSet:null,prepare};
function scene(){const assets=new AssetStore({fontSources:sourceOptions}),document=new Document({width:300,height:100,assets});return{assets,document};}
async function manifestOf(file:Blob){const header=new Uint8Array(await file.slice(0,48).arrayBuffer()),length=Number(new DataView(header.buffer).getBigUint64(8,true));return{header,length,manifest:JSON.parse(await file.slice(48,48+length).text())};}
async function rewrite(file:Blob,change:(manifest:any)=>void,version?:number){
  const{header,length,manifest}=await manifestOf(file);change(manifest);if(version){header[4]=48+version;manifest.version=version;}
  const bytes=new TextEncoder().encode(JSON.stringify(manifest));new DataView(header.buffer).setBigUint64(8,BigInt(bytes.length),true);header.set(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),16);return new Blob([header,bytes,file.slice(48+length)]);
}

it('embeds a real selected face and replaces inherited requests in one undo step',async()=>{
  const{document,assets}=scene(),style=document.paragraphStyles.add(new ParagraphStyle({name:'Body',format:{fontFamily:'serif'}})),text=document.layers.add(new TextLayer({text:'ABC'}));text.paragraphStyle=style;
  const before=document.toJSON(),past=document.getSnapshot().past.length;
  const font=await document.fonts.embed(fixture('Collection.ttc'),{faceIndex:1,replace:'serif',name:'Campaign bold'});
  expect(font).toBeInstanceOf(FontFile);expect(font.name).toBe('Campaign bold');expect(font.resource.report.faces[0].fullName).toBe('Canoli Source Bold');expect(text.fontFamily).toBe(font.family);expect(text.paragraphOverrides).toEqual({});
  expect(document.getSnapshot().past).toHaveLength(past+1);expect(assets.fonts.isActive(font.id)).toBe(true);
  const after=document.toJSON();document.undo();expect(document.toJSON()).toEqual(before);expect(font.isAttached).toBe(false);expect(assets.fonts.has(font.id)).toBe(true);
  document.redo();expect(document.toJSON()).toEqual(after);expect(document.fonts.files.getById(font.id)).toBe(font);assets.dispose();
});

it('renames attached handles through history and removes used fallback tokens only with an explicit replacement',async()=>{
  const{document,assets}=scene(),font=await document.fonts.embed(fixture()),alias=font.family;
  const text=document.layers.add(new TextLayer({text:'ABC',fontFamily:`"${alias}", serif`}));
  const before=document.toJSON();expect(()=>font.remove()).toThrow('in use');expect(()=>font.remove({replaceWith:`'${alias}'`})).toThrow('still references');expect(document.toJSON()).toEqual(before);
  font.name='Renamed';expect(font.name).toBe('Renamed');document.undo();expect(font.name).toBe('Canoli Source Regular');document.redo();
  font.remove({replaceWith:'monospace'});expect(text.fontFamily).toBe('monospace, serif');expect(font.isAttached).toBe(false);expect(()=>font.name).toThrow('no longer attached');
  document.undo();expect(font.isAttached).toBe(true);expect(text.fontFamily).toBe(`"${alias}", serif`);assets.dispose();
});

it('rolls back model and newly activated native ownership when replacement hits locked text',async()=>{
  const{document,assets}=scene(),text=document.layers.add(new TextLayer({text:'ABC',fontFamily:'serif',locked:true})),before=document.toJSON();
  await expect(document.fonts.embed(fixture(),{replace:'serif'})).rejects.toThrow(/Unlock/);
  expect(document.toJSON()).toEqual(before);expect(text.fontFamily).toBe('serif');expect(assets.fonts.values().every(value=>!assets.fonts.isActive(value.id))).toBe(true);assets.dispose();
});

it('protects locked instances when adding an already requested alias even with unchanged estimated metrics',async()=>{
  const{document,assets}=scene(),resource=await assets.fonts.prepare(fixture()),master=new Document({width:100,height:100});
  master.layers.add(new TextLayer({text:'ABC',fontFamily:resource.cssFamily}));
  const id=document.defineComponent(master,{name:'Master'});document.placeSmartObject(id).locked=true;const before=document.toJSON();
  await expect(document.fonts.embed(fixture())).rejects.toThrow(/locked instance/);expect(document.toJSON()).toEqual(before);expect(assets.fonts.isActive(resource.id)).toBe(false);assets.dispose();
});

it('rejects missing/forged source declarations before publishing a document command',async()=>{
  const{document,assets}=scene(),other=scene(),resource=await assets.fonts.prepare(fixture()),data={id:resource.id,name:'Font',resource:structuredClone(resource.descriptor)};
  expect(()=>other.document.fonts.files.add(new FontFile(data))).toThrow('Missing font source');data.resource.report.faces[0].fullName='Forged';
  expect(()=>document.fonts.files.add(new FontFile(data))).toThrow('differ from their owned source');expect(document.fonts.files.length).toBe(0);assets.dispose();other.assets.dispose();
});

it('preserves accepted sources when an observer throws after the edit',async()=>{
  const{document,assets}=scene(),unsubscribe=document.subscribe(()=>{throw new Error('observer');});
  await expect(document.fonts.embed(fixture())).rejects.toThrow('accepted');unsubscribe();const font=document.fonts.files.items[0];expect(font).toBeDefined();expect(assets.fonts.isActive(font.id)).toBe(true);document.undo();document.redo();expect(document.fonts.files.getById(font.id)).toBe(font);assets.dispose();
});

it('rejects stale asynchronous imports and transaction use without publishing a binding',async()=>{
  let finish!:(value:Awaited<ReturnType<FontResourcePreparer>>)=>void;
  const assets=new AssetStore({fontSources:{nativeSet:null,prepare:()=>new Promise(resolve=>{finish=resolve;})}}),document=new Document({assets});
  const pending=document.fonts.embed(fixture());document.name='Changed during preparation';finish(await prepare(fixture(),{},{}));
  await expect(pending).rejects.toThrow('changed during font preparation');expect(document.fonts.files.length).toBe(0);expect(assets.fonts.values().every(value=>!assets.fonts.isActive(value.id))).toBe(true);
  let nested:Promise<FontFile>|undefined;document.transaction('No asynchronous import',()=>{nested=document.fonts.embed(fixture());});await expect(nested).rejects.toThrow('outside synchronous transactions');assets.dispose();
});

it('requires schema 43 for font declarations, while legacy family requests remain valid',async()=>{
  const{document,assets}=scene();await document.fonts.embed(fixture());const data=document.toJSON();data.schemaVersion=42;expect(()=>validateDocument(data)).toThrow(/43/);
  delete data.fontFiles;validateDocument(data);assets.dispose();
});

it('rechecks cancellation, revision and owner guards after the final preparation callback',async()=>{
  const{document,assets}=scene(),abort=new AbortController();
  await expect(document.fonts.embed(fixture(),{}, {beforeCommit(){throw new Error('Captured owner closed.');}})).rejects.toThrow('Captured owner closed');
  await expect(document.fonts.embed(fixture(),{}, {signal:abort.signal,beforeCommit(){abort.abort(new Error('Cancelled before commit.'));}})).rejects.toThrow('Cancelled before commit');
  await expect(document.fonts.embed(fixture(),{}, {beforeCommit(){document.name='Concurrent edit';}})).rejects.toThrow('changed during font preparation');
  expect(document.fonts.files.length).toBe(0);expect(assets.fonts.values().every(value=>!assets.fonts.isActive(value.id))).toBe(true);assets.dispose();
});

it('saves exact original and selected bytes as v5 and reparses them on load',async()=>{
  const{document,assets}=scene(),a=await document.fonts.embed(fixture('Collection.ttc'),{faceIndex:0}),b=await document.fonts.embed(fixture('Collection.ttc'),{faceIndex:1});
  const file=await serializeProject(document.toJSON(),assets),{header,manifest}=await manifestOf(file);expect(header[4]).toBe(53);expect(manifest.fonts.resources).toHaveLength(2);expect(manifest.fonts.payloads).toHaveLength(3);
  const decoded=await readProject(file);expect(decoded.fonts).toHaveLength(2);expect(await decoded.fonts[0].original.arrayBuffer()).toEqual(await fixture('Collection.ttc').arrayBuffer());expect(await decoded.fonts[1].renderBlob.arrayBuffer()).toEqual(await assets.fonts.get(b.id).renderBlob.arrayBuffer());
  const loaded=await loadProject(file,{fontSources:sourceOptions}),reopened=Document.fromJSON(loaded.document);reopened.assetStore=loaded.assets;
  expect(reopened.fonts.files.items.map(value=>value.id)).toEqual([a.id,b.id]);expect(loaded.assets.fonts.isActive(a.id)).toBe(true);expect(loaded.assets.fonts.get(a.id).original).toBe(loaded.assets.fonts.get(b.id).original);assets.dispose();loaded.assets.dispose();
});

it('deduplicates standalone original/native bytes and retains history-only resources',async()=>{
  const{document,assets}=scene(),font=await document.fonts.embed(fixture());font.remove();
  const file=await serializeProject(document.toJSON(),assets,captureRetainedHistory(document.getSnapshot())),{manifest}=await manifestOf(file);expect(manifest.fonts.payloads).toHaveLength(1);expect(manifest.fonts.resources[0].originalIndex).toBe(manifest.fonts.resources[0].renderIndex);
  const loaded=await loadProject(file,{fontSources:sourceOptions}),reopened=Document._fromWorkspace(loaded.document,loaded.history);reopened.assetStore=loaded.assets;expect(reopened.fonts.files.length).toBe(0);reopened.undo();expect(reopened.fonts.files.getById(font.id)).toBeDefined();
  const noHistory=await serializeProject(document.toJSON(),assets);expect((await manifestOf(noHistory)).header[4]).toBe(51);assets.dispose();loaded.assets.dispose();
});

it('rejects corrupt font bytes, invalid extents, missing/unused payloads and old-version relabeling',async()=>{
  const{document,assets}=scene();await document.fonts.embed(fixture('Collection.ttc'),{faceIndex:0});const file=await serializeProject(document.toJSON(),assets),damaged=new Uint8Array(await file.arrayBuffer());damaged[damaged.length-1]^=1;
  await expect(readProject(new Blob([damaged]))).rejects.toThrow(/checksum/);
  for(const change of [(m:any)=>{m.fonts.payloads[0].offset++;},(m:any)=>{m.fonts.resources=[];},(m:any)=>{m.fonts.resources[0].renderIndex=100;},(m:any)=>{m.fonts.resources.push(m.fonts.resources[0]);},(m:any)=>{delete m.fonts;}])await expect(readProject(await rewrite(file,change))).rejects.toThrow();
  await expect(readProject(await rewrite(file,()=>{},3))).rejects.toThrow('version-5');assets.dispose();
});

it('requires source ownership at save time and pins bytes before asynchronous encoding',async()=>{
  const{document,assets}=scene();await document.fonts.embed(fixture());
  await expect(serializeProject(document.toJSON(),{get(){throw new Error('No images');}})).rejects.toThrow('Missing project font source');
  const pending=serializeProject(document.toJSON(),assets);assets.dispose();const file=await pending;expect((await readProject(file)).fonts).toHaveLength(1);
});

it('component editing retains font declarations needed by the complete stored master library',async()=>{
  const{document,assets}=scene(),regular=await document.fonts.embed(fixture()),bold=await document.fonts.embed(fixture('Bold.ttf'));
  const one=new Document({width:100,height:100}),two=new Document({width:100,height:100});one.layers.add(new TextLayer({text:'ABC',fontFamily:regular.family}));two.layers.add(new TextLayer({text:'ABC',fontFamily:bold.family}));
  const first=document.defineComponent(one,{name:'First'});document.defineComponent(two,{name:'Second'});
  const edited=document.getComponent(first);expect(edited.fonts.files.items.map(value=>value.id).sort()).toEqual([regular.id,bold.id].sort());expect(edited.assetStore).toBe(assets);assets.dispose();
});

it('SVG reports embedded binaries only for fonts referenced by visible editable text',async()=>{
  const{document,assets}=scene(),file=await document.fonts.embed(fixture());document.layers.add(new TextLayer({text:'System font',fontFamily:'serif'}));const hidden=document.layers.add(new TextLayer({text:'Hidden native face',fontFamily:file.family,visible:false}));
  const feature='Complete selected embedded font faces as inline SVG font resources';expect(getExportCapabilityReport(document.toJSON(),{format:'svg'}).featuresPreserved).not.toContain(feature);
  hidden.visible=true;expect(getExportCapabilityReport(document.toJSON(),{format:'svg'}).featuresPreserved).toContain(feature);assets.dispose();
});
