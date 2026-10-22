import {test,expect} from '@playwright/test';
import {spawnSync} from 'node:child_process';
import {saveAvifBlob,checkAvif} from './helpers/avif';

test('AVIF batch fitting, saved settings, durable hashes and delivery ZIP survive reload without duplicate output',async({page},info)=>{
 await page.goto('/');
 const created=await page.evaluate(async()=>{
  const {editor}=window.luma;editor.ai.budgetLedger.setConsent('default-budget',true,'test');const c=document.createElement('canvas');c.width=80;c.height=48;const ctx=c.getContext('2d')!,data=ctx.createImageData(80,48);for(let i=0;i<80*48;i++)data.data.set([i%256,(i*17)%256,(i*43)%256,i%256],i*4);ctx.putImageData(data,0,0);const blob=await new Promise<Blob>(resolve=>c.toBlob(b=>resolve(b!),'image/png'));
  const variants=(['cover','contain','fill'] as const).flatMap(fit=>(['png','avif'] as const).map(format=>({id:fit+'-'+format,name:fit+'-'+format,targetWidth:97,targetHeight:73,format,fit,...(format==='avif'?{avifLossless:true,avifSpeed:10,quality:.4}:{})})));
  const before=JSON.stringify(editor.document.toJSON()),run=await editor.batch.createBatch({name:'AVIF fitted pack',budgetId:'default-budget',variants},[{id:'original',name:'art.png',width:80,height:48,mimeType:'image/png',byteLength:blob.size,blob}]);
  variants[1].avifLossless=false;await editor.batch.start(run.id);const completed=await editor.batch.waitForRun(run.id);return{id:run.id,status:completed.status,items:completed.items,readonly:before===JSON.stringify(editor.document.toJSON())};
 });
 expect(created.status,JSON.stringify(created.items)).toBe('completed');expect(created.readonly).toBe(true);expect(created.items[0].deliverables).toHaveLength(6);
 await page.reload();
 const restored=await page.evaluate(async id=>{
  const {editor}=window.luma,service=editor.batch,before=await service.getRun(id);await service.resume(id);const run=await service.waitForRun(id),outputs:Record<string,Blob>={zip:await service.exportDeliveryPackageZip(id)};
  for(const delivery of run.items[0].deliverables)outputs[delivery.variantId]=(await service.getDeliverableBlob(delivery.id))!;
  (window as unknown as {avifOutputs:Record<string,Blob>}).avifOutputs=outputs;return{same:JSON.stringify(before?.items)===JSON.stringify(run.items),variants:run.config.variants,deliveries:run.items[0].deliverables,manifest:run.deliveryManifest};
 },created.id);
 expect(restored.same).toBe(true);expect(restored.variants.filter(v=>v.format==='avif').every(v=>v.avifLossless&&v.avifSpeed===10&&v.quality===.4)).toBe(true);
 const decoded=[];for(const fit of ['cover','contain','fill'])decoded.push(checkAvif(await saveAvifBlob(page,info,fit+'-avif','avif'),await saveAvifBlob(page,info,fit+'-png','png')));
 const zip=await saveAvifBlob(page,info,'zip','zip');const audit=spawnSync('python3',['-c',`import zipfile,json,hashlib,sys
with zipfile.ZipFile(sys.argv[1]) as z:
 m=json.loads(z.read('delivery-manifest.json'))
 assert len(m['deliverables'])==6
 assert set(z.namelist())=={'delivery-manifest.json',*[d['filePath'] for d in m['deliverables']]}
 for d in m['deliverables']:
  b=z.read(d['filePath']);assert len(b)==d['byteLength'] and hashlib.sha256(b).hexdigest()==d['sha256']
 print(json.dumps({'entries':len(z.namelist()),'deliverables':6,'hashesExact':True}))`,zip],{encoding:'utf8'});expect(audit.status,audit.stderr).toBe(0);await info.attach('fitted-batch-independent',{body:JSON.stringify({runtime:restored,decoded,zip:JSON.parse(audit.stdout)}),contentType:'application/json'});
});

test('AVIF batch codec failure retries saved work and cancelling busy encoding publishes no partial delivery',async({page},info)=>{
 await page.goto('/');await page.route('**/avif_enc.wasm*',route=>route.fulfill({status:404,body:'Missing codec'}));
 const id=await page.evaluate(async()=>{
  const {editor}=window.luma;editor.ai.budgetLedger.setConsent('default-budget',true,'test');const c=new OffscreenCanvas(512,512),ctx=c.getContext('2d')!;ctx.fillStyle='#804020';ctx.fillRect(0,0,512,512);const blob=await c.convertToBlob({type:'image/png'}),run=await editor.batch.createBatch({name:'Retry AVIF',budgetId:'default-budget',variants:[{id:'native',name:'Native AVIF',format:'avif',targetWidth:512,targetHeight:512,fit:'fill',avifLossless:true,avifSpeed:0}]},[{id:'source',name:'source.png',width:512,height:512,mimeType:'image/png',byteLength:blob.size,blob}]);await editor.batch.start(run.id);return run.id;
 });
 const failed=await page.evaluate(async id=>{const run=await window.luma.editor.batch.waitForRun(id);return{status:run.status,item:run.items[0]};},id);expect(failed.status).toBe('failed');expect(failed.item.deliverables).toHaveLength(0);expect(failed.item.error).toMatch(/AVIF|wasm|abort/i);await page.unroute('**/avif_enc.wasm*');
 const retried=await page.evaluate(async id=>{const service=window.luma.editor.batch;await service.retryFailed(id);const run=await service.waitForRun(id);return{status:run.status,items:run.items};},id);expect(retried.status).toBe('completed');expect(retried.items[0].retryCount).toBe(1);expect(retried.items[0].deliverables).toHaveLength(1);
 const cancelled=await page.evaluate(async()=>{
  const {editor}=window.luma,service=editor.batch,prior=(await service.listRuns())[0],source=prior.items[0].source,blob=(await service.storage.getDeliverableBlob('src-'+prior.items[0].id))!,run=await service.createBatch({name:'Cancel busy AVIF',budgetId:'default-budget',variants:prior.config.variants},[{...source,id:'cancel-source',blob}]),NativeWorker=window.Worker;let started=false,terminated=0,cancellation:Promise<void>|undefined;
  class ObservedWorker extends NativeWorker{constructor(url:string|URL,options?:WorkerOptions){super(url,options);this.addEventListener('message',event=>{if(event.data?.type==='started'){started=true;cancellation=service.cancel(run.id);}});}override terminate(){terminated++;super.terminate();}}window.Worker=ObservedWorker;
  try{await service.start(run.id);const completed=await service.waitForRun(run.id);await cancellation;return{started,terminated,status:completed.status,outputs:completed.items[0].deliverables.length};}finally{window.Worker=NativeWorker;}
 });
 expect(cancelled).toEqual({started:true,terminated:1,status:'cancelled',outputs:0});await info.attach('batch-failure-cancel',{body:JSON.stringify({failed,retried,cancelled}),contentType:'application/json'});
});
