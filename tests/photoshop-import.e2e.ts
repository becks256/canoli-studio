import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';

for(const mode of ['inspect','import'] as const)for(const action of ['success','cancel','callback-error','document-edit','dispose','worker-error','message-error','bad-result'] as const)
test(`Photoshop ${mode} ${action} validates private results and releases its worker`,async({page},info)=>{
 await page.goto('/');const bytes=[...await readFile('tests/fixtures/psb/rle-30001.psb')];
 const result=await page.evaluate(async({mode,action,bytes})=>{
  const {editor,TextLayer}=window.luma;editor.document.layers.add(new TextLayer({text:'Keep user work'}));const owner=editor.document,before=JSON.stringify(owner.toJSON()),input=new Uint8Array(bytes),Native=window.Worker,abort=new AbortController();let workers=0,terminated=0,changed=false,returned=false,error='',metadataOnly=false,decodedMap=false;
  window.Worker=new Proxy(Native,{construct(Target,args){const worker=Reflect.construct(Target,args) as Worker;if(String(args[0]).includes('photoshop-import.worker')){
   workers++;const post=worker.postMessage.bind(worker),terminate=worker.terminate.bind(worker);worker.terminate=()=>{terminated++;terminate();};
   worker.addEventListener('message',event=>{if(action==='bad-result'&&!changed&&(event.data.inspection||event.data.decoded)){changed=true;if(event.data.inspection)event.data.inspection.header.width=300001;else event.data.decoded.entries[0].pixels=new Uint8ClampedArray(4);}});
   worker.postMessage=((value:unknown,transfer?:Transferable[])=>{if(transfer?.length)throw new Error('Original Photoshop input must not transfer');post(value);if(changed||['success','callback-error','bad-result'].includes(action))return;changed=true;if(action==='cancel')abort.abort(new Error('Stop Photoshop import'));else if(action==='document-edit')owner.name='Newer user work';else if(action==='dispose')editor.dispose();else if(action==='worker-error')worker.dispatchEvent(new ErrorEvent('error'));else worker.dispatchEvent(new MessageEvent('messageerror'));}) as Worker['postMessage'];
  }return worker;}});
  try{
   const control={signal:abort.signal,onProgress:()=>{if(action==='callback-error'){changed=true;throw new Error('Progress callback failure');}}};
   if(mode==='inspect'){const value=await editor.inspectPsd(input,control);metadataOnly=!('assets'in value)&&!('composite'in value)&&!('resources'in value)&&!('imageData'in value.layers[0]);}
   else{const value=await editor.openPsd(input,{},control);decodedMap=value.assets instanceof Map&&[...value.assets.values()].every(image=>image instanceof ImageData&&image.data.length===image.width*image.height*4);}
   returned=true;
  }catch(cause){error=String(cause);}finally{window.Worker=Native;}
  const ownerChanged=before!==JSON.stringify(owner.toJSON()),stillOwner=editor.document===owner,inputUnchanged=input.byteLength===bytes.length&&input.every((v,i)=>v===bytes[i]);
  let retry=false;if(action!=='dispose'){const value=await editor.inspectPsd(new Blob([new Uint8Array(bytes)]));retry=value.header.width===30001;}
  return{mode,action,workers,terminated,changed,returned,error,metadataOnly,decodedMap,ownerChanged,stillOwner,inputUnchanged,retry};
 },{mode,action,bytes});
 expect(result.workers).toBe(1);expect(result.terminated).toBe(1);expect(result.inputUnchanged).toBe(true);expect(result.ownerChanged).toBe(action==='document-edit');if(action!=='dispose')expect(result.retry).toBe(true);
 if(action==='success'||mode==='inspect'&&action==='document-edit'){expect(result.returned,JSON.stringify(result)).toBe(true);expect(mode==='inspect'?result.metadataOnly:result.decodedMap).toBe(true);expect(result.stillOwner).toBe(mode==='inspect');}
 else{expect(result.returned).toBe(false);expect(result.error.length).toBeGreaterThan(0);expect(result.stillOwner).toBe(true);}
 await info.attach('photoshop-import-lifetime',{body:JSON.stringify(result),contentType:'application/json'});
});

for(const source of ['native-50mp.psd','zip/native-50mp-zip.psd']) test(`native 50 MP Photoshop ${source} inspects off-thread, reopens exact pixels and retains editable project data`,async({page},info)=>{
 test.setTimeout(180000);await page.goto('/');const result=await page.evaluate(async inputName=>{
  const {editor,TextLayer}=window.luma;editor.document.layers.add(new TextLayer({text:'Keep this edited tab'}));const owner=editor.document,before=JSON.stringify(owner.toJSON());
  const file=await fetch('/tests/fixtures/psd/'+inputName).then(r=>r.blob()),inspection=await editor.inspectPsd(file),snap=JSON.stringify(inspection);let frames=0,active=true;const tick=()=>{if(active){frames++;requestAnimationFrame(tick);}};requestAnimationFrame(tick);
  const started=performance.now(),decoded=await editor.openPsd(file),milliseconds=performance.now()-started;active=false;
  const model=JSON.stringify(editor.document.toJSON()),source=editor.assetStore.values()[0],saved=await editor.saveProject();await editor.openProject(new File([saved],'native.luma'));const reopened=editor.assetStore.values()[0],png=await editor.exportPng();
  (window as unknown as {photoshopImportOutput:Blob}).photoshopImportOutput=png;
  const hash=async(blob:Blob)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))];
  return{size:[editor.document.width,editor.document.height],metadataBytes:snap.length,noPlanes:!('composite'in inspection)&&!('resources'in inspection),frames,milliseconds,sourceSize:[source.width,source.height],sameSource:JSON.stringify(await hash(source.blob))===JSON.stringify(await hash(reopened.blob)),sameModel:model===JSON.stringify(editor.document.toJSON()),keptOwner:JSON.stringify(owner.toJSON())===before,decodedPixels:[...decoded.assets.values()].every(value=>value.width===10000&&value.height===5000&&value.data.length===200000000)};
 },source);
 expect(result.size).toEqual([10000,5000]);expect(result.sourceSize).toEqual(result.size);expect(result.metadataBytes).toBeLessThan(10000);expect(result.noPlanes).toBe(true);expect(result.frames).toBeGreaterThan(0);expect(result.sameSource).toBe(true);expect(result.sameModel).toBe(true);expect(result.keptOwner).toBe(true);expect(result.decodedPixels).toBe(true);
 const pending=page.waitForEvent('download');await page.evaluate(()=>{const a=document.createElement('a');a.href=URL.createObjectURL((window as unknown as {photoshopImportOutput:Blob}).photoshopImportOutput);a.download='native.png';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);});const png=info.outputPath('native.png');await(await pending).saveAs(png);
 const checked=spawnSync('python3',['-c',"from PIL import Image;import numpy as np,sys;a=Image.open(sys.argv[1]).convert('RGBA');b=Image.open(sys.argv[2]).convert('RGBA');assert a.size==b.size==(10000,5000)\nfor y in range(0,5000,64):\n box=(0,y,10000,min(5000,y+64));assert np.array_equal(np.asarray(a.crop(box)),np.asarray(b.crop(box)))\nprint('Every native imported RGBA sample matches the independent PSD input')",png,'tests/fixtures/psd/native-50mp.png'],{encoding:'utf8',timeout:120000});expect(checked.status,checked.stderr).toBe(0);await info.attach('photoshop-native-50mp-input',{body:JSON.stringify({runtime:result,independent:checked.stdout}),contentType:'application/json'});
});

test('Photoshop dialog cancels native preparation, preserves work and retries the actual file',async({page})=>{
 await page.goto('/');await page.evaluate(()=>window.luma.editor.document.layers.add(new window.luma.TextLayer({text:'Keep this work'})));const before=await page.evaluate(()=>JSON.stringify(window.luma.editor.document.toJSON()));
 await page.getByTestId('psd-input').setInputFiles('tests/fixtures/psd/native-50mp.psd');await expect(page.locator('.psd-meta-card')).toBeVisible();const dialog=page.locator('.psd-import-dialog');
 await dialog.getByRole('button',{name:'Import Flattened',exact:true}).click();await expect(dialog.getByRole('progressbar',{name:'Photoshop import progress',exact:true})).toBeVisible();await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(dialog).not.toBeVisible();expect(await page.evaluate(()=>JSON.stringify(window.luma.editor.document.toJSON()))).toBe(before);
 await page.getByTestId('psd-input').setInputFiles('tests/fixtures/psd/basic-rgb-8bit.psd');await expect(page.locator('.psd-meta-card')).toBeVisible();await page.getByRole('button',{name:'Import Layers',exact:true}).click();await expect(page.locator('.psd-import-dialog')).not.toBeVisible();await expect(page.locator('.layer-row')).toHaveCount(2);
});

for(const action of ['replacement','tab-switch','wrong-png-geometry','missing-source','pre-aborted'] as const)test(`Photoshop ${action} cannot publish an invalid or stale document`,async({page},info)=>{
 await page.goto('/');const bytes=[...await readFile('tests/fixtures/psb/rle-30001.psb')];
 const result=await page.evaluate(async({action,bytes})=>{
  const {editor,TextLayer}=window.luma;editor.document.layers.add(new TextLayer({text:'Keep user work'}));const owner=editor.document;
  let other:typeof owner|null=null;if(action==='tab-switch'){other=editor.newDocument({name:'Other tab'});editor.activateDocument(owner);}
  const c=document.createElement('canvas');c.width=c.height=2;const small=await new Promise<Blob>(resolve=>c.toBlob(b=>resolve(b!))),Native=window.Worker,close=ImageBitmap.prototype.close,abort=new AbortController();let created=0,terminated=0,closed=0,changed=false,error='';
  ImageBitmap.prototype.close=function(){closed++;return close.call(this);};
  window.Worker=new Proxy(Native,{construct(Target,args){const worker=Reflect.construct(Target,args) as Worker;if(String(args[0]).includes('photoshop-import.worker')){
   created++;const post=worker.postMessage.bind(worker),terminate=worker.terminate.bind(worker);worker.terminate=()=>{terminated++;terminate();};
   worker.addEventListener('message',event=>{if(changed||!event.data.decoded)return;if(action==='wrong-png-geometry'){changed=true;event.data.decoded.entries[0].png=small;}else if(action==='missing-source'){changed=true;event.data.decoded.entries=[];}});
   worker.postMessage=((value:unknown)=>{post(value);if(action==='replacement'){changed=true;editor.newDocument({name:'User replacement'});}else if(action==='tab-switch'){changed=true;editor.activateDocument(other!);}}) as Worker['postMessage'];
  }return worker;}});
  if(action==='pre-aborted')abort.abort(new Error('Already stopped'));
  try{await editor.openPsd(new Uint8Array(bytes),{}, {signal:abort.signal});}catch(cause){error=String(cause);}finally{window.Worker=Native;ImageBitmap.prototype.close=close;}
  return{action,created,terminated,closed,changed,error,name:editor.document.name,sameOwner:editor.document===owner,assets:editor.assetStore.values().length};
 },{action,bytes});
 expect(result.error.length).toBeGreaterThan(0);expect(result.assets).toBe(0);
 if(action==='pre-aborted'){expect(result.created).toBe(0);expect(result.terminated).toBe(0);}
 else{expect(result.created).toBe(1);expect(result.terminated).toBe(1);expect(result.changed).toBe(true);}
 if(action==='wrong-png-geometry')expect(result.closed).toBeGreaterThan(0);
 if(action==='replacement')expect(result.name).toBe('User replacement');else if(action==='tab-switch')expect(result.name).toBe('Other tab');else expect(result.sameOwner).toBe(true);
 await info.attach('photoshop-private-publication',{body:JSON.stringify(result),contentType:'application/json'});
});

test('Photoshop preflight pages every independent layer record without changing the current document',async({page})=>{
 await page.goto('/');const before=await page.evaluate(()=>JSON.stringify(window.luma.editor.document.toJSON()));await page.getByTestId('psd-input').setInputFiles('tests/fixtures/psd/paged-records.psd');const dialog=page.locator('.psd-import-dialog');
 await expect(dialog.locator('.psd-layer-row')).toHaveCount(100);await expect(dialog.locator('.psd-layers-list')).toContainText('Record 001');await expect(dialog.locator('.psd-layers-list')).not.toContainText('Record 250');
 await dialog.getByRole('button',{name:'Next layer records',exact:true}).click();await expect(dialog.locator('.psd-layers-list')).toContainText('Record 101');await dialog.getByRole('button',{name:'Next layer records',exact:true}).click();await expect(dialog.locator('.psd-layer-row')).toHaveCount(50);await expect(dialog.locator('.psd-layers-list')).toContainText('Record 250');await expect(dialog.getByRole('button',{name:'Next layer records',exact:true})).toBeDisabled();
 await dialog.getByRole('button',{name:'Previous layer records',exact:true}).click();await expect(dialog.locator('.psd-layers-list')).toContainText('Record 101');await dialog.getByRole('button',{name:'Cancel',exact:true}).click();expect(await page.evaluate(()=>JSON.stringify(window.luma.editor.document.toJSON()))).toBe(before);
});

for(const fixture of ['zip-layer-raw-merged','raw-layer-zip-merged','zip-unsupported','gray8-rle'] as const)test(`Photoshop ${fixture} decodes supported pixels or rejects malformed merged extents`,async({page},info)=>{
 await page.goto('/');const before=await page.evaluate(()=>JSON.stringify(window.luma.editor.document.toJSON()));await page.getByTestId('psd-input').setInputFiles(`tests/fixtures/psd/${fixture}.psd`);const dialog=page.locator('.psd-import-dialog');
 if(fixture==='raw-layer-zip-merged'||fixture==='zip-unsupported'){
  // These preserved psd-tools 1.10.9 files declare RGB (561 bytes), but its
  // automatic merged compositor wrote RGBA (748 bytes). Its own ZIP reader
  // rejects them too. Do not weaken strict inflation to accept the extra plane.
  await expect(dialog.getByRole('alert')).toContainText('Invalid Photoshop ZIP data');await expect(dialog.locator('.psd-meta-card')).toHaveCount(0);await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  expect(await page.evaluate(()=>JSON.stringify(window.luma.editor.document.toJSON()))).toBe(before);expect(await page.evaluate(()=>window.luma.editor.assetStore.values().length)).toBe(0);return;
 }
 await expect(dialog.locator('.psd-meta-card')).toBeVisible();await expect(dialog).not.toContainText('unsupported compression');
 await dialog.locator(`input[value="${fixture==='zip-layer-raw-merged'||fixture==='gray8-rle'?'flatten':'layered'}"]`).check();await dialog.getByRole('button',{name:fixture==='zip-layer-raw-merged'||fixture==='gray8-rle'?'Import Flattened':'Import Layers',exact:true}).click();await expect(dialog).not.toBeVisible();const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Export PNG',exact:true}).click();const path=info.outputPath('decoded.png');await(await pending).saveAs(path);
 const checked=spawnSync('python3',['-c',"from PIL import Image;import numpy as np,sys;assert np.array_equal(np.asarray(Image.open(sys.argv[1]).convert('RGBA')),np.asarray(Image.open(sys.argv[2]).convert('RGBA')));print('Every supported fallback/layer pixel matches the independent input')",path,fixture==='gray8-rle'?'tests/fixtures/psd/gray8-rle.png':'tests/fixtures/psd/zip-reference.png'],{encoding:'utf8',timeout:30000});expect(checked.status,checked.stderr).toBe(0);await info.attach('photoshop-codec-fallback',{body:JSON.stringify({fixture,independent:checked.stdout}),contentType:'application/json'});
});

test('Photoshop truncated 8-bit RLE input fails without publishing partial pixels',async({page})=>{
 await page.goto('/');const bytes=[...await readFile('tests/fixtures/psb/rle-30001.psb')];const result=await page.evaluate(async bytes=>{const {editor,TextLayer}=window.luma;editor.document.layers.add(new TextLayer({text:'Keep work'}));const before=JSON.stringify(editor.document.toJSON());let error='';try{await editor.openPsd(new Uint8Array(bytes.slice(0,-1)));}catch(cause){error=String(cause);}return{error,unchanged:before===JSON.stringify(editor.document.toJSON()),assets:editor.assetStore.values().length};},bytes);expect(result.error).toMatch(/Truncated|extent|PackBits/);expect(result.unchanged).toBe(true);expect(result.assets).toBe(0);
});
