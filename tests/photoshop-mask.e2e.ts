import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

const directory='tests/fixtures/psd/masks/';
const fixtures=JSON.parse(readFileSync(directory+'manifest.json','utf8')).cases as {
 file:string;reference:string;width:number;height:number;layerWidth:number;layerHeight:number;maskWidth:number;maskHeight:number;
 empty:boolean;feather:number;relative:boolean;
}[];

test('standalone Photoshop vector masks disable unsupported layers and preserve the supplied merged image',async({page})=>{
 await page.goto('/');await page.getByTestId('psd-input').setInputFiles(directory+'vector-only.psd');const dialog=page.locator('.psd-import-dialog');await expect(dialog.locator('.psd-meta-card')).toBeVisible();
 await expect(dialog).toContainText('Photoshop vector masks');await expect(dialog.locator('input[value="layered"]')).toBeDisabled();
 await dialog.getByRole('button',{name:'Import Flattened',exact:true}).click();await expect(dialog).not.toBeVisible();
 const alpha=await page.evaluate(async()=>{const {editor}=window.luma,image=await createImageBitmap(await editor.exportPng()),canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const c=canvas.getContext('2d')!;c.drawImage(image,0,0);image.close();return[...c.getImageData(0,0,canvas.width,canvas.height).data].every(value=>value===0);});expect(alpha).toBe(true);
});

for(const fixture of fixtures) test(`Photoshop pixel mask ${fixture.file} retains independent coverage and editable native sources`,async({page},info)=>{
 test.setTimeout(240000);await page.goto('/');await page.getByTestId('psd-input').setInputFiles(directory+fixture.file);
 const dialog=page.locator('.psd-import-dialog');await expect(dialog.locator('.psd-meta-card')).toBeVisible();
 if(fixture.feather){await expect(dialog.locator('input[value="layered"]')).toBeDisabled();await expect(dialog).toContainText('Photoshop mask feathering');}
 else await dialog.locator('input[value="layered"]').check();
 await dialog.getByRole('button',{name:fixture.feather?'Import Flattened':'Import Layers',exact:true}).click();await expect(dialog).not.toBeVisible({timeout:fixture.width*fixture.height===50_000_000?120000:5000});
 const state=await page.evaluate(async({empty,feather})=>{
  const {editor}=window.luma,doc=editor.document,layer=doc.layers.at(0)!,mask=layer.mask;
  const hashes=async()=> (await Promise.all(editor.assetStore.values().map(async asset=>[asset.id,[...new Uint8Array(await crypto.subtle.digest('SHA-256',await asset.blob.arrayBuffer()))].join()]))).sort(([a],[b])=>a.localeCompare(b));
  const before=JSON.stringify(doc.toJSON()),sourceHashes=await hashes();
  if(mask){doc.transaction('Edit imported mask',()=>{layer.mask=mask.with({enabled:!mask.enabled,density:.25});layer.x+=1;});doc.undo();}
  const exactUndo=before===JSON.stringify(doc.toJSON());
  const saved=await editor.saveProject();await editor.openProject(new File([saved],'masked.luma'));
  const reopened=editor.document.layers.at(0)!,source=editor.assetStore.get((reopened.toJSON() as {assetId:string}).assetId);
  const reopenedHashes=await hashes();
  return{kind:mask?.kind??null,sourceSize:[source.width,source.height],maskSize:reopened.mask?.assetId?[editor.assetStore.get(reopened.mask.assetId).width,editor.assetStore.get(reopened.mask.assetId).height]:null,
    assetCount:editor.assetStore.values().length,exactUndo,exactModel:before===JSON.stringify(editor.document.toJSON()),exactSources:JSON.stringify(sourceHashes)===JSON.stringify(reopenedHashes),expectedCount:feather||empty?1:2};
 },{empty:fixture.empty,feather:fixture.feather});
 expect(state.kind).toBe(fixture.feather?null:fixture.empty?'paint':'bitmap');expect(state.assetCount).toBe(state.expectedCount);
 expect(state.sourceSize).toEqual(fixture.feather?[fixture.width,fixture.height]:[fixture.layerWidth,fixture.layerHeight]);
 if(!fixture.feather&&!fixture.empty)expect(state.maskSize).toEqual([fixture.maskWidth,fixture.maskHeight]);
 expect(state.exactUndo).toBe(true);expect(state.exactModel).toBe(true);expect(state.exactSources).toBe(true);
 const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Export PNG',exact:true}).click();const path=info.outputPath('masked.png');await(await pending).saveAs(path);
 const checked=spawnSync('python3',['-c',"from PIL import Image;import numpy as np,sys;a=Image.open(sys.argv[1]).convert('RGBA');b=Image.open(sys.argv[2]).convert('RGBA');assert a.size==b.size\nfor y in range(0,a.height,64):\n box=(0,y,a.width,min(a.height,y+64));assert np.array_equal(np.asarray(a.crop(box)),np.asarray(b.crop(box))),y\nprint('Every native mask output pixel equals the independent source-grid reference')",path,directory+fixture.reference],{encoding:'utf8',timeout:120000});
 expect(checked.status,checked.stderr).toBe(0);await info.attach('photoshop-mask-native',{body:JSON.stringify({fixture,state,independent:checked.stdout}),contentType:'application/json'});
});

test('Photoshop bitmap mask source validation rejects partial worker assets and retries cleanly',async({page})=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const {editor,TextLayer}=window.luma;editor.document.layers.add(new TextLayer({text:'Keep work'}));const owner=editor.document,before=JSON.stringify(owner.toJSON()),Native=window.Worker;let terminated=0,error='';
  window.Worker=new Proxy(Native,{construct(Target,args){const worker=Reflect.construct(Target,args) as Worker;if(String(args[0]).includes('photoshop-import.worker')){const stop=worker.terminate.bind(worker);worker.terminate=()=>{terminated++;stop();};worker.addEventListener('message',event=>{if(event.data.decoded)event.data.decoded.entries.pop();});}return worker;}});
  const file=await fetch('/tests/fixtures/psd/masks/white-zip.psd').then(r=>r.blob());try{await editor.openPsd(file);}catch(cause){error=String(cause);}finally{window.Worker=Native;}
  const unchanged=editor.document===owner&&before===JSON.stringify(owner.toJSON()),assets=editor.assetStore.values().length;await editor.openPsd(file);
  return{error,terminated,unchanged,assets,retry:editor.document.layers.at(0)?.mask?.kind};
 });expect(result.error).toContain('sources do not match');expect(result.terminated).toBe(1);expect(result.unchanged).toBe(true);expect(result.assets).toBe(0);expect(result.retry).toBe('bitmap');
});

test('Photoshop mask coordinate flags control movement and relinking preserves world placement',async({page})=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const {editor}=window.luma;
  const alpha=async(x:number,y:number)=>{const bitmap=await createImageBitmap(await editor.exportPng()),canvas=document.createElement('canvas');canvas.width=canvas.height=1;const c=canvas.getContext('2d')!;c.drawImage(bitmap,x,y,1,1,0,0,1,1);bitmap.close();return c.getImageData(0,0,1,1).data[3];};
  await editor.openPsd(await fetch('/tests/fixtures/psd/masks/relative-prediction.psd').then(r=>r.blob()));const layer=editor.document.layers.at(0)!;
  const before=await alpha(10,8);layer.x+=3;const moved=await alpha(13,8);editor.document.undo();layer.setMaskLinked(false);const relinked=await alpha(10,8);layer.x+=3;const fixed=await alpha(10,8);
  return{before,moved,relinked,fixed,linked:layer.mask!.linked};
 });expect(result).toEqual({before:102,moved:102,relinked:102,fixed:102,linked:false});
});
