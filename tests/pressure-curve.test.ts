import {describe,it,expect} from 'vitest';
import {PRESSURE_CURVE_PRESETS,pressureCurveSchema,pressureResponse} from '../src/core/pressure-curve';

describe('authored brush pressure response',()=>{
 it('preserves exact legacy pressure and evaluates custom knots between raw samples',()=>{
  for(const pressure of [0,.001,.123456789,.25,.5,.999,1])expect(pressureResponse(pressure)).toBe(pressure);
  const curve=pressureCurveSchema.parse({points:[{input:0,output:.1},{input:.2,output:.1},{input:.8,output:.9},{input:1,output:.95}]});
  expect(pressureResponse(0,curve)).toBe(.1);expect(pressureResponse(.2,curve)).toBe(.1);expect(pressureResponse(.5,curve)).toBeCloseTo(.5,14);expect(pressureResponse(1,curve)).toBe(.95);
  expect(pressureResponse(-1,curve)).toBe(.1);expect(pressureResponse(2,curve)).toBe(.95);
 });
 it('rejects ambiguous, unordered, nonfinite and over-budget authored curves',()=>{
  for(const points of [[],[{input:0,output:0}],[{input:.1,output:0},{input:1,output:1}],[{input:0,output:1},{input:1,output:0}],[{input:0,output:0},{input:0,output:.5},{input:1,output:1}],[{input:0,output:0},{input:1,output:NaN}],Array.from({length:17},(_,i)=>({input:i/16,output:i/16}))])expect(()=>pressureCurveSchema.parse({points})).toThrow();
  expect(()=>pressureCurveSchema.parse({points:[{input:0,output:0,extra:true},{input:1,output:1}]})).toThrow();
 });
 it('supports flat intervals and deterministic normalized presets with distinct response',()=>{
  for(const curve of Object.values(PRESSURE_CURVE_PRESETS))expect(pressureCurveSchema.safeParse(curve).success).toBe(true);
  expect(pressureResponse(.5,PRESSURE_CURVE_PRESETS.soft)).toBe(.75);expect(pressureResponse(.5,PRESSURE_CURVE_PRESETS.firm)).toBe(.25);
  for(let i=0;i<=1000;i++){const p=i/1000;expect(pressureResponse(p,PRESSURE_CURVE_PRESETS.linear)).toBe(p);}
 });
});

import {Document,PaintLayer,BrushStroke,PressureCurve,LayerMask,RasterLayer,EraserStroke,LayerGroup} from '../src/dom';
import {paintStampSize,paintStampAlpha,strokeStamps} from '../src/core/paint-stamps';
import {strokeBounds} from '../src/core/drawing';

it('retains authored curves and recorded samples through shared commands, undo and native document reload',()=>{
 const curve=PressureCurve.soft(),stroke=new BrushStroke({points:[{x:5,y:10,pressure:.25},{x:25,y:10,pressure:.5}],size:20,flow:.5,pressureOpacity:true,pressureCurve:curve});
 const doc=new Document(),layer=doc.layers.add(new PaintLayer());layer.strokes.add(stroke);const snapshot=doc.toJSON();
 expect(snapshot.schemaVersion).toBe(41);expect(stroke.points.map(p=>p.pressure)).toEqual([.25,.5]);expect(stroke.pressureCurve!.points).toEqual(curve.points);
 const restored=Document.fromJSON(snapshot);expect(restored.toJSON()).toEqual(snapshot);doc.undo();expect((doc.layers.at(0) as PaintLayer).strokes.length).toBe(0);doc.redo();expect(doc.toJSON()).toEqual(snapshot);
 expect(()=>Document.fromJSON({...snapshot,schemaVersion:28})).toThrow(/pressure curves require schema version 29/);
 const legacy=new Document();legacy.layers.add(new PaintLayer());expect(Document.fromJSON({...legacy.toJSON(),schemaVersion:28}).toJSON().schemaVersion).toBe(41);
 const data=stroke.toJSON();expect(paintStampSize(data,data.points[0])).toBe(10);expect(paintStampAlpha(data,data.points[0])).toBe(.25);expect(strokeBounds(data).height).toBe(17);
 expect([...strokeStamps(data,{x:0,y:0,width:100,height:100})].some(p=>p.pressure>.25&&p.pressure<.5)).toBe(true);
});

it('owns curve inputs and rejects malformed curves without constructor or command mutation',()=>{
 const source={points:[{input:0,output:0},{input:.5,output:.75},{input:1,output:1}]},curve=new PressureCurve(source);source.points[1].output=0;const copy=curve.points;copy[1].output=0;expect(curve.points[1].output).toBe(.75);
 expect(pressureCurveSchema.safeParse({points:[]}).success).toBe(false);
 const doc=new Document(),layer=doc.layers.add(new PaintLayer()),before=doc.toJSON();expect(()=>layer.strokes.add(new BrushStroke({points:[{x:1,y:2}],pressureCurve:{points:[{input:1,output:0},{input:0,output:1}]}}))).toThrow();expect(doc.toJSON()).toEqual(before);
});

it('allows explicit zero response without changing legacy minima or inactive pressure controls',()=>{
 const make=(options:Partial<import('../src/dom').BrushOptions>)=>new BrushStroke({points:[{x:0,y:0,pressure:0},{x:64,y:0,pressure:0}],size:40,pressureOpacity:true,...options}).toJSON() as import('../src/core/drawing').BrushStrokeData;
 const legacy=make({}),linear=make({pressureCurve:PressureCurve.linear()}),off=make({pressureCurve:new PressureCurve({points:[{input:0,output:0},{input:1,output:0}]})});
 expect(paintStampSize(legacy,legacy.points[0])).toBe(2);expect(paintStampAlpha(legacy,legacy.points[0])).toBe(.01);expect([...strokeStamps(legacy,{x:-50,y:-50,width:200,height:100})].length).toBeGreaterThan(0);
 for(const stroke of [linear,off]){expect(paintStampSize(stroke,stroke.points[0])).toBe(0);expect(paintStampAlpha(stroke,stroke.points[0])).toBe(0);expect([...strokeStamps(stroke,{x:-50,y:-50,width:200,height:100})]).toEqual([]);}
 const inactive=make({pressureSize:false,pressureOpacity:false,pressureCurve:PressureCurve.linear()});expect(paintStampSize(inactive,inactive.points[0])).toBe(40);expect(paintStampAlpha(inactive,inactive.points[0])).toBe(1);
 const distant=make({points:[{x:-Number.MAX_SAFE_INTEGER,y:0,pressure:0},{x:Number.MAX_SAFE_INTEGER,y:0,pressure:1}],pressureCurve:new PressureCurve({points:[{input:0,output:0},{input:1,output:0}]})});expect([...strokeStamps(distant,{x:0,y:0,width:100,height:100})]).toEqual([]);
});

for(const context of ['mask','filter-mask','raster-erasure','tonal','embedded-master'] as const)
it(`retains ${context} curves while rejecting a falsely labeled legacy brush`,()=>{
 const doc=new Document(),brush=new BrushStroke({points:[{x:10,y:10,pressure:.25}],pressureCurve:PressureCurve.soft()}),mask=new LayerMask({base:1,strokes:[{stroke:brush,mode:'hide'}]});
 if(context==='mask')doc.layers.add(new PaintLayer()).mask=mask;
 if(context==='raster-erasure')doc.layers.add(new RasterLayer({assetId:'original',width:32,height:24})).erase(new EraserStroke({points:brush.points,pressureCurve:brush.pressureCurve}));
 if(context==='tonal')doc.applyTonalSculpt(brush.points,'dodge','midtones',.4,{pressureCurve:brush.pressureCurve});
 if(context==='filter-mask'||context==='embedded-master'){
  const master=new Document();const content=master.layers.add(new PaintLayer());if(context==='embedded-master')content.strokes.add(brush);
  const instance=doc.placeSmartObject(doc.defineComponent(master));if(context==='filter-mask')instance.filterMask=mask;
 }
 const saved=doc.toJSON();expect(Document.fromJSON(saved).toJSON()).toEqual(saved);const old=structuredClone(saved);old.schemaVersion=28;
 if(context==='embedded-master')for(const definition of old.components??[])if(definition.source.kind==='document')definition.source.document.schemaVersion=28;
 expect(()=>Document.fromJSON(old)).toThrow(/pressure curves require schema version 29/);
});

it('retains redo-only curve records and migrates valid legacy workspace states before further edits',()=>{
 const doc=new Document(),layer=doc.layers.add(new PaintLayer());layer.strokes.add(new BrushStroke({points:[{x:10,y:10,pressure:.25}],pressureCurve:PressureCurve.firm()}));const final=doc.toJSON();doc.undo();const state=doc.getSnapshot(),history={version:1,past:state.past,future:state.future};
 const restored=Document._fromWorkspace({...state.document,schemaVersion:28},history);expect(restored.toJSON().schemaVersion).toBe(41);restored.redo();expect(restored.toJSON()).toEqual(final);
 const bad=structuredClone(history);bad.future[0].document.schemaVersion=28;expect(()=>Document._fromWorkspace(state.document,bad)).toThrow(/pressure curves require schema version 29/);
});

it('enforces ancestor locks and rolls back an entire transaction containing a new curve',()=>{
 const doc=new Document(),group=doc.layers.add(new LayerGroup()),layer=group.layers.add(new PaintLayer());group.locked=true;const before=doc.toJSON();
 expect(()=>doc.transaction('Locked pressure edit',()=>{doc.name='Uncommitted';layer.strokes.add(new BrushStroke({points:[{x:10,y:10}],pressureCurve:PressureCurve.soft()}));})).toThrow(/Unlock/);expect(doc.toJSON()).toEqual(before);
});

it('portable recorded layer recipes retain curve metadata and reject invalid replay before edits',async()=>{
 const {RecipeRecorder,executeRecipe,validateRecipe,compileEditPlan}=await import('../src/ai/recipes'),source=new Document(),recorder=new RecipeRecorder();recorder.start(null);const unsubscribe=source.onCommand((command,before,after)=>recorder.recordCommand(command,before,after));
 const layer=new PaintLayer({name:'Pressure recipe'});layer.strokes.add(new BrushStroke({points:[{x:20,y:20,pressure:.25}],pressureCurve:PressureCurve.soft()}));source.layers.add(layer);unsubscribe();const recipe=recorder.stop({name:'Pressure recipe'});expect(validateRecipe(recipe).valid).toBe(true);
 const target=new Document(),before=target.toJSON(),result=executeRecipe(recipe,target,{});expect(result.success).toBe(true);const restored=target.layers.at(0);if(!(restored instanceof PaintLayer))throw new Error('Missing recorded layer');const stroke=restored.strokes.at(0);if(!(stroke instanceof BrushStroke))throw new Error('Missing recorded brush');expect(stroke.pressureCurve?.toJSON()).toEqual(PressureCurve.soft().toJSON());target.undo();expect(target.toJSON()).toEqual(before);
 const invalid=structuredClone(recipe),step=invalid.steps[0];if(step.action.type!=='layer.add')throw new Error('Missing recorded layer template');const template=step.action.layerTemplate as unknown as {strokes:{pressureCurve:{points:{input:number;output:number}[]}}[]};template.strokes[0].pressureCurve.points[1].input=0;expect(compileEditPlan(invalid,target.toJSON()).valid).toBe(false);expect(executeRecipe(invalid,target,{}).success).toBe(false);expect(target.toJSON()).toEqual(before);
});
