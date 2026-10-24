import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {FontSourceStore,type FontResourcePreparer} from '../src/fonts/store';
import {prepareFontBytes} from '../src/fonts/parser';
import {describePreparedFont,ownFontResource} from '../src/fonts/resources';

const fixture=(name='Regular.ttf')=>new Blob([readFileSync(`tests/fixtures/fonts/${name}`)]);
const headless:FontResourcePreparer=async(source,options)=>prepareFontBytes(new Uint8Array(await source.arrayBuffer()),options);
const native:FontResourcePreparer=async(source,options)=>{
  const prepared=await headless(source,options,{}),face=prepared.report.faces[0];
  return{...prepared,fontFaces:face.descriptors.map(value=>({family:face.cssFamily,...value,unicodeRange:'U+0-10FFFF',status:'loaded',featureSettings:'normal',ascentOverride:'normal',descentOverride:'normal',lineGapOverride:'normal',display:'auto'}as unknown as FontFace))};
};

describe('owned font resources and independent native leases',()=>{
  it('keeps prepared records inert, immutable and separate from image geometry',async()=>{
    const store=new FontSourceStore({nativeSet:null,prepare:headless}),source=fixture();
    const value=await store.prepare(source);
    expect(value.original).toBe(source);expect(value.descriptor.report.faces[0].fullName).toBe('Canoli Source Regular');
    expect(store.isActive(value.id)).toBe(false);expect(store.nativeAvailable).toBe(false);
    expect(Object.isFrozen(value)).toBe(true);expect(Object.isFrozen(value.descriptor.report.faces[0].axes)).toBe(true);
    expect(value).not.toHaveProperty('width');expect(value).not.toHaveProperty('bitmap');expect(value).not.toHaveProperty('fontFaces');
    store.activate(value.id);expect(store.isActive(value.id)).toBe(true);store.dispose();expect(store.has(value.id)).toBe(false);
  });
  it('deduplicates complete collection originals while preserving different whole faces',async()=>{
    const store=new FontSourceStore({nativeSet:null,prepare:headless}),a=await store.prepare(fixture('Collection.ttc'),{faceIndex:0}),b=await store.prepare(fixture('Collection.ttc'),{faceIndex:1});
    expect(a.original).toBe(b.original);expect(a.id).not.toBe(b.id);expect(a.descriptor.render.sha256).not.toBe(b.descriptor.render.sha256);
    expect(new Uint8Array(await a.original.arrayBuffer())).toEqual(new Uint8Array(await fixture('Collection.ttc').arrayBuffer()));
    store.remove(a.id);expect(store.get(b.id).original).toBe(b.original);store.dispose();
  });
  it('shares ready native fonts with independent ownership across document stores',async()=>{
    const set=new Set<FontFace>(),a=new FontSourceStore({nativeSet:set,prepare:native}),b=new FontSourceStore({nativeSet:set,prepare:native});
    const resource=await a.prepare(fixture());expect(set.size).toBe(0);a.activate(resource.id);expect(set.size).toBe(1);
    const copied=a.shareTo(b,resource.id),check=b.capture(resource.id);expect(copied.original).toBe(resource.original);b.activate(resource.id);b.activate(resource.id);expect(set.size).toBe(1);
    a.dispose();check();expect(set.size).toBe(1);expect(b.get(resource.id).id).toBe(resource.id);b.dispose();expect(set.size).toBe(0);
  });
  it('detects native replacement/removal and descriptor mutation without changing resource bytes',async()=>{
    const set=new Set<FontFace>(),store=new FontSourceStore({nativeSet:set,prepare:native}),value=await store.prepare(fixture());store.activate(value.id);const check=store.capture(value.id),face=[...set][0];
    face.weight='700';expect(check).toThrow('registration changed');face.weight='400';check();set.delete(face);expect(check).toThrow('registration changed');set.add(face);store.deactivate(value.id);
    face.family='Changed native family';expect(()=>store.activate(value.id)).toThrow('changed after preparation');expect(set.size).toBe(0);expect(store.get(value.id).original).toBe(value.original);store.dispose();
  });
  it('rejects corrupt source/native bytes, false MIME and forged stored declarations before installation',async()=>{
    const prepared=await headless(fixture(),{},{}),descriptor=describePreparedFont(prepared),original=fixture(),store=new FontSourceStore({nativeSet:null,prepare:headless});
    const malformed=new Uint8Array(await original.arrayBuffer());malformed[malformed.length-1]^=1;
    await expect(store.restore({descriptor,original:new Blob([malformed]),renderBlob:prepared.renderBlob})).rejects.toThrow('Original font checksum');
    await expect(ownFontResource({descriptor,original,renderBlob:new Blob([await prepared.renderBlob.arrayBuffer()])})).rejects.toThrow('MIME');
    const forged=structuredClone(descriptor);forged.report.faces[0].fullName='Forged font declaration';
    await expect(store.restore({descriptor:forged,original,renderBlob:prepared.renderBlob})).rejects.toThrow('differ from their original');expect(store.values()).toEqual([]);store.dispose();
  });
  it('snapshots stored declarations before asynchronous validation and restores actual original faces',async()=>{
    const prepared=await headless(fixture('Collection.dfont'),{faceIndex:1},{}),descriptor=describePreparedFont(prepared),input={descriptor,original:fixture('Collection.dfont'),renderBlob:prepared.renderBlob},store=new FontSourceStore({nativeSet:null,prepare:headless});
    const pending=store.restore(input);descriptor.report.faces[0].fullName='Mutated after submission';input.original=fixture();
    const value=await pending;expect(value.descriptor.report.faces[0].fullName).toBe('Canoli Source Bold');expect(value.descriptor.report.format).toBe('dfont');expect(new Uint8Array(await value.renderBlob.arrayBuffer())).toEqual(new Uint8Array(readFileSync('tests/fixtures/fonts/Bold.ttf')));store.dispose();
  });
  it('rejects immediately on disposal, propagates cancellation and ignores a late parser result',async()=>{
    let finish!:(value:Awaited<ReturnType<FontResourcePreparer>>)=>void,observed:AbortSignal|undefined;
    const prepare:FontResourcePreparer=(_source,_options,control)=>{observed=control.signal;return new Promise(resolve=>{finish=resolve;});};
    const set=new Set<FontFace>(),store=new FontSourceStore({nativeSet:set,prepare}),pending=store.prepare(fixture());store.dispose();
    await expect(pending).rejects.toThrow('disposed');expect(observed?.aborted).toBe(true);finish(await native(fixture(),{},{}));await new Promise(resolve=>setTimeout(resolve,0));expect(set.size).toBe(0);expect(()=>store.values()).toThrow('disposed');
  });
  it('rejects caller cancellation and does not install a late successful result',async()=>{
    let finish!:(value:Awaited<ReturnType<FontResourcePreparer>>)=>void;
    const store=new FontSourceStore({nativeSet:null,prepare:()=>new Promise(resolve=>{finish=resolve;})}),abort=new AbortController(),pending=store.prepare(fixture(),{}, {signal:abort.signal});abort.abort(new Error('Font import cancelled.'));
    await expect(pending).rejects.toThrow('Font import cancelled');finish(await headless(fixture(),{},{}));await new Promise(resolve=>setTimeout(resolve,0));expect(store.values()).toEqual([]);store.dispose();
  });
  it('concurrent identical preparations share one resource and activate one native face',async()=>{
    const set=new Set<FontFace>(),store=new FontSourceStore({nativeSet:set,prepare:native}),[a,b]=await Promise.all([store.prepare(fixture()),store.prepare(fixture())]);
    expect(a).toBe(b);expect(store.values()).toHaveLength(1);expect(set.size).toBe(0);store.activate(a.id);expect(set.size).toBe(1);store.dispose();expect(set.size).toBe(0);
  });
});
