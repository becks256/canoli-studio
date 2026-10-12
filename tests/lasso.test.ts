import {expect,it} from 'vitest';
import {lassoSelection} from '../src/core/lasso';
import {containsSelection} from '../src/core/drawing';
import {coverageAt} from '../src/core/pixel-selection';
it('closes a freeform contour with antialiasing, clips to document, and handles degenerate gestures',()=>{
 const points=[{x:0,y:0},{x:10,y:0},{x:0,y:10}];
 const selection=lassoSelection(points,8,8),region=selection.regions[0];
 expect(containsSelection(selection,2,2)).toBe(true);
 expect(containsSelection(selection,7,7)).toBe(false);
 expect(region).toMatchObject({x:0,y:0,width:8,height:8});
 expect(coverageAt(region.coverage!,4,5)).toBeGreaterThan(0);
 expect(coverageAt(region.coverage!,4,5)).toBeLessThan(255);
 expect(lassoSelection(points.slice().reverse(),8,8)).toEqual(selection);
 expect(lassoSelection([{x:1,y:1},{x:2,y:2}],8,8).regions).toEqual([]);
 expect(lassoSelection([{x:-10,y:-10},{x:-5,y:-10},{x:-5,y:-5}],8,8).regions).toEqual([]);
});

it('span rasterization matches an independent point-sampling oracle for fractional, concave and crossing contours',()=>{
 const contours=[
  [{x:-3.2,y:1.1},{x:10.8,y:-2.3},{x:7.4,y:11.7},{x:1.3,y:8.2}],
  [{x:1,y:1},{x:10,y:10},{x:1,y:10},{x:10,y:1}],
  [{x:0,y:0},{x:12,y:0},{x:12,y:4},{x:4,y:4},{x:4,y:12},{x:0,y:12}],
  [{x:2.11,y:2.22},{x:2.44,y:2.2},{x:2.35,y:11.8}],
 ];
 for(const points of contours){
  const selection=lassoSelection(points,12,12),region=selection.regions[0];
  for(let y=0;y<12;y++)for(let x=0;x<12;x++){
   let samples=0;
   for(let sy=0;sy<4;sy++)for(let sx=0;sx<4;sx++){
    const px=x+(sx+0.5)/4,py=y+(sy+0.5)/4;let inside=false;
    for(let i=0,j=points.length-1;i<points.length;j=i++){
     const a=points[j],b=points[i];
     if((a.y>py)!==(b.y>py)&&px<a.x+(py-a.y)*(b.x-a.x)/(b.y-a.y))inside=!inside;
    }
    if(inside)samples++;
   }
   const actual=region?coverageAt(region.coverage!,x-region.x,y-region.y):0;
   expect(actual,JSON.stringify({points,x,y})).toBe(Math.round(samples*255/16));
  }
 }
});

it('encodes a solid 50 MP lasso as one coverage run without allocating a full pixel mask',()=>{
 const selection=lassoSelection([{x:0,y:0},{x:10000,y:0},{x:10000,y:5000},{x:0,y:5000}],10000,5000);
 expect(selection.regions[0].coverage).toEqual({width:10000,height:5000,runs:[50000000,255]});
});
