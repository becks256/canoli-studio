import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
test.beforeEach(async({page})=>{
  await page.goto('/');await page.evaluate(async()=>{
    const {editor,RasterLayer}=window.luma;editor.newDocument({width:64,height:48});
    const canvas=document.createElement('canvas');canvas.width=64;canvas.height=48;const c=canvas.getContext('2d')!;
    c.fillStyle='#ffffff';c.fillRect(0,0,64,48);c.fillStyle='#ff0000';c.fillRect(8,8,16,32);c.fillRect(24,32,16,8);c.fillRect(50,18,4,4);
    c.fillStyle='#ffffff';c.fillRect(12,12,4,4);const patch=c.createImageData(4,4);for(let i=0;i<patch.data.length;i+=4)patch.data.set([255,0,0,128],i);c.putImageData(patch,8,32);
    const blob=await new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!))),asset=await editor.assetStore.add(blob,'Original',undefined,false);
    editor.document.selectedLayer=editor.document.layers.add(new RasterLayer({name:'Original',assetId:asset.id,width:64,height:48}));
  });
});

test('Subject UI retains a concave shape, holes, disconnected detail and alpha with one undo',async({page})=>{
  const before=await page.evaluate(()=>window.luma.editor.document.toJSON());await page.getByRole('button',{name:'Subject',exact:true}).click();await expect(page.getByText('Subject selected',{exact:true})).toBeVisible();
  const result=await page.evaluate(async()=>{
    const {editor}=window.luma,{renderSelection,instantiateKernel}=await import(/* @vite-ignore */String('/src/engine/wasm.ts'));
    const kernel=await instantiateKernel(await(await fetch('/wasm/pixels.wasm')).arrayBuffer()),selection=editor.document.selection!.toJSON();
    const pixels=renderSelection(kernel,{selection,width:64,height:48,x:0,y:0,stepX:1,stepY:1});
    return{selection,samples:[[10,10],[13,13],[30,36],[30,16],[51,19],[9,33],[0,0]].map(([x,y])=>pixels[(y*64+x)*4+3])};
  });expect(result.selection.regions[0].shape).toBe('pixels');expect(result.samples).toEqual([255,0,255,0,255,128,0]);
  await expect(page.getByTestId('pixel-selection-outline')).toHaveAttribute('d',/.+/);
  await page.screenshot({path:'/tmp/canoli-subject-selection.png'});await page.keyboard.press('Control+z');expect(await page.evaluate(()=>window.luma.editor.document.toJSON())).toEqual(before);await page.keyboard.press('Control+Shift+z');expect(await page.evaluate(()=>window.luma.editor.document.selection!.toJSON())).toEqual(result.selection);
});

test('empty, uniform and non-raster sources reject without fabricating or changing prior coverage',async({page})=>{
  const result=await page.evaluate(async()=>{
    const {editor,MarqueeSelection,PaintLayer,RasterLayer}=window.luma;editor.document.selection=new MarqueeSelection({shape:'rectangle',x:1,y:1,width:3,height:3});const errors:string[]=[];
    for(const color of ['transparent','#ffffff']){
      const canvas=document.createElement('canvas');canvas.width=64;canvas.height=48;if(color!=='transparent'){const c=canvas.getContext('2d')!;c.fillStyle=color;c.fillRect(0,0,64,48);}
      const blob=await new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!))),asset=await editor.assetStore.add(blob,'Empty',undefined,false),layer=editor.document.layers.add(new RasterLayer({assetId:asset.id,width:64,height:48}));
      const before=editor.document.toJSON();try{await editor.document.selectSubject({targetLayerId:layer.id});}catch(error){errors.push(String(error));}if(JSON.stringify(before)!==JSON.stringify(editor.document.toJSON()))throw new Error('Empty source changed document');
    }
    editor.document.selectedLayer=editor.document.layers.add(new PaintLayer());const before=editor.document.toJSON();try{await editor.document.selectSubject();}catch(error){errors.push(String(error));}
    return{errors,unchanged:JSON.stringify(before)===JSON.stringify(editor.document.toJSON())};
  });expect(result.errors).toHaveLength(3);expect(result.errors.slice(0,2).every(error=>/No foreground/.test(error))).toBe(true);expect(result.errors[2]).toMatch(/raster/);expect(result.unchanged).toBe(true);
});

test('source-native subject coverage follows resized nested affine placement and explicit hidden locked targets',async({page})=>{
  const result=await page.evaluate(async()=>{
    const {editor,LayerGroup,AffineTransform}=window.luma;await editor.selectSubject();const expected=editor.document.selection!.regions[0].coverage!;
    const layer=editor.document.selectedLayer!,group=editor.document.layers.add(new LayerGroup());group.transform=AffineTransform.translation(150,20).multiply(AffineTransform.rotation(Math.PI/2));layer.moveTo(group);layer.x=5;layer.y=3;(layer as any).width=128;(layer as any).height=96;layer.visible=false;layer.locked=true;
    editor.document.resize(200,200);editor.document.selectedLayer=group;await editor.selectSubject({targetLayerId:layer.id});
    const selection=editor.document.selection!.toJSON(),{renderSelection,instantiateKernel}=await import(/* @vite-ignore */String('/src/engine/wasm.ts')),{subjectSource,selectSubjectOptionsSchema}=await import(/* @vite-ignore */String('/src/core/subject-selection.ts'));
    const source=subjectSource(editor.document.toJSON(),selectSubjectOptionsSchema.parse({targetLayerId:layer.id}),(id:string)=>editor.assetStore.get(id)),matrix=AffineTransform.fromJSON(source.transform),kernel=await instantiateKernel(await(await fetch('/wasm/pixels.wasm')).arrayBuffer());
    const samples=[[10,10],[13,13],[30,36],[30,16],[51,19],[9,33]].map(([x,y])=>{const p=matrix.point({x:x+.5,y:y+.5});return renderSelection(kernel,{selection,width:1,height:1,x:p.x-.5,y:p.y-.5,stepX:1,stepY:1})[3];});
    return{samples,coverageUnchanged:JSON.stringify(selection.regions[0].coverage)===JSON.stringify(expected),locked:layer.locked};
  });expect(result.samples).toEqual([255,0,255,0,255,128]);expect(result.coverageUnchanged).toBe(true);expect(result.locked).toBe(true);
});

test('abort and revision changes after genuine native preparation preserve selection and original PNG bytes',async({page})=>{
  const result=await page.evaluate(async()=>{
    const {editor}=window.luma,bytes=new Uint8Array(await editor.assetStore.values()[0].blob.arrayBuffer()),before=editor.document.toJSON(),abort=new AbortController();let cancelled='',stale='';
    try{await editor.document.selectSubject({}, {signal:abort.signal,onProgress:value=>{if(value.completed>1)abort.abort();}});}catch(error){cancelled=String(error);}const afterCancel=editor.document.toJSON();
    try{await editor.document.selectSubject({}, {onProgress:value=>{if(value.completed>1&&editor.document.name!=='Concurrent')editor.document.name='Concurrent';}});}catch(error){stale=String(error);}
    const after=new Uint8Array(await editor.assetStore.values()[0].blob.arrayBuffer());return{before,afterCancel,cancelled,stale,selection:editor.document.selection,originalUnchanged:after.length===bytes.length&&after.every((value,i)=>value===bytes[i])};
  });expect(result.afterCancel).toEqual(result.before);expect(result.cancelled).toMatch(/abort|cancel/i);expect(result.stale).toMatch(/changed/i);expect(result.selection).toBe(null);expect(result.originalUnchanged).toBe(true);
});

test('Cancel Select Subject and Escape discard actual native worker output arriving late',async({page})=>{
  const before=await page.evaluate(()=>{
    const Native=window.Worker;window.Worker=class extends Native{constructor(url:string|URL,options?:WorkerOptions){super(url,options);if(String(url).includes('pixels.worker'))Object.defineProperty(this,'onmessage',{set(handler:(event:MessageEvent)=>void){this.addEventListener('message',(event:MessageEvent)=>{if(event.data.selectionResult){(window as any).subjectArrived=true;setTimeout(()=>{handler(event);(window as any).subjectForwarded=true;},500);}else handler(event);});}});}};return window.luma.editor.document.toJSON();
  });
  for(const action of ['button','escape']){
    await page.evaluate(()=>{(window as any).subjectArrived=false;(window as any).subjectForwarded=false;});
    await page.getByRole('button',{name:'Subject',exact:true}).click();await page.waitForFunction(()=>(window as any).subjectArrived);
    if(action==='button')await page.getByRole('button',{name:'Cancel Select Subject',exact:true}).click();else await page.keyboard.press('Escape');
    await page.waitForFunction(()=>(window as any).subjectForwarded);await expect(page.getByRole('dialog',{name:'Select Subject',exact:true})).toHaveCount(0);expect(await page.evaluate(()=>window.luma.editor.document.toJSON())).toEqual(before);
  }
});

test('documented subject script is atomic and late plugin image-reading revocation blocks staged results',async({page})=>{
  const guide=await readFile('docs/SCRIPTING_API.md','utf8'),source=guide.match(/```js\n\/\/ example: subject-selection\n([\s\S]*?)```/)![1];
  const initial=await page.evaluate(async source=>{const {editor}=window.luma,before=editor.document.toJSON();await editor.runScript(source);const selection=editor.document.selection!.toJSON();editor.document.undo();try{await editor.runScript(source+'\nthrow new Error("Later failure");');}catch{}return{before,selection,after:editor.document.toJSON()};},source);expect(initial.selection.regions[0].shape).toBe('pixels');expect(initial.after).toEqual(initial.before);
  await page.evaluate(async source=>{
    const {editor}=window.luma,{PixelProcessor}=await import(/* @vite-ignore */String('/src/engine/processor.ts')),native=PixelProcessor.prototype.selectSubject;
    PixelProcessor.prototype.selectSubject=async function(...args:Parameters<typeof native>){const result=await native.apply(this,args);(window as any).subjectPrepared=true;return result;};
    editor.plugins.install({format:'luma-plugin',apiVersion:2,id:'test.subject',name:'Subject',version:'1.0.0',permissions:['document:read','document:write','assets:read'],commands:[{id:'run',title:'Run',source:source+'\nawait new Promise(resolve=>setTimeout(resolve,400));'}]});(window as any).subjectPending=editor.runPlugin('test.subject','run').then(()=>'',error=>String(error));
  },source);await page.waitForFunction(()=>(window as any).subjectPrepared);const result=await page.evaluate(async()=>{const {editor}=window.luma;editor.plugins.revokePermission('test.subject','assets:read');return{error:await(window as any).subjectPending,document:editor.document.toJSON()};});expect(result.error).toContain('assets:read');expect(result.document).toEqual(initial.before);
});

test('subject selection creates exact exported masks and saved channels with retained workspace redo',async({page})=>{
  const saved=await page.evaluate(async()=>{
    const {editor}=window.luma;await editor.selectSubject();const channel=editor.document.alphaChannels.capture('Subject');editor.document.selectedLayer!.maskFromSelection(channel.selection);
    const image=await createImageBitmap(await editor.exportPng()),canvas=document.createElement('canvas');canvas.width=64;canvas.height=48;const c=canvas.getContext('2d')!;c.drawImage(image,0,0);image.close();const pixels=[[10,10],[13,13],[30,36],[30,16],[51,19],[9,33]].map(([x,y])=>Array.from(c.getImageData(x,y,1,1).data));
    const before=editor.document.toJSON();await editor.selectSubject({expandRadius:2});const after=editor.document.toJSON();editor.document.undo();return{before,after,pixels,version:await editor.saveWorkspaceVersion('Subject history')};
  });expect(saved.pixels).toEqual([[255,0,0,255],[0,0,0,0],[255,0,0,255],[0,0,0,0],[255,0,0,255],[255,0,0,64]]);
  await page.reload();const restored=await page.evaluate(async version=>{const {editor}=window.luma;await editor.restoreWorkspace(version);const before=editor.document.toJSON();editor.document.redo();return{before,after:editor.document.toJSON()};},saved.version);expect(restored).toEqual({before:saved.before,after:saved.after});
});

test('isolated subject preparation uses staged placement and source dimensions before one atomic commit',async({page})=>{
  const result=await page.evaluate(async()=>{
    const {editor}=window.luma,before=editor.document.toJSON();await editor.runScript(`
      const target=document.selectedLayer;target.x=10;target.y=5;target.width=128;
      await document.selectSubject({targetLayerId:target.id});
    `);const selected=editor.document.selection!.toJSON(),placed=editor.document.selectedLayer!.toJSON();editor.document.undo();return{before,undone:editor.document.toJSON(),selected,placed};
  });expect(result.undone).toEqual(result.before);expect(result.selected.regions[0].coverage).toMatchObject({width:64,height:48});expect(result.selected.regions[0].transform).toEqual({a:2,b:0,c:0,d:1,e:10,f:5});expect(result.placed).toMatchObject({x:10,y:5,width:128});
});

test('native 50 MP subject coverage retains distant one-pixel alpha, holes, source bytes and project placement',async({page})=>{
  const bytes=await readFile('tests/fixtures/matting/native-50mp.png'),fixture=JSON.parse(await readFile('tests/fixtures/matting/native-50mp.json','utf8'));
  const result=await page.evaluate(async({bytes,points})=>{
    const {editor}=window.luma;editor.newDocument();await editor.importImage(new File([new Uint8Array(bytes)],'native-subject.png',{type:'image/png'}));
    const before=editor.document.getSnapshot().revision,progress:{completed:number;total:number}[]=[],longTasks:{start:number;duration:number}[]=[],observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())longTasks.push({start:entry.startTime,duration:entry.duration});});observer.observe({entryTypes:['longtask']});
    let queuedAt=0,inputResponseMs:number|undefined,captureMarked=false,inputDuringCapture=false,handVisibleDuringCapture=false;const start=performance.now();
    await editor.selectSubject({}, {onProgress:value=>{
      progress.push(value);if(value.completed===1&&!queuedAt){queuedAt=performance.now();setTimeout(()=>{(document.querySelector('button[aria-label="Hand tool (H)"]') as HTMLButtonElement).click();inputResponseMs=performance.now()-queuedAt;},0);}
      if(value.completed===200&&!captureMarked){captureMarked=true;inputDuringCapture=inputResponseMs!==undefined;handVisibleDuringCapture=document.querySelector('button[aria-label="Hand tool (H)"]')?.getAttribute('aria-pressed')==='true';}
    }});const end=performance.now(),selection=editor.document.selection!.toJSON(),coverage=selection.regions[0].coverage!,{coverageAt}=await import(/* @vite-ignore */String('/src/core/pixel-selection.ts'));
    const samples=points.map(([x,y]:number[])=>coverageAt(coverage,x,y)),revisionDelta=editor.document.getSnapshot().revision-before;await new Promise(resolve=>setTimeout(resolve,0));observer.disconnect();
    const project=await editor.saveProject();await editor.openProject(new File([project],'subject.luma'));const after=new Uint8Array(await editor.assetStore.values()[0].blob.arrayBuffer());
    return{milliseconds:end-start,width:coverage.width,height:coverage.height,samples,revisionDelta,inputResponseMs,inputDuringCapture,handVisibleDuringCapture,progressFirst:progress[0],progressLast:progress.at(-1),selectionRestored:JSON.stringify(selection)===JSON.stringify(editor.document.selection!.toJSON()),originalUnchanged:after.length===bytes.length&&after.every((value,i)=>value===bytes[i]),longTasks:longTasks.filter(task=>task.start<end&&task.start+task.duration>start)};
  },{bytes:[...bytes],points:fixture.points});
  console.log('50 MP native subject:',JSON.stringify(result));expect(result.samples).toEqual(fixture.alpha);expect([result.width,result.height]).toEqual([10000,5000]);expect(result.revisionDelta).toBe(1);expect(result.selectionRestored).toBe(true);expect(result.originalUnchanged).toBe(true);expect(result.progressFirst.completed).toBe(0);expect(result.progressLast!.completed).toBe(result.progressLast!.total);expect(result.inputDuringCapture).toBe(true);expect(result.handVisibleDuringCapture).toBe(true);expect(result.inputResponseMs).toBeLessThan(250);
});
