import {expect,it} from 'vitest';
import {MaskPathMapping} from '../src/core/mask-path';
import {ProjectiveTransform} from '../src/core/projective';
import {AffineTransform} from '../src/core/affine';
import {projectivePathOutline,hitTestProjectivePath} from '../src/core/projective-bezier';
import type {PathAnchor,Point} from '../src/core/drawing';

const path:PathAnchor[]=[{x:0,y:0,in:{x:0,y:0},out:{x:80,y:160}},{x:120,y:0,in:{x:100,y:-140},out:{x:120,y:0}}];
const cubic=(t:number)=>{const[a,b]=path,u=1-t;return{x:u**3*a.x+3*u*u*t*a.out.x+3*u*t*t*b.in.x+t**3*b.x,y:u**3*a.y+3*u*u*t*a.out.y+3*u*t*t*b.in.y+t**3*b.y};};
const projection=new ProjectiveTransform([1,.2,30,.1,1,50,.008,.001,1]);
function lines(d:string){return [...d.matchAll(/M ([^ ]+) ([^ ]+) L ([^ ]+) ([^ ]+)/g)].map(m=>m.slice(1).map(Number));}
function distance(p:Point,[x,y,right,bottom]:number[]){const dx=right-x,dy=bottom-y,l=dx*dx+dy*dy,t=l?Math.max(0,Math.min(1,((p.x-x)*dx+(p.y-y)*dy)/l)):0;return Math.hypot(p.x-x-t*dx,p.y-y-t*dy);}

it('presents the rational cubic within the requested screen error, preserving every native control',()=>{
 const before=structuredClone(path),segments=lines(projectivePathOutline(path,false,projection,{x:-100,y:-100,width:400,height:400},.05));
 expect(segments.length).toBeGreaterThan(10);
 let maximum=0;for(let i=0;i<=10000;i++){const p=projection.point(cubic(i/10000));maximum=Math.max(maximum,Math.min(...segments.map(line=>distance(p,line))));}
 expect(maximum).toBeLessThanOrEqual(.05);expect(path).toEqual(before);
});
it('finds the original cubic parameter on a nonlinear projected curve at any zoom',()=>{
 for(const t of [.13,.37,.71])for(const zoom of [.25,1,8]){
  const p=projection.point(cubic(t)),relative=ProjectiveTransform.fromAffine(AffineTransform.scale(zoom)).multiply(ProjectiveTransform.fromAffine(AffineTransform.translation(-p.x,-p.y))).multiply(projection);
  const hit=hitTestProjectivePath(path,false,relative);expect(hit?.index).toBe(0);expect(hit!.distance).toBeLessThan(.02);expect(hit!.t).toBeCloseTo(t,3);
 }
});
it('clips both finite branches of a horizon crossing without joining them across the view',()=>{
 const points=[{x:-2,y:1,in:{x:-2,y:1},out:{x:-2,y:1}},{x:2,y:1,in:{x:2,y:1},out:{x:2,y:1}}],matrix=new ProjectiveTransform([1,0,0,0,1,0,1,0,0]);
 const segments=lines(projectivePathOutline(points,false,matrix,{x:0,y:-10,width:2,height:20},.01));
 expect(segments.length).toBeGreaterThan(1);for(const line of segments){expect(line.every(Number.isFinite)).toBe(true);expect(Math.abs(line[1])).toBeLessThanOrEqual(10);expect(Math.abs(line[3])).toBeLessThanOrEqual(10);expect(Math.sign(line[1])).toBe(Math.sign(line[3]));}
 expect(segments.some(s=>s[1]>0)).toBe(true);expect(segments.some(s=>s[1]<0)).toBe(true);
});
it('keeps a complete 20,000-anchor contour within the display work budget and rejects exhausted queries explicitly',()=>{
 const points=Array.from({length:20000},(_,i)=>{const p={x:60+45*Math.cos(i/20000*Math.PI*2),y:60+45*Math.sin(i/20000*Math.PI*2)};return{...p,in:p,out:p};});
 expect(lines(projectivePathOutline(points,true,projection,{x:-100,y:-100,width:400,height:400},.2))).toHaveLength(20000);
 expect(()=>hitTestProjectivePath(path,false,projection,7,{remaining:0})).toThrow(/work budget/);
 expect(()=>projectivePathOutline(path,false,projection,{x:-100,y:-100,width:400,height:400},.2,{remaining:0})).toThrow(/work budget/);
});

it('keeps a distant world origin outside projective outline and pointer arithmetic',()=>{
 const origin={x:2**40+.125,y:-(2**40)+.375},mapping=new MaskPathMapping(new AffineTransform(1.2,.1,.2,.9,origin.x,origin.y),projection),near=new MaskPathMapping(new AffineTransform(1.2,.1,.2,.9),projection);
 expect(mapping.relativeTo(origin).values).toEqual(near.relativeTo({x:0,y:0}).values);
 const native={x:31.25,y:17.5},roundTrip=mapping.inverse().point(mapping.point(native));expect(roundTrip.x).toBeCloseTo(native.x,2);expect(roundTrip.y).toBeCloseTo(native.y,2);
});
