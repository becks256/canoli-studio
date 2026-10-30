import {it,expect} from 'vitest';
import {AffineTransform} from '../src/core/affine';
import {PerspectiveTransform} from '../src/dom/perspective';
import {PerspectiveCornerDrag} from '../src/ui/perspective-corner';
const value=new PerspectiveTransform({corners:[{x:.1,y:.1},{x:.9,y:.2},{x:1.2,y:1},{x:-.2,y:.9}]});
it('grabbing away from the center preserves all corners until the pointer actually moves',()=>{
 for(let index=0;index<4;index++){
  const point={x:345,y:217},drag=new PerspectiveCornerDrag(value,123.5,76.25,new AffineTransform(1,.2,.4,1,300,200),index,point);
  expect(drag.at({...point}).toJSON()).toEqual(value.toJSON());point.x=999;expect(drag.at({x:345,y:217}).toJSON()).toEqual(value.toJSON());
 }
});
it('corner movement follows canvas pixels through rotated, sheared and reflected parents',()=>{
 const transforms=[new AffineTransform(1,.3,.2,1,100,50),AffineTransform.rotation(.7).multiply(AffineTransform.scale(2,.5)),new AffineTransform(-1,.3,.2,2,90,20)];
 for(const world of transforms)for(let index=0;index<4;index++){
  const drag=new PerspectiveCornerDrag(value,123.5,76.25,world,index,{x:60,y:70}),next=drag.at({x:63,y:68}),before=world.point(value.toPixels(123.5,76.25)[index]),after=world.point(next.toPixels(123.5,76.25)[index]);
  expect(after.x-before.x).toBeCloseTo(3,11);expect(after.y-before.y).toBeCloseTo(-2,11);
  expect(next.corners.filter((_,i)=>i!==index)).toEqual(value.corners.filter((_,i)=>i!==index));
 }
});
it('large placement translations do not enter the pointer displacement calculation',()=>{
 const near=new PerspectiveCornerDrag(value,100,80,new AffineTransform(2,.3,.2,1),0,{x:0,y:0});
 const distant=new PerspectiveCornerDrag(value,100,80,new AffineTransform(2,.3,.2,1,1e15,-1e15),0,{x:0,y:0});
 expect(distant.at({x:3,y:-2}).toJSON()).toEqual(near.at({x:3,y:-2}).toJSON());
});
it('initial affine-only images start from identity without replacing their source geometry',()=>{
 const drag=new PerspectiveCornerDrag(null,100,80,AffineTransform.scale(2),0,{x:1,y:2}),next=drag.at({x:11,y:6});
 expect(next.corners[0]).toEqual({x:.05,y:.025});expect(drag.value.corners[0]).toEqual({x:0,y:0});expect(drag.width).toBe(100);expect(drag.height).toBe(80);
});
it('folding, invalid dimensions and invalid corners reject without changing captured state',()=>{
 const drag=new PerspectiveCornerDrag(null,100,80,new AffineTransform(),0,{x:0,y:0});expect(()=>drag.at({x:100,y:80})).toThrow();expect(drag.at({x:0,y:0}).corners[0]).toEqual({x:0,y:0});
 expect(()=>new PerspectiveCornerDrag(null,0,80,new AffineTransform(),0,{x:0,y:0})).toThrow();expect(()=>new PerspectiveCornerDrag(null,100,80,new AffineTransform(),4,{x:0,y:0})).toThrow();
});
