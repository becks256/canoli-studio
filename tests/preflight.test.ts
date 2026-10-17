import {expect,it} from 'vitest';
import {Document,RasterLayer,TextLayer,LayerGroup,AffineTransform,SmartObjectLayer,VectorLayer,VectorPath,PaintLayer,BrushStroke} from '../src/dom';
import {inspectDesign,preflightOptionsSchema,preflightReportSchema,preflightAssetMetadataSchema} from '../src/core/preflight';
import {exportFontFamilies} from '../src/core/font-references';
const metadata=new Map([['source',{width:100,height:100}]]);

it('checks original sampling and authored bounds without mutating content, history or selection',async()=>{
  const document=new Document({width:200,height:100}),layer=document.layers.add(new RasterLayer({name:'Photo',assetId:'source',width:300,height:100,x:-20}));document.selectedLayer=layer;
  const before=document.toJSON(),state=document.getSnapshot();
  const report=await inspectDesign(before,state.revision,{outputDpi:300,minimumPpi:150},{assets:metadata});
  expect(report.findings.map(f=>f.code)).toEqual(['bounds-outside','low-resolution']);expect(report.findings[1].effectivePpi).toBeCloseTo(100,10);
  expect(report.findings[0].layerId).toBe(layer.id);expect(document.toJSON()).toEqual(before);expect(document.getSnapshot()).toBe(state);
});

it('uses the worst singular direction under shear, rotation and nested group scaling',async()=>{
  const document=new Document({width:2000,height:2000}),group=document.layers.add(new LayerGroup({name:'Group'}));group.transform=AffineTransform.rotation(Math.PI/2).multiply(AffineTransform.scale(2));
  const layer=group.layers.add(new RasterLayer({name:'Sheared',assetId:'source',width:100,height:100}));layer.transform=new AffineTransform(1,0,1,1,0,0);
  const report=await inspectDesign(document.toJSON(),0,{outputDpi:300,minimumPpi:100,checkBounds:false},{assets:metadata});
  expect(report.findings).toHaveLength(1);expect(report.findings[0].effectivePpi).toBeCloseTo(92.70509831248422,9);expect(report.findings[0].layerName).toBe('Group / Sheared');
});

it('retains sufficient native sampling through nonuniform placement and pure rotation',async()=>{
  const document=new Document({width:1000,height:1000}),layer=document.layers.add(new RasterLayer({assetId:'source',width:100,height:100,x:100,y:100}));layer.transform=AffineTransform.translation(100,100).multiply(AffineTransform.rotation(Math.PI/3));
  const report=await inspectDesign(document.toJSON(),0,{outputDpi:300,minimumPpi:300},{assets:new Map([['source',{width:200,height:100}]])});expect(report.findings).toEqual([]);
});

it('skips hidden subtrees by default, with explicit inclusion covering their fonts and geometry',async()=>{
  const document=new Document(),group=document.layers.add(new LayerGroup({visible:false}));group.layers.add(new TextLayer({fontFamily:'Hidden family',x:-30}));
  expect((await document.preflight()).layersChecked).toBe(0);expect(exportFontFamilies(document.toJSON())).toEqual([]);
  expect(exportFontFamilies(document.toJSON(),true)).toEqual(['Hidden family']);const report=await document.preflight({includeHidden:true});expect(report.layersChecked).toBe(2);expect(report.findings.map(f=>f.code)).toEqual(['bounds-outside','font-unchecked']);
});

it('maps embedded findings to each root instance and uses its actual placed sampling',async()=>{
  const document=new Document({width:2000,height:2000}),master=new Document({width:100,height:100});master.layers.add(new RasterLayer({name:'Picture',assetId:'source',width:100,height:100}));master.layers.add(new TextLayer({name:'Label',fontFamily:'Studio Missing Font',x:-50}));
  const component=document.defineComponent(master),first=document.layers.add(new SmartObjectLayer({name:'Small',componentId:component,width:100,height:100})),second=document.layers.add(new SmartObjectLayer({name:'Large',componentId:component,width:400,height:400,x:1000}));
  const report=await inspectDesign(document.toJSON(),0,{outputDpi:300,minimumPpi:150},{assets:metadata,fonts:new Map([['studio missing font','unavailable']])});
  expect(report.findings.filter(f=>f.code==='low-resolution').map(f=>f.layerId)).toEqual([second.id]);
  expect(report.findings.filter(f=>f.code==='font-unavailable').map(f=>f.layerId)).toEqual([first.id,second.id]);expect(report.findings.some(f=>f.code==='bounds-outside')).toBe(false);
  expect(report.findings.find(f=>f.layerId===second.id&&f.code==='font-unavailable')!.path).toEqual([second.id,master.layers.at(1)!.id]);
});

it('distinguishes an unavailable asset repository from a missing referenced original',async()=>{
  const document=new Document();document.layers.add(new RasterLayer({assetId:'absent',width:20,height:20}));
  expect((await document.preflight()).findings[0].code).toBe('asset-unchecked');
  const report=await inspectDesign(document.toJSON(),0,{}, {assets:new Map()});expect(report.findings[0].code).toBe('asset-missing');expect(report.counts.error).toBe(1);
  await expect(inspectDesign(document.toJSON(),0,{}, {assets:new Map([['absent',{width:0,height:2}]])})).rejects.toThrow('source dimensions');
});

it('font evidence never upgrades unknown to missing or available, and disabled checks are explicit',async()=>{
  const document=new Document();for(const fontFamily of ['Available','Unavailable','Unknown'])document.layers.add(new TextLayer({fontFamily}));
  const env={fonts:new Map([['available','available'],['unavailable','unavailable'],['unknown','unknown']] as const)};
  const report=await inspectDesign(document.toJSON(),0,{},env);expect(report.findings.map(f=>[f.code,f.severity])).toEqual([['font-unavailable','warning'],['font-unchecked','info']]);
  expect((await inspectDesign(document.toJSON(),0,{checkFonts:false},env)).fonts).toEqual([]);
});

it('retains complete finding counts when the displayed report is truncated',async()=>{
  const document=new Document(),master=new Document();for(let i=0;i<32;i++)master.layers.add(new TextLayer({fontFamily:'Missing'}));const component=document.defineComponent(master);for(let i=0;i<32;i++)document.layers.add(new SmartObjectLayer({componentId:component,width:100,height:100}));
  const report=await document.preflight();expect(report.totalFindings).toBe(1024);expect(report.findings).toHaveLength(512);expect(report.truncated).toBe(true);expect(report.counts.info).toBe(1024);expect(report.layersChecked).toBe(1056);
  expect(()=>preflightReportSchema.parse({...report,totalFindings:512})).toThrow();
});

it('large document geometry is independent of analysis allocation and source-resolution policy',async()=>{
  const document=new Document({width:10000,height:5000});document.layers.add(new RasterLayer({assetId:'large',width:10000,height:5000}));
  const report=await inspectDesign(document.toJSON(),0,{}, {assets:new Map([['large',{width:10000,height:5000}]])});expect(report.findings).toEqual([]);expect(report.layersChecked).toBe(1);
});

it('strict policy/metadata validation rejects malformed external inputs',async()=>{
  for(const options of [{outputDpi:0},{minimumPpi:-1},{outputDpi:Infinity},{checkFonts:'yes'},{fakeAI:true}])expect(()=>preflightOptionsSchema.parse(options)).toThrow();
  expect(()=>preflightAssetMetadataSchema.parse([{id:'x',width:NaN,height:1}])).toThrow();
  expect(()=>preflightAssetMetadataSchema.parse([{id:'x',width:1,height:1,pixels:[1,2,3]}])).toThrow();
});

it('OO reports bind the exact document/revision/policy and reject late or mismatched results',async()=>{
  const document=new Document(),base=await document.preflight();
  document._preflight=async()=>({...base,documentId:'another'});await expect(document.preflight()).rejects.toThrow('do not match');
  document._preflight=async()=>({...base,options:preflightOptionsSchema.parse({minimumPpi:300})});await expect(document.preflight()).rejects.toThrow('do not match');
  document._preflight=async()=>{document.name='Changed';return base;};await expect(document.preflight()).rejects.toThrow('document changed');
});

it('abort and operation budgets reject without changing the document',async()=>{
  const document=new Document(),before=document.toJSON(),abort=new AbortController();abort.abort(new Error('User cancelled'));await expect(document.preflight({}, {signal:abort.signal})).rejects.toThrow('User cancelled');expect(document.toJSON()).toEqual(before);
  const master=new Document();for(let i=0;i<64;i++)master.layers.add(new TextLayer());const component=document.defineComponent(master);for(let i=0;i<64;i++)document.layers.add(new SmartObjectLayer({componentId:component,width:100,height:100}));
  const snapshot=document.getSnapshot();await expect(document.preflight()).rejects.toThrow('inspection budget');expect(document.getSnapshot()).toBe(snapshot);
});


it('checks authored vector and paint geometry without mutating their paths or claiming rendered-mask visibility',async()=>{
  const document=new Document({width:100,height:100}),vector=document.layers.add(new VectorLayer({name:'Shape'}));vector.paths.add(VectorPath.rectangle({x:-10,y:10,width:40,height:40}));
  const paint=document.layers.add(new PaintLayer({name:'Brush'}));paint.strokes.add(new BrushStroke({size:10,points:[{x:95,y:50,pressure:1},{x:110,y:50,pressure:1}]}));
  const before=document.toJSON(),report=await document.preflight({checkFonts:false});expect(report.findings.filter(f=>f.code==='bounds-outside').map(f=>f.layerId)).toEqual([vector.id,paint.id]);expect(document.toJSON()).toEqual(before);expect(report.limitations.join(' ')).toContain('not rendered pixels');
});

it('extreme finite placements report unmeasurable geometry instead of emitting non-finite JSON',async()=>{
  const document=new Document(),layer=document.layers.add(new RasterLayer({assetId:'source',width:100,height:100}));const snapshot=document.toJSON(),node=snapshot.children[0];node.transform={a:1e308,b:0,c:0,d:1e308,e:0,f:0};
  const report=await inspectDesign(snapshot,0,{}, {assets:new Map([['source',{width:1,height:1}]])});expect(report.findings.every(f=>f.code==='measurement-unavailable')).toBe(true);expect(report.findings.length).toBeGreaterThan(0);expect(()=>JSON.stringify(report)).not.toThrow();expect(layer.toJSON().transform).toBeUndefined();
});

it('inspection payloads exclude heavy selections, effects and pixel masks while retaining the same report',async()=>{
  const {preflightDocumentView}=await import('../src/core/preflight-view');
  const document=new Document();document.layers.add(new RasterLayer({assetId:'source',width:100,height:100}));
  const snapshot=document.toJSON(),expected=await inspectDesign(snapshot,0,{}, {assets:metadata});
  Object.defineProperty(snapshot,'selection',{enumerable:true,get(){throw new Error('Heavy selection was read');}});
  Object.defineProperty(snapshot.children[0],'effects',{enumerable:true,get(){throw new Error('Heavy effect table was read');}});
  Object.defineProperty(snapshot.children[0],'mask',{enumerable:true,get(){throw new Error('Pixel mask was read');}});
  const view=structuredClone(preflightDocumentView(snapshot));expect(await inspectDesign(view,0,{}, {assets:metadata})).toEqual(expected);
});
