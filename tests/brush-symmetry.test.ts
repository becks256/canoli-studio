import {it,expect} from 'vitest';
import {BrushSymmetry,BrushStroke,BrushTip,PencilStroke,Document,PaintLayer,AffineTransform} from '../src/dom';
import {strokeStamps,paintStampGeometry} from '../src/core/paint-stamps';
import {strokeBounds} from '../src/core/drawing';
import {strokeIntersectsRegion,strokeCaptureRegion} from '../src/engine/stroke-region';

it('owns affine copies, rejects singular/identity/duplicate transforms and creates exact cardinal factories',()=>{
 const symmetry=BrushSymmetry.bothAxes({x:32,y:24}),raw=symmetry.toJSON();raw.copies[0].e=0;expect(symmetry.toJSON().copies[0].e).toBe(64);expect(Object.isFrozen(symmetry)).toBe(true);expect(BrushSymmetry.radial({x:32,y:24},4).toJSON().copies).toContainEqual({a:-1,b:0,c:0,d:-1,e:64,f:48});
 for(const count of [1,33,2.5,NaN])expect(()=>BrushSymmetry.radial({x:0,y:0},count)).toThrow();
 for(const copies of [[],[new AffineTransform()],[new AffineTransform(1,0,0,0)],[AffineTransform.scale(-1,1),AffineTransform.scale(-1,1)]])expect(()=>new BrushSymmetry({copies})).toThrow();
});
it('captures symmetry through commands, undo, strict schema age and owned stroke values',()=>{
 const doc=new Document(),layer=doc.layers.add(new PaintLayer()),before=doc.toJSON(),stroke=new BrushStroke({points:[{x:10,y:10}],symmetry:BrushSymmetry.mirrorVertical(32)});layer.strokes.add(stroke);const after=doc.toJSON();expect(after.schemaVersion).toBe(40);expect(Document.fromJSON(after).toJSON()).toEqual(after);expect(()=>Document.fromJSON({...after,schemaVersion:30})).toThrow(/symmetry requires schema version 31/);doc.undo();expect(doc.toJSON()).toEqual(before);doc.redo();expect(doc.toJSON()).toEqual(after);expect(stroke.symmetry!.toJSON()).toEqual(BrushSymmetry.mirrorVertical(32).toJSON());
});
it('conjugates complete symmetry geometry through a nonuniform sheared layer plane',()=>{
 const mapping=new AffineTransform(2,.5,.8,1.5,30,-7),source=BrushSymmetry.mirrorVertical(32),local=source.transformed(mapping.inverse()),point={x:10,y:12},actual=mapping.point(local.copies[0].point(mapping.inverse().point(point))),expected=source.copies[0].point(point);expect(actual.x).toBeCloseTo(expected.x,10);expect(actual.y).toBeCloseTo(expected.y,10);
});
it('transforms the complete tilted tip and pencil footprint, rather than just reflected center points',()=>{
 const raw=new PencilStroke({points:[{x:10,y:20}],size:20,tip:new BrushTip({roundness:.25,angle:30}),symmetry:BrushSymmetry.mirrorVertical(32)}).toJSON();const [first,copy]=[...strokeStamps(raw,{x:0,y:0,width:64,height:64})].map(point=>paintStampGeometry(raw,point));expect(copy.cx).toBe(64-first.cx);expect(copy.cy).toBe(first.cy);expect(copy.a).toBe(-first.a);expect(copy.b).toBe(first.b);expect(copy.c).toBe(-first.c);expect(copy.d).toBe(first.d);expect(strokeBounds(raw).x+strokeBounds(raw).width).toBeGreaterThan(60);
});
it('finds offscreen originals whose reflected copies enter a viewport and clips long sparse copy ranges without scanning the gap',()=>{
 const raw=new BrushStroke({points:[{x:-1e12,y:10},{x:1e12,y:10}],size:4,spacing:.5,pressureSize:false,symmetry:BrushSymmetry.mirrorVertical(1e12)}).toJSON();const visible={x:1e12-10,y:0,width:20,height:20},points=[...strokeStamps(raw,visible)];expect(points.length).toBeGreaterThan(0);expect(points.length).toBeLessThan(50);expect(points.some(point=>point.copy)).toBe(true);expect(strokeIntersectsRegion(raw,visible)).toBe(true);expect(strokeCaptureRegion(raw,visible)).not.toBeNull();
});
it('preserves incremental stamp order across appended samples and keeps selection geometry unreflected',()=>{
 const original=new BrushStroke({points:[{x:10,y:10,pressure:.5},{x:20,y:20,pressure:.75},{x:30,y:10,pressure:1}],symmetry:BrushSymmetry.radial({x:32,y:32},4)}).toJSON();const view={x:0,y:0,width:64,height:64},toPlain=(p:ReturnType<typeof strokeStamps> extends Generator<infer P>?P:never)=>({...p,copy:p.copy?.toJSON()}),full=[...strokeStamps(original,view)].map(toPlain),prefix=[...strokeStamps({...original,points:original.points.slice(0,2)},view)].map(toPlain),rest=[...strokeStamps(original,view,2)].map(toPlain);expect([...prefix,...rest]).toEqual(full);
});

for(const context of ['mask','filter-mask','raster-erasure','tonal','embedded-master'] as const)it(`retains ${context} symmetry and enforces field age outside brush validation caches`,async()=>{
 const {LayerMask,RasterLayer,EraserStroke}=await import('../src/dom'),doc=new Document(),symmetry=BrushSymmetry.mirrorVertical(32),brush=new BrushStroke({points:[{x:10,y:20}],symmetry}),mask=new LayerMask({base:1,strokes:[{stroke:brush,mode:'hide'}]});if(context==='mask')doc.layers.add(new PaintLayer()).mask=mask;if(context==='raster-erasure')doc.layers.add(new RasterLayer({assetId:'original',width:64,height:64})).erase(new EraserStroke({points:brush.points,symmetry}));if(context==='tonal')doc.applyTonalSculpt(brush.points,'dodge','midtones',.5,{symmetry});if(context==='filter-mask'||context==='embedded-master'){const master=new Document({width:64,height:64}),content=master.layers.add(new PaintLayer());if(context==='embedded-master')content.strokes.add(brush);const instance=doc.placeSmartObject(doc.defineComponent(master));if(context==='filter-mask')instance.filterMask=mask;}
 const saved=doc.toJSON();expect(Document.fromJSON(saved).toJSON()).toEqual(saved);const old=structuredClone(saved);old.schemaVersion=30;if(context==='embedded-master')for(const definition of old.components??[])if(definition.source.kind==='document')definition.source.document.schemaVersion=30;expect(()=>Document.fromJSON(old)).toThrow(/symmetry requires schema version 31/);
});
it('retains redo-only symmetry records through validated workspace restoration',()=>{
 const doc=new Document(),layer=doc.layers.add(new PaintLayer());layer.strokes.add(new BrushStroke({points:[{x:10,y:10}],symmetry:BrushSymmetry.bothAxes({x:32,y:32})}));const saved=doc.toJSON();doc.undo();const state=doc.getSnapshot(),history={version:1,past:state.past,future:state.future},restored=Document._fromWorkspace({...state.document,schemaVersion:30},history);restored.redo();expect(restored.toJSON()).toEqual(saved);const broken=structuredClone(history);broken.future[0].document.schemaVersion=30;expect(()=>Document._fromWorkspace(state.document,broken)).toThrow(/schema version 31/);
});
