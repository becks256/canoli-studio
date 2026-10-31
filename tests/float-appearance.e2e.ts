import{test,expect}from'@playwright/test';
import{readFile,writeFile}from'node:fs/promises';

test('retained mask geometry and native grid changes invalidate appearance while unchanged linked moves still reuse it', async ({page}, info) => {
 await page.goto('/'); await page.waitForFunction(() => !!window.luma?.editor);
 const result = await page.evaluate(async bytes => {
  const {editor, Document, LayerMask, MaskPlane, MarqueeSelection, PerspectiveTransform, AffineTransform} = window.luma;
  const {CanvasRenderer} = await import(/* @vite-ignore */ String('/src/engine/renderer.ts'));
  await editor.openTiff(new File([new Uint8Array(bytes)], 'Retained appearance original.tif', {type: 'image/tiff'}), {editingPrecision: 'float32'});
  const document = Document.fromJSON(editor.document.toJSON()), layer = document.layers.at(0)!, cached = new CanvasRenderer(), reference = new CanvasRenderer();
  let calls = 0; const composite = cached.processor.floatComposite.bind(cached.processor);
  cached.processor.floatComposite = async (...args: Parameters<typeof composite>) => {calls++; return composite(...args);};
  const rows: {name: string; differences: number; nativeCalls: number; visible: number}[] = [];
  const pixels: {name: string; actual: number[]; expected: number[]}[] = [];
  const compare = async (name: string) => {
   const start = calls, model = document.toJSON(), a: HTMLCanvasElement = await cached.render(model, editor.assetStore, {readback: true}), b: HTMLCanvasElement = await reference.render(model, editor.assetStore, {cache: false, readback: true});
   try {
    const actual = a.getContext('2d')!.getImageData(0, 0, 131, 79).data, expected = b.getContext('2d')!.getImageData(0, 0, 131, 79).data;
    rows.push({name, differences: actual.reduce((n, v, i) => n + Number(v !== expected[i]), 0), nativeCalls: calls - start,
     visible: expected.filter((v, i) => i % 4 === 3 && v > 0).length});
    pixels.push({name, actual: [...actual], expected: [...expected]});
    return [...expected];
   } finally {a.width = a.height = b.width = b.height = 0;}
  };
  const replacePlane = (patch: Partial<ConstructorParameters<typeof MaskPlane>[0]>) => {
   const plane = layer.mask!.plane!;
   layer.mask = layer.mask!.with({plane: new MaskPlane({reference: plane.reference, basis: plane.basis, pose: plane.pose, phase: plane.phase, steps: plane.steps, ...patch})});
  };
  try {
   layer.mask = new LayerMask({selection: new MarqueeSelection({shape: 'rectangle', x: 20, y: 10, width: 60, height: 40})});
   const initial = await compare('legacy rectangle cold');
   layer.setMaskLinked(false);
   layer.perspective = new PerspectiveTransform({corners: [{x: 0, y: 0}, {x: 1, y: 0}, {x: .5, y: .5}, {x: 0, y: .5}]});
   layer.setMaskLinked(true); layer.perspective = null;
   const retained = await compare('reset perspective after independent mask linkage');
   replacePlane({basis: AffineTransform.rotation(.13)}); await compare('retained basis edit');
   replacePlane({pose: {...layer.mask!.plane!.pose, transform: AffineTransform.translation(3.25, -1.5)}}); await compare('retained pose edit');
   await compare('unchanged retained repeat');
   document.name = 'Metadata only'; await compare('unrelated name');
   layer.x = 12; layer.y = -3; await compare('integer linked move');
   const grid = async (size: number) => {
    const canvas = new OffscreenCanvas(size, size); canvas.getContext('2d')!.fillRect(0, 0, size, size);
    return editor.assetStore.add(await canvas.convertToBlob(), 'Geometry-only grid', 'appearance-grid', false);
   };
   await grid(8); replacePlane({reference: {assetId: 'appearance-grid'}}); await compare('geometry asset reference');
   editor.assetStore.remove('appearance-grid'); await grid(16); await compare('same geometry ID new native dimensions');
   await compare('unchanged new geometry grid');
   return {rows, pixels, changedFromLegacy: initial.some((v, i) => v !== retained[i])};
  } finally {cached.dispose(); reference.dispose();}
 }, [...await readFile('tests/fixtures/tiff-float/rgba-raw-le.tif')]);
 for (const row of result.pixels) for (const mode of ['actual', 'expected'] as const)
  await writeFile(info.outputPath(row.name.replace(/\W+/g, '-') + '-' + mode + '.rgba8'), new Uint8Array(row[mode]));
 await writeFile(info.outputPath('retained-appearance.json'), JSON.stringify({rows: result.rows, changedFromLegacy: result.changedFromLegacy}, null, 2));
 expect(result.changedFromLegacy).toBe(true);
 for (const row of result.rows) {
  expect(row.differences, row.name).toBe(0); expect(row.visible, row.name).toBeGreaterThan(0);
  if (['unchanged retained repeat', 'unrelated name', 'integer linked move', 'unchanged new geometry grid'].includes(row.name)) expect(row.nativeCalls, row.name).toBe(0);
  else expect(row.nativeCalls, row.name).toBeGreaterThan(0);
 }
});

test('native appearance reuse keeps entering edges, hidden source color and all displayed channels exact',async({page},info)=>{
 await page.goto('/');const result=await page.evaluate(async bytes=>{
  const{editor,Document,LayerStyle,LayerMask,MarqueeSelection}=window.luma,{CanvasRenderer}=await import(/* @vite-ignore */String('/src/engine/renderer.ts'));await editor.openTiff(new File([new Uint8Array(bytes)],'Native appearance original.tif',{type:'image/tiff'}),{editingPrecision:'float32'});
  const document=Document.fromJSON(editor.document.toJSON()),layer=document.layers.at(0)!,cached=new CanvasRenderer(),reference=new CanvasRenderer(),rows:{name:string;different:number;visible:number;nativeCalls:number;unchanged:boolean}[]=[];let nativeCalls=0;const composite=cached.processor.floatComposite.bind(cached.processor);cached.processor.floatComposite=async(...args:Parameters<typeof composite>)=>{nativeCalls++;return composite(...args);};
  layer.styles=new LayerStyle({dropShadow:{enabled:true,color:'#ad3f79',opacity:.625,x:9.25,y:-4.75,blur:2.5}});layer.mask=new LayerMask({linked:true,selection:new MarqueeSelection({shape:'rectangle',x:8,y:7,width:101,height:61})});
  const compare=async(name:string,region={x:0,y:0,width:131,height:79},proof:any=null)=>{const model=document.toJSON(),before=JSON.stringify(model),start=nativeCalls,a:HTMLCanvasElement=await cached.render(model,editor.assetStore,{readback:true,region,colorProof:proof}),b:HTMLCanvasElement=await reference.render(model,editor.assetStore,{cache:false,readback:true,region,colorProof:proof});try{const actual=a.getContext('2d')!.getImageData(0,0,a.width,a.height).data,expected=b.getContext('2d')!.getImageData(0,0,b.width,b.height).data;let different=0,visible=0;for(let i=0;i<actual.length;i++){if(actual[i]!==expected[i])different++;if(i%4===3&&actual[i]>0)visible++;}rows.push({name,different,visible,nativeCalls:nativeCalls-start,unchanged:before===JSON.stringify(document.toJSON())});}finally{a.width=a.height=b.width=b.height=0;}};
  try{
   // First build is outside the artboard: a clipped-frame cache would be empty.
   layer.x=-200;await compare('outside cold');
   for(const[x,y]of[[0,0],[24,0],[-20,12],[110,-60],[0,0]]){layer.x=x;layer.y=y;await compare(`move ${x},${y}`);}
   await compare('cropped native viewport',{x:11,y:9,width:87,height:53});
   const proof={profile:'display-p3',intent:'relative-colorimetric',proofIntent:'perceptual',blackPointCompensation:true,gamutWarning:true,warningColor:'#c731e9'};await compare('proof changes after cache hit',undefined,proof);
   layer.fillOpacity=0;await compare('zero Fill rebuild');layer.x=14;await compare('zero Fill move');
   cached.clearCache();await compare('explicit cache clear rebuild');
   return{rows,originalExact:new Uint8Array(await editor.assetStore.values()[0].blob.arrayBuffer()).every((v,i)=>v===bytes[i])};
  }finally{cached.dispose();reference.dispose();}
 },[...await readFile('tests/fixtures/tiff-float/rgba-raw-le.tif')]);
 await writeFile(info.outputPath('native-appearance-parity.json'),JSON.stringify(result,null,2));expect(result.originalExact).toBe(true);for(const row of result.rows){expect(row,row.name).toMatchObject({different:0,unchanged:true});if(row.name.startsWith('move ')||row.name.includes('viewport')||row.name.includes('proof')||row.name==='zero Fill move')expect(row.nativeCalls,row.name).toBe(0);else expect(row.nativeCalls,row.name).toBeGreaterThan(0);}expect(result.rows.find(r=>r.name==='move 0,0')!.visible).toBeGreaterThan(1000);
});

test('appearance changes and unsupported geometry retain the uncached native render and cancellation boundaries',async({page},info)=>{
 await page.goto('/');const result=await page.evaluate(async bytes=>{
  const{editor,Document,LayerStyle,LayerMask,MarqueeSelection,AffineTransform,ToneAdjustment,LayerGroup,RasterLayer}=window.luma,{CanvasRenderer}=await import(/* @vite-ignore */String('/src/engine/renderer.ts'));await editor.openTiff(new File([new Uint8Array(bytes)],'Appearance invalidation.tif',{type:'image/tiff'}),{editingPrecision:'float32'});const document=Document.fromJSON(editor.document.toJSON()),layer=document.layers.at(0)!,cached=new CanvasRenderer(),reference=new CanvasRenderer(),rows:{name:string;different:number}[]=[];
  layer.styles=new LayerStyle({dropShadow:{enabled:true,blur:2.5,x:9.25,y:-4.75}});
  const compare=async(name:string,options:any={})=>{const model=document.toJSON(),a:HTMLCanvasElement=await cached.render(model,editor.assetStore,{readback:true,...options}),b:HTMLCanvasElement=await reference.render(model,editor.assetStore,{readback:true,...options,cache:false});try{const actual=a.getContext('2d')!.getImageData(0,0,a.width,a.height).data,expected=b.getContext('2d')!.getImageData(0,0,b.width,b.height).data;rows.push({name,different:actual.reduce((n,v,i)=>n+Number(v!==expected[i]),0)});}finally{a.width=a.height=b.width=b.height=0;}};
  try{
   await compare('warm');layer.x=12;await compare('native move');layer.opacity=.4;await compare('opacity');layer.styles=new LayerStyle({dropShadow:{enabled:true,blur:5,x:-7.125,y:11.5,color:'#30b790'}});await compare('shadow settings');
   layer.mask=new LayerMask({linked:true,selection:new MarqueeSelection({shape:'rectangle',x:13,y:11,width:80,height:49})});await compare('linked mask');layer.x=20;await compare('linked move');layer.mask=layer.mask!.with({placedX:5,placedY:-3});await compare('placed mask');layer.mask=layer.mask!.with({placedX:8,placedY:4});await compare('placed mask invalidation');layer.mask=layer.mask!.with({x:.25,y:.5,placedX:.75,placedY:.5});await compare('integer combined placement');
   for(const linked of[false,true]){layer.mask=new LayerMask({linked,feather:2.5,selection:new MarqueeSelection({shape:'rectangle',x:13,y:11,width:80,height:49})});await compare(`feather linked=${linked}`);layer.x+=3;await compare(`feather move linked=${linked}`);}
   layer.mask=null;await compare('half zoom',{scale:.5});await compare('double zoom',{scale:2});await compare('fractional viewport',{region:{x:.25,y:.5,width:130,height:78}});
   layer.transform=AffineTransform.rotation(.2);await compare('affine');layer.transform=new AffineTransform();layer.x=.25;await compare('fractional translation');layer.x=2**52;await compare('large safe coordinate');layer.x=0;
   if(!(layer instanceof RasterLayer))throw new Error('Expected raster');layer.adjustments.add(new ToneAdjustment({exposure:.5}));await compare('active tone');
   const group=new LayerGroup();document.layers.add(group);await compare('extra graph');
   let cancelled='';try{await cached.render(document.toJSON(),editor.assetStore,{isCancelled:()=>true});}catch(error){cancelled=String(error);}cached.dispose();let closed='';try{await cached.render(document.toJSON(),editor.assetStore);}catch(error){closed=String(error);}return{rows,cancelled,closed};
  }finally{cached.dispose();reference.dispose();}
 },[...await readFile('tests/fixtures/uint16-float/u16-all-levels.tif')]);await writeFile(info.outputPath('native-appearance-invalidation.json'),JSON.stringify(result,null,2));for(const row of result.rows)expect(row.different,row.name).toBe(0);expect(result.cancelled).toMatch(/cancel|abort|superseded/i);expect(result.closed).toMatch(/closed/i);
});

test('a warm native appearance still validates source ownership, proof and cancellation before publication',async({page},info)=>{
 await page.goto('/');const result=await page.evaluate(async bytes=>{
  const{editor,Document,LayerStyle}=window.luma,{CanvasRenderer}=await import(/* @vite-ignore */String('/src/engine/renderer.ts'));await editor.openTiff(new File([new Uint8Array(bytes)],'Appearance lifetime.tif',{type:'image/tiff'}),{editingPrecision:'float32'});const document=Document.fromJSON(editor.document.toJSON()),layer=document.layers.at(0)!,renderer=new CanvasRenderer();layer.styles=new LayerStyle({dropShadow:{enabled:true,blur:2.5}});
  const warm=await renderer.render(document.toJSON(),editor.assetStore);warm.width=warm.height=0;
  try{
   let proof='',cancelled='',missing='';try{await renderer.render(document.toJSON(),editor.assetStore,{colorProof:{profile:'invalid-device' as any,intent:'relative-colorimetric',proofIntent:'perceptual',blackPointCompensation:false,gamutWarning:false,warningColor:'#00ffff'}});}catch(error){proof=String(error);}
   let checks=0;try{await renderer.render(document.toJSON(),editor.assetStore,{isCancelled:()=>++checks>3});}catch(error){cancelled=String(error);}
   // A distinct store must supply and validate its own retained original; an
   // old cache entry cannot turn a missing source into a successful canvas.
   const{AssetStore}=await import(/* @vite-ignore */String('/src/core/assets.ts')),empty=new AssetStore();try{await renderer.render(document.toJSON(),empty);}catch(error){missing=String(error);}finally{empty.dispose();}
   layer.x=12;const recovered:HTMLCanvasElement=await renderer.render(document.toJSON(),editor.assetStore),visible=recovered.getContext('2d')!.getImageData(0,0,recovered.width,recovered.height).data.some((v,i)=>i%4===3&&v>0);recovered.width=recovered.height=0;return{proof,cancelled,missing,visible};
  }finally{renderer.dispose();}
 },[...await readFile('tests/fixtures/uint16-float/u16-all-levels.tif')]);await writeFile(info.outputPath('native-appearance-ownership.json'),JSON.stringify(result,null,2));expect(result.proof).not.toBe('');expect(result.cancelled).toMatch(/abort|cancel|superseded/i);expect(result.missing).toMatch(/asset|source|missing/i);expect(result.visible).toBe(true);
});
