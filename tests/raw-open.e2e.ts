import type {SmartObjectLayer} from "../src/dom";
import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import type {RawDevelopOptions} from '../src/core/interchange/raw/types';

const base='tests/fixtures/raw/';
const manifest=JSON.parse(await readFile(base+'manifest.json','utf8'))as {cases:{file:string;png:string;width:number;height:number;sha256:string;options:RawDevelopOptions}[]};
for(const fixture of manifest.cases.filter(value=>!value.file.endsWith('.gz')))test(`RAW application retains ${fixture.file} and reopens its accepted native pixels`,async({page},info)=>{
  await page.goto('/');
  const result=await page.evaluate(async({fixture,bytes,reference})=>{
    const {editor}=window.luma;
    await editor.openRaw(new File([new Uint8Array(bytes)],fixture.file,{type:'image/x-camera-raw'}),{allowPrecisionLoss:true,development:fixture.options});
    const state=editor.document.getSnapshot(),asset=editor.assetStore.values()[0],model=JSON.stringify(editor.document.toJSON()),png=await editor.exportPng();
    const actual=await createImageBitmap(png),expected=await createImageBitmap(new Blob([new Uint8Array(reference)],{type:'image/png'})),canvas=new OffscreenCanvas(actual.width,actual.height),context=canvas.getContext('2d')!;
    context.drawImage(actual,0,0);const a=context.getImageData(0,0,actual.width,actual.height).data;context.clearRect(0,0,canvas.width,canvas.height);context.drawImage(expected,0,0);const b=context.getImageData(0,0,canvas.width,canvas.height).data;let maximum=0;for(let i=0;i<a.length;i++)maximum=Math.max(maximum,Math.abs(a[i]-b[i]));actual.close();expected.close();canvas.width=canvas.height=0;
    const project=await editor.saveProject();await editor.openProject(new File([project],'retained-raw.luma'));const restored=editor.assetStore.values()[0];
    const hash=async(blob:Blob)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('');
    return{maximum,revision:state.revision,past:state.past.length,kind:state.document.children[0].kind,size:[asset.width,asset.height],model:JSON.stringify(editor.document.toJSON())===model,originalHash:await hash(restored.raw!.originalBlob),outputHash:await hash(restored.blob),acceptedHash:asset.raw!.outputSha256,pngSame:await hash(png)===await hash(await editor.exportPng()),settings:restored.raw!.settings.development,frozen:Object.isFrozen(restored.raw)&&Object.isFrozen(restored.raw!.settings.development.multipliers)};
  },{fixture,bytes:[...await readFile(base+fixture.file)],reference:[...await readFile(base+fixture.png)]});
  expect(result).toMatchObject({maximum:0,revision:0,past:0,kind:'smart-object',size:[fixture.width,fixture.height],model:true,originalHash:fixture.sha256,pngSame:true,frozen:true,settings:fixture.options});expect(result.outputHash).toBe(result.acceptedHash);
  await info.attach('raw-application-roundtrip',{body:JSON.stringify(result),contentType:'application/json'});
});

test('RAW shared master development has one history entry, portable redo and exact independent output',async({page},info)=>{
  await page.goto('/');const result=await page.evaluate(async({bytes,reference})=>{
    const {RawDevelopment}=await import(/* @vite-ignore */String('/src/dom/index.ts'))as typeof import('../src/dom');
    const {editor}=window.luma;await editor.openRaw(new File([new Uint8Array(bytes)],'Original.dng'),{allowPrecisionLoss:true});
    const document=editor.document,layer=document.layers.at(0)as SmartObjectLayer,duplicate=document.placeSmartObject(layer.componentId);duplicate.visible=false;
    const before=JSON.stringify(document.toJSON()),revision=document.getSnapshot().revision,oldId=editor.assetStore.values()[0].id;
    await layer.developRaw(new RawDevelopment({exposure:1.25,highlightPreservation:0.5}),{allowPrecisionLoss:true});
    const developed=JSON.stringify(document.toJSON()),after=document.getSnapshot(),asset=editor.assetStore.values().find(asset=>asset.id!==oldId)!;
    const expected=await createImageBitmap(new Blob([new Uint8Array(reference)],{type:'image/png'})),canvas=new OffscreenCanvas(asset.width,asset.height),ctx=canvas.getContext('2d')!;ctx.drawImage(asset.bitmap,0,0);const a=ctx.getImageData(0,0,asset.width,asset.height).data;ctx.clearRect(0,0,asset.width,asset.height);ctx.drawImage(expected,0,0);const b=ctx.getImageData(0,0,asset.width,asset.height).data;let maximum=0;for(let i=0;i<a.length;i++)maximum=Math.max(maximum,Math.abs(a[i]-b[i]));expected.close();canvas.width=canvas.height=0;
    document.undo();const undo=JSON.stringify(document.toJSON())===before,version=await editor.saveWorkspaceVersion('RAW retained redo');
    await editor.restoreWorkspace(version);const reopened=editor.document,reopenedBefore=JSON.stringify(reopened.toJSON());
    const nativeWorker=window.Worker;window.Worker=class{constructor(){throw new Error('Undo/redo must not need native development.');}}as unknown as typeof Worker;
    let redo=false,undoAgain=false;try{reopened.redo();redo=JSON.stringify(reopened.toJSON())===developed;reopened.undo();undoAgain=JSON.stringify(reopened.toJSON())===reopenedBefore;}finally{window.Worker=nativeWorker;}
    return{maximum,undo,redo,undoAgain,revisionDelta:after.revision-revision,label:after.past.at(-1)?.label,assets:editor.assetStore.values().length,shared:layer.componentId===duplicate.componentId,exposure:asset.raw!.settings.development.exposure,originals:editor.assetStore.values().map(asset=>asset.raw!.original.sha256)};
  },{bytes:[...await readFile(base+'bayer-rggb.dng')],reference:[...await readFile(base+'exposure-up.png')]});
  expect(result).toMatchObject({maximum:0,undo:true,redo:true,undoAgain:true,revisionDelta:1,label:'Develop RAW',assets:2,shared:true,exposure:1.25});expect(new Set(result.originals).size).toBe(1);await info.attach('raw-development-history',{body:JSON.stringify(result),contentType:'application/json'});
});

for(const action of ['cancel','callback-error','human-edit','new-document','dispose']as const)test(`RAW application ${action} discards native preparation without publishing assets`,async({page})=>{
  await page.goto('/');const result=await page.evaluate(async({bytes,action})=>{
    const {EditorApplication}=await import(/* @vite-ignore */String('/src/editor.ts'))as typeof import('../src/editor');const editor=new EditorApplication(),abort=new AbortController(),file=new File([new Uint8Array(bytes)],'Cancel.dng');editor.document.name='Existing artwork';
    const before=JSON.stringify(editor.document.toJSON());let entered=false,error='';
    try{await editor.openRaw(file,{allowPrecisionLoss:true},{signal:abort.signal,onProgress:progress=>{if(entered||progress.phase!=='developing')return;entered=true;if(action==='cancel')abort.abort(new Error('Cancelled RAW'));else if(action==='callback-error')throw new Error('RAW callback failed');else if(action==='human-edit')editor.document.name='Human edit';else if(action==='new-document')editor.newDocument({name:'Later document'});else editor.dispose();}});}catch(cause){error=String(cause);}
    const unchanged=JSON.stringify(editor.document.toJSON())===before,assets=editor.assetStore.values().length,name=editor.document.name;
    if(action!=='dispose')await editor.openRaw(file,{allowPrecisionLoss:true});const retry=action==='dispose'||!!editor.assetStore.values()[0]?.raw;editor.dispose();return{entered,error,unchanged,assets,name,retry};
  },{bytes:[...await readFile(base+'bayer-rggb.dng')],action});
  expect(result).toMatchObject({entered:true,assets:0,retry:true});expect(result.error).not.toBe('');if(action==='cancel'||action==='callback-error')expect(result.unchanged).toBe(true);if(action==='human-edit')expect(result.name).toBe('Human edit');if(action==='new-document')expect(result.name).toBe('Later document');
});

test('RAW UI imports with explicit precision consent, previews settings and applies one editable master update',async({page})=>{
  await page.goto('/');await page.getByTestId('import-input').setInputFiles(base+'bayer-rggb.dng');const dialog=page.getByRole('dialog',{name:'Import camera RAW',exact:true});
  await expect(dialog).toContainText('64 × 48');await expect(dialog.getByRole('button',{name:'Import RAW image',exact:true})).toBeDisabled();await dialog.getByRole('checkbox',{name:'Convert RAW development to 8-bit editing precision',exact:true}).check();await dialog.getByRole('button',{name:'Import RAW image',exact:true}).click();await expect(dialog).toHaveCount(0);
  await page.locator('.layer-row').click();await page.getByRole('button',{name:'Develop RAW…',exact:true}).click();const edit=page.getByRole('dialog',{name:'Develop RAW',exact:true});
  await edit.getByRole('spinbutton',{name:'RAW exposure',exact:true}).fill('1.25');await edit.getByRole('spinbutton',{name:'RAW exposure',exact:true}).press('Enter');await edit.getByRole('button',{name:'Preview development',exact:true}).click();await expect(edit.getByRole('img',{name:'RAW development preview',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>window.luma.editor.assetStore.values().length)).toBe(1);await edit.getByRole('button',{name:'Apply RAW development',exact:true}).click();await expect(edit).toHaveCount(0);
  const value=await page.evaluate(()=>{const {editor}=window.luma,state=editor.document.getSnapshot();return{label:state.past.at(-1)?.label,values:editor.assetStore.values().map(asset=>asset.raw!.settings.development.exposure)};});expect(value).toEqual({label:'Develop RAW',values:[0,1.25]});
});

test('RAW locks and aborted development preserve the accepted original and ready output',async({page})=>{
  await page.goto('/');const result=await page.evaluate(async bytes=>{
    const {RawDevelopment}=await import(/* @vite-ignore */String('/src/dom/index.ts'))as typeof import('../src/dom'),{editor}=window.luma;await editor.openRaw(new File([new Uint8Array(bytes)],'Locked.dng'),{allowPrecisionLoss:true});
    const layer=editor.document.layers.at(0)as SmartObjectLayer,other=editor.document.placeSmartObject(layer.componentId);other.locked=true;let lock='';
    try{await layer.developRaw(new RawDevelopment({exposure:1}),{allowPrecisionLoss:true});}catch(error){lock=String(error);}other.locked=false;
    const before=JSON.stringify(editor.document.toJSON()),abort=new AbortController();let entered=false,cancel='';try{await layer.developRaw(new RawDevelopment({exposure:1}),{allowPrecisionLoss:true,signal:abort.signal,onProgress:progress=>{if(progress.phase==='developing'){entered=true;abort.abort(new Error('Cancel development'));}}});}catch(error){cancel=String(error);}
    return{lock,entered,cancel,unchanged:JSON.stringify(editor.document.toJSON())===before,assets:editor.assetStore.values().length,exposure:layer.rawDevelopment!.toJSON().exposure};
  },[...await readFile(base+'bayer-rggb.dng')]);expect(result.lock).toMatch(/locked/);expect(result).toMatchObject({entered:true,unchanged:true,assets:1,exposure:0});expect(result.cancel).toContain('Cancel development');
});

test('RAW genuine 50 MP application import, save, reopen and export preserve every working pixel and original byte',async({page},info)=>{
  test.setTimeout(360_000);const fixture=manifest.cases.find(value=>value.file==='native-50mp.dng.gz')!;
  await page.goto('/');const result=await page.evaluate(async({compressed,reference,fixture})=>{
    const buffer=Uint8Array.from(atob(compressed),c=>c.charCodeAt(0)),original=await new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))).blob(),file=new File([original],'Native 50 MP.dng',{type:'image/x-adobe-dng'}),{editor}=window.luma;
    await editor.openRaw(file,{allowPrecisionLoss:true,development:fixture.options});const model=JSON.stringify(editor.document.toJSON()),project=await editor.saveProject();await editor.openProject(new File([project],'Native 50 MP.luma'));const png=await editor.exportPng(),asset=editor.assetStore.values()[0],expected=await createImageBitmap(new Blob([new Uint8Array(reference)],{type:'image/png'})),actual=await createImageBitmap(png),canvas=new OffscreenCanvas(1024,64),ctx=canvas.getContext('2d')!;let maximum=0,samples=0;
    for(let y=0;y<actual.height;y+=64)for(let x=0;x<actual.width;x+=1024){const width=Math.min(1024,actual.width-x),height=Math.min(64,actual.height-y);canvas.width=width;canvas.height=height;ctx.drawImage(expected,x,y,width,height,0,0,width,height);const a=ctx.getImageData(0,0,width,height).data;ctx.clearRect(0,0,width,height);ctx.drawImage(actual,x,y,width,height,0,0,width,height);const b=ctx.getImageData(0,0,width,height).data;for(let i=0;i<a.length;i++)maximum=Math.max(maximum,Math.abs(a[i]-b[i]));samples+=a.length;}
    actual.close();expected.close();canvas.width=canvas.height=0;const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await asset.raw!.originalBlob.arrayBuffer())),n=>n.toString(16).padStart(2,'0')).join('');return{maximum,samples,size:[editor.document.width,editor.document.height],original:sha,model:JSON.stringify(editor.document.toJSON())===model,png:[...new Uint8Array(await png.arrayBuffer())],projectBytes:project.size};
  },{compressed:(await readFile(base+fixture.file)).toString('base64'),reference:[...await readFile(base+fixture.png)],fixture});
  expect(result).toMatchObject({maximum:0,samples:200_000_000,size:[10000,5000],original:fixture.sha256,model:true});expect(result.projectBytes).toBeGreaterThan(100_000_000);await info.attach('raw-50mp-reopened.png',{body:Buffer.from(result.png),contentType:'image/png'});await info.attach('raw-50mp-application',{body:JSON.stringify({...result,png:undefined}),contentType:'application/json'});
});

test('RAW cross-document transfer survives source closure and retains further native development',async({page})=>{
  await page.goto('/');const result=await page.evaluate(async bytes=>{
    const {RawDevelopment}=await import(/* @vite-ignore */String('/src/dom/index.ts'))as typeof import('../src/dom'),{editor}=window.luma;
    await editor.openRaw(new File([new Uint8Array(bytes)],'Copied.dng'),{allowPrecisionLoss:true});const from=editor.document,original=editor.assetStore.values()[0].raw!.original.sha256;from.selectLayers([from.layers.at(0)!]);const target=editor.newDocument({width:64,height:48});editor.activateDocument(from);await editor.copySelectedLayersTo(target);await editor.closeDocument(from,{discardChanges:true});editor.activateDocument(target);
    const layer=target.layers.at(0)as import('../src/dom').SmartObjectLayer;await layer.developRaw(new RawDevelopment({exposure:-1}),{allowPrecisionLoss:true});return{hash:editor.assetStore.values().at(-1)!.raw!.original.sha256,original,exposure:layer.rawDevelopment!.toJSON().exposure};
  },[...await readFile(base+'bayer-rggb.dng')]);expect(result.hash).toBe(result.original);expect(result.exposure).toBe(-1);
});

test('RAW recovery verifies settings and both byte streams before selecting an intact checkpoint',async({page},info)=>{
  await page.goto('/');const result=await page.evaluate(async bytes=>{
    const {RawDevelopment}=await import(/* @vite-ignore */String('/src/dom/index.ts'))as typeof import('../src/dom'),{readProject}=await import(/* @vite-ignore */String('/src/core/project.ts'))as typeof import('../src/core/project'),{editor}=window.luma;
    await editor.openRaw(new File([new Uint8Array(bytes)],'Recover.dng'),{allowPrecisionLoss:true});const repo=editor.recovery.repository,key='raw-native-integrity';await repo.save(key,editor.document.toJSON(),editor.assetStore);
    await (editor.document.layers.at(0)as import('../src/dom').SmartObjectLayer).developRaw(new RawDevelopment({exposure:1}),{allowPrecisionLoss:true});await repo.save(key,editor.document.toJSON(),editor.assetStore);const entry=(await repo.list()).find(entry=>entry.id===key)!;
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('luma-recovery');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('assets','readwrite'),store=tx.objectStore('assets'),request=store.get(entry.assetKeys[0]);request.onsuccess=()=>{const asset=request.result;asset.raw.settings.development.exposure=0.75;store.put(asset,entry.assetKeys[0]);};tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});}finally{db.close();}
    const restored=await repo.restore(key),project=await readProject(restored.blob);await repo.remove(key);return{skipped:restored.skipped,exposure:project.entries[0].raw!.settings.development.exposure,original:project.entries[0].raw!.original.sha256,retained:entry.assetKeys[0]!==entry.previous![0].assetKeys[0]};
  },[...await readFile(base+'bayer-rggb.dng')]);expect(result).toMatchObject({skipped:1,exposure:0,retained:true,original:manifest.cases[0].sha256});await info.attach('raw-recovery-integrity',{body:JSON.stringify(result),contentType:'application/json'});
});

test('RAW brush source capture, authored texture, portable library and recovery retain sensor data',async({page},info)=>{
  await page.goto('/');const result=await page.evaluate(async bytes=>{
    const {editor}=window.luma,{captureBrushPreset,exportBrushPack,parseBrushPack}=await import(/* @vite-ignore */String('/src/brushes/portable.ts'))as typeof import('../src/brushes/portable');
    await editor.openRaw(new File([new Uint8Array(bytes)],'Texture.dng'),{allowPrecisionLoss:true});const original=editor.assetStore.values()[0];editor.brushTextureSource.capture(editor.assetStore,original.id);const sourceDocument=editor.document;editor.newDocument({width:64,height:48});await editor.closeDocument(sourceDocument,{discardChanges:true});
    editor.tools.configure({size:32,hardness:1,opacity:1,flow:1,pressureSize:false,smoothing:0,texture:{channel:'luminance',invert:false}});
    const preset=await captureBrushPreset('RAW native texture','brush',editor.tools.getSnapshot().settings,editor.brushTextureSource),pack=await exportBrushPack([preset]);editor.tools.begin('brush',{x:32,y:24},{alt:false,shift:false,pressure:1},1);await editor.tools.end();const project=await editor.saveProject();await editor.openProject(new File([project],'RAW brush.luma'));
    const source=editor.assetStore.values()[0],parsed=await parseBrushPack(pack);editor.brushTextureSource.clear();await editor.applyBrushPreset(parsed[0]);await editor.brushPresets.save(parsed[0]);const backup=await editor.brushPresets.exportRecoveryFile();await editor.brushPresets.resetFromRecoveryFile(backup);await editor.brushPresets.importFile(pack);
    return{version:preset.toJSON().version,project:source.raw!.original.sha256,pack:parsed[0].source!.raw!.original.sha256,applied:editor.brushTextureSource.source!.raw!.original.sha256,recovered:editor.brushPresets.getSnapshot().presets[0].preset.source!.raw!.original.sha256};
  },[...await readFile(base+'bayer-rggb.dng')]);expect(result).toEqual({version:6,project:manifest.cases[0].sha256,pack:manifest.cases[0].sha256,applied:manifest.cases[0].sha256,recovered:manifest.cases[0].sha256});await info.attach('raw-brush-sources',{body:JSON.stringify(result),contentType:'application/json'});
});

test('RAW narrow review keeps every action in the viewport and Escape discards its draft',async({page},info)=>{
  await page.setViewportSize({width:360,height:780});await page.goto('/');await page.getByTestId('import-input').setInputFiles(base+'bayer-rggb.dng');const dialog=page.getByRole('dialog',{name:'Import camera RAW',exact:true});await expect(dialog).toContainText('64 × 48');
  expect(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
  for(const label of ['Cancel','Preview development','Import RAW image'])await expect(dialog.getByRole('button',{name:label,exact:true})).toBeInViewport({ratio:1});
  await info.attach('raw-narrow-review.png',{body:await page.screenshot(),contentType:'image/png'});await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);expect(await page.evaluate(()=>window.luma.editor.assetStore.values().length)).toBe(0);
});

test('documented trusted RAW constructor example develops the retained original through the actual DOM',async({page})=>{
  const source=(await readFile('docs/SCRIPTING_API.md','utf8')).match(/<!-- example: raw-browser-development -->\s*```ts\n([\s\S]*?)\n```/)?.[1];expect(source).toBeTruthy();
  const code=source!.replace(/^import .*;\n/m,'');await page.goto('/');const result=await page.evaluate(async({bytes,code})=>{
    const {RawDevelopment,SmartObjectLayer}=await import(/* @vite-ignore */String('/src/dom/index.ts'))as typeof import('../src/dom'),{editor}=window.luma,file=new File([new Uint8Array(bytes)],'Example.dng'),abortController=new AbortController();
    const execute=new Function('editor','file','abortController','RawDevelopment','SmartObjectLayer',`return(async()=>{${code}})();`);await execute(editor,file,abortController,RawDevelopment,SmartObjectLayer);
    return{exposure:(editor.document.layers.at(0)as import('../src/dom').SmartObjectLayer).rawDevelopment!.toJSON().exposure,label:editor.document.getSnapshot().past.at(-1)?.label,original:editor.assetStore.values().at(-1)!.raw!.original.sha256};
  },{bytes:[...await readFile(base+'bayer-rggb.dng')],code});expect(result).toEqual({exposure:0.75,label:'Develop RAW',original:manifest.cases[0].sha256});
});

test('RAW source-bearing recipes preserve distinct filenames and native pixels after the source document closes',async({page},info)=>{
  await page.goto('/');const result=await page.evaluate(async bytes=>{
    const {RasterLayer}=await import(/* @vite-ignore */String('/src/dom/index.ts'))as typeof import('../src/dom'),{serializeRecipePackage,readRecipePackage}=await import(/* @vite-ignore */String('/src/ai/recipes/package.ts'))as typeof import('../src/ai/recipes/package'),{executeRecipePackage}=await import(/* @vite-ignore */String('/src/ai/recipes/package-executor.ts'))as typeof import('../src/ai/recipes/package-executor'),{editor}=window.luma;
    await editor.openRaw(new File([new Uint8Array(bytes)],'First original.dng'),{allowPrecisionLoss:true});const first=editor.assetStore.values()[0],second=await editor.assetStore.add(first.blob,'Second accepted image',undefined,false,{raw:{...first.raw!,original:{...first.raw!.original,name:'Second original.dng'}}});
    const hash=async(blob:Blob)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),n=>n.toString(16).padStart(2,'0')).join(''),before=await hash(await editor.exportPng());
    const layers=[first,second].map(asset=>new RasterLayer({name:asset.name,assetId:asset.id,width:asset.width,height:asset.height})),recipe={schemaVersion:1 as const,id:'raw-shared-original',name:'RAW filenames',description:'Retain the same sensor bytes under two source names',version:1,parameters:[],steps:layers.map((layer,i)=>({id:`place-${i}`,name:layer.name,action:{type:'layer.add' as const,layerTemplate:{...layer.toJSON()}}}))};
    const pack=await serializeRecipePackage(recipe,editor.assetStore),parsed=await readRecipePackage(pack),sourceDocument=editor.document;editor.newDocument({width:64,height:48});await editor.closeDocument(sourceDocument,{discardChanges:true});await executeRecipePackage(pack,editor.document,{});
    return{names:parsed.assets.map(asset=>asset.raw!.original.name),originals:editor.assetStore.values().map(asset=>asset.raw!.original.sha256),samePixels:before===await hash(await editor.exportPng()),layers:editor.document.layers.length};
  },[...await readFile(base+'bayer-rggb.dng')]);expect(result).toEqual({names:['First original.dng','Second original.dng'],originals:[manifest.cases[0].sha256,manifest.cases[0].sha256],samePixels:true,layers:2});await info.attach('raw-recipe-source-names',{body:JSON.stringify(result),contentType:'application/json'});
});

for(const action of ['remove','replace','close-bitmap']as const)test(`RAW development rejects source ${action} during native work and permits a restored retry`,async({page})=>{
  await page.goto('/');const result=await page.evaluate(async({bytes,action})=>{
    const {RawDevelopment}=await import(/* @vite-ignore */String('/src/dom/index.ts'))as typeof import('../src/dom'),{AssetStore}=await import(/* @vite-ignore */String('/src/core/assets.ts'))as typeof import('../src/core/assets'),{editor}=window.luma;await editor.openRaw(new File([new Uint8Array(bytes)],'Source lifetime.dng'),{allowPrecisionLoss:true});
    const document=editor.document,assets=editor.assetStore,original=assets.values()[0],layer=document.layers.at(0)as import('../src/dom').SmartObjectLayer,before=JSON.stringify(document.toJSON()),revision=document.getSnapshot().revision,replacement=action==='replace'?await createImageBitmap(original.blob):null;
    const holding=new AssetStore();if(action==='replace')assets.shareTo(holding,original.id,original.id);
    let entered=false,error='';try{await layer.developRaw(new RawDevelopment({exposure:1}),{allowPrecisionLoss:true,onProgress:progress=>{if(entered||progress.phase!=='developing')return;entered=true;if(action==='close-bitmap')original.bitmap.close();else{assets.remove(original.id);if(replacement)assets.install({...original,bitmap:replacement},false);}}});}catch(cause){error=String(cause);}
    const unchanged=JSON.stringify(document.toJSON())===before,delta=document.getSnapshot().revision-revision,count=assets.values().length,heldBitmap=original.bitmap.width;
    if(assets.has(original.id))assets.remove(original.id);await assets.add(original.blob,original.name,original.id,false,{raw:original.raw});await layer.developRaw(new RawDevelopment({exposure:1}),{allowPrecisionLoss:true});
    holding.dispose();return{entered,error,unchanged,delta,count,heldBitmap,retry:layer.rawDevelopment!.toJSON().exposure};
  },{bytes:[...await readFile(base+'bayer-rggb.dng')],action});expect(result).toMatchObject({entered:true,unchanged:true,delta:0,count:action==='remove'?0:1,heldBitmap:action==='replace'?64:0,retry:1});expect(result.error).toMatch(/RAW source changed/);
});
