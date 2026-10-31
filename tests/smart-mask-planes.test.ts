import {it,expect} from 'vitest';
import {Document,RasterLayer,SmartObjectLayer,PaintLayer,LayerGroup,LayerMask,MarqueeSelection,PerspectiveTransform,AffineTransform,BrushStroke,SmartToneFilter,WetPaintStroke} from '../src/dom';
import {allLayers} from '../src/core/model';
import {maskTransform} from '../src/core/masks';
import {ComponentRegistry} from '../src/core/smart/manager';
import {resolveSmartDocument} from '../src/core/smart/resolve';
const perspective=new PerspectiveTransform({corners:[{x:0,y:0},{x:1,y:0},{x:.6,y:.8},{x:.1,y:.8}]});
const mask=()=>new LayerMask({linked:false,placedX:6,placedY:-2,x:3,y:4,basis:new AffineTransform(1,.125,.25,1),selection:new MarqueeSelection({shape:'rectangle',x:12,y:8,width:40,height:36})}).paint(new BrushStroke({points:[{x:25,y:20}],size:8}),'hide');
const close=(actual:AffineTransform,expected:AffineTransform)=>{for(const key of['a','b','c','d','e','f']as const)expect(actual[key],key).toBeCloseTo(expected[key],11);};
function setup(filtered=false){
 const master=new Document({width:80,height:64}),raster=master.layers.add(new RasterLayer({name:'Projected child',assetId:'original',width:64,height:48,x:4,y:5,perspective})),child=filtered?raster.convertToSmartObject():raster;child.mask=mask();if(filtered&&'filterMask'in child){child.addFilter(new SmartToneFilter({saturation:-100}));child.filterMask=mask().with({x:7,y:9});}
 const doc=new Document({width:400,height:300});for(const definition of master.toJSON().components??[])doc.defineComponent(master.getComponent(definition.id),{id:definition.id});
 const id=doc.defineComponent(master),group=doc.layers.add(new LayerGroup());group.transform=new AffineTransform(-1,.25,.5,1,260,40);const instance=doc.placeSmartObject(id,{x:20,y:12,width:120,height:96});instance.moveTo(group);return{doc,master,child,instance,group};
}
for(const filtered of[false,true])it(`retains ${filtered?'ordinary and filter':'ordinary'} document-mask planes on a projected scoped child`,()=>{
 const{doc,child,instance,group}=setup(filtered),before=doc.toJSON(),registry=new ComponentRegistry(before.components),resolved=resolveSmartDocument(before,registry,{preserveFiltered:true}),found=allLayers(resolved.children).find(n=>n.name==='Projected child')!;
 const frame=group.transform.multiply(instance.transform).multiply(AffineTransform.scale(1.5));expect(found.mask!.linked).toBe(false);close(maskTransform(found.mask!,new AffineTransform()),frame.multiply(maskTransform(child.mask!.toJSON(),new AffineTransform())));expect(found.mask!.strokes).toEqual(child.mask!.toJSON().strokes);expect(found.mask!.placedX).toBeUndefined();
 if(filtered&&found.kind==='smart-object'&&'filterMask'in child){expect(found.filterMask!.linked).toBe(false);close(maskTransform(found.filterMask!,new AffineTransform()),frame.multiply(maskTransform(child.filterMask!.toJSON(),new AffineTransform())));}
 expect(doc.toJSON()).toEqual(before);expect(registry.values()).toEqual(before.components);
});
it('moves independent masks with their instance frame while child edits leave that frame fixed',()=>{
 const{doc,instance}=setup(),read=()=>allLayers(resolveSmartDocument(doc.toJSON(),new ComponentRegistry(doc.toJSON().components)).children).find(n=>n.name==='Projected child')!.mask!,before=maskTransform(read(),new AffineTransform());const contents=instance.editContents(),child=contents.layers.at(0)!;child.x+=13;child.y-=7;instance.replaceContents(contents);close(maskTransform(read(),new AffineTransform()),before);instance.x+=12;const after=maskTransform(read(),new AffineTransform());expect(after.e-before.e).toBeCloseTo(-12,11);expect(after.f-before.f).toBeCloseTo(3,11);
});
it('keeps nested shared instances independent and public resolved masks owned',()=>{
 const{doc,instance}=setup();const second=doc.placeSmartObject(instance.componentId,{x:150,y:40,width:80,height:64}),before=doc.toJSON(),resolved=resolveSmartDocument(before,new ComponentRegistry(before.components)),nodes=allLayers(resolved.children).filter(n=>n.name==='Projected child');expect(nodes).toHaveLength(2);expect(nodes[0].mask!.x).not.toBe(nodes[1].mask!.x);const source=nodes[1].mask!.strokes![0].stroke;if(source.kind==='wet')throw Error('Expected ordinary stroke');source.points[0].x=999;expect(doc.toJSON()).toEqual(before);expect(nodes[0].mask!.strokes![0].stroke).not.toEqual(source);expect(second.componentId).toBe(instance.componentId);
});
it('applies the renderer reference frame only to scoped masks, and keeps full-frame child perspective',()=>{
 const{doc}=setup(),root=doc.layers.add(new PaintLayer({name:'Root independent mask'}));root.mask=mask();const before=doc.toJSON(),adapter=new AffineTransform(1,.25,.5,1,-40,22),resolved=resolveSmartDocument(before,new ComponentRegistry(before.components),{maskFrame:adapter});expect(resolved.children.find(n=>n.name===root.name)!.mask).toEqual(root.mask!.toJSON());const normal=resolveSmartDocument(before,new ComponentRegistry(before.components)),actual=allLayers(resolved.children).find(n=>n.name==='Projected child')!,expected=allLayers(normal.children).find(n=>n.name==='Projected child')!;close(maskTransform(actual.mask!,new AffineTransform()),adapter.multiply(maskTransform(expected.mask!,new AffineTransform())));
 const simple=new Document({width:64,height:48}),image=simple.layers.add(new RasterLayer({assetId:'pixels',width:64,height:48,perspective})),container=new Document();container.placeSmartObject(container.defineComponent(simple));const data=container.toJSON(),output=resolveSmartDocument(data,new ComponentRegistry(data.components));expect(allLayers(output.children).find(n=>n.kind==='raster')!.perspective).toEqual(image.perspective!.toJSON());expect(output.children[0].kind).toBe('group');expect(()=>resolveSmartDocument(before,new ComponentRegistry(before.components),{maskFrame:{}as never})).toThrow(/affine/);
});
it('converts independent ordinary/filter masks into the new document frame without linking or rewriting geometry',()=>{
 const{doc,group,instance}=setup(true);instance.mask=mask();instance.filterMask=mask().with({x:7,y:9});instance.addFilter(new SmartToneFilter({exposure:.25}));instance.perspective=perspective;const oldMask=instance.mask.toJSON(),oldFilter=instance.filterMask.toJSON(),before=doc.toJSON(),past=doc.getSnapshot().past.length,component=doc.createSmartObject([group]),after=doc.toJSON(),contents=component.editContents(),copied=(contents.layers.at(0)as LayerGroup).layers.at(0)!;
 expect(copied.id).toBe(instance.id);expect(copied.mask!.linked).toBe(false);close(component.transform.multiply(maskTransform(copied.mask!.toJSON(),new AffineTransform())),maskTransform(oldMask,new AffineTransform()));if(!(copied instanceof SmartObjectLayer))throw Error('Expected smart object');expect(copied.filterMask!.linked).toBe(false);close(component.transform.multiply(maskTransform(copied.filterMask!.toJSON(),new AffineTransform())),maskTransform(oldFilter,new AffineTransform()));expect(copied.mask!.strokes.map(s=>s.stroke.toJSON())).toEqual(oldMask.strokes!.map(s=>s.stroke));expect(doc.getSnapshot().past).toHaveLength(past+1);doc.undo();expect(doc.toJSON()).toEqual(before);doc.redo();expect(doc.toJSON()).toEqual(after);
});
it('retains the master artboard clip when projected or prepared wet pixels extend outside it',()=>{
 for(const mode of ['contained','projected','wet']as const){
  const master=new Document({width:64,height:48}),image=master.layers.add(new RasterLayer({assetId:'original',width:64,height:48}));
  if(mode==='contained')image.perspective=perspective;
  if(mode==='projected')image.perspective=new PerspectiveTransform({corners:[{x:0,y:0},{x:1.5,y:0},{x:1.5,y:1},{x:0,y:1}]});
  if(mode==='wet')image.applyWetPaint(new WetPaintStroke({brush:new BrushStroke({points:[{x:-2,y:3}]}),tiles:[{x:-2,y:3,width:2,height:2,assetId:'paint',coverage:{assetId:'coverage'}}]}));
  const doc=new Document();doc.placeSmartObject(doc.defineComponent(master));const data=doc.toJSON(),resolved=resolveSmartDocument(data,new ComponentRegistry(data.components)),content=allLayers(resolved.children).find(n=>n.name==='Component contents')!;
  expect(content.mask!==null).toBe(mode!=='contained');
 }
});
