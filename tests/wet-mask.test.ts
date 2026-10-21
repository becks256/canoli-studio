import {expect,it} from 'vitest';
import {Document,PaintLayer,PaintFill,LayerGroup,LayerMask,BrushStroke,PencilStroke,WetPaintStroke,BrushTexture,VectorPath,MarqueeSelection} from '../src/dom';
import {maskOperationSchema,maskStrokePointCount,maskStrokesSchema} from '../src/core/masks';
import {SCHEMA_VERSION,referencedAssets,validateDocument} from '../src/core/model';
import {freeze} from '../src/core/immutable';
import {remapLayerAssets} from '../src/core/asset-references';
import {wetDocumentOperations,validateWetPaintAssets,type WetAssetProvider} from '../src/core/wet-assets';
import {encodeRgbaPng} from '../src/engine/png';
import {planSvgMasks} from '../src/core/svg-masks';
import {hasWetMask} from '../src/engine/wet-mask';

const wet=()=>new WetPaintStroke({brush:new PencilStroke({points:[{x:2.5,y:3.5,pressure:1}],texture:new BrushTexture({assetId:'tip'})}),tiles:[{x:2,y:3,width:1,height:1,assetId:'output',coverage:{assetId:'coverage'}}]});
const mask=()=>new LayerMask({base:1,density:.6,inverted:true,feather:3,x:8,y:9,linked:false});

it('appends immutable prepared coverage between ordinary strokes and preserves mask settings and owned metadata',()=>{
 const before=mask().paint(new BrushStroke({points:[{x:0,y:0,pressure:1}]}),'hide'),value=wet();
 const after=before.applyWetPaint(value).paint(new BrushStroke({points:[{x:1,y:1,pressure:1}]}),'reveal');
 expect(before.strokes).toHaveLength(1);expect(after.strokes.map(entry=>entry.mode)).toEqual(['hide','wet','reveal']);
 expect(after.toJSON()).toMatchObject({base:1,density:.6,inverted:true,feather:3,x:8,y:9,linked:false});
 const data=after.toJSON();data.strokes![1].stroke.opacity=0;expect(after.strokes[1].stroke.opacity).toBe(1);
 expect(LayerMask._fromJSON(after.toJSON()).toJSON()).toEqual(after.toJSON());expect(maskStrokePointCount(after.toJSON().strokes![1])).toBe(1);
 expect(()=>before.applyWetPaint(new BrushStroke({points:[{x:0,y:0,pressure:1}]}) as unknown as WetPaintStroke)).toThrow(/WetPaintStroke/);
});

it('preserves each geometry and prepared coverage order through mask value reconstruction',()=>{
 const shape=new VectorPath({points:[{x:0,y:0},{x:8,y:0},{x:8,y:8}],closed:true});
 const values=[mask(),new LayerMask({assetId:'source'}),new LayerMask({paths:[shape]}),new LayerMask({selection:new MarqueeSelection({regions:[{x:0,y:0,width:8,height:8,shape:'rectangle',operation:'add'}]})})];
 for(const input of values){const result=input.applyWetPaint(wet());expect(LayerMask._fromJSON(result.toJSON()).toJSON()).toEqual(result.toJSON());expect(input.strokes).toHaveLength(0);expect(result.kind).toBe(input.kind);}
});

it('routes mask assignment through one undo and retains native output, coverage and nested original texture references',()=>{
 const doc=new Document({width:16,height:16}),group=doc.layers.add(new LayerGroup()),layer=group.layers.add(new PaintLayer());
 layer.mask=mask();const before=doc.toJSON(),revision=doc.getSnapshot().revision;layer.mask=layer.mask!.applyWetPaint(wet());const saved=doc.toJSON();
 expect(doc.getSnapshot().revision).toBe(revision+1);expect([...referencedAssets(saved)].sort()).toEqual(['coverage','output','tip']);
 const copy=layer.toJSON();remapLayerAssets(copy,new Map([['coverage','coverage2'],['output','output2'],['tip','tip2']]));
 const clone=new Document({width:16,height:16});clone.layers.add(PaintLayer._fromData(copy));expect([...referencedAssets(clone.toJSON())].sort()).toEqual(['coverage2','output2','tip2']);
 doc.undo();expect(doc.toJSON()).toEqual(before);doc.redo();expect(doc.toJSON()).toEqual(saved);
});

it('enforces schema 34 for wet ordinary and filter masks outside immutable validation proofs',()=>{
 expect(SCHEMA_VERSION).toBe(38);const doc=new Document({width:16,height:16}),layer=doc.layers.add(new PaintLayer());layer.mask=mask().applyWetPaint(wet());
 const current=freeze(doc.toJSON());validateDocument(current);expect(()=>validateDocument({...current,schemaVersion:33})).toThrow(/schema version 34/);
 const master=new Document({width:16,height:16});master.layers.add(new PaintLayer());const owner=new Document({width:16,height:16}),instance=owner.placeSmartObject(owner.defineComponent(master));instance.filterMask=mask().applyWetPaint(wet());
 const prepared=freeze(owner.toJSON());validateDocument(prepared);expect(()=>validateDocument({...prepared,schemaVersion:33})).toThrow(/schema version 34/);
});

it('enforces discriminated operation types and shared point budgets without tile-count caps',()=>{
 const value=wet().toJSON();expect(maskOperationSchema.parse({mode:'wet',stroke:value})).toEqual({mode:'wet',stroke:value});
 for(const input of [{mode:'hide',stroke:value},{mode:'wet',stroke:new BrushStroke({points:[{x:0,y:0,pressure:1}]}).toJSON()},{mode:'wet',stroke:value,extra:true}])expect(()=>maskOperationSchema.parse(input)).toThrow();
 const brush=new BrushStroke({points:Array.from({length:20000},(_,x)=>({x,y:0,pressure:1}))}),large=new WetPaintStroke({...value,brush});
 expect(maskStrokePointCount({mode:'wet',stroke:large.toJSON()})).toBe(20000);expect(()=>maskStrokesSchema.parse(Array.from({length:11},()=>({mode:'wet',stroke:large.toJSON()})))).toThrow(/200,000/);
});

it('discovers prepared coverage in groups, filter masks and embedded masters for host native alpha validation',async()=>{
 const output=await encodeRgbaPng(new Uint8Array([255,255,255,128]),1,1),coverage=await encodeRgbaPng(new Uint8Array([255,255,255,255]),1,1),doc=new Document({width:16,height:16}),group=doc.layers.add(new LayerGroup()),layer=group.layers.add(new PaintLayer());layer.mask=mask().applyWetPaint(wet());
 const master=new Document({width:16,height:16}),inside=master.layers.add(new PaintLayer());inside.mask=mask().applyWetPaint(wet());const instance=doc.placeSmartObject(doc.defineComponent(master));instance.filterMask=mask().applyWetPaint(wet());
 expect([...wetDocumentOperations(doc.toJSON())]).toHaveLength(3);
 const provider:WetAssetProvider={get:id=>({blob:id==='output'?output:coverage,width:1,height:1}),async *alpha(source){yield new Uint8Array([source.blob===output?128:255]);}};
 await expect(validateWetPaintAssets(doc.toJSON(),provider)).resolves.toBeUndefined();
 const bad:WetAssetProvider={...provider,async *alpha(source){yield new Uint8Array([source.blob===output?255:128]);}};
 // New identity objects force actual validation rather than borrowing an older proof.
 const images=new Map([['output',{blob:output,width:1,height:1,pixels:{}}],['coverage',{blob:coverage,width:1,height:1,pixels:{}}]]);bad.get=id=>images.get(id)!;
 await expect(validateWetPaintAssets(doc.toJSON(),bad)).rejects.toThrow(/already be masked/);
});

it('zero-opacity metadata stays retained while bypassing native mask reconstruction',()=>{
 const zero=new WetPaintStroke({...wet().toJSON(),opacity:0}),value=mask().applyWetPaint(zero);expect(hasWetMask(value.toJSON())).toBe(false);expect(value.strokes).toHaveLength(1);
});

it('rejects falsely old wet coverage in embedded masters and retained future history',()=>{
 const master=new Document({width:16,height:16});master.layers.add(new PaintLayer()).mask=mask().applyWetPaint(wet());
 const owner=new Document({width:16,height:16});owner.placeSmartObject(owner.defineComponent(master));const raw=owner.toJSON(),source=raw.components![0].source;if(source.kind!=='document')throw new Error('Expected editable master');source.document.schemaVersion=33;
 expect(()=>validateDocument(freeze(raw))).toThrow(/schema version 34/);
 const doc=new Document({width:16,height:16}),layer=doc.layers.add(new PaintLayer());layer.mask=mask().applyWetPaint(wet());doc.undo();const state=doc.getSnapshot(),future=structuredClone(state.future);future[0].document.schemaVersion=33;
 expect(()=>Document._fromWorkspace(state.document,{version:1,past:state.past,future})).toThrow(/schema version 34/);
});
it('inert prepared vector refinements retain original references without selecting raster SVG coverage',()=>{
 const doc=new Document({width:16,height:16}),layer=doc.layers.add(new PaintLayer());layer.strokes.add(new PaintFill({bounds:{x:0,y:0,width:16,height:16},color:'#ff0000'}));
 const zero=new WetPaintStroke({...wet().toJSON(),opacity:0});layer.mask=new LayerMask({paths:[new VectorPath({points:[{x:0,y:0},{x:8,y:0},{x:8,y:8}],closed:true})]}).applyWetPaint(zero);
 const plans=planSvgMasks(doc.toJSON());expect(plans).toHaveLength(1);expect(plans[0].vector).toBe(true);expect([...referencedAssets(doc.toJSON())].sort()).toEqual(['coverage','output','tip']);
});
