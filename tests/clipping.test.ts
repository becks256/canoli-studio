import {expect,it} from 'vitest';
import {Document,PaintLayer,VectorLayer,VectorPath,LayerGroup,AdjustmentLayer} from '../src/dom';
import {SCHEMA_VERSION,validateDocument} from '../src/core/model';
import {clippingStacks,clippingBaseFor} from '../src/core/clipping';
import {captureLayerComp,planLayerComp} from '../src/core/layer-comps';
import {serializeProject,readProject} from '../src/core/project';
import {parseCommands} from '../src/core/validation';
import {retouchViewDocument} from '../src/engine/retouch-sampling';
import {planSvgComposition} from '../src/core/svg-composition';
import {planPsdExport} from '../src/core/interchange/psd/export-plan';

it('clipping membership retains hidden siblings and stops at each new base without crossing groups',()=>{
 const orphan=new PaintLayer({clipped:true}),base=new VectorLayer(),a=new PaintLayer({clipped:true,visible:false}),b=new PaintLayer({clipped:true}),next=new LayerGroup(),inner=next.layers.add(new PaintLayer({clipped:true}));
 const nodes=[orphan,base,a,b,next].map(layer=>layer.toJSON()),stacks=clippingStacks(nodes);
 expect(stacks.map(s=>[s.base.id,...s.layers.map(l=>l.id)])).toEqual([[base.id,a.id,b.id],[next.id]]);
 expect(clippingBaseFor(nodes,b.id)?.id).toBe(base.id);expect(clippingBaseFor(nodes,inner.id)).toBeUndefined();expect(clippingStacks([inner.toJSON()])).toEqual([]);
});
it('an adjustment has no intrinsic clipping-base transparency',()=>{
 const adjustment=new AdjustmentLayer(),clip=new PaintLayer({clipped:true});expect(clippingStacks([adjustment.toJSON(),clip.toJSON()]).map(s=>s.layers)).toEqual([[]]);expect(clippingBaseFor([adjustment.toJSON(),clip.toJSON()],clip.id)).toBeUndefined();
});
it('public clipping edits preserve complete paths and placement with exactly one shared Undo',()=>{
 const doc=new Document(),base=doc.layers.add(new VectorLayer()),layer=doc.layers.add(new VectorLayer({x:12,y:15}));base.paths.add(VectorPath.ellipse({x:0,y:0,width:20,height:30}));layer.paths.add(VectorPath.rectangle({x:-12,y:-15,width:80,height:80}));const before=doc.toJSON(),past=doc.getSnapshot().past.length;
 expect(layer.clipped).toBe(false);layer.clipped=true;expect(doc.getSnapshot().past.length).toBe(past+1);expect(doc.toJSON()).toEqual({...before,children:[before.children[0],{...before.children[1],clipped:true}]});doc.undo();expect(doc.toJSON()).toEqual(before);doc.redo();expect(layer.clipped).toBe(true);
});
it('schema 48 and shared command admission reject invalid or disguised legacy clipping',()=>{
 const doc=new Document();doc.layers.add(new PaintLayer({clipped:true}));expect(doc.toJSON().schemaVersion).toBe(SCHEMA_VERSION);expect(()=>validateDocument({...doc.toJSON(),schemaVersion:47})).toThrow('schema version 48');expect(()=>new PaintLayer({clipped:1 as unknown as boolean})).toThrow('boolean');expect(()=>parseCommands([{type:'layer.update',id:doc.layers.at(0)!.id,patch:{clipped:'true'}}])).toThrow();
 expect(parseCommands([{type:'layer.update',id:doc.layers.at(0)!.id,patch:{clipped:false}}])).toMatchObject([{patch:{clipped:false}}]);
});
it('locked clipping edits roll back an entire shared transaction',()=>{
 const doc=new Document(),a=doc.layers.add(new PaintLayer()),b=doc.layers.add(new PaintLayer({locked:true})),before=doc.toJSON();expect(()=>doc.transaction('Clip layers',()=>{a.clipped=true;b.clipped=true;})).toThrow();expect(doc.toJSON()).toEqual(before);
});
it('appearance comps restore clipped state and legacy unclipped defaults without touching source geometry',()=>{
 const doc=new Document();doc.layers.add(new PaintLayer());const layer=doc.layers.add(new PaintLayer()),legacy=captureLayerComp(doc.toJSON(),'Unclipped');layer.clipped=true;const clipped=captureLayerComp(doc.toJSON(),'Clipped'),before=doc.toJSON();doc._dispatch(planLayerComp(doc.toJSON(),legacy).command);expect(layer.clipped).toBe(false);doc.undo();expect(doc.toJSON()).toEqual(before);layer.clipped=false;doc._dispatch(planLayerComp(doc.toJSON(),clipped).command);expect(layer.clipped).toBe(true);
});
it('an explicitly false clipping value in a comp is equivalent to the omitted default and creates no spurious edits',()=>{
 const doc=new Document();doc.layers.add(new PaintLayer());const comp=captureLayerComp(doc.toJSON(),'Default appearance');comp.layers[0].appearance!.clipped=false;expect(planLayerComp(doc.toJSON(),comp).command).toMatchObject({type:'transaction',commands:[]});
});
it('native binary projects keep editable clipping membership without changing their container format',async()=>{
 const doc=new Document();doc.layers.add(new VectorLayer());doc.layers.add(new LayerGroup({clipped:true}));const blob=await serializeProject(doc.toJSON(),{get(){throw new Error('No raster sources');}}),header=new Uint8Array(await blob.slice(0,8).arrayBuffer());expect(header[4]).toBe(51);expect((await readProject(blob)).document).toEqual(doc.toJSON());
});
it('synchronous vector SVG rejects clipping instead of silently emitting unmasked artwork',()=>{
 const layer=new VectorLayer({clipped:true});layer.paths.add(VectorPath.rectangle({x:0,y:0,width:20,height:10}));expect(()=>layer.toSvg(40,30)).toThrow('native backdrop preparation');layer.clipped=false;expect(layer.toSvg(40,30)).toContain('<svg');
});

it('current-layer source isolation clears only outer branch clipping while current-and-below keeps real bases',()=>{
 const doc=new Document(),base=doc.layers.add(new PaintLayer()),group=doc.layers.add(new LayerGroup({clipped:true})),innerBase=group.layers.add(new PaintLayer()),target=group.layers.add(new PaintLayer({clipped:true})),snapshot=doc.getSnapshot().document,before=doc.toJSON();
 const current=retouchViewDocument(snapshot,{mode:'current-layer',layerId:target.id});expect(current.children).toHaveLength(1);const isolated=current.children[0];expect(isolated.clipped).toBeUndefined();if(isolated.kind!=='group')throw new Error('Missing group');expect(isolated.children).toHaveLength(1);expect(isolated.children[0].clipped).toBeUndefined();
 const below=retouchViewDocument(snapshot,{mode:'current-and-below',layerId:target.id});expect(below.children.map(layer=>layer.id)).toEqual([base.id,group.id]);const scoped=below.children[1];if(scoped.kind!=='group')throw new Error('Missing group');expect(scoped.clipped).toBe(true);expect(scoped.children.map(layer=>layer.id)).toEqual([innerBase.id,target.id]);expect(scoped.children[1].clipped).toBe(true);expect(doc.toJSON()).toEqual(before);
});
it('SVG bakes clipping while supported Photoshop pixel records retain membership and private source pixels',()=>{
 const doc=new Document(),base=doc.layers.add(new VectorLayer()),clip=doc.layers.add(new PaintLayer({clipped:true})),later=doc.layers.add(new VectorLayer()),snapshot=doc.getSnapshot().document,svg=planSvgComposition(snapshot),psd=planPsdExport(snapshot);expect(svg.prefixes).toBe(1);expect(svg.document.svgNativePrefixes?.get(clip.id)?.map(layer=>layer.id)).toEqual([base.id,clip.id]);expect(svg.document.children.at(-1)?.id).toBe(later.id);expect(psd.mergedThrough).toBe(-1);expect(psd.layers.map(layer=>layer.clipped??false)).toEqual([false,true,false]);expect(psd.layers[1].document.children).toEqual([{...clip.toJSON(),clipped:undefined,opacity:1,blendMode:'normal',fillOpacity:1,mask:undefined,transform:{a:1,b:0,c:0,d:1,e:0,f:0}}]);expect(snapshot).toEqual(doc.getSnapshot().document);
});
