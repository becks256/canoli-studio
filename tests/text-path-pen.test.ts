import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {Document,TextLayer,TextPath,LayerGroup,AffineTransform,LayerMask,VectorPath} from '../src/dom';
import {ToolController} from '../src/tools';
import type {EditorApplication} from '../src/editor';
import {layerTransform} from '../src/core/spatial';

beforeEach(()=>{vi.useFakeTimers();vi.stubGlobal('requestAnimationFrame',(callback:()=>void)=>setTimeout(callback,0));vi.stubGlobal('cancelAnimationFrame',clearTimeout);});
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();});
const modifiers={alt:false,shift:false,pressure:1};
function setup(affine=false){
 const document=new Document(),group=document.layers.add(new LayerGroup({x:10,y:20}));
 if(affine)group.transform=new AffineTransform(-.9,.35,.22,1.2,180,5);
 const layer=group.layers.add(new TextLayer({x:5,y:7,text:'Canoli',fontSize:32,textPath:new TextPath({points:[{x:30,y:140,in:{x:15,y:135},out:{x:70,y:80}},{x:300,y:140,in:{x:240,y:80},out:{x:320,y:145}}]})}));
 document.selectedLayer=layer;
 const editor={document,assetStore:{remove:vi.fn()}},tools=new ToolController(editor as unknown as EditorApplication),world=layerTransform(document._read(),layer.id)!;
 return{document,group,layer,editor,tools,at:(x:number,y:number)=>world.point({x,y})};
}

for(const affine of [false,true])it(`baseline drag previews are detached, preserve authored placement and commit one Undo: affine=${affine}`,async()=>{
 const{document,layer,tools,at}=setup(affine),before=document.getSnapshot(),original=layer.toJSON();
 tools.begin('pen',at(30,140),modifiers,1);tools.move(at(40,145),modifiers);vi.runAllTimers();
 expect(document.getSnapshot()).toBe(before);const preview=tools.getSnapshot().preview;expect(preview?.type).toBe('layer.update');if(preview?.type!=='layer.update')throw new Error('Missing baseline preview');const point=preview.patch.textPath!.points[0];for(const [actual,expected]of [[point.x,40],[point.y,145],[point.in.x,25],[point.in.y,140],[point.out.x,80],[point.out.y,85]])expect(actual).toBeCloseTo(expected,10);
 const captured=tools.getSnapshot().preview,capturedCopy=structuredClone(captured);tools.move(at(45,150),modifiers);vi.runAllTimers();expect(captured).toEqual(capturedCopy);expect(captured).not.toEqual(tools.getSnapshot().preview);
 await tools.end();expect(document.getSnapshot().past).toHaveLength(before.past.length+1);expect(layer.x).toBe(5);expect(layer.y).toBe(7);expect(layer.textPath!.points[0].x).toBeCloseTo(45);expect(layer.text).toBe('Canoli');
 document.undo();expect(layer.toJSON()).toEqual(original);document.redo();expect(layer.textPath!.points[0].y).toBeCloseTo(150);
});

it('asymmetric handle clicks and returning to the original point retain geometry and history',async()=>{
 const{document,layer,tools,at}=setup(),before=document.getSnapshot();tools.begin('pen',at(70,80),modifiers,1);tools.move(at(70,80),modifiers);await tools.end();expect(document.getSnapshot()).toBe(before);
 tools.begin('pen',at(70,80),modifiers,1);tools.move(at(90,90),modifiers);tools.move(at(70,80),modifiers);vi.runAllTimers();await tools.end();expect(document.getSnapshot()).toBe(before);expect(layer.textPath!.points[0].in).toEqual({x:15,y:135});
});
for(const alt of [false,true])it(`handle dragging uses the captured delta and Alt independence: ${alt}`,async()=>{
 const{layer,tools,at}=setup();tools.begin('pen',at(72,81),modifiers,1);tools.move(at(92,91),{...modifiers,alt});await tools.end();expect(layer.textPath!.points[0].out).toEqual({x:90,y:90});expect(layer.textPath!.points[0].in).toEqual(alt?{x:15,y:135}:{x:-30,y:190});
});
it('curve clicks split exact cubic geometry and midpoint/remove commands retain the layer',async()=>{
 const{document,layer,tools,at}=setup(),before=layer.toJSON();
 // Independently evaluated cubic at t=.5: (30+3*70+3*240+300)/8, (140+3*80+3*80+140)/8.
 tools.begin('pen',at(157.5,95),modifiers,1);vi.runAllTimers();expect(layer.textPath!.points).toHaveLength(2);await tools.end();expect(layer.textPath!.points).toHaveLength(3);expect(tools.selectedTextPathAnchor?.index).toBe(1);
 tools.removeLastAnchor();expect(layer.textPath!.points).toHaveLength(2);expect(document.getLayer(layer.id)).toBeDefined();document.undo();document.undo();expect(layer.toJSON()).toEqual(before);
 tools.begin('pen',at(30,140),modifiers,1);await tools.end();tools.insertTextPathAnchor();expect(layer.textPath!.points[1]).toEqual({x:157.5,y:95,in:{x:102.5,y:95},out:{x:212.5,y:95}});expect(tools.selectedTextPathAnchor?.index).toBe(1);
});
it('blank clicks and minimum-anchor deletion cannot remove the text layer',async()=>{
 const{document,layer,tools,at}=setup(),before=document.getSnapshot();tools.begin('pen',at(30,140),modifiers,1);await tools.end();expect(()=>tools.removeLastAnchor()).toThrow(/at least/);expect(document.getSnapshot()).toBe(before);
 tools.begin('pen',at(800,800),modifiers,1);await tools.end();expect(tools.selectedTextPathAnchor).toBeNull();expect(tools.removeLastAnchor()).toBe(true);expect(document.getSnapshot()).toBe(before);expect(document.getLayer(layer.id)).toBeDefined();
});
for(const conflict of ['cancel','revision','selection','owner','lock']as const)it(`baseline gestures cannot overwrite ${conflict} changes`,async()=>{
 const{document,group,layer,editor,tools,at}=setup(),original=layer.textPath!.toJSON();tools.begin('pen',at(30,140),modifiers,1);tools.move(at(40,150),modifiers);
 if(conflict==='cancel')tools.cancel();if(conflict==='revision')layer.opacity=.5;if(conflict==='selection')document.selectedLayer=group;if(conflict==='owner')editor.document=new Document();if(conflict==='lock')group.locked=true;
 if(conflict==='cancel')await tools.end();else await expect(tools.end()).rejects.toThrow();vi.runAllTimers();expect(layer.textPath!.toJSON()).toEqual(original);expect(tools.getSnapshot().preview).toBeNull();
});
it('nudge uses document-space deltas under reflected/sheared parents and honors parent locks',async()=>{
 const{document,group,layer,tools,at}=setup(true),before=at(30,140);tools.begin('pen',before,modifiers,1);await tools.end();tools.nudgeTextPathPoint(10,-5);const point=layer.textPath!.points[0],world=layerTransform(document._read(),layer.id)!.point(point);expect(world.x).toBeCloseTo(before.x+10);expect(world.y).toBeCloseTo(before.y-5);group.locked=true;const locked=document.getSnapshot();expect(()=>tools.nudgeTextPathPoint(1,0)).toThrow(/Unlock/);expect(document.getSnapshot()).toBe(locked);
});
it('mask mode retains its separate path target and resetting clears baseline anchor selection',async()=>{
 const{layer,tools,at}=setup();tools.begin('pen',at(30,140),modifiers,1);await tools.end();expect(tools.selectedTextPathAnchor).toBeTruthy();layer.mask=new LayerMask({paths:[new VectorPath({closed:true,points:[{x:30,y:140},{x:200,y:140},{x:200,y:220}]})]});tools.configure({penEditTarget:'mask'});expect(tools.selectedTextPathAnchor).toBeNull();const before=layer.textPath!.toJSON();tools.begin('pen',at(30,140),modifiers,1);tools.move(at(40,145),modifiers);await tools.end();expect(layer.textPath!.toJSON()).toEqual(before);tools.configure({penEditTarget:'layer'});tools.reset();expect(tools.selectedTextPathAnchor).toBeNull();
});

it('a closed single-anchor cubic keeps its seam, splits exactly and cannot lose its last anchor',async()=>{
 const{layer,tools,at}=setup();layer.textPath=new TextPath({closed:true,points:[{x:30,y:140,in:{x:0,y:200},out:{x:160,y:20}}]});
 tools.begin('pen',at(30,140),modifiers,1);await tools.end();expect(tools.selectedTextPathAnchor).toMatchObject({canSplit:true,canRemove:false});expect(()=>tools.removeLastAnchor()).toThrow(/at least/);tools.insertTextPathAnchor();expect(layer.textPath!.points).toHaveLength(2);expect(layer.textPath!.points[0]).toMatchObject({x:30,y:140});expect(layer.textPath!.closed).toBe(true);
});
it('a revision change before the queued preview frame cancels stale publication',async()=>{
 const{document,layer,tools,at}=setup(),original=layer.textPath!.toJSON();tools.begin('pen',at(30,140),modifiers,1);tools.move(at(40,150),modifiers);layer.opacity=.5;vi.runAllTimers();expect(tools.getSnapshot().preview).toBeNull();await tools.end();expect(layer.textPath!.toJSON()).toEqual(original);expect(document.getSnapshot().document.children[0]).toMatchObject({kind:'group'});
});
