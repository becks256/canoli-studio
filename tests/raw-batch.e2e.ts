import {test,expect} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {readProject} from '../src/core/project';
const original=[...await readFile('tests/fixtures/raw/bayer-rggb.dng')],reference=[...await readFile('tests/fixtures/raw/exposure-up.png')];
const setup=async(page:import('@playwright/test').Page)=>{await page.goto('/');return page.evaluate(async bytes=>{
 const {editor}=window.luma,source=await editor.batch.prepareRawSource(new File([new Uint8Array(bytes)],'Native batch.dng',{type:'image/x-adobe-dng'}),{allowPrecisionLoss:true});
 await editor.recipes.saveRecipe({schemaVersion:1,id:'batch-raw',name:'Batch RAW',description:'Receiving original',version:1,parameters:[{name:'ev',label:'Exposure',type:'number',default:1.25}],steps:[{id:'raw',name:'Develop',target:{role:'selected'},action:{type:'raw.develop',allowPrecisionLoss:true,development:{exposure:'${ev}',highlightPreservation:0.5}}}]});
 const run=await editor.batch.createBatch({name:'RAW outputs',budgetId:'local-only',recipeId:'batch-raw',variants:[{id:'png',name:'Native PNG',format:'png',targetWidth:64,targetHeight:48,fit:'fill'},{id:'avif',name:'Native AVIF',format:'avif',targetWidth:64,targetHeight:48,fit:'fill',avifLossless:true,avifSpeed:10}]},[source]);return run.id;
},original);};

test('direct RAW batch prepares a native editable scene, exact working pixels and a source-preserving delivery package',async({page},info)=>{
 const id=await setup(page),result=await page.evaluate(async({id,reference})=>{
  const {editor}=window.luma,before=JSON.stringify(editor.document.toJSON());await editor.batch.start(id);const run=await editor.batch.waitForRun(id);if(run.status!=='completed')throw new Error(JSON.stringify(run.items));const item=run.items[0],png=(await editor.batch.getDeliverableBlob(item.deliverables.find(d=>d.variantId==='png')!.id))!,project=await editor.batch.getPreparedProject(id,item.id),zip=await editor.batch.exportDeliveryPackageZip(id);
  const a=await createImageBitmap(png),b=await createImageBitmap(new Blob([new Uint8Array(reference)],{type:'image/png'})),canvas=new OffscreenCanvas(64,48),ctx=canvas.getContext('2d')!;ctx.drawImage(a,0,0);const x=ctx.getImageData(0,0,64,48).data;ctx.clearRect(0,0,64,48);ctx.drawImage(b,0,0);const y=ctx.getImageData(0,0,64,48).data;let maximum=0;for(let i=0;i<x.length;i++)maximum=Math.max(maximum,Math.abs(x[i]-y[i]));a.close();b.close();canvas.width=canvas.height=0;
  return {maximum,readonly:before===JSON.stringify(editor.document.toJSON()),run,project:[...new Uint8Array(await project.arrayBuffer())],zip:[...new Uint8Array(await zip.arrayBuffer())]};
 },{id,reference});expect(result.maximum).toBe(0);expect(result.readonly).toBe(true);expect(result.run.items[0].preparation).toBeTruthy();expect(result.run.items[0].actualCostCents).toBe(0);
 const project=await readProject(new Blob([new Uint8Array(result.project)]));expect(project.document.children[0].kind).toBe('smart-object');expect(project.entries.some(entry=>entry.raw?.settings.development.exposure===1.25)).toBe(true);expect(Buffer.from(await project.entries[0].raw!.originalBlob.arrayBuffer())).toEqual(Buffer.from(original));
 expect(project.history?.version).toBe(4);if(project.history?.version!==4)throw Error('Missing accepted batch provenance');expect(project.history.provenance.current).toMatchObject({origin:{surface:'host',batch:{runId:id,itemId:result.run.items[0].id},recipe:{id:'batch-raw',version:1}}});expect(project.history.provenance.past[0]).toMatchObject({origin:{surface:'host',batch:{runId:id,itemId:result.run.items[0].id}}});
 const path=info.outputPath('raw-delivery.zip');await writeFile(path,Buffer.from(result.zip));const checked=spawnSync('python3',['-c',`import zipfile,json,hashlib,sys
with zipfile.ZipFile(sys.argv[1]) as z:
 m=json.loads(z.read('delivery-manifest.json'));r=json.loads(z.read('raw-preparation.json'));proof=r.pop('integrity');canonical=json.dumps(r,separators=(',',':'),ensure_ascii=False)
 assert hashlib.sha256(canonical.encode()).hexdigest()==proof['sha256']
 assert len(r['preparations'])==1 and len(m['deliverables'])==2
 p=r['preparations'][0];b=z.read(p['projectPath']);assert len(b)==p['projectByteLength'] and hashlib.sha256(b).hexdigest()==p['projectSha256']
 for d in m['deliverables']:
  assert d['sourceHash']==p['sourceSha256'];assert hashlib.sha256(z.read(d['filePath'])).hexdigest()==d['sha256']
 print(json.dumps({'projects':1,'deliverables':2,'hashesExact':True}))`,path],{encoding:'utf8'});expect(checked.status,checked.stderr).toBe(0);await info.attach('raw-batch-delivery',{body:JSON.stringify({maximum:result.maximum,readonly:result.readonly,run:result.run,archive:JSON.parse(checked.stdout)}),contentType:'application/json'});await info.attach('raw-batch-project.luma',{body:Buffer.from(result.project),contentType:'application/octet-stream'});
});

test('RAW retry after reload uses the accepted project with native decoder unavailable and keeps completed output identity',async({page},info)=>{
 await page.route('**/avif_enc.wasm*',route=>route.fulfill({status:404,body:'Encoder unavailable'}));const id=await setup(page),failed=await page.evaluate(async id=>{const {batch}=window.luma.editor;await batch.start(id);return batch.waitForRun(id);},id);expect(failed.status).toBe('failed');expect(failed.items[0].deliverables).toHaveLength(1);expect(failed.items[0].preparation).toBeTruthy();
 await page.reload();await page.unroute('**/avif_enc.wasm*');let rawLoads=0;await page.route('**/*canoli_raw_decoder*.wasm*',route=>{rawLoads++;return route.fulfill({status:404,body:'Native RAW unavailable on retry'});});
 const result=await page.evaluate(async id=>{const {editor}=window.luma,before=JSON.stringify(editor.document.toJSON());await editor.batch.retryFailed(id);const run=await editor.batch.waitForRun(id);await editor.batch.getPreparedProject(id,run.items[0].id);await editor.batch.exportDeliveryPackageZip(id);return {run,readonly:JSON.stringify(editor.document.toJSON())===before};},id);
 expect(result.run.status,JSON.stringify(result.run.items)).toBe('completed');expect(result.run.items[0].deliverables).toHaveLength(2);expect(result.run.items[0].deliverables[0]).toEqual(failed.items[0].deliverables[0]);expect(result.run.items[0].preparation).toEqual(failed.items[0].preparation);expect(result.run.items[0].retryCount).toBe(1);expect(rawLoads).toBe(0);expect(result.readonly).toBe(true);await info.attach('raw-checkpoint-retry',{body:JSON.stringify({failed,result,rawLoads}),contentType:'application/json'});
});

for(const corrupt of ['source','project','parameters']as const)test(`RAW partial retry rejects changed ${corrupt} without redeveloping or replacing completed variants`,async({page})=>{
 await page.route('**/avif_enc.wasm*',route=>route.fulfill({status:404,body:'Encoder unavailable'}));const id=await setup(page),result=await page.evaluate(async({id,corrupt})=>{
  const {batch}=window.luma.editor;await batch.start(id);const failed=await batch.waitForRun(id),item=failed.items[0];
  if(corrupt==='source')await batch.storage.saveDeliverableBlob('src-'+item.id,new Blob(['Bad source'],{type:'image/x-adobe-dng'}));else if(corrupt==='project')await batch.storage.saveDeliverableBlob('prepared-'+item.id,new Blob(['Bad project']));else await batch.storage.updateRun(id,run=>{run.items[0].parameters={ev:2};});
  await batch.retryFailed(id);const run=await batch.waitForRun(id);return {failed,run};
 },{id,corrupt});expect(result.run.status).toBe('failed');expect(result.run.items[0].deliverables).toEqual(result.failed.items[0].deliverables);expect(result.run.items[0].preparation).toEqual(result.failed.items[0].preparation);expect(result.run.items[0].error).toMatch(corrupt==='source'?/Source integrity/:corrupt==='project'?/Prepared RAW project/:/parameters differ/);
});

test('cancelling actual batch RAW development publishes no accepted project or deliverable and admits later work',async({page})=>{
 const id=await setup(page),result=await page.evaluate(async id=>{
  const {batch}=window.luma.editor;let entered=false,pending:Promise<void>|undefined;
  const stop=batch.subscribe(event=>{if(event.runId===id&&event.type==='item_progress'&&event.progress?.phase==='developing'&&!entered){entered=true;pending=batch.cancel(id);}});
  try{await batch.start(id);const run=await batch.waitForRun(id);await pending;const stored=await batch.storage.getDeliverableBlob('prepared-'+run.items[0].id);return{entered,run,stored:stored!==null};}finally{stop();}
 },id);expect(result.entered).toBe(true);expect(result.run.status).toBe('cancelled');expect(result.run.items[0].preparation).toBeUndefined();expect(result.run.items[0].deliverables).toEqual([]);expect(result.stored).toBe(false);
 const retryId=await setup(page);expect(await page.evaluate(async id=>{const b=window.luma.editor.batch;await b.start(id);return(await b.waitForRun(id)).status;},retryId)).toBe('completed');
});

test('batch upload reviews each original with explicit consent, supports custom WB and leaves the editor unchanged',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Batch',exact:true}).click();const batch=page.locator('.batch-dialog');await batch.getByLabel('Upload batch images',{exact:true}).setInputFiles([{name:'Reviewed.dng',mimeType:'image/x-adobe-dng',buffer:Buffer.from(original)},{name:'Skipped.dng',mimeType:'image/x-adobe-dng',buffer:Buffer.from(original)}]);const raw=page.getByRole('dialog',{name:'Queue camera RAW',exact:true});await expect(raw).toContainText('Reviewed.dng');await expect(raw.getByRole('button',{name:'Queue RAW image',exact:true})).toBeDisabled();await raw.getByRole('checkbox',{name:'Convert RAW development to 8-bit editing precision',exact:true}).check();await raw.getByRole('button',{name:'Queue RAW image',exact:true}).click();await expect(raw).toContainText('Skipped.dng');await page.keyboard.press('Escape');await expect(raw).toHaveCount(0);await expect(batch).toBeVisible();await expect(batch.locator('.queue-item')).toHaveCount(1);await expect(batch.locator('.queue-item')).toContainText('RAW');expect(await page.evaluate(()=>({layers:window.luma.editor.document.layers.length,assets:window.luma.editor.assetStore.values().length}))).toEqual({layers:0,assets:0});
 await batch.getByLabel('Upload batch images',{exact:true}).setInputFiles('tests/fixtures/raw/no-camera-wb.dng');await expect(raw).toContainText('no-camera-wb.dng');await raw.getByRole('checkbox',{name:'Convert RAW development to 8-bit editing precision',exact:true}).check();await expect(raw.getByRole('button',{name:'Queue RAW image',exact:true})).toBeDisabled();await raw.getByRole('combobox',{name:'RAW white balance',exact:true}).selectOption('auto');await raw.getByRole('button',{name:'Queue RAW image',exact:true}).click();await expect(raw).toHaveCount(0);await expect(batch.locator('.queue-item')).toHaveCount(2);expect(await page.evaluate(()=>window.luma.editor.batch.listRuns().then(r=>r.length))).toBe(0);
});

test('batch storage upgrades legacy sources without deleting bytes and reports an active old-tab blocker safely',async({page})=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const {BatchStorage}=await import(/* @vite-ignore */String('/src/ai/batch/storage.ts'));
  const old=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('luma-batch-storage',1);r.onupgradeneeded=()=>{r.result.createObjectStore('runs',{keyPath:'id'});r.result.createObjectStore('blobs');};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  await new Promise<void>((resolve,reject)=>{const tx=old.transaction('blobs','readwrite');tx.objectStore('blobs').put(new Blob(['Legacy complete original']),'legacy');tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});
  const storage=new BatchStorage();let error='';try{await storage.listRuns();}catch(cause){error=String(cause);}old.close();const text=await(await storage.getDeliverableBlob('legacy'))!.text();return{error,text};
 });expect(result.error).toMatch(/Close older/);expect(result.text).toBe('Legacy complete original');
});

test('prepared-scene quota failure publishes neither a partial checkpoint nor any delivery and permits a clean retry',async({page})=>{
 const id=await setup(page),result=await page.evaluate(async id=>{
  const service=window.luma.editor.batch,add=IDBObjectStore.prototype.add;
  IDBObjectStore.prototype.add=function(value,key){if(this.name==='blobs'&&String(key).startsWith('prepared-'))throw new DOMException('Prepared project quota','QuotaExceededError');return add.call(this,value,key);};let failed:import('../src/ai/batch/types').BatchRun;
  try{await service.start(id);failed=await service.waitForRun(id);}finally{IDBObjectStore.prototype.add=add;}
  const absent=await service.storage.getDeliverableBlob('prepared-'+failed.items[0].id);await service.retryFailed(id);const retried=await service.waitForRun(id);return{failed,absent:absent===null,retried};
 },id);expect(result.failed.status).toBe('failed');expect(result.failed.items[0].error).toMatch(/quota/i);expect(result.failed.items[0].preparation).toBeUndefined();expect(result.failed.items[0].deliverables).toEqual([]);expect(result.absent).toBe(true);expect(result.retried.status).toBe('completed');
});

test('documented direct RAW batch preserves a genuine 50 MP original and every native delivery pixel',async({page},info)=>{
 test.setTimeout(360000);const example=(await readFile('docs/SCRIPTING_API.md','utf8')).match(/<!-- example: raw-native-batch -->\s*```js\n([\s\S]*?)\n```/)?.[1];expect(example).toBeTruthy();await page.goto('/');const result=await page.evaluate(async({compressed,reference,example})=>{
  const compressedBytes=Uint8Array.from(atob(compressed),c=>c.charCodeAt(0)),original=await new Response(new Blob([compressedBytes]).stream().pipeThrough(new DecompressionStream('gzip'))).blob(),file=new File([original],'Batch native 50 MP.dng',{type:'image/x-adobe-dng'}),{editor}=window.luma,before=JSON.stringify(editor.document.toJSON());
  const {run,finished,project}=await new Function('editor','file',`return(async()=>{${example};return{run,finished,project};})()`)(editor,file)as {run:import('../src/ai/batch/types').BatchRun;finished:import('../src/ai/batch/types').BatchRun;project:Blob};
  const png=(await editor.batch.getDeliverableBlob(finished.items[0].deliverables[0].id))!,actual=await createImageBitmap(png),expected=await createImageBitmap(new Blob([new Uint8Array(reference)],{type:'image/png'})),canvas=new OffscreenCanvas(1024,64),ctx=canvas.getContext('2d')!;let maximum=0,samples=0;
  for(let y=0;y<actual.height;y+=64)for(let x=0;x<actual.width;x+=1024){const width=Math.min(1024,actual.width-x),height=Math.min(64,actual.height-y);canvas.width=width;canvas.height=height;ctx.drawImage(expected,x,y,width,height,0,0,width,height);const a=ctx.getImageData(0,0,width,height).data;ctx.clearRect(0,0,width,height);ctx.drawImage(actual,x,y,width,height,0,0,width,height);const b=ctx.getImageData(0,0,width,height).data;for(let i=0;i<a.length;i++)maximum=Math.max(maximum,Math.abs(a[i]-b[i]));samples+=a.length;}
  actual.close();expected.close();canvas.width=canvas.height=0;
  const stored=(await editor.batch.storage.getDeliverableBlob('src-'+finished.items[0].id))!,sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await stored.arrayBuffer())),n=>n.toString(16).padStart(2,'0')).join('');
  return{status:finished.status,maximum,samples,sourceSha256:sha,originalBytes:stored.size,projectBytes:project.size,readonly:JSON.stringify(editor.document.toJSON())===before,preparation:finished.items[0].preparation,png:[...new Uint8Array(await png.arrayBuffer())],id:run.id};
 },{compressed:(await readFile('tests/fixtures/raw/native-50mp.dng.gz')).toString('base64'),reference:[...await readFile('tests/fixtures/raw/native-50mp.png')],example:example!});expect(result).toMatchObject({status:'completed',maximum:0,samples:200000000,sourceSha256:'cfe25bed379735dfea685695e956838b284106e6527e6aff77e3901ef6ef9d85',originalBytes:100000672,readonly:true});expect(result.projectBytes).toBeGreaterThan(100000000);await info.attach('raw-batch-50mp.png',{body:Buffer.from(result.png),contentType:'image/png'});await info.attach('raw-batch-50mp.json',{body:JSON.stringify({...result,png:undefined}),contentType:'application/json'});
});

test('concurrent RAW batch items retain independent native settings, accepted pixels and complete originals',async({page})=>{
 await page.goto('/');const result=await page.evaluate(async({bytes,base,developed})=>{
  const {editor}=window.luma,first=await editor.batch.prepareRawSource(new File([new Uint8Array(bytes)],'First camera.dng'),{allowPrecisionLoss:true}),second=await editor.batch.prepareRawSource(new File([new Uint8Array(bytes)],'Second camera.dng'),{allowPrecisionLoss:true,development:{exposure:1.25,highlightPreservation:0.5}});
  const run=await editor.batch.createBatch({name:'Independent originals',budgetId:'local',concurrency:2,variants:[{id:'png',name:'Native',format:'png',targetWidth:64,targetHeight:48,fit:'fill'}]},[first,second]);await editor.batch.start(run.id);const completed=await editor.batch.waitForRun(run.id),errors=[];
  for(let i=0;i<completed.items.length;i++){
   const output=await editor.batch.getDeliverableBlob(completed.items[i].deliverables[0].id),expected=new Blob([new Uint8Array(i===0?base:developed)],{type:'image/png'}),a=await createImageBitmap(output!),b=await createImageBitmap(expected),canvas=new OffscreenCanvas(64,48),ctx=canvas.getContext('2d')!;ctx.drawImage(a,0,0);const x=ctx.getImageData(0,0,64,48).data;ctx.clearRect(0,0,64,48);ctx.drawImage(b,0,0);const y=ctx.getImageData(0,0,64,48).data;let maximum=0;for(let j=0;j<x.length;j++)maximum=Math.max(maximum,Math.abs(x[j]-y[j]));errors.push(maximum);a.close();b.close();canvas.width=canvas.height=0;
  }
  return {status:completed.status,errors,settings:completed.items.map(item=>item.source.raw!.options.development.exposure),prepared:completed.items.every(item=>Boolean(item.preparation)),editorLayers:editor.document.layers.length,editorAssets:editor.assetStore.values().length};
 },{bytes:original,base:[...await readFile('tests/fixtures/raw/bayer-rggb.png')],developed:reference});expect(result).toEqual({status:'completed',errors:[0,0],settings:[0,1.25],prepared:true,editorLayers:0,editorAssets:0});
});

test('disposing a batch service cancels actual RAW inspection without publishing queue or document state',async({page})=>{
 await page.goto('/');const result=await page.evaluate(async bytes=>{
  const {editor}=window.luma;let entered=false,error='';try{await editor.batch.prepareRawSource(new File([new Uint8Array(bytes)],'Disposed.dng'),{allowPrecisionLoss:true},{onProgress:value=>{if(entered||value.phase!=='inspecting')return;entered=true;editor.batch.dispose();}});}catch(cause){error=String(cause);}
  return{entered,error,runs:(await editor.batch.storage.listRuns()).length,layers:editor.document.layers.length,assets:editor.assetStore.values().length};
 },original);expect(result.entered).toBe(true);expect(result.error).toBeTruthy();expect(result).toMatchObject({runs:0,layers:0,assets:0});
});
