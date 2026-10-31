import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {Document,LayerGroup,RasterLayer,SmartObjectLayer,LayerMask,VectorPath,BrushStroke,PerspectiveTransform,AffineTransform} from '../src/dom';
import {ToolController} from '../src/tools';
import type {EditorApplication} from '../src/editor';
import type {Point} from '../src/core/drawing';

beforeEach(()=>{vi.useFakeTimers();vi.stubGlobal('requestAnimationFrame',(f:()=>void)=>setTimeout(f,0));vi.stubGlobal('cancelAnimationFrame',(h:ReturnType<typeof setTimeout>)=>clearTimeout(h));});
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();});
const modifiers={alt:false,shift:false,pressure:1};
function setup(smart=false){
 const document=new Document(),group=document.layers.add(new LayerGroup({x:20,y:30})),layer=group.layers.add(new RasterLayer({assetId:'original',width:200,height:160}));
 group.transform=new AffineTransform(1.1,.2,.3,.9,20,30);
 const image=smart?layer.convertToSmartObject()as SmartObjectLayer:layer;
 image.perspective=new PerspectiveTransform({corners:[{x:0,y:0},{x:1,y:0},{x:.5,y:.5},{x:0,y:.5}]});
 const basis=new AffineTransform(1.2,.1,-.2,.9,3,4);
 image.mask=new LayerMask({x:3,y:4,basis:new AffineTransform(basis.a,basis.b,basis.c,basis.d),paths:[new VectorPath({closed:true,points:[{x:30,y:40,in:{x:10,y:20},out:{x:55,y:60}},{x:130,y:40},{x:130,y:120}]})]}).paint(new BrushStroke({points:[{x:90,y:80}],size:10}),'hide');
 document.selectedLayer=image;const tools=new ToolController({document,assetStore:{remove:vi.fn()}}as unknown as EditorApplication);tools.configure({penEditTarget:'mask'});
 const world=group.transform.multiply(image.transform),forward=(p:Point)=>{const q=basis.point(p),w=1+q.y/160;return world.point({x:q.x/w,y:q.y/w});},back=(p:Point)=>{const q=world.inverse().point(p),w=1-q.y/160;return basis.inverse().point({x:q.x/w,y:q.y/w});};
 return{document,group,layer:image,tools,forward,back};
}
function close(actual:Point,expected:Point){expect(actual.x).toBeCloseTo(expected.x,10);expect(actual.y).toBeCloseTo(expected.y,10);}

for(const smart of[false,true])it(`edits ${smart?'smart':'raster'} mask anchors through perspective with world grab offset, private preview and one Undo`,async()=>{
 const{document,layer,tools,forward,back}=setup(smart),anchor=layer.mask!.paths[0].points[0],placed=forward(anchor),before=document.toJSON(),past=document.getSnapshot().past.length;
 tools.begin('pen',{x:placed.x+1,y:placed.y-1},modifiers,1);tools.move({x:placed.x+14,y:placed.y+7},modifiers);vi.runAllTimers();expect(document.toJSON()).toEqual(before);expect(tools.getSnapshot().preview?.type).toBe('layer.update');await tools.end();
 const next=layer.mask!.paths[0].points[0],expected=back({x:placed.x+13,y:placed.y+8});close(next,expected);close(next.in,{x:anchor.in.x+expected.x-anchor.x,y:anchor.in.y+expected.y-anchor.y});expect(document.getSnapshot().past).toHaveLength(past+1);expect(layer.mask!.strokes).toHaveLength(1);const after=document.toJSON();document.undo();expect(document.toJSON()).toEqual(before);document.redo();expect(document.toJSON()).toEqual(after);
});
it('nudges in canvas pixels while keeping native handles attached and mirrors handles only without Alt',async()=>{
 const{layer,tools,forward,back}=setup(),anchor=layer.mask!.paths[0].points[0],placed=forward(anchor);
 tools.begin('pen',placed,modifiers,1);await tools.end();tools.nudgeMaskPoint(10,-1);const moved=layer.mask!.paths[0].points[0];close(moved,back({x:placed.x+10,y:placed.y-1}));
 const handle=forward(moved.out);tools.begin('pen',handle,modifiers,1);tools.move({x:handle.x+5,y:handle.y-3},modifiers);await tools.end();const mirrored=layer.mask!.paths[0].points[0];close(mirrored.out,back({x:handle.x+5,y:handle.y-3}));close(mirrored.in,{x:2*mirrored.x-mirrored.out.x,y:2*mirrored.y-mirrored.out.y});
 const second=forward(mirrored.out);tools.begin('pen',second,{...modifiers,alt:true},1);tools.move({x:second.x+4,y:second.y+3},{...modifiers,alt:true});await tools.end();expect(layer.mask!.paths[0].points[0].in).toEqual(mirrored.in);
});
it('draws new native contours, cancels drafts and retains refinements and originals',async()=>{
 const{document,layer,tools,forward}=setup(),before=document.toJSON(),past=document.getSnapshot().past.length;
 tools.startMaskContour();tools.begin('pen',forward({x:20,y:20}),modifiers,1);tools.move(forward({x:35,y:25}),modifiers);vi.runAllTimers();await tools.end();tools.begin('pen',forward({x:90,y:20}),modifiers,1);await tools.end();expect(document.toJSON()).toEqual(before);tools.finishPath();const points=layer.mask!.paths[1].points;close(points[0],{x:20,y:20});close(points[0].out,{x:35,y:25});close(points[0].in,{x:5,y:15});expect(document.getSnapshot().past).toHaveLength(past+1);expect(layer.mask!.strokes).toHaveLength(1);document.undo();expect(document.toJSON()).toEqual(before);
 tools.startMaskContour();tools.begin('pen',forward({x:20,y:20}),modifiers,1);await tools.end();tools.cancel();tools.finishPath();expect(document.toJSON()).toEqual(before);
});
for(const draft of[false,true])for(const change of['selection-roundtrip','revision']as const)it(`synchronously cancels projected ${draft?'contour drafts':'anchor drags'} on ${change}`,async()=>{
 const{document,group,layer,tools,forward}=setup(),before=layer.mask!.toJSON();if(draft)tools.startMaskContour();tools.begin('pen',forward({x:30,y:40}),modifiers,1);tools.move(forward({x:40,y:45}),modifiers);if(draft)await tools.end();
 document.selectLayers([layer]);expect(draft?tools.drawingMaskContour:tools.getSnapshot().drawing).toBe(true);
 if(change==='revision')layer.opacity=.8;else{document.selectedLayer=group;document.selectedLayer=layer;}
 expect(tools.getSnapshot().preview).toBeNull();expect(tools.drawingMaskContour).toBe(false);vi.runAllTimers();await tools.end();tools.finishPath();expect(layer.mask!.toJSON()).toEqual(before);
});
it('keeps unlinked path editing in the document plane and respects ancestor locks',async()=>{
 const{document,group,layer,tools}=setup();layer.mask=layer.mask!.with({linked:false,x:3,y:4,basis:new AffineTransform()});tools.begin('pen',{x:33,y:44},modifiers,1);tools.move({x:43,y:49},modifiers);await tools.end();close(layer.mask!.paths[0].points[0],{x:40,y:45});group.locked=true;const before=document.toJSON();expect(()=>tools.nudgeMaskPoint(1,0)).toThrow(/Unlock/);expect(()=>tools.startMaskContour()).toThrow(/Unlock/);expect(document.toJSON()).toEqual(before);
});

it('cancels inverse-horizon input without committing the last finite preview',async()=>{
 const{document,group,layer,tools}=setup();group.transform=new AffineTransform();layer.mask=new LayerMask({paths:[new VectorPath({closed:true,points:[{x:10,y:10},{x:180,y:10},{x:180,y:100}]})]});const before=document.toJSON();
 tools.begin('pen',{x:10/(1+10/160),y:10/(1+10/160)},modifiers,1);tools.move({x:11,y:12},modifiers);expect(()=>tools.move({x:0,y:160},modifiers)).toThrow(/horizon/);expect(tools.getSnapshot().preview).toBeNull();await tools.end();expect(document.toJSON()).toEqual(before);
});
