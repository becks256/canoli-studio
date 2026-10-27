import{test,expect}from'@playwright/test';
import{readFile,writeFile}from'node:fs/promises';
import{spawnSync}from'node:child_process';
import{colorDeliveryWorkflow}from'./helpers/color-delivery';
test('portable color presets and recipe packages drive actual profiled batch files through the normal UI after reload',async({page},info)=>{test.setTimeout(240000);await colorDeliveryWorkflow(page,info);});

test('batch-owned profiles and recipe delivery defaults survive library removal; changed contracts and corrupt originals cannot relabel files',async({page},info)=>{
 await page.goto('/');const profile=[...await readFile('tests/fixtures/icc-native/narrow-rgb.icc')];
 const result=await page.evaluate(async profile=>{
  const{editor}=window.luma,service=editor.batch,inspected=await editor.inspectColorProfile(new Blob([new Uint8Array(profile)]),'Owned.icc'),color=await service.captureColorOutput({profile:inspected});
  const variants=[{id:'png',name:'Owned PNG',targetWidth:32,targetHeight:16,format:'png' as const,fit:'fill' as const,color}],preset=await service.exportDeliveryPreset({name:'Owned outputs',variants}),recipe={schemaVersion:1 as const,id:'owned-color-recipe',name:'Owned color recipe',description:'',version:1,parameters:[],steps:[{id:'resize',name:'Resize',action:{type:'document.resize' as const,width:32,height:16}}]},file=await editor.recipes.attachDeliveryPreset(recipe,preset);await editor.recipes.packages.save(file);
  const canvas=new OffscreenCanvas(32,16),ctx=canvas.getContext('2d')!;ctx.fillStyle='#ff0000';ctx.fillRect(0,0,32,16);const blob=await canvas.convertToBlob({type:'image/png'}),run=await service.createBatch({name:'Owned recipe',recipePackageId:recipe.id,budgetId:'default-budget'},[{id:'source',name:'source.png',mimeType:'image/png',width:32,height:16,byteLength:blob.size,blob}]);await editor.recipes.packages.delete(recipe.id);await editor.setColorSettings({output:{profile:'linear-srgb',intent:'saturation',blackPointCompensation:true},proof:null});await service.start(run.id);const complete=await service.waitForRun(run.id),before=JSON.stringify(complete.items),sha=complete.items[0].deliverables[0].sha256;await service.resume(run.id);const resumed=await service.waitForRun(run.id);
  await service.storage.updateRun(run.id,current=>{current.config.variants[0].color!.intent='saturation';});let changedRejected=false;try{await service.exportDeliveryPackageZip(run.id);}catch{changedRejected=true;}
  await service.storage.updateRun(run.id,current=>{current.config.variants[0].color!.intent='relative-colorimetric';current.config.variants[0].color!.profile.source=new Blob([new Uint8Array(140)]);});let corruptRejected=false;try{await service.resume(run.id);}catch{corruptRejected=true;}
  return{status:complete.status,defaultProfile:complete.config.variants[0].color?.profile.name,deliveries:complete.items[0].deliverables,unchanged:before===JSON.stringify(resumed.items),sha,changedRejected,corruptRejected};
 },profile);expect(result).toMatchObject({status:'completed',defaultProfile:'Owned.icc',unchanged:true,changedRejected:true,corruptRejected:true});expect(result.deliveries[0].color?.profileName).toBe('Owned.icc');await writeFile(info.outputPath('color-delivery-ownership.json'),JSON.stringify(result,null,2));
});

test('genuine 50 MP batch PNG/TIFF/PDF conversions retain all native samples and complete original profile sources',async({page},info)=>{
 test.setTimeout(480000);await page.goto('/');const source=[...await readFile('tests/fixtures/raw/native-50mp.png')];
 const result=await page.evaluate(async source=>{
  const{editor}=window.luma,service=editor.batch,color=await service.captureColorOutput({profile:'display-p3'}),blob=new Blob([new Uint8Array(source)],{type:'image/png'}),variants=(['png','tiff','pdf']as const).map(format=>({id:format,name:format,format,targetWidth:10000,targetHeight:5000,fit:'fill' as const,color}));
  const run=await service.createBatch({name:'Native 50 MP ICC',budgetId:'default-budget',variants,concurrency:1},[{id:'original',name:'native-50mp.png',width:10000,height:5000,mimeType:'image/png',byteLength:blob.size,blob}]);await service.start(run.id);const complete=await service.waitForRun(run.id),outputs:Record<string,Blob>={};for(const delivery of complete.items[0].deliverables)outputs[delivery.format]=(await service.getDeliverableBlob(delivery.id))!;(window as unknown as{colorBatchFiles:Record<string,Blob>}).colorBatchFiles=outputs;
  return{status:complete.status,item:complete.items[0],profileSha256:complete.config.variants[0].color!.profile.sha256,originalSize:(await service.storage.getDeliverableBlob('src-'+run.items[0].id))!.size};
 },source);expect(result.status,JSON.stringify(result.item)).toBe('completed');expect(result.item.deliverables).toHaveLength(3);
 const paths:Record<string,string>={};for(const format of ['png','tiff','pdf']){const pending=page.waitForEvent('download');await page.evaluate(format=>{const blob=(window as unknown as{colorBatchFiles:Record<string,Blob>}).colorBatchFiles[format],a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=format;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);},format);paths[format]=info.outputPath('batch-50mp.'+format);await(await pending).saveAs(paths[format]);}
 const checked=spawnSync(process.env.CANOLI_PDF_PYTHON||'python3',['scripts/check-icc-delivery.py','tests/fixtures/raw/native-50mp.png','tests/fixtures/icc-native/display-p3.icc',paths.png,paths.tiff,paths.pdf],{encoding:'utf8',timeout:180000});expect(checked.status,checked.stderr||checked.stdout).toBe(0);await writeFile(info.outputPath('color-batch-50mp.json'),JSON.stringify({...result,independent:JSON.parse(checked.stdout)},null,2));
});

test('partial profiled delivery retries only missing files, and cancelled native preflight publishes no batch',async({page},info)=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const{editor}=window.luma,service=editor.batch,color=await service.captureColorOutput({profile:'display-p3'}),canvas=new OffscreenCanvas(32,16),ctx=canvas.getContext('2d')!;ctx.fillStyle='#30b060';ctx.fillRect(0,0,32,16);const blob=await canvas.convertToBlob({type:'image/png'}),source={id:'source',name:'source.png',mimeType:'image/png',width:32,height:16,byteLength:blob.size,blob},variants=(['png','tiff','pdf']as const).map(format=>({id:format,name:format,format,targetWidth:32,targetHeight:16,fit:'fill' as const,color}));
  const run=await service.createBatch({name:'Partial profile outputs',budgetId:'default-budget',variants,concurrency:1},[source]),renderer=editor.renderer,render=renderer.render.bind(renderer);let calls=0;
  renderer.render=async(...args)=>{if(++calls===2)throw new Error('Second-file render failure fixture');return render(...args);};
  await service.start(run.id);const failed=await service.waitForRun(run.id);renderer.render=render;const accepted=structuredClone(failed.items[0].deliverables[0]);calls=0;renderer.render=async(...args)=>{calls++;return render(...args);};
  await service.retryFailed(run.id);const retried=await service.waitForRun(run.id);renderer.render=render;
  const count=(await service.listRuns()).length,abort=new AbortController();let cancelled=false;try{await service.createBatch({name:'Cancelled color preflight',budgetId:'default-budget',variants},[source],{signal:abort.signal,onProgress:phase=>{if(phase==='preparing')abort.abort();}});}catch(error){cancelled=error instanceof Error&&error.name==='AbortError';}
  const after=(await service.listRuns()).length;await service.captureColorOutput({profile:'adobe-rgb'});
  const storageAbort=new AbortController(),add=IDBObjectStore.prototype.add;let storageItem='';
  IDBObjectStore.prototype.add=function(value:any,key?:IDBValidKey){const result=key===undefined?add.call(this,value):add.call(this,value,key);if(this.name==='runs'&&value.id==='cancel-storage-color'){storageItem=value.items[0].id;storageAbort.abort();}return result;};
  let storageCancelled=false;try{await service.createBatch({id:'cancel-storage-color',name:'Cancelled storage commit',budgetId:'default-budget',variants},[source],{signal:storageAbort.signal});}catch(error){storageCancelled=error instanceof Error&&error.name==='AbortError';}finally{IDBObjectStore.prototype.add=add;}
  const noStoredRun=(await service.getRun('cancel-storage-color'))===null,noStoredSource=(await service.storage.getDeliverableBlob('src-'+storageItem))===null;
  let disposeCancelled=false;try{await service.captureColorOutput({profile:'srgb'},{onProgress:phase=>{if(phase==='preparing')service.dispose();}});}catch(error){disposeCancelled=error instanceof Error&&error.name==='AbortError';}
  return{firstStatus:failed.status,acceptedBeforeRetry:failed.items[0].deliverables.length,status:retried.status,deliveries:retried.items[0].deliverables,acceptedUnchanged:JSON.stringify(accepted)===JSON.stringify(retried.items[0].deliverables[0]),renderCallsOnRetry:calls,cancelled,noPublishedRun:count===after,retryCount:retried.items[0].retryCount,storageCancelled,noStoredRun,noStoredSource,disposeCancelled};
 });expect(result).toMatchObject({firstStatus:'failed',acceptedBeforeRetry:1,status:'completed',acceptedUnchanged:true,renderCallsOnRetry:2,cancelled:true,noPublishedRun:true,retryCount:1,storageCancelled:true,noStoredRun:true,noStoredSource:true,disposeCancelled:true});expect(result.deliveries).toHaveLength(3);await writeFile(info.outputPath('color-delivery-partial-retry.json'),JSON.stringify(result,null,2));
});

test('batch storage preserves version-2 originals while preventing an older client from processing new color contracts',async({page},info)=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const old=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('luma-batch-storage',2);request.onupgradeneeded=()=>{request.result.createObjectStore('runs',{keyPath:'id'});request.result.createObjectStore('blobs');};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  await new Promise<void>((resolve,reject)=>{const tx=old.transaction('blobs','readwrite');tx.objectStore('blobs').put(new Blob(['Complete legacy original']),'legacy-color-source');tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});old.close();
  const original=await window.luma.editor.batch.storage.getDeliverableBlob('legacy-color-source');
  const olderRejected=await new Promise<boolean>((resolve,reject)=>{const request=indexedDB.open('luma-batch-storage',2);request.onsuccess=()=>{request.result.close();resolve(false);};request.onerror=event=>{event.preventDefault();if(request.error?.name==='VersionError')resolve(true);else reject(request.error);};});
  return{original:await original!.text(),olderRejected};
 });expect(result).toEqual({original:'Complete legacy original',olderRejected:true});await writeFile(info.outputPath('color-batch-storage-upgrade.json'),JSON.stringify(result,null,2));
});
