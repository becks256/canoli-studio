import type { BrushStrokeData } from '../src/core/drawing';
import {expect,it} from 'vitest';
import {BrushStroke} from '../src/dom';
import {strokeCaptureRegion,strokeIntersectsRegion} from '../src/engine/stroke-region';

it('rejects distant diagonal regions while retaining endpoints, crossings and degenerate segments',()=>{
 const stroke=new BrushStroke({size:20,points:[{x:0,y:0},{x:1000,y:1000},{x:1000,y:1000}]}).toJSON() as BrushStrokeData;
 expect(strokeIntersectsRegion(stroke,{x:0,y:900,width:100,height:100})).toBe(false);
 for(const rect of [{x:490,y:490,width:20,height:20},{x:-10,y:-10,width:5,height:5},{x:1000,y:1000,width:1,height:1}])expect(strokeIntersectsRegion(stroke,rect)).toBe(true);
 expect(strokeIntersectsRegion(stroke,{x:0,y:900,width:100,height:100},Infinity)).toBe(true);
});

it('never rejects an independently sampled stamp touching the queried rectangle',()=>{
 for(const points of [[{x:-300,y:700},{x:1100,y:-200}],[{x:40,y:40}],[{x:0,y:0},{x:400,y:500},{x:-100,y:600}]]){
  const stroke=new BrushStroke({size:70,points}).toJSON() as BrushStrokeData;
  for(let y=-256;y<1024;y+=128)for(let x=-256;x<1280;x+=128){
   const rect={x,y,width:128,height:128};let touching=false;
   for(let i=0;i<points.length;i++)for(let j=0;j<=100;j++){
    const a=points[Math.max(0,i-1)],b=points[i],t=j/100,px=a.x+(b.x-a.x)*t,py=a.y+(b.y-a.y)*t;
    const dx=px-Math.max(x,Math.min(x+128,px)),dy=py-Math.max(y,Math.min(y+128,py));
    if(dx*dx+dy*dy<=35*35)touching=true;
   }
   if(touching)expect(strokeIntersectsRegion(stroke,rect)).toBe(true);
  }
 }
});

it('capture bounds retain every sampled stamp contribution while cropping unused tile area',()=>{
 const points=Array.from({length:31},(_,i)=>({x:100+i*90,y:100+i*20}));
 const stroke=new BrushStroke({size:40,points}).toJSON() as BrushStrokeData;
 let area=0;
 for(let y=0;y<1024;y+=512)for(let x=0;x<3072;x+=512){
  const tile={x,y,width:512,height:512},capture=strokeCaptureRegion(stroke,tile);
  if(capture)area+=capture.width*capture.height;
  for(let i=1;i<points.length;i++)for(let t=0;t<=1;t+=.1){
   const cx=points[i-1].x+(points[i].x-points[i-1].x)*t;
   const cy=points[i-1].y+(points[i].y-points[i-1].y)*t;
   for(let angle=0;angle<Math.PI*2;angle+=.1){
    const px=cx+20*Math.cos(angle),py=cy+20*Math.sin(angle);
    if(px<x||px>=x+512||py<y||py>=y+512)continue;
    expect(capture).not.toBeNull();
    expect(px).toBeGreaterThanOrEqual(capture!.x);expect(px).toBeLessThan(capture!.x+capture!.width);
    expect(py).toBeGreaterThanOrEqual(capture!.y);expect(py).toBeLessThan(capture!.y+capture!.height);
   }
  }
 }
 expect(area).toBeLessThan(3072*1024/3);
});
