import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {Document,TextLayer} from '../src/dom';
import {AssetStore} from '../src/core/assets';
import {FontSourceStore,type FontResourcePreparer} from '../src/fonts/store';
import {prepareFontBytes} from '../src/fonts/parser';
import {captureOwnedExportFonts} from '../src/engine/export-fonts';

const source=()=>new Blob([readFileSync('tests/fixtures/fonts/Regular.ttf')]);
const prepare:FontResourcePreparer=async(blob,options)=>prepareFontBytes(new Uint8Array(await blob.arrayBuffer()),options);
function scene(){const assets=new AssetStore({fontSources:{nativeSet:null,prepare}}),document=new Document({assets});return{assets,document};}
const trim=(document:Document)=>{for(let index=0;index<65;index++)document.name=`Retained state ${index}`;};

it('releases rejected staged bytes while concurrent identical leases remain independent',async()=>{
  const store=new FontSourceStore({nativeSet:null,prepare}),[a,b]=await Promise.all([store.stage(source()),store.stage(source())]);
  expect(a.resource).toBe(b.resource);expect(store.size).toBe(1);a.release();b.check();expect(store.has(b.resource.id)).toBe(true);a.release();b.release();expect(store.size).toBe(0);store.dispose();
});

it('preserves explicit unadopted host preparations and transfers ownership when a model binds',async()=>{
  const store=new FontSourceStore({nativeSet:null,prepare}),resource=await store.prepare(source()),lease=await store.stage(source());lease.release();expect(store.has(resource.id)).toBe(true);
  const ids=new Set([resource.id]),owner={_fontSourceIds:()=>ids},unbind=store.bind(owner);store.collect();expect(store.has(resource.id)).toBe(true);ids.clear();store.collect();expect(store.has(resource.id)).toBe(false);unbind();store.dispose();
});

it('drops an unadopted lease when cancellation wins the publication microtask',async()=>{
  const store=new FontSourceStore({nativeSet:null,prepare}),abort=new AbortController(),retain=store.retain.bind(store);
  store.retain=id=>{const lease=retain(id);queueMicrotask(()=>abort.abort(new Error('Cancelled at publication.')));return lease;};
  await expect(store.stage(source(),{}, {signal:abort.signal})).rejects.toThrow('Cancelled at publication');await new Promise(resolve=>setTimeout(resolve,0));expect(store.size).toBe(0);store.dispose();
});

it('detects removal and reinstallation even when immutable resource objects are shared',async()=>{
  const a=new FontSourceStore({nativeSet:null,prepare}),b=new FontSourceStore({nativeSet:null,prepare}),resource=await a.prepare(source());a.shareTo(b,resource.id);const check=a.capture(resource.id);
  a.remove(resource.id);b.shareTo(a,resource.id);expect(a.get(resource.id)).toBe(resource);expect(check).toThrow('owned font source changed');a.dispose();b.dispose();
});

it('keeps failed or stale document imports out of the source pool',async()=>{
  const{document,assets}=scene();document.layers.add(new TextLayer({text:'Locked',fontFamily:'serif',locked:true}));
  await expect(document.fonts.embed(source(),{replace:'serif'})).rejects.toThrow(/Unlock/);expect(assets.fonts.size).toBe(0);
  await expect(document.fonts.embed(source(),{}, {beforeCommit(){document.name='Concurrent edit';}})).rejects.toThrow('changed during font preparation');expect(assets.fonts.size).toBe(0);assets.dispose();
});

it('retains removed fonts through undo and redo, then collects after the last retained transition expires',async()=>{
  const{document,assets}=scene(),font=await document.fonts.embed(source()),id=font.id;font.remove();expect(assets.fonts.has(id)).toBe(true);document.undo();expect(font.isAttached).toBe(true);document.redo();expect(font.isAttached).toBe(false);
  trim(document);expect(assets.fonts.has(id)).toBe(false);assets.dispose();
});

it('keeps branch-only sources until the last owning branch is deleted',async()=>{
  const{document,assets}=scene(),empty=document.createHistoryBranch('Empty route'),withFont=document.createHistoryBranch('Font route'),font=await document.fonts.embed(source()),id=font.id;
  document.checkoutHistoryBranch(empty);trim(document);expect(document.fonts.files.length).toBe(0);expect(assets.fonts.has(id)).toBe(true);
  document.deleteHistoryBranch(withFont);expect(assets.fonts.has(id)).toBe(false);assets.dispose();
});

it('keeps comparison-only sources until their saved comparison is deleted',async()=>{
  const{document,assets}=scene(),position=document.getSnapshot().past.length,font=await document.fonts.embed(source()),id=font.id;
  const comparison=document.createHistoryComparison('Embedded reference',{kind:'timeline',position},{kind:'current'});font.remove();trim(document);expect(assets.fonts.has(id)).toBe(true);
  document.deleteHistoryComparison(comparison);expect(assets.fonts.has(id)).toBe(false);assets.dispose();
});

it('protects shared component views independently of parent history collection',async()=>{
  const{document,assets}=scene(),font=await document.fonts.embed(source()),id=font.id,master=new Document({width:100,height:100});master.layers.add(new TextLayer({text:'ABC',fontFamily:font.family}));
  const component=document.defineComponent(master),view=document.getComponent(component);font.remove({replaceWith:'serif'});trim(document);expect(assets.fonts.has(id)).toBe(true);expect(view.fonts.files.getById(id)).toBeDefined();
  view.assetStore=null;expect(assets.fonts.has(id)).toBe(false);assets.dispose();
});

it('pins captured export fonts across model/history collection and releases them at operation end',async()=>{
  const{document,assets}=scene(),font=await document.fonts.embed(source()),id=font.id,family=font.family,snapshot=document._read(),capture=captureOwnedExportFonts([snapshot],[family],assets);
  font.remove();trim(document);capture();expect(assets.fonts.has(id)).toBe(true);capture.release();expect(assets.fonts.has(id)).toBe(false);assets.dispose();
});

it('rejects history navigation before publication if a referenced source was explicitly lost',async()=>{
  const{document,assets}=scene(),font=await document.fonts.embed(source());font.name='Changed label';assets.fonts.remove(font.id);const before=document.getSnapshot();
  expect(()=>document.undo()).toThrow('Missing font source');expect(document.getSnapshot()).toBe(before);expect(()=>document.createHistoryBranch('Invalid source')).toThrow('Missing font source');assets.dispose();
});

it('relinks all fallback-list references and sources in one edit, preserving labels and exact undo',async()=>{
  const{document,assets}=scene(),old=await document.fonts.embed(source(),{name:'Campaign'}),oldId=old.id,family=old.family,text=document.layers.add(new TextLayer({text:'ABC',fontFamily:`"${family}", serif`})),before=document.toJSON(),past=document.getSnapshot().past.length;
  const replacement=await old.relink(new Blob([readFileSync('tests/fixtures/fonts/Bold.ttf')]));expect(replacement.id).not.toBe(oldId);expect(replacement.name).toBe('Campaign');expect(replacement.resource.report.faces[0].fullName).toBe('Canoli Source Bold');expect(text.fontFamily).toBe(`${replacement.family}, serif`);
  expect(old.isAttached).toBe(false);expect(document.getSnapshot().past).toHaveLength(past+1);expect(assets.fonts.size).toBe(2);const after=document.toJSON();
  document.undo();expect(document.toJSON()).toEqual(before);document.redo();expect(document.toJSON()).toEqual(after);expect(assets.fonts.has(oldId)).toBe(true);assets.dispose();
});

it('rolls back locked relinking and immediately collects the rejected replacement',async()=>{
  const{document,assets}=scene(),font=await document.fonts.embed(source()),text=document.layers.add(new TextLayer({text:'ABC',fontFamily:font.family,locked:true})),before=document.toJSON();
  await expect(font.relink(new Blob([readFileSync('tests/fixtures/fonts/Bold.ttf')]))).rejects.toThrow(/Unlock/);expect(document.toJSON()).toEqual(before);expect(assets.fonts.size).toBe(1);expect(text.fontFamily).toBe(font.family);assets.dispose();
});

it('treats identical relinking as a no-op and rejects detached or malformed requests',async()=>{
  const{document,assets}=scene(),font=await document.fonts.embed(source()),revision=document.getSnapshot().revision;
  expect(await font.relink(source())).toBe(font);expect(document.getSnapshot().revision).toBe(revision);
  await expect(font.relink(source(),{extra:true}as never)).rejects.toThrow();await font.relink(source(),{name:'Renamed face'});expect(font.name).toBe('Renamed face');font.remove();await expect(font.relink(source())).rejects.toThrow('attached');assets.dispose();
});
