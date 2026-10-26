import {SCHEMA_VERSION as CURRENT_DOCUMENT_SCHEMA} from '../src/core/model';
import {beforeAll,expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {Document,RasterLayer,LayerGroup,SmartObjectLayer,FrequencyBandFilter,NativeCompositionFilter,DocumentToneFilter,AffineTransform,LayerMask,MarqueeSelection,EraserStroke,PaintFill} from '../src/dom';
import {instantiateKernel,applySpatialFilter,applyLinearBlend,applyEncodedFrequencyBand,type PixelKernel} from '../src/engine/wasm';
import {validateDocument,allLayers} from '../src/core/model';
import {parseCommands} from '../src/core/validation';
import {blendColors} from '../src/core/interchange/psd/blend';
import {smartFiltersSchema} from '../src/core/smart/filters';
import {PixelProcessor} from '../src/engine/processor';
let kernel:PixelKernel;
beforeAll(async()=>{kernel=await instantiateKernel(new Uint8Array(await readFile('public/wasm/pixels.wasm')));});
it('actual native bands and precision correction reconstruct straight RGB exactly',()=>{
 const source=new Uint8ClampedArray(35*19*4);let seed=743;for(let i=0;i<source.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;source[i]=seed>>>24;}const before=source.slice();
 for(const sigma of [0,.5,2,4]){
  const low=applySpatialFilter(kernel,source,35,19,{kind:'frequency-band',band:'low',sigmaX:sigma}),high=applySpatialFilter(kernel,source,35,19,{kind:'frequency-band',band:'high',sigmaX:sigma}),restored=applyLinearBlend(kernel,high,low);
  const correction=applySpatialFilter(kernel,source,35,19,{kind:'frequency-band',band:'correction',sigmaX:sigma}),exact=applyLinearBlend(kernel,correction,restored,1,'linear-burn');
  for(let i=0;i<source.length;i+=4){for(let c=0;c<3;c++)expect(exact[i+c]).toBe(source[i+c]);expect(low[i+3]).toBe(255);expect(high[i+3]).toBe(255);for(let c=0;c<3;c++){expect(high[i+c]).toBe(Math.round(127.5+(source[i+c]-low[i+c])/2));expect(Math.abs(restored[i+c]-source[i+c])).toBeLessThanOrEqual(1);}}
 }
 expect(source).toEqual(before);
});
it('actual WASM detail and correction reconstruct all 65,536 original/low byte pairs exactly',()=>{
 const source=new Uint8ClampedArray(256*256*4),low=new Uint8ClampedArray(source.length);
 for(let original=0;original<256;original++)for(let blurred=0;blurred<256;blurred++){
  const p=(original*256+blurred)*4;source.set([original,original,original,255],p);low.set([blurred,blurred,blurred,255],p);
 }
 const saved=source.slice(),base=low.slice(),detail=applyEncodedFrequencyBand(kernel,source,low,'high'),correction=applyEncodedFrequencyBand(kernel,source,low,'correction');
 expect(applyLinearBlend(kernel,correction,applyLinearBlend(kernel,detail,low),1,'linear-burn')).toEqual(saved);
 expect(source).toEqual(saved);expect(low).toEqual(base);
});
it('Linear Light and Linear Burn match independent source-over equations for partial alpha and opacity',()=>{
 for(const mode of ['linear-light','linear-burn'] as const)
 for(const sa of [0,1,64,128,255])for(const ba of [0,1,64,128,255])for(const opacity of [0,.5,1]){
  const source=new Uint8ClampedArray([220,24,64,sa]),backdrop=new Uint8ClampedArray([31,180,240,ba]);const out=applyLinearBlend(kernel,source,backdrop,opacity,mode),a=sa/255*opacity,b=ba/255,alpha=a+b-a*b;
  const expected=[0,1,2].map(c=>{const s=source[c]/255,d=backdrop[c]/255,v=Math.max(0,Math.min(1,d+(mode==='linear-light'?2*s:s)-1));return alpha?Math.round(255*(a*(1-b)*s+(1-a)*b*d+a*b*v)/alpha):0;});
  expect([...out]).toEqual([...expected,Math.round(alpha*255)]);expect([...source]).toEqual([220,24,64,sa]);expect([...backdrop]).toEqual([31,180,240,ba]);
 }
 expect(blendColors([.2,.5,.9],[.8,.5,.1],'linear-light')).toEqual([.8,.5,.10000000000000009]);
 expect(()=>applyLinearBlend(kernel,new Uint8ClampedArray(3),new Uint8ClampedArray(3))).toThrow();
});
it('worker helpers snapshot both planes and validate returned pixel type and extent',async()=>{
 const processor=Object.create(PixelProcessor.prototype) as PixelProcessor;
 let complete:(value:unknown)=>void=()=>{},payload:any,input:Uint8ClampedArray;
 Object.defineProperty(processor,'request',{value:(pixels:Uint8ClampedArray,value:unknown)=>{input=pixels;payload=value;return new Promise(resolve=>{complete=resolve;});}});
 for(const mode of ['high','correction'] as const){
  const source=new Uint8ClampedArray([37,41,43,255]),low=new Uint8ClampedArray([20,30,40,255]);
  const pending=processor.encodeFrequencyBand(source,low,mode);source.fill(0);low.fill(0);
  expect([...input!]).toEqual([37,41,43,255]);expect([...payload.frequencyEncoding.low]).toEqual([20,30,40,255]);
  complete(new Uint8ClampedArray([1,2,3,255]));expect([...await pending]).toEqual([1,2,3,255]);
 }
 for(const result of [new Uint8Array(4),new Uint8ClampedArray(8),null]){
  const pending=processor.linearBlend(new Uint8ClampedArray(4),new Uint8ClampedArray(4));complete(result);await expect(pending).rejects.toThrow(/worker result/);
  const encoded=processor.encodeFrequencyBand(new Uint8ClampedArray(4),new Uint8ClampedArray(4),'high');complete(result);await expect(encoded).rejects.toThrow(/worker result/);
  const filtered=processor.spatialFilter(new Uint8ClampedArray(4),1,1,{kind:'frequency-band',band:'low',sigmaX:1});complete(result);await expect(filtered).rejects.toThrow(/worker result/);
 }
});
it('strict filter constructors reject invalid records and isolate their snapshots',()=>{
 const filter=new FrequencyBandFilter();expect(filter.toJSON()).toMatchObject({kind:'frequency-band',sigma:4,band:'high',enabled:true});const dto=filter.toJSON();if(dto.kind!=='frequency-band')throw new Error();dto.sigma=1;expect(filter.toJSON()).toMatchObject({sigma:4});
 for(const options of [{sigma:null},{sigma:-1},{sigma:NaN},{sigma:1400},{band:'middle'},{extra:true},{enabled:null}])expect(()=>new FrequencyBandFilter(options as any)).toThrow();
 expect(new FrequencyBandFilter({band:'low',sigma:0}).toJSON()).toMatchObject({band:'low',sigma:0});expect(new NativeCompositionFilter().toJSON()).toMatchObject({kind:'native-composition',enabled:true});
 expect(new DocumentToneFilter().toJSON()).toMatchObject({kind:'document-tone',exposure:0,contrast:0,saturation:0});
 for(const options of [{contrast:101},{saturation:null},{exposure:Infinity},{kind:'document-tone'}])expect(()=>new DocumentToneFilter(options as any)).toThrow();
 const native=new NativeCompositionFilter().toJSON(),tone=new DocumentToneFilter().toJSON();
 expect(()=>smartFiltersSchema.parse([tone,native])).toThrow(/follow/);expect(()=>smartFiltersSchema.parse([{...tone,enabled:false},native])).toThrow(/follow/);
 expect(smartFiltersSchema.parse([native,tone])).toHaveLength(2);
});
it('raster erasure mask values retain ordered viewport geometry, clone independently and reject old schema labels',()=>{
 const clear=new PaintFill({bounds:{x:2,y:3,width:4,height:5},erase:true}),eraser=new EraserStroke({size:2,points:[{x:5,y:6}]});
 const mask=new LayerMask({rasterErasures:{width:40,height:20,operations:[{width:80,height:40,stroke:clear},{width:40,height:20,stroke:eraser}]}}),saved=mask.toJSON();
 const returned=mask.rasterErasures!;returned.width=2;returned.operations[0].stroke.toJSON().opacity=.2;expect(mask.toJSON()).toEqual(saved);
 expect(mask.with({density:.5}).toJSON()).toMatchObject({...saved,density:.5});
 const document=new Document(),layer=document.layers.add(new RasterLayer({assetId:'photo',width:40,height:20}));layer.mask=mask;
 expect(Document.fromJSON(document.toJSON()).layers.at(0)!.mask!.toJSON()).toEqual(saved);
 expect(()=>validateDocument({...document.toJSON(),schemaVersion:35})).toThrow(/schema version 36/);
 expect(()=>new LayerMask({rasterErasures:{width:40,height:20,operations:[{width:40,height:20,stroke:new PaintFill({bounds:{x:0,y:0,width:2,height:2},color:'#ff0000'})}]}})).toThrow();
});
it('OO assembly keeps source and appearance, shares editable native masters, and commits in one reversible transaction',()=>{
 const doc=new Document(),parent=doc.layers.add(new LayerGroup()),source=parent.layers.add(new RasterLayer({assetId:'original',width:40,height:20,name:'Photo',opacity:.7}));source.transform=new AffineTransform(1,.2,.1,1,7,11);source.mask=new LayerMask({selection:new MarqueeSelection({shape:'ellipse',x:0,y:0,width:40,height:20})});
 const snapshot=doc.layers.add(new RasterLayer({assetId:'captured',width:80,height:40}));snapshot.transform=AffineTransform.scale(.5,.5);const before=doc.toJSON(),history=doc.getSnapshot().past.length;
 const group=doc.createFrequencySeparation(source,snapshot,{sigma:2});expect(doc.getSnapshot().past.length).toBe(history+1);expect(source.visible).toBe(false);expect(snapshot.isAttached).toBe(false);expect(group.transform.toJSON()).toEqual(source.transform.toJSON());expect(group.mask!.toJSON()).toEqual(source.mask!.toJSON());expect(group.opacity).toBe(.7);
 const composite=doc.getLayer(allLayers([group.toJSON()]).find(n=>n.kind==='smart-object')!.id) as SmartObjectLayer;expect(composite.smartFilters[0].kind).toBe('native-composition');const contents=composite.editContents(),nodes=allLayers(contents.toJSON().children);expect(nodes.some(n=>n.name==='Color retouch')).toBe(true);expect(nodes.some(n=>n.name==='Detail retouch')).toBe(true);expect(nodes.filter(n=>n.kind==='smart-object')).toHaveLength(3);
 const after=doc.toJSON();expect(after.schemaVersion).toBe(CURRENT_DOCUMENT_SCHEMA);expect(Document.fromJSON(after).toJSON()).toEqual(after);doc.undo();expect(doc.toJSON()).toEqual(before);doc.redo();expect(doc.toJSON()).toEqual(after);
});
it('schema age and external commands reject unsupported frequency records, including embedded masters',()=>{
 const doc=new Document(),master=new Document();master.layers.add(new RasterLayer({assetId:'original',width:32,height:32}));const id=doc.defineComponent(master),instance=doc.placeSmartObject(id);instance.setFilters([new FrequencyBandFilter()]);const saved=doc.toJSON();expect(()=>validateDocument({...saved,schemaVersion:35})).toThrow(/schema version 36/);
 const outer=new Document();outer.defineComponent(master,{id});const outerId=outer.defineComponent(doc);outer.placeSmartObject(outerId);const embedded=outer.toJSON();(embedded.components!.find(d=>d.id===outerId)!.source as any).document.schemaVersion=35;expect(()=>validateDocument(embedded)).toThrow(/schema version 36/);
 expect(()=>parseCommands([{type:'smartObject.filters',id:instance.id,filters:[{...new FrequencyBandFilter().toJSON(),band:'other'}]}])).toThrow();
 const plain=new Document();plain.layers.add(new RasterLayer({assetId:'a',width:1,height:1,blendMode:'linear-light'}));expect(()=>validateDocument({...plain.toJSON(),schemaVersion:35})).toThrow(/schema version 36/);
});
it('invalid snapshots, foreign layers and locked ancestry cannot partially create a workflow',()=>{
 const doc=new Document(),parent=doc.layers.add(new LayerGroup()),source=parent.layers.add(new RasterLayer({assetId:'original',width:40,height:20})),snapshot=doc.layers.add(new RasterLayer({assetId:'captured',width:80,height:40}));
 const before=doc.getSnapshot();expect(()=>doc.createFrequencySeparation(source,source)).toThrow();expect(doc.getSnapshot()).toBe(before);
 expect(()=>doc.createFrequencySeparation(source,snapshot,{sigma:-1})).toThrow();expect(doc.getSnapshot()).toBe(before);
 parent.locked=true;const locked=doc.getSnapshot();expect(()=>doc.createFrequencySeparation(source,snapshot)).toThrow(/lock/);expect(doc.getSnapshot()).toBe(locked);
});
