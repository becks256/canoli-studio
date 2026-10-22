import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';

const base='tests/fixtures/avif-import/';
const manifest=JSON.parse(await readFile(base+'manifest.json','utf8'))as {cases:{file:string;reference:string;width:number;height:number;depth:number;assumeSrgb:boolean;nativeResolved?:string}[]};

for(const fixture of manifest.cases)test(`AVIF application opens ${fixture.file}, preserves original choices and reopens native pixels`,async({page},info)=>{
  await page.goto('/');
  const result=await page.evaluate(async({bytes,reference,fixture})=>{
    const {editor}=window.luma,settings={allowPrecisionLoss:fixture.depth>8,assumeSrgb:fixture.assumeSrgb};
    const report=await editor.openAvif(new File([new Uint8Array(bytes)],fixture.file,{type:'image/avif'}),settings);
    const clean=editor.document.getSnapshot(),asset=editor.assetStore.values()[0],before=JSON.stringify(editor.document.toJSON());
    const hash=async(blob:Blob)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].join(',');
    const png=await editor.exportPng(),expected=await createImageBitmap(new Blob([new Uint8Array(reference)],{type:'image/png'})),actual=await createImageBitmap(png);
    const canvas=document.createElement('canvas');let alpha=0,premult=0;
    // The independent reference has untagged native RGB. Compare display pixels
    // only for sRGB/fallback inputs; P3's source values are checked by codec tests.
    if(!['display-p3','linear-srgb','icc'].includes(report.color.kind))for(let y=0;y<actual.height;y+=64)for(let x=0;x<actual.width;x+=1024){
      const width=Math.min(1024,actual.width-x),height=Math.min(64,actual.height-y);canvas.width=width;canvas.height=height;const context=canvas.getContext('2d')!;
      context.drawImage(expected,x,y,width,height,0,0,width,height);const a=context.getImageData(0,0,width,height).data;
      context.clearRect(0,0,width,height);context.drawImage(actual,x,y,width,height,0,0,width,height);const b=context.getImageData(0,0,width,height).data;
      for(let i=0;i<a.length;i+=4){alpha=Math.max(alpha,Math.abs(a[i+3]-b[i+3]));for(let c=0;c<3;c++)premult=Math.max(premult,Math.abs(a[i+c]*a[i+3]-b[i+c]*b[i+3])/255);}
    }
    actual.close();expected.close();canvas.width=canvas.height=0;
    editor.document.name='Edited AVIF';editor.document.undo();const undo=JSON.stringify(editor.document.toJSON())===before;
    const project=await editor.saveProject();await editor.openProject(new File([project],'original-avif.luma'));
    const restored=editor.assetStore.values()[0];
    return{report,alpha,premult,undo,revision:clean.revision,past:clean.past.length,size:[editor.document.width,editor.document.height],sourceSize:[asset.width,asset.height],modelRestored:JSON.stringify(editor.document.toJSON())===before,samePng:await hash(png)===await hash(await editor.exportPng()),sameOriginal:await hash(restored.blob)===await hash(new Blob([new Uint8Array(bytes)])),type:restored.blob.type,settings:restored.avif,frozen:Object.isFrozen(asset.avif)&&Object.isFrozen(asset.avifReport)&&Object.isFrozen(asset.avifReport?.color)};
  },{fixture,bytes:[...await readFile(base+fixture.file)],reference:[...await readFile(base+fixture.reference)]});
  expect(result).toMatchObject({revision:0,past:0,undo:true,alpha:0,size:[fixture.width,fixture.height],sourceSize:[fixture.width,fixture.height],modelRestored:true,samePng:true,sameOriginal:true,type:'image/avif',settings:{allowPrecisionLoss:fixture.depth>8,assumeSrgb:fixture.assumeSrgb},frozen:true});
  expect(result.premult).toBeLessThanOrEqual(fixture.file==='premultiplied.avif'?3:2);
  await info.attach('avif-application-roundtrip',{body:JSON.stringify(result),contentType:'application/json'});
});

test('AVIF canvas drop recognizes an empty MIME, reviews the encoded crop and retains complete source bytes',async({page})=>{
  await page.goto('/');const bytes=[...await readFile(base+'crop.avif')];
  const data=await page.evaluateHandle(bytes=>{const transfer=new DataTransfer();transfer.items.add(new File([new Uint8Array(bytes)],'Dropped crop.avif'));return transfer;},bytes);
  await page.locator('.viewport').dispatchEvent('drop',{dataTransfer:data});await data.dispose();
  const dialog=page.getByRole('dialog',{name:'Import AVIF',exact:true});await expect(dialog).toContainText('Encoded extent:');await dialog.getByRole('button',{name:'Import AVIF image',exact:true}).click();await expect(dialog).toHaveCount(0);
  const result=await page.evaluate(async()=>{const {editor}=window.luma,source=editor.assetStore.values()[0];return{size:[editor.document.width,editor.document.height],type:source.blob.type,bytes:[...new Uint8Array(await source.blob.arrayBuffer())]};});
  const fixture=manifest.cases.find(value=>value.file==='crop.avif')!;expect(result).toEqual({size:[fixture.width,fixture.height],type:'image/avif',bytes});
});

test('AVIF bytes cannot bypass precision review through a misleading raster MIME type',async({page})=>{
  await page.goto('/');const result=await page.evaluate(async bytes=>{
    const {editor}=window.luma,before=JSON.stringify(editor.document.toJSON()),native=window.createImageBitmap;let calls=0;const errors:string[]=[];
    window.createImageBitmap=(async(...args:Parameters<typeof createImageBitmap>)=>{calls++;return native(...args);})as typeof createImageBitmap;
    try{for(const type of ['image/png','image/jpeg','image/webp','image/tiff']){try{await editor.importImage(new File([new Uint8Array(bytes)],'Misleading.png',{type}));errors.push('Accepted');}catch(error){errors.push(String(error));}}}finally{window.createImageBitmap=native;}
    return{calls,errors,unchanged:before===JSON.stringify(editor.document.toJSON()),assets:editor.assetStore.values().length};
  },[...await readFile(base+'rgb-10.avif')]);
  expect(result).toMatchObject({calls:0,unchanged:true,assets:0});expect(result.errors).toHaveLength(4);for(const error of result.errors)expect(error).toMatch(/AVIF source bytes/);
});

test('AVIF dialog requires precision and unidentified-color consent and rejects native HDR without replacing artwork',async({page})=>{
  await page.goto('/');await page.getByTestId('import-input').setInputFiles(base+'rgb-10.avif');
  const dialog=page.getByRole('dialog',{name:'Import AVIF',exact:true}),apply=dialog.getByRole('button',{name:'Import AVIF image',exact:true});
  await expect(apply).toBeDisabled();await dialog.getByRole('checkbox',{name:'Convert AVIF to 8-bit editing precision',exact:true}).check();await apply.click();await expect(dialog).toHaveCount(0);
  const before=await page.evaluate(()=>JSON.stringify(window.luma.editor.document.toJSON()));
  await page.getByTestId('import-input').setInputFiles(base+'unspecified.avif');await expect(apply).toBeDisabled();
  await dialog.getByRole('checkbox',{name:'Allow sRGB fallback for unidentified AVIF color',exact:true}).check();await apply.click();await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(()=>window.luma.editor.assetStore.values()[0].avif)).toEqual({allowPrecisionLoss:false,assumeSrgb:true});
  const accepted=await page.evaluate(()=>JSON.stringify(window.luma.editor.document.toJSON()));expect(accepted).not.toBe(before);
  await page.getByTestId('import-input').setInputFiles(base+'missing-colr-pq.avif');
  await dialog.getByRole('checkbox',{name:'Convert AVIF to 8-bit editing precision',exact:true}).check();await dialog.getByRole('checkbox',{name:'Allow sRGB fallback for unidentified AVIF color',exact:true}).check();await apply.click();await expect(dialog.getByRole('alert')).toContainText('HDR');
  expect(await page.evaluate(()=>JSON.stringify(window.luma.editor.document.toJSON()))).toBe(accepted);await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
});

for(const action of ['cancel','callback-error','host-edit','replace-session','dispose']as const)test(`AVIF application ${action} discards private native work and allows a fresh import`,async({page})=>{
  await page.goto('/');const result=await page.evaluate(async({bytes,action})=>{
    const {EditorApplication}=await import(/* @vite-ignore */String('/src/editor.ts'))as typeof import('../src/editor');
    const editor=new EditorApplication(),file=new File([new Uint8Array(bytes)],'guarded.avif',{type:'image/avif'});editor.document.name='Existing artwork';
    const before=JSON.stringify(editor.document.toJSON()),abort=new AbortController();let changed=false,error='',returned=false;
    try{await editor.openAvif(file,{}, {signal:abort.signal,onProgress:progress=>{if(changed||progress.phase!=='decoding')return;changed=true;if(action==='cancel')abort.abort();else if(action==='callback-error')throw new Error('Import callback failed');else if(action==='host-edit')editor.document.name='Human edit';else if(action==='replace-session')editor.newDocument({name:'Later session'});else editor.dispose();}});returned=true;}catch(cause){error=String(cause);}
    const after=JSON.stringify(editor.document.toJSON()),assets=editor.assetStore.values().length;
    let retry=false;if(action!=='dispose'){await editor.openAvif(file);retry=editor.assetStore.values()[0].blob.type==='image/avif';}editor.dispose();
    return{changed,error,returned,before,after,assets,retry};
  },{bytes:[...await readFile(base+'grid.avif')],action});
  expect(result).toMatchObject({changed:true,returned:false,assets:0,retry:action!=='dispose'});expect(result.error).toMatch(/abort|callback failed|session changed|disposed/i);
  if(['cancel','callback-error','dispose'].includes(action))expect(result.after).toBe(result.before);
});

test('AVIF original settings survive retained workspace redo, portable recipes and cross-document copying after source closure',async({page},info)=>{
  await page.goto('/');const result=await page.evaluate(async bytes=>{
    const {editor}=window.luma,file=new File([new Uint8Array(bytes)],'Portable precision.avif',{type:'image/avif'});
    await editor.openAvif(file,{allowPrecisionLoss:true});const original=editor.document.layers.at(0)!,source=editor.assetStore.values()[0];
    const hash=async(blob:Blob)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].join(','),png=await hash(await editor.exportPng());
    const {serializeRecipePackage,readRecipePackage}=await import(/* @vite-ignore */String('/src/ai/recipes/package.ts'))as typeof import('../src/ai/recipes/package');
    const recipe={schemaVersion:1 as const,id:'portable-avif',name:'Portable AVIF',description:'Original source',version:1,parameters:[],steps:[{id:'place',name:'Place source',action:{type:'layer.add' as const,layerTemplate:{...original.toJSON()}}}]};
    const blob=await serializeRecipePackage(recipe,editor.assetStore),packed=await readRecipePackage(blob);original.duplicate();editor.document.undo();
    const version=await editor.saveWorkspaceVersion('AVIF retained redo');await editor.restoreWorkspace(version);editor.document.redo();
    const redo={layers:editor.document.layers.length,settings:editor.assetStore.values()[0].avif};
    editor.newDocument({width:17,height:13});const {executeRecipePackage}=await import(/* @vite-ignore */String('/src/ai/recipes/package-executor.ts'))as typeof import('../src/ai/recipes/package-executor');await executeRecipePackage(blob,editor.document,{});
    const recipePng=await hash(await editor.exportPng()),from=editor.document;from.selectLayers([from.layers.at(0)!]);const target=editor.newDocument({width:17,height:13});editor.activateDocument(from);
    await editor.copySelectedLayersTo(target);await editor.closeDocument(from,{discardChanges:true});editor.activateDocument(target);
    const copied=editor.assetStore.values()[0];return{redo,packed:packed.assets[0].avif,applied:copied.avif,same:recipePng===png&&await hash(await editor.exportPng())===png,original:await hash(copied.blob)===await hash(source.blob)};
  },[...await readFile(base+'rgb-10.avif')]);
  expect(result).toEqual({redo:{layers:2,settings:{allowPrecisionLoss:true,assumeSrgb:false}},packed:{allowPrecisionLoss:true,assumeSrgb:false},applied:{allowPrecisionLoss:true,assumeSrgb:false},same:true,original:true});
  await info.attach('avif-portable-sources',{body:JSON.stringify(result),contentType:'application/json'});
});

test('an AVIF import queued behind a native job rejects promptly when its document changes',async({page})=>{
  await page.goto('/');const result=await page.evaluate(async bytes=>{
    const {decodeAvifFile}=await import(/* @vite-ignore */String('/src/core/interchange/avif/client.ts'))as typeof import('../src/core/interchange/avif/client');
    const {EditorApplication}=await import(/* @vite-ignore */String('/src/editor.ts'))as typeof import('../src/editor');
    const file=new File([new Uint8Array(bytes)],'Queued.avif',{type:'image/avif'}),native=Worker.prototype.postMessage,abort=new AbortController();let posts=0;
    Worker.prototype.postMessage=function(value:unknown,...rest:unknown[]){if(value&&typeof value==='object'&&'mode'in value&&value.mode==='decode'){posts++;return;}return native.call(this,value,...rest as [StructuredSerializeOptions]);};
    const editor=new EditorApplication(),active=decodeAvifFile(file,{}, {signal:abort.signal}).then(()=>'',error=>String(error));
    try{
      await Promise.resolve();const queued=editor.openAvif(file).then(()=>'',error=>String(error));editor.document.name='Edit while queued';
      const error=await queued,assets=editor.assetStore.values().length;abort.abort();await active;
      Worker.prototype.postMessage=native;await editor.openAvif(file);
      return{posts,error,assets,retry:editor.assetStore.values()[0].blob.type};
    }finally{abort.abort();Worker.prototype.postMessage=native;editor.dispose();}
  },[...await readFile(base+'grid.avif')]);
  expect(result).toMatchObject({posts:1,assets:0,retry:'image/avif'});expect(result.error).toMatch(/session changed/i);
});

test('AVIF recovery retains original choices and detects changed choices before falling back to an intact checkpoint',async({page},info)=>{
  await page.goto('/');const captured=await page.evaluate(async bytes=>{
    const {editor}=window.luma;await editor.openAvif(new File([new Uint8Array(bytes)],'Recover precision.avif',{type:'image/avif'}),{allowPrecisionLoss:true});editor.document.name='Recover AVIF precision';await editor.recovery.flush();
    const hash=async(blob:Blob)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].join(',');return{png:await hash(await editor.exportPng()),original:await hash(editor.assetStore.values()[0].blob)};
  },[...await readFile(base+'rgb-10.avif')]);
  await page.reload();await page.getByRole('button',{name:'Recover work',exact:true}).click();await page.locator('.recovery-row').filter({hasText:'Recover AVIF precision'}).getByRole('button',{name:'Restore',exact:true}).click();
  await expect(page.getByLabel('Document name',{exact:true})).toHaveValue('Recover AVIF precision');
  const restored=await page.evaluate(async()=>{
    const {editor}=window.luma,asset=editor.assetStore.values()[0],repo=editor.recovery.repository;
    const hash=async(blob:Blob)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].join(',');
    const png=await hash(await editor.exportPng()),original=await hash(asset.blob);
    await repo.save('avif-settings-integrity',editor.document.toJSON(),{get:()=>({...asset,avif:{allowPrecisionLoss:true,assumeSrgb:true}})});
    editor.document.name='Latest precision';await repo.save('avif-settings-integrity',editor.document.toJSON(),editor.assetStore);
    const entry=(await repo.list()).find(entry=>entry.id==='avif-settings-integrity')!,differentKeys=entry.assetKeys[0]!==entry.previous![0].assetKeys[0];
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('luma-recovery');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('assets','readwrite'),store=tx.objectStore('assets'),request=store.get(entry.assetKeys[0]);request.onsuccess=()=>store.put({...request.result,avif:{allowPrecisionLoss:true,assumeSrgb:true}},entry.assetKeys[0]);tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});}finally{db.close();}
    const recovered=await repo.restore('avif-settings-integrity'),{readProject}=await import(/* @vite-ignore */String('/src/core/project.ts'))as typeof import('../src/core/project'),project=await readProject(recovered.blob);await repo.remove('avif-settings-integrity');
    return{png,original,settings:asset.avif,differentKeys,skipped:recovered.skipped,fallback:project.entries[0].avif};
  });
  expect(restored).toEqual({...captured,settings:{allowPrecisionLoss:true,assumeSrgb:false},differentKeys:true,skipped:1,fallback:{allowPrecisionLoss:true,assumeSrgb:true}});
  await info.attach('avif-recovery-integrity',{body:JSON.stringify(restored),contentType:'application/json'});
});

test('AVIF brush review and source-bearing packs retain precision, original bytes, authored strokes and library recovery',async({page},info)=>{
  await page.goto('/');await page.getByRole('button',{name:'Brush tool (B)',exact:true}).click();await page.getByRole('button',{name:'Texture…',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Brush texture',exact:true});await dialog.getByLabel('Brush texture image file',{exact:true}).setInputFiles(base+'rgb-10.avif');
  const use=dialog.getByRole('button',{name:'Use AVIF image as texture',exact:true});await expect(use).toBeDisabled();await dialog.getByRole('checkbox',{name:'Convert AVIF to 8-bit editing precision',exact:true}).check();await use.click();
  await expect(dialog.getByTestId('brush-texture-source')).toContainText('AVIF');await dialog.getByRole('button',{name:'Apply texture',exact:true}).click();
  const result=await page.evaluate(async()=>{
    const {editor}=window.luma,{captureBrushPreset,exportBrushPack,parseBrushPack}=await import(/* @vite-ignore */String('/src/brushes/portable.ts'))as typeof import('../src/brushes/portable');
    const hash=async(blob:Blob)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].join(',');
    editor.newDocument({width:32,height:32});editor.tools.configure({size:16,hardness:1,opacity:1,flow:1,pressureSize:false,smoothing:0});
    const preset=await captureBrushPreset('AVIF precision texture','brush',editor.tools.getSnapshot().settings,editor.brushTextureSource),pack=await exportBrushPack([preset]);
    editor.tools.begin('brush',{x:16,y:16},{alt:false,shift:false,pressure:1},1);await editor.tools.end();
    const png=await hash(await editor.exportPng()),source=editor.assetStore.values()[0],project=await editor.saveProject();await editor.openProject(new File([project],'avif-texture.luma'));
    const reopened=await hash(await editor.exportPng())===png,projectSettings=editor.assetStore.values()[0].avif;
    editor.brushTextureSource.clear();const parsed=await parseBrushPack(pack);await editor.applyBrushPreset(parsed[0]);await editor.brushPresets.save(parsed[0]);
    const backup=await editor.brushPresets.exportRecoveryFile(),{parseBrushRecoveryFile}=await import(/* @vite-ignore */String('/src/brushes/recovery.ts'))as typeof import('../src/brushes/recovery');
    const records=await parseBrushRecoveryFile(backup),{ownPresetSource}=await import(/* @vite-ignore */String('/src/brushes/sources.ts'))as typeof import('../src/brushes/sources'),backed=ownPresetSource((records[0]as {source:unknown}).source);
    await editor.brushPresets.resetFromRecoveryFile(backup);await editor.brushPresets.importFile(pack);
    return{reopened,projectSettings,sourceSettings:parsed[0].source?.avif,original:await hash(parsed[0].source!.blob)===await hash(source.blob),applied:editor.brushTextureSource.source?.avif,recovered:editor.brushPresets.getSnapshot().presets[0].preset.source?.avif,backup:backed.avif,backupOriginal:await hash(backed.blob)===await hash(source.blob)};
  });
  const settings={allowPrecisionLoss:true,assumeSrgb:false};expect(result).toEqual({reopened:true,projectSettings:settings,sourceSettings:settings,original:true,applied:settings,recovered:settings,backup:settings,backupOriginal:true});
  await info.attach('avif-brush-portability',{body:JSON.stringify(result),contentType:'application/json'});
});

test('AVIF native 50 MP application imports, saves, reopens and exports every pixel independently',async({page},info)=>{
  test.setTimeout(300000);await page.goto('/');const result=await page.evaluate(async bytes=>{
    const {editor}=window.luma,hash=async(blob:Blob)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].join(',');let complete=false;
    const start=performance.now();await editor.openAvif(new File([new Uint8Array(bytes)],'Native 50 MP.avif',{type:'image/avif'}),{},{onProgress:value=>{if(value.phase==='decoding'&&value.fraction===1)complete=true;}});
    const importMs=performance.now()-start,model=JSON.stringify(editor.document.toJSON()),source=editor.assetStore.values()[0],original=await hash(source.blob),project=await editor.saveProject();
    await editor.openProject(new File([project],'native-avif.luma'));const restored=editor.assetStore.values()[0];
    Object.assign(window,{nativeAvifPng:await editor.exportPng()});return{importMs,complete,size:[editor.document.width,editor.document.height],settings:restored.avif,sameOriginal:original===await hash(restored.blob),sameModel:model===JSON.stringify(editor.document.toJSON())};
  },[...await readFile(base+'native-50mp.avif')]);
  expect(result).toMatchObject({complete:true,size:[10000,5000],settings:{allowPrecisionLoss:false,assumeSrgb:false},sameOriginal:true,sameModel:true});
  const pending=page.waitForEvent('download');await page.evaluate(()=>{const anchor=document.createElement('a');anchor.href=URL.createObjectURL((window as unknown as {nativeAvifPng:Blob}).nativeAvifPng);anchor.download='native-avif.png';anchor.click();setTimeout(()=>URL.revokeObjectURL(anchor.href),1000);});
  const path=info.outputPath('native-avif.png');await(await pending).saveAs(path);
  const checked=spawnSync('python3',['-c',"from PIL import Image,ImageChops;import sys,json,hashlib;a=Image.open(sys.argv[1]).convert('RGBA');b=Image.open(sys.argv[2]).convert('RGBA');assert a.size==b.size==(10000,5000);ext=ImageChops.difference(a,b).getextrema();assert max(x[1] for x in ext)==0,ext;print(json.dumps(dict(width=a.width,height=a.height,maximumDifference=0,rgbaSha256=hashlib.sha256(a.tobytes()).hexdigest())))",path,base+'native-50mp.png'],{encoding:'utf8',timeout:120000});
  expect(checked.status,checked.stderr).toBe(0);await info.attach('avif-native-application-50mp',{body:JSON.stringify({runtime:result,independent:JSON.parse(checked.stdout)}),contentType:'application/json'});
});
