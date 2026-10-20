import {expect,test} from '@playwright/test';

test('owned job previews stay private and a retired frame remains readable under a renderer lease',async({page})=>{
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const {editor,PaintLayer,BrushStroke}=window.luma;
    editor.newDocument({width:64,height:32});const layer=editor.document.layers.add(new PaintLayer());editor.document.selectedLayer=layer;
    const before=editor.document.toJSON(),revision=editor.document.getSnapshot().revision,assets=editor.assetStore.values().length;
    const job=await editor._beginWetPaint(new BrushStroke({points:[{x:8,y:8}],size:4,hardness:1,pressureSize:false,color:'#ff0000'}),{mode:'mixer',mix:{wetness:0,pickup:0}});
    const first=await job.preview();if(!first)throw new Error('Missing native preview');
    const release=first.retain();first.dispose();first.dispose();
    const privateExact=JSON.stringify(before)===JSON.stringify(editor.document.toJSON())&&revision===editor.document.getSnapshot().revision&&assets===editor.assetStore.values().length;
    await job.append([{x:20,y:8,pressure:1}]);const second=await job.preview();if(!second)throw new Error('Missing extended preview');
    const read=async(frame:typeof first)=>{const canvas=await editor.renderer.render(frame.document,frame.assets,{cache:false});try{return [...canvas.getContext('2d')!.getImageData(8,8,1,1).data];}finally{canvas.width=canvas.height=0;}};
    const old=await read(first),next=await read(second);await job.dispose();
    const owned=await read(first),invalidated=!first.isCurrent()&&!second.isCurrent();release();release();second.dispose();
    return{privateExact,old,next,owned,invalidated,closed:first.isDisposed&&second.isDisposed,unchanged:JSON.stringify(before)===JSON.stringify(editor.document.toJSON()),assets:editor.assetStore.values().length===assets};
  });
  expect(result).toEqual({privateExact:true,old:[255,0,0,255],next:[255,0,0,255],owned:[255,0,0,255],invalidated:true,closed:true,unchanged:true,assets:true});
});

test('real Mixer pointer previews actual pixels without history, then commits one reversible stroke',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('/');
  await page.evaluate(()=>{const {editor,PaintLayer}=window.luma;editor.newDocument({width:128,height:96});editor.document.selectedLayer=editor.document.layers.add(new PaintLayer());});
  await page.getByRole('button',{name:'Mixer brush',exact:true}).click();await page.keyboard.press('Control+1');
  await page.getByRole('spinbutton',{name:'Size value',exact:true}).fill('8');await page.getByRole('spinbutton',{name:'Size value',exact:true}).press('Enter');
  await page.getByRole('spinbutton',{name:'Wetness value',exact:true}).fill('0');await page.getByRole('spinbutton',{name:'Wetness value',exact:true}).press('Enter');
  await page.getByRole('spinbutton',{name:'Pickup value',exact:true}).fill('0');await page.getByRole('spinbutton',{name:'Pickup value',exact:true}).press('Enter');
  await page.getByLabel('Foreground color',{exact:true}).fill('#ff0000');
  await page.evaluate(()=>window.luma.editor.tools.configure({hardness:1,pressureSize:false}));
  const before=await page.evaluate(()=>({model:window.luma.editor.document.toJSON(),revision:window.luma.editor.document.getSnapshot().revision,assets:window.luma.editor.assetStore.values().length}));
  const box=(await page.locator('.canvas-wrap').boundingBox())!;
  await page.mouse.move(box.x+32,box.y+40);await page.mouse.down();await page.mouse.move(box.x+64,box.y+40,{steps:8});
  await expect.poll(()=>page.evaluate(()=>!!window.luma.editor.tools.getSnapshot().wetPreview)).toBe(true);
  await expect.poll(()=>page.evaluate(()=>{const canvas=document.querySelector<HTMLCanvasElement>('[data-testid="artwork"]');if(!canvas)return 0;const copy=document.createElement('canvas');copy.width=canvas.width;copy.height=canvas.height;try{copy.getContext('2d')!.drawImage(canvas,0,0);const data=copy.getContext('2d')!.getImageData(0,0,copy.width,copy.height).data;let red=0;for(let p=0;p<data.length;p+=4)if(data[p]>240&&data[p+1]<10&&data[p+2]<10&&data[p+3]>240)red++;return red;}finally{copy.width=copy.height=0;}})).toBeGreaterThan(0);
  expect(await page.evaluate(()=>({model:window.luma.editor.document.toJSON(),revision:window.luma.editor.document.getSnapshot().revision,assets:window.luma.editor.assetStore.values().length}))).toEqual(before);
  await expect.poll(()=>page.evaluate(()=>window.luma.editor.tools.getSnapshot().wetPreview?.operation.toJSON().brush.points.at(-1)?.x)).toBe(64);
  const preview=await page.evaluate(async()=>{const {editor}=window.luma,frame=editor.tools.getSnapshot().wetPreview!;const release=frame.retain();try{const canvas=await editor.renderer.render(frame.document,frame.assets,{cache:false});try{const pixels=canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data;return{pixel:[...canvas.getContext('2d')!.getImageData(56,40,1,1).data],hash:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',pixels))).join(',')};}finally{canvas.width=canvas.height=0;}}finally{release();}});
  await page.mouse.up();await expect.poll(()=>page.evaluate(()=>window.luma.editor.tools.getSnapshot().drawing)).toBe(false);
  const result=await page.evaluate(async()=>{const {editor}=window.luma;const model=editor.document.toJSON(),state=editor.document.getSnapshot(),canvas=await editor.renderer.render(model,editor.assetStore,{cache:false});const pixel=[...canvas.getContext('2d')!.getImageData(56,40,1,1).data],hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data))).join(',');canvas.width=canvas.height=0;editor.document.undo();const undo=editor.document.toJSON();editor.document.redo();return{pixel,hash,model,undo,revision:state.revision,label:state.past.at(-1)?.label,redo:editor.document.toJSON()};});
  expect(result.pixel).toEqual(preview.pixel);expect(result.hash).toBe(preview.hash);expect(result.pixel.slice(0,3)).toEqual([255,0,0]);expect(result.pixel[3]).toBeGreaterThan(128);expect(result.revision).toBe(before.revision+1);expect(result.label).toBe('Mixer stroke');expect(result.undo).toEqual(before.model);expect(result.redo).toEqual(result.model);expect(errors).toEqual([]);
});

test('Escape during a real wet preview preserves the document and closes private working stores',async({page})=>{
  await page.goto('/');await page.evaluate(()=>{const {editor,PaintLayer}=window.luma;editor.newDocument({width:128,height:96});editor.document.selectedLayer=editor.document.layers.add(new PaintLayer());});
  await page.getByRole('button',{name:'Mixer brush',exact:true}).click();await page.keyboard.press('Control+1');
  const before=await page.evaluate(async()=>({model:window.luma.editor.document.toJSON(),revision:window.luma.editor.document.getSnapshot().revision,assets:window.luma.editor.assetStore.values().length,db:(await indexedDB.databases()).map(db=>db.name).filter(name=>name?.startsWith('canoli-wet-job-')).sort()}));
  const box=(await page.locator('.canvas-wrap').boundingBox())!;await page.mouse.move(box.x+30,box.y+40);await page.mouse.down();await page.mouse.move(box.x+70,box.y+40,{steps:4});
  await expect.poll(()=>page.evaluate(()=>!!window.luma.editor.tools.getSnapshot().wetPreview)).toBe(true);await page.keyboard.press('Escape');await page.mouse.up();
  await expect.poll(()=>page.evaluate(async()=>({model:window.luma.editor.document.toJSON(),revision:window.luma.editor.document.getSnapshot().revision,assets:window.luma.editor.assetStore.values().length,db:(await indexedDB.databases()).map(db=>db.name).filter(name=>name?.startsWith('canoli-wet-job-')).sort()}))).toEqual(before);
  expect(await page.evaluate(()=>({drawing:window.luma.editor.tools.getSnapshot().drawing,preview:window.luma.editor.tools.getSnapshot().wetPreview}))).toEqual({drawing:false,preview:null});
});

test('Smudge retains neutral layer transport across appended pressure, affine and symmetry samples',async({page})=>{
  await page.goto('/');const result=await page.evaluate(async()=>{
    const {editor,PaintLayer,PaintFill,AffineTransform,BrushSymmetry,BrushStroke}=window.luma;
    editor.newDocument({width:128,height:64});const layer=editor.document.layers.add(new PaintLayer({opacity:.5}));
    layer.transform=new AffineTransform(2,0,.25,1,8,4);layer.strokes.add(new PaintFill({bounds:{x:2,y:2,width:10,height:12},color:'#ff0000'}));editor.document.selectedLayer=layer;
    editor.tools.configure({size:4,hardness:1,pressureSize:false,pressureOpacity:false,symmetry:BrushSymmetry.mirrorVertical(64).toJSON(),smudge:{load:0,wetness:0,pickup:0}});
    const before=editor.document.toJSON(),plane=layer.transform!;
    const p=(x:number)=>plane.point({x,y:6}),mods={alt:false,shift:false,pressure:1};editor.tools.begin('smudge',p(7),mods,1);
    for(let x=8;x<=18;x++)editor.tools.move(p(x),mods);await editor.tools.end();
    const raw=layer.toJSON();if(raw.kind!=='paint')throw new Error('Wrong target');const wet=raw.strokes.at(-1);if(wet?.kind!=='wet')throw new Error('Missing wet operation');
    const read=async()=>{const canvas=await editor.renderer.render(editor.document.toJSON(),editor.assetStore,{cache:false}),point=plane.point({x:16,y:6});try{return{pixel:[...canvas.getContext('2d')!.getImageData(Math.floor(point.x),Math.floor(point.y),1,1).data],hash:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data))).join(',')};}finally{canvas.width=canvas.height=0;}};
    const retained=await read();editor.document.undo();const undo=JSON.stringify(before)===JSON.stringify(editor.document.toJSON());
    await editor.applyWetPaint(new BrushStroke(wet.brush),{mode:'smudge',load:wet.load,mix:wet.mix});const oneShot=await read();
    return{retained,oneShot,samples:wet.brush.points.length,first:wet.brush.points[0],load:wet.load.load,undo};
  });expect(result.retained).toEqual(result.oneShot);expect(result.retained.pixel.slice(0,3)).toEqual([255,0,0]);expect(result.retained.pixel[3]).toBeGreaterThan(0);expect(result.retained.pixel[3]).toBeLessThanOrEqual(128);expect(result.samples).toBe(12);expect(result.first).toMatchObject({x:7,y:6,pressure:1});expect(result.load).toBe(0);expect(result.undo).toBe(true);
});

test('wet preset preferences survive local storage and source-bearing portable packs',async({page})=>{
  await page.goto('/');const result=await page.evaluate(async()=>{
    const {editor}=window.luma,{BrushPreset}=await import(/* @vite-ignore */ String('/src/brushes/presets.ts')),{exportBrushPack,parseBrushPack,captureBrushPreset}=await import(/* @vite-ignore */ String('/src/brushes/portable.ts'));
    editor.tools.configure({smudge:{load:.2,wetness:.3,pickup:.4},mixer:{load:.9,wetness:.8,pickup:.7}});
    const canvas=new OffscreenCanvas(2,2);canvas.getContext('2d')!.fillRect(0,0,2,2);await editor.brushTextureSource.import(new File([await canvas.convertToBlob()],'Wet tip.png',{type:'image/png'}),'Wet tip.png');editor.tools.configure({texture:{channel:'alpha',invert:false}});
    const preset=await captureBrushPreset('Wet tip','mixer',editor.tools.getSnapshot().settings,editor.brushTextureSource),pack=await exportBrushPack([preset]),restored=(await parseBrushPack(pack))[0];
    await editor.brushPresets.save(restored);await editor.brushPresets.reload();const stored=editor.brushPresets.getSnapshot().presets.find(entry=>entry.preset.id===restored.id)!.preset;
    const selected:string[]=[];await editor.applyBrushPreset(stored,{selectTool:tool=>selected.push(tool)});
    const settings=editor.tools.getSnapshot().settings;
    return{version:stored.toJSON().version,selected,smudge:settings.smudge,mixer:settings.mixer,source:stored.source?.name,texture:settings.texture,legacy:BrushPreset.capture('Ordinary','brush',settings, false,stored.source!).toToolSettings().smudge};
  });expect(result).toMatchObject({version:5,selected:['mixer'],smudge:{load:.2,wetness:.3,pickup:.4},mixer:{load:.9,wetness:.8,pickup:.7},source:'Wet tip.png',texture:{channel:'alpha',invert:false},legacy:{load:0,wetness:0,pickup:.5}});
});

test('wet input on a real 50 MP image keeps original pixels and dimensions through one undo and project reopen',async({page},info)=>{
  test.setTimeout(240000);await page.goto('/');await page.getByTestId('import-input').setInputFiles('tests/fixtures/matting/native-50mp.png');await expect(page.locator('.layer-row')).toHaveCount(1,{timeout:120000});
  const result=await page.evaluate(async()=>{
    const {editor,RasterLayer}=window.luma,layer=editor.document.selectedLayer;if(!(layer instanceof RasterLayer))throw new Error('Missing original image');
    const source=editor.assetStore.get(layer.assetId),hash=async(blob:Blob)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))).join(','),original=await hash(source.blob),before=editor.document.toJSON();
    editor.tools.configure({size:1,hardness:1,opacity:1,pressureSize:false,pressureOpacity:false,color:'#ff0000',mixer:{load:1,wetness:0,pickup:0}});
    const mods={alt:false,shift:false,pressure:1};editor.tools.begin('mixer',{x:9000.5,y:4000.5},mods,1);for(let x=9001.5;x<=9004.5;x++)editor.tools.move({x,y:4000.5},mods);await editor.tools.end();
    const read=async()=>{const canvas=await editor.renderer.render(editor.document.toJSON(),editor.assetStore,{region:{x:9004,y:4000,width:1,height:1},scale:1,cache:false});try{return[...canvas.getContext('2d')!.getImageData(0,0,1,1).data];}finally{canvas.width=canvas.height=0;}};
    const pixel=await read(),saved=editor.document.toJSON(),project=await editor.saveProject();editor.document.undo();const undo=JSON.stringify(before)===JSON.stringify(editor.document.toJSON());await editor.openProject(new File([project],'Wet 50 MP.luma'));const reopened=editor.assetStore.get(source.id);
    return{pixel,reopened:await read(),undo,exact:JSON.stringify(saved)===JSON.stringify(editor.document.toJSON()),source:original===await hash(reopened.blob),dimensions:[reopened.width,reopened.height]};
  });expect(result).toEqual({pixel:[255,0,0,199],reopened:[255,0,0,199],undo:true,exact:true,source:true,dimensions:[10000,5000]});await info.attach('wet-tool-native-50mp',{body:JSON.stringify(result),contentType:'application/json'});
});

test('textured wet preview cancellation publishes no source lease and commit promotes only referenced original/output assets',async({page})=>{
  await page.goto('/');const result=await page.evaluate(async()=>{
    const {editor,PaintLayer,BrushStroke}=window.luma;
    editor.newDocument({width:32,height:32});editor.document.selectedLayer=editor.document.layers.add(new PaintLayer());
    const canvas=new OffscreenCanvas(2,2),ctx=canvas.getContext('2d')!;ctx.fillStyle='#ffffff';ctx.fillRect(0,0,2,2);
    await editor.brushTextureSource.import(await canvas.convertToBlob(),'Original texture.png');
    const original=editor.brushTextureSource.source!.blob,before=editor.document.toJSON(),count=editor.assetStore.values().length;
    const begin=()=>editor._beginWetPaint(assets=>new BrushStroke({size:4,hardness:1,pressureSize:false,color:'#ff0000',points:[{x:8,y:8}],texture:{assetId:editor.brushTextureSource.leaseIn(assets).asset.id,channel:'alpha',invert:false}}),{mode:'mixer',mix:{wetness:0,pickup:0}});
    const first=await begin(),prefix=await first.preview();const privateCount=editor.assetStore.values().length;await first.dispose();prefix?.dispose();
    const cancelled=JSON.stringify(before)===JSON.stringify(editor.document.toJSON())&&editor.assetStore.values().length===count;
    const second=await begin(),frame=await second.preview();const operation=await second.commit();await second.dispose();frame?.dispose();if(!operation)throw new Error('Missing textured wet operation');
    const data=operation.toJSON(),tip=editor.assetStore.get(data.brush.texture!.assetId),blobsEqual=async(a:Blob,b:Blob)=>JSON.stringify([...new Uint8Array(await a.arrayBuffer())])===JSON.stringify([...new Uint8Array(await b.arrayBuffer())]);
    const same=await blobsEqual(tip.blob,original),project=await editor.saveProject();await editor.openProject(new File([project],'Wet texture.luma'));
    return{cancelled,privateCount:privateCount===count,same,reopened:await blobsEqual(editor.assetStore.get(tip.id).blob,original),count:editor.assetStore.values().length,expected:1+data.tiles.length*2};
  });expect(result).toMatchObject({cancelled:true,privateCount:true,same:true,reopened:true});expect(result.count).toBe(result.expected);
});

test('invalid wet preferences preserve an active gesture and a human commit invalidates its old preview',async({page})=>{
  await page.goto('/');const result=await page.evaluate(async()=>{
    const {editor,PaintLayer}=window.luma;editor.newDocument({width:32,height:32});editor.document.selectedLayer=editor.document.layers.add(new PaintLayer());editor.tools.configure({size:4,pressureSize:false});
    const mods={alt:false,shift:false,pressure:1};editor.tools.begin('mixer',{x:8,y:8},mods,1);
    let rejected=false;try{editor.tools.configure({mixer:{load:1,wetness:NaN,pickup:0}});}catch{rejected=true;}
    const stillDrawing=editor.tools.getSnapshot().drawing;editor.document.name='Human rename';
    try{await editor.tools.end();}catch{/* Revision conflict is the expected transaction boundary. */}
    return{rejected,stillDrawing,name:editor.document.name,layerCount:editor.document.layers.length,drawing:editor.tools.getSnapshot().drawing,preview:editor.tools.getSnapshot().wetPreview,assets:editor.assetStore.values().length,strokes:(editor.document.selectedLayer as import('../src/dom').PaintLayer).strokes.length};
  });expect(result).toEqual({rejected:true,stillDrawing:true,name:'Human rename',layerCount:1,drawing:false,preview:null,assets:0,strokes:0});
});

test('a cancelled preview held by viewport preparation cannot close its assets or replace a newer blue gesture',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('/');
  await page.evaluate(()=>{const {editor,PaintLayer}=window.luma;editor.newDocument({width:128,height:96});editor.document.selectedLayer=editor.document.layers.add(new PaintLayer());editor.tools.configure({size:8,hardness:1,pressureSize:false,color:'#ff0000',mixer:{load:1,wetness:0,pickup:0}});});
  await page.getByRole('button',{name:'Mixer brush',exact:true}).click();await page.keyboard.press('Control+1');
  await page.evaluate(()=>{
    const {editor}=window.luma,original=editor.renderer.prepareViewport.bind(editor.renderer);let release=()=>{};
    const gate={started:false,readable:false,release:()=>release(),restore:()=>{editor.renderer.prepareViewport=original;}};
    Object.assign(window,{wetRace:gate});
    editor.renderer.prepareViewport=async(...args)=>{
      if(args[1]!==editor.assetStore&&!gate.started){const bitmaps=args[1].values().map(asset=>asset.bitmap);gate.started=true;await new Promise<void>(resolve=>{release=resolve;});gate.readable=bitmaps.length>0&&bitmaps.every(bitmap=>bitmap.width>0&&bitmap.height>0);}
      return original(...args);
    };
  });
  const box=(await page.locator('.canvas-wrap').boundingBox())!;
  await page.mouse.move(box.x+24,box.y+40);await page.mouse.down();await page.mouse.move(box.x+40,box.y+40,{steps:2});
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {wetRace:{started:boolean}}).wetRace.started)).toBe(true);
  await page.keyboard.press('Escape');await page.mouse.up();await page.getByLabel('Foreground color',{exact:true}).fill('#0000ff');
  await page.mouse.move(box.x+72,box.y+40);await page.mouse.down();await page.mouse.move(box.x+88,box.y+40,{steps:2});
  await expect.poll(()=>page.evaluate(()=>window.luma.editor.tools.getSnapshot().wetPreview?.operation.toJSON().brush.color)).toBe('#0000ff');
  await page.evaluate(()=>(window as unknown as {wetRace:{release():void}}).wetRace.release());
  await expect.poll(()=>page.evaluate(()=>{const canvas=document.querySelector<HTMLCanvasElement>('[data-testid="artwork"]');if(!canvas)return false;const copy=document.createElement('canvas');copy.width=canvas.width;copy.height=canvas.height;try{copy.getContext('2d')!.drawImage(canvas,0,0);const data=copy.getContext('2d')!.getImageData(0,0,copy.width,copy.height).data;let red=0,blue=0;for(let p=0;p<data.length;p+=4){if(data[p]>240&&data[p+2]<10&&data[p+3]>200)red++;if(data[p+2]>240&&data[p]<10&&data[p+3]>200)blue++;}return blue>0&&red===0;}finally{copy.width=copy.height=0;}})).toBe(true);
  expect(await page.evaluate(()=>(window as unknown as {wetRace:{readable:boolean}}).wetRace.readable)).toBe(true);
  expect(await page.evaluate(()=>window.luma.editor.tools.getSnapshot().drawing)).toBe(true);await page.mouse.up();
  await expect.poll(()=>page.evaluate(()=>window.luma.editor.tools.getSnapshot().drawing)).toBe(false);
  const result=await page.evaluate(()=>{(window as unknown as {wetRace:{restore():void}}).wetRace.restore();const state=window.luma.editor.document.getSnapshot(),layer=state.document.children[0];if(layer.kind!=='paint')throw new Error('Missing layer');return{count:layer.strokes.length,color:layer.strokes[0].kind==='wet'?layer.strokes[0].brush.color:null,last:state.past.at(-1)?.label};});
  expect(result).toEqual({count:1,color:'#0000ff',last:'Mixer stroke'});expect(errors).toEqual([]);
});

test('wet gestures in editable smart contents transfer native assets through one source apply and owner undo',async({page})=>{
  await page.goto('/');const result=await page.evaluate(async()=>{
    const {editor,Document,PaintLayer}=window.luma;editor.newDocument({width:64,height:64});const owner=editor.document,ownerAssets=editor.assetStore,master=new Document({width:32,height:32});master.layers.add(new PaintLayer());
    const instance=owner.placeSmartObject(owner.defineComponent(master)),before=owner.toJSON(),contents=await editor.editSmartObject(instance);contents.selectedLayer=contents.layers.at(0);
    editor.tools.configure({size:4,hardness:1,pressureSize:false,color:'#ff0000',mixer:{load:1,wetness:0,pickup:0}});editor.tools.begin('mixer',{x:8,y:8},{alt:false,shift:false,pressure:1},1);await editor.tools.end();
    const privateOwner=JSON.stringify(owner.toJSON())===JSON.stringify(before),contentsModel=contents.toJSON(),layer=contentsModel.children[0];if(layer.kind!=='paint'||layer.strokes[0].kind!=='wet')throw new Error('Missing wet master pixels');
    await editor.applySmartObjectContents(contents);const applied=owner.toJSON(),canvas=await editor.renderer.render(applied,ownerAssets,{cache:false});const pixel=[...canvas.getContext('2d')!.getImageData(8,8,1,1).data];canvas.width=canvas.height=0;owner.undo();const undo=JSON.stringify(before)===JSON.stringify(owner.toJSON());owner.redo();
    return{privateOwner,pixel,undo,redo:JSON.stringify(applied)===JSON.stringify(owner.toJSON()),assets:ownerAssets.values().length>0};
  });expect(result).toEqual({privateOwner:true,pixel:[255,0,0,255],undo:true,redo:true,assets:true});
});

test('wet controls keep separate mode preferences and all rail actions remain reachable at laptop height',async({page})=>{
  await page.setViewportSize({width:1280,height:720});await page.goto('/');
  await page.getByRole('button',{name:'Mixer brush',exact:true}).click();const pickup=page.getByRole('spinbutton',{name:'Pickup value',exact:true});await pickup.fill('73');await pickup.press('Enter');
  const size=page.getByRole('spinbutton',{name:'Size value',exact:true});await size.fill('17');await size.press('Enter');
  await page.getByRole('button',{name:'Smudge tool',exact:true}).click();await expect(pickup).toHaveValue('50');await expect(page.getByRole('spinbutton',{name:'Initial foreground load value',exact:true})).toHaveValue('0');await expect(size).toHaveValue('24');await pickup.fill('21');await pickup.press('Enter');
  await page.getByRole('button',{name:'Find a command (Mod+K)',exact:true}).click();const search=page.getByRole('combobox',{name:'Search commands',exact:true});await search.fill('Mixer brush');await search.press('Enter');await expect(page.getByRole('button',{name:'Mixer brush',exact:true})).toHaveAttribute('aria-pressed','true');await expect(pickup).toHaveValue('73');await expect(size).toHaveValue('17');
  await page.getByRole('button',{name:'Keyboard shortcuts (?)',exact:true}).click();await expect(page.getByRole('dialog',{name:'Keyboard shortcuts',exact:true})).toBeVisible();
  expect(await page.locator('.tool-rail').evaluate(node=>node.scrollHeight>node.clientHeight)).toBe(false);
});
