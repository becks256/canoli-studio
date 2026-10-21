import {expect,it} from 'vitest';
import {VectorPath} from '../src/dom';
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
