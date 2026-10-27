import {expect,it} from 'vitest';
import {Document,VectorLayer,VectorPath} from '../src/dom';
import {pathBounds} from '../src/core/drawing';
import {nativeVectorFootprint} from '../src/engine/native-vector-footprint';
const path=(limit:number)=>VectorPath.fromSvgPath('M24 112L64 16L104 112',{fill:null,stroke:'#ff0000',strokeWidth:16,strokeJoin:'miter',strokeMiterLimit:limit}).toJSON();
it('retains one working footprint when larger miter metadata cannot change the geometry',()=>{
 const a=path(12),b=path(Number.MAX_SAFE_INTEGER),before=structuredClone(b),first=nativeVectorFootprint({paths:[a]})!,second=nativeVectorFootprint({paths:[b]})!;expect(second).toEqual(first);expect(first.y).toBeLessThanOrEqual(-4.8);expect(first.y+first.height).toBeGreaterThanOrEqual(112);expect(first.width*first.height).toBeLessThan(100000);expect(b).toEqual(before);expect(b.strokeMiterLimit).toBe(Number.MAX_SAFE_INTEGER);
});
it('definite bevels do not inherit an unrelated hypothetical miter extent',()=>{expect(nativeVectorFootprint({paths:[path(1)]})).toEqual(nativeVectorFootprint({paths:[path(2)]}));expect(nativeVectorFootprint({paths:[path(4)]})!.y).toBeLessThan(nativeVectorFootprint({paths:[path(1)]})!.y);});
it('leaves non-miter coverage and square-cap support conservative',()=>{
 const p=VectorPath.fromSvgPath('M24 112L64 16L104 112',{fill:null,stroke:'#ff0000',strokeWidth:16,strokeJoin:'round',strokeCap:'square'}).toJSON();expect(nativeVectorFootprint({paths:[p]})).toEqual(pathBounds(p));expect(nativeVectorFootprint({paths:[]})).toBeUndefined();
});
it('keeps the prior conservative hull for an unresolved almost-reversing tangent',()=>{
 const p=VectorPath.fromSvgPath('M0 0L1000 0L0 .00000001',{fill:null,stroke:'#ff0000',strokeWidth:16,strokeJoin:'miter',strokeMiterLimit:12}).toJSON();expect(nativeVectorFootprint({paths:[p]})).toEqual(pathBounds(p));
});
it('bounds maximum-size coincident contours with linear coordinate work and unchanged support',()=>{
 for(const closed of [false,true])for(const count of [128,256,512,20000]){
  let reads=0;
  const coordinate=()=>new Proxy({x:32,y:32},{get(target,key){if(key==='x'||key==='y')reads++;return Reflect.get(target,key);}});
  const points=Array.from({length:count},()=>new Proxy({x:32,y:32,in:coordinate(),out:coordinate()},{get(target,key){if(key==='x'||key==='y')reads++;return Reflect.get(target,key);}}));
  const value={...path(12),closed,points},expected={x:24,y:24,width:16,height:16};
  expect(nativeVectorFootprint({paths:[value]})).toEqual(expected);
  expect(reads).toBeLessThanOrEqual(64*count);
 }
});

const rectangle=()=>VectorPath.rectangle({x:0,y:0,width:20,height:10},0,{fill:'#2468ac',stroke:null,strokeWidth:0});
it('retains placement-independent geometry while returned rectangles remain owned across edits and Undo',()=>{
 const doc=new Document(),layer=doc.layers.add(new VectorLayer({x:100,y:200}));layer.paths.add(rectangle());const first=doc.getSnapshot().document.children[0];if(first.kind!=='vector')throw new Error('Expected vector');const bounds=nativeVectorFootprint(first)!;expect(bounds).toEqual({x:0,y:0,width:20,height:10});bounds.x=999;expect(nativeVectorFootprint(first)).toEqual({x:0,y:0,width:20,height:10});layer.x=500;const moved=doc.getSnapshot().document.children[0];if(moved.kind!=='vector')throw new Error('Expected vector');expect(moved.paths).toBe(first.paths);expect(nativeVectorFootprint(moved)).toEqual({x:0,y:0,width:20,height:10});layer.paths.at(0)!.stroke='#804020';layer.paths.at(0)!.strokeWidth=4;const stroked=doc.getSnapshot().document.children[0];if(stroked.kind!=='vector')throw new Error('Expected vector');expect(nativeVectorFootprint(stroked)!.width).toBeGreaterThan(20);doc.undo();doc.undo();const undone=doc.getSnapshot().document.children[0];if(undone.kind!=='vector')throw new Error('Expected vector');expect(nativeVectorFootprint(undone)).toEqual({x:0,y:0,width:20,height:10});
});
it('a caller-frozen path array with mutable descendants cannot produce stale geometry',()=>{
 const path=rectangle().toJSON(),layer={paths:Object.freeze([path])as unknown as import('../src/core/model').VectorLayerData['paths']};expect(nativeVectorFootprint(layer)).toEqual({x:0,y:0,width:20,height:10});for(const point of path.points){point.x+=100;point.in.x+=100;point.out.x+=100;}expect(nativeVectorFootprint(layer)).toEqual({x:100,y:0,width:20,height:10});
});
it('empty-to-visible mutable geometry and immutable empty results remain distinct',()=>{
 const mutable={paths:[]as import('../src/core/model').VectorLayerData['paths']};expect(nativeVectorFootprint(mutable)).toBeUndefined();mutable.paths.push(rectangle().toJSON());expect(nativeVectorFootprint(mutable)).toEqual({x:0,y:0,width:20,height:10});const doc=new Document();doc.layers.add(new VectorLayer());const empty=doc.getSnapshot().document.children[0];if(empty.kind!=='vector')throw new Error('Expected vector');expect(nativeVectorFootprint(empty)).toBeUndefined();expect(nativeVectorFootprint(empty)).toBeUndefined();
});
