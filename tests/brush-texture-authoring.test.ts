import {expect,it} from 'vitest';
import {BrushTexture,BrushStroke,PencilStroke,EraserStroke,CloneStroke,Document,PaintLayer,RasterLayer,LayerMask,LayerGroup} from '../src/dom';
import {referencedAssets,allLayers} from '../src/core/model';
import {remapLayerAssets} from '../src/core/asset-references';
import {parseCommands} from '../src/core/validation';

it('owns texture defaults, source options, DTOs and copied values without exposing mutable state',()=>{
 const input={assetId:'grain'},texture=new BrushTexture(input);input.assetId='changed';
 expect(texture.toJSON()).toEqual({assetId:'grain',channel:'luminance',invert:false});
 const dto=texture.toJSON();dto.assetId='other';expect(texture.assetId).toBe('grain');expect(Object.isFrozen(texture)).toBe(true);
 const inverse=texture.with({channel:'alpha',invert:true});expect(inverse.toJSON()).toEqual({assetId:'grain',channel:'alpha',invert:true});expect(texture.channel).toBe('luminance');
 for(const value of [{assetId:''},{assetId:'x'.repeat(241)},{assetId:'x',invert:1},{assetId:'x',channel:'rgb'},{assetId:'x',unknown:true}])expect(()=>new BrushTexture(value as never)).toThrow();
 for(const Constructor of [BrushStroke,PencilStroke,EraserStroke,CloneStroke]){
  const tiles=Constructor===CloneStroke?[{assetId:'captured',x:0,y:0,width:32,height:32}]:[],data=texture.toJSON(),stroke=new Constructor({points:[{x:10,y:10}],tiles,texture:data});data.assetId='lost';expect(stroke.texture!.assetId).toBe('grain');
  expect(new Constructor({points:[{x:10,y:10}],tiles,texture:null}).toJSON()).not.toHaveProperty('texture');
  for(const invalid of [false,{}, {assetId:'grain'}, {...texture.toJSON(),unknown:true}])expect(()=>new Constructor({points:[{x:10,y:10}],tiles,texture:invalid as never})).toThrow();
 }
});

const contexts=['paint','mask','filter-mask','raster-erasure','tonal','embedded-master','embedded-filter-mask'] as const;
for(const context of contexts)it(`retains ${context} texture references and enforces schema age even after validation caching`,()=>{
 const doc=new Document(),texture=new BrushTexture({assetId:'grain'}),brush=new BrushStroke({points:[{x:10,y:10}],texture}),mask=new LayerMask({base:1,strokes:[{mode:'hide',stroke:brush}]});
 if(context==='paint')doc.layers.add(new PaintLayer()).strokes.add(brush);
 if(context==='mask')doc.layers.add(new PaintLayer()).mask=mask;
 if(context==='raster-erasure')doc.layers.add(new RasterLayer({assetId:'original',width:32,height:32})).erase(new EraserStroke({points:brush.points,texture}));
 if(context==='tonal')doc.applyTonalSculpt(brush.points,'dodge','midtones',.5,{texture});
 if(context==='filter-mask'||context==='embedded-master'||context==='embedded-filter-mask'){
  const master=new Document(),content=master.layers.add(new PaintLayer());
  if(context==='embedded-master')content.strokes.add(brush);
  if(context==='embedded-filter-mask'){
   const nested=new Document();nested.layers.add(new PaintLayer());const nestedId=master.defineComponent(nested);doc.defineComponent(nested,{id:nestedId});const inner=master.placeSmartObject(nestedId);inner.filterMask=mask;
  }
  const instance=doc.placeSmartObject(doc.defineComponent(master));if(context==='filter-mask')instance.filterMask=mask;
 }
 const saved=doc.toJSON();expect(saved.schemaVersion).toBe(40);expect(Document.fromJSON(saved).toJSON()).toEqual(saved);expect(referencedAssets(saved).has('grain')).toBe(true);
 const old=structuredClone(saved);old.schemaVersion=31;
 const lower=(definitions:typeof old.components)=>{for(const definition of definitions??[])if(definition.source.kind==='document')definition.source.document.schemaVersion=31;};lower(old.components);
 expect(()=>Document.fromJSON(old)).toThrow(/textures require schema version 32/);
});

it('keeps texture transactions atomic, honors locks and retains redo-only texture metadata',()=>{
 const doc=new Document(),group=doc.layers.add(new LayerGroup()),layer=group.layers.add(new PaintLayer()),stroke=new BrushStroke({points:[{x:5,y:5}],texture:new BrushTexture({assetId:'grain'})});
 const before=doc.toJSON();expect(()=>doc.transaction('Rejected ink',()=>{layer.strokes.add(stroke);layer.update({opacity:2});})).toThrow();expect(doc.toJSON()).toEqual(before);
 group.locked=true;expect(()=>layer.strokes.add(stroke)).toThrow();group.locked=false;
 doc.transaction('Textured ink',()=>{layer.strokes.add(stroke);layer.name='Ink';});const after=doc.toJSON();doc.undo();expect(layer.strokes.length).toBe(0);
 const state=doc.getSnapshot(),history={version:1,past:state.past,future:state.future},restored=Document._fromWorkspace({...state.document,schemaVersion:31},history);restored.redo();expect(restored.toJSON()).toEqual(after);
 const bad=structuredClone(history);bad.future[0].document.schemaVersion=31;expect(()=>Document._fromWorkspace(state.document,bad)).toThrow(/schema version 32/);
 const legacy=Document.fromJSON({...before,schemaVersion:31}).toJSON();expect(legacy.schemaVersion).toBe(40);expect(JSON.stringify(legacy)).not.toContain('texture');
});

it('remaps texture and original references throughout ordinary brush-bearing layer records',()=>{
 const doc=new Document(),texture=new BrushTexture({assetId:'grain'}),brush=new BrushStroke({points:[{x:10,y:10}],texture});
 const group=doc.layers.add(new LayerGroup()),paint=group.layers.add(new PaintLayer());paint.strokes.add(brush);paint.mask=new LayerMask({base:1,strokes:[{mode:'hide',stroke:brush}]});
 group.layers.add(new RasterLayer({assetId:'original',width:32,height:32})).erase(new EraserStroke({points:brush.points,texture}));doc.applyTonalSculpt(brush.points,'burn','midtones',.5,{texture});
 const raw=doc.toJSON(),map=new Map([['grain','new-grain'],['original','new-original']]);for(const layer of allLayers(raw.children))remapLayerAssets(layer,map);
 expect(referencedAssets(raw)).toEqual(new Set(['new-grain','new-original']));expect(()=>remapLayerAssets(raw.children[1],new Map())).toThrow(/mapping is incomplete/);
 const stroke=brush.toJSON();for(const invalid of [null,{assetId:'grain'},{...texture.toJSON(),extra:true}])expect(()=>parseCommands([{type:'paint.add',id:paint.id,stroke:{...stroke,texture:invalid}}])).toThrow();
});
