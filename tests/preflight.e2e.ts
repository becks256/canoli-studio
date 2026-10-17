import {test,expect,type Page} from '@playwright/test';
import {writeFile,readFile} from 'node:fs/promises';
async function setup(page:Page){
 await page.goto('/');await page.getByTestId('import-input').setInputFiles('tests/fixtures/matting/color-line.png');
 return page.evaluate(()=>{
  const {editor,TextLayer,RasterLayer}=window.luma,document=editor.document;document.resize(600,400);const source=document.layers.at(0)! as InstanceType<typeof RasterLayer>;source.width=18;source.height=10;source.x=10;source.y=10;
  const text=document.layers.add(new TextLayer({name:'Headline',text:'Review this font',fontFamily:'Canoli Preflight Missing Font 517892',x:-20,y:20}));document.selectedLayer=source;
  return{document:document.toJSON(),revision:document.getSnapshot().revision,past:document.getSnapshot().past.length,selected:document.selectedLayer!.id,textId:text.id};
 });
}

test('local design checks show real font, bounds and native sampling findings, export JSON and select a target without history',async({page})=>{
 const before=await setup(page);await page.getByRole('button',{name:'Design checks',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Design checks',exact:true});
 await dialog.getByRole('button',{name:'Print sampling',exact:true}).click();await dialog.getByRole('spinbutton',{name:'Minimum source PPI',exact:true}).fill('200');await dialog.getByRole('spinbutton',{name:'Minimum source PPI',exact:true}).blur();
 await dialog.getByRole('button',{name:'Run checks',exact:true}).click();await expect(dialog.locator('[data-check-code="font-unavailable"]')).toContainText('Canoli Preflight Missing Font 517892');await expect(dialog.locator('[data-check-code="low-resolution"]')).toContainText('150.0 PPI');await expect(dialog.locator('[data-check-code="bounds-outside"]')).toContainText('Headline');
 const download=page.waitForEvent('download');await dialog.getByRole('button',{name:'Download report',exact:true}).click();const stream=await(await download).createReadStream(),chunks:Buffer[]=[];for await(const chunk of stream!)chunks.push(Buffer.from(chunk));const report=JSON.parse(Buffer.concat(chunks).toString());await writeFile('/tmp/canoli-preflight-report.json',JSON.stringify(report,null,2)+'\n');expect(report.options).toMatchObject({outputDpi:300,minimumPpi:200});expect(report.revision).toBe(before.revision);expect(report.fonts[0].status).toBe('unavailable');expect(report.limitations.join(' ')).toContain('print readiness');
 expect(await page.evaluate(()=>({document:window.luma.editor.document.toJSON(),past:window.luma.editor.document.getSnapshot().past.length,selected:window.luma.editor.document.selectedLayer!.id}))).toEqual({document:before.document,past:before.past,selected:before.selected});
 await dialog.getByRole('spinbutton',{name:'Minimum source PPI',exact:true}).fill('100');await dialog.getByRole('spinbutton',{name:'Minimum source PPI',exact:true}).blur();await expect(dialog.getByText('This report is out of date.',{exact:false})).toBeVisible();await expect(dialog.getByRole('button',{name:'Download report',exact:true})).toBeDisabled();
 await dialog.getByRole('button',{name:'Run checks',exact:true}).click();await expect(dialog.getByText('This report is out of date.',{exact:false})).toHaveCount(0);await expect(dialog.locator('[data-check-code="low-resolution"]')).toHaveCount(0);
 await page.evaluate(async()=>{const face=new FontFace('Canoli Unrelated UI Font','url(/node_modules/@fontsource/dm-mono/files/dm-mono-latin-400-normal.woff2)'),loaded=new Promise<void>(resolve=>document.fonts.addEventListener('loadingdone',()=>resolve(),{once:true}));document.fonts.add(face);await face.load();await loaded;});
 await expect(dialog.getByRole('button',{name:'Download report',exact:true})).toBeEnabled();await expect(dialog.getByText('This report is out of date.',{exact:false})).toHaveCount(0);
 await page.setViewportSize({width:390,height:844});expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await dialog.screenshot({path:'/tmp/canoli-preflight-narrow.png'});
 await dialog.locator('[data-check-code="font-unavailable"]').getByRole('button',{name:'Select layer'}).click();await expect(dialog).toHaveCount(0);expect(await page.evaluate(()=>window.luma.editor.document.selectedLayer!.id)).toBe(before.textId);expect(await page.evaluate(()=>window.luma.editor.document.getSnapshot().past.length)).toBe(before.past);
});

test('isolated scripts inspect staged geometry, expose unverified fonts, and read-only plugins require current asset grants',async({page})=>{
 await setup(page);const guide=await readFile('docs/SCRIPTING_API.md','utf8'),example=guide.match(/<!-- example: design-checks -->\s*```js\n([\s\S]*?)\n```/)?.[1];expect(example).toBeTruthy();
 const result=await page.evaluate(async example=>{
  const {editor}=window.luma,before=editor.document.toJSON(),past=editor.document.getSnapshot().past.length;
  const guideLogs=await editor.runScript(example!);
  const logs=await editor.runScript(`const report=await document.preflight({outputDpi:300,minimumPpi:200});print(report.findings.find(f=>f.code==='low-resolution').effectivePpi,report.fonts[0].status);`);
  const afterRead=editor.document.toJSON(),pastAfterRead=editor.document.getSnapshot().past.length;let failed='';
  try{await editor.runScript(`document.layers.at(0).width=36;const report=await document.preflight({outputDpi:300,minimumPpi:200});print(report.findings.find(f=>f.code==='low-resolution').effectivePpi);throw new Error('Later inspection failure');`);}catch(error){failed=String(error);}
  const afterFailure=editor.document.toJSON();const plugin={format:'luma-plugin',apiVersion:2,id:'test.preflight',name:'Design inspector',version:'1.0.0',permissions:['document:read','assets:read'],commands:[{id:'inspect',title:'Inspect',source:`await new Promise(resolve=>setTimeout(resolve,100));const report=await document.preflight();print(report.layersChecked);`}]};editor.plugins.install(plugin);
  const installed=editor.document.toJSON(),allowed=await editor.runPlugin(plugin.id,'inspect'),pending=editor.runPlugin(plugin.id,'inspect');editor.plugins.revokePermission(plugin.id,'assets:read');let denied='';try{await pending;}catch(error){denied=String(error);}
  return{before,past,guideLogs,logs,afterRead,pastAfterRead,failed,afterFailure,installed,allowed,denied,afterPlugin:editor.document.toJSON(),pastAfterPlugin:editor.document.getSnapshot().past.length};
 },example);
 expect(result.guideLogs.join(' ')).toContain('Design checks');expect(result.guideLogs.join(' ')).toContain('font-unchecked');
 expect(result.logs.join(' ')).toContain('150 unknown');expect(result.afterRead).toEqual(result.before);expect(result.pastAfterRead).toBe(result.past);expect(result.failed).toContain('Later inspection failure');expect(result.afterFailure).toEqual(result.before);expect(result.installed).toEqual(result.before);expect(result.allowed.join(' ')).toContain('2');expect(result.denied).toContain('assets:read');expect(result.afterPlugin).toEqual(result.before);expect(result.pastAfterPlugin).toBe(result.past);
});

for(const action of ['cancel','revision','switch-away-back'] as const)test(`late real design-worker output rejects after ${action}`,async({page})=>{
 await setup(page);
 const result=await page.evaluate(async action=>{
  const {editor}=window.luma,original=editor.document,before=original.toJSON(),past=original.getSnapshot().past.length,NativeWorker=window.Worker,abort=new AbortController();let completed=0,terminated=0;
  window.Worker=class extends NativeWorker{
   private tracked:boolean;
   constructor(url:string|URL,options?:WorkerOptions){super(url,options);this.tracked=String(url).includes('preflight.worker');if(this.tracked)this.addEventListener('message',event=>{if(event.data.report){completed++;if(action==='cancel')abort.abort(new Error('User cancelled inspection'));else if(action==='revision')original.name='Intentional change';else{editor.newDocument();editor.activateDocument(original);}}});}
   terminate(){if(this.tracked)terminated++;super.terminate();}
  };
  let error='';try{await editor.preflight({checkFonts:false},{signal:abort.signal});}catch(cause){error=String(cause);}finally{window.Worker=NativeWorker;}
  return{before,after:original.toJSON(),past,pastAfter:original.getSnapshot().past.length,error,completed,terminated};
 },action);
 expect(result.completed).toBe(1);expect(result.terminated).toBe(1);expect(result.error).toMatch(/cancelled|changed/i);
 if(action==='revision'){expect(result.after).toEqual({...result.before,name:'Intentional change'});expect(result.pastAfter).toBe(result.past+1);}else{expect(result.after).toEqual(result.before);expect(result.pastAfter).toBe(result.past);}
});

test('font probe timeout is unknown and abort stops waiting without reporting a missing family',async({page})=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const path='/src/engine/preflight.ts',{probePreflightFont}=await import(path),NativeFontFace=window.FontFace;
  window.FontFace=class {load(){return new Promise(()=>{});}} as unknown as typeof FontFace;
  try{const start=performance.now(),status=await probePreflightFont('Canoli Timeout Font 517892'),elapsed=performance.now()-start,abort=new AbortController();const pending=probePreflightFont('Canoli Timeout Font 517892',abort.signal);abort.abort(new Error('Probe cancelled'));let error='';try{await pending;}catch(cause){error=String(cause);}return{status,elapsed,error};}finally{window.FontFace=NativeFontFace;}
 });expect(result.status).toBe('unknown');expect(result.elapsed).toBeGreaterThanOrEqual(1900);expect(result.elapsed).toBeLessThan(4000);expect(result.error).toContain('Probe cancelled');
});

test('the palette opens checks and a genuine 50 MP source retains native sampling with responsive background inspection',async({page})=>{
 await page.goto('/');await page.getByTestId('import-input').setInputFiles('tests/fixtures/matting/native-50mp.png');await expect(page.locator('.layer-row')).toHaveCount(1);
 const result=await page.evaluate(async()=>{
  const {editor}=window.luma,doc=editor.document,source=editor.assetStore.get((doc.layers.at(0)! as any).assetId),before=doc.toJSON(),revision=doc.getSnapshot().revision,bytes=new Uint8Array(await source.blob.arrayBuffer()),tasks:number[]=[],observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())tasks.push(entry.duration);});observer.observe({type:'longtask'});
  const at=performance.now();let responseMs=0;const callback=new Promise<void>(resolve=>setTimeout(()=>{responseMs=performance.now()-at;resolve();},0));const report=await editor.preflight({checkFonts:false});await callback;for(const entry of observer.takeRecords())tasks.push(entry.duration);observer.disconnect();
  const after=new Uint8Array(await source.blob.arrayBuffer());return{report,elapsedMs:performance.now()-at,responseMs,tasks,before,after:doc.toJSON(),revision,afterRevision:doc.getSnapshot().revision,sourceUnchanged:bytes.length===after.length&&bytes.every((value,i)=>value===after[i])};
 });expect(result.report.findings).toEqual([]);expect(result.report.layersChecked).toBe(1);expect(result.after).toEqual(result.before);expect(result.afterRevision).toBe(result.revision);expect(result.sourceUnchanged).toBe(true);expect(result.responseMs).toBeLessThan(250);await writeFile('/tmp/canoli-preflight-50mp.json',JSON.stringify({...result,before:undefined,after:undefined},null,2));
 await page.keyboard.press('Control+k');await page.getByPlaceholder('Search tools, layers, and actions…').fill('Design checks');await page.getByRole('option',{name:'Design checks'}).click();await expect(page.getByRole('dialog',{name:'Design checks',exact:true})).toBeVisible();
});

test('Cancel checks in the dialog rejects real late output and leaves no report or undo entry',async({page})=>{
 const before=await setup(page);await page.evaluate(()=>{
  const NativeWorker=window.Worker;(window as any).inspectionCancellation={completed:0,terminated:0};
  window.Worker=class extends NativeWorker{
   private tracked:boolean;
   constructor(url:string|URL,options?:WorkerOptions){super(url,options);this.tracked=String(url).includes('preflight.worker');if(this.tracked)this.addEventListener('message',event=>{if(event.data.report){(window as any).inspectionCancellation.completed++;Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Cancel checks')!.click();}});}
   terminate(){if(this.tracked)(window as any).inspectionCancellation.terminated++;super.terminate();}
  };
 });
 await page.getByRole('button',{name:'Design checks',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Design checks',exact:true});await dialog.getByRole('checkbox',{name:'Check browser font families'}).uncheck();await dialog.getByRole('button',{name:'Run checks',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('cancelled');await expect(dialog.getByRole('region',{name:'Design check results'})).toHaveCount(0);expect(await page.evaluate(()=>(window as any).inspectionCancellation)).toEqual({completed:1,terminated:1});expect(await page.evaluate(()=>({document:window.luma.editor.document.toJSON(),past:window.luma.editor.document.getSnapshot().past.length}))).toEqual({document:before.document,past:before.past});
});

test('a pending web font is unverified, and completed font loading makes an existing report stale',async({page})=>{
 await page.goto('/');let release:()=>void=()=>{};const gate=new Promise<void>(resolve=>release=resolve);
 await page.route('**/preflight-pending.woff2',async route=>{await gate;await route.fulfill({path:'node_modules/@fontsource/dm-mono/files/dm-mono-latin-400-normal.woff2',contentType:'font/woff2'});});
 await page.evaluate(()=>{
  const {editor,TextLayer}=window.luma;editor.newDocument({width:600,height:200});editor.document.layers.add(new TextLayer({fontFamily:'Canoli Pending Preflight Font',text:'Loading family',x:20,y:20}));
  const face=new FontFace('Canoli Pending Preflight Font','url(/preflight-pending.woff2)');document.fonts.add(face);(window as any).pendingPreflightFont=face.load();
 });
 await page.getByRole('button',{name:'Design checks',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Design checks',exact:true});await dialog.getByRole('button',{name:'Run checks',exact:true}).click();await expect(dialog.locator('[data-check-code="font-unchecked"]')).toContainText('Canoli Pending Preflight Font');await expect(dialog.locator('[data-check-code="font-unavailable"]')).toHaveCount(0);await expect(dialog.getByRole('button',{name:'Download report',exact:true})).toBeEnabled();
 release();await page.evaluate(async()=>{await (window as any).pendingPreflightFont;await document.fonts.ready;});await expect(dialog.getByText('This report is out of date.',{exact:false})).toBeVisible();await expect(dialog.getByRole('button',{name:'Download report',exact:true})).toBeDisabled();await dialog.getByRole('button',{name:'Run checks',exact:true}).click();await expect(dialog.getByText('No findings in these enabled checks.',{exact:false})).toBeVisible();await expect(dialog.getByRole('button',{name:'Download report',exact:true})).toBeEnabled();
});
