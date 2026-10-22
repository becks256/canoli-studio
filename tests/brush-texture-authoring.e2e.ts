import {expect,test} from '@playwright/test';

test('an opaque inverted alpha texture produces no ink, including transformed footprint edges',async({page},info)=>{
  await page.goto('/');const result=await page.evaluate(async()=>{
    const {editor,BrushTexture,BrushStroke,BrushTip,PaintLayer,AffineTransform}=window.luma;
    editor.newDocument({width:96,height:96});
    const source=document.createElement('canvas');source.width=source.height=8;source.getContext('2d')!.fillRect(0,0,8,8);
    const blob=await new Promise<Blob>(resolve=>source.toBlob(value=>resolve(value!)));source.width=source.height=0;
    const asset=await editor.assetStore.add(blob,'Opaque alpha',undefined,false),layer=editor.document.layers.add(new PaintLayer());
    layer.transform=new AffineTransform(1,.2,.3,1,0,0);
    layer.strokes.add(new BrushStroke({points:[{x:32.5,y:32.5}],size:30,pressureSize:false,hardness:1,color:'#ffffff',
      tip:new BrushTip({roundness:.5,angle:37}),texture:new BrushTexture({assetId:asset.id,channel:'alpha',invert:true})}));
    const pixels=await createImageBitmap(await editor.exportPng()),canvas=document.createElement('canvas');canvas.width=canvas.height=96;
    try{canvas.getContext('2d')!.drawImage(pixels,0,0);const data=canvas.getContext('2d')!.getImageData(0,0,96,96).data;let nonzero=0,maxAlpha=0;for(let i=3;i<data.length;i+=4){if(data[i])nonzero++;maxAlpha=Math.max(maxAlpha,data[i]);}return{nonzero,maxAlpha};}
    finally{pixels.close();canvas.width=canvas.height=0;}
  });await info.attach('inverted-alpha-endpoint',{body:JSON.stringify(result),contentType:'application/json'});expect(result).toEqual({nonzero:0,maxAlpha:0});
});

for(const channel of ['alpha','luminance'] as const)for(const invert of [false,true])test(`authored ${channel}/${invert} coverage has analytic native/SVG quadrants and retains original project bytes`,async({page},info)=>{
 await page.goto('/');const result=await page.evaluate(async({channel,invert})=>{
  const {editor,BrushTexture,BrushStroke,PaintLayer}=window.luma;editor.newDocument({width:64,height:64});
  const source=document.createElement('canvas');source.width=source.height=8;const context=source.getContext('2d')!;
  context.fillStyle='#000000';context.fillRect(0,0,4,4);context.fillStyle='#ffffff';context.fillRect(4,0,4,4);context.fillStyle='rgba(255,0,0,0.5019607843137255)';context.fillRect(0,4,4,4);
  const blob=await new Promise<Blob>(resolve=>source.toBlob(value=>resolve(value!)));source.width=source.height=0;
  const hash=async(blob:Blob)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].join(','),sourceHash=await hash(blob);
  const asset=await editor.assetStore.add(blob,'Coverage quadrants',undefined,false),layer=editor.document.layers.add(new PaintLayer());
  layer.strokes.add(new BrushStroke({points:[{x:32,y:32}],size:32,hardness:1,color:'#ff0000',pressureSize:false,texture:new BrushTexture({assetId:asset.id,channel,invert})}));
  const sample=async(blob:Blob)=>{const image=new Image(),url=URL.createObjectURL(blob),canvas=document.createElement('canvas');canvas.width=canvas.height=64;
   try{image.src=url;await image.decode();const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);return [[24,24],[40,24],[24,40],[40,40],[0,0]].map(([x,y])=>[...ctx.getImageData(x,y,1,1).data]);}finally{URL.revokeObjectURL(url);canvas.width=canvas.height=0;}};
  const native=await sample(await editor.exportPng()),svgBlob=(await editor.export({format:'svg'})).blob,svg=await sample(svgBlob),svgText=await svgBlob.text(),saved=editor.document.toJSON(),project=await editor.saveProject();
  await editor.openProject(new File([project],'texture-only.luma'));const reopened=await sample(await editor.exportPng());
  return{native,svg,reopened,sameSource:await hash(editor.assetStore.get(asset.id).blob)===sourceHash,sameModel:JSON.stringify(saved)===JSON.stringify(editor.document.toJSON()),sourceWidth:editor.assetStore.get(asset.id).width,sourceHeight:editor.assetStore.get(asset.id).height,coverageImage:svgText.includes('width="8" height="8"'),colorFilter:svgText.includes('feColorMatrix')};
 },{channel,invert});
 const alpha=channel==='alpha'?(invert?[0,0,127,255,0]:[255,255,128,0,0]):(invert?[0,255,27,0,0]:[255,0,101,0,0]);
 const expected=alpha.map(a=>a?[255,0,0,a]:[0,0,0,0]);
 await info.attach('authored-native-svg-quadrants',{body:JSON.stringify({channel,invert,expected,result}),contentType:'application/json'});
 expect(result.native).toEqual(expected);expect(result.svg).toEqual(expected);expect(result.reopened).toEqual(expected);expect(result).toMatchObject({sameSource:true,sameModel:true,sourceWidth:8,sourceHeight:8,coverageImage:true,colorFilter:false});
});

for(const target of ['mask','filter-mask','erasure','tonal'] as const)test(`authored ${target} textures invalidate warmed coverage and preserve exact one-step undo`,async({page})=>{
 await page.goto('/');const result=await page.evaluate(async target=>{
  const {editor,Document,BrushTexture,BrushStroke,EraserStroke,LayerMask,PaintLayer,PaintFill,RasterLayer,SmartToneFilter}=window.luma;
  editor.newDocument({width:64,height:64});const source=document.createElement('canvas');source.width=source.height=8;const c=source.getContext('2d')!;c.fillRect(0,0,4,8);c.fillStyle='#ffffff';c.fillRect(4,0,4,8);
  const blob=await new Promise<Blob>(resolve=>source.toBlob(value=>resolve(value!)));source.width=source.height=0;
  const asset=await editor.assetStore.add(blob,'Half ink',undefined,false),texture=new BrushTexture({assetId:asset.id});
  let host:import('../src/dom').Layer;
  if(target==='filter-mask'){
   const master=new Document({width:64,height:64}),paint=master.layers.add(new PaintLayer());paint.strokes.add(new PaintFill({color:'#808080',bounds:{x:0,y:0,width:64,height:64}}));
   const smart=editor.document.placeSmartObject(editor.document.defineComponent(master));smart.addFilter(new SmartToneFilter({exposure:1}));host=smart;
  }else if(target==='erasure'){
   const canvas=document.createElement('canvas');canvas.width=canvas.height=64;canvas.getContext('2d')!.fillStyle='#808080';canvas.getContext('2d')!.fillRect(0,0,64,64);
   const original=await editor.assetStore.add(await new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!))),'Gray',undefined,false);canvas.width=canvas.height=0;
   host=editor.document.layers.add(new RasterLayer({assetId:original.id,width:64,height:64}));
  }else{const paint=editor.document.layers.add(new PaintLayer());paint.strokes.add(new PaintFill({color:'#808080',bounds:{x:0,y:0,width:64,height:64}}));host=paint;}
  const set=(invert:boolean)=>{const options={points:[{x:32,y:32}],size:32,hardness:1,pressureSize:false,texture:texture.with({invert})};
   if(target==='erasure')(host as import('../src/dom').RasterLayer).erase(new EraserStroke(options));
   else if(target==='tonal')editor.document.applyTonalSculpt(options.points,'dodge','midtones',.5,{size:options.size,hardness:options.hardness,pressureSize:options.pressureSize,texture:options.texture});
   else{const mask=new LayerMask({base:1,strokes:[{mode:'hide',stroke:new BrushStroke(options)}]});if(target==='filter-mask')(host as import('../src/dom').SmartObjectLayer).filterMask=mask;else host.mask=mask;}
  };
  const pixels=async(cache=true)=>{const canvas=await editor.renderer.render(editor.document.getSnapshot().document,editor.assetStore,{cache,readback:true});try{return [...canvas.getContext('2d')!.getImageData(0,0,64,64).data];}finally{canvas.width=canvas.height=0;}};
  set(false);const first=await pixels(),before=JSON.stringify(editor.document.toJSON());await pixels();set(true);const warm=await pixels(),cold=await pixels(false);editor.document.undo();const undo=await pixels();
  return{changed:JSON.stringify(first)!==JSON.stringify(warm),cacheExact:JSON.stringify(warm)===JSON.stringify(cold),undoExact:JSON.stringify(first)===JSON.stringify(undo),undoModel:JSON.stringify(editor.document.toJSON())===before};
 },target);expect(result).toEqual({changed:true,cacheExact:true,undoExact:true,undoModel:true});
});

test('documented BrushTexture example runs in the actual sandbox with source validation and atomic undo',async({page})=>{
 await page.goto('/');await page.evaluate(async()=>{const {editor}=window.luma;editor.newDocument({width:64,height:64});const canvas=document.createElement('canvas');canvas.width=canvas.height=8;canvas.getContext('2d')!.fillRect(0,0,8,8);const blob=await new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!)));canvas.width=canvas.height=0;await editor.importImage(new File([blob],'Black texture.png',{type:'image/png'}));editor.document.resize(64,64);});
 const before=await page.evaluate(()=>window.luma.editor.document.toJSON()),{readFile}=await import('node:fs/promises'),guide=await readFile('docs/SCRIPTING_API.md','utf8'),code=guide.split('<!-- example: brush-texture -->')[1].split('```js\n')[1].split('```')[0];
 await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();await page.getByLabel('Script code',{exact:true}).fill(code);await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('Image-backed ink ready');
 const result=await page.evaluate(async()=>{const {editor}=window.luma,bitmap=await createImageBitmap(await editor.exportPng()),canvas=document.createElement('canvas');canvas.width=canvas.height=64;canvas.getContext('2d')!.drawImage(bitmap,0,0);bitmap.close();const center=[...canvas.getContext('2d')!.getImageData(32,32,1,1).data];canvas.width=canvas.height=0;const model=editor.document.toJSON();editor.document.undo();return{center,model,undo:editor.document.toJSON()};});
 expect(result.center).toEqual([255,0,0,255]);expect(result.model.schemaVersion).toBe(40);expect(result.model.children[0].visible).toBe(false);expect(result.undo).toEqual(before);
 await page.getByLabel('Script code',{exact:true}).fill("document.name='Uncommitted';document.layers.add(new PaintLayer()).strokes.add(new BrushStroke({points:[{x:10,y:10}],texture:new BrushTexture({assetId:'missing-source'})}));");await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText(/Missing image asset/i);expect(await page.evaluate(()=>window.luma.editor.document.toJSON())).toEqual(before);
});

test('redo-only authored texture keeps its source through real workspace save/reload',async({page})=>{
 await page.goto('/');const expected=await page.evaluate(async()=>{const {editor,BrushTexture,BrushStroke,PaintLayer}=window.luma;await editor.initializeWorkspaceRecovery();editor.newDocument({name:'Texture redo memory',width:64,height:64});const c=document.createElement('canvas');c.width=c.height=8;c.getContext('2d')!.fillRect(0,0,8,8);const blob=await new Promise<Blob>(resolve=>c.toBlob(value=>resolve(value!)));c.width=c.height=0;const asset=await editor.assetStore.add(blob,'Redo-only grain',undefined,false),layer=editor.document.layers.add(new PaintLayer());layer.strokes.add(new BrushStroke({points:[{x:32,y:32}],size:32,hardness:1,color:'#ff0000',texture:new BrushTexture({assetId:asset.id})}));const model=editor.document.toJSON(),bytes=[...new Uint8Array(await blob.arrayBuffer())];editor.document.undo();await editor.saveWorkspace();return{model,bytes,assetId:asset.id};});
 await page.reload();const result=await page.evaluate(async id=>{const {editor}=window.luma;await editor.initializeWorkspaceRecovery();await editor.restoreWorkspace();const doc=editor.openDocuments.find(doc=>doc.name==='Texture redo memory');if(!doc)throw new Error('Missing texture workspace');editor.activateDocument(doc);const hadRedo=doc.canRedo;doc.redo();return{hadRedo,model:doc.toJSON(),bytes:[...new Uint8Array(await editor.assetStore.get(id).blob.arrayBuffer())],width:editor.assetStore.get(id).width};},expected.assetId);
 expect(result).toEqual({hadRedo:true,model:expected.model,bytes:expected.bytes,width:8});
});

for(const format of ['svg','tiff'] as const)for(const target of ['paint','mask','erasure','tonal'] as const)test(`${format} export pins ${target}-only texture sources before progress callbacks`,async({page})=>{
 await page.goto('/');const result=await page.evaluate(async({format,target})=>{
  const {editor,BrushTexture,BrushStroke,EraserStroke,LayerMask,PaintLayer,PaintFill,RasterLayer}=window.luma;editor.newDocument({width:64,height:64});const canvas=document.createElement('canvas');canvas.width=canvas.height=8;canvas.getContext('2d')!.fillRect(0,0,8,8);const blob=await new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!)));canvas.width=canvas.height=0;const source=await editor.assetStore.add(blob,'Pinned grain',undefined,false),texture=new BrushTexture({assetId:source.id}),brush=new BrushStroke({points:[{x:32,y:32}],texture});
  if(target==='paint')editor.document.layers.add(new PaintLayer()).strokes.add(brush);
  if(target==='mask'){const paint=editor.document.layers.add(new PaintLayer());paint.strokes.add(new PaintFill({color:'#ff0000',bounds:{x:0,y:0,width:64,height:64}}));paint.mask=new LayerMask({base:1,strokes:[{mode:'hide',stroke:brush}]});}
  if(target==='erasure'){const original=await editor.assetStore.add(blob,'Original',undefined,false),raster=editor.document.layers.add(new RasterLayer({assetId:original.id,width:64,height:64}));raster.erase(new EraserStroke({points:brush.points,texture}));}
  if(target==='tonal')editor.document.applyTonalSculpt(brush.points,'dodge','midtones',.5,{texture});
  let removed=false,error='';try{await editor.export({format},{onProgress:()=>{if(!removed){removed=true;editor.assetStore.remove(source.id);}}});}catch(e){error=(e as Error).message;}
  return{removed,error};
 },{format,target});expect(result.removed).toBe(true);expect(result.error).toMatch(/source changed|Missing image asset/i);
});

test('cross-document texture-only artwork remaps sources and remains rendered after source closure',async({page})=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const {editor,BrushTexture,BrushStroke,PaintLayer}=window.luma;editor.newDocument({name:'Destination',width:64,height:64});const destination=editor.document;destination.layers.add(new PaintLayer({name:'Existing destination layer'}));
  const canvas=document.createElement('canvas');canvas.width=canvas.height=8;const c=canvas.getContext('2d')!;c.fillStyle='#ffffff';c.fillRect(0,0,8,8);const white=await new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!)));await editor.assetStore.add(white,'Existing white','collision',false);
  editor.newDocument({name:'Source',width:64,height:64});const source=editor.document;c.fillStyle='#000000';c.fillRect(0,0,8,8);const black=await new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!)));canvas.width=canvas.height=0;await editor.assetStore.add(black,'Black grain','collision',false);
  const layer=source.layers.add(new PaintLayer());layer.strokes.add(new BrushStroke({points:[{x:32,y:32}],size:32,hardness:1,color:'#ff0000',texture:new BrushTexture({assetId:'collision'})}));source.selectedLayer=layer;const revision=destination.getSnapshot().revision;
  const [copy]=await editor.copySelectedLayersTo(destination),dto=copy.toJSON();if(dto.kind!=='paint'||(dto.strokes[0].kind==='fill' || dto.strokes[0].kind === 'wet'))throw new Error('Missing copied paint');const assetId=dto.strokes[0].texture!.assetId;
  await editor.closeDocument(source,{discardChanges:true});editor.activateDocument(destination);const asset=editor.assetStore.get(assetId),retained=[...new Uint8Array(await asset.blob.arrayBuffer())].join(',')===[...new Uint8Array(await black.arrayBuffer())].join(','),bitmap=await createImageBitmap(await editor.exportPng()),out=document.createElement('canvas');out.width=out.height=64;out.getContext('2d')!.drawImage(bitmap,0,0);bitmap.close();const pixel=[...out.getContext('2d')!.getImageData(32,32,1,1).data];out.width=out.height=0;
  const oneRevision=destination.getSnapshot().revision===revision+1;destination.undo();const undone=destination.layers.length===1;destination.redo();return{retained,pixel,oneRevision,undone,renamed:assetId!=='collision',alive:asset.bitmap.width===8,originalRetained:editor.assetStore.get('collision').blob===white};
 });expect(result).toEqual({retained:true,pixel:[255,0,0,255],oneRevision:true,undone:true,renamed:true,alive:true,originalRetained:true});
});

test('portable recipes retain and remap original texture-only sources despite destination collisions',async({page})=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const {editor,BrushTexture,BrushStroke,PaintLayer}=window.luma,{serializeRecipePackage,readRecipePackage}=await import(/* @vite-ignore */String('/src/ai/recipes/package.ts'));editor.newDocument({width:64,height:64});
  const canvas=document.createElement('canvas');canvas.width=canvas.height=8;const context=canvas.getContext('2d')!;context.fillRect(0,0,8,8);const black=await new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!)));context.fillStyle='#ffffff';context.fillRect(0,0,8,8);const white=await new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!)));canvas.width=canvas.height=0;
  await editor.assetStore.add(white,'Destination source','collision',false);const paint=new PaintLayer();paint.strokes.add(new BrushStroke({points:[{x:32,y:32}],size:32,hardness:1,color:'#ff0000',texture:new BrushTexture({assetId:'collision'})}));const template=paint.toJSON(),recipe={schemaVersion:1,id:'textured-ink',name:'Textured ink',description:'',version:1,parameters:[],steps:[{id:'ink',name:'Ink',action:{type:'layer.add',layerTemplate:template}}]};
  const blob=await serializeRecipePackage(recipe,{get:()=>({id:'collision',name:'Original grain',width:8,height:8,blob:black})}),read=await readRecipePackage(blob);await editor.recipes.executeRecipePackage(blob);
  const layer=editor.document.layers.at(0)!.toJSON();if(layer.kind!=='paint'||(layer.strokes[0].kind==='fill' || layer.strokes[0].kind === 'wet'))throw new Error('Missing recipe paint');const mapped=layer.strokes[0].texture!.assetId,pixels=await createImageBitmap(await editor.exportPng()),out=document.createElement('canvas');out.width=out.height=64;out.getContext('2d')!.drawImage(pixels,0,0);pixels.close();const pixel=[...out.getContext('2d')!.getImageData(32,32,1,1).data];out.width=out.height=0;editor.document.undo();const undone=editor.document.layers.length===0;editor.document.redo();return{sourceCount:read.assets.length,bytes:[...new Uint8Array(await read.assets[0].blob.arrayBuffer())].join(',')===[...new Uint8Array(await black.arrayBuffer())].join(','),mapped:mapped!=='collision',pixel,undone};
 });expect(result).toEqual({sourceCount:1,bytes:true,mapped:true,pixel:[255,0,0,255],undone:true});
});

test('an authored 50 MP texture retains native crop detail, source-only project bytes and undo',async({page},info)=>{
 test.setTimeout(240000);await page.goto('/');await page.getByTestId('import-input').setInputFiles('tests/fixtures/psd/native-50mp.png');await expect(page.locator('.layer-row')).toHaveCount(1,{timeout:120000});
 const result=await page.evaluate(async()=>{
  const {editor,RasterLayer,PaintLayer,PencilStroke,BrushTexture,AffineTransform}=window.luma,original=editor.document.layers.at(0);if(!(original instanceof RasterLayer))throw new Error('Missing 50 MP source');const asset=editor.assetStore.get(original.assetId),hash=async(blob:Blob)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(value=>value.toString(16).padStart(2,'0')).join(''),sourceHash=await hash(asset.blob);original.remove();
  const layer=editor.document.layers.add(new PaintLayer());layer.transform=AffineTransform.scale(10000/2048,5000/2048);const before=JSON.stringify(editor.document.toJSON());layer.strokes.add(new PencilStroke({points:[{x:1024,y:1024}],size:2048,pressureSize:false,color:'#ffffff',texture:new BrushTexture({assetId:asset.id})}));const model=JSON.stringify(editor.document.toJSON()),region={x:9800,y:4900,width:128,height:64};
  const render=async()=>{const out=await editor.renderer.render(editor.document.getSnapshot().document,editor.assetStore,{region,cache:false,readback:true});try{return [...out.getContext('2d')!.getImageData(0,0,128,64).data];}finally{out.width=out.height=0;}};
  const native=await render(),reference=document.createElement('canvas');reference.width=128;reference.height=64;reference.getContext('2d')!.drawImage(asset.bitmap,9800,4900,128,64,0,0,128,64);const pixels=reference.getContext('2d')!.getImageData(0,0,128,64).data;reference.width=reference.height=0;let exact=true,nonzero=0;
  for(let i=0;i<pixels.length;i+=4){const alpha=Math.floor((pixels[i+3]*(2550000-(pixels[i]*2126+pixels[i+1]*7152+pixels[i+2]*722))+1275000)/2550000);if(native[i+3]!==alpha)exact=false;if(alpha)nonzero++;}
  const project=await editor.saveProject();editor.document.undo();const undoModel=JSON.stringify(editor.document.toJSON())===before,undoPixels=(await render()).every(value=>value===0);await editor.openProject(new File([project],'authored-50mp-texture.luma'));const reopened=await render(),restored=editor.assetStore.get(asset.id);
  return{exact,nonzero,undoModel,undoPixels,sourceHash,reopenedHash:await hash(restored.blob),sourceSize:[restored.width,restored.height],documentSize:[editor.document.width,editor.document.height],projectModel:JSON.stringify(editor.document.toJSON())===model,projectPixels:JSON.stringify(native)===JSON.stringify(reopened)};
 });await info.attach('authored-50mp-texture',{body:JSON.stringify(result),contentType:'application/json'});expect(result).toMatchObject({exact:true,undoModel:true,undoPixels:true,sourceSize:[10000,5000],documentSize:[10000,5000],projectModel:true,projectPixels:true});expect(result.nonzero).toBeGreaterThan(0);const {createHash}=await import('node:crypto'),{readFile}=await import('node:fs/promises');expect(result.sourceHash).toBe(createHash('sha256').update(await readFile('tests/fixtures/psd/native-50mp.png')).digest('hex'));expect(result.reopenedHash).toBe(result.sourceHash);
});

test('authored textured symmetry accumulates flow before one opacity and captured selection in native/SVG',async({page})=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const {editor,BrushTexture,BrushStroke,BrushSymmetry,PaintLayer,MarqueeSelection}=window.luma;editor.newDocument({width:64,height:64});const c=document.createElement('canvas');c.width=c.height=8;c.getContext('2d')!.fillRect(0,0,8,8);const blob=await new Promise<Blob>(resolve=>c.toBlob(value=>resolve(value!)));c.width=c.height=0;const asset=await editor.assetStore.add(blob,'Opaque grain',undefined,false),layer=editor.document.layers.add(new PaintLayer());
  layer.strokes.add(new BrushStroke({points:[{x:32,y:32}],size:24,hardness:1,color:'#ff0000',pressureSize:false,flow:.5,opacity:.5,symmetry:BrushSymmetry.mirrorVertical(32),texture:new BrushTexture({assetId:asset.id}),clip:new MarqueeSelection({shape:'rectangle',x:0,y:0,width:32,height:64})}));
  const read=async(blob:Blob)=>{const img=new Image(),url=URL.createObjectURL(blob),canvas=document.createElement('canvas');canvas.width=canvas.height=64;try{img.src=url;await img.decode();const context=canvas.getContext('2d')!;context.drawImage(img,0,0);return[[31,32],[32,32],[0,0]].map(([x,y])=>[...context.getImageData(x,y,1,1).data]);}finally{URL.revokeObjectURL(url);canvas.width=canvas.height=0;}};
  return{native:await read(await editor.exportPng()),svg:await read((await editor.export({format:'svg'})).blob)};
 });expect(result.native).toEqual([[255,0,0,96],[0,0,0,0],[0,0,0,0]]);expect(result.svg).toEqual(result.native);
});

test('textured clone uses captured color, round-tip angle and one flow/opacity boundary in native/SVG',async({page})=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const {editor,BrushTexture,BrushTip,CloneStroke,PaintLayer}=window.luma;editor.newDocument({width:64,height:64});const canvas=document.createElement('canvas');canvas.width=canvas.height=8;const c=canvas.getContext('2d')!;c.fillRect(0,0,4,8);c.fillStyle='#ffffff';c.fillRect(4,0,4,8);const textureBlob=await new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!))),texture=await editor.assetStore.add(textureBlob,'Grain',undefined,false);canvas.width=canvas.height=64;const color=canvas.getContext('2d')!;color.fillStyle='#0000ff';color.fillRect(0,0,64,64);const blueBlob=await new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!))),blue=await editor.assetStore.add(blueBlob,'Captured blue',undefined,false);canvas.width=canvas.height=0;
  editor.document.layers.add(new PaintLayer()).strokes.add(new CloneStroke({points:[{x:32,y:32}],size:32,hardness:1,pressureSize:false,flow:.5,opacity:.5,tip:new BrushTip({angle:90}),texture:new BrushTexture({assetId:texture.id}),tiles:[{assetId:blue.id,x:0,y:0,width:64,height:64}]}));
  const sample=async(blob:Blob)=>{const image=new Image(),url=URL.createObjectURL(blob),out=document.createElement('canvas');out.width=out.height=64;try{image.src=url;await image.decode();const context=out.getContext('2d')!;context.drawImage(image,0,0);return[[32,24],[32,40],[0,0]].map(([x,y])=>[...context.getImageData(x,y,1,1).data]);}finally{URL.revokeObjectURL(url);out.width=out.height=0;}};
  return{native:await sample(await editor.exportPng()),svg:await sample((await editor.export({format:'svg'})).blob)};
 });expect(result.native).toEqual([[0,0,255,64],[0,0,0,0],[0,0,0,0]]);expect(result.svg).toEqual(result.native);
});

test('authored texture healing repairs covered blemishes while preserving a blemish in the empty texture half',async({page})=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const {editor,BrushStroke,BrushTexture}=window.luma;editor.newDocument({width:120,height:100});const source=new OffscreenCanvas(120,100),context=source.getContext('2d')!;context.fillStyle='#646464';context.fillRect(0,0,120,100);context.fillStyle='#ff0000';context.fillRect(44,39,3,3);context.fillRect(52,39,3,3);await editor.importImage(new File([await source.convertToBlob()],'Two blemishes.png',{type:'image/png'}));
  const grain=new OffscreenCanvas(8,8),g=grain.getContext('2d')!;g.fillRect(0,0,4,8);g.fillStyle='#ffffff';g.fillRect(4,0,4,8);const asset=await editor.assetStore.add(await grain.convertToBlob(),'Half grain',undefined,false),before=JSON.stringify(editor.document.toJSON());
  await editor.healStroke(new BrushStroke({points:[{x:49.5,y:40.5}],size:24,hardness:1,pressureSize:false,texture:new BrushTexture({assetId:asset.id})}),undefined,undefined,30);
  const image=await createImageBitmap(await editor.exportPng()),out=document.createElement('canvas');out.width=120;out.height=100;out.getContext('2d')!.drawImage(image,0,0);image.close();const samples=[[45,40],[53,40]].map(([x,y])=>[...out.getContext('2d')!.getImageData(x,y,1,1).data]);out.width=out.height=0;editor.document.undo();return{samples,undo:JSON.stringify(editor.document.toJSON())===before};
 });expect(result).toEqual({samples:[[100,100,100,255],[255,0,0,255]],undo:true});
});
