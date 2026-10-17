import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
test.beforeEach(async({page})=>{
  await page.goto('/');await page.evaluate(()=>{const {editor,PaintLayer,PaintFill,MarqueeSelection}=window.luma;editor.newDocument({width:64,height:32});const layer=editor.document.layers.add(new PaintLayer({name:'Source'}));layer.strokes.add(new PaintFill({color:'#ff0000',bounds:{x:0,y:0,width:64,height:32}}));editor.document.selectedLayer=layer;editor.document.selection=new MarqueeSelection({shape:'pixels',x:0,y:0,width:4,height:1,coverage:{width:4,height:1,runs:[1,255,2,128,4,0]}});});
});

test('alpha channel controls save, rename, duplicate, reorder and load soft coverage without editing source artwork',async({page})=>{
  const panel=page.getByRole('region',{name:'Alpha channels',exact:true});await panel.getByRole('button',{name:/^Alpha channels/}).click();
  const before=await page.evaluate(()=>window.luma.editor.document.toJSON().children);
  await panel.getByLabel('New channel name',{exact:true}).fill('Soft selection');await panel.getByRole('button',{name:'Save selection as channel',exact:true}).click();
  await expect(panel.getByLabel('Saved alpha channel',{exact:true})).toHaveValue(await page.evaluate(()=>window.luma.editor.document.alphaChannels.at(0)!.id));
  await expect.poll(()=>panel.locator('canvas').evaluate(node=>(node as HTMLCanvasElement).width)).toBe(64);
  const field=panel.getByLabel('Channel name',{exact:true});await field.fill('Soft edge');await field.press('Enter');await panel.getByRole('button',{name:'Duplicate channel',exact:true}).click();
  await panel.getByRole('button',{name:'Move channel up',exact:true}).click();expect(await page.evaluate(()=>window.luma.editor.document.alphaChannels.items.map(channel=>channel.name))).toEqual(['Soft edge copy','Soft edge']);
  await page.evaluate(()=>window.luma.editor.document.deselect());await panel.getByRole('button',{name:'Load channel selection',exact:true}).click();await expect(panel.getByRole('status').last()).toContainText('Loaded Soft edge copy');
  const result=await page.evaluate(async()=>{const {editor}=window.luma;const {coverageAt}=await import(/* @vite-ignore */String('/src/core/pixel-selection.ts'));const selection=editor.document.selection!.toJSON(),coverage=selection.regions[0].coverage!;return{alpha:[0,1,2,3].map(x=>coverageAt(coverage,x,0)),layers:editor.document.toJSON().children};});
  expect(result.alpha).toEqual([255,128,0,0]);expect(result.layers).toEqual(before);
  await page.screenshot({path:'/tmp/canoli-alpha-channels.png'});
  await panel.getByRole('button',{name:'Remove channel',exact:true}).click();expect(await page.evaluate(()=>window.luma.editor.document.alphaChannels.length)).toBe(1);
  await page.getByLabel('Editing canvas',{exact:true}).focus();await page.keyboard.press('Control+z');expect(await page.evaluate(()=>window.luma.editor.document.alphaChannels.length)).toBe(2);
  await page.keyboard.press('Control+k');await page.getByLabel('Search commands',{exact:true}).fill('save selection as alpha channel');await page.getByRole('option',{name:'Document Save selection as alpha channel',exact:true}).click();expect(await page.evaluate(()=>window.luma.editor.document.alphaChannels.length)).toBe(3);
});

test('loaded channels create real masks and preserve independent coverage through projects, crop and image resize',async({page})=>{
  const result=await page.evaluate(async()=>{
    const {editor}=window.luma,channel=editor.document.alphaChannels.capture('Soft');editor.document.deselect();await channel.load();editor.document.selectedLayer!.maskFromSelection(editor.document.selection!);
    const pixels=async()=>{const bitmap=await createImageBitmap(await editor.exportPng()),canvas=document.createElement('canvas');canvas.width=64;canvas.height=32;const c=canvas.getContext('2d')!;c.drawImage(bitmap,0,0);bitmap.close();return[0,1,2,3].map(x=>Array.from(c.getImageData(x,0,1,1).data));};
    const before=editor.document.toJSON(),masked=await pixels(),blob=await editor.saveProject();await editor.openProject(new File([blob],'channels.luma'));const after=editor.document.toJSON(),reopened=await pixels();
    editor.document.crop({x:1,y:0,width:32,height:16});const cropped=editor.document.alphaChannels.at(0)!.selection.regions[0];editor.document.resizeImage(64,32);const resized=editor.document.alphaChannels.at(0)!.selection.regions[0];
    return{before,after,masked,reopened,cropped,resized};
  });expect(result.before).toEqual(result.after);expect(result.masked).toEqual([[255,0,0,255],[255,0,0,128],[0,0,0,0],[0,0,0,0]]);expect(result.reopened).toEqual(result.masked);expect(result.cropped.x).toBe(-1);expect(result.resized.transform).toMatchObject({a:2,d:2});
});

test('native channel preparation rejects cancellation, session/revision changes and late output',async({page})=>{
  const result=await page.evaluate(async()=>{
    const {editor}=window.luma;editor.document.resize(2050,1025);const channel=editor.document.alphaChannels.capture('Cancel'),before=editor.document.toJSON(),abort=new AbortController();
    let cancelled='';try{await channel.load({invert:true},{signal:abort.signal,onProgress:value=>{if(value.completed)abort.abort();}});}catch(error){cancelled=String(error);}const afterCancel=editor.document.toJSON();
    let stale='';try{await channel.load({invert:true},{onProgress:value=>{if(value.completed===1)editor.document.name='Concurrent';}});}catch(error){stale=String(error);}return{before,afterCancel,after:editor.document.toJSON(),cancelled,stale};
  });expect(result.afterCancel).toEqual(result.before);expect(result.cancelled).toMatch(/abort|cancel/i);expect(result.stale).toMatch(/changed/);expect(result.after.selection).toEqual(result.before.selection);
});

test('Cancel channel loading discards real worker output arriving after the button was pressed',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.evaluate(()=>{const {editor}=window.luma;editor.document.alphaChannels.capture('Late');editor.document.deselect();});
  const panel=page.getByRole('region',{name:'Alpha channels',exact:true});await panel.getByRole('button',{name:/^Alpha channels/}).click();
  await expect.poll(()=>panel.locator('canvas').evaluate(node=>(node as HTMLCanvasElement).width)).toBe(64);
  const before=await page.evaluate(()=>{
    const Native=window.Worker;window.Worker=class extends Native{constructor(url:string|URL,options?:WorkerOptions){super(url,options);if(String(url).includes('pixels.worker'))Object.defineProperty(this,'onmessage',{set(handler:(event:MessageEvent)=>void){this.addEventListener('message',(event:MessageEvent)=>{if(event.data.selectionResult){(window as any).channelOutputArrived=true;setTimeout(()=>{handler(event);(window as any).channelOutputForwarded=true;},500);}else handler(event);});}});}};
    return window.luma.editor.document.toJSON();
  });
  await panel.getByRole('button',{name:'Load channel selection',exact:true}).click();await page.waitForFunction(()=>(window as any).channelOutputArrived);
  await panel.getByRole('button',{name:'Cancel channel loading',exact:true}).click();await page.waitForFunction(()=>(window as any).channelOutputForwarded);
  expect(await page.evaluate(()=>window.luma.editor.document.toJSON())).toEqual(before);expect(errors).toEqual([]);
});

test('documented alpha channel scripts are atomic and pending plugins respect current document-write grants',async({page})=>{
  const guide=await readFile('docs/SCRIPTING_API.md','utf8'),source=guide.match(/```js\n\/\/ example: alpha-channels\n([\s\S]*?)```/)![1];
  const result=await page.evaluate(async source=>{
    const {editor}=window.luma,before=editor.document.toJSON();await editor.runScript(source);const after=editor.document.toJSON();editor.document.undo();const undone=editor.document.toJSON();
    editor.plugins.install({format:'luma-plugin',apiVersion:1,id:'test.alpha',name:'Alpha',version:'1.0.0',permissions:['document:read','document:write'],commands:[{id:'run',title:'Load',source:source+'\nawait new Promise(resolve=>setTimeout(resolve,400));'}]});const pending=editor.runPlugin('test.alpha','run');editor.plugins.revokePermission('test.alpha','document:write');let denied='';try{await pending;}catch(error){denied=String(error);}
    return{before,after,undone,rejected:editor.document.toJSON(),denied};
  },source);expect(result.after.alphaChannels).toHaveLength(1);expect(result.undone).toEqual(result.before);expect(result.rejected).toEqual(result.before);expect(result.denied).toMatch(/write/);
});

test('saved channels survive current and redo-only workspace restoration',async({page})=>{
  const saved=await page.evaluate(async()=>{const {editor}=window.luma;const channel=editor.document.alphaChannels.capture('History'),before=editor.document.toJSON();channel.selection=new window.luma.MarqueeSelection({shape:'rectangle',x:4,y:2,width:8,height:4});const after=editor.document.toJSON();editor.document.undo();return{version:await editor.saveWorkspaceVersion('Alpha history'),before,after};});
  await page.reload();const result=await page.evaluate(async version=>{const {editor}=window.luma;await editor.restoreWorkspace(version);const before=editor.document.toJSON();editor.document.redo();return{before,after:editor.document.toJSON()};},saved.version);expect(result).toEqual({before:saved.before,after:saved.after});
});

test('native 50 MP alpha channels preserve tile seams, inverse coverage, progress and a single commit',async({page})=>{
  const bytes=await readFile('tests/fixtures/color-range/native-50mp.png');
  const result=await page.evaluate(async bytes=>{
    const {editor,MarqueeSelection,RasterLayer}=window.luma;const asset=await editor.assetStore.add(new Blob([new Uint8Array(bytes)],{type:'image/png'}),'Native source',undefined,false);editor.document.layers.add(new RasterLayer({assetId:asset.id,width:asset.width,height:asset.height}));
    editor.document.resize(10000,5000);editor.document.selection=new MarqueeSelection({regions:[{shape:'rectangle',x:5000,y:0,width:5000,height:5000,operation:'add'},{shape:'rectangle',x:5500,y:100,width:2,height:2,operation:'subtract'}]});
    const channel=editor.document.alphaChannels.capture('Native'),saved=channel.toJSON();editor.document.deselect();const revision=editor.document.getSnapshot().revision,progress:{completed:number;total:number}[]=[];const start=performance.now();await channel.load({invert:true},{onProgress:value=>progress.push(value)});
    const milliseconds=performance.now()-start,{coverageAt}=await import(/* @vite-ignore */String('/src/core/pixel-selection.ts')),coverage=editor.document.selection!.regions[0].coverage!;
    const selected=editor.document.toJSON(),revisionDelta=editor.document.getSnapshot().revision-revision,project=await editor.saveProject();await editor.openProject(new File([project],'native-channels.luma'));const after=new Uint8Array(await editor.assetStore.get(asset.id).blob.arrayBuffer());
    return{milliseconds,width:coverage.width,height:coverage.height,alpha:[[0,0],[511,511],[512,512],[4999,4999],[5000,0],[5500,100],[9999,4999]].map(([x,y])=>coverageAt(coverage,x,y)),progressFirst:progress[0],progressLast:progress.at(-1),revisionDelta,channelUnchanged:JSON.stringify(saved)===JSON.stringify(editor.document.alphaChannels.getById(saved.id)!.toJSON()),projectRestored:JSON.stringify(selected)===JSON.stringify(editor.document.toJSON()),sourceBytesUnchanged:after.length===bytes.length&&after.every((value,i)=>value===bytes[i])};
  },Array.from(bytes));expect(result.width).toBe(10000);expect(result.height).toBe(5000);expect(result.alpha).toEqual([255,255,255,255,0,255,0]);expect(result.revisionDelta).toBe(1);expect(result.channelUnchanged).toBe(true);expect(result.projectRestored).toBe(true);expect(result.sourceBytesUnchanged).toBe(true);expect(result.progressFirst.completed).toBe(0);expect(result.progressLast!.completed).toBe(result.progressLast!.total);console.log('50 MP alpha channel:',JSON.stringify(result));
});
