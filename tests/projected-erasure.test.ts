import {expect,it} from 'vitest';
import {Document,RasterLayer,EraserStroke,PerspectiveTransform,LayerMask,PaintFill,LayerGroup} from '../src/dom';
import {SCHEMA_VERSION,validateDocument} from '../src/core/model';
import {rasterErasureSchema} from '../src/core/drawing';
import {parseCommands} from '../src/core/validation';
import {perspectiveMatrix} from '../src/core/perspective';
import {layerMaskSchema} from '../src/core/masks';
const perspective=new PerspectiveTransform({corners:[{x:.1,y:.05},{x:.9,y:.15},{x:1.1,y:1},{x:-.1,y:.9}]});
const stroke=()=>new EraserStroke({points:[{x:30,y:25},{x:50,y:30}],size:11,hardness:.4,pressureSize:false});
const setup=()=>{const document=new Document(),layer=document.layers.add(new RasterLayer({assetId:'original',width:100.5,height:80.25,perspective}));return{document,layer};};

it('captures the placed plane in one shared undoable edit without altering source identity or points',()=>{
  const{document,layer}=setup(),before=document.toJSON(),count=document.getSnapshot().past.length,value=stroke();layer.erase(value,{space:'placed'});
  const after=document.toJSON(),entry=(layer.toJSON() as import('../src/core/model').RasterLayerData).erasures![0];
  expect(entry).toEqual({width:100.5,height:80.25,stroke:value.toJSON(),placement:{perspective:perspective.toJSON(),bounds:{x:0,y:0,width:100.5,height:80.25}}});
  expect(layer.assetId).toBe('original');expect(document.getSnapshot().past.length).toBe(count+1);document.undo();expect(document.toJSON()).toEqual(before);document.redo();expect(document.toJSON()).toEqual(after);
  layer.perspective=null;layer.width=201;expect((layer.toJSON() as import('../src/core/model').RasterLayerData).erasures![0]).toEqual(entry);
});
it('keeps default/local coordinates and identity placed calls compatible',()=>{
  const{layer}=setup();layer.erase(stroke());layer.erase(stroke(),{space:'local'});layer.perspective=null;layer.erase(stroke(),{space:'placed'});
  expect((layer.toJSON() as import('../src/core/model').RasterLayerData).erasures!.every(entry=>!entry.placement)).toBe(true);
});
it('rejects invalid options, constructors and locked ancestry atomically',()=>{
  const{document,layer}=setup(),before=document.toJSON();
  for(const options of [null,true,[],{space:'world'},{space:'placed',extra:1}])expect(()=>layer.erase(stroke(),options as never)).toThrow();
  expect(()=>layer.erase(stroke().toJSON() as never,{space:'placed'})).toThrow(/EraserStroke/);expect(document.toJSON()).toEqual(before);
  const group=document.layers.add(new LayerGroup());layer.moveTo(group);group.locked=true;expect(()=>layer.erase(stroke(),{space:'placed'})).toThrow(/Unlock/);
});
it('strictly validates projected eraser records including finite captured content',()=>{
  const{layer}=setup();layer.erase(stroke(),{space:'placed'});const entry=(layer.toJSON() as import('../src/core/model').RasterLayerData).erasures![0];
  expect(()=>rasterErasureSchema.parse({...entry,stroke:new PaintFill({bounds:{x:0,y:0,width:100,height:80},erase:true}).toJSON()})).toThrow(/eraser stroke/);
  expect(()=>rasterErasureSchema.parse({...entry,placement:{...entry.placement,extra:1}})).toThrow();
  expect(()=>rasterErasureSchema.parse({...entry,placement:{...entry.placement,bounds:{x:0,y:0,width:Infinity,height:80}}})).toThrow();
  // The horizon of this valid image quad lies above its frame.
  const p={corners:[{x:0,y:0},{x:1,y:0},{x:.75,y:1},{x:.25,y:1}] as const};
  expect(()=>perspectiveMatrix(100,80,p)).not.toThrow();
  expect(()=>rasterErasureSchema.parse({...entry,width:100,height:80,placement:{perspective:p,bounds:{x:0,y:-100,width:100,height:180}}})).toThrow(/horizon/);
});
it('requires schema 51 in ordinary and mask-contained erasures and upgrades valid older roots',()=>{
  const{document,layer}=setup();layer.erase(stroke(),{space:'placed'});const dto=document.toJSON();expect(dto.schemaVersion).toBe(SCHEMA_VERSION);
  expect(Document.fromJSON(dto).toJSON()).toEqual(dto);const old=structuredClone(dto);old.schemaVersion=50;expect(()=>validateDocument(old)).toThrow(/version 51/);
  delete(old.children[0] as import('../src/core/model').RasterLayerData).erasures;expect(Document.fromJSON(old).toJSON().schemaVersion).toBe(SCHEMA_VERSION);
  const mask=layerMaskSchema.parse({kind:'raster-erasures',width:100.5,height:80.25,erasures:(layer.toJSON() as import('../src/core/model').RasterLayerData).erasures,enabled:true,inverted:false,density:1});
  old.children[0].mask=mask;expect(()=>validateDocument(old)).toThrow(/version 51/);
});
it('retains placement through mask constructors, getters, refinements and serialized command parsing',()=>{
  const{document,layer}=setup();layer.erase(stroke(),{space:'placed'});const entries=(layer.toJSON() as import('../src/core/model').RasterLayerData).erasures!;
  const mask=LayerMask._fromJSON({kind:'raster-erasures',width:layer.width,height:layer.height,erasures:entries,enabled:true,inverted:false,density:1});
  expect(mask.with({density:.5}).toJSON()).toMatchObject({erasures:entries,density:.5});expect(new LayerMask({rasterErasures:mask.rasterErasures!}).toJSON()).toMatchObject({erasures:entries});
  const commands=parseCommands([{type:'layer.update',id:layer.id,patch:{erasures:entries}}]);document._dispatch(commands[0]);expect((layer.toJSON() as import('../src/core/model').RasterLayerData).erasures).toEqual(entries);
});
