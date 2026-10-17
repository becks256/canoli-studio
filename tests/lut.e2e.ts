import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
const swap='TITLE "Swap"\nLUT_3D_SIZE 2\n0 0 0\n0 0 1\n0 1 0\n0 1 1\n1 0 0\n1 0 1\n1 1 0\n1 1 1';

test.beforeEach(async({page})=>{
  await page.goto('/');await page.evaluate(async()=>{
    const {editor,RasterLayer}=window.luma;editor.newDocument({width:64,height:32});
    const canvas=document.createElement('canvas');canvas.width=64;canvas.height=32;
    const c=canvas.getContext('2d')!;c.fillStyle='#507896';c.fillRect(0,0,64,32);
    const blob=await new Promise<Blob>(resolve=>canvas.toBlob(v=>resolve(v!))),asset=await editor.assetStore.add(blob,'Original',undefined,false);
    editor.document.selectedLayer=editor.document.layers.add(new RasterLayer({assetId:asset.id,width:64,height:32}));
  });
});

test('LUT palette, file controls, precise previews, reset, export and locks share one-entry history',async({page})=>{
  await page.keyboard.press('Control+k');await page.getByLabel('Search commands').fill('lookup');
  await page.getByRole('option',{name:'New Color Lookup (LUT) adjustment layer'}).click();
  await expect(page.getByLabel('Adjustment type',{exact:true})).toHaveValue('lut');
  const field=page.getByLabel('LUT file',{exact:true}),amount=page.getByRole('spinbutton',{name:'LUT amount value',exact:true});
  await expect(page.getByLabel('3D interpolation',{exact:true})).toBeDisabled();
  const revision=await page.evaluate(()=>window.luma.editor.document.getSnapshot().revision);
  await field.setInputFiles({name:'swap.cube',mimeType:'text/plain',buffer:Buffer.from(swap)});
  await expect(page.locator('.lut-controls')).toContainText('Swap');await expect(page.getByLabel('3D interpolation',{exact:true})).toBeEnabled();
  expect(await page.evaluate(()=>window.luma.editor.document.getSnapshot().revision)).toBe(revision+1);
  await amount.fill('35');expect(await page.evaluate(()=>window.luma.editor.document.getSnapshot().revision)).toBe(revision+1);
  await amount.press('Escape');await expect(amount).toHaveValue('100');await amount.fill('35');await amount.press('Enter');
  expect(await page.evaluate(()=>window.luma.editor.document.getSnapshot().revision)).toBe(revision+2);
  await page.getByLabel('3D interpolation',{exact:true}).selectOption('trilinear');
  const before=await page.evaluate(()=>window.luma.editor.document.toJSON());
  await field.setInputFiles({name:'bad.cube',mimeType:'text/plain',buffer:Buffer.from('LUT_3D_SIZE 2\n0 0 0')});
  await expect(page.locator('.lut-controls').getByRole('alert')).toContainText('Incomplete');
  expect(await page.evaluate(()=>window.luma.editor.document.toJSON())).toEqual(before);
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Export .cube',exact:true}).click();
  const stream=await(await downloading).createReadStream(),chunks:Buffer[]=[];for await(const chunk of stream!)chunks.push(Buffer.from(chunk));
  const exported=Buffer.concat(chunks).toString();expect(exported).toContain('LUT_3D_SIZE 2');
  const same=await page.evaluate(async source=>{const {parseCubeLut}=window.luma;return JSON.stringify(parseCubeLut(source))===JSON.stringify((window.luma.editor.document.selectedLayer as any).adjustment.lut);},exported);expect(same).toBe(true);
  await page.getByRole('button',{name:'Reset adjustment',exact:true}).click();await expect(page.locator('.lut-controls')).toContainText('Identity');
  await page.getByLabel('Editing canvas',{exact:true}).focus();await page.keyboard.press('Control+z');await expect(page.locator('.lut-controls')).toContainText('Swap');
  await page.screenshot({path:'/tmp/canoli-lut-inspector.png'});
  await page.evaluate(()=>{window.luma.editor.document.selectedLayer!.locked=true;});
  await expect(amount).toBeDisabled();await expect(page.getByRole('button',{name:'Import .cube',exact:true})).toBeDisabled();
});

test('masked imported LUTs preserve source bytes, PNG/PSD pixels, order, undo and project portability',async({page})=>{
  const result=await page.evaluate(async source=>{
    const {editor,AdjustmentLayer,LayerMask,MarqueeSelection}=window.luma;
    const {parsePsd}=await import(/* @vite-ignore */String('/src/core/interchange/psd/parser.ts'));
    const asset=editor.assetStore.values()[0],original=Array.from(new Uint8Array(await asset.blob.arrayBuffer()));
    const layer=new AdjustmentLayer({name:'Swap'});layer.setLut(source);editor.document.layers.add(layer);
    layer.mask=new LayerMask({selection:new MarqueeSelection({shape:'rectangle',x:0,y:0,width:32,height:32})});
    const pixels=async()=>{const image=await createImageBitmap(await editor.exportPng()),canvas=document.createElement('canvas');canvas.width=64;canvas.height=32;const c=canvas.getContext('2d')!;c.drawImage(image,0,0);image.close();return[4,48].map(x=>Array.from(c.getImageData(x,8,1,1).data));};
    const mapped=await pixels(),psds=[];
    for(const psdMode of ['layers','flatten'] as const){const output=await editor.export({format:'psd',psdMode}),parsed=parsePsd(new Uint8Array(await output.blob.arrayBuffer()));psds.push([4,48].map(x=>Array.from(parsed.composite!.data.slice((8*64+x)*4,(8*64+x)*4+4))));}
    // A nonlinear following tone operation makes ordering observable.
    const tone=editor.document.layers.add(new AdjustmentLayer({adjustment:{kind:'tone',exposure:0,contrast:50,saturation:-50}}));
    const afterTone=await pixels();tone.moveBefore(layer);const reordered=await pixels();editor.document.undo();const undone=await pixels();
    const before=editor.document.toJSON(),project=await editor.saveProject();await editor.openProject(new File([project],'lookup.luma'));
    return{mapped,psds,afterTone,reordered,undone,reopened:await pixels(),before,after:editor.document.toJSON(),original,originalAfter:Array.from(new Uint8Array(await editor.assetStore.values()[0].blob.arrayBuffer()))};
  },swap);
  expect(result.mapped).toEqual([[150,120,80,255],[80,120,150,255]]);for(const psd of result.psds)expect(psd).toEqual(result.mapped);
  expect(result.reordered).not.toEqual(result.afterTone);expect(result.undone).toEqual(result.afterTone);expect(result.reopened).toEqual(result.afterTone);
  expect(result.before).toEqual(result.after);expect(result.original).toEqual(result.originalAfter);
});

test('LUT worker snapshots its caller and renders native tile boundaries consistently',async({page})=>{
  const result=await page.evaluate(async source=>{
    const {PixelProcessor}=await import(/* @vite-ignore */String('/src/engine/processor.ts'));
    const {editor,AdjustmentLayer,defaultLutAdjustment,parseCubeLut,PaintLayer,PaintFill}=window.luma;
    const settings={...defaultLutAdjustment(),lut:parseCubeLut(source)},pixels=new Uint8ClampedArray([80,120,150,128]),processor=new PixelProcessor();
    const pending=processor.lookup(pixels,settings);pixels.fill(0);settings.amount=0;settings.lut.data=defaultLutAdjustment().lut.data;settings.lut.domainMin[0]=1;
    let actual:number[];try{actual=Array.from(await pending);}finally{processor.dispose();}
    editor.newDocument({width:2050,height:2});const paint=editor.document.layers.add(new PaintLayer());paint.strokes.add(new PaintFill({color:'#507896',bounds:{x:0,y:0,width:2050,height:2}}));
    const layer=new AdjustmentLayer();layer.setLut(source);editor.document.layers.add(layer);
    const image=await createImageBitmap(await editor.exportPng()),canvas=document.createElement('canvas');canvas.width=2050;canvas.height=2;
    const c=canvas.getContext('2d')!;c.drawImage(image,0,0);image.close();return{actual,size:pixels.byteLength,seams:[0,1023,1024,2047,2048,2049].map(x=>Array.from(c.getImageData(x,0,1,1).data))};
  },swap);
  expect(result.actual).toEqual([150,120,80,128]);expect(result.size).toBe(4);for(const pixel of result.seams)expect(pixel).toEqual([150,120,80,255]);
});

test('documented LUT script and inert plugins share rollback, revocation and offline undo',async({page})=>{
  const guide=await readFile('docs/SCRIPTING_API.md','utf8'),source=guide.match(/```js\n\/\/ example: lut\n([\s\S]*?)```/)![1];
  const result=await page.evaluate(async source=>{
    const editor=window.luma.editor,before=editor.document.toJSON();await editor.runScript(source);const after=editor.document.toJSON();editor.document.undo();const undone=editor.document.toJSON();editor.document.redo();
    let error='';try{await editor.runScript(`document.name='Must roll back';const bad=new AdjustmentLayer();bad.setLut('LUT_3D_SIZE 2');document.layers.add(bad);`);}catch(value){error=String(value);}
    const failed=editor.document.toJSON();editor.plugins.install({format:'luma-plugin',apiVersion:1,id:'test.lookup',name:'Lookup',version:'1.0.0',permissions:['document:read','document:write'],commands:[{id:'create',title:'Create',source:`await new Promise(resolve=>setTimeout(resolve,200));\n${source}`}]});
    const installed=editor.document.toJSON(),pending=editor.runPlugin('test.lookup','create');editor.plugins.revokePermission('test.lookup','document:write');let denied='';try{await pending;}catch(value){denied=String(value);}
    const rejected=editor.document.toJSON();editor.plugins.grantPermission('test.lookup','document:write');await editor.runPlugin('test.lookup','create');return{before,after,undone,failed,error,installed,rejected,denied,final:editor.document.toJSON()};
  },source);
  expect(result.undone).toEqual(result.before);expect(result.after.children).toHaveLength(result.before.children.length+1);expect(result.error).toContain('Incomplete');
  expect(result.failed).toEqual(result.after);expect(result.installed).toEqual(result.after);expect(result.rejected).toEqual(result.after);expect(result.denied).toContain('document:write');expect(result.final.children).toHaveLength(result.after.children.length+1);
});

test('workspace current and redo-only LUT tables restore across reload',async({page})=>{
  const saved=await page.evaluate(async source=>{
    const {editor,AdjustmentLayer}=window.luma,layer=new AdjustmentLayer();layer.setLut(source,{amount:35});editor.document.layers.add(layer);
    layer.setLut('TITLE "Other"\nLUT_1D_SIZE 2\n1 0 0\n0 1 1',{amount:65,interpolation:'trilinear'});const next=layer.adjustment;editor.document.undo();
    return{version:await editor.saveWorkspaceVersion('Lookup history'),before:editor.document.toJSON(),next};
  },swap);await page.reload();
  const restored=await page.evaluate(async version=>{const editor=window.luma.editor;await editor.restoreWorkspace(version);const before=editor.document.toJSON();editor.document.redo();return{before,next:(editor.document.layers.at(1) as any).adjustment};},saved.version);
  expect(restored.before).toEqual(saved.before);expect(restored.next).toEqual(saved.next);
});

test('50 MP LUT export preserves native resolution and exact colors at tile boundaries',async({page})=>{
  const result=await page.evaluate(async source=>{
    const {editor,AdjustmentLayer,PaintLayer,PaintFill}=window.luma;editor.newDocument({width:10000,height:5000});
    const paint=editor.document.layers.add(new PaintLayer());paint.strokes.add(new PaintFill({color:'#507896',bounds:{x:0,y:0,width:10000,height:5000}}));
    const layer=new AdjustmentLayer();layer.setLut(source);editor.document.layers.add(layer);const start=performance.now(),blob=await editor.exportPng(),milliseconds=performance.now()-start;
    const image=await createImageBitmap(blob),dimensions=[image.width,image.height],canvas=document.createElement('canvas');canvas.width=canvas.height=1;const c=canvas.getContext('2d')!;
    const samples=[[0,0],[1023,1023],[1024,1024],[9999,4999]].map(([x,y])=>{c.clearRect(0,0,1,1);c.drawImage(image,x,y,1,1,0,0,1,1);return Array.from(c.getImageData(0,0,1,1).data);});image.close();return{dimensions,samples,milliseconds};
  },swap);expect(result.dimensions).toEqual([10000,5000]);for(const pixel of result.samples)expect(pixel).toEqual([150,120,80,255]);console.log('50 MP LUT export:',JSON.stringify(result));
});

test('context LUT creation fits and cancelled or stale real worker imports cannot change the target',async({page})=>{
  await page.locator('.viewport').click({button:'right',position:{x:50,y:50}});
  expect(await page.locator('.canvas-context-menu').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
  await page.locator('.canvas-context-menu').getByRole('button',{name:'Color Lookup (LUT)',exact:true}).click();
  await page.evaluate(()=>{
    const Native=window.Worker;
    window.Worker=class extends Native {constructor(url:string|URL,options?:WorkerOptions){super(url,options);if(String(url).includes('lut-import')){
      Object.defineProperty(this,'onmessage',{set(handler:(event:MessageEvent)=>void){this.addEventListener('message',(event:MessageEvent)=>{(window as any).lutArrived=true;setTimeout(()=>{handler(event);(window as any).lutDelivered=true;},1000);});}});
    }}};
  });
  const field=page.getByLabel('LUT file',{exact:true}),before=await page.evaluate(()=>window.luma.editor.document.toJSON());
  await field.setInputFiles({name:'swap.cube',mimeType:'text/plain',buffer:Buffer.from(swap)});await page.waitForFunction(()=>(window as any).lutArrived);
  await page.getByRole('button',{name:'Cancel LUT',exact:true}).click();await page.waitForFunction(()=>(window as any).lutDelivered);
  expect(await page.evaluate(()=>window.luma.editor.document.toJSON())).toEqual(before);
  await page.evaluate(()=>{(window as any).lutArrived=false;(window as any).lutDelivered=false;});
  await field.setInputFiles({name:'swap.cube',mimeType:'text/plain',buffer:Buffer.from(swap)});await page.waitForFunction(()=>(window as any).lutArrived);
  const changed=await page.evaluate(()=>{const layer=window.luma.editor.document.selectedLayer as any;layer.adjustment={...layer.adjustment,amount:22};return window.luma.editor.document.toJSON();});
  await expect(page.locator('.lut-controls').getByRole('alert')).toContainText('changed while importing');
  expect(await page.evaluate(()=>window.luma.editor.document.toJSON())).toEqual(changed);
});

test('65-point Cube imports retain the full table and report actual main-thread responsiveness',async({page})=>{
  const size=65,rows=['TITLE "Native 65"','LUT_3D_SIZE 65'];
  for(let b=0;b<size;b++)for(let g=0;g<size;g++)for(let r=0;r<size;r++)rows.push(`${b/(size-1)} ${g/(size-1)} ${r/(size-1)}`);
  const path=test.info().outputPath('native65.cube');await writeFile(path,rows.join('\n'));
  const layer=await page.evaluate(()=>{const {editor,AdjustmentLayer,defaultLutAdjustment}=window.luma;const layer=editor.document.layers.add(new AdjustmentLayer({adjustment:defaultLutAdjustment()}));editor.document.selectedLayer=layer;return layer.id;});
  await page.getByLabel('LUT file',{exact:true}).waitFor({state:'attached'});
  const profiler=process.env.LUT_PROFILE?await page.context().newCDPSession(page):null;
  if(profiler){await profiler.send('Profiler.enable');await profiler.send('Profiler.start');}
  await page.evaluate(()=>{(window as any).lutLongTasks=[];const observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())(window as any).lutLongTasks.push(entry.duration);});observer.observe({type:'longtask'});(window as any).lutObserver=observer;(window as any).lutStart=performance.now();});
  await page.getByLabel('LUT file',{exact:true}).setInputFiles(path);
  await expect(page.locator('.lut-controls')).toContainText('Native 65');
  if(profiler){const profile=(await profiler.send('Profiler.stop')).profile;const nodes=new Map(profile.nodes.map(node=>[node.id,node]));const counts=new Map<string,number>();for(const id of profile.samples??[]){const frame=nodes.get(id)!.callFrame,key=`${frame.functionName} ${frame.url}:${frame.lineNumber+1}`;counts.set(key,(counts.get(key)??0)+1);}console.log('LUT import CPU samples:',JSON.stringify([...counts].sort((a,b)=>b[1]-a[1]).slice(0,18)));await profiler.detach();}
  const result=await page.evaluate(async id=>{
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));(window as any).lutObserver.disconnect();
    const importMs=performance.now()-(window as any).lutStart;
    const {editor}=window.luma,adjustment=(editor.document.getLayer(id) as any).adjustment;
    const image=await createImageBitmap(await editor.exportPng()),canvas=document.createElement('canvas');canvas.width=canvas.height=1;const c=canvas.getContext('2d')!;c.drawImage(image,0,0,1,1,0,0,1,1);image.close();
    const importAndPngMs=performance.now()-(window as any).lutStart,pixel=Array.from(c.getImageData(0,0,1,1).data);
    const project=await editor.saveProject();editor.newDocument();await editor.openProject(new File([project],'native65.luma'));
    const reopened=(editor.document.getLayer(id) as any).adjustment;
    return{size:adjustment.lut.size,base64Length:adjustment.lut.data.length,pixel,importMs,importAndPngMs,longTasks:(window as any).lutLongTasks,projectPortable:JSON.stringify(reopened)===JSON.stringify(adjustment)};
  },layer);
  expect(result.size).toBe(65);expect(result.base64Length).toBe(Math.ceil(65**3*12/3)*4);expect(result.pixel).toEqual([150,120,80,255]);expect(result.projectPortable).toBe(true);
  console.log('65-point LUT import:',JSON.stringify(result));
});
