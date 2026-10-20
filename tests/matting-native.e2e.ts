import {test,expect,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';

test.beforeEach(async({page})=>{
  await page.goto('/');await page.evaluate(()=>window.luma.editor.newDocument({width:9,height:5}));
  await page.getByTestId('import-input').setInputFiles('tests/fixtures/matting/color-line.png');
  await expect(page.locator('.layer-row')).toHaveCount(1);
});
async function trimap(page:Page){const bytes=await readFile('tests/fixtures/matting/color-line-trimap.png');return page.evaluate(async bytes=>{const asset=await window.luma.editor.assetStore.add(new Blob([new Uint8Array(bytes)],{type:'image/png'}),'Trimap',undefined,false);return asset.id;},[...bytes]);}

test('native corrected output changes actual RGB, preserves the original and survives one undo, redo and project reopening',async({page})=>{
  const labels=await trimap(page),result=await page.evaluate(async trimapAssetId=>{
    const {editor}=window.luma,source=editor.document.selectedLayer!,sourceAssetId=(source as any).assetId,before=editor.document.toJSON(),original=new Uint8Array(await editor.assetStore.get((source as any).assetId).blob.arrayBuffer()),revision=editor.document.getSnapshot().revision;
    await source.refineEdge({solver:'color-line',radius:25,smoothness:0,decontaminate:true,trimapAssetId});const target=editor.document.selectedLayer!,after=editor.document.toJSON();
    const sample=(assetId:string)=>{const canvas=document.createElement('canvas');canvas.width=9;canvas.height=5;const c=canvas.getContext('2d')!;c.drawImage(editor.assetStore.get(assetId).bitmap,0,0);return Array.from(c.getImageData(4,2,1,1).data);};
    const color=sample((target as any).assetId),mask=sample(target.mask!.assetId!),image=await createImageBitmap(await editor.exportPng()),canvas=document.createElement('canvas');canvas.width=9;canvas.height=5;const c=canvas.getContext('2d')!;c.drawImage(image,0,0);image.close();const exported=Array.from(c.getImageData(4,2,1,1).data);
    const revisionDelta=editor.document.getSnapshot().revision-revision;editor.document.undo();const undone=editor.document.toJSON();editor.document.redo();const redone=editor.document.toJSON(),project=await editor.saveProject();await editor.openProject(new File([project],'matting.luma'));const bytes=new Uint8Array(await editor.assetStore.get(sourceAssetId).blob.arrayBuffer());
    return{before,after,undone,redone,reopened:editor.document.toJSON(),color,mask,exported,revisionDelta,sourceUnchanged:original.length===bytes.length&&original.every((value,i)=>value===bytes[i])};
  },labels);
  expect(result.color).toEqual([199,20,11,255]);expect(result.mask[3]).toBe(128);expect(result.exported[3]).toBe(128);for(let c=0;c<3;c++)expect(Math.abs(result.exported[c]*128/255-result.color[c]*128/255)).toBeLessThanOrEqual(1);
  expect(result.after.children).toHaveLength(2);expect(result.after.children[0]).toEqual({...result.before.children[0],visible:false});expect(result.undone).toEqual(result.before);expect(result.redone).toEqual(result.after);expect(result.reopened).toEqual(result.after);expect(result.sourceUnchanged).toBe(true);expect(result.revisionDelta).toBe(1);
});

test('selection preparation uses full resized nested coordinates and mask output remains attached to that raster',async({page})=>{
  const result=await page.evaluate(async()=>{
    const {editor,LayerGroup,AffineTransform,MarqueeSelection}=window.luma,source=editor.document.selectedLayer!,group=editor.document.layers.add(new LayerGroup());group.transform=AffineTransform.translation(50,10).multiply(AffineTransform.rotation(Math.PI/2));source.moveTo(group);source.x=2;source.y=3;(source as any).width=18;(source as any).height=10;editor.document.resize(100,80);
    const matrix=group.transform.multiply(AffineTransform.translation(2,3)).multiply(AffineTransform.scale(2));editor.document.selection=new MarqueeSelection({shape:'rectangle',x:0,y:0,width:4,height:5}).transformed(matrix);
    const before=editor.document.toJSON();await source.refineEdge({radius:0,smoothness:0});const asset=editor.assetStore.get(source.mask!.assetId!),canvas=document.createElement('canvas');canvas.width=9;canvas.height=5;const c=canvas.getContext('2d')!;c.drawImage(asset.bitmap,0,0);const alpha=Array.from({length:9},(_,x)=>c.getImageData(x,2,1,1).data[3]),basis=source.mask!.toJSON().basis;editor.document.undo();return{alpha,basis,before,undone:editor.document.toJSON()};
  });expect(result.alpha).toEqual([255,255,255,255,0,0,0,0,0]);expect(result.basis).toEqual({a:2,b:0,c:0,d:2,e:0,f:0});expect(result.undone).toEqual(result.before);
});

test('existing feathered inverted masks are sampled in document space at native source centers',async({page})=>{
  const result=await page.evaluate(async()=>{
    const {editor,LayerGroup,AffineTransform,LayerMask,MarqueeSelection}=window.luma,source=editor.document.selectedLayer!,group=editor.document.layers.add(new LayerGroup());group.transform=AffineTransform.translation(40,20);source.moveTo(group);source.x=2;source.y=3;(source as any).width=18;(source as any).height=10;
    source.mask=new LayerMask({selection:new MarqueeSelection({shape:'rectangle',x:0,y:0,width:10,height:10}),density:.5,inverted:true,feather:2});editor.document.resize(100,80);
    const {CanvasRenderer}=await import(/* @vite-ignore */String('/src/engine/renderer.ts')),{maskTransform}=await import(/* @vite-ignore */String('/src/core/masks.ts')),{layerTransform}=await import(/* @vite-ignore */String('/src/core/spatial.ts'));
    const renderer=new CanvasRenderer(),world=layerTransform(editor.document.toJSON(),source.id)!,original=source.mask.toJSON(),canvas=await renderer.renderMaskCoverage(original,{x:42,y:23,width:18,height:10,sx:1,sy:1},0,0,'reference',false,maskTransform(original,world),editor.assetStore);
    const raw=canvas.getContext('2d')!.getImageData(0,0,18,10).data,expected=Array.from({length:9},(_,x)=>Math.round(255*.5+(255-raw[(5*18+x*2+1)*4+3])*.5));renderer.dispose();
    await source.refineEdge({radius:0,smoothness:0});const asset=editor.assetStore.get(source.mask!.assetId!),out=document.createElement('canvas');out.width=9;out.height=5;const c=out.getContext('2d')!;c.drawImage(asset.bitmap,0,0);return{expected,alpha:Array.from({length:9},(_,x)=>c.getImageData(x,2,1,1).data[3])};
  });expect(result.alpha).toEqual(result.expected);
});

test('unlinked masks retain world placement and stay fixed when the refined raster moves',async({page})=>{
  const result=await page.evaluate(async()=>{
    const {editor,LayerGroup,AffineTransform,LayerMask,MarqueeSelection}=window.luma,source=editor.document.selectedLayer!,group=editor.document.layers.add(new LayerGroup());group.transform=AffineTransform.translation(40,20);source.moveTo(group);source.x=2;source.y=3;(source as any).width=18;(source as any).height=10;
    source.mask=new LayerMask({selection:new MarqueeSelection({shape:'rectangle',x:42,y:23,width:8,height:10}),linked:false});
    await source.refineEdge({radius:0,smoothness:0});const mask=source.mask!.toJSON(),asset=editor.assetStore.get(source.mask!.assetId!),canvas=document.createElement('canvas');canvas.width=9;canvas.height=5;const c=canvas.getContext('2d')!;c.drawImage(asset.bitmap,0,0);
    const alpha=Array.from({length:9},(_,x)=>c.getImageData(x,2,1,1).data[3]);source.x+=20;
    const {maskTransform}=await import(/* @vite-ignore */String('/src/core/masks.ts')),{layerTransform}=await import(/* @vite-ignore */String('/src/core/spatial.ts'));return{mask,alpha,movedWorld:maskTransform(source.mask!.toJSON(),layerTransform(editor.document.toJSON(),source.id)!).toJSON()};
  });expect(result.alpha).toEqual([255,255,255,255,0,0,0,0,0]);expect(result.mask).toMatchObject({linked:false,x:42,y:23,basis:{a:2,b:0,c:0,d:2,e:0,f:0}});expect(result.movedWorld).toEqual({a:2,b:0,c:0,d:2,e:42,f:23});
});

test('the documented background-removal example executes in the actual isolated runtime',async({page})=>{
  const guide=await readFile('docs/SCRIPTING_API.md','utf8'),source=guide.match(/<!-- example: native-background-removal -->\s*```js\n([\s\S]*?)\n```/)?.[1];expect(source).toBeTruthy();
  const result=await page.evaluate(async source=>{
    const {editor,MarqueeSelection}=window.luma;editor.document.selection=new MarqueeSelection({shape:'rectangle',x:0,y:0,width:4,height:5});const before=editor.document.toJSON();const output=await editor.runScript(source!);const after=editor.document.toJSON();editor.document.undo();return{output,before,after,undone:editor.document.toJSON()};
  },source);expect(result.after.children).toHaveLength(2);expect(result.after.children[0].visible).toBe(false);expect(result.after.children[1].mask?.kind).toBe('bitmap');expect(result.undone).toEqual(result.before);
});

test('real staged PNG decoding is discarded on cancellation or revision changes without adding assets',async({page})=>{
  const labels=await trimap(page);for(const mode of ['cancel','revision']){
    await page.evaluate(async({trimapAssetId,mode})=>{
      // Patch the live host class: Vite can version the loaded AssetStore URL,
      // making a separate bare import another class that never observes staging.
      const {editor}=window.luma,prototype=Object.getPrototypeOf(editor.assetStore) as typeof editor.assetStore,add=prototype.add;let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
      (window as any).matteRelease=release;(window as any).matteReady=false;(window as any).matteFinished=false;(window as any).matteOutcome='';
      prototype.add=async function(...args:Parameters<typeof add>){const asset=await add.apply(this,args);if(String(args[1]).endsWith(' — matte')){(window as any).matteReady=true;await gate;}return asset;};
      const abort=new AbortController();(window as any).matteAbort=abort;(window as any).matteBefore=editor.document.toJSON();(window as any).matteCount=editor.assetStore.values().length;
      (window as any).mattePending=editor.refineEdge({radius:25,smoothness:0,trimapAssetId},{signal:abort.signal}).then(()=>'',error=>String(error)).then(error=>{(window as any).matteOutcome=error;return error;}).finally(()=>{prototype.add=add;(window as any).matteFinished=true;});(window as any).matteMode=mode;
    },{trimapAssetId:labels,mode});await page.waitForFunction(()=>(window as any).matteReady||(window as any).matteFinished);
    const staged=await page.evaluate(()=>({ready:(window as any).matteReady,outcome:(window as any).matteOutcome}));expect(staged.ready,staged.outcome||'Native preparation finished without the required staged PNG gate.').toBe(true);
    const result=await page.evaluate(async()=>{const {editor}=window.luma;if((window as any).matteMode==='cancel')(window as any).matteAbort.abort();else editor.document.name='Concurrent';(window as any).matteRelease();return{error:await(window as any).mattePending,before:(window as any).matteBefore,after:editor.document.toJSON(),countBefore:(window as any).matteCount,countAfter:editor.assetStore.values().length};});
    expect(result.error).toMatch(/abort|changed|cancel/i);expect(result.countAfter).toBe(result.countBefore);expect(result.after).toEqual(mode==='revision'?{...result.before,name:'Concurrent'}:result.before);
  }
});

test('dialog native processing can be cancelled after actual worker output without a late commit',async({page},info)=>{
  await page.getByRole('button',{name:'Refine',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Refine Edge',exact:true});await expect(dialog.getByTestId('refine-edge-apply')).toBeEnabled();
  const before=await page.evaluate(async()=>{
    const url=performance.getEntriesByType('resource').map(entry=>entry.name).find(name=>new URL(name).pathname==='/src/engine/processor.ts');
    if(!url)throw new Error('The native pixel processor dependency has not loaded.');
    const {PixelProcessor}=await import(/* @vite-ignore */url),native=PixelProcessor.prototype.mattingTile,editor=window.luma.editor,nativeApply=editor.refineEdge.bind(editor);
    const gate=new Promise<void>(resolve=>{(window as any).matteRelease=resolve;});(window as any).matteProcessorUrl=url;
    PixelProcessor.prototype.mattingTile=async function(...args:Parameters<typeof native>){const result=await native.apply(this,args);(window as any).matteArrived=true;await gate;(window as any).matteForwarded=true;return result;};
    editor.refineEdge=async(...args:Parameters<typeof nativeApply>)=>{try{return await nativeApply(...args);}finally{(window as any).matteWasAborted=!!args[1]?.signal?.aborted;(window as any).matteSettled=true;}};
    return{document:editor.document.toJSON(),assets:editor.assetStore.values().length};
  });
  await dialog.getByTestId('refine-edge-apply').click();await page.waitForFunction(()=>(window as any).matteArrived);await dialog.getByRole('button',{name:'Cancel matting',exact:true}).click();await page.evaluate(()=>(window as any).matteRelease());await page.waitForFunction(()=>(window as any).matteForwarded&&(window as any).matteSettled);
  const result=await page.evaluate(()=>({document:window.luma.editor.document.toJSON(),assets:window.luma.editor.assetStore.values().length,allSourcesLive:window.luma.editor.assetStore.values().every(asset=>asset.bitmap.width===asset.width),processorUrl:(window as any).matteProcessorUrl,arrived:!!(window as any).matteArrived,forwarded:!!(window as any).matteForwarded,settled:!!(window as any).matteSettled,aborted:!!(window as any).matteWasAborted}));
  await info.attach('native-ui-matting-cancellation',{body:JSON.stringify(result),contentType:'application/json'});expect(result.document).toEqual(before.document);expect(result.assets).toBe(before.assets);expect(result).toMatchObject({allSourcesLive:true,arrived:true,forwarded:true,settled:true,aborted:true});
});

test('isolated corrected-output scripts are atomic and late asset-write revocation discards private assets',async({page})=>{
  const labels=await trimap(page),source=`await document.selectedLayer.refineEdge({solver:'color-line',radius:25,smoothness:0,decontaminate:true,trimapAssetId:${JSON.stringify(labels)}});`;
  const initial=await page.evaluate(async source=>{const {editor}=window.luma,before=editor.document.toJSON(),count=editor.assetStore.values().length;try{await editor.runScript(source+'throw new Error("Later failure");');}catch{}return{before,after:editor.document.toJSON(),count,afterCount:editor.assetStore.values().length};},source);expect(initial.after).toEqual(initial.before);expect(initial.afterCount).toBe(initial.count);
  await page.evaluate(async source=>{
    // Hook the actual dependency URL, including Vite's version query. A bare
    // import can create another class and leave the real preparation unobserved.
    const url=performance.getEntriesByType('resource').map(entry=>entry.name).find(name=>new URL(name).pathname==='/src/scripting/retouch.ts')??'/src/scripting/retouch.ts';
    const {editor}=window.luma,{ScriptRetouch}=await import(/* @vite-ignore */url),native=ScriptRetouch.prototype.prepare;
    const gate=new Promise<void>(resolve=>{(window as any).releaseMatte=resolve;});
    ScriptRetouch.prototype.prepare=async function(...args:Parameters<typeof native>){const result=await native.apply(this,args);(window as any).mattePrepared=true;await gate;return result;};
    editor.plugins.install({format:'luma-plugin',apiVersion:2,id:'test.matting',name:'Matting',version:'1.0.0',permissions:['document:read','document:write','assets:read','assets:write'],commands:[{id:'run',title:'Run',source}]});(window as any).matteSettled=false;(window as any).mattePending=editor.runPlugin('test.matting','run').then(()=>'',error=>String(error)).then(value=>{(window as any).matteSettled=true;(window as any).matteError=value;return value;});
  },source);await page.waitForFunction(()=>(window as any).mattePrepared||(window as any).matteSettled);const preparation=await page.evaluate(()=>({prepared:!!(window as any).mattePrepared,error:(window as any).matteError}));expect(preparation.prepared,JSON.stringify(preparation)).toBe(true);const result=await page.evaluate(async()=>{const {editor}=window.luma;editor.plugins.revokePermission('test.matting','assets:write');(window as any).releaseMatte();return{error:await(window as any).mattePending,document:editor.document.toJSON(),count:editor.assetStore.values().length};});expect(result.error).toContain('assets:write');expect(result.document).toEqual(initial.before);expect(result.count).toBe(initial.count);
});

test('corrected RGB and matte assets survive redo-only workspace restoration',async({page})=>{
  const labels=await trimap(page),saved=await page.evaluate(async trimapAssetId=>{
    const {editor}=window.luma,before=editor.document.toJSON();await editor.refineEdge({solver:'color-line',radius:25,smoothness:0,decontaminate:true,trimapAssetId});const after=editor.document.toJSON();editor.document.undo();return{before,after,version:await editor.saveWorkspaceVersion('Matting redo')};
  },labels);await page.reload();const restored=await page.evaluate(async version=>{const {editor}=window.luma;await editor.restoreWorkspace(version);const before=editor.document.toJSON();editor.document.redo();return{before,after:editor.document.toJSON(),assets:editor.assetStore.values().map(asset=>asset.id)};},saved.version);expect(restored.before).toEqual(saved.before);expect(restored.after).toEqual(saved.after);expect(restored.assets).toContain((saved.after.children[1] as any).assetId);expect(restored.assets).toContain(saved.after.children[1].mask!.kind==='bitmap'?(saved.after.children[1].mask as any).assetId:'missing');
});

test('trimap brush previews real foreground/background marks without document history until native Apply',async({page})=>{
  const before=await page.evaluate(()=>({document:window.luma.editor.document.toJSON(),assets:window.luma.editor.assetStore.values().length}));await page.getByRole('button',{name:'Refine',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Refine Edge',exact:true});await expect(dialog.getByTestId('refine-edge-apply')).toBeEnabled();
  await dialog.getByRole('combobox',{name:'View Mode',exact:true}).selectOption('on-transparency');await dialog.locator('#refine-brush-size').fill('512');await dialog.getByRole('combobox',{name:'Trimap brush',exact:true}).selectOption('background');
  const canvas=dialog.getByTestId('refine-edge-preview-canvas'),box=(await canvas.boundingBox())!;await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
  await expect.poll(()=>canvas.evaluate(node=>[...(node as HTMLCanvasElement).getContext('2d')!.getImageData(0,0,(node as HTMLCanvasElement).width,(node as HTMLCanvasElement).height).data].filter((_,i)=>i%4===3).every(value=>value===0))).toBe(true);await expect(dialog.getByTestId('refine-edge-apply')).toBeDisabled();
  await dialog.getByRole('button',{name:'Undo mark',exact:true}).click();await expect(dialog.getByTestId('refine-edge-apply')).toBeEnabled();await dialog.getByRole('combobox',{name:'Trimap brush',exact:true}).selectOption('foreground');await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
  await expect.poll(()=>canvas.evaluate(node=>[...(node as HTMLCanvasElement).getContext('2d')!.getImageData(0,0,(node as HTMLCanvasElement).width,(node as HTMLCanvasElement).height).data].filter((_,i)=>i%4===3).every(value=>value===255))).toBe(true);expect(await page.evaluate(()=>({document:window.luma.editor.document.toJSON(),assets:window.luma.editor.assetStore.values().length}))).toEqual(before);
  await dialog.getByTestId('refine-edge-apply').click();await expect(dialog).toHaveCount(0);expect(await page.evaluate(()=>window.luma.editor.document.selectedLayer!.mask?.toJSON().kind)).toBe('bitmap');
});

test('native 50 MP matte output preserves source-alpha detail and project bytes with responsive capture',async({page})=>{
  const bytes=await readFile('tests/fixtures/matting/native-50mp.png'),fixture=JSON.parse(await readFile('tests/fixtures/matting/native-50mp.json','utf8'));
  const result=await page.evaluate(async({bytes,points})=>{
    const {editor}=window.luma;editor.newDocument();await editor.importImage(new File([new Uint8Array(bytes)],'native-matte.png',{type:'image/png'}));const sourceAssetId=(editor.document.selectedLayer as any).assetId,before=editor.document.getSnapshot().revision,progress:{completed:number;total:number}[]=[];let queuedAt=0,inputResponseMs:number|undefined;
    const longTasks:{start:number;duration:number}[]=[],observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())longTasks.push({start:entry.startTime,duration:entry.duration});});observer.observe({type:'longtask'});
    const start=performance.now();await editor.refineEdge({radius:0,smoothness:0},{onProgress:value=>{progress.push(value);if(value.completed===1&&!queuedAt){queuedAt=performance.now();setTimeout(()=>{(document.querySelector('button[aria-label="Hand tool (H)"]') as HTMLButtonElement).click();inputResponseMs=performance.now()-queuedAt;},0);}}});const milliseconds=performance.now()-start;await new Promise(resolve=>setTimeout(resolve,0));for(const entry of observer.takeRecords())longTasks.push({start:entry.startTime,duration:entry.duration});observer.disconnect();const revisionDelta=editor.document.getSnapshot().revision-before,maskId=editor.document.selectedLayer!.mask!.assetId!,asset=editor.assetStore.get(maskId);
    const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const c=canvas.getContext('2d')!,alpha=points.map(([x,y]:number[])=>{c.clearRect(0,0,1,1);c.drawImage(asset.bitmap,x,y,1,1,0,0,1,1);return c.getImageData(0,0,1,1).data[3];});
    const project=await editor.saveProject(),savedDocument=editor.document.toJSON();await editor.openProject(new File([project],'native-matte.luma'));const original=new Uint8Array(await editor.assetStore.get(sourceAssetId).blob.arrayBuffer());
    return{milliseconds,revisionDelta,width:asset.width,height:asset.height,alpha,inputResponseMs,longTasks:longTasks.filter(task=>task.start>=start&&task.start<=start+milliseconds),progressFirst:progress[0],progressLast:progress.at(-1),projectRestored:JSON.stringify(savedDocument)===JSON.stringify(editor.document.toJSON()),originalUnchanged:original.length===bytes.length&&original.every((value,i)=>value===bytes[i])};
  },{bytes:[...bytes],points:fixture.points});console.log('50 MP native matting:',JSON.stringify(result));expect(result.alpha).toEqual(fixture.alpha.map((value:number)=>value?255:0));expect([result.width,result.height]).toEqual([10000,5000]);expect(result.revisionDelta).toBe(1);expect(result.projectRestored).toBe(true);expect(result.originalUnchanged).toBe(true);expect(result.inputResponseMs).toBeLessThan(250);expect(result.progressLast!.completed).toBe(result.progressLast!.total);
});
