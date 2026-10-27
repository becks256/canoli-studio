import{it,expect}from'vitest';
import{Document,RasterLayer,LayerGroup,ToneAdjustment,PaintLayer,AdjustmentLayer}from'../src/dom';
import{SCHEMA_VERSION,validateDocument}from'../src/core/model';
import{parseCommands}from'../src/core/validation';
it('float precision is versioned OO document state with an atomic shared command and exact Undo',()=>{
 const document=new Document({width:131,height:79}),group=new LayerGroup({name:'Originals'}),layer=new RasterLayer({assetId:'original-float',width:131,height:79});layer.adjustments.add(new ToneAdjustment({exposure:1.25}));group.layers.add(layer);document.layers.add(group);const before=document.toJSON();document.convertToFloat();expect(document.precision).toBe('float32');expect(document.workingSpace).toBe('linear-srgb');expect(document.toJSON().schemaVersion).toBe(SCHEMA_VERSION);const converted=document.toJSON(),revision=document.getSnapshot().revision;document.convertToFloat();expect(document.getSnapshot().revision).toBe(revision);layer.opacity=.5;document.undo();expect(document.toJSON()).toEqual(converted);document.undo();expect(document.toJSON()).toEqual(before);document.redo();expect(document.toJSON()).toEqual(converted);expect(Document.fromJSON(converted).toJSON()).toEqual(converted);
});
it('float constructor and old schema validation reject contradictory precision interpretations',()=>{
 const float=new Document({precision:'float32'}).toJSON();expect(float.colorSpace).toBe('linear-srgb');expect(()=>validateDocument({...float,schemaVersion:48})).toThrow('49');expect(()=>validateDocument({...float,colorSpace:'srgb'})).toThrow('precision');expect(()=>validateDocument({...float,precision:undefined})).toThrow('precision');expect(()=>new Document({precision:'uint16' as any})).toThrow('uint8 or float32');const byte=new Document();expect(byte.precision).toBe('uint8');expect(byte.workingSpace).toBe('srgb');expect(byte.toJSON().precision).toBeUndefined();
});
it('unsupported operations and mixed transactions reject before changing a float document or its history',()=>{
 const document=new Document({precision:'float32'}),raster=new RasterLayer({assetId:'float-original',width:10,height:10});document.layers.add(raster);const before=document.toJSON(),revision=document.getSnapshot().revision;
 expect(()=>document.layers.add(new PaintLayer())).toThrow('Other layer types');expect(()=>{raster.blendMode='multiply';}).toThrow('Other blend modes');expect(()=>document.transaction('Unsupported float edit',()=>{raster.opacity=.25;document.layers.add(new PaintLayer());})).toThrow();expect(document.toJSON()).toEqual(before);expect(document.getSnapshot().revision).toBe(revision);
});
it('conversion gates unsupported legacy content and wire commands remain strict',()=>{
 const document=new Document();document.layers.add(new PaintLayer());const before=document.toJSON();expect(()=>document.convertToFloat()).toThrow('Other layer types');expect(document.toJSON()).toEqual(before);expect(parseCommands([{type:'document.precision.float'}])).toEqual([{type:'document.precision.float'}]);expect(()=>parseCommands([{type:'document.precision.float',force:true}])).toThrow();
});

it('float tone parameters share ordinary OO transactions, strict limits and exact Undo',()=>{
 const document=new Document({precision:'float32'}),raster=new RasterLayer({assetId:'float-original',width:10,height:10});document.layers.add(raster);const before=document.toJSON();document.transaction('Linear tone',()=>{raster.adjustments.add(new ToneAdjustment({exposure:.5,contrast:35,saturation:-60}));document.layers.add(new AdjustmentLayer({adjustment:{kind:'tone',exposure:-1,contrast:-20,saturation:25}}));});const after=document.toJSON();document.undo();expect(document.toJSON()).toEqual(before);document.redo();expect(document.toJSON()).toEqual(after);expect(()=>raster.adjustments.add(new ToneAdjustment({contrast:101}))).toThrow();expect(document.toJSON()).toEqual(after);
});
