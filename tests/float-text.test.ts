import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {Document,TextLayer} from '../src/dom';
import {AssetStore} from '../src/core/assets';
import {SCHEMA_VERSION,validateDocument} from '../src/core/model';
import {prepareFontBytes} from '../src/fonts/parser';

it('native float text requires schema 60, retains original sources and shares exact OO history',async()=>{
 const assets=new AssetStore({fontSources:{nativeSet:null,prepare:async(source,options)=>prepareFontBytes(new Uint8Array(await source.arrayBuffer()),options)}}),doc=new Document({assets,width:128,height:96});
 try{const file=await doc.fonts.embed(new Blob([readFileSync('tests/fixtures/shaping-font/Shaping.ttf')]));doc.convertToFloat();const before=doc.toJSON(),past=doc.getSnapshot().past.length,layer=doc.layers.add(new TextLayer({text:'AV',fontFamily:file.family,fontSize:40,color:'color(srgb-linear 4 -.25 1.5 / .5)'})),after=doc.toJSON();expect(after.schemaVersion).toBe(SCHEMA_VERSION);expect(doc.getSnapshot().past.length).toBe(past+1);expect(()=>validateDocument({...after,schemaVersion:59})).toThrow(/version 60/);doc.undo();expect(doc.toJSON()).toEqual(before);doc.redo();expect(doc.toJSON()).toEqual(after);expect(Document.fromJSON(after).toJSON()).toEqual(after);expect(layer.fontFamily).toBe(file.family);expect(Buffer.from(await assets.fonts.get(file.id).original.arrayBuffer())).toEqual(readFileSync('tests/fixtures/shaping-font/Shaping.ttf'));}finally{assets.dispose();}
});

it('unowned float typography rolls back mixed edits and in-use font replacement atomically',async()=>{
 const assets=new AssetStore({fontSources:{nativeSet:null,prepare:async(source,options)=>prepareFontBytes(new Uint8Array(await source.arrayBuffer()),options)}}),doc=new Document({assets,width:128,height:96});
 try{const file=await doc.fonts.embed(new Blob([readFileSync('tests/fixtures/shaping-font/Shaping.ttf')]));doc.convertToFloat();const layer=doc.layers.add(new TextLayer({text:'AV',fontFamily:file.family})),before=doc.toJSON(),revision=doc.getSnapshot().revision;expect(()=>doc.transaction('Rejected font',()=>{layer.opacity=.25;layer.fontFamily='sans-serif';})).toThrow(/declared original font/);expect(doc.toJSON()).toEqual(before);expect(doc.getSnapshot().revision).toBe(revision);expect(()=>file.remove({replaceWith:'serif'})).toThrow(/declared original font/);expect(doc.toJSON()).toEqual(before);layer.fontFamily=file.family+', sans-serif';expect(layer.fontFamily).toBe(file.family+', sans-serif');}finally{assets.dispose();}
});
