import {test,expect} from '@playwright/test';
import type {EditorApplication} from '../src/editor';
import type * as DOM from '../src/dom';
declare global{interface Window{luma:{editor:EditorApplication}&typeof DOM;}}

test('prepared mask replacements preserve hide/wet/reveal order, native pixels, SVG, project and one-step undo',async({page})=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const {editor,PaintLayer,PaintFill,LayerMask,PencilStroke,WetPaintStroke}=window.luma,{encodeRgbaPng}=await import(/* @vite-ignore */ String('/src/engine/png.ts'));
  editor.newDocument({width:16,height:16});const layer=editor.document.layers.add(new PaintLayer());layer.strokes.add(new PaintFill({bounds:{x:0,y:0,width:16,height:16},color:'#0000ff'}));layer.mask=new LayerMask({base:1});editor.document.selectedLayer=layer;
  const coverage=await editor.assetStore.add(await encodeRgbaPng(new Uint8Array([255,255,255,255]),1,1),'Coverage',undefined,false),output=await editor.assetStore.add(await encodeRgbaPng(new Uint8Array([255,0,0,128]),1,1),'Replacement alpha',undefined,false);
  const wet=(x:number)=>new WetPaintStroke({brush:new PencilStroke({points:[{x:x+.5,y:4.5}],size:1,pressureSize:false}),tiles:[{x,y:4,width:1,height:1,assetId:output.id,coverage:{assetId:coverage.id}}]});
  const before=editor.document.toJSON(),revision=editor.document.getSnapshot().revision;
  layer.mask=layer.mask!.applyWetPaint(wet(4)).paint(new PencilStroke({points:[{x:5.5,y:4.5}],size:1,pressureSize:false}),'hide').applyWetPaint(wet(5)).paint(new PencilStroke({points:[{x:4.5,y:4.5}],size:1,pressureSize:false}),'reveal');
  const sample=async(blob:Blob)=>{const image=new Image(),url=URL.createObjectURL(blob),canvas=document.createElement('canvas');canvas.width=canvas.height=16;try{image.src=url;await image.decode();const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);return [4,5,6].map(x=>[...ctx.getImageData(x,4,1,1).data]);}finally{URL.revokeObjectURL(url);canvas.width=canvas.height=0;}};
  const kinds=layer.mask!.strokes.map(entry=>entry.mode),native=await sample(await editor.exportPng()),svg=await sample((await editor.export({format:'svg'})).blob);
  const {parsePsd}=await import(/* @vite-ignore */ String('/src/core/interchange/psd/parser.ts')),psd=[];
  for(const mode of ['layers','flatten'] as const){const output=await editor.export({format:'psd',psdMode:mode}),parsed=parsePsd(await output.blob.arrayBuffer());if(!parsed.composite)throw new Error('Missing actual PSD composite');psd.push([4,5,6].map(x=>[...parsed.composite!.data.slice((4*16+x)*4,(4*16+x)*4+4)]));}
  const saved=editor.document.toJSON(),one=editor.document.getSnapshot().revision===revision+1,project=await editor.saveProject();editor.document.undo();const undo=JSON.stringify(before)===JSON.stringify(editor.document.toJSON());await editor.openProject(new File([project],'Mask wet.luma'));
  return{native,svg,psd,reopened:await sample(await editor.exportPng()),one,undo,model:JSON.stringify(saved)===JSON.stringify(editor.document.toJSON()),kinds};
 });expect(result).toEqual({native:[[0,0,255,255],[0,0,255,128],[0,0,255,255]],svg:[[0,0,255,255],[0,0,255,128],[0,0,255,255]],psd:[[[0,0,255,255],[0,0,255,128],[0,0,255,255]],[[0,0,255,255],[0,0,255,128],[0,0,255,255]]],reopened:[[0,0,255,255],[0,0,255,128],[0,0,255,255]],one:true,undo:true,model:true,kinds:['wet','hide','wet','reveal']});
});

for(const placed of [0,3])test(`mask smudge samples neutral coverage before disabled/inverted/density/feather settings and clips once in the mask plane: offset=${placed}`,async({page})=>{
 await page.goto('/');const result=await page.evaluate(async placed=>{
  const {editor,PaintLayer,LayerMask,PencilStroke,MarqueeSelection,AffineTransform}=window.luma;editor.newDocument({width:64,height:64});const layer=editor.document.layers.add(new PaintLayer());
  const world=new AffineTransform(1.5,.25,.5,1.25,8,4);layer.transform=world;
  layer.mask=new LayerMask({base:0,enabled:false,inverted:true,density:.4,feather:6,x:2,y:3,placedX:placed,placedY:-placed}).paint(new PencilStroke({size:1,pressureSize:false,points:[{x:4.5,y:4.5}]}),'reveal');editor.document.selectedLayer=layer;
  const maskWorld=world.multiply(AffineTransform.translation(2+placed,3-placed));editor.document.selection=new MarqueeSelection({x:6,y:4,width:1,height:1,shape:'rectangle'}).transformed(maskWorld);
  const operation=await editor.applyWetPaint(new PencilStroke({size:1,pressureSize:false,points:[{x:4.5,y:4.5},{x:8.5,y:4.5}]}),{target:'mask',mode:'smudge',mix:{pickup:0}});
  const mask=layer.mask!,raw=mask.with({enabled:true,inverted:false,density:1,feather:0}),canvas=await editor.renderer.renderMaskCoverage(raw.toJSON(),{x:0,y:0,width:16,height:16,sx:1,sy:1},0,0,'raw',false,new AffineTransform(),editor.assetStore);
  try{return{alpha:[4,5,6,7,8].map(x=>canvas.getContext('2d')!.getImageData(x,4,1,1).data[3]),settings:{enabled:mask.enabled,inverted:mask.inverted,density:mask.density,feather:mask.feather,x:mask.x,y:mask.y,placedX:mask.placedX,placedY:mask.placedY},kind:operation?.kind,maskKind:mask.kind};}finally{canvas.width=canvas.height=0;}
 },placed);expect(result).toEqual({alpha:[255,0,255,0,0],settings:{enabled:false,inverted:true,density:.4,feather:6,x:2,y:3,placedX:placed,placedY:-placed},kind:'wet',maskKind:'paint'});
});

test('filter-mask pointer transport uses the native master and preserves ordinary mask, source and filter stack',async({page})=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const {editor,Document,PaintLayer,PaintFill,LayerMask,AffineTransform,SmartToneFilter}=window.luma;editor.newDocument({width:128,height:96});const master=new Document({width:32,height:16});const paint=master.layers.add(new PaintLayer());paint.strokes.add(new PaintFill({bounds:{x:0,y:0,width:32,height:16},color:'#404040'}));const instance=editor.document.placeSmartObject(editor.document.defineComponent(master));instance.width=64;instance.height=32;instance.transform=new AffineTransform(1,.25,.5,1,8,4);instance.mask=new LayerMask({base:.75});instance.filterMask=new LayerMask({base:0,x:2,y:1});instance.addFilter(new SmartToneFilter({exposure:1}));editor.document.selectedLayer=instance;
  const before=editor.document.toJSON(),beforeRender=editor.renderer.render(before,editor.assetStore,{cache:false}),filters=JSON.stringify(instance.smartFilters),normal=instance.mask.toJSON(),source=JSON.stringify(editor.document.getComponent(instance.componentId).toJSON());
  editor.tools.configure({paintTarget:'filter-mask-reveal',size:1,hardness:1,pressureSize:false,pressureOpacity:false,mixer:{load:1,wetness:0,pickup:0}});
  const world=instance.transform.multiply(AffineTransform.scale(2)).multiply(AffineTransform.translation(2,1)),point=world.point({x:8.5,y:4.5});editor.tools.begin('mixer',point,{alt:false,shift:false,pressure:1},1);await editor.tools.end();
  const canvas=await editor.renderer.renderMaskCoverage(instance.filterMask!.toJSON(),{x:0,y:0,width:16,height:8,sx:1,sy:1},0,0,'native-filter-mask',false,new AffineTransform(),editor.assetStore),alpha=canvas.getContext('2d')!.getImageData(8,4,1,1).data[3];canvas.width=canvas.height=0;
  const original=await beforeRender,after=await editor.renderer.render(editor.document.toJSON(),editor.assetStore,{cache:false});const visibleBefore=[...original.getContext('2d')!.getImageData(Math.floor(point.x),Math.floor(point.y),1,1).data],visibleAfter=[...after.getContext('2d')!.getImageData(Math.floor(point.x),Math.floor(point.y),1,1).data];original.width=original.height=after.width=after.height=0;const reference=new OffscreenCanvas(260,260),context=reference.getContext('2d')!;context.setTransform(.5,0,0,.5,10.5,6.5);context.fillStyle='#fff';context.beginPath();context.arc(0,0,1,0,Math.PI*2);context.fill();const expected=context.getImageData(10,6,1,1).data[3];const raw=instance.filterMask!.toJSON().strokes!.at(-1)!;if(raw.mode!=='wet')throw new Error('Missing wet filter-mask operation');const settings=raw.stroke.brush.points[0],sourceExact=source===JSON.stringify(editor.document.getComponent(instance.componentId).toJSON()),normalExact=JSON.stringify(normal)===JSON.stringify(instance.mask!.toJSON());editor.document.undo();return{alpha,expected,visibleBefore,visibleAfter,filtersExact:filters===JSON.stringify(instance.smartFilters),settings,sourceExact,normalExact,undo:JSON.stringify(before)===JSON.stringify(editor.document.toJSON())};
 });expect(result.alpha).toBe(result.expected);expect(result.visibleAfter[0]).toBeGreaterThan(result.visibleBefore[0]);expect(result.visibleAfter[3]).toBe(result.visibleBefore[3]);expect(result).toMatchObject({settings:{x:8.5,y:4.5,pressure:1},filtersExact:true,sourceExact:true,normalExact:true,undo:true});
});

test('actual mask Mixer controls preview private coverage, Escape cancels and release commits one mask edit',async({page})=>{
 await page.goto('/');await page.evaluate(()=>{const {editor,PaintLayer,PaintFill,LayerMask}=window.luma;editor.newDocument({width:128,height:96});const layer=editor.document.layers.add(new PaintLayer());layer.strokes.add(new PaintFill({bounds:{x:0,y:0,width:128,height:96},color:'#ff0000'}));layer.mask=new LayerMask({base:1});editor.document.selectedLayer=layer;});
 await page.getByRole('button',{name:'Mixer brush',exact:true}).click();await page.keyboard.press('Control+1');await page.getByRole('combobox',{name:'Paint target',exact:true}).selectOption('mask-hide');
 for(const [label,value] of [['Size value','8'],['Hardness value','100'],['Wetness value','0'],['Pickup value','0']] as const){const input=page.getByRole('spinbutton',{name:label,exact:true});await input.fill(value);await input.press('Enter');}await page.getByRole('checkbox',{name:'Pressure controls size',exact:true}).uncheck();
 const before=await page.evaluate(()=>({model:window.luma.editor.document.toJSON(),assets:window.luma.editor.assetStore.values().length,revision:window.luma.editor.document.getSnapshot().revision})),box=(await page.locator('.canvas-wrap').boundingBox())!;
 const down=async()=>{await page.mouse.move(box.x+32,box.y+40);await page.mouse.down();await page.mouse.move(box.x+64,box.y+40,{steps:8});await expect.poll(()=>page.evaluate(()=>!!window.luma.editor.tools.getSnapshot().wetPreview)).toBe(true);};
 await down();expect(await page.evaluate(()=>({model:window.luma.editor.document.toJSON(),assets:window.luma.editor.assetStore.values().length,revision:window.luma.editor.document.getSnapshot().revision}))).toEqual(before);await page.keyboard.press('Escape');await page.mouse.up();
 await expect.poll(()=>page.evaluate(()=>window.luma.editor.tools.getSnapshot().drawing)).toBe(false);await down();await page.mouse.up();await expect.poll(()=>page.evaluate(()=>window.luma.editor.tools.getSnapshot().drawing)).toBe(false);
 const result=await page.evaluate(async()=>{const {editor}=window.luma,state=editor.document.getSnapshot(),layer=state.document.children[0],canvas=await editor.renderer.render(state.document,editor.assetStore,{cache:false});try{const alpha=canvas.getContext('2d')!.getImageData(56,40,1,1).data[3];editor.document.undo();return{alpha,kind:layer.kind,paint:layer.kind==='paint'?layer.strokes.length:0,mask:layer.mask?.strokes?.map(entry=>entry.mode),revision:state.revision,label:state.past.at(-1)?.label,undo:editor.document.toJSON()};}finally{canvas.width=canvas.height=0;}});
 expect(result).toEqual({alpha:0,kind:'paint',paint:1,mask:['wet'],revision:before.revision+1,label:'Mixer mask stroke',undo:before.model});
});

test('isolated prepared mask commands commit once and invalid native alpha rejects the complete script including inert metadata',async({page})=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const {editor,PaintLayer,PaintFill,LayerMask}=window.luma,{encodeRgbaPng}=await import(/* @vite-ignore */ String('/src/engine/png.ts'));
  editor.newDocument({width:16,height:16});const layer=editor.document.layers.add(new PaintLayer());layer.strokes.add(new PaintFill({bounds:{x:0,y:0,width:16,height:16},color:'#ff0000'}));layer.mask=new LayerMask({base:1});editor.document.selectedLayer=layer;
  const add=async(name:string,alpha:number)=>(await editor.assetStore.add(await encodeRgbaPng(new Uint8Array([255,255,255,alpha]),1,1),name,undefined,false)).id;
  const output=await add('Output',128),coverage=await add('Coverage',255),bad=await add('Invalid coverage',64),before=editor.document.toJSON(),revision=editor.document.getSnapshot().revision;
  const code=(support:string,opacity=1)=>`const layer=document.layers.at(0);document.name='Prepared mask';layer.mask=layer.mask.applyWetPaint(new WetPaintStroke({opacity:${opacity},brush:new PencilStroke({points:[{x:4.5,y:4.5}],size:1,pressureSize:false}),tiles:[{x:4,y:4,width:1,height:1,assetId:${JSON.stringify(output)},coverage:{assetId:${JSON.stringify(support)}}}]}));print('Prepared coverage ready');`;
  const logs=await editor.runScript(code(coverage)),saved=editor.document.toJSON(),one=editor.document.getSnapshot().revision===revision+1;
  const canvas=await editor.renderer.render(saved,editor.assetStore,{cache:false}),pixel=[...canvas.getContext('2d')!.getImageData(4,4,1,1).data];canvas.width=canvas.height=0;
  editor.document.undo();const undo=JSON.stringify(before)===JSON.stringify(editor.document.toJSON());let rejected=0;
  for(const opacity of [0,1]){try{await editor.runScript(code(bad,opacity));}catch{rejected++;}}
  return{logs,one,pixel,undo,rejected,unchanged:JSON.stringify(before)===JSON.stringify(editor.document.toJSON()),assets:editor.assetStore.values().length};
 });expect(result).toEqual({logs:['Prepared coverage ready'],one:true,pixel:[255,0,0,128],undo:true,rejected:2,unchanged:true,assets:3});
});

test('wet bitmap-mask editing on a real 50 MP source retains original bytes, exact undo and project-reopened coverage',async({page},info)=>{
 test.setTimeout(240000);await page.goto('/');await page.getByTestId('import-input').setInputFiles('tests/fixtures/matting/native-50mp.png');await expect(page.locator('.layer-row')).toHaveCount(1,{timeout:120000});
 const result=await page.evaluate(async()=>{
  const {editor,RasterLayer,LayerMask,PencilStroke}=window.luma,layer=editor.document.selectedLayer;if(!(layer instanceof RasterLayer))throw new Error('Missing native image');
  const source=editor.assetStore.get(layer.assetId),digest=async(blob:Blob)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))).join(','),hash=await digest(source.blob);layer.mask=LayerMask.fromBitmap(source.id);
  const before=editor.document.toJSON(),sample=async()=>{const canvas=await editor.renderer.render(editor.document.toJSON(),editor.assetStore,{cache:false,region:{x:9000,y:4000,width:2,height:1},scale:1});try{return[...canvas.getContext('2d')!.getImageData(0,0,2,1).data];}finally{canvas.width=canvas.height=0;}};
  const original=await sample(),created=new WeakSet<HTMLCanvasElement>(),working:{width:number;height:number}[]=[],create=document.createElement,width=Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype,'width')!,height=Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype,'height')!;
  const restore=()=>{document.createElement=create;Object.defineProperty(HTMLCanvasElement.prototype,'width',width);Object.defineProperty(HTMLCanvasElement.prototype,'height',height);};
  document.createElement=function(...args:Parameters<Document['createElement']>){const value=create.apply(document,args);if(value instanceof HTMLCanvasElement)created.add(value);return value;} as Document['createElement'];
  for(const [key,descriptor] of [['width',width],['height',height]] as const)Object.defineProperty(HTMLCanvasElement.prototype,key,{...descriptor,set(this:HTMLCanvasElement,value:number){descriptor.set!.call(this,value);if(created.has(this))working.push({width:this.width,height:this.height});}});
  let native:number[];
  try{await editor.applyWetPaint(new PencilStroke({size:1,pressureSize:false,points:[{x:9000.5,y:4000.5}]}),{target:'mask',mode:'mixer',load:{color:[0,0,0,0]},mix:{wetness:0,pickup:0}});native=await sample();}finally{restore();}
  const saved=editor.document.toJSON(),project=await editor.saveProject();editor.document.undo();const undo=JSON.stringify(before)===JSON.stringify(editor.document.toJSON());await editor.openProject(new File([project],'Wet 50 MP mask.luma'));
  const reopened=editor.assetStore.get(source.id);return{original,native,reopened:await sample(),undo,model:JSON.stringify(saved)===JSON.stringify(editor.document.toJSON()),source:hash===await digest(reopened.blob),dimensions:[reopened.width,reopened.height],working};
 });expect(result.original[3]).toBeGreaterThan(0);expect(result.native[3]).toBe(0);expect(result.native.slice(4)).toEqual(result.original.slice(4));expect(result.reopened).toEqual(result.native);expect(result).toMatchObject({undo:true,model:true,source:true,dimensions:[10000,5000]});expect(result.working.some(value=>value.width*value.height>0)).toBe(true);expect(result.working.every(value=>value.width*value.height<=4_000_000)).toBe(true);await info.attach('wet-mask-native-50mp',{body:JSON.stringify(result),contentType:'application/json'});
});

test('native affine mask partitions match complete coverage before sampling and mask settings',async({page},info)=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const {editor,PaintLayer,PaintFill,LayerMask,BrushStroke,PencilStroke,WetPaintStroke,AffineTransform}=window.luma;
  const {encodeRgbaPng}=await import(/* @vite-ignore */ String('/src/engine/png.ts')),{paintedMask}=await import(/* @vite-ignore */ String('/src/engine/drawing.ts')),{applyMaskSettings}=await import(/* @vite-ignore */ String('/src/engine/masks.ts'));
  editor.newDocument({width:420,height:180});const layer=editor.document.layers.add(new PaintLayer());layer.strokes.add(new PaintFill({bounds:{x:0,y:0,width:420,height:180},color:'#0000ff'}));
  const pixels=new Uint8Array(11*17*4),support=new Uint8Array(pixels.length).fill(255);for(let y=0;y<17;y++)for(let x=0;x<11;x++){const at=(y*11+x)*4;pixels.set([255,255,255,Math.round((x+y)%7*255/6)],at);}
  const output=await editor.assetStore.add(await encodeRgbaPng(pixels,11,17),'Mask output',undefined,false),coverage=await editor.assetStore.add(await encodeRgbaPng(support,11,17),'Mask support',undefined,false),world=new AffineTransform(1.2,.15,.25,.9,16,8);
  const operation=new WetPaintStroke({brush:new PencilStroke({points:[{x:120,y:35}]}),nativeTransform:new AffineTransform(4,.5,.6,3,120,35),opacity:.65,tiles:[{x:0,y:0,width:11,height:17,assetId:output.id,coverage:{assetId:coverage.id}}]});
  layer.mask=new LayerMask({base:.7,x:world.e,y:world.f,basis:new AffineTransform(world.a,world.b,world.c,world.d),density:.8,inverted:true}).applyWetPaint(operation).paint(new BrushStroke({points:[{x:190,y:60},{x:260,y:60}],size:7,hardness:1,pressureSize:false}),'hide');
  const mask=layer.mask!.toJSON(),bounds=world.inverse().bounds({x:0,y:0,width:420,height:180}),left=Math.floor(bounds.x)-4,top=Math.floor(bounds.y)-4,width=Math.ceil(bounds.x+bounds.width)-left+4,height=Math.ceil(bounds.y+bounds.height)-top+4;
  const native=await paintedMask(mask,{x:left,y:top,width,height,sx:1,sy:1},0,0,editor.renderer.processor,new AffineTransform(),undefined,editor.assetStore,undefined,undefined,true),reference=document.createElement('canvas');reference.width=420;reference.height=180;
  try{
   const context=reference.getContext('2d')!;context.setTransform(world.a,world.b,world.c,world.d,world.e,world.f);context.drawImage(native,left,top);context.resetTransform();applyMaskSettings(reference,mask);
   const expected=context.getImageData(0,0,420,180).data;let maximum=0,changed=0;const differences:{region:unknown;maximum:number;count:number;examples:number[][]}[]=[];
   for(const region of [{x:0,y:0,width:420,height:180},{x:0,y:0,width:207,height:89},{x:207,y:0,width:213,height:89},{x:0,y:89,width:207,height:91},{x:207,y:89,width:213,height:91}]){
    let localMax=0,count=0;const examples:number[][]=[];const canvas=await editor.renderer.render(editor.document.toJSON(),editor.assetStore,{region,scale:1,cache:false});try{const data=canvas.getContext('2d')!.getImageData(0,0,region.width,region.height).data;for(let y=0;y<region.height;y++)for(let x=0;x<region.width;x++){const at=(y*region.width+x)*4,to=((region.y+y)*420+region.x+x)*4;const error=Math.abs(data[at+3]-expected[to+3]);maximum=Math.max(maximum,error);localMax=Math.max(localMax,error);if(error>1){count++;if(examples.length<12)examples.push([x+region.x,y+region.y,data[at+3],expected[to+3]]);}if(expected[to+3]!==expected[3])changed++;}}finally{canvas.width=canvas.height=0;}differences.push({region,maximum:localMax,count,examples});
   }
   return{maximum,changed,differences,native:[width,height]};
  }finally{native.width=native.height=reference.width=reference.height=0;}
 });await info.attach('native-affine-wet-mask-diagnostics',{body:JSON.stringify(result),contentType:'application/json'});expect(result.maximum).toBeLessThanOrEqual(1);expect(result.changed).toBeGreaterThan(100);expect(result.native[0]*result.native[1]).toBeLessThanOrEqual(4_000_000);await info.attach('native-affine-wet-mask',{body:JSON.stringify(result),contentType:'application/json'});
});

test('inert prepared vector-mask metadata preserves exact pixels and vector SVG while retaining its references',async({page})=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const {editor,PaintLayer,PaintFill,LayerMask,VectorPath,PencilStroke,WetPaintStroke}=window.luma,{encodeRgbaPng}=await import(/* @vite-ignore */ String('/src/engine/png.ts'));
  editor.newDocument({width:16,height:16});const layer=editor.document.layers.add(new PaintLayer());layer.strokes.add(new PaintFill({bounds:{x:0,y:0,width:16,height:16},color:'#0000ff'}));layer.mask=new LayerMask({paths:[new VectorPath({points:[{x:0,y:0},{x:12,y:0},{x:12,y:12}],closed:true})]});
  const before=await editor.exportPng(),svgBefore=await(await editor.export({format:'svg'})).blob.text(),output=await editor.assetStore.add(await encodeRgbaPng(new Uint8Array([255,255,255,128]),1,1),'Output',undefined,false),coverage=await editor.assetStore.add(await encodeRgbaPng(new Uint8Array([255,255,255,255]),1,1),'Coverage',undefined,false);
  layer.mask=layer.mask!.applyWetPaint(new WetPaintStroke({opacity:0,brush:new PencilStroke({points:[{x:4.5,y:4.5}]}),tiles:[{x:4,y:4,width:1,height:1,assetId:output.id,coverage:{assetId:coverage.id}}]}));
  const after=await editor.exportPng(),svgAfter=await(await editor.export({format:'svg'})).blob.text(),digest=async(blob:Blob)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))).join(',');
  const project=await editor.saveProject(),saved=editor.document.toJSON();await editor.openProject(new File([project],'Inert mask.luma'));
  return{png:await digest(before)===await digest(after),svg:svgBefore===svgAfter,images:new DOMParser().parseFromString(svgAfter,'image/svg+xml').querySelectorAll('image').length,model:JSON.stringify(saved)===JSON.stringify(editor.document.toJSON()),assets:editor.assetStore.values().length};
 });expect(result).toEqual({png:true,svg:true,images:0,model:true,assets:2});
});

for(const maskTarget of [false,true])test(`pointer-up drains samples arriving during an earlier native append for ${maskTarget?'mask coverage':'layer pixels'}`,async({page})=>{
 await page.goto('/');const result=await page.evaluate(async maskTarget=>{
  const {editor,PaintLayer,PaintFill,LayerMask}=window.luma;editor.newDocument({width:128,height:96});const layer=editor.document.layers.add(new PaintLayer());
  if(maskTarget){layer.strokes.add(new PaintFill({bounds:{x:0,y:0,width:128,height:96},color:'#0000ff'}));layer.mask=new LayerMask({base:1});}editor.document.selectedLayer=layer;
  editor.tools.configure({paintTarget:maskTarget?'mask-hide':'layer',size:8,hardness:1,pressureSize:false,pressureOpacity:false,color:'#ff0000',mixer:{load:1,wetness:0,pickup:0}});
  const original=editor._beginWetPaint.bind(editor);let release=()=>{},started=()=>{};const pending=new Promise<void>(resolve=>{started=resolve;});
  editor._beginWetPaint=async(...args)=>{const job=await original(...args),append=job.append.bind(job);let held=false;job.append=async points=>{if(!held){held=true;started();await new Promise<void>(resolve=>{release=resolve;});}await append(points);};return job;};
  const before=editor.document.toJSON(),revision=editor.document.getSnapshot().revision,mods={alt:false,shift:false,pressure:1};
  try{
   editor.tools.begin('mixer',{x:32,y:40},mods,1);editor.tools.move({x:36,y:40},mods);await pending;
   for(let x=40;x<=64;x+=4)editor.tools.move({x,y:40},mods);const finish=editor.tools.end();release();await finish;
   const model=layer.toJSON(),operation=maskTarget?model.mask?.strokes?.at(-1)?.stroke:model.kind==='paint'?model.strokes.at(-1):null;
   if(operation?.kind!=='wet')throw new Error('Missing completed native operation');
   const canvas=await editor.renderer.render(editor.document.toJSON(),editor.assetStore,{cache:false}),pixel=[...canvas.getContext('2d')!.getImageData(56,40,1,1).data];canvas.width=canvas.height=0;
   const one=editor.document.getSnapshot().revision===revision+1;editor.document.undo();return{points:operation.brush.points.map(point=>point.x),pixel,one,undo:JSON.stringify(before)===JSON.stringify(editor.document.toJSON())};
  }finally{release();editor._beginWetPaint=original;editor.tools.cancel();}
 },maskTarget);expect(result.points).toEqual([32,36,40,44,48,52,56,60,64]);expect(result.one&&result.undo).toBe(true);if(maskTarget)expect(result.pixel[3]).toBe(0);else{expect(result.pixel.slice(0,3)).toEqual([255,0,0]);expect(result.pixel[3]).toBeGreaterThan(0);}
});
