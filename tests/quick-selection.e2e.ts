import {test,expect,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
test.beforeEach(async({page})=>{
  await page.goto('/');await page.evaluate(async()=>{
    const {editor,RasterLayer}=window.luma;editor.newDocument({width:64,height:32});const canvas=document.createElement('canvas');canvas.width=64;canvas.height=32;const c=canvas.getContext('2d')!;
    c.fillStyle='#0000ff';c.fillRect(0,0,64,32);c.fillStyle='#ff0000';c.fillRect(0,0,24,32);c.fillRect(24,24,16,8);c.fillRect(52,4,8,8);c.fillStyle='#0000ff';c.fillRect(8,8,4,4);c.clearRect(16,16,4,4);
    const patch=c.createImageData(4,4);for(let i=0;i<patch.data.length;i+=4)patch.data.set([255,0,0,128],i);c.putImageData(patch,4,24);
    const blob=await new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!))),asset=await editor.assetStore.add(blob,'Original',undefined,false);editor.document.selectedLayer=editor.document.layers.add(new RasterLayer({name:'Original',assetId:asset.id,width:64,height:32}));
  });
});
async function tool(page:Page){
  await page.keyboard.press('Shift+w');await expect(page.getByRole('button',{name:'Quick selection (Shift+W)',exact:true})).toHaveAttribute('aria-pressed','true');
  for(const [name,value] of [['Quick selection diameter value','1'],['Color tolerance value','0'],['Edge threshold value','0']]){const input=page.getByRole('spinbutton',{name,exact:true});await input.fill(value);await input.press('Enter');}
  await page.getByLabel('Editing canvas',{exact:true}).focus();await page.keyboard.press('Control+1');
}
async function stroke(page:Page,x:number,y:number){const box=(await page.locator('.canvas-wrap').boundingBox())!;await page.mouse.move(box.x+x,box.y+y);await page.mouse.down();await page.mouse.move(box.x+x+1,box.y+y,{steps:2});await page.mouse.up();await expect.poll(()=>page.evaluate(()=>window.luma.editor.tools.getSnapshot().quickSelectionProgress)).toBe(null);}
async function samples(page:Page){return page.evaluate(async()=>{const {editor}=window.luma;const {renderSelection,instantiateKernel}=await import(/* @vite-ignore */String('/src/engine/wasm.ts'));const kernel=await instantiateKernel(await(await fetch('/wasm/pixels.wasm')).arrayBuffer()),data=renderSelection(kernel,{selection:editor.document.selection?.toJSON()??{regions:[]},width:64,height:32,x:0,y:0,stepX:1,stepY:1});return[[4,4],[9,9],[17,17],[30,28],[54,8],[4,24]].map(([x,y])=>data[(y*64+x)*4+3]);});}

test('Quick Selection shortcut and brush draft grow actual nonrectangular coverage over locked artwork with one undo',async({page})=>{
  await page.evaluate(()=>{window.luma.editor.document.selectedLayer!.locked=true;});await tool(page);
  const before=await page.evaluate(()=>window.luma.editor.document.getSnapshot().revision),box=(await page.locator('.canvas-wrap').boundingBox())!;
  await page.mouse.move(box.x+4.5,box.y+4.5);await page.mouse.down();await page.mouse.move(box.x+6.5,box.y+4.5,{steps:3});await expect(page.getByTestId('quick-selection-seeds')).toBeVisible();expect(await page.evaluate(()=>window.luma.editor.document.selection)).toBe(null);
  await page.mouse.up();await expect.poll(()=>page.evaluate(()=>window.luma.editor.document.getSnapshot().revision)).toBe(before+1);expect(await samples(page)).toEqual([255,0,0,255,0,128]);await expect(page.getByTestId('quick-selection-seeds')).toHaveCount(0);
  await page.screenshot({path:'/tmp/canoli-quick-selection.png'});await page.keyboard.press('Control+z');expect(await page.evaluate(()=>window.luma.editor.document.selection)).toBe(null);
  await page.keyboard.press('Control+Shift+z');expect(await samples(page)).toEqual([255,0,0,255,0,128]);expect(await page.evaluate(()=>window.luma.editor.document.selectedLayer!.locked)).toBe(true);
});

test('successive add and Alt-subtract strokes refine disconnected regions while typing keeps native shortcuts',async({page})=>{
  await tool(page);await stroke(page,4.5,4.5);await expect.poll(()=>samples(page)).toEqual([255,0,0,255,0,128]);await stroke(page,54.5,8.5);await expect.poll(()=>samples(page)).toEqual([255,0,0,255,255,128]);
  await page.keyboard.down('Alt');await stroke(page,4.5,4.5);await page.keyboard.up('Alt');await expect.poll(()=>samples(page)).toEqual([0,0,0,0,255,64]);
  const input=page.getByLabel('Document name',{exact:true});await input.fill('typed');await input.press('Shift+W');await input.press('Enter');expect(await page.evaluate(()=>window.luma.editor.document.name)).toBe('typedW');
});

test('Escape, pointer cancellation, blur, tool changes and revisions discard transient seed drafts',async({page})=>{
  await tool(page);const before=await page.evaluate(()=>window.luma.editor.document.toJSON());
  for(const action of ['escape','pointer','blur','tool','revision']){
    await page.keyboard.press('Shift+w');
    const box=(await page.locator('.canvas-wrap').boundingBox())!;await page.mouse.move(box.x+4.5,box.y+4.5);await page.mouse.down();await page.mouse.move(box.x+5.5,box.y+5.5);
    if(action==='escape')await page.keyboard.press('Escape');else if(action==='pointer')await page.locator('.viewport').dispatchEvent('pointercancel');else if(action==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));else if(action==='tool')await page.keyboard.press('v');else await page.evaluate(()=>{window.luma.editor.document.name='Concurrent';});
    await page.mouse.up();await expect(page.getByTestId('quick-selection-seeds')).toHaveCount(0);expect(await page.evaluate(()=>window.luma.editor.document.selection)).toBe(null);
  }
  expect(await page.evaluate(()=>window.luma.editor.document.toJSON())).toEqual({...before,name:'Concurrent'});
});

test('cancel and revision checks after actual native growing preserve prior selection and source bytes',async({page})=>{
  const result=await page.evaluate(async()=>{
    const {editor}=window.luma,original=Array.from(new Uint8Array(await editor.assetStore.values()[0].blob.arrayBuffer())),before=editor.document.toJSON(),abort=new AbortController(),options={points:[{x:4.5,y:4.5}],size:1,tolerance:0};
    let cancelled='';try{await editor.document.selectQuickSelection(options,{signal:abort.signal,onProgress:value=>{if(value.completed>1)abort.abort();}});}catch(error){cancelled=String(error);}const afterCancel=editor.document.toJSON();
    let stale='';try{await editor.document.selectQuickSelection(options,{onProgress:value=>{if(value.completed>1&&editor.document.name!=='Concurrent')editor.document.name='Concurrent';}});}catch(error){stale=String(error);}
    return{before,afterCancel,after:editor.document.toJSON(),cancelled,stale,original,afterBytes:Array.from(new Uint8Array(await editor.assetStore.values()[0].blob.arrayBuffer()))};
  });expect(result.afterCancel).toEqual(result.before);expect(result.cancelled).toMatch(/abort|cancel/i);expect(result.stale).toMatch(/changed/i);expect(result.after.selection).toEqual(result.before.selection);expect(result.afterBytes).toEqual(result.original);
});

test('Cancel Quick Selection prevents a late real worker result from changing history',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await tool(page);
  const before=await page.evaluate(()=>{
    const Native=window.Worker;window.Worker=class extends Native{constructor(url:string|URL,options?:WorkerOptions){super(url,options);if(String(url).includes('pixels.worker'))Object.defineProperty(this,'onmessage',{set(handler:(event:MessageEvent)=>void){this.addEventListener('message',(event:MessageEvent)=>{if(event.data.selectionResult){(window as any).quickArrived=true;setTimeout(()=>{handler(event);(window as any).quickForwarded=true;},500);}else handler(event);});}});}};return window.luma.editor.document.toJSON();
  });
  const box=(await page.locator('.canvas-wrap').boundingBox())!;await page.mouse.click(box.x+4.5,box.y+4.5);await page.waitForFunction(()=>(window as any).quickArrived);await page.getByRole('button',{name:'Cancel Quick Selection',exact:true}).click();await page.waitForFunction(()=>(window as any).quickForwarded);expect(await page.evaluate(()=>window.luma.editor.document.toJSON())).toEqual(before);expect(errors).toEqual([]);
});

test('documented Quick Selection runs atomically in isolation and late asset-read revocation blocks plugins',async({page})=>{
  const guide=await readFile('docs/SCRIPTING_API.md','utf8'),source=guide.match(/```js\n\/\/ example: quick-selection\n([\s\S]*?)```/)![1];
  const first=await page.evaluate(async source=>{const {editor}=window.luma,before=editor.document.toJSON();await editor.runScript(source);const after=editor.document.toJSON();editor.document.undo();return{before,after,undone:editor.document.toJSON()};},source);expect(first.after.selection).not.toBe(null);expect(first.undone).toEqual(first.before);
  await page.evaluate(async source=>{
    const {editor}=window.luma,{PixelProcessor}=await import(/* @vite-ignore */String('/src/engine/processor.ts')),native=PixelProcessor.prototype.quickSelection;
    PixelProcessor.prototype.quickSelection=async function(...args:Parameters<typeof native>){const result=await native.apply(this,args);(window as any).quickPrepared=true;return result;};
    editor.plugins.install({format:'luma-plugin',apiVersion:2,id:'test.quick',name:'Quick',version:'1.0.0',permissions:['document:read','document:write','assets:read'],commands:[{id:'run',title:'Run',source:source+'\nawait new Promise(resolve=>setTimeout(resolve,400));'}]});(window as any).quickPending=editor.runPlugin('test.quick','run').then(()=>'',error=>String(error));
  },source);await page.waitForFunction(()=>(window as any).quickPrepared);const result=await page.evaluate(async()=>{const {editor}=window.luma;editor.plugins.revokePermission('test.quick','assets:read');return{error:await(window as any).quickPending,document:editor.document.toJSON()};});expect(result.error).toContain('assets:read');expect(result.document).toEqual(first.before);
});

test('merged, transformed layer and original asset sources preserve their sampling contracts',async({page})=>{
  const result=await page.evaluate(async()=>{
    const {editor,LayerGroup,PaintLayer,PaintFill,AffineTransform}=window.luma,group=editor.document.layers.add(new LayerGroup()),paint=group.layers.add(new PaintLayer({name:'Green'}));paint.strokes.add(new PaintFill({color:'#00ff00',bounds:{x:0,y:0,width:8,height:8}}));group.transform=AffineTransform.translation(40,10);paint.locked=true;
    const {coverageAt}=await import(/* @vite-ignore */String('/src/core/pixel-selection.ts'));const samples=()=>{const c=editor.document.selection!.regions[0].coverage!;return[[5,5],[42,12],[48,12]].map(([x,y])=>coverageAt(c,x,y));};
    await editor.document.selectQuickSelection({points:[{x:42.5,y:12.5}],size:1,tolerance:0,operation:'replace'});const merged=samples();
    await editor.document.selectQuickSelection({points:[{x:42.5,y:12.5}],size:1,tolerance:0,operation:'replace',source:{kind:'layer',layerId:paint.id}});const layer=samples();
    await editor.document.selectQuickSelection({points:[{x:5.5,y:5.5}],size:1,tolerance:0,operation:'replace',source:{kind:'asset',assetId:editor.assetStore.values()[0].id}});return{merged,layer,asset:samples()};
  });expect(result).toEqual({merged:[0,255,0],layer:[0,255,0],asset:[255,0,0]});
});

test('Quick Selection creates exact PNG masks, reusable alpha channels and redo-only workspace history',async({page})=>{
  const saved=await page.evaluate(async()=>{
    const {editor}=window.luma;await editor.document.selectQuickSelection({points:[{x:4.5,y:4.5}],size:1,tolerance:0,operation:'replace'});const channel=editor.document.alphaChannels.capture('Quick red');editor.document.selectedLayer!.maskFromSelection(channel.selection);
    const image=await createImageBitmap(await editor.exportPng()),canvas=document.createElement('canvas');canvas.width=64;canvas.height=32;const c=canvas.getContext('2d')!;c.drawImage(image,0,0);image.close();const pixels=[[4,4],[9,9],[17,17],[30,28],[54,8],[4,24]].map(([x,y])=>Array.from(c.getImageData(x,y,1,1).data));
    const before=editor.document.toJSON();await editor.document.selectQuickSelection({points:[{x:54.5,y:8.5}],size:1,tolerance:0,operation:'replace',source:{kind:'asset',assetId:editor.assetStore.values()[0].id}});const after=editor.document.toJSON();editor.document.undo();return{before,after,pixels,version:await editor.saveWorkspaceVersion('Quick history')};
  });expect(saved.pixels).toEqual([[255,0,0,255],[0,0,0,0],[0,0,0,0],[255,0,0,255],[0,0,0,0],[255,0,0,64]]);
  await page.reload();const result=await page.evaluate(async version=>{const {editor}=window.luma;await editor.restoreWorkspace(version);const before=editor.document.toJSON();editor.document.redo();return{before,after:editor.document.toJSON()};},saved.version);expect(result).toEqual({before:saved.before,after:saved.after});
});

test('native 50 MP Quick Selection keeps four-connected islands, seams, originals and project coverage',async({page})=>{
  const bytes=await readFile('tests/fixtures/color-range/native-50mp.png');const result=await page.evaluate(async bytes=>{
    const {editor}=window.luma;editor.newDocument();await editor.importImage(new File([new Uint8Array(bytes)],'native-50mp.png',{type:'image/png'}));const before=editor.document.getSnapshot().revision,progress:{completed:number;total:number}[]=[];
    const longTasks:{start:number;duration:number}[]=[],observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())longTasks.push({start:entry.startTime,duration:entry.duration});});observer.observe({entryTypes:['longtask']});
    let queuedAt=0,inputResponseMs:number|undefined,inputDuringCapture=false,handVisibleDuringCapture=false,captureMarked=false;
    const start=performance.now();
    await editor.document.selectQuickSelection({points:[{x:.5,y:.5}],size:.5,tolerance:0,edgeThreshold:0},{onProgress:value=>{
      progress.push(value);if(value.completed===1&&!queuedAt){queuedAt=performance.now();setTimeout(()=>{(document.querySelector('button[aria-label="Hand tool (H)"]') as HTMLButtonElement).click();inputResponseMs=performance.now()-queuedAt;},0);}
      if(value.completed===200&&!captureMarked){captureMarked=true;inputDuringCapture=inputResponseMs!==undefined;handVisibleDuringCapture=document.querySelector('button[aria-label="Hand tool (H)"]')?.getAttribute('aria-pressed')==='true';}
    }});const end=performance.now(),milliseconds=end-start,{coverageAt}=await import(/* @vite-ignore */String('/src/core/pixel-selection.ts')),selection=editor.document.selection!.toJSON(),coverage=selection.regions[0].coverage!,revisionDelta=editor.document.getSnapshot().revision-before;
    await new Promise(resolve=>setTimeout(resolve,0));observer.disconnect();
    const samples=[[0,0],[511,511],[512,512],[4999,2499],[5000,2499],[0,4999],[9999,4999]].map(([x,y])=>coverageAt(coverage,x,y));const project=await editor.saveProject();await editor.openProject(new File([project],'quick.luma'));const after=new Uint8Array(await editor.assetStore.values()[0].blob.arrayBuffer());
    return{milliseconds,width:coverage.width,height:coverage.height,samples,revisionDelta,progressFirst:progress[0],progressLast:progress.at(-1),selectionRestored:JSON.stringify(selection)===JSON.stringify(editor.document.selection!.toJSON()),originalUnchanged:after.length===bytes.length&&after.every((value,i)=>value===bytes[i]),inputResponseMs,inputDuringCapture,handVisibleDuringCapture,longTasks:longTasks.filter(task=>task.start<end&&task.start+task.duration>start)};
  },Array.from(bytes));expect(result.width).toBe(10000);expect(result.height).toBe(5000);expect(result.samples).toEqual([255,255,255,255,0,0,0]);expect(result.revisionDelta).toBe(1);expect(result.selectionRestored).toBe(true);expect(result.originalUnchanged).toBe(true);expect(result.progressFirst.completed).toBe(0);expect(result.progressLast!.completed).toBe(result.progressLast!.total);console.log('50 MP Quick Selection:',JSON.stringify(result));expect(result.inputDuringCapture).toBe(true);expect(result.handVisibleDuringCapture).toBe(true);expect(result.inputResponseMs).toBeLessThan(250);
});
