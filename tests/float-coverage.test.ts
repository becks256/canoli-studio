import{expect,it}from'vitest';
import{applyFloatCoverage}from'../src/engine/float-coverage';
import{Document,RasterLayer,EraserStroke,MarqueeSelection,LayerGroup,BrushStroke,WetPaintStroke}from'../src/dom';
it('erasure preserves every RGB word and rounds each authored alpha operation independently',async()=>{
 const input=new Float32Array([2.125,-.125,.123456789,.375]),original=input.slice(),coverage=new Float32Array([127/255]);const once=await applyFloatCoverage(input,coverage,()=>{}),twice=await applyFloatCoverage(once,coverage,()=>{});expect([...twice.subarray(0,3)]).toEqual([...input.subarray(0,3)]);expect(twice[3]).toBe(Math.fround(Math.fround(.375*coverage[0])*coverage[0]));expect(twice[3]).not.toBe(Math.fround(.375*63/255));expect(input).toEqual(original);expect(coverage[0]).toBe(Math.fround(127/255));
});
it('coverage validates owned geometry and cancellation without changing inputs',async()=>{
 const p=new Float32Array([1,2,3,.5]);for(const c of[new Float32Array(2),new Float32Array([NaN]),new Float32Array([-1])])await expect(applyFloatCoverage(p,c,()=>{})).rejects.toThrow('coverage');await expect(applyFloatCoverage(p,new Float32Array([1]),()=>{throw Error('Cancelled erasure');})).rejects.toThrow('Cancelled');expect([...p]).toEqual([1,2,3,.5]);
});
it('float erasure and clear use shared locks, atomic history and captured resize geometry',()=>{
 const doc=new Document({precision:'float32'}),group=doc.layers.add(new LayerGroup()),layer=group.layers.add(new RasterLayer({assetId:'original',width:100,height:80})),before=doc.toJSON();doc.transaction('Erase float artwork',()=>{layer.erase(new EraserStroke({points:[{x:25,y:30}],size:20,opacity:.375}));layer.clear(new MarqueeSelection({shape:'rectangle',x:10,y:5,width:20,height:15}));});const after=doc.toJSON();expect((after.children[0]as any).children[0].erasures).toHaveLength(2);doc.undo();expect(doc.toJSON()).toEqual(before);doc.redo();expect(doc.toJSON()).toEqual(after);layer.width=200;expect((layer.toJSON()as any).erasures[0].width).toBe(100);group.locked=true;expect(()=>layer.clear()).toThrow();
});

it('float transactions reject prepared byte-color replacements without publishing preceding alpha or opacity edits',()=>{
 const doc=new Document({precision:'float32'}),layer=doc.layers.add(new RasterLayer({assetId:'original',width:10,height:10})),before=doc.toJSON(),revision=doc.getSnapshot().revision,wet=new WetPaintStroke({brush:new BrushStroke({points:[{x:2,y:2}]}),tiles:[{x:0,y:0,width:1,height:1,assetId:'byte-color',coverage:{assetId:'coverage'}}]});expect(()=>doc.transaction('Unsupported float replacement',()=>{layer.opacity=.5;layer.clear();layer.applyWetPaint(wet);})).toThrow('Prepared wet');expect(doc.toJSON()).toEqual(before);expect(doc.getSnapshot().revision).toBe(revision);
});
