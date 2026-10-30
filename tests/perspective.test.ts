import {expect,it} from 'vitest';
import {Document,RasterLayer,SmartObjectLayer,TextLayer,LayerGroup,PerspectiveTransform,AffineTransform,LayerComp,LayerMask} from '../src/dom';
import {validateDocument,SCHEMA_VERSION} from '../src/core/model';
import {parseCommands} from '../src/core/validation';
import {layerBounds,layerTransform,hitTest} from '../src/core/spatial';
import {perspectiveMatrix} from '../src/core/perspective';
import type {ProjectiveQuad} from '../src/core/projective';
const quad:ProjectiveQuad=[{x:.1,y:.1},{x:.9,y:.2},{x:1.2,y:1},{x:-.2,y:.9}];
const image=()=>new RasterLayer({assetId:'original',width:100,height:80});

it('owns immutable normalized corners and converts fractional image dimensions without aliasing',()=>{
 const mutable=quad.map(p=>({...p})) as unknown as ProjectiveQuad,value=new PerspectiveTransform({corners:mutable});mutable[0].x=999;
 expect(value.corners).toEqual(quad);const copy=value.corners;copy[1].x=888;expect(value.corners).toEqual(quad);
 expect(Object.isFrozen(value)).toBe(true);expect(new PerspectiveTransform().toPixels(100,80)).toEqual([{x:0,y:0},{x:100,y:0},{x:100,y:80},{x:0,y:80}]);
 PerspectiveTransform.fromPixels(100.5,80.25,value.toPixels(100.5,80.25)).corners.forEach((p,i)=>{expect(p.x).toBeCloseTo(quad[i].x,14);expect(p.y).toBeCloseTo(quad[i].y,14);});
 expect(value.withCorner(0,{x:.2,y:.2}).corners[0]).toEqual({x:.2,y:.2});expect(value.corners).toEqual(quad);
 expect(()=>value.withCorner(4,{x:0,y:0})).toThrow(/corner/);expect(()=>value.toPixels(Infinity,1)).toThrow(/finite/);
});
it('validates constructors, folds, degeneracy and finite coordinates before publishing state',()=>{
 for(const corners of [[{x:0,y:0},{x:1,y:1},{x:1,y:0},{x:0,y:1}],[{x:0,y:0},{x:1,y:0},{x:2,y:0},{x:0,y:1}],quad.map((p,i)=>i===0?{x:NaN,y:0}:p)])expect(()=>new PerspectiveTransform({corners:corners as unknown as ProjectiveQuad})).toThrow();
 expect(()=>new RasterLayer({assetId:'original',width:100,height:80,perspective:{corners:quad} as never})).toThrow(/constructor/);
 const reflected=new PerspectiveTransform({corners:[{x:1,y:0},{x:0,y:0},{x:0,y:1},{x:1,y:1}]});expect(reflected.toPixels(100,80)[0].x).toBe(100);
});
it('shares one undoable command path, protects locked ancestors and preserves original asset identity',()=>{
 const doc=new Document(),group=doc.layers.add(new LayerGroup()),layer=group.layers.add(image()),before=doc.toJSON(),count=doc.getSnapshot().past.length;
 layer.perspective=new PerspectiveTransform({corners:quad});expect(layer.assetId).toBe('original');expect(doc.getSnapshot().past.length).toBe(count+1);
 const saved=doc.toJSON();doc.undo();expect(doc.toJSON()).toEqual(before);doc.redo();expect(doc.toJSON()).toEqual(saved);
 group.locked=true;expect(()=>layer.perspective=null).toThrow(/Unlock/);group.locked=false;
 doc._dispatch(parseCommands([{type:'layer.update',id:layer.id,patch:{perspective:null}}])[0]);expect(layer.perspective).toBeNull();doc.undo();expect(layer.perspective?.corners).toEqual(quad);
 const snapshot=doc.toJSON();expect(()=>doc.transaction('Atomic failure',()=>{layer.x=45;(doc.layers.add(new TextLayer())).perspective=new PerspectiveTransform();})).toThrow(/image|raster/i);expect(doc.toJSON()).toEqual(snapshot);
});
it('round trips schema 50 and rejects perspective in older documents, including saved layouts',()=>{
 const doc=new Document(),layer=doc.layers.add(image());layer.perspective=new PerspectiveTransform({corners:quad});doc.layerComps.add(new LayerComp({name:'Perspective'}));
 const saved=doc.toJSON();expect(saved.schemaVersion).toBe(SCHEMA_VERSION);expect(Document.fromJSON(saved).getLayer(layer.id)?.perspective?.corners).toEqual(quad);
 const old=structuredClone(saved);old.schemaVersion=49;expect(()=>validateDocument(old)).toThrow(/schema version 50/);delete old.children[0].perspective;expect(()=>validateDocument(old)).toThrow(/comp perspective/i);
 delete old.layerComps;expect(()=>validateDocument(old)).not.toThrow();expect(Document.fromJSON(old).toJSON().schemaVersion).toBe(SCHEMA_VERSION);
 const wrong=structuredClone(saved);wrong.children=[new TextLayer().toJSON()];wrong.children[0].perspective={corners:quad};expect(()=>validateDocument(wrong)).toThrow(/image layer/);
});
it('saved layouts restore and clear perspective without creating redundant history',()=>{
 const doc=new Document(),layer=doc.layers.add(image()),plain=doc.layerComps.add(new LayerComp({name:'Plain'}));layer.perspective=new PerspectiveTransform({corners:quad});
 const warped=doc.layerComps.add(new LayerComp({name:'Warped'}));plain.apply();expect(layer.perspective).toBeNull();warped.apply();expect(layer.perspective?.corners).toEqual(quad);
 const count=doc.getSnapshot().past.length;warped.apply();expect(doc.getSnapshot().past.length).toBe(count);
 const legacy=doc.toJSON();delete legacy.layerComps![0].layers[0].position!.perspective;const restored=Document.fromJSON(legacy);restored.layerComps.at(0)!.apply();expect(restored.getLayer(layer.id)?.perspective).toBeNull();
});
it('bounds and hit testing use the actual quadrilateral under affine parent placement',()=>{
 const doc=new Document(),group=doc.layers.add(new LayerGroup({x:100,y:60})),layer=group.layers.add(image());group.transform=AffineTransform.rotation(.35);layer.perspective=new PerspectiveTransform({corners:quad});
 const dto=doc.toJSON(),world=layerTransform(dto,layer.id)!,corners=layer.perspective.toPixels(100,80).map(p=>world.point(p)),xs=corners.map(p=>p.x),ys=corners.map(p=>p.y);
 const actual=layerBounds(dto,layer.id)!,expected={x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)};for(const key of ['x','y','width','height'] as const)expect(actual[key]).toBeCloseTo(expected[key],11);
 const center=world.point(perspectiveMatrix(100,80,layer.perspective.toJSON()).point({x:50,y:40}));expect(hitTest(dto,center.x,center.y)).toBe(layer.id);
 const outside=world.point({x:0,y:0});expect(hitTest(dto,outside.x,outside.y)).toBeNull();
});
it('smart conversion and duplication retain instance perspective while contents keep original coordinates',()=>{
 const doc=new Document(),layer=doc.layers.add(image());layer.perspective=new PerspectiveTransform({corners:quad});
 const smart=layer.convertToSmartObject();expect(smart).toBeInstanceOf(SmartObjectLayer);expect(smart.perspective?.corners).toEqual(quad);
 const duplicate=smart.duplicate() as SmartObjectLayer;expect(duplicate.perspective?.corners).toEqual(quad);duplicate.perspective=null;expect(smart.perspective?.corners).toEqual(quad);
});
it('pending world-mask capture and relinking reject atomically rather than storing affine approximations',()=>{
 const doc=new Document(),layer=doc.layers.add(image());layer.mask=new LayerMask({base:.5});layer.perspective=new PerspectiveTransform({corners:quad});
 const before=doc.toJSON(),count=doc.getSnapshot().past.length;expect(()=>layer.setMaskLinked(false)).toThrow(/Reset perspective/);expect(doc.toJSON()).toEqual(before);expect(doc.getSnapshot().past.length).toBe(count);
});
it('SVG and Photoshop plans bake perspective and its mask without changing source authoring',async()=>{
 const{planSvgComposition}=await import('../src/core/svg-composition'),{planPsdExport}=await import('../src/core/interchange/psd/export-plan');
 const doc=new Document(),layer=doc.layers.add(image());layer.perspective=new PerspectiveTransform({corners:quad});layer.mask=new LayerMask({base:.5});const before=doc.toJSON(),svg=planSvgComposition(before),psd=planPsdExport(before);
 expect(svg.prefixes).toBe(1);expect(svg.nativeAssets.has('original')).toBe(true);expect(psd.layers).toHaveLength(1);expect(psd.layers[0].mask).toBeUndefined();expect(psd.layers[0].document.children[0].mask).toEqual(layer.mask.toJSON());expect(psd.layers[0].document.children[0].perspective).toEqual(layer.perspective.toJSON());expect(doc.toJSON()).toEqual(before);
});
it('complete wet-content support must remain finite, including retained off-frame paint',async()=>{
 const{WetPaintStroke,PencilStroke}=await import('../src/dom');const doc=new Document(),layer=doc.layers.add(image());
 layer.applyWetPaint(new WetPaintStroke({brush:new PencilStroke({points:[{x:5,y:-180}],size:1,pressureSize:false}),tiles:[{x:4,y:-181,width:3,height:3,assetId:'prepared',coverage:{assetId:'support'}}]}));
 const before=doc.toJSON(),count=doc.getSnapshot().past.length;expect(()=>layer.perspective=new PerspectiveTransform({corners:[{x:0,y:0},{x:1,y:0},{x:.5,y:1},{x:0,y:1}]})).toThrow(/horizon/);expect(doc.toJSON()).toEqual(before);expect(doc.getSnapshot().past.length).toBe(count);
});
it('compact preflight metadata preserves perspective and agrees with authored rotated bounds',async()=>{
 const{preflightDocumentView}=await import('../src/core/preflight-view'),{inspectPreflightAlignments}=await import('../src/core/preflight-alignment');
 const doc=new Document(),layer=doc.layers.add(image());layer.perspective=new PerspectiveTransform({corners:quad});layer.transform=AffineTransform.rotation(.35);const view=preflightDocumentView(doc.toJSON()),findings:any[]=[];
 expect((view.children[0] as {perspective:unknown}).perspective).toEqual(layer.perspective.toJSON());
 await inspectPreflightAlignments(view,[{layerIds:[layer.id],alignment:'left',target:{type:'canvas'},tolerance:0}],false,f=>findings.push(f));expect(findings).toHaveLength(1);expect(findings[0].alignment.actual).toBeCloseTo(layerBounds(doc.toJSON(),layer.id)!.x,12);
});
