import {it,expect} from 'vitest';
import {Document,RasterLayer,LayerGroup,LayerMask,PaintLayer,WetPaintStroke,BrushStroke,PerspectiveTransform,AffineTransform} from '../src/dom';
import {SCHEMA_VERSION,validateDocument} from '../src/core/model';
import {maskFieldGeometry} from '../src/core/mask-field';
import {wetPaintBounds} from '../src/core/wet-operation';
const perspective=new PerspectiveTransform({corners:[{x:0,y:0},{x:1,y:0},{x:.5,y:1},{x:0,y:1}]}),placement={width:10,height:10,perspective,basis:new AffineTransform()};
const wet=(y=2)=>new WetPaintStroke({brush:new BrushStroke({points:[{x:2,y}],size:3}),tiles:[{x:2,y,width:2,height:2,assetId:'pixels',coverage:{assetId:'coverage'}}],placement});
it('owns placed wet values through constructors, native JSON, duplicated masks and independent getters',()=>{
 const op=wet(),value=op.toJSON();value.placement!.basis.e=99;value.placement!.perspective.corners[0].x=99;expect(op.placement!.basis.e).toBe(0);expect(op.placement!.perspective.corners[0].x).toBe(0);
 const doc=new Document(),layer=doc.layers.add(new RasterLayer({assetId:'original',width:10,height:10}));layer.applyWetPaint(op);layer.mask=new LayerMask({base:1}).applyWetPaint(op);const smart=layer.convertToSmartObject();smart.filterMask=new LayerMask({base:0}).applyWetPaint(op);const data=doc.toJSON();expect(data.schemaVersion).toBe(SCHEMA_VERSION);expect(Document.fromJSON(data).toJSON()).toEqual(data);expect(smart.filterMask.strokes[0].stroke.toJSON()).toEqual(op.toJSON());
 const before=doc.toJSON(),history=doc.getSnapshot().past.length;smart.mask=smart.mask!.applyWetPaint(op);const after=doc.toJSON();expect(doc.getSnapshot().past).toHaveLength(history+1);doc.undo();expect(doc.toJSON()).toEqual(before);doc.redo();expect(doc.toJSON()).toEqual(after);
});
it('gates projected wet metadata in ordinary/filter masks, raster/paint layers, embedded documents and history labels',()=>{
 for(const target of['raster','paint','mask','filter','embedded']as const){
  const doc=new Document(),layer=doc.layers.add(new RasterLayer({assetId:'original',width:10,height:10}));
  if(target==='raster')layer.applyWetPaint(wet());else if(target==='paint')doc.layers.add(new PaintLayer()).strokes.add(wet());else if(target==='mask')layer.mask=new LayerMask({base:1}).applyWetPaint(wet());else if(target==='filter')layer.convertToSmartObject().filterMask=new LayerMask({base:1}).applyWetPaint(wet());else{const group=doc.layers.add(new LayerGroup());layer.moveTo(group);layer.mask=new LayerMask({base:1}).applyWetPaint(wet());doc.createSmartObject([group]);}
  const data=doc.toJSON();expect(()=>validateDocument(data)).not.toThrow();if(target==='embedded'){for(const c of data.components??[])if(c.source.kind==='document')(c.source.document as any).schemaVersion=54;expect(()=>validateDocument(data)).toThrow(/schema version 55/);}else expect(()=>Document.fromJSON({...data,schemaVersion:54}as never)).toThrow(/schema version 55/);
 }
});
it('keeps horizon-crossing mask support streaming while finite artwork rejects it atomically',()=>{
 const operation=wet(19),mask=new LayerMask({base:1}).applyWetPaint(operation),geometry=maskFieldGeometry(mask.toJSON(),new AffineTransform());expect(geometry.unbounded).toBe(true);expect(()=>wetPaintBounds(operation.toJSON())).toThrow(/horizon/);
 const doc=new Document(),layer=doc.layers.add(new RasterLayer({assetId:'original',width:10,height:10})),before=doc.toJSON(),revision=doc.getSnapshot().revision;expect(()=>layer.applyWetPaint(operation)).toThrow(/horizon/);expect(doc.toJSON()).toEqual(before);expect(doc.getSnapshot().revision).toBe(revision);layer.mask=mask;expect(layer.mask.strokes[0].stroke.toJSON()).toEqual(operation.toJSON());
});
it('retains redo-only placed wet fields and rejects false schema ages in saved history',()=>{
 const doc=new Document(),layer=doc.layers.add(new PaintLayer());layer.strokes.add(wet());const after=doc.toJSON();doc.undo();const state=doc.getSnapshot(),history={version:1,past:state.past,future:state.future};
 const restored=Document._fromWorkspace(state.document,history);restored.redo();expect(restored.toJSON()).toEqual(after);
 const invalid=structuredClone(history);invalid.future[0].document.schemaVersion=54;expect(()=>Document._fromWorkspace(state.document,invalid)).toThrow(/schema version 55/);
});
it('rejects malformed placed mappings without fabricating defaults or mutating originals',()=>{
 const source=wet().toJSON();for(const patch of[{width:0},{height:Infinity},{basis:{a:0,b:0,c:0,d:0,e:0,f:0}},{perspective:{corners:[{x:0,y:0},{x:1,y:1},{x:1,y:0},{x:0,y:1}]}},{unexpected:true}])expect(()=>new WetPaintStroke({...source,placement:{...source.placement!,...patch}}as never)).toThrow();expect(()=>new WetPaintStroke({...source,placement:null}as never)).toThrow();expect(wet().placement!.width).toBe(10);
});
it('keeps off-image wet pixels, mask editing and source metadata inside a containing smart master',()=>{
 const doc=new Document({width:64,height:48}),parent=doc.layers.add(new LayerGroup()),layer=parent.layers.add(new RasterLayer({assetId:'original',width:10,height:10}));parent.transform=new AffineTransform(-1,.125,.25,1,50,4);layer.mask=new LayerMask({base:1,linked:false,x:2,y:3,density:.75});
 const source=wet().toJSON();source.tiles[0].x=16;layer.applyWetPaint(new WetPaintStroke(source));const before=doc.toJSON(),saved=layer.toJSON(),smart=layer.convertToSmartObject(),after=doc.toJSON(),contents=smart.editContents(),child=contents.layers.at(0)as RasterLayer;
 expect(child).toBeInstanceOf(RasterLayer);expect(child.assetId).toBe('original');const childData=child.toJSON();if(childData.kind!=='raster'||saved.kind!=='raster')throw Error('Missing native raster metadata');expect(childData.erasures).toEqual(saved.erasures);expect(child.mask?.linked).toBe(false);expect(child.mask?.density).toBe(.75);
 // Expanded masters keep the original layer's mask/appearance in editable
 // contents, like the existing containing-master selection conversion.
 expect(smart.mask).toBeNull();const edited=child.mask!.with({density:.5});child.mask=edited;smart.replaceContents(contents);expect((smart.editContents().layers.at(0)as RasterLayer).mask?.density).toBe(.5);doc.undo();expect(doc.toJSON()).toEqual(after);doc.undo();expect(doc.toJSON()).toEqual(before);doc.redo();expect(doc.toJSON()).toEqual(after);
});
