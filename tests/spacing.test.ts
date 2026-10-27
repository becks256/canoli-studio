import {expect,it} from 'vitest';
import {measureSpacing,snapToSpacing} from '../src/core/spacing';
import {Document,LayerGroup,PaintLayer,PaintFill,AffineTransform} from '../src/dom';
import {artworkSnapBounds} from '../src/core/snapping';
import {layerBounds} from '../src/core/spatial';
const rect=(x:number,y=50,width=20,height=20)=>({x,y,width,height});
const base={x:0,y:0,guides:{}};
it('measures the four nearest nonoverlapping gaps in document pixels and ignores diagonal artwork',()=>{
 const moving=rect(100,100),targets=[rect(50,100),rect(160,100),rect(100,50),rect(100,170),rect(90,200),rect(0,100)];
 expect(measureSpacing(moving,targets)).toEqual([{axis:'x',from:70,to:100,at:110,gap:30,equal:false},{axis:'x',from:120,to:160,at:110,gap:40,equal:false},{axis:'y',from:70,to:100,at:110,gap:30,equal:false},{axis:'y',from:120,to:170,at:110,gap:50,equal:false}]);
});
it('reports true equal gaps, preserves fractional geometry and does not invent overlap or touching measurements',()=>{
 expect(measureSpacing(rect(60.25),[rect(20),rect(100.5)]).map(g=>[g.gap,g.equal])).toEqual([[20.25,true],[20.25,true]]);
 expect(measureSpacing(rect(50),[rect(45),rect(70),rect(80,90),rect(20,0,0,20),rect(Infinity)])).toEqual([]);
});
for(const axis of ['x','y']as const)it(`centers between neighbors on ${axis} within a zoom-derived tolerance without changing inputs`,()=>{
 const flip=(r:ReturnType<typeof rect>)=>axis==='x'?r:{x:r.y,y:r.x,width:r.height,height:r.width},moving=Object.freeze(flip(rect(47))),targets=Object.freeze([Object.freeze(flip(rect(0))),Object.freeze(flip(rect(100)))]),result=snapToSpacing(moving,{x:0,y:0},base,targets,3);
 expect(result[axis]).toBe(3);expect(result.matches).toHaveLength(1);const final={...moving,[axis]:moving[axis]+3};expect(measureSpacing(final,targets,result.matches).filter(g=>g.axis===axis).map(g=>[g.gap,g.equal])).toEqual([[30,true],[30,true]]);expect(snapToSpacing(moving,{x:0,y:0},base,targets,2.99).matches).toEqual([]);
});
for(const direction of ['after','before']as const)it(`repeats an existing adjacent gap ${direction} the pair and shows both measured intervals`,()=>{
 const moving=rect(direction==='after'?84:57),targets=direction==='after'?[rect(0),rect(40)]:[rect(100),rect(140)],result=snapToSpacing(moving,{x:0,y:0},base,targets,6),final={...moving,x:moving.x+result.x};
 expect(result.x).toBe(direction==='after'?-4:3);expect(result.matches).toHaveLength(1);const guides=measureSpacing(final,targets,result.matches);expect(guides.filter(g=>g.equal).map(g=>g.gap)).toEqual([20,20]);expect(guides.map(g=>[g.from,g.to]).sort((a,b)=>a[0]-b[0])).toEqual(direction==='after'?[[20,40],[60,80]]:[[80,100],[120,140]]);
});
it('keeps existing edge/center/guide attraction on ties and picks a strictly closer gap',()=>{
 const moving=rect(47),targets=[rect(0),rect(100)];
 for(const correction of [1,3]){const result=snapToSpacing(moving,{x:0,y:0},{x:correction,y:0,guides:{x:47+correction}},targets,6);expect(result.x).toBe(correction);expect(result.matches).toHaveLength(0);}
 const result=snapToSpacing(moving,{x:0,y:0},{x:5,y:0,guides:{x:52}},targets,6);expect(result.x).toBe(3);expect(result.guides.x).toBeUndefined();
});
it('uses final positions rather than stale snap proposals for measurements',()=>{
 const moving=rect(47),targets=[rect(0),rect(100)],snap=snapToSpacing(moving,{x:0,y:0},base,targets,6);
 expect(measureSpacing(rect(51),targets,snap.matches).map(g=>[g.gap,g.equal])).toEqual([[31,false],[29,false]]);
 expect(measureSpacing(rect(50),targets,snap.matches).map(g=>[g.gap,g.equal])).toEqual([[30,true],[30,true]]);
});
it('rejects invalid, empty and numerically unresolved spacing without returning fabricated guides',()=>{
 for(const moving of [rect(NaN),rect(0,0,-1),rect(0,0,0),rect(1e308,0,1e308)]){expect(measureSpacing(moving,[rect(40)])).toEqual([]);expect(snapToSpacing(moving,{x:0,y:0},base,[rect(40)],6).matches).toEqual([]);}
 expect(snapToSpacing(rect(1e15+49.875),{x:0,y:0},base,[rect(1e15),rect(1e15+100)],.5).matches).toEqual([]);
 for(const tolerance of [-1,Infinity,NaN])expect(snapToSpacing(rect(47),{x:0,y:0},base,[rect(0),rect(100)],tolerance).matches).toEqual([]);
});
it('ignores hidden subtrees and moving ancestors while retaining locked affine sibling references',()=>{
 const doc=new Document(),parent=doc.layers.add(new LayerGroup());parent.transform=new AffineTransform(0,2,-2,0,200,0);const moving=parent.layers.add(new PaintLayer({x:25,y:25}));moving.strokes.add(new PaintFill({bounds:{x:0,y:0,width:10,height:10},color:'#ff0000'}));const stationary=parent.layers.add(new PaintLayer({x:25,y:65}));stationary.strokes.add(new PaintFill({bounds:{x:0,y:0,width:10,height:10},color:'#ff0000'}));stationary.locked=true;doc.layers.add(new LayerGroup({visible:false})).layers.add(new PaintLayer());
 const view=doc.toJSON(),targets=artworkSnapBounds(view,[moving.id]);expect(targets).toEqual([{x:50,y:50,width:20,height:20}]);expect(measureSpacing(layerBounds(view,moving.id)!,targets)).toEqual([{axis:'x',from:70,to:130,at:60,gap:60,equal:false}]);expect(artworkSnapBounds(view,[parent.id])).toEqual([]);
});
it('stable geometry gives identical guides when stationary layer order changes',()=>{
 const moving=rect(47),targets=[rect(0),rect(100),rect(500),rect(0,0),rect(100,0)],result=snapToSpacing(moving,{x:0,y:0},base,targets,6);
 expect(snapToSpacing(moving,{x:0,y:0},base,[...targets].reverse(),6)).toEqual(result);
});
