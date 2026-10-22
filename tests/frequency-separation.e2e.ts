import {test,expect} from '@playwright/test';

async function setup(page:import('@playwright/test').Page){await page.goto('/');await page.evaluate(async()=>{
 const {editor,RasterLayer}=window.luma;editor.newDocument({width:96,height:64});const canvas=document.createElement('canvas');canvas.width=64;canvas.height=32;const c=canvas.getContext('2d')!,image=c.createImageData(64,32);
 for(let y=0;y<32;y++)for(let x=0;x<64;x++)image.data.set([(x*31+y*7)%256,(x*9+y*43)%256,(x*17+y*11)%256,[0,1,64,128,255][y%5]],(y*64+x)*4);
 c.putImageData(image,0,0);const blob=await new Promise<Blob>(resolve=>canvas.toBlob(v=>resolve(v!))),asset=await editor.assetStore.add(blob,'Original photo',undefined,false);editor.document.selectedLayer=editor.document.layers.add(new RasterLayer({name:'Photo',assetId:asset.id,width:64,height:32}));canvas.width=canvas.height=0;
});}

test('native workflow reconstructs transparent photo pixels, retains original bytes and has exact undo/project state',async({page})=>{
 await setup(page);const result=await page.evaluate(async()=>{
  const {editor}=window.luma,source=editor.document.selectedLayer!,asset=editor.assetStore.values()[0];const hash=async(blob:Blob)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('');
  const read=async()=>{const bmp=await createImageBitmap(await editor.exportPng()),c=document.createElement('canvas');c.width=96;c.height=64;c.getContext('2d')!.drawImage(bmp,0,0);bmp.close();const out=[...c.getContext('2d')!.getImageData(0,0,96,64).data];c.width=c.height=0;return out;};
  const original=await hash(asset.blob),before=editor.document.toJSON(),beforePixels=await read(),past=editor.document.getSnapshot().past.length;
  const group=await editor.separateFrequencies(source.id,{sigma:2}),after=editor.document.toJSON(),afterPixels=await read();let max=0,alpha=0;
  for(let i=0;i<afterPixels.length;i+=4){alpha=Math.max(alpha,Math.abs(afterPixels[i+3]-beforePixels[i+3]));for(let c=0;c<3;c++)max=Math.max(max,Math.abs(Math.round(afterPixels[i+c]*afterPixels[i+3]/255)-Math.round(beforePixels[i+c]*beforePixels[i+3]/255)));}
  const groupData=group.toJSON(),sourceHidden=!source.visible,history=editor.document.getSnapshot().past.length-past,project=await editor.saveProject();editor.document.undo();const undo=editor.document.toJSON();await editor.openProject(new File([project],'frequency.luma'));const reopened=await read();
  return{max,alpha,history,sourceHidden,before,undo,after,reopened:editor.document.toJSON(),samePixels:JSON.stringify(afterPixels)===JSON.stringify(reopened),sourceHash:original,reopenedHash:await hash(editor.assetStore.get(asset.id).blob),assets:editor.assetStore.values().map(a=>[a.width,a.height]),group:groupData};
 });expect(result.max).toBeLessThanOrEqual(1);expect(result.alpha).toBe(0);expect(result.history).toBe(1);expect(result.sourceHidden).toBe(true);expect(result.undo).toEqual(result.before);expect(result.reopened).toEqual(result.after);expect(result.samePixels).toBe(true);expect(result.sourceHash).toBe(result.reopenedHash);expect(result.assets).toEqual([[64,32],[64,32]]);
});

test('native recomposition occurs before affine resampling and preserves outer masks and tone',async({page})=>{
 const results=[];for(const mode of ['affine','mask','erase','tone','all']){await setup(page);const result=await page.evaluate(async(mode)=>{
  const {editor,RasterLayer,AffineTransform,LayerMask,MarqueeSelection}=window.luma,source=editor.document.selectedLayer as InstanceType<typeof RasterLayer>;source.width=32;source.height=16;source.transform=new AffineTransform(.9,.3,-.2,1.1,20,15);source.opacity=.7;if(mode==='tone'||mode==='all')source.setTone({contrast:15,saturation:-20});if(mode==='erase'||mode==='all')source.clear(new MarqueeSelection({shape:'rectangle',x:4,y:4,width:4,height:4}));if(mode==='mask'||mode==='all')source.mask=new LayerMask({selection:new MarqueeSelection({shape:'ellipse',x:0,y:0,width:32,height:16}),feather:1});
  const read=async()=>{const bmp=await createImageBitmap(await editor.exportPng()),c=document.createElement('canvas');c.width=96;c.height=64;c.getContext('2d')!.drawImage(bmp,0,0);bmp.close();const out=[...c.getContext('2d')!.getImageData(0,0,96,64).data];c.width=c.height=0;return out;};
  const before=await read();await editor.separateFrequencies(source.id,{sigma:2});const after=await read();let max=0,alpha=0,witness:unknown=null;for(let i=0;i<after.length;i+=4){if(Math.abs(before[i+3]-after[i+3])>alpha)witness={x:(i/4)%96,y:Math.floor(i/4/96),before:before.slice(i,i+4),after:after.slice(i,i+4)};alpha=Math.max(alpha,Math.abs(before[i+3]-after[i+3]));for(let c=0;c<3;c++)max=Math.max(max,Math.abs(Math.round(before[i+c]*before[i+3]/255)-Math.round(after[i+c]*after[i+3]/255)));}return{mode,max,alpha,witness,sourceSize:editor.assetStore.values().map(a=>[a.width,a.height])};
 },mode);results.push(result);}console.log('Affine frequency reconstruction:',JSON.stringify(results));for(const result of results){expect(result.alpha).toBeLessThanOrEqual(1);expect(result.max).toBeLessThanOrEqual(2);expect(result.sourceSize).toEqual([[64,32],[64,32]]);}
});


test('documented isolated recipe prepares native pixels and commits one host undo',async({page})=>{
 const {readFile}=await import('node:fs/promises'),guide=await readFile('docs/SCRIPTING_API.md','utf8'),code=guide.match(/<!-- example: frequency-separation -->\s*```js\n([\s\S]*?)\n```/)?.[1];expect(code).toBeTruthy();await setup(page);
 const result=await page.evaluate(async code=>{
  const {editor}=window.luma,before=editor.document.toJSON(),past=editor.document.getSnapshot().past.length,assets=editor.assetStore.values().length;
  const logs=await editor.runScript(code!);const after=editor.document.toJSON(),history=editor.document.getSnapshot().past.length-past;editor.document.undo();return{logs,history,undo:JSON.stringify(editor.document.toJSON())===JSON.stringify(before),assets:editor.assetStore.values().length-assets,schema:after.schemaVersion,originalHidden:after.children[0].visible===false};
 },code);expect(result).toMatchObject({history:1,undo:true,assets:1,schema:40,originalHidden:true});expect(result.logs.join(' ')).toContain('Frequency layers ready');
});

test('abort, human edits, selection changes and replaced assets reject private capture without output leaks',async({page})=>{
 for(const mode of ['abort','edit','selection','asset','geometry'] as const){await setup(page);const result=await page.evaluate(async mode=>{
  const {editor}=window.luma,doc=editor.document,source=doc.selectedLayer!,before=doc.toJSON(),past=doc.getSnapshot().past.length,asset=editor.assetStore.values()[0],ids=editor.assetStore.values().map(a=>a.id),abort=new AbortController();
  const render=editor.renderer.render.bind(editor.renderer);let entered!:()=>void,release!:()=>void;const waiting=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);
  editor.renderer.render=async(data,store,options)=>{if(data.children.length===1&&data.children[0].id!==source.id&&data.children[0].kind==='raster'){entered();await gate;}return render(data,store,options);};
  let error='';const pending=editor.separateFrequencies(source.id,{sigma:2},{signal:abort.signal}).catch(cause=>{error=String(cause);});
  try{await waiting;
   if(mode==='abort')abort.abort();if(mode==='edit')doc.name='Human edit';if(mode==='selection')doc.selectedLayer=null;
   if(mode==='geometry')asset.width++;
   if(mode==='asset'){const bitmap=await createImageBitmap(asset.blob);editor.assetStore.remove(asset.id);editor.assetStore.install({...asset,bitmap},false);}
   release();await pending;if(mode==='geometry')asset.width--;
   return{mode,error,assets:editor.assetStore.values().map(a=>a.id),ids,model:doc.toJSON(),expected:mode==='edit'?{...before,name:'Human edit'}:before,history:doc.getSnapshot().past.length-past};
  }finally{release();editor.renderer.render=render;}
 },mode);expect(result.error).toMatch(/abort|changed/i);expect(result.assets).toEqual(result.ids);expect(result.model).toEqual(result.expected);expect(result.history).toBe(mode==='edit'?1:0);}
});

test('active wet source captures expanded native ink and ordered clears before document tone',async({page})=>{
 await setup(page);const result=await page.evaluate(async()=>{
  const {editor,RasterLayer,WetPaintStroke,PencilStroke,AffineTransform,MarqueeSelection}=window.luma,source=editor.document.selectedLayer as InstanceType<typeof RasterLayer>;
  const {encodeRgbaPng}=await import(/* @vite-ignore */String('/src/engine/png.ts'));
  const pixels=new Uint8Array(12*10*4),coverage=new Uint8Array(pixels.length);for(let i=0;i<pixels.length;i+=4){pixels.set([240,40,60,200],i);coverage.set([255,255,255,255],i);}
  const output=await editor.assetStore.add(await encodeRgbaPng(pixels,12,10),'Wet ink',undefined,false),support=await editor.assetStore.add(await encodeRgbaPng(coverage,12,10),'Wet coverage',undefined,false);
  source.width=32;source.height=16;source.applyWetPaint(new WetPaintStroke({brush:new PencilStroke({points:[{x:0,y:0}]}),tiles:[{x:-4,y:-3,width:12,height:10,assetId:output.id,coverage:{assetId:support.id}}]}));
  source.clear(new MarqueeSelection({shape:'rectangle',x:3,y:3,width:2,height:2}));source.setTone({contrast:15,saturation:-20});source.transform=new AffineTransform(.9,.3,-.2,1.1,20,15);
  const read=async()=>{const c=await editor.renderer.render(editor.document.toJSON(),editor.assetStore,{cache:false,readback:true});try{return[...c.getContext('2d')!.getImageData(0,0,c.width,c.height).data];}finally{c.width=c.height=0;}};
  const before=await read();await editor.separateFrequencies(source.id,{sigma:2});const after=await read();let rgb=0,alpha=0;
  for(let p=0;p<after.length;p+=4){alpha=Math.max(alpha,Math.abs(before[p+3]-after[p+3]));for(let c=0;c<3;c++)rgb=Math.max(rgb,Math.abs(Math.round(before[p+c]*before[p+3]/255)-Math.round(after[p+c]*after[p+3]/255)));}
  return{rgb,alpha,capture:editor.assetStore.values().at(-1)!.width+'x'+editor.assetStore.values().at(-1)!.height,visibleInk:before.filter((_,i)=>i%4===3&&before[i]>0).length};
 });console.log('Expanded wet frequency capture:',JSON.stringify(result));expect(result.rgb).toBeLessThanOrEqual(2);expect(result.alpha).toBeLessThanOrEqual(1);expect(result.capture).toBe('72x38');expect(result.visibleInk).toBeGreaterThan(0);
});

test('dialog, band controls, real retouch stroke and Apply to source remain editable and reversible',async({page})=>{
 await setup(page);const before=await page.evaluate(()=>window.luma.editor.document.toJSON());
 await page.keyboard.press('Control+k');await page.getByRole('combobox',{name:'Search commands'}).fill('Frequency separation');await page.getByRole('option',{name:/Frequency separation/}).click();
 await page.getByLabel('Separation radius value',{exact:true}).fill('2');await page.getByLabel('Separation radius value',{exact:true}).press('Enter');await page.getByRole('button',{name:'Cancel',exact:true}).click();expect(await page.evaluate(()=>window.luma.editor.document.toJSON())).toEqual(before);
 await page.locator('.viewport').click({button:'right',position:{x:40,y:40}});await page.getByRole('menuitem',{name:'Frequency separation…',exact:true}).click();
 await page.getByLabel('Separation radius value',{exact:true}).fill('2');await page.getByLabel('Separation radius value',{exact:true}).press('Enter');await page.getByRole('button',{name:'Create frequency layers',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 const originalPng=await page.evaluate(async()=>[...new Uint8Array(await (await window.luma.editor.exportPng()).arrayBuffer())]);
 const owner=await page.evaluate(()=>window.luma.editor.document.id);await page.getByRole('button',{name:'Edit contents',exact:true}).click();await expect(page.getByRole('region',{name:'Smart-object contents'})).toBeVisible();
 await page.evaluate(()=>{const {editor,SmartObjectLayer}=window.luma;const nodes=(function visit(layers:any):any[]{return Array.from(layers as Iterable<any>).flatMap((n:any)=>n.layers?[n,...visit(n.layers)]:[n]);})(editor.document.layers);editor.document.selectedLayer=nodes.find((n:any)=>n instanceof SmartObjectLayer&&n.name==='Color and tone source');});
 const radius=page.getByLabel('Shared separation radius value',{exact:true});await expect(radius).toHaveValue('2');await radius.fill('3');await radius.press('Enter');await expect(radius).toHaveValue('3');
 await page.getByLabel('Editing canvas',{exact:true}).focus();await page.keyboard.press('Control+z');await expect(radius).toHaveValue('2');
 await page.evaluate(()=>{const {editor}=window.luma;const nodes=(function visit(layers:any):any[]{return Array.from(layers as Iterable<any>).flatMap((n:any)=>n.layers?[n,...visit(n.layers)]:[n]);})(editor.document.layers);editor.document.selectedLayer=nodes.find((n:any)=>n.name==='Color retouch');editor.tools.configure({size:6,color:'#ff0000',hardness:1,pressureSize:false});});
 await page.getByRole('button',{name:'Brush tool (B)',exact:true}).click();await page.keyboard.press('Control+1');const canvas=page.getByLabel('Editing canvas',{exact:true}),box=(await canvas.boundingBox())!;
 await page.mouse.move(box.x+box.width/2-8,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+8,box.y+box.height/2,{steps:4});await page.mouse.up();
 expect(await page.evaluate(()=>{const {editor,PaintLayer}=window.luma;return editor.document.selectedLayer instanceof PaintLayer?editor.document.selectedLayer.strokes.length:0;})).toBe(1);
 await page.getByRole('button',{name:'Apply to source',exact:true}).click();await expect(page.getByRole('region',{name:'Smart-object contents'})).toContainText('No pending contents changes.');await page.evaluate(owner=>{const {editor}=window.luma;const session=editor.getSnapshot().sessions.find(s=>s.document.id===owner);if(!session)throw new Error('Missing owner');editor.activateDocument(session.document);},owner);
 const changed=await page.evaluate(async()=>{const {editor}=window.luma;return{model:editor.document.toJSON(),png:[...new Uint8Array(await (await editor.exportPng()).arrayBuffer())]};});expect(changed.png.length).toBeGreaterThan(0);expect(changed.png).not.toEqual(originalPng);expect(changed.model).not.toEqual(before);
 await page.evaluate(()=>{const {editor}=window.luma;editor.document.undo();editor.document.undo();});expect(await page.evaluate(()=>window.luma.editor.document.toJSON())).toEqual(before);
});

test('native PNG, SVG and Photoshop composites preserve the frequency result with explicit degradation reports',async({page})=>{
 await setup(page);const result=await page.evaluate(async()=>{
  const {editor}=window.luma;await editor.separateFrequencies(editor.document.selectedLayer!.id,{sigma:2});
  const sample=async(blob:Blob)=>{const image=new Image(),url=URL.createObjectURL(blob),canvas=document.createElement('canvas');canvas.width=96;canvas.height=64;try{image.src=url;await image.decode();const c=canvas.getContext('2d')!;c.drawImage(image,0,0);return[...c.getImageData(0,0,96,64).data];}finally{URL.revokeObjectURL(url);canvas.width=canvas.height=0;}};
  const native=await sample(await editor.exportPng()),svg=await editor.export({format:'svg'}),svgPixels=await sample(svg.blob),{parsePsd}=await import(/* @vite-ignore */String('/src/core/interchange/psd/parser.ts'));
  const modes=[];for(const psdMode of ['layers','flatten'] as const){const out=await editor.export({format:'psd',psdMode}),parsed=parsePsd(new Uint8Array(await out.blob.arrayBuffer()));modes.push({mode:psdMode,pixels:[...parsed.composite!.data],warnings:out.report.featuresDegradedOrOmitted});}
  const delta=(pixels:number[])=>{let rgb=0,alpha=0;for(let i=0;i<pixels.length;i+=4){alpha=Math.max(alpha,Math.abs(pixels[i+3]-native[i+3]));for(let c=0;c<3;c++)rgb=Math.max(rgb,Math.abs(Math.round(pixels[i+c]*pixels[i+3]/255)-Math.round(native[i+c]*native[i+3]/255)));}return{rgb,alpha};};return{svg:delta(svgPixels),modes:modes.map(out=>({...out,pixels:undefined,...delta(out.pixels)})),svgWarnings:svg.report.featuresDegradedOrOmitted};
 });console.log('Frequency interchange:',JSON.stringify(result));expect(result.svg.rgb).toBeLessThanOrEqual(1);expect(result.svg.alpha).toBeLessThanOrEqual(1);for(const mode of result.modes){expect(mode.rgb).toBeLessThanOrEqual(1);expect(mode.alpha).toBeLessThanOrEqual(1);expect(mode.warnings.length).toBeGreaterThan(0);}
});

test('a 50 MP source keeps original geometry and bytes through native separation, full PNG export and project reopen',async({page},info)=>{
 test.setTimeout(600000);await page.goto('/');await page.getByTestId('import-input').setInputFiles('tests/fixtures/psd/native-50mp.png');await expect(page.locator('.layer-row')).toHaveCount(1,{timeout:120000});
 const result=await page.evaluate(async()=>{
  const {editor,RasterLayer}=window.luma,doc=editor.document,source=doc.layers.at(0);if(!(source instanceof RasterLayer))throw new Error('Missing original');const asset=editor.assetStore.get(source.assetId);
  const hash=async(blob:Blob)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join(''),sourceHash=await hash(asset.blob),before=doc.toJSON(),region={x:9000,y:4000,width:128,height:64};
  const sample=async()=>{const canvas=await editor.renderer.render(editor.document.toJSON(),editor.assetStore,{region,cache:false,readback:true});try{return[...canvas.getContext('2d')!.getImageData(0,0,128,64).data];}finally{canvas.width=canvas.height=0;}};
  const beforePixels=await sample(),created=new WeakSet<HTMLCanvasElement>(),create=document.createElement,width=Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype,'width')!,height=Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype,'height')!;let maxArea=0,maxSide=0;
  document.createElement=function(...args:Parameters<Document['createElement']>){const value=create.apply(document,args);if(value instanceof HTMLCanvasElement)created.add(value);return value;} as Document['createElement'];
  for(const [key,descriptor] of [['width',width],['height',height]] as const)Object.defineProperty(HTMLCanvasElement.prototype,key,{...descriptor,set(this:HTMLCanvasElement,value:number){descriptor.set!.call(this,value);if(created.has(this)){maxArea=Math.max(maxArea,this.width*this.height);maxSide=Math.max(maxSide,this.width,this.height);}}});
  const restore=()=>{document.createElement=create;Object.defineProperty(HTMLCanvasElement.prototype,'width',width);Object.defineProperty(HTMLCanvasElement.prototype,'height',height);};
  try{
   const started=performance.now();await editor.separateFrequencies(source.id,{sigma:2});const separationMs=performance.now()-started,afterPixels=await sample(),saved=doc.toJSON(),nativeSizes=editor.assetStore.values().map(a=>[a.width,a.height]);
   const exportStart=performance.now(),png=await editor.exportPng(),exportMs=performance.now()-exportStart;restore();
   const bitmap=await createImageBitmap(png),exportSize=[bitmap.width,bitmap.height],canvas=document.createElement('canvas');canvas.width=128;canvas.height=64;canvas.getContext('2d')!.drawImage(bitmap,region.x,region.y,128,64,0,0,128,64);bitmap.close();const exported=[...canvas.getContext('2d')!.getImageData(0,0,128,64).data];canvas.width=canvas.height=0;
   const project=await editor.saveProject();doc.undo();const undo=JSON.stringify(doc.toJSON())===JSON.stringify(before);await editor.openProject(new File([project],'frequency-50mp.luma'));
   return{separationMs,exportMs,maxArea,maxSide,exportSize,nativeSizes,sourceHash,reopenedHash:await hash(editor.assetStore.get(asset.id).blob),undo,sameModel:JSON.stringify(editor.document.toJSON())===JSON.stringify(saved),unchangedPixels:JSON.stringify(beforePixels)===JSON.stringify(afterPixels),fullExportMatches:JSON.stringify(exported)===JSON.stringify(afterPixels),reopenedPixels:JSON.stringify(await sample())===JSON.stringify(afterPixels)};
  }finally{restore();}
 });console.log('Native 50 MP frequency workflow:',JSON.stringify(result));expect(result.nativeSizes).toEqual([[10000,5000],[10000,5000]]);expect(result.exportSize).toEqual([10000,5000]);expect(result.sourceHash).toBe(result.reopenedHash);expect(result.undo).toBe(true);expect(result.sameModel).toBe(true);expect(result.unchangedPixels).toBe(true);expect(result.fullExportMatches).toBe(true);expect(result.reopenedPixels).toBe(true);expect(result.maxArea).toBeLessThanOrEqual(4_000_000);expect(result.maxSide).toBeLessThanOrEqual(8192);await info.attach('frequency-native-50mp',{body:JSON.stringify(result),contentType:'application/json'});
});

test('document-phase tone mixes projected native filter masks with feather, affine bases and density/inversion',async({page})=>{
 await setup(page);const result=await page.evaluate(async()=>{
  const {editor,Document,RasterLayer,PaintLayer,PaintFill,LayerMask,MarqueeSelection,AffineTransform,NativeCompositionFilter,DocumentToneFilter}=window.luma;
  const {CanvasRenderer}=await import(/* @vite-ignore */String('/src/engine/renderer.ts')),renderer=new CanvasRenderer(),master=new Document({width:64,height:32});master.layers.add(new RasterLayer({assetId:editor.assetStore.values()[0].id,width:64,height:32}));
  const doc=new Document({width:96,height:64}),component=doc.defineComponent(master),instance=doc.placeSmartObject(component,{width:32,height:16});instance.transform=new AffineTransform(.9,.3,-.2,1.1,20,15);
  const nativeWorld=instance.transform.multiply(AffineTransform.scale(.5,.5)),results=[];
  const render=async(data:InstanceType<typeof Document>)=>renderer.render(data.toJSON(),editor.assetStore,{cache:false,readback:true});
  try{
   for(const linked of [true,false])for(const inverted of [true,false])for(const density of [0,.6,1]){
    const mask=new LayerMask({selection:new MarqueeSelection({shape:'ellipse',x:5,y:4,width:38,height:20}),basis:new AffineTransform(1,.1,.2,1),x:linked?2:10,y:linked?1:8,feather:2,linked,inverted,density});instance.filterMask=mask;
    instance.setFilters([new NativeCompositionFilter()]);const base=await render(doc),input=base.getContext('2d')!.getImageData(0,0,96,64).data,toned=await renderer.processor.process(input.slice(),[{id:'reference',enabled:true,kind:'tone',exposure:.3,contrast:20,saturation:-15}]);base.width=base.height=0;
    const offset=AffineTransform.translation(mask.x,mask.y).multiply(mask.basis),basis=linked?offset:nativeWorld.inverse().multiply(offset),coverageDoc=new Document({width:64,height:32}),coverage=coverageDoc.layers.add(new PaintLayer());coverage.strokes.add(new PaintFill({bounds:{x:-128,y:-128,width:320,height:288},color:'#ffffff'}));coverage.mask=mask.with({linked:true,x:basis.e,y:basis.f,basis:new AffineTransform(basis.a,basis.b,basis.c,basis.d),density:1,inverted:false});
    // Filter masks can extend beyond the master's image frame. Keep coverage around that frame
    // so the independent oracle does not introduce a second image-edge alpha clamp.
    const nativeRegion={x:-32,y:-32,width:128,height:96},native=await renderer.render(coverageDoc.toJSON(),editor.assetStore,{region:nativeRegion,cache:false,readback:true}),projected=document.createElement('canvas');projected.width=96;projected.height=64;const c=projected.getContext('2d')!;c.setTransform(nativeWorld.a,nativeWorld.b,nativeWorld.c,nativeWorld.d,nativeWorld.e,nativeWorld.f);c.drawImage(native,nativeRegion.x,nativeRegion.y);const alpha=c.getImageData(0,0,96,64).data;native.width=native.height=0;projected.width=projected.height=0;
    instance.setFilters([new NativeCompositionFilter(),new DocumentToneFilter({exposure:.3,contrast:20,saturation:-15})]);const output=await render(doc),actual=output.getContext('2d')!.getImageData(0,0,96,64).data;let rgb=0,alphaError=0,changed=0;
    for(let p=0;p<input.length;p+=4){const weight=1-density+density*(inverted?1-alpha[p+3]/255:alpha[p+3]/255);alphaError=Math.max(alphaError,Math.abs(actual[p+3]-input[p+3]));for(let channel=0;channel<3;channel++){const expected=Math.round(input[p+channel]*(1-weight)+toned[p+channel]*weight);rgb=Math.max(rgb,Math.abs(Math.round(actual[p+channel]*actual[p+3]/255)-Math.round(expected*input[p+3]/255)));if(actual[p+channel]!==input[p+channel]&&input[p+3]>20)changed++;}}
    output.width=output.height=0;results.push({linked,inverted,density,rgb,alphaError,changed});
   }
  }finally{renderer.dispose();}return results;
 });console.log('Projected document-tone masks:',JSON.stringify(result));expect(result).toHaveLength(12);for(const row of result){expect(row.rgb,JSON.stringify(row)).toBeLessThanOrEqual(1);expect(row.alphaError,JSON.stringify(row)).toBe(0);}expect(result.some(row=>row.changed>0)).toBe(true);
});

test('retouching reuses the immutable captured-source Gaussian while cached and fresh pixels agree',async({page})=>{
 await setup(page);const result=await page.evaluate(async()=>{
  const {editor,SmartObjectLayer,PaintLayer,PaintFill}=window.luma,{CanvasRenderer}=await import(/* @vite-ignore */String('/src/engine/renderer.ts')),{allLayers}=await import(/* @vite-ignore */String('/src/core/model.ts'));
  await editor.separateFrequencies(editor.document.selectedLayer!.id,{sigma:2});const doc=editor.document,instance=doc.selectedLayer as InstanceType<typeof SmartObjectLayer>,renderer=new CanvasRenderer(),filter=renderer.processor.spatialFilter.bind(renderer.processor);let gaussians=0;
  renderer.processor.spatialFilter=async(...args:Parameters<import('../src/engine/processor').PixelProcessor['spatialFilter']>)=>{if(args[3].kind==='frequency-band')gaussians++;return filter(...args);};
  const read=async(cache:boolean)=>{const output=await renderer.render(doc.toJSON(),editor.assetStore,{cache,readback:true});try{return[...output.getContext('2d')!.getImageData(0,0,96,64).data];}finally{output.width=output.height=0;}};
  try{
   const seed=instance.editContents(),seedLayer=seed.getLayer(allLayers(seed.toJSON().children).find((layer:import('../src/core/model').LayerData)=>layer.name==='Color retouch')!.id) as InstanceType<typeof PaintLayer>;seedLayer.strokes.add(new PaintFill({bounds:{x:1,y:1,width:2,height:2},color:'#0000ff'}));instance.replaceContents(seed);
   const before=await read(true),first=gaussians;await read(true);const repeat=gaussians;
   const contents=instance.editContents(),retouch=contents.getLayer(allLayers(contents.toJSON().children).find((layer:import('../src/core/model').LayerData)=>layer.name==='Color retouch')!.id) as InstanceType<typeof PaintLayer>;retouch.strokes.add(new PaintFill({bounds:{x:8,y:8,width:24,height:16},color:'#ff0000'}));instance.replaceContents(contents);
   const after=await read(true),afterRetouch=gaussians,fresh=await read(false);return{first,repeat,afterRetouch,freshCalls:gaussians-afterRetouch,changed:JSON.stringify(before)!==JSON.stringify(after),freshMatches:JSON.stringify(fresh)===JSON.stringify(after)};
  }finally{renderer.dispose();}
 });console.log('Frequency Gaussian reuse:',JSON.stringify(result));expect(result.first).toBeGreaterThan(0);expect(result.repeat).toBe(result.first);expect(result.afterRetouch).toBe(result.first);expect(result.changed).toBe(true);expect(result.freshMatches).toBe(true);expect(result.freshCalls).toBeGreaterThan(0);
});

test('prepared native previews match actual bands, preserve source alpha and never publish history or assets before commit',async({page})=>{
 await setup(page);const result=await page.evaluate(async()=>{
  const {editor}=window.luma,{applySpatialFilter,instantiateKernel}=await import(/* @vite-ignore */String('/src/engine/wasm.ts'));
  const source=editor.document.selectedLayer!,before=editor.document.toJSON(),ids=editor.assetStore.values().map(a=>a.id),past=editor.document.getSnapshot().past.length,prepared=await editor.prepareFrequencySeparation(source.id);
  const original=editor.assetStore.values()[0],canvas=document.createElement('canvas');canvas.width=64;canvas.height=32;const c=canvas.getContext('2d')!;c.drawImage(original.bitmap,0,0);const pixels=c.getImageData(0,0,64,32).data,kernel=await instantiateKernel(await fetch('/wasm/pixels.wasm').then(r=>r.arrayBuffer())),results=[];
  try{
   for(const sigma of [0,1,3]){
    const frame=await prepared.preview({sigma}),expected=applySpatialFilter(kernel,pixels,64,32,{kind:'frequency-band',band:'low',sigmaX:sigma}),actual=frame.low.getContext('2d')!.getImageData(0,0,64,32).data;let error=0,alphaError=0;
    for(let p=0;p<pixels.length;p+=4){alphaError=Math.max(alphaError,Math.abs(actual[p+3]-pixels[p+3]));for(let channel=0;channel<3;channel++)error=Math.max(error,Math.abs(Math.round(actual[p+channel]*actual[p+3]/255)-Math.round(expected[p+channel]*pixels[p+3]/255)));}
    const dimensions=[frame.low.width,frame.high.width,frame.original.width],region=frame.region;frame.dispose();results.push({sigma,error,alphaError,dimensions,region,released:frame.low.width===0&&frame.high.width===0&&frame.original.width===0});
   }
   const untouched=JSON.stringify(before)===JSON.stringify(editor.document.toJSON()),assetsUnchanged=JSON.stringify(ids)===JSON.stringify(editor.assetStore.values().map(a=>a.id)),historyUnchanged=editor.document.getSnapshot().past.length===past;
   const abort=new AbortController();abort.abort();let cancelled=false;try{await prepared.preview({sigma:2},{signal:abort.signal});}catch{cancelled=true;}
   await prepared.commit({sigma:3});const after=editor.document.toJSON(),history=editor.document.getSnapshot().past.length-past;editor.document.undo();return{results,untouched,assetsUnchanged,historyUnchanged,cancelled,history,undo:JSON.stringify(editor.document.toJSON())===JSON.stringify(before),schema:after.schemaVersion};
  }finally{prepared.dispose();canvas.width=canvas.height=0;}
 });expect(result.untouched).toBe(true);expect(result.assetsUnchanged).toBe(true);expect(result.historyUnchanged).toBe(true);expect(result.cancelled).toBe(true);expect(result.history).toBe(1);expect(result.undo).toBe(true);expect(result.schema).toBe(40);for(const row of result.results){expect(row.error).toBeLessThanOrEqual(1);expect(row.alphaError).toBe(0);expect(row.released).toBe(true);expect(row.dimensions).toEqual([64,64,64]);}
});

test('live native preview responds to radius, pans with keyboard/pointer, compares original and cancels without document edits',async({page})=>{
 await page.goto('/');await page.evaluate(async()=>{
  const {editor,RasterLayer}=window.luma;editor.newDocument({width:640,height:320});const c=document.createElement('canvas');c.width=640;c.height=320;const context=c.getContext('2d')!,image=context.createImageData(640,320);for(let y=0;y<320;y++)for(let x=0;x<640;x++)image.data.set([(x*31+y*7)%256,(x*9+y*43)%256,(x*17+y*11)%256,255],(y*640+x)*4);context.putImageData(image,0,0);const blob=await new Promise<Blob>(r=>c.toBlob(v=>r(v!))),asset=await editor.assetStore.add(blob,'Preview source',undefined,false);editor.document.selectedLayer=editor.document.layers.add(new RasterLayer({assetId:asset.id,width:640,height:320}));
 });const before=await page.evaluate(()=>({model:window.luma.editor.document.toJSON(),assets:window.luma.editor.assetStore.values().map(a=>a.id)}));
 await page.keyboard.press('Control+k');await page.getByRole('combobox',{name:'Search commands'}).fill('Frequency separation');await page.getByRole('option',{name:/Frequency separation/}).click();const dialog=page.getByRole('dialog',{name:'Frequency separation',exact:true}),create=dialog.getByRole('button',{name:'Create frequency layers',exact:true});await expect(create).toBeEnabled();
 const low=page.getByRole('img',{name:'Color and tone preview',exact:true}),initial=await low.evaluate(node=>(node as HTMLCanvasElement).toDataURL());const radius=dialog.getByLabel('Separation radius value',{exact:true});await radius.fill('8');await radius.press('Enter');await expect(dialog.locator('.frequency-preview-caption')).toContainText('radius 8.0 px');await expect(create).toBeEnabled();expect(await low.evaluate(node=>(node as HTMLCanvasElement).toDataURL())).not.toBe(initial);
 await low.focus();await page.keyboard.press('Shift+ArrowRight');await expect(dialog.locator('.frequency-preview-caption')).toContainText('202, 64');const box=(await low.boundingBox())!;await page.mouse.move(box.x+100,box.y+80);await page.mouse.down();await page.mouse.move(box.x+80,box.y+80,{steps:3});await page.mouse.up();await expect(dialog.locator('.frequency-preview-caption')).toContainText('222, 64');
 await dialog.getByRole('button',{name:'Show original',exact:true}).click();await expect(page.getByRole('img',{name:'Original source preview',exact:true})).toBeVisible();await expect(dialog.getByRole('button',{name:'Show original',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);expect(await page.evaluate(()=>({model:window.luma.editor.document.toJSON(),assets:window.luma.editor.assetStore.values().map(a=>a.id)}))).toEqual(before);
});

test('shared radius controls derive every band, preserve protected metadata and support preview cancellation and one undo',async({page})=>{
 await setup(page);await page.evaluate(async()=>{const {editor}=window.luma;await editor.separateFrequencies(editor.document.selectedLayer!.id,{sigma:2});});await page.getByRole('button',{name:'Edit contents',exact:true}).click();await expect(page.getByRole('region',{name:'Smart-object contents'})).toBeVisible();
 await page.evaluate(()=>{const {editor,SmartObjectLayer}=window.luma;const visit=(nodes:any):any[]=>Array.from(nodes).flatMap((node:any)=>node.layers?[node,...visit(node.layers)]:[node]);editor.document.selectedLayer=visit(editor.document.layers).find(node=>node instanceof SmartObjectLayer&&node.name==='Color and tone source');});
 await page.evaluate(()=>{const {editor,PaintLayer,LayerGroup}=window.luma;const group=editor.document.layers.at(0);if(!(group instanceof LayerGroup))throw new Error('Missing group');group.layers.add(new PaintLayer({name:'Unfiltered reference probe'}));});
 const field=page.getByLabel('Shared separation radius value',{exact:true}),before=await page.evaluate(()=>window.luma.editor.document.toJSON());await expect(field).toHaveValue('2');const slider=page.getByRole('slider',{name:'Shared separation radius',exact:true});await slider.focus();await page.keyboard.down('ArrowRight');await page.keyboard.press('Escape');await page.keyboard.up('ArrowRight');await expect(field).toHaveValue('2');expect(await page.evaluate(()=>window.luma.editor.document.toJSON())).toEqual(before);
 await field.fill('5');await field.press('Enter');await expect(field).toHaveValue('5');const result=await page.evaluate(async()=>{
  const {editor}=window.luma,{CanvasRenderer}=await import(/* @vite-ignore */String('/src/engine/renderer.ts')),renderer=new CanvasRenderer(),filter=renderer.processor.spatialFilter.bind(renderer.processor),radii:number[]=[];
  renderer.processor.spatialFilter=async(...args:Parameters<import('../src/engine/processor').PixelProcessor['spatialFilter']>)=>{if(args[3].kind==='frequency-band')radii.push(args[3].sigmaX);return filter(...args);};
  try{const canvas=await renderer.render(editor.document.toJSON(),editor.assetStore,{cache:false});canvas.width=canvas.height=0;return{radii,model:editor.document.toJSON()};}finally{renderer.dispose();}
 });expect(result.radii).toEqual([5]);const beforeGroup=before.children[0],afterGroup=result.model.children[0];if(beforeGroup.kind!=='group'||afterGroup.kind!=='group')throw new Error('Missing frequency group');expect(afterGroup.children).toEqual(beforeGroup.children);expect(afterGroup.frequencyRadius).toBe(5);await page.getByLabel('Editing canvas',{exact:true}).focus();await page.keyboard.press('Control+z');expect(await page.evaluate(()=>window.luma.editor.document.toJSON())).toEqual(before);
});

test('preview frames survive private disposal and a failed radius preflight can retry without consuming the native capture',async({page})=>{
 await setup(page);const result=await page.evaluate(async()=>{
  const {editor}=window.luma,before=editor.document.toJSON(),source=editor.document.selectedLayer!,ids=editor.assetStore.values().map(a=>a.id),prepared=await editor.prepareFrequencySeparation(source.id);
  const frame=await prepared.preview({sigma:2}),pixels=frame.low.toDataURL();prepared.dispose();const retained=frame.low.toDataURL()===pixels;let disposed=false;try{await prepared.preview({sigma:2});}catch{disposed=true;}frame.dispose();
  const retry=await editor.prepareFrequencySeparation(source.id);let failed=false;
  try{await retry.commit({sigma:1200});}catch{failed=true;}
  const untouched=JSON.stringify(before)===JSON.stringify(editor.document.toJSON()),assetsUnchanged=JSON.stringify(ids)===JSON.stringify(editor.assetStore.values().map(a=>a.id));
  try{await retry.commit({sigma:2});editor.document.undo();return{retained,disposed,failed,untouched,assetsUnchanged,undo:JSON.stringify(before)===JSON.stringify(editor.document.toJSON())};}finally{retry.dispose();}
 });expect(result).toEqual({retained:true,disposed:true,failed:true,untouched:true,assetsUnchanged:true,undo:true});
});

test('identity and regional retouch shortcuts match forced native decomposition at transparent affine edges and original tone',async({page})=>{
 await setup(page);const result=await page.evaluate(async()=>{
  const {editor,RasterLayer,AffineTransform,PaintLayer,PaintFill}=window.luma,{CanvasRenderer}=await import(/* @vite-ignore */String('/src/engine/renderer.ts')),{allLayers}=await import(/* @vite-ignore */String('/src/core/model.ts'));
  const source=editor.document.selectedLayer as InstanceType<typeof RasterLayer>;source.transform=new AffineTransform(.9,.3,-.2,1.1,20,15);source.opacity=.7;source.setTone({contrast:15,saturation:-20});await editor.separateFrequencies(source.id,{sigma:2});
  const instance=editor.document.selectedLayer as import('../src/dom').SmartObjectLayer,renderer=new CanvasRenderer(),filter=renderer.processor.spatialFilter.bind(renderer.processor);let calls=0;
  renderer.processor.spatialFilter=async(...args:Parameters<import('../src/engine/processor').PixelProcessor['spatialFilter']>)=>{if(args[3].kind==='frequency-band')calls++;return filter(...args);};
  const read=async()=>{const canvas=await renderer.render(editor.document.toJSON(),editor.assetStore,{cache:false,readback:true});try{return[...canvas.getContext('2d')!.getImageData(0,0,96,64).data];}finally{canvas.width=canvas.height=0;}};
  try{
   const fast=await read(),fastCalls=calls,contents=instance.editContents();contents.layers.add(new PaintLayer({name:'Exact reference probe'}));instance.replaceContents(contents);const reference=await read(),referenceCalls=calls-fastCalls;
   const edited=instance.editContents(),probe=edited.layers.at(1)!;probe.remove();const retouch=edited.getLayer(allLayers(edited.toJSON().children).find((layer:import('../src/core/model').LayerData)=>layer.name==='Color retouch')!.id) as InstanceType<typeof PaintLayer>;retouch.strokes.add(new PaintFill({bounds:{x:10,y:8,width:12,height:10},color:'#ff0000'}));instance.replaceContents(edited);
   const retouched=await read(),forced=instance.editContents();forced.layers.add(new PaintLayer({name:'Exact edited reference probe'}));instance.replaceContents(forced);const editedReference=await read();
   const delta=(a:number[],b:number[])=>{let rgb=0,alpha=0;for(let p=0;p<a.length;p+=4){alpha=Math.max(alpha,Math.abs(a[p+3]-b[p+3]));for(let c=0;c<3;c++)rgb=Math.max(rgb,Math.abs(Math.round(a[p+c]*a[p+3]/255)-Math.round(b[p+c]*b[p+3]/255)));}return{rgb,alpha};};
   return{initial:delta(fast,reference),edited:delta(retouched,editedReference),fastCalls,referenceCalls,retouchChanged:JSON.stringify(retouched)!==JSON.stringify(fast)};
  }finally{renderer.dispose();}
 });console.log('Exact native frequency shortcuts:',JSON.stringify(result));expect(result.fastCalls).toBe(0);expect(result.referenceCalls).toBe(1);expect(result.initial).toEqual({rgb:0,alpha:0});expect(result.edited).toEqual({rgb:0,alpha:0});expect(result.retouchChanged).toBe(true);
});

test('coupled native band rasterization and cross-document copy preserve effective radius and exact pixels',async({page})=>{
 await setup(page);const result=await page.evaluate(async()=>{
  const {editor,Document,LayerGroup,SmartObjectLayer,FrequencyBandFilter}=window.luma,source=editor.document.layers.at(0)!.toJSON();if(source.kind!=='raster')throw new Error('Missing source');
  const master=new Document({width:64,height:32});master.layers.add(new window.luma.RasterLayer({assetId:source.assetId,width:64,height:32}));const id=editor.document.defineComponent(master),group=editor.document.layers.add(new LayerGroup({frequencyRadius:5}));editor.document.layers.at(0)!.visible=false;
  const instance=group.layers.add(new SmartObjectLayer({componentId:id,width:64,height:32}));instance.setFilters([new FrequencyBandFilter({sigma:1,band:'low'})]);editor.document.selectedLayer=instance;
  const read=async()=>{const image=await createImageBitmap(await editor.exportPng()),c=document.createElement('canvas');c.width=96;c.height=64;c.getContext('2d')!.drawImage(image,0,0);image.close();const p=[...c.getContext('2d')!.getImageData(0,0,96,64).data];c.width=c.height=0;return p;};
  const before=await read(),model=editor.document.toJSON(),owner=editor.document;const raster=await instance.rasterize(),rasterized=await read();owner.undo();const undo=JSON.stringify(model)===JSON.stringify(owner.toJSON());owner.selectedLayer=owner.getLayer(instance.id);const target=editor.newDocument({width:96,height:64});editor.activateDocument(owner);const copies=await editor.copySelectedLayersTo(target);editor.activateDocument(target);const copied=await read();
  return{undo,rasterKind:raster.kind,rasterMatches:JSON.stringify(before)===JSON.stringify(rasterized),copyMatches:JSON.stringify(before)===JSON.stringify(copied),fallback:(copies[0] as InstanceType<typeof SmartObjectLayer>).smartFilters[0]};
 });expect(result.undo).toBe(true);expect(result.rasterKind).toBe('raster');expect(result.rasterMatches).toBe(true);expect(result.copyMatches).toBe(true);expect(result.fallback).toMatchObject({sigma:5});
});

test('rapid radius changes keep one preview active and publish only the latest requested native frame',async({page})=>{
 await setup(page);await page.evaluate(()=>{
  const {editor}=window.luma,prepare=editor.prepareFrequencySeparation.bind(editor);let release!:()=>void;
  const gate=new Promise<void>(resolve=>release=resolve),state={calls:[] as number[],active:0,max:0,release};(window as any).previewQueue=state;
  editor.prepareFrequencySeparation=async(...args)=>{const prepared=await prepare(...args),preview=prepared.preview.bind(prepared);let first=true;prepared.preview=async(...args)=>{state.calls.push(args[0].sigma);state.active++;state.max=Math.max(state.max,state.active);try{if(first){first=false;await gate;}return await preview(...args);}finally{state.active--;}};return prepared;};
 });const before=await page.evaluate(()=>window.luma.editor.document.toJSON());
 await page.keyboard.press('Control+k');await page.getByRole('combobox',{name:'Search commands'}).fill('Frequency separation');await page.getByRole('option',{name:/Frequency separation/}).click();await expect.poll(()=>page.evaluate(()=>(window as any).previewQueue.calls.length)).toBe(1);
 const radius=page.getByLabel('Separation radius value',{exact:true});for(const value of ['1','2','3','6','9']){await radius.fill(value);await radius.press('Enter');}
 expect(await page.evaluate(()=>(window as any).previewQueue.calls)).toEqual([4]);await page.evaluate(()=>(window as any).previewQueue.release());await expect(page.locator('.frequency-preview-caption')).toContainText('radius 9.0 px');await expect(page.getByRole('button',{name:'Create frequency layers',exact:true})).toBeEnabled();
 expect(await page.evaluate(()=>({calls:(window as any).previewQueue.calls,max:(window as any).previewQueue.max}))).toEqual({calls:[4,9],max:1});await page.getByRole('button',{name:'Cancel',exact:true}).click();expect(await page.evaluate(()=>window.luma.editor.document.toJSON())).toEqual(before);
});

test('localized retouch on a 50 MP separation preserves every untouched pixel and filters only intersecting native regions',async({page},info)=>{
 test.setTimeout(600000);await page.goto('/');await page.getByTestId('import-input').setInputFiles('tests/fixtures/psd/native-50mp.png');await expect(page.locator('.layer-row')).toHaveCount(1,{timeout:120000});
 const result=await page.evaluate(async()=>{
  const {editor,Document,PaintLayer,PaintFill}=window.luma,{allLayers}=await import(/* @vite-ignore */String('/src/core/model.ts')),{CanvasRenderer}=await import(/* @vite-ignore */String('/src/engine/renderer.ts')),{exportPng}=await import(/* @vite-ignore */String('/src/engine/png.ts'));
  const original=editor.document.layers.at(0)!;editor.document.selectedLayer=original;await editor.separateFrequencies(original.id,{sigma:2});
  const instance=editor.document.selectedLayer as import('../src/dom').SmartObjectLayer,contents=instance.editContents(),retouch=contents.getLayer(allLayers(contents.toJSON().children).find((layer:import('../src/core/model').LayerData)=>layer.name==='Color retouch')!.id) as InstanceType<typeof PaintLayer>;
  retouch.strokes.add(new PaintFill({bounds:{x:9000,y:4000,width:32,height:24},color:'#00cc66'}));instance.replaceContents(contents);
  const renderer=new CanvasRenderer();await renderer.processor.ready;const data=editor.document.toJSON(),reference=Document.fromJSON(data),referenceInstance=reference.getLayer(instance.id) as import('../src/dom').SmartObjectLayer,forced=referenceInstance.editContents();forced.layers.add(new PaintLayer({name:'Force complete decomposition reference'}));referenceInstance.replaceContents(forced);
  const region={x:8960,y:3960,width:280,height:96},sample=await renderer.render(reference.toJSON(),editor.assetStore,{region,cache:false,readback:true});const expected=sample.getContext('2d')!.getImageData(0,0,region.width,region.height).data;sample.width=sample.height=0;
  let gaussianCalls=0,gaussianPixels=0;const spatial=renderer.processor.spatialFilter.bind(renderer.processor);renderer.processor.spatialFilter=async(...args:Parameters<import('../src/engine/processor').PixelProcessor['spatialFilter']>)=>{if(args[3].kind==='frequency-band'){gaussianCalls++;gaussianPixels+=args[0].length/4;}return spatial(...args);};
  try{
   const start=performance.now(),png=await exportPng(data,editor.assetStore,renderer),exportMs=performance.now()-start,bitmap=await createImageBitmap(png),size=[bitmap.width,bitmap.height],canvas=document.createElement('canvas');canvas.width=region.width;canvas.height=region.height;canvas.getContext('2d')!.drawImage(bitmap,region.x,region.y,region.width,region.height,0,0,region.width,region.height);bitmap.close();const actual=canvas.getContext('2d')!.getImageData(0,0,region.width,region.height).data;canvas.width=canvas.height=0;
   let maxDelta=0;for(let p=0;p<expected.length;p++)maxDelta=Math.max(maxDelta,Math.abs(expected[p]-actual[p]));
   const encoded=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(png);});
   return{exportMs,size,maxDelta,gaussianCalls,gaussianPixels,encoded};
  }finally{renderer.dispose();}
 });
 const {encoded,...metrics}=result;console.log('Localized native 50 MP frequency retouch:',JSON.stringify(metrics));expect(result.size).toEqual([10000,5000]);expect(result.maxDelta).toBe(0);expect(result.gaussianCalls).toBeGreaterThan(0);expect(result.gaussianPixels).toBeLessThan(5_000_000);
 const {writeFile}=await import('node:fs/promises'),{execFileSync}=await import('node:child_process'),path=info.outputPath('localized-frequency-50mp.png');await writeFile(path,Buffer.from(encoded,'base64'));
 const audit=JSON.parse(execFileSync(process.env.CANOLI_PSB_PYTHON??'/tmp/canoli-psb-check/bin/python',['-c',`from PIL import Image
import numpy as np,json,sys
before=np.asarray(Image.open(sys.argv[1]).convert('RGBA'));after=np.asarray(Image.open(sys.argv[2]).convert('RGBA'))
assert before.shape==after.shape==(5000,10000,4)
changed=np.any(before!=after,axis=2);inside=int(np.count_nonzero(changed[4000:4024,9000:9032]));changed[4000:4024,9000:9032]=False
print(json.dumps({'changedInside':inside,'changedOutside':int(np.count_nonzero(changed))}))`,'tests/fixtures/psd/native-50mp.png',path],{encoding:'utf8'}));
 expect(audit.changedInside).toBeGreaterThan(0);expect(audit.changedOutside).toBe(0);await info.attach('localized-frequency-50mp',{body:JSON.stringify({...metrics,...audit}),contentType:'application/json'});
});

test('workspace reload and portable radius recipes retain editable frequency contents, source bytes and one-step parent undo',async({page})=>{
 await setup(page);const saved=await page.evaluate(async()=>{
  const {editor,LayerGroup}=window.luma;await editor.separateFrequencies(editor.document.selectedLayer!.id,{sigma:2});const owner=editor.document,instance=owner.selectedLayer as import('../src/dom').SmartObjectLayer,contents=await editor.editSmartObject(instance),group=contents.layers.at(0) as InstanceType<typeof LayerGroup>;contents.selectedLayer=group;
  const hash=async(blob:Blob)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('');const hashes=await Promise.all(editor.assetStore.values().map(async asset=>({id:asset.id,hash:await hash(asset.blob)})));
  const model=contents.toJSON(),parent=owner.toJSON();editor.recipes.startRecording();group.frequencyRadius=5;const recipe=await editor.recipes.stopRecording({name:'Frequency radius five'});const file=await editor.recipes.exportRecipePackage(recipe);await editor.recipes.packages.save(file);const pixels=await editor.exportPng(),expected=await hash(pixels);contents.undo();await editor.saveWorkspace();return{model,parent,hashes,recipe:recipe.id,expected,instance:instance.id,owner:owner.id};
 });await page.reload();const result=await page.evaluate(async saved=>{
  const {editor,LayerGroup}=window.luma;await editor.restoreWorkspace();const contents=editor.document,group=contents.layers.at(0) as InstanceType<typeof LayerGroup>,hash=async(blob:Blob)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join(''),restored=JSON.stringify(contents.toJSON())===JSON.stringify(saved.model),hashes=await Promise.all(editor.assetStore.values().map(async asset=>({id:asset.id,hash:await hash(asset.blob)})));
  await editor.recipes.executeSavedPackage(saved.recipe);const radius=group.frequencyRadius,pixelsMatch=await hash(await editor.exportPng())===saved.expected,childrenUnchanged=JSON.stringify((group.toJSON() as import('../src/core/model').GroupLayerData).children)===JSON.stringify((saved.model.children[0] as import('../src/core/model').GroupLayerData).children);contents.undo();const recipeUndo=JSON.stringify(contents.toJSON())===JSON.stringify(saved.model);contents.redo();await editor.applySmartObjectContents();
  const owner=editor.openDocuments.find(document=>document.id===saved.owner)!;const instance=owner.getLayer(saved.instance) as import('../src/dom').SmartObjectLayer,applied=(instance.editContents().layers.at(0) as InstanceType<typeof LayerGroup>).frequencyRadius;owner.undo();return{restored,hashes,radius,pixelsMatch,childrenUnchanged,recipeUndo,applied,parentUndo:JSON.stringify(owner.toJSON())===JSON.stringify(saved.parent)};
 },saved);expect(result).toEqual({restored:true,hashes:saved.hashes,radius:5,pixelsMatch:true,childrenUnchanged:true,recipeUndo:true,applied:5,parentUndo:true});
});

test('a failed commit keeps its error visible and can retry the same prepared radius without partial document edits',async({page})=>{
 await setup(page);await page.evaluate(()=>{const {editor}=window.luma,prepare=editor.prepareFrequencySeparation.bind(editor);editor.prepareFrequencySeparation=async(...args)=>{const prepared=await prepare(...args),commit=prepared.commit.bind(prepared);let failed=false;prepared.commit=async(...args)=>{if(!failed){failed=true;throw new Error('Temporary output storage failure. Retry the operation.');}return commit(...args);};return prepared;};});
 const before=await page.evaluate(()=>({document:window.luma.editor.document.toJSON(),assets:window.luma.editor.assetStore.values().map(asset=>asset.id),past:window.luma.editor.document.getSnapshot().past.length}));
 await page.keyboard.press('Control+k');await page.getByRole('combobox',{name:'Search commands'}).fill('Frequency separation');await page.getByRole('option',{name:/Frequency separation/}).click();const create=page.getByRole('button',{name:'Create frequency layers',exact:true});await expect(create).toBeEnabled();await create.click();await expect(page.getByRole('alert')).toContainText('Temporary output storage failure');await expect(create).toBeEnabled();expect(await page.evaluate(()=>({document:window.luma.editor.document.toJSON(),assets:window.luma.editor.assetStore.values().map(asset=>asset.id),past:window.luma.editor.document.getSnapshot().past.length}))).toEqual(before);
 await create.click();await expect(page.getByRole('dialog')).toHaveCount(0);expect(await page.evaluate(()=>window.luma.editor.document.getSnapshot().past.length)).toBe(before.past+1);await page.evaluate(()=>window.luma.editor.document.undo());expect(await page.evaluate(()=>window.luma.editor.document.toJSON())).toEqual(before.document);
});

test('the documented shared-radius script commits through isolation without changing the protected child',async({page})=>{
 const {readFile}=await import('node:fs/promises'),guide=await readFile('docs/SCRIPTING_API.md','utf8'),code=guide.match(/<!-- example: frequency-shared-radius -->\s*```js\n([\s\S]*?)\n```/)?.[1];expect(code).toBeTruthy();await setup(page);
 const result=await page.evaluate(async code=>{const {editor,LayerGroup}=window.luma;await editor.separateFrequencies(editor.document.selectedLayer!.id,{sigma:2});await editor.editSmartObject(editor.document.selectedLayer as import('../src/dom').SmartObjectLayer);const group=editor.document.layers.at(0) as InstanceType<typeof LayerGroup>;editor.document.selectedLayer=group.layers.at(2)!;const before=editor.document.toJSON(),past=editor.document.getSnapshot().past.length,logs=await editor.runScript(code!);const radius=group.frequencyRadius,childrenUnchanged=JSON.stringify((group.toJSON() as import('../src/core/model').GroupLayerData).children)===JSON.stringify((before.children[0] as import('../src/core/model').GroupLayerData).children),history=editor.document.getSnapshot().past.length-past;editor.document.undo();return{radius,childrenUnchanged,history,logs,undo:JSON.stringify(before)===JSON.stringify(editor.document.toJSON())};},code);
 expect(result).toMatchObject({radius:6,childrenUnchanged:true,history:1,undo:true});expect(result.logs.join(' ')).toContain('Shared native radius 6');
});
