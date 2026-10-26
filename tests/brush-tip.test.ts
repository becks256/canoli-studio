import {SCHEMA_VERSION as CURRENT_DOCUMENT_SCHEMA} from '../src/core/model';
import {expect,it} from 'vitest';
import {BrushTip,BrushStroke,PencilStroke,Document,PaintLayer,PressureCurve} from '../src/dom';
import {brushTipPose,pointerPenTilt,interpolatePenTilt,transformPenTilt} from '../src/core/brush-tip';
import {paintStampGeometry,strokeStamps} from '../src/core/paint-stamps';
import {AffineTransform} from '../src/core/affine';
import {strokeBounds} from '../src/core/drawing';

it('owns complete authored tip geometry and rejects invalid values before attached edits',()=>{
 const curve=PressureCurve.firm(),tip=new BrushTip({roundness:.25,angle:45,tiltRoundness:true,tiltCurve:curve});const owned=tip.toJSON();owned.roundness=1;owned.tiltCurve!.points[1].output=0;expect(tip.roundness).toBe(.25);expect(tip.tiltCurve!.toJSON()).toEqual(curve.toJSON());expect(Object.isFrozen(tip)).toBe(true);
 const doc=new Document(),layer=doc.layers.add(new PaintLayer()),before=doc.toJSON();expect(()=>layer.strokes.add(new BrushStroke({points:[{x:1,y:1}],tip:{roundness:0,angle:0}}))).toThrow();expect(doc.toJSON()).toEqual(before);expect(()=>new BrushTip({angle:181})).toThrow();
});
it('retains tip and spherical tilt through OO commands, undo and schema migration while rejecting false age labels',()=>{
 const doc=new Document(),layer=doc.layers.add(new PaintLayer()),before=doc.toJSON();layer.strokes.add(new BrushStroke({points:[{x:10,y:10,pressure:.5,tilt:{altitude:Math.PI/4,azimuth:Math.PI/2}}],tip:new BrushTip({roundness:.5,tiltAngle:true})}));const saved=doc.toJSON();expect(saved.schemaVersion).toBe(CURRENT_DOCUMENT_SCHEMA);expect(Document.fromJSON(saved).toJSON()).toEqual(saved);expect(()=>Document.fromJSON({...saved,schemaVersion:29})).toThrow(/schema version 30/);doc.undo();expect(doc.toJSON()).toEqual(before);doc.redo();expect(doc.toJSON()).toEqual(saved);expect(Document.fromJSON({...before,schemaVersion:29}).toJSON().schemaVersion).toBe(CURRENT_DOCUMENT_SCHEMA);
 const raw=new BrushStroke({points:[{x:10,y:10,tilt:{altitude:0,azimuth:0}}]}).toJSON();layer.strokes.add(new BrushStroke(raw));expect(()=>Document.fromJSON({...doc.toJSON(),schemaVersion:29})).toThrow(/schema version 30/);
});
it('uses pen orientation conventions including upright, axis-aligned and ambiguous horizontal boundaries',()=>{
 expect(pointerPenTilt({tiltX:0,tiltY:0})).toEqual({altitude:Math.PI/2,azimuth:0});expect(pointerPenTilt({tiltX:45,tiltY:0})).toEqual({altitude:Math.PI/4,azimuth:0});expect(pointerPenTilt({tiltX:0,tiltY:-90})).toEqual({altitude:0,azimuth:3*Math.PI/2});expect(pointerPenTilt({tiltX:90,tiltY:90})).toEqual({altitude:0,azimuth:0});expect(pointerPenTilt({tiltX:90,tiltY:90,altitudeAngle:0,azimuthAngle:Math.PI/4})).toEqual({altitude:0,azimuth:Math.PI/4});
});
it('transforms projected tilt to stroke coordinates without distorting altitude and interpolates the short angular arc',()=>{
 const tilt={altitude:.4,azimuth:0},local=transformPenTilt(tilt,AffineTransform.rotation(Math.PI/2).inverse());expect(local.altitude).toBe(.4);expect(local.azimuth).toBeCloseTo(3*Math.PI/2,12);
 const interpolated=interpolatePenTilt({altitude:0,azimuth:350*Math.PI/180},{altitude:Math.PI/2,azimuth:10*Math.PI/180},.5)!;expect(interpolated.altitude).toBe(Math.PI/4);expect(Math.min(interpolated.azimuth,2*Math.PI-interpolated.azimuth)).toBeLessThan(1e-12);
});
it('derives analytic ellipse dimensions, tilt response, rotated pencil support and intermediate tilt replay',()=>{
 const tip=new BrushTip({roundness:1,tiltAngle:true,tiltRoundness:true}),pose=brushTipPose(tip.toJSON(),{altitude:Math.PI/4,azimuth:Math.PI/2});expect(pose.roundness).toBe(.5);expect(pose.cos).toBe(0);expect(pose.sin).toBe(1);
 const stroke=new BrushStroke({points:[{x:20,y:20,pressure:1,tilt:{altitude:Math.PI/4,azimuth:0}}],size:40,tip}).toJSON();expect(paintStampGeometry(stroke,stroke.points[0])).toMatchObject({rx:20,ry:10,cos:1,sin:0});
 const pencil=new PencilStroke({points:[{x:0,y:0}],size:40,tip:new BrushTip({angle:45})}).toJSON();expect(strokeBounds(pencil).width).toBeGreaterThan(58);
 const line=new BrushStroke({points:[{x:0,y:0,tilt:{altitude:0,azimuth:0}},{x:100,y:0,tilt:{altitude:Math.PI/2,azimuth:Math.PI/2}}],tip}).toJSON();expect([...strokeStamps(line,{x:-30,y:-30,width:200,height:100})].some(point=>point.tilt&&point.tilt.altitude>0&&point.tilt.altitude<Math.PI/2)).toBe(true);
});

for(const context of ['mask','filter-mask','raster-erasure','tonal','embedded-master'] as const)
it(`retains ${context} tip/orientation and rejects a falsely old schema`,async()=>{
 const {LayerMask,RasterLayer,EraserStroke}=await import('../src/dom'),doc=new Document(),tip=new BrushTip({roundness:.5,tiltAngle:true}),brush=new BrushStroke({points:[{x:10,y:10,tilt:{altitude:.4,azimuth:.8}}],tip}),mask=new LayerMask({base:1,strokes:[{stroke:brush,mode:'hide'}]});
 if(context==='mask')doc.layers.add(new PaintLayer()).mask=mask;
 if(context==='raster-erasure')doc.layers.add(new RasterLayer({assetId:'original',width:32,height:24})).erase(new EraserStroke({points:brush.points,tip}));
 if(context==='tonal')doc.applyTonalSculpt(brush.points,'dodge','midtones',.4,{tip});
 if(context==='filter-mask'||context==='embedded-master'){const master=new Document(),content=master.layers.add(new PaintLayer());if(context==='embedded-master')content.strokes.add(brush);const instance=doc.placeSmartObject(doc.defineComponent(master));if(context==='filter-mask')instance.filterMask=mask;}
 const saved=doc.toJSON();expect(Document.fromJSON(saved).toJSON()).toEqual(saved);const old=structuredClone(saved);old.schemaVersion=29;if(context==='embedded-master')for(const definition of old.components??[])if(definition.source.kind==='document')definition.source.document.schemaVersion=29;expect(()=>Document.fromJSON(old)).toThrow(/require schema version 30/);
});

it('retains redo-only tip records through workspace migration and rejects invalid restored histories',()=>{
 const doc=new Document(),layer=doc.layers.add(new PaintLayer());layer.strokes.add(new BrushStroke({points:[{x:10,y:10,tilt:{altitude:.4,azimuth:.8}}],tip:new BrushTip({roundness:.5})}));const saved=doc.toJSON();doc.undo();const state=doc.getSnapshot(),history={version:1,past:state.past,future:state.future};const restored=Document._fromWorkspace({...state.document,schemaVersion:29},history);expect(restored.toJSON().schemaVersion).toBe(CURRENT_DOCUMENT_SCHEMA);restored.redo();expect(restored.toJSON()).toEqual(saved);
 const invalid=structuredClone(history);invalid.future[0].document.schemaVersion=29;expect(()=>Document._fromWorkspace(state.document,invalid)).toThrow(/schema version 30/);
});

it('keeps mouse geometry static with a nonzero tilt-curve minimum and applies the minimum to an actual upright pen',()=>{
 const tip=new BrushTip({roundness:.5,tiltRoundness:true,tiltCurve:new PressureCurve({points:[{input:0,output:.4},{input:1,output:1}]})}).toJSON();expect(brushTipPose(tip).roundness).toBe(.5);expect(brushTipPose(tip,{altitude:Math.PI/2,azimuth:0}).roundness).toBe(.3);
});
