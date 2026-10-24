import {test,expect} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
import type {Document} from '../src/dom';
import type {AssetStore,ImageAsset} from '../src/core/assets';
import {tiffPagesWorkflow} from './helpers/tiff-pages';
test('ordered open-document TIFF pages preserve independent geometry and every channel through normal UI',async({page},info)=>{await tiffPagesWorkflow(page,info);});

for(const action of ['remove-future-source','cancel-after-last-tile','throw-progress','change-captured-document','remove-future-font'] as const){
 test('multipage export captures every dependency and cleans up after '+action,async({page},info)=>{
  await page.goto('/');
  const fontBytes=action==='remove-future-font'?[...await readFile('node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2')]:[];
  const result=await page.evaluate(async({action,fontBytes})=>{
   const {editor,RasterLayer,TextLayer}=window.luma;
   const owners:{doc:Document;assets:AssetStore;asset:ImageAsset}[]=[];
   for(const color of ['#ff0000','#0000ff']){
    editor.newDocument({width:16,height:16});const doc=editor.document,assets=editor.assetStore;
    const canvas=document.createElement('canvas');canvas.width=canvas.height=16;const ctx=canvas.getContext('2d')!;ctx.fillStyle=color;ctx.fillRect(0,0,16,16);
    const blob=await new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!))),asset=await assets.add(blob,color,undefined,false);
    doc.layers.add(new RasterLayer({assetId:asset.id,width:16,height:16}));owners.push({doc,assets,asset});
   }
   let font:FontFace|undefined;
   if(action==='remove-future-font'){
    font=new FontFace('TIFF Future Page Font',new Uint8Array(fontBytes));await font.load();document.fonts.add(font);
    owners[1].doc.layers.add(new TextLayer({text:'A',fontFamily:'"TIFF Future Page Font", monospace',fontSize:12}));await document.fonts.ready;
   }
   const before=owners.map(owner=>JSON.stringify(owner.doc.toJSON())),renderer=editor.renderer,render=renderer.render.bind(renderer),surfaces:HTMLCanvasElement[]=[],abort=new AbortController();
   renderer.render=async(...args)=>{const tile=await render(...args);surfaces.push(tile);return tile;};
   let changed=false,fontRemoved:boolean|undefined,blob:Blob|undefined,error='';
   try{
    blob=(await editor.exportTiffPages(owners.map(owner=>owner.doc),{}, {signal:abort.signal,onProgress:progress=>{
     const atEnd=action==='cancel-after-last-tile'||action==='throw-progress';
     if(changed||progress.phase!=='rendering'||(atEnd?progress.fraction!==1:progress.fraction!==0))return;changed=true;
     if(action==='remove-future-source')owners[1].assets.remove(owners[1].asset.id);
     else if(action==='cancel-after-last-tile')abort.abort(new Error('Stopped after the final tile'));
     else if(action==='throw-progress')throw Error('Progress callback failed');
     else if(action==='change-captured-document')owners[1].doc.layers.at(0)!.opacity=.25;
     else fontRemoved=document.fonts.delete(font!);
    }})).blob;
   }catch(cause){error=String(cause);}finally{renderer.render=render;if(font)document.fonts.add(font);}
   return{changed,fontRemoved,error,returned:!!blob,bytes:blob?[...new Uint8Array(await blob.arrayBuffer())]:null,released:surfaces.every(tile=>tile.width===0&&tile.height===0),unchanged:owners.map((owner,i)=>JSON.stringify(owner.doc.toJSON())===before[i]),calls:surfaces.length};
  },{action,fontBytes});
  if(action==='change-captured-document'){
   expect(result.returned).toBe(true);expect(result.unchanged).toEqual([true,false]);
   const path=info.outputPath('snapshot.tif');await writeFile(path,Buffer.from(result.bytes!));
   const check=spawnSync('python3',['-c',"from PIL import Image;import sys;i=Image.open(sys.argv[1]);i.seek(1);assert i.convert('RGBA').getpixel((8,8))==(0,0,255,255)",path],{encoding:'utf8'});expect(check.status,check.stderr).toBe(0);
  }else{expect(result.returned).toBe(false);expect(result.unchanged).toEqual([true,true]);expect(result.error).toMatch(/source changed|Stopped after|callback failed|font.*changed/i);}
  if(action==='remove-future-font'){expect(result.fontRemoved).toBe(true);expect(result.calls).toBe(0);}
  expect(result.changed).toBe(true);expect(result.released).toBe(true);
 });
}

test('closing a selected inactive page rejects while a native render is pending',async({page})=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const {editor,PaintLayer,PaintFill}=window.luma;const docs=[];
  for(let i=0;i<2;i++){editor.newDocument({width:16,height:16});const doc=editor.document;doc.layers.add(new PaintLayer()).strokes.add(new PaintFill({bounds:{x:0,y:0,width:16,height:16},color:'#ff0000'}));docs.push(doc);}
  editor.activateDocument(docs[0]);
  let resume!:()=>void,entered!:()=>void;const ready=new Promise<void>(resolve=>{entered=resolve;}),hold=new Promise<void>(resolve=>{resume=resolve;});
  const renderer=editor.renderer,render=renderer.render.bind(renderer),surfaces:HTMLCanvasElement[]=[];renderer.render=async(...args)=>{const tile=await render(...args);surfaces.push(tile);entered();await hold;return tile;};
  const pending=editor.exportTiffPages(docs).then(()=>'Unexpected success',cause=>String(cause));
  try{await ready;await editor.closeDocument(docs[1],{discardChanges:true});resume();return{error:await pending,released:surfaces.every(tile=>tile.width===0&&tile.height===0)};}finally{resume();renderer.render=render;}
 });expect(result.error).toMatch(/closed during export|asset store|disposed/i);expect(result.released).toBe(true);
});

test('a genuine 50 MP RAW page retains its original and every native sample in a two-page BigTIFF',async({page},info)=>{
 test.setTimeout(480000);
 const input=info.outputPath('tiff-book-50mp.dng');await writeFile(input,gunzipSync(await readFile('tests/fixtures/raw/native-50mp.dng.gz')));
 await page.goto('/');await page.getByTestId('import-input').setInputFiles(input);const review=page.getByRole('dialog',{name:'Import camera RAW',exact:true});
 await review.getByRole('checkbox',{name:'Convert RAW development to 8-bit editing precision',exact:true}).check();await review.getByRole('button',{name:'Import RAW image',exact:true}).click();await expect(review).toHaveCount(0,{timeout:180000});
 const result=await page.evaluate(async()=>{
  const {editor,PaintLayer,PaintFill}=window.luma,raw=editor.document,source=editor.assetStore.values().find(asset=>asset.raw)!,original=source.raw!.originalBlob;
  editor.newDocument({name:'Small first page',width:64,height:32});const small=editor.document;small.layers.add(new PaintLayer()).strokes.add(new PaintFill({bounds:{x:0,y:0,width:64,height:32},color:'#ff0000'}));
  const png=await editor.exportPng(),before=[small,raw].map(doc=>JSON.stringify(doc.getSnapshot())),active=editor.document;
  const result=await editor.exportTiffPages([small,raw],{variant:'big'});
  const retained=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await original.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('');
  (window as any).multipageLargeBlobs={tiff:result.blob,png};
  return{originalBytes:original.size,originalSha256:retained,unchanged:[small,raw].every((doc,i)=>JSON.stringify(doc.getSnapshot())===before[i]),activeUnchanged:editor.document===active};
 });
 expect(result).toEqual({originalBytes:100000672,originalSha256:'cfe25bed379735dfea685695e956838b284106e6527e6aff77e3901ef6ef9d85',unchanged:true,activeUnchanged:true});
 const files:Record<string,string>={};
 for(const key of ['png','tiff']){const pending=page.waitForEvent('download'),path=info.outputPath('tiff-book-50mp.'+(key==='png'?'png':'tif'));await page.evaluate(key=>{const a=document.createElement('a'),blob=(window as any).multipageLargeBlobs[key];a.href=URL.createObjectURL(blob);a.download='book.'+(key==='png'?'png':'tif');a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);},key);await(await pending).saveAs(path);files[key]=path;}
 const manifest=info.outputPath('tiff-book-50mp.json');await writeFile(manifest,JSON.stringify([{path:files.tiff,bigTiff:true,pages:[{referencePng:files.png},{referencePng:'tests/fixtures/raw/native-50mp.png'}]}]));
 const checked=spawnSync('python3',['scripts/check-tiff-pages.py',manifest],{encoding:'utf8',timeout:180000});expect(checked.status,checked.stdout+checked.stderr).toBe(0);await info.attach('multipage-50mp-oracle.json',{body:checked.stdout,contentType:'application/json'});
});

test('two open copies with colliding persisted document and asset IDs render their own source generations',async({page},info)=>{
 await page.goto('/');await expect(page.getByRole('button',{name:'History',exact:true})).toBeVisible();
 const result=await page.evaluate(async()=>{
  const{editor,RasterLayer}=window.luma;editor.newDocument({width:16,height:16});const first=editor.document;
  const image=async(color:string)=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=16;const ctx=canvas.getContext('2d')!;ctx.fillStyle=color;ctx.fillRect(0,0,16,16);return new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!)));};
  const asset=await editor.assetStore.add(await image('#ff0000'),'Red',undefined,false);first.layers.add(new RasterLayer({assetId:asset.id,width:16,height:16}));
  const project=await editor.saveProject();await editor.openProject(new File([project],'Copy.luma'));const second=editor.document;editor.assetStore.remove(asset.id);await editor.assetStore.add(await image('#0000ff'),'Blue',asset.id,false);
  const result=await editor.exportTiffPages([second,first],{variant:'big'});
  return{sameId:first.id===second.id,differentOwners:first!==second,bytes:[...new Uint8Array(await result.blob.arrayBuffer())]};
 });expect(result.sameId).toBe(true);expect(result.differentOwners).toBe(true);const path=info.outputPath('colliding-owners.tif');await writeFile(path,Buffer.from(result.bytes));
 const checked=spawnSync('python3',['-c',"from PIL import Image;import sys;i=Image.open(sys.argv[1]);assert i.n_frames==2;assert i.convert('RGBA').getpixel((8,8))==(0,0,255,255);i.seek(1);assert i.convert('RGBA').getpixel((8,8))==(255,0,0,255)",path],{encoding:'utf8'});expect(checked.status,checked.stderr).toBe(0);
});

test('the documented trusted-host page example runs against actual owned documents',async({page},info)=>{
 const guide=await readFile('docs/TIFF_PAGES.md','utf8'),source=guide.match(/```js\n([\s\S]*?)```/)![1];
 await page.goto('/');await expect(page.getByRole('button',{name:'History',exact:true})).toBeVisible();
 const result=await page.evaluate(async source=>{
  const value=await new Function('editor',`return(async()=>{${source}\nreturn{result,pages};})();`)(window.luma.editor);
  return{dimensions:value.pages.map((doc:Document)=>[doc.width,doc.height]),bytes:[...new Uint8Array(await value.result.blob.arrayBuffer())]};
 },source);
 expect(result.dimensions).toEqual([[640,480],[400,300]]);const path=info.outputPath('documented-tiff-pages.tif');await writeFile(path,Buffer.from(result.bytes));
 const checked=spawnSync('python3',['-c',"from PIL import Image;import sys;i=Image.open(sys.argv[1]);assert i.n_frames==2;assert i.size==(640,480);i.seek(1);assert i.size==(400,300)",path],{encoding:'utf8'});expect(checked.status,checked.stderr).toBe(0);
});

test('the page picker retains closed selections, offers new tabs unchecked and exports an inactive selected owner',async({page},info)=>{
 await page.goto('/');await expect(page.getByRole('button',{name:'History',exact:true})).toBeVisible();
 await page.evaluate(()=>{const{editor,PaintLayer,PaintFill}=window.luma;for(const [name,color]of [['First','#ff0000'],['Second','#0000ff']]){editor.newDocument({name,width:16,height:16});editor.document.layers.add(new PaintLayer()).strokes.add(new PaintFill({bounds:{x:0,y:0,width:16,height:16},color}));}});
 await page.getByRole('button',{name:'Export…',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Export Document',exact:true});await dialog.getByLabel('Format',{exact:true}).selectOption('tiff');await dialog.getByLabel('TIFF pages',{exact:true}).selectOption('pages');
 await page.evaluate(()=>window.luma.editor.newDocument({name:'New active tab',width:32,height:24}));
 await expect(dialog.getByRole('checkbox',{name:'Include New active tab (open document 3) as TIFF page',exact:true})).not.toBeChecked();
 await page.evaluate(async()=>{const editor=window.luma.editor;await editor.closeDocument(editor.openDocuments[0],{discardChanges:true});});
 await expect(dialog).toContainText('Closed document — remove this page');await expect(dialog.getByRole('button',{name:'Export .tif',exact:true})).toBeDisabled();
 await dialog.getByRole('button',{name:'Remove TIFF page 1',exact:true}).click();await expect(dialog).not.toContainText('Closed document — remove this page');
 const pending=page.waitForEvent('download'),path=info.outputPath('inactive-selected-page.tif');await dialog.getByRole('button',{name:'Export .tif',exact:true}).click();await(await pending).saveAs(path);
 expect(await page.getByRole('textbox',{name:'Document name',exact:true}).inputValue()).toBe('New active tab');
 const checked=spawnSync('python3',['-c',"from PIL import Image;import sys;i=Image.open(sys.argv[1]);assert i.n_frames==1 and i.size==(16,16);assert i.convert('RGBA').getpixel((8,8))==(0,0,255,255)",path],{encoding:'utf8'});expect(checked.status,checked.stderr).toBe(0);
});
