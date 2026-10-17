import { expect, it } from 'vitest';
import { Document, LayerMask, MarqueeSelection, PaintLayer } from '../src/dom';
import { containsSelection } from '../src/core/drawing';
import { coverageAt } from '../src/core/pixel-selection';
import { parseCommands } from '../src/core/validation';
import { RecipeRecorder, executeRecipe } from '../src/ai/recipes';

const triangle = [{x:10,y:10},{x:80,y:10},{x:10,y:80}];
it('polygon selection shares history, clipping and immutable layer ownership', () => {
  const document = new Document({width:100,height:100});
  const layer = document.layers.add(new PaintLayer({locked:true}));
  const before = document.getSnapshot();
  const points = structuredClone(triangle);
  document.selectPolygon(points);
  const after = document.getSnapshot();
  expect(after.past.length).toBe(before.past.length+1);
  expect(after.document.children).toBe(before.document.children);
  expect(containsSelection(after.document.selection!,20,20)).toBe(true);
  expect(containsSelection(after.document.selection!,70,70)).toBe(false);
  const region = after.document.selection!.regions[0];
  expect(coverageAt(region.coverage!,34,35)).toBeGreaterThan(0);
  expect(coverageAt(region.coverage!,34,35)).toBeLessThan(255);
  points[0].x = 99;
  expect(document.getSnapshot().document.selection).toEqual(after.document.selection);
  expect(layer.locked).toBe(true);
  document.undo();
  expect(document.selection).toBe(null);
  document.redo();
  expect(document.selection!.toJSON()).toEqual(after.document.selection);
});

it('add, subtract and intersect combine with the prior selection', () => {
  for (const operation of ['add','subtract','intersect'] as const) {
    const document = new Document({width:100,height:100});
    document.selection = new MarqueeSelection({shape:'rectangle',x:0,y:0,width:30,height:30});
    document.selectPolygon(triangle,operation);
    const data = document.selection!.toJSON();
    expect(containsSelection(data,5,5)).toBe(operation !== 'intersect');
    expect(containsSelection(data,20,20)).toBe(operation !== 'subtract');
    expect(containsSelection(data,40,20)).toBe(operation === 'add');
    expect(containsSelection(data,90,90)).toBe(false);
  }
});

it('rejects invalid commands and empty polygons without changing document or history', () => {
  const document = new Document({width:100,height:100});
  document.selectAll();
  const before = document.getSnapshot();
  for (const points of [triangle.slice(0,2), [{x:NaN,y:10},...triangle], Array(20001).fill({x:1,y:1}), [{x:1,y:1},{x:2,y:2},{x:3,y:3}], [{x:-10,y:-10},{x:-5,y:-10},{x:-10,y:-5}]]) {
    expect(() => document.selectPolygon(points)).toThrow();
    expect(document.getSnapshot()).toBe(before);
  }
  expect(() => parseCommands([{type:'selection.polygon',points:triangle,operation:'union'}])).toThrow();
  expect(() => parseCommands([{type:'selection.polygon',points:triangle,unknown:true}])).toThrow();
  expect(() => parseCommands([{type:'selection.polygon',points:[{x:0,y:0,unknown:true},...triangle]}])).toThrow();
  expect(parseCommands([{type:'selection.polygon',points:triangle}])[0]).toMatchObject({operation:'replace'});
});

it('rolls back a polygon inside a failed transaction and respects region complexity limits', () => {
  const document = new Document({width:100,height:100});
  const before = document.getSnapshot();
  expect(() => document.transaction('Invalid polygon edit', () => {
    document.selectPolygon(triangle);
    document.resize(-1,1);
  })).toThrow();
  expect(document.getSnapshot()).toBe(before);
  const region = {shape:'rectangle' as const,operation:'add' as const,x:0,y:0,width:1,height:1};
  document.selection = new MarqueeSelection({regions:Array(128).fill(region)});
  const full = document.getSnapshot();
  expect(() => document.selectPolygon(triangle,'add')).toThrow();
  expect(document.getSnapshot()).toBe(full);
});

it('polygon coverage persists as a reusable editable layer mask and project model', () => {
  const document = new Document({width:100,height:100});
  const layer = document.layers.add(new PaintLayer());
  document.selectPolygon([{x:-20,y:-20},{x:120,y:-20},{x:-20,y:120}]);
  const region = document.selection!.toJSON().regions[0];
  expect(region).toMatchObject({x:0,y:0,width:100,height:100});
  layer.mask = new LayerMask({selection:document.selection!});
  const restored = Document.fromJSON(document.toJSON());
  expect(restored.selection!.toJSON()).toEqual(document.selection!.toJSON());
  expect(restored.layers.at(0)!.mask!.toJSON()).toEqual(layer.mask.toJSON());
});

it('records polygon selections as portable deterministic recipe coverage', () => {
  const document = new Document({width:100,height:100});
  const recorder = new RecipeRecorder();
  recorder.start();
  document.onCommand((command,before,after) => recorder.recordCommand(command,before,after));
  document.selectPolygon(triangle);
  const recipe = recorder.stop({name:'Polygon selection'});
  const target = new Document({width:100,height:100});
  expect(executeRecipe(recipe,target,{}).success).toBe(true);
  expect(target.selection!.toJSON()).toEqual(document.selection!.toJSON());
});
