import {it,expect} from 'vitest';
import {Document,RasterLayer,LayerMask,BrushStroke,PencilStroke,PerspectiveTransform,AffineTransform,LayerGroup,SmartObjectLayer} from '../src/dom';
import {validateDocument,SCHEMA_VERSION} from '../src/core/model';
import {maskFieldGeometry} from '../src/core/mask-field';
const perspective=new PerspectiveTransform({corners:[{x:0,y:0},{x:1,y:.1},{x:.8,y:1},{x:.2,y:1}]});
const setup=()=>{const document=new Document(),layer=document.layers.add(new RasterLayer({assetId:'original',width:64,height:48,perspective}));layer.mask=new LayerMask({base:1,x:5,y:-3,basis:AffineTransform.rotation(.2)});return{document,layer};};
const stroke=()=>new BrushStroke({points:[{x:24,y:20}],size:10,pressureSize:false});

it('captures complete mask placement through one shared Undo and preserves it after mask and image edits',()=>{
 const{document,layer}=setup(),before=document.toJSON(),past=document.getSnapshot().past.length;layer.paintMask(stroke(),'hide',{space:'placed'});const saved=document.toJSON(),entry=layer.mask!.toJSON().strokes![0];expect(entry).toMatchObject({mode:'hide',placement:{width:64,height:48,perspective:perspective.toJSON()}});expect(document.getSnapshot().past.length).toBe(past+1);document.undo();expect(document.toJSON()).toEqual(before);document.redo();expect(document.toJSON()).toEqual(saved);layer.perspective=null;layer.mask=layer.mask!.with({x:100,y:200});expect(layer.mask!.toJSON().strokes![0]).toEqual(entry);expect(layer.assetId).toBe('original');
});
it('retains placed values through constructors, getters, refinements and JSON reconstruction',()=>{
 const{layer}=setup();layer.paintMask(stroke(),'reveal',{space:'placed'});const mask=layer.mask!,entry=mask.toJSON().strokes![0];expect(mask.with({density:.5}).toJSON().strokes![0]).toEqual(entry);expect(LayerMask._fromJSON(mask.toJSON()).toJSON()).toEqual(mask.toJSON());expect(new LayerMask({base:1,strokes:mask.strokes}).toJSON().strokes![0]).toEqual(entry);expect(mask.paint(new PencilStroke({points:[{x:1,y:1}]})).toJSON().strokes![0]).toEqual(entry);
});
it('keeps local, unlinked and identity image painting compatible',()=>{
 const{layer}=setup();layer.paintMask(stroke());layer.mask=layer.mask!.with({linked:false});layer.paintMask(stroke(),'hide',{space:'placed'});layer.perspective=null;layer.mask=layer.mask!.with({linked:true});layer.paintMask(stroke(),'hide',{space:'placed'});expect(layer.mask!.toJSON().strokes!.every(entry=>!('placement'in entry)||!entry.placement)).toBe(true);
});
it('rejects invalid options, missing masks, constructors and locked ancestry atomically',()=>{
 const{document,layer}=setup(),before=document.toJSON();for(const options of [null,[],{space:'world'},{extra:true},{filterMask:1}])expect(()=>layer.paintMask(stroke(),'hide',options as never)).toThrow();expect(()=>layer.paintMask(stroke().toJSON() as never)).toThrow(/BrushStroke/);expect(()=>layer.paintMask(stroke(),'hide',{filterMask:true})).toThrow(/smart object/);expect(document.toJSON()).toEqual(before);const group=document.layers.add(new LayerGroup());layer.moveTo(group);group.locked=true;expect(()=>layer.paintMask(stroke(),'hide',{space:'placed'})).toThrow(/Unlock/);
});
it('rejects null placement and using the ordinary paint method as a wet operation',()=>{
 const mask=new LayerMask({base:1});expect(()=>mask.paint(stroke(),'hide',{placement:null as never})).toThrow();expect(()=>new LayerMask({base:1,strokes:[{stroke:stroke(),mode:'hide',placement:null as never}]})).toThrow();expect(()=>mask.paint(stroke(),'wet' as never)).toThrow();
});
it('gates placed mask operations at schema 53 without relabeling valid older masks',()=>{
 const{document,layer}=setup();const legacy=document.toJSON();legacy.schemaVersion=52;expect(()=>validateDocument(legacy)).not.toThrow();layer.paintMask(stroke(),'hide',{space:'placed'});const current=document.toJSON();expect(current.schemaVersion).toBe(SCHEMA_VERSION);current.schemaVersion=52;expect(()=>validateDocument(current)).toThrow(/version 53/);expect(maskFieldGeometry(layer.mask!.toJSON(),new AffineTransform()).unbounded).not.toBe(true);
});
it('captures filter-mask master scaling in the same image plane as ordinary placed input',()=>{
 const{document,layer}=setup();const smart=layer.convertToSmartObject() as SmartObjectLayer;smart.width=128;smart.height=96;smart.filterMask=new LayerMask({base:1,x:3,y:4});smart.paintMask(stroke(),'hide',{space:'placed',filterMask:true});const entry=smart.filterMask!.toJSON().strokes![0];expect(entry).toMatchObject({placement:{width:128,height:96,basis:{a:2,b:0,c:0,d:2,e:6,f:8}}});expect(document.toJSON().schemaVersion).toBe(SCHEMA_VERSION);
});
