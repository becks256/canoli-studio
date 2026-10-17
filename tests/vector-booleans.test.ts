import { describe, it, expect, vi } from 'vitest';
import { Worker } from 'node:worker_threads';
import { Document, VectorLayer, VectorPath, VectorContour, LayerGroup, AffineTransform } from '../src/dom';
import { calculateVectorBoolean } from '../src/engine/vector-boolean-kernel';
import { captureVectorBoolean, vectorBooleanRequestSchema, type VectorBooleanRequest, type VectorBooleanOperation } from '../src/core/vector-boolean';
import { parseCommands } from '../src/core/validation';
import { prepareServerVectorBoolean } from '../server/vector-boolean';

const rectangle=(x=0,y=0,width=100,height=100)=>VectorPath.rectangle({x,y,width,height},0,{fill:'#ff0000',stroke:null});
const operand=(path:VectorPath)=>({contours:[path.points,...[...path.subpaths].map(c=>c.points)],fillRule:path.fillRule});
const request=(operation:VectorBooleanOperation,a=rectangle(),b=rectangle(50,0,100,100)):VectorBooleanRequest=>({operation,paths:[a,b].map(operand)});
const area=(contours:ReturnType<typeof calculateVectorBoolean>['contours'])=>Math.abs(contours.reduce((sum,points)=>sum+points.reduce((area,p,i)=>{const q=points[(i+1)%points.length];return area+(p.x*q.y-q.x*p.y)/2;},0),0));
const host=(doc:Document)=>{doc._prepareVectorBoolean=async(selection)=>calculateVectorBoolean(captureVectorBoolean(doc.getSnapshot().document,selection).request);};

describe('curve-preserving Boolean operations',()=>{
 it.each([['union',15000],['subtract',5000],['intersect',5000],['exclude',10000]] as const)('%s returns the analytically expected rectangle area', (operation,expected)=>{
  const r=calculateVectorBoolean(request(operation));expect(area(r.contours)).toBeCloseTo(expected,7);expect(r.fillRule).toBe('nonzero');
 });
 it('keeps holes and disconnected islands with correct nonzero/even-odd input winding',()=>{
  const a=rectangle(),b=rectangle(20,20,60,60),hole=calculateVectorBoolean(request('subtract',a,b));expect(hole.contours).toHaveLength(2);expect(area(hole.contours)).toBeCloseTo(6400,7);
  const disjoint=calculateVectorBoolean(request('union',a,rectangle(200,0,100,100)));expect(disjoint.contours).toHaveLength(2);expect(area(disjoint.contours)).toBeCloseTo(20000,7);
  a.subpaths.add(new VectorContour({points:b.points}));a.fillRule='evenodd';expect(area(calculateVectorBoolean(request('intersect',a,b)).contours)).toBe(0);a.fillRule='nonzero';expect(area(calculateVectorBoolean(request('intersect',a,b)).contours)).toBeCloseTo(3600,7);
 });
 it('retains cubic handles and self-intersection semantics without polygon flattening',()=>{
  const a=VectorPath.ellipse({x:0,y:0,width:100,height:100}),b=rectangle(50,-10,80,120),r=calculateVectorBoolean(request('intersect',a,b));expect(r.contours).toHaveLength(1);expect(r.contours[0].some(p=>p.in.x!==p.x||p.in.y!==p.y||p.out.x!==p.x||p.out.y!==p.y)).toBe(true);expect(r.contours[0].length).toBeLessThan(10);
  const bow=VectorPath.fromSvgPath('M0 0L100 100L0 100L100 0Z',{fillRule:'evenodd'}),full=rectangle(-10,-10,120,120);expect(area(calculateVectorBoolean(request('intersect',bow,full)).contours)).toBeCloseTo(5000,7);
 });
 it('handles identical/tangent/empty operands and continues sequentially after an empty intermediate result',()=>{
  expect(calculateVectorBoolean(request('subtract',rectangle(),rectangle())).contours).toEqual([]);expect(calculateVectorBoolean(request('exclude',rectangle(),rectangle())).contours).toEqual([]);expect(calculateVectorBoolean(request('intersect',rectangle(),rectangle(100,0,100,100))).contours).toEqual([]);
  const degenerate=new VectorPath({points:[{x:20,y:20}],closed:true});expect(area(calculateVectorBoolean(request('union',degenerate,rectangle())).contours)).toBeCloseTo(10000,7);
  const r=calculateVectorBoolean({operation:'exclude',paths:[rectangle(),rectangle(),rectangle(200,0,40,40)].map(operand)});expect(area(r.contours)).toBeCloseTo(1600,7);
 });
 it('normalizes large offsets and tiny spans before calculation and validates input/output budgets',()=>{
  const a=rectangle(1e12,-1e12,100,100),b=rectangle(1e12+50,-1e12,100,100),r=calculateVectorBoolean(request('intersect',a,b));const xs=r.contours.flat().map(p=>p.x);expect(Math.min(...xs)).toBe(1e12+50);expect(Math.max(...xs)).toBe(1e12+100);
  const tiny=calculateVectorBoolean(request('union',rectangle(0,0,1e-100,1e-100),rectangle(5e-101,0,1e-100,1e-100)));expect(tiny.contours.flat().every(p=>Number.isFinite(p.x)&&Number.isFinite(p.in.y))).toBe(true);expect(tiny.contours).toHaveLength(1);
  const huge=request('union');huge.paths[0].contours[0]=Array(20000).fill(huge.paths[0].contours[0][0]);expect(()=>vectorBooleanRequestSchema.parse(huge)).toThrow(/20000/);expect(()=>calculateVectorBoolean({...request('union'),operation:'divide'} as never)).toThrow();
 });
 it('commits one OO operation with first style/identity, removes empty operands, and retains other paths and exact undo',async()=>{
  const doc=new Document(),a=doc.layers.add(new VectorLayer()),b=doc.layers.add(new VectorLayer()),first=a.paths.add(rectangle()),other=b.paths.add(rectangle(20,20,60,60)),unselected=a.paths.add(rectangle(200,0,20,20));host(doc);a.opacity=.75;first.fillGradient={kind:'linear',start:{x:0,y:0},end:{x:100,y:0},stops:[{position:0,color:'#ff0000'},{position:1,color:'#0000ff'}]};const before=doc.toJSON(),history=doc.getSnapshot().past.length;
  const result=await doc.combinePaths('subtract',[first,other]);expect(result).toBe(first);expect(result!.subpaths.length).toBe(1);expect(result!.fillGradient).toEqual(first.fillGradient);expect(a.paths.get(unselected.id)).toBe(unselected);expect(doc.getLayer(b.id)).toBeNull();expect(()=>other.points).toThrow();expect(a.opacity).toBe(.75);expect(doc.getSnapshot().past.length).toBe(history+1);const after=doc.toJSON();doc.undo();expect(doc.toJSON()).toEqual(before);expect(other.points).toHaveLength(4);doc.redo();expect(doc.toJSON()).toEqual(after);
 });
 it('maps nested reflected/sheared cross-layer coordinates into the first layer plane and preserves unrelated layers',async()=>{
  const doc=new Document(),group=doc.layers.add(new LayerGroup()),a=group.layers.add(new VectorLayer()),b=doc.layers.add(new VectorLayer()),other=doc.layers.add(new VectorLayer()),p=a.paths.add(rectangle()),q=b.paths.add(rectangle());group.transform=new AffineTransform(-1,.2,.3,1,100,10);b.transform=group.transform;host(doc);
  const r=await doc.combinePaths('intersect',[p,q]);expect(r).toBe(p);expect(area([r!.points])).toBeCloseTo(10000,6);expect(doc.getLayer(other.id)).toBe(other);expect(a.transform.toJSON()).toEqual(new AffineTransform().toJSON());
 });
 it('does not couple same-layer local geometry to an underflowed world transform',async()=>{
  const doc=new Document(),group=doc.layers.add(new LayerGroup()),layer=group.layers.add(new VectorLayer());group.transform=AffineTransform.scale(1e-200);layer.transform=AffineTransform.scale(1e-200);layer.paths.add(rectangle());layer.paths.add(rectangle(50,0,100,100));host(doc);
  const result=await layer.combinePaths('intersect');expect(area([result!.points])).toBeCloseTo(5000,7);expect(group.transform.a).toBe(1e-200);expect(layer.transform.a).toBe(1e-200);
 });
 it('rejects duplicates, open/foreign/locked operands, invalid replacement and synchronous transaction use without changes',async()=>{
  const doc=new Document(),group=doc.layers.add(new LayerGroup()),a=group.layers.add(new VectorLayer()),p=a.paths.add(rectangle()),q=a.paths.add(rectangle(20,20,60,60));host(doc);const before=doc.toJSON();
  await expect(doc.combinePaths('union',[p,p])).rejects.toThrow(/distinct/);await expect(doc.combinePaths('union',[p,rectangle()])).rejects.toThrow(/belong/);q.closed=false;const open=doc.toJSON();await expect(a.combinePaths('union')).rejects.toThrow(/closed/);expect(doc.toJSON()).toEqual(open);q.closed=true;group.locked=true;const locked=doc.toJSON();await expect(a.combinePaths('union')).rejects.toThrow(/Unlock/);expect(doc.toJSON()).toEqual(locked);group.locked=false;
  await expect((async()=>{let work:Promise<unknown>|undefined;doc.transaction('No async',()=>{work=a.combinePaths('union');});await work;})()).rejects.toThrow(/synchronous transaction/);
  const stable=doc.toJSON();expect(()=>doc._dispatch({type:'paths.replace',operands:[{layerId:a.id,pathId:p.id},{layerId:a.id,pathId:q.id}],result:{...p.toJSON(),id:'different'}})).toThrow(/identity/);expect(doc.toJSON()).toEqual(stable);expect(before.children.length).toBe(1);
  expect(()=>parseCommands([{type:'paths.replace',operands:[{layerId:a.id,pathId:p.id}],result:null}])).toThrow();
 });
 it('discards stale, malformed and aborted preparation and validates callback failures in a real Node worker',async()=>{
  const doc=new Document(),a=doc.layers.add(new VectorLayer()),p=a.paths.add(rectangle()),q=a.paths.add(rectangle(20,20,60,60));
  const early=new AbortController();early.abort(new Error('Precancelled before capture'));q.closed=false;let prepared=false;doc._prepareVectorBoolean=async()=>{prepared=true;return calculateVectorBoolean(request('union'));};await expect(doc.combinePaths('union',[p,q],{signal:early.signal})).rejects.toThrow('Precancelled before capture');expect(prepared).toBe(false);q.closed=true;
  doc._prepareVectorBoolean=async()=>{doc.name='Concurrent';return calculateVectorBoolean(request('union'));};await expect(a.combinePaths('union')).rejects.toThrow(/changed/);expect(a.paths.length).toBe(2);
  doc._prepareVectorBoolean=async()=>({contours:[[]],fillRule:'nonzero'});await expect(a.combinePaths('union')).rejects.toThrow();expect(a.paths.length).toBe(2);
  const abort=new AbortController();doc._prepareVectorBoolean=async()=>{abort.abort(new Error('Stopped'));return calculateVectorBoolean(request('union'));};await expect(doc.combinePaths('union',[p,q],{signal:abort.signal})).rejects.toThrow('Stopped');expect(a.paths.length).toBe(2);
  const progress:number[]=[];const actual=await prepareServerVectorBoolean(request('subtract'),{onProgress:p=>progress.push(p.completed)});expect(area(actual.contours)).toBeCloseTo(5000,7);expect(progress).toEqual([0,1]);
  await expect(prepareServerVectorBoolean(request('union'),{onProgress:()=>{throw new Error('Callback rejected');}})).rejects.toThrow('Callback rejected');
  const cancel=new AbortController();await expect(prepareServerVectorBoolean(request('union'),{signal:cancel.signal,onProgress:()=>cancel.abort(new Error('Cancel worker'))})).rejects.toThrow('Cancel worker');
 });
 it('terminates a real worker on the calculation deadline without committing any path edits',async()=>{
  const doc=new Document(),layer=doc.layers.add(new VectorLayer());layer.paths.add(rectangle());layer.paths.add(rectangle(20,20,60,60));doc._prepareVectorBoolean=(selection,control)=>prepareServerVectorBoolean(captureVectorBoolean(doc.getSnapshot().document,selection).request,control);const before=doc.toJSON(),timer=globalThis.setTimeout,deadlines:number[]=[],terminate=vi.spyOn(Worker.prototype,'terminate');
  const clock=vi.spyOn(globalThis,'setTimeout').mockImplementation(((handler:()=>void,delay?:number,...args:unknown[])=>{if(delay===30000)deadlines.push(delay);return timer(handler,delay===30000?1:delay,...args);}) as typeof globalThis.setTimeout);
  try{await expect(layer.combinePaths('union')).rejects.toThrow(/30-second/);expect(doc.toJSON()).toEqual(before);expect(deadlines).toEqual([30000]);expect(terminate).toHaveBeenCalledOnce();}finally{clock.mockRestore();terminate.mockRestore();}
 });
});
