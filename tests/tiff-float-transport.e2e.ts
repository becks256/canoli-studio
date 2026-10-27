import{test,expect}from'@playwright/test';
import{readFile}from'node:fs/promises';
const base='tests/fixtures/tiff-float/';
test('float TIFF original settings survive retained workspace redo, portable recipes and cross-document copying after source closure',async({page},info)=>{
  await page.goto('/');const result=await page.evaluate(async bytes=>{
    const {editor}=window.luma,file=new File([new Uint8Array(bytes)],'Portable precision.tiff',{type:'image/tiff'});
    await editor.openTiff(file,{allowPrecisionLoss:true,floatColorSpace:'linear-srgb'});const original=editor.document.layers.at(0)!,source=editor.assetStore.values()[0];
    const hash=async(blob:Blob)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].join(','),png=await hash(await editor.exportPng());
    const {serializeRecipePackage,readRecipePackage}=await import(/* @vite-ignore */String('/src/ai/recipes/package.ts'))as typeof import('../src/ai/recipes/package');
    const recipe={schemaVersion:1 as const,id:'portable-tiff',name:'Portable float TIFF',description:'Original source',version:1,parameters:[],steps:[{id:'place',name:'Place source',action:{type:'layer.add' as const,layerTemplate:{...original.toJSON()}}}]};
    const blob=await serializeRecipePackage(recipe,editor.assetStore),packed=await readRecipePackage(blob);original.duplicate();editor.document.undo();
    const version=await editor.saveWorkspaceVersion('float TIFF retained redo');await editor.restoreWorkspace(version);editor.document.redo();
    const redo={layers:editor.document.layers.length,settings:editor.assetStore.values()[0].tiff};
    editor.newDocument({width:131,height:79});const {executeRecipePackage}=await import(/* @vite-ignore */String('/src/ai/recipes/package-executor.ts'))as typeof import('../src/ai/recipes/package-executor');await executeRecipePackage(blob,editor.document,{});
    const recipePng=await hash(await editor.exportPng()),from=editor.document;from.selectLayers([from.layers.at(0)!]);const target=editor.newDocument({width:131,height:79});editor.activateDocument(from);
    await editor.copySelectedLayersTo(target);await editor.closeDocument(from,{discardChanges:true});editor.activateDocument(target);
    const copied=editor.assetStore.values()[0];return{redo,packed:packed.assets[0].tiff,applied:copied.tiff,same:recipePng===png&&await hash(await editor.exportPng())===png,original:await hash(copied.blob)===await hash(source.blob)};
  },[...await readFile(base+'unprofiled-linear.tif')]);
  expect(result).toEqual({redo:{layers:2,settings:{page:0,allowPrecisionLoss:true,floatColorSpace:'linear-srgb'}},packed:{page:0,allowPrecisionLoss:true,floatColorSpace:'linear-srgb'},applied:{page:0,allowPrecisionLoss:true,floatColorSpace:'linear-srgb'},same:true,original:true});
  await info.attach('tiff-portable-sources',{body:JSON.stringify(result),contentType:'application/json'});
});


test('float TIFF recovery retains original choices and detects changed choices before falling back to an intact checkpoint',async({page},info)=>{
  await page.goto('/');const captured=await page.evaluate(async bytes=>{
    const {editor}=window.luma;await editor.openTiff(new File([new Uint8Array(bytes)],'Recover precision.tiff',{type:'image/tiff'}),{allowPrecisionLoss:true,floatColorSpace:'linear-srgb'});editor.document.name='Recover float TIFF precision';await editor.recovery.flush();
    const hash=async(blob:Blob)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].join(',');return{png:await hash(await editor.exportPng()),original:await hash(editor.assetStore.values()[0].blob)};
  },[...await readFile(base+'unprofiled-linear.tif')]);
  await page.reload();await page.getByRole('button',{name:'Recover work',exact:true}).click();await page.locator('.recovery-row').filter({hasText:'Recover float TIFF precision'}).getByRole('button',{name:'Restore',exact:true}).click();
  await expect(page.getByLabel('Document name',{exact:true})).toHaveValue('Recover float TIFF precision');
  const restored=await page.evaluate(async()=>{
    const {editor}=window.luma,asset=editor.assetStore.values()[0],repo=editor.recovery.repository;
    const hash=async(blob:Blob)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].join(',');
    const png=await hash(await editor.exportPng()),original=await hash(asset.blob);
    await repo.save('tiff-settings-integrity',editor.document.toJSON(),{get:()=>({...asset,tiff:{page:0,allowPrecisionLoss:true,floatColorSpace:'srgb'}})});
    editor.document.name='Latest precision';await repo.save('tiff-settings-integrity',editor.document.toJSON(),editor.assetStore);
    const entry=(await repo.list()).find(entry=>entry.id==='tiff-settings-integrity')!,differentKeys=entry.assetKeys[0]!==entry.previous![0].assetKeys[0];
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('luma-recovery');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('assets','readwrite'),store=tx.objectStore('assets'),request=store.get(entry.assetKeys[0]);request.onsuccess=()=>store.put({...request.result,tiff:{page:0,allowPrecisionLoss:true,floatColorSpace:'srgb'}},entry.assetKeys[0]);tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});}finally{db.close();}
    const recovered=await repo.restore('tiff-settings-integrity'),{readProject}=await import(/* @vite-ignore */String('/src/core/project.ts'))as typeof import('../src/core/project'),project=await readProject(recovered.blob);await repo.remove('tiff-settings-integrity');
    return{png,original,settings:asset.tiff,differentKeys,skipped:recovered.skipped,fallback:project.entries[0].tiff};
  });
  expect(restored).toEqual({...captured,settings:{page:0,allowPrecisionLoss:true,floatColorSpace:'linear-srgb'},differentKeys:true,skipped:1,fallback:{page:0,allowPrecisionLoss:true,floatColorSpace:'srgb'}});
  await info.attach('tiff-recovery-integrity',{body:JSON.stringify(restored),contentType:'application/json'});
});


test('float TIFF brush review and source-bearing packs retain precision, original bytes, authored strokes and library recovery',async({page},info)=>{
  await page.goto('/');await page.getByRole('button',{name:'Brush tool (B)',exact:true}).click();await page.getByRole('button',{name:'Texture…',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Brush texture',exact:true});await dialog.getByLabel('Brush texture image file',{exact:true}).setInputFiles(base+'unprofiled-linear.tif');
  const use=dialog.getByRole('button',{name:'Use TIFF page as texture',exact:true});await expect(use).toBeDisabled();await dialog.getByRole('checkbox',{name:'Convert texture to 8-bit editing precision',exact:true}).check();await expect(use).toBeDisabled();await dialog.getByLabel('Float TIFF texture color interpretation',{exact:true}).selectOption('linear-srgb');await use.click();
  await expect(dialog.getByTestId('brush-texture-source')).toContainText('TIFF');await dialog.getByRole('button',{name:'Apply texture',exact:true}).click();
  const result=await page.evaluate(async()=>{
    const {editor}=window.luma,{captureBrushPreset,exportBrushPack,parseBrushPack}=await import(/* @vite-ignore */String('/src/brushes/portable.ts'))as typeof import('../src/brushes/portable');
    const hash=async(blob:Blob)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].join(',');
    editor.newDocument({width:32,height:32});editor.tools.configure({size:16,hardness:1,opacity:1,flow:1,pressureSize:false,smoothing:0});
    const preset=await captureBrushPreset('float TIFF precision texture','brush',editor.tools.getSnapshot().settings,editor.brushTextureSource),pack=await exportBrushPack([preset]);
    editor.tools.begin('brush',{x:16,y:16},{alt:false,shift:false,pressure:1},1);await editor.tools.end();
    const png=await hash(await editor.exportPng()),source=editor.assetStore.values()[0],project=await editor.saveProject();await editor.openProject(new File([project],'tiff-texture.luma'));
    const reopened=await hash(await editor.exportPng())===png,projectSettings=editor.assetStore.values()[0].tiff;
    editor.brushTextureSource.clear();const parsed=await parseBrushPack(pack);await editor.applyBrushPreset(parsed[0]);await editor.brushPresets.save(parsed[0]);
    const backup=await editor.brushPresets.exportRecoveryFile(),{parseBrushRecoveryFile}=await import(/* @vite-ignore */String('/src/brushes/recovery.ts'))as typeof import('../src/brushes/recovery');
    const records=await parseBrushRecoveryFile(backup),{ownPresetSource}=await import(/* @vite-ignore */String('/src/brushes/sources.ts'))as typeof import('../src/brushes/sources'),backed=ownPresetSource((records[0]as {source:unknown}).source);
    await editor.brushPresets.resetFromRecoveryFile(backup);await editor.brushPresets.importFile(pack);
    return{reopened,projectSettings,sourceSettings:parsed[0].source?.tiff,original:await hash(parsed[0].source!.blob)===await hash(source.blob),applied:editor.brushTextureSource.source?.tiff,recovered:editor.brushPresets.getSnapshot().presets[0].preset.source?.tiff,backup:backed.tiff,backupOriginal:await hash(backed.blob)===await hash(source.blob)};
  });
  const settings={page:0,allowPrecisionLoss:true,floatColorSpace:'linear-srgb'};expect(result).toEqual({reopened:true,projectSettings:settings,sourceSettings:settings,original:true,applied:settings,recovered:settings,backup:settings,backupOriginal:true});
  await info.attach('tiff-brush-portability',{body:JSON.stringify(result),contentType:'application/json'});
});
