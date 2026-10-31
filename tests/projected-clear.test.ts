import {expect,it} from 'vitest';
import {Document,RasterLayer,PerspectiveTransform,MarqueeSelection,LayerGroup,LayerMask,PaintFill,EraserStroke,WetPaintStroke,PencilStroke} from '../src/dom';
import {SCHEMA_VERSION,validateDocument,type RasterLayerData} from '../src/core/model';
import {parseCommands} from '../src/core/validation';
import {rasterErasureSchema} from '../src/core/drawing';
const perspective=new PerspectiveTransform({corners:[{x:.1,y:.05},{x:1.2,y:.2},{x:.95,y:1.2},{x:-.1,y:.9}]});
const setup=()=>{const document=new Document(),layer=document.layers.add(new RasterLayer({assetId:'original',width:100.5,height:80.25,perspective}));return{document,layer};};
const data=(layer:RasterLayer)=>layer.toJSON() as RasterLayerData;
const selection=()=>new MarqueeSelection({x:20,y:15,width:50,height:40,shape:'pixels',coverage:{width:2,height:1,runs:[1,128,2,255]}});

it('captures placed selection coverage in one Undo while retaining original source identity',()=>{
 const{document,layer}=setup(),clip=selection(),before=document.toJSON(),past=document.getSnapshot().past.length;layer.clear(clip,{space:'placed'});
 const entry=data(layer).erasures![0],after=document.toJSON();expect(entry.stroke).toMatchObject({kind:'fill',erase:true,clip:clip.toJSON()});expect(entry.placement).toEqual({perspective:perspective.toJSON(),bounds:{x:0,y:0,width:100.5,height:80.25}});expect(layer.assetId).toBe('original');expect(document.getSnapshot().past.length).toBe(past+1);
 document.undo();expect(document.toJSON()).toEqual(before);document.redo();expect(document.toJSON()).toEqual(after);
});
it('retains its captured plane after corner edits, reset, resizing and duplication',()=>{
 const{layer}=setup();layer.clear(selection(),{space:'placed'});const entry=data(layer).erasures![0];layer.perspective=null;layer.width=201;layer.height=160.5;expect(data(layer).erasures![0]).toEqual(entry);expect(data(layer.duplicate() as RasterLayer).erasures![0]).toEqual(entry);
});
it('preserves default/local clear and identity placed-call compatibility',()=>{
 const{document,layer}=setup();document.selection=selection();layer.clear();layer.clear(selection(),{space:'local'});layer.perspective=null;layer.clear(null,{space:'placed'});
 const entries=data(layer).erasures!;expect(entries.every(entry=>!entry.placement)).toBe(true);expect(entries[0].stroke).toMatchObject({kind:'fill',bounds:{x:0,y:0,width:100.5,height:80.25},clip:null});
});
it('rejects invalid options and constructors and locked ancestry without publishing changes',()=>{
 const{document,layer}=setup(),before=document.toJSON();for(const options of [null,true,[],{space:'world'},{space:'placed',extra:1}])expect(()=>layer.clear(selection(),options as never)).toThrow();expect(()=>layer.clear(selection().toJSON() as never,{space:'placed'})).toThrow(/MarqueeSelection/);expect(document.toJSON()).toEqual(before);
 const group=document.layers.add(new LayerGroup());layer.moveTo(group);group.locked=true;expect(()=>layer.clear(null,{space:'placed'})).toThrow(/Unlock/);
});
it('requires schema 52 for placed fills and keeps schema 51 erasers valid',()=>{
 const{document,layer}=setup();layer.clear(selection(),{space:'placed'});const saved=document.toJSON();expect(saved.schemaVersion).toBe(SCHEMA_VERSION);expect(Document.fromJSON(saved).toJSON()).toEqual(saved);
 const old=structuredClone(saved);old.schemaVersion=51;expect(()=>validateDocument(old)).toThrow(/version 52/);delete(old.children[0] as RasterLayerData).erasures;expect(Document.fromJSON(old).toJSON().schemaVersion).toBe(SCHEMA_VERSION);
 const legacy=setup();legacy.layer.erase(new EraserStroke({points:[{x:20,y:20}]}),{space:'placed'});const compatible=legacy.document.toJSON();compatible.schemaVersion=51;expect(()=>validateDocument(compatible)).not.toThrow();
 const entry=data(layer).erasures![0];old.children[0].mask=new LayerMask({rasterErasures:{width:layer.width,height:layer.height,operations:[{width:entry.width,height:entry.height,stroke:new PaintFill({bounds:{x:0,y:0,width:200,height:200},erase:true}),placement:{perspective,bounds:entry.placement!.bounds}}]}}).toJSON();expect(()=>validateDocument(old)).toThrow(/version 52/);
});
it('retains placed fills through mask constructor values, getters, refinements and strict commands',()=>{
 const{document,layer}=setup();layer.clear(selection(),{space:'placed'});const entries=data(layer).erasures!,mask=LayerMask._fromJSON({kind:'raster-erasures',width:layer.width,height:layer.height,erasures:entries,enabled:true,inverted:false,density:1});expect(mask.with({density:.5}).toJSON()).toMatchObject({erasures:entries,density:.5});expect(new LayerMask({rasterErasures:mask.rasterErasures!}).toJSON()).toMatchObject({erasures:entries});
 document._dispatch(parseCommands([{type:'layer.update',id:layer.id,patch:{erasures:entries}}])[0]);expect(data(layer).erasures).toEqual(entries);
});
it('rejects non-clear fills even when they carry otherwise valid placed metadata',()=>{
 const{layer}=setup();layer.clear(selection(),{space:'placed'});const entry=data(layer).erasures![0];expect(()=>rasterErasureSchema.parse({...entry,stroke:new PaintFill({bounds:{x:0,y:0,width:100,height:80},erase:false}).toJSON()})).toThrow(/eraser|clear/);
});

it('captures existing off-frame wet content without constraining the original frame',()=>{
 const{layer}=setup();layer.applyWetPaint(new WetPaintStroke({brush:new PencilStroke({points:[{x:120,y:20}],size:1,pressureSize:false}),tiles:[{x:119,y:19,width:3,height:3,assetId:'wet',coverage:{assetId:'support'}}]}));layer.clear(null,{space:'placed'});expect(data(layer).erasures![1].placement!.bounds.width).toBe(122);
});
