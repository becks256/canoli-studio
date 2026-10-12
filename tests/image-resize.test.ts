import { expect, it } from 'vitest';
import { Document, LayerGroup, PaintLayer, BrushStroke, MarqueeSelection, LayerMask } from '../src/dom';
import { layerTransform } from '../src/core/spatial';
import { containsSelection } from '../src/core/drawing';
import { parseCommands } from '../src/core/validation';
import { execute } from '../src/core/commands';

it('image resize scales nested locked artwork, selections and unlinked masks once, with atomic undo', () => {
  const doc = new Document({width:100,height:80});
  const group=doc.layers.add(new LayerGroup({x:10,y:5}));
  const paint=group.layers.add(new PaintLayer({x:4,y:3}));
  paint.strokes.add(new BrushStroke({points:[{x:2,y:2,pressure:1}],size:10,color:'#ff0000'}));
  paint.mask=new LayerMask({selection:new MarqueeSelection({shape:'rectangle',x:0,y:0,width:10,height:10}),linked:false,x:14,y:8,enabled:true,inverted:false,density:1});
  doc.selection=new MarqueeSelection({shape:'rectangle',x:10,y:10,width:20,height:20});
  group.locked=true;
  const before=doc.toJSON();
  doc.resizeImage(200,240);
  const after=doc.toJSON();
  expect([doc.width,doc.height]).toEqual([200,240]);
  expect(layerTransform(after,paint.id)!.point({x:2,y:2})).toEqual({x:32,y:30});
  expect(paint.strokes.at(0)!.toJSON()).toEqual((before.children[0] as any).children[0].strokes[0]);
  expect(paint.mask!.toJSON()).toMatchObject({x:28,y:24,basis:{a:2,d:3}});
  expect(containsSelection(after.selection!,25,35)).toBe(true);
  expect(containsSelection(after.selection!,15,15)).toBe(false);
  expect(group.locked).toBe(true);
  doc.undo();expect(doc.toJSON()).toEqual(before);
  doc.redo();expect(doc.toJSON()).toEqual(after);
  expect(()=>doc.resizeImage(0,100)).toThrow();expect(doc.toJSON()).toEqual(after);
});

it('canvas resize leaves artwork unchanged; REST image resize uses the same validated operation',()=>{
  const doc=new Document({width:100,height:100});
  doc.layers.add(new PaintLayer({x:10,y:20}));
  const layers=doc.toJSON().children;
  doc.resize(200,200);expect(doc.toJSON().children).toEqual(layers);
  const [command]=parseCommands([{type:'document.resizeImage',width:400,height:100}]);
  const result=execute(doc.toJSON(),command);
  expect(result.children[0]).toMatchObject({x:20,y:10,transform:{a:2,d:0.5}});
  expect(()=>parseCommands([{type:'document.resizeImage',width:1.5,height:100}])).toThrow();
});

it('saved comps and guides stay in the resized coordinate plane, and recipes replay image resizing',async()=>{
  const {LayerComp,Guide}=await import('../src/dom');
  const {RecipeRecorder}=await import('../src/ai/recipes/recorder');
  const {executeRecipe}=await import('../src/ai/recipes/executor');
  const doc=new Document({width:100,height:100});
  const layer=doc.layers.add(new PaintLayer({x:10,y:20}));
  const comp=doc.layerComps.add(new LayerComp({name:'Original'}));
  doc.guides.add(new Guide({orientation:'vertical',position:30}));
  const recorder=new RecipeRecorder();
  recorder.start();
  const unhook=doc.onCommand((command,before,after)=>recorder.recordCommand(command,before,after));
  doc.resizeImage(200,300);
  unhook();
  const recipe=recorder.stop();
  expect(doc.guides.items[0].position).toBe(60);
  layer.x=90;comp.apply();
  expect(layer.x).toBe(20);
  expect(layerTransform(doc.toJSON(),layer.id)!.point({x:1,y:1})).toEqual({x:22,y:63});
  const target=new Document({width:100,height:100});
  expect(executeRecipe(recipe,target).success).toBe(true);
  expect([target.width,target.height]).toEqual([200,300]);
});
