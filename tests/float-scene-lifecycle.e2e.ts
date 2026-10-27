import{test,expect}from'@playwright/test';
import{readFile,writeFile}from'node:fs/promises';
for(const stage of['source','output']as const)test('renderer disposal releases queued float '+stage+' work before unrelated ICC owners close',async({page},info)=>{
 await page.goto('/');await page.waitForFunction(()=>!!window.luma?.editor);const result=await page.evaluate(async({bytes,stage})=>{
  const{editor}=window.luma,{CanvasRenderer}=await import(/* @vite-ignore */String('/src/engine/renderer.ts')),{execute}=await import(/* @vite-ignore */String('/src/core/commands.ts')),{acquireIccOwner}=await import(/* @vite-ignore */String('/src/core/color/icc-client.ts')),{prepareFloatDelivery}=await import(/* @vite-ignore */String('/src/engine/float-delivery.ts'));
  await editor.openTiff(new File([new Uint8Array(bytes)],'Queued float original.tif',{type:'image/tiff'}),{allowPrecisionLoss:true});const document=execute(editor.document.toJSON(),{type:'document.precision.float'}),assets=editor.assetStore,renderer=new CanvasRenderer();let a:()=>void=()=>{},b:()=>void=()=>{},outcome='',ready!:()=>void;const waiting=new Promise<void>(resolve=>{ready=resolve;});
  try{
   const scene=stage==='output'?await renderer.captureFloatScene(document,assets):undefined;a=await acquireIccOwner();b=await acquireIccOwner();
   const pending=(stage==='source'?renderer.captureFloatScene(document,assets,{onProgress:(p:{phase:string})=>{if(p.phase==='waiting')ready();}}):prepareFloatDelivery(document,assets,renderer,'rgba-float32',undefined,undefined,scene)).then((value:{dispose():void})=>{value.dispose();return'Unexpected completion';},(error:unknown)=>String(error));
   if(stage==='source')await waiting;renderer.dispose();let timer:ReturnType<typeof setTimeout>|undefined;try{outcome=await Promise.race([pending,new Promise<string>(resolve=>{timer=setTimeout(()=>resolve('Timed out while unrelated owners remained open'),1000);})]);}finally{clearTimeout(timer);}
   a();b();await pending;
   const retry=new CanvasRenderer();try{const captured=await retry.captureFloatScene(document,assets);try{return{stage,outcome,retryLength:(await captured.read({x:0,y:0,width:131,height:79})).length};}finally{captured.dispose();}}finally{retry.dispose();}
  }finally{a();b();renderer.dispose();}
 },{bytes:[...await readFile('tests/fixtures/tiff-float/rgba-raw-le.tif')],stage});expect(result.outcome).toMatch(/closed|superseded|abort/i);expect(result.retryLength).toBe(131*79*4);await writeFile(info.outputPath('float-queued-'+stage+'.json'),JSON.stringify(result,null,2));
});
for(const action of['asset-close','renderer-dispose','callback-abort']as const)test('float PNG rejects '+action+' after the last pixel read and before file publication',async({page},info)=>{
 await page.goto('/');await page.waitForFunction(()=>!!window.luma?.editor);const result=await page.evaluate(async({bytes,action})=>{
  const{editor}=window.luma,{CanvasRenderer}=await import(/* @vite-ignore */String('/src/engine/renderer.ts')),{AssetStore}=await import(/* @vite-ignore */String('/src/core/assets.ts')),{exportPng}=await import(/* @vite-ignore */String('/src/engine/png.ts'));
  await editor.openTiff(new File([new Uint8Array(bytes)],'Float publication.tif',{type:'image/tiff'}),{editingPrecision:'float32'});const assets=new AssetStore(),renderer=new CanvasRenderer(),abort=new AbortController();for(const asset of editor.assetStore.values())editor.assetStore.shareTo(assets,asset.id,asset.id);let changed=false,error='',published=false;
  try{await exportPng(editor.document.toJSON(),assets,renderer,{signal:abort.signal,onProgress:(progress:{phase:string})=>{if(progress.phase==='encoding'&&!changed){changed=true;if(action==='asset-close')assets.dispose();else if(action==='renderer-dispose')renderer.dispose();else abort.abort();}}});published=true;}catch(value){error=String(value);}finally{renderer.dispose();assets.dispose();}
  const healthy=await editor.export({format:'png'});return{action,changed,error,published,retryBytes:healthy.blob.size};
 },{bytes:[...await readFile('tests/fixtures/tiff-float/rgba-raw-le.tif')],action});expect(result,JSON.stringify(result)).toMatchObject({changed:true,published:false});expect(result.error).toMatch(/closed|superseded|abort|disposed/i);expect(result.retryBytes).toBeGreaterThan(100);await writeFile(info.outputPath('float-png-publication-'+action+'.json'),JSON.stringify(result,null,2));
});
