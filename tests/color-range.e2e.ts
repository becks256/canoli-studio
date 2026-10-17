import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
test.beforeEach(async({page})=>{
  await page.goto('/');await page.evaluate(async()=>{
    const {editor,RasterLayer}=window.luma;editor.newDocument({width:64,height:32});
    const canvas=document.createElement('canvas');canvas.width=64;canvas.height=32;const c=canvas.getContext('2d')!;
    c.fillStyle='#ff0000';c.fillRect(0,0,32,32);c.fillStyle='#0000ff';c.fillRect(32,0,32,32);c.clearRect(60,28,4,4);
    const patch=c.createImageData(8,4);for(let i=0;i<patch.data.length;i+=4)patch.data.set([255,0,0,128],i);c.putImageData(patch,4,24);
    const blob=await new Promise<Blob>(resolve=>canvas.toBlob(v=>resolve(v!))),asset=await editor.assetStore.add(blob,'Original',undefined,false);
    editor.document.selectedLayer=editor.document.layers.add(new RasterLayer({name:'Original',assetId:asset.id,width:64,height:32}));
  });
});

test('Color Range dialog samples native colors, previews without history, applies once, undoes and respects transparent inverse',async({page})=>{
  await page.keyboard.press('Control+k');await page.getByLabel('Search commands').fill('color range');await page.getByRole('option',{name:'Select Color Range…'}).click();
  const dialog=page.getByRole('dialog',{name:'Color Range',exact:true});await expect(dialog).toBeVisible();
  const before=await page.evaluate(()=>window.luma.editor.document.getSnapshot().revision);
  const x=dialog.getByRole('spinbutton',{name:'Sample X',exact:true}),y=dialog.getByRole('spinbutton',{name:'Sample Y',exact:true});
  await x.fill('4');await x.press('Enter');await y.fill('4');await y.press('Enter');await dialog.getByRole('button',{name:'Sample pixel',exact:true}).click();
  await expect(dialog.getByLabel('Included color 1',{exact:true})).toHaveValue('#ff0000');
  const fuzzy=dialog.getByRole('spinbutton',{name:'Fuzziness value',exact:true});await fuzzy.fill('0');await fuzzy.press('Enter');
  await expect.poll(()=>dialog.locator('canvas').evaluate(node=>(node as HTMLCanvasElement).width)).toBe(64);
  await expect.poll(()=>dialog.locator('canvas').evaluate(node=>{const c=(node as HTMLCanvasElement).getContext('2d')!;return [c.getImageData(4,4,1,1).data[0],c.getImageData(48,4,1,1).data[0]];})).toEqual([255,0]);
  expect(await page.evaluate(()=>window.luma.editor.document.getSnapshot().revision)).toBe(before);
  expect(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);await page.screenshot({path:'/tmp/canoli-color-range-dialog.png'});
  await dialog.getByRole('button',{name:'Apply color range',exact:true}).click();await expect(dialog).toHaveCount(0);
  const result=await page.evaluate(async()=>{
    const {editor}=window.luma;const {renderSelection,instantiateKernel}=await import(/* @vite-ignore */String('/src/engine/wasm.ts'));const kernel=await instantiateKernel(await(await fetch('/wasm/pixels.wasm')).arrayBuffer());
    const a=renderSelection(kernel,{selection:editor.document.selection!.toJSON(),width:64,height:32,x:0,y:0,stepX:1,stepY:1});return{revision:editor.document.getSnapshot().revision,alpha:[[4,4],[48,4],[4,24],[62,30]].map(([x,y])=>a[(y*64+x)*4+3])};
  });expect(result.revision).toBe(before+1);expect(result.alpha).toEqual([255,0,128,0]);
  await page.getByLabel('Editing canvas',{exact:true}).focus();await page.keyboard.press('Control+z');expect(await page.evaluate(()=>window.luma.editor.document.selection)).toBe(null);
  await page.getByRole('button',{name:'Color Range…',exact:true}).click();const inverse=page.getByRole('dialog',{name:'Color Range',exact:true});
  await inverse.getByLabel('Invert color range',{exact:true}).check();await inverse.getByRole('button',{name:'Cancel',exact:true}).click();expect(await page.evaluate(()=>window.luma.editor.document.selection)).toBe(null);
});

test('native color selections combine, mask, export and reopen without changing original image bytes',async({page})=>{
  const result=await page.evaluate(async()=>{
    const {editor,MarqueeSelection}=window.luma,original=Array.from(new Uint8Array(await editor.assetStore.values()[0].blob.arrayBuffer()));
    const sample=async()=>{const {renderSelection,instantiateKernel}=await import(/* @vite-ignore */String('/src/engine/wasm.ts'));const kernel=await instantiateKernel(await(await fetch('/wasm/pixels.wasm')).arrayBuffer());const a=renderSelection(kernel,{selection:editor.document.selection!.toJSON(),width:64,height:32,x:0,y:0,stepX:1,stepY:1});return[[4,4],[48,4],[4,24],[62,30]].map(([x,y])=>a[(y*64+x)*4+3]);};
    await editor.document.selectColorRange({colors:['#ff0000'],fuzziness:0});const red=await sample();
    await editor.document.selectColorRange({colors:['#0000ff'],fuzziness:0,operation:'add'});const union=await sample();editor.document.undo();
    await editor.document.selectColorRange({colors:['#ff0000'],fuzziness:0,operation:'subtract'});const subtract=await sample();editor.document.undo();
    await editor.document.selectColorRange({colors:['#ff0000','#0000ff'],exclude:['#ff0000'],fuzziness:0});const excluded=await sample();editor.document.undo();
    await editor.document.selectColorRange({colors:['#ff0000'],fuzziness:0,invert:true});const inverse=await sample();editor.document.undo();
    editor.document.selectedLayer!.maskFromSelection(editor.document.selection!);
    const pixels=async()=>{const image=await createImageBitmap(await editor.exportPng()),c=document.createElement('canvas');c.width=64;c.height=32;const ctx=c.getContext('2d')!;ctx.drawImage(image,0,0);image.close();return[[4,4],[48,4],[4,24],[62,30]].map(([x,y])=>Array.from(ctx.getImageData(x,y,1,1).data));};
    const masked=await pixels(),before=editor.document.toJSON(),project=await editor.saveProject();await editor.openProject(new File([project],'color-range.luma'));
    return{red,union,subtract,excluded,inverse,masked,reopened:await pixels(),before,after:editor.document.toJSON(),original,originalAfter:Array.from(new Uint8Array(await editor.assetStore.values()[0].blob.arrayBuffer())),selection:editor.document.selection instanceof MarqueeSelection};
  });
  expect(result.red).toEqual([255,0,128,0]);expect(result.union).toEqual([255,255,128,0]);expect(result.subtract).toEqual([0,0,64,0]);expect(result.excluded).toEqual([0,255,0,0]);expect(result.inverse).toEqual([0,255,0,0]);
  expect(result.masked).toEqual([[255,0,0,255],[0,0,0,0],[255,0,0,64],[0,0,0,0]]);expect(result.reopened).toEqual(result.masked);expect(result.before).toEqual(result.after);expect(result.originalAfter).toEqual(result.original);expect(result.selection).toBe(true);
});

test('merged, isolated transformed layers, original assets and native sample points use their stated sources',async({page})=>{
  const result=await page.evaluate(async()=>{
    const {editor,LayerGroup,PaintLayer,PaintFill,AffineTransform}=window.luma;
    const {sampleColorRange,previewColorRange}=await import(/* @vite-ignore */String('/src/engine/color-range.ts'));
    const group=editor.document.layers.add(new LayerGroup()),paint=group.layers.add(new PaintLayer({name:'Green'}));paint.strokes.add(new PaintFill({color:'#00ff00',bounds:{x:0,y:0,width:8,height:8}}));group.transform=AffineTransform.translation(40,10);
    const source=editor.document.getSnapshot().document,control=new AbortController();
    const merged=await sampleColorRange(source,editor.assetStore,{colors:['#ffffff']},{x:42,y:12},control.signal);
    const isolated=await sampleColorRange(source,editor.assetStore,{colors:['#ffffff'],source:{kind:'layer',layerId:paint.id}},{x:42,y:12},control.signal);
    const asset=editor.assetStore.values()[0],original=await sampleColorRange(source,editor.assetStore,{colors:['#ffffff'],source:{kind:'asset',assetId:asset.id}},{x:42,y:12},control.signal);
    paint.locked=true;await editor.document.selectColorRange({colors:['#00ff00'],fuzziness:0,source:{kind:'layer',layerId:paint.id}});
    const preview=await previewColorRange(editor.document.getSnapshot().document,editor.assetStore,{colors:['#00ff00'],fuzziness:0},control.signal);
    return{merged,isolated,original,matched:preview.coverage[12*64+42],other:preview.coverage[4*64+4],locked:paint.locked};
  });expect(result).toEqual({merged:'#00ff00',isolated:'#00ff00',original:'#0000ff',matched:255,other:0,locked:true});
});

test('cancelled, stale or closed native Color Range work does not commit coverage',async({page})=>{
  const result=await page.evaluate(async()=>{
    const {editor}=window.luma;editor.document.resize(2050,1025);const before=editor.document.toJSON(),abort=new AbortController();
    let cancelled='';try{await editor.document.selectColorRange({colors:['#ff0000'],fuzziness:40},{signal:abort.signal,onProgress:progress=>{if(progress.completed)abort.abort();}});}catch(error){cancelled=String(error);}
    const afterCancel=editor.document.toJSON();let stale='';try{await editor.document.selectColorRange({colors:['#ff0000']},{onProgress:progress=>{if(progress.completed===1)editor.document.name='Concurrent';}});}catch(error){stale=String(error);}
    const afterStale=editor.document.toJSON();return{before,afterCancel,cancelled,afterStale,stale};
  });expect(result.cancelled).toMatch(/abort|cancel/i);expect(result.afterCancel).toEqual(result.before);expect(result.stale).toContain('changed');expect(result.afterStale.selection).toEqual(result.before.selection);expect(result.afterStale.name).toBe('Concurrent');
});

test('documented Color Range script stages coverage atomically and plugins enforce current asset-reading grants',async({page})=>{
  const guide=await readFile('docs/SCRIPTING_API.md','utf8'),source=guide.match(/```js\n\/\/ example: color-range\n([\s\S]*?)```/)![1];
  const result=await page.evaluate(async source=>{
    const editor=window.luma.editor,before=editor.document.toJSON();await editor.runScript(source);const after=editor.document.toJSON();editor.document.undo();const undone=editor.document.toJSON();editor.document.redo();
    let invalid='';try{await editor.runScript(`document.name='Discard';await document.selectColorRange({colors:['invalid']});`);}catch(error){invalid=String(error);}const failed=editor.document.toJSON();
    editor.plugins.install({format:'luma-plugin',apiVersion:2,id:'test.color-range',name:'Colors',version:'1.0.0',permissions:['document:read','document:write','assets:read'],commands:[{id:'select',title:'Select',source:source+"\nawait new Promise(resolve=>setTimeout(resolve,300));"}]});const installed=editor.document.toJSON();
    const pending=editor.runPlugin('test.color-range','select');editor.plugins.revokePermission('test.color-range','assets:read');let denied='';try{await pending;}catch(error){denied=String(error);}const rejected=editor.document.toJSON();
    editor.plugins.grantPermission('test.color-range','assets:read');await editor.runPlugin('test.color-range','select');return{before,after,undone,failed,invalid,installed,rejected,denied,final:editor.document.toJSON()};
  },source);expect(result.after.selection).not.toBe(null);expect(result.undone).toEqual(result.before);expect(result.failed).toEqual(result.after);expect(result.invalid).toBeTruthy();expect(result.installed).toEqual(result.after);expect(result.rejected).toEqual(result.after);expect(result.denied).toContain('assets:read');expect(result.final.selection).toEqual(result.after.selection);
});

test('native 50 MP Color Range retains disconnected matches, seams, source bytes and editable project coverage',async({page})=>{
  const bytes=await readFile('tests/fixtures/color-range/native-50mp.png');
  const result=await page.evaluate(async bytes=>{
    const {editor}=window.luma;editor.newDocument();await editor.importImage(new File([new Uint8Array(bytes)],'native-50mp.png',{type:'image/png'}));
    const asset=editor.assetStore.values()[0],original=new Uint8Array(await asset.blob.arrayBuffer()),before=editor.document.getSnapshot().revision,progress:{completed:number;total:number}[]=[];
    const {CanvasRenderer}=await import(/* @vite-ignore */String('/src/engine/renderer.ts'));
    const render=CanvasRenderer.prototype.render;let nativeTiles=0,maxNativeTilePixels=0;
    CanvasRenderer.prototype.render=async function(this:import('../src/engine/renderer').CanvasRenderer,source:import('../src/core/model').DocumentData,assets:import('../src/core/assets').AssetStore,options:import('../src/engine/renderer').RenderOptions={}){
      const result=await render.call(this,source,assets,options);if(source.id===editor.document.id&&options.cache===false&&options.readback&&options.region){nativeTiles++;maxNativeTilePixels=Math.max(maxNativeTilePixels,result.width*result.height);}return result;
    };
    const start=performance.now();try{await editor.document.selectColorRange({colors:['#ff0000'],fuzziness:0},{onProgress:value=>progress.push(value)});}finally{CanvasRenderer.prototype.render=render;}
    const milliseconds=performance.now()-start,committedRevision=editor.document.getSnapshot().revision;
    const {coverageAt}=await import(/* @vite-ignore */String('/src/core/pixel-selection.ts'));const selection=editor.document.selection!.toJSON(),coverage=selection.regions[0].coverage!;
    const points=[[0,0],[511,511],[512,512],[4999,2499],[5000,2499],[0,4999],[9999,4999]],samples=points.map(([x,y])=>coverageAt(coverage,x,y));
    const project=await editor.saveProject();await editor.openProject(new File([project],'selected50.luma'));const after=new Uint8Array(await editor.assetStore.values()[0].blob.arrayBuffer());
    return{milliseconds,dimensions:[editor.document.width,editor.document.height],samples,selectionRestored:JSON.stringify(editor.document.selection!.toJSON())===JSON.stringify(selection),originalUnchanged:original.every((value,i)=>value===after[i])&&original.length===after.length,revisionDelta:committedRevision-before,progressFirst:progress[0],progressLast:progress.at(-1),coverageSize:[coverage.width,coverage.height],nativeTiles,maxNativeTilePixels};
  },Array.from(bytes));expect(result.dimensions).toEqual([10000,5000]);expect(result.coverageSize).toEqual([10000,5000]);expect(result.samples).toEqual([255,255,255,255,0,0,255]);expect(result.selectionRestored).toBe(true);expect(result.originalUnchanged).toBe(true);expect(result.revisionDelta).toBe(1);expect(result.progressFirst.completed).toBe(0);expect(result.progressLast!.completed).toBe(result.progressLast!.total);expect(result.nativeTiles).toBe(result.progressLast!.total);expect(result.maxNativeTilePixels).toBeLessThanOrEqual(512*512);console.log('50 MP native Color Range:',JSON.stringify(result));
});

test('current and redo-only color coverage survives workspace restoration',async({page})=>{
  const saved=await page.evaluate(async()=>{const {editor}=window.luma;await editor.document.selectColorRange({colors:['#ff0000'],fuzziness:0});const before=editor.document.toJSON();await editor.document.selectColorRange({colors:['#0000ff'],fuzziness:0});const after=editor.document.toJSON();editor.document.undo();return{version:await editor.saveWorkspaceVersion('Color selection history'),before,after};});
  await page.reload();const restored=await page.evaluate(async version=>{const editor=window.luma.editor;await editor.restoreWorkspace(version);const before=editor.document.toJSON();editor.document.redo();return{before,after:editor.document.toJSON()};},saved.version);expect(restored).toEqual({before:saved.before,after:saved.after});
});

test('asset-read revocation after native preparation discards the staged plugin selection',async({page})=>{
  await page.evaluate(async()=>{
    const {SelectionRows}=await import(/* @vite-ignore */String('/src/core/selection-rows.ts'));
    const original=SelectionRows.prototype.finish;SelectionRows.prototype.finish=function(){const result=original.call(this);(window as any).colorPrepared=true;return result;};
    const editor=window.luma.editor;(window as any).beforeColorPlugin=editor.document.toJSON();
    editor.plugins.install({format:'luma-plugin',apiVersion:2,id:'test.late-color',name:'Late color',version:'1.0.0',permissions:['document:read','document:write','assets:read'],commands:[{id:'select',title:'Select',source:`await document.selectColorRange({colors:['#ff0000'],fuzziness:0});await new Promise(resolve=>setTimeout(resolve,500));`}]});
    (window as any).colorPending=editor.runPlugin('test.late-color','select').then(()=>'',error=>String(error));
  });
  await page.waitForFunction(()=>(window as any).colorPrepared);
  const result=await page.evaluate(async()=>{const editor=window.luma.editor;editor.plugins.revokePermission('test.late-color','assets:read');return{error:await(window as any).colorPending,before:(window as any).beforeColorPlugin,after:editor.document.toJSON()};});
  expect(result.error).toContain('assets:read');expect(result.after).toEqual(result.before);
});

test('closing the Color Range dialog after real worker output prevents a late commit',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.getByRole('button',{name:'Color Range…',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Color Range',exact:true});
  await expect.poll(()=>dialog.locator('canvas').evaluate(node=>(node as HTMLCanvasElement).width)).toBe(64);
  await expect(dialog.getByText('Updating color preview…',{exact:true})).toHaveCount(0);
  const before=await page.evaluate(()=>{
    const Native=window.Worker;window.Worker=class extends Native{constructor(url:string|URL,options?:WorkerOptions){super(url,options);if(String(url).includes('pixels.worker'))Object.defineProperty(this,'onmessage',{set(handler:(event:MessageEvent)=>void){this.addEventListener('message',(event:MessageEvent)=>{if(event.data.colorRangeCoverage){(window as any).lateColorArrived=true;setTimeout(()=>{handler(event);(window as any).lateColorForwarded=true;},500);}else handler(event);});}});}};
    return window.luma.editor.document.toJSON();
  });
  await dialog.getByRole('button',{name:'Apply color range',exact:true}).click();await page.waitForFunction(()=>(window as any).lateColorArrived);
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(dialog).toHaveCount(0);await page.waitForFunction(()=>(window as any).lateColorForwarded);
  expect(await page.evaluate(()=>window.luma.editor.document.toJSON())).toEqual(before);
  expect(errors).toEqual([]);
});

test('narrow Color Range layout retains long sources, maximum sample controls and reachable cancel without history changes',async({page})=>{
  await page.setViewportSize({width:760,height:800});
  const before=await page.evaluate(()=>{const {editor,PaintLayer}=window.luma;editor.document.layers.add(new PaintLayer({name:'Long source '+'.'.repeat(220)}));return editor.document.toJSON();});
  await page.getByRole('button',{name:'Color Range…',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Color Range',exact:true});
  await dialog.getByLabel('Color Range source',{exact:true}).selectOption(before.children.at(-1)!.id);
  for(let i=1;i<32;i++)await dialog.getByRole('button',{name:'Add included color',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Add included color',exact:true})).toBeDisabled();await dialog.getByLabel('Included color 32',{exact:true}).scrollIntoViewIfNeeded();
  expect(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
  const box=(await dialog.boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(760);
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(dialog).toHaveCount(0);expect(await page.evaluate(()=>window.luma.editor.document.toJSON())).toEqual(before);
});

test('Color Range proxy and final masks use the same soft selection union and intersection rules',async({page})=>{
  await page.evaluate(async()=>{await window.luma.editor.document.selectColorRange({colors:['#ff0000'],fuzziness:0});});
  for(const operation of ['add','intersect'] as const){
    await page.getByRole('button',{name:'Color Range…',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Color Range',exact:true});
    await dialog.getByRole('spinbutton',{name:'Sample X',exact:true}).fill('4');await dialog.getByRole('spinbutton',{name:'Sample X',exact:true}).press('Enter');
    await dialog.getByRole('spinbutton',{name:'Sample Y',exact:true}).fill('24');await dialog.getByRole('spinbutton',{name:'Sample Y',exact:true}).press('Enter');
    await dialog.getByRole('button',{name:'Sample pixel',exact:true}).click();await expect(dialog.getByLabel('Included color 1',{exact:true})).toHaveValue('#ff0000');
    const fuzz=dialog.getByRole('spinbutton',{name:'Fuzziness value',exact:true});await fuzz.fill('0');await fuzz.press('Enter');await dialog.getByLabel('Combine selection',{exact:true}).selectOption(operation);
    await expect.poll(()=>dialog.locator('canvas').evaluate(node=>(node as HTMLCanvasElement).getContext('2d')!.getImageData(4,24,1,1).data[0])).toBe(128);
    await dialog.getByRole('button',{name:'Apply color range',exact:true}).click();await expect(dialog).toHaveCount(0);
    const actual=await page.evaluate(async()=>{const {editor}=window.luma;const {renderSelection,instantiateKernel}=await import(/* @vite-ignore */String('/src/engine/wasm.ts'));const kernel=await instantiateKernel(await(await fetch('/wasm/pixels.wasm')).arrayBuffer());return renderSelection(kernel,{selection:editor.document.selection!.toJSON(),width:1,height:1,x:4,y:24,stepX:1,stepY:1})[3];});expect(actual).toBe(128);
  }
});
