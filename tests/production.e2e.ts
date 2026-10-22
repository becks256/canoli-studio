import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import {encodeRgbaPng} from "../src/engine/png";
import {spawnSync} from 'node:child_process';
import {readProject} from '../src/core/project';
import {readBrushContainer} from '../src/brushes/container';
test('production linked paragraph styles guide, Inspector inheritance, single-script undo and reopened native PNG agree',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('/');expect(await page.evaluate(()=>'luma'in window)).toBe(false);
  const download=async(action:()=>Promise<unknown>,name:string)=>{const pending=page.waitForEvent('download');await action();const path=info.outputPath(name);await(await pending).saveAs(path);return path;};
  const project=async(name:string)=>{const path=await download(()=>page.getByRole('button',{name:'Save project',exact:true}).click(),name);return{path,value:await readProject(new Blob([new Uint8Array(await readFile(path))]))};};
  const script=async(code:string)=>{
    await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();await page.getByLabel('Script code',{exact:true}).fill(code);
    await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByRole('button',{name:'Run script',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Close scripts',exact:true}).click();
  };
  await script('document.resize(600,300);');const before=await project('paragraph-styles-before.luma');
  const guide=await readFile('docs/SCRIPTING_API.md','utf8'),code=guide.match(/<!-- example: paragraph-styles -->\s*```js\n([\s\S]*?)\n```/)?.[1];if(!code)throw new Error('Missing paragraph styles guide');
  await script(code);const authored=await project('paragraph-styles-authored.luma'),doc=authored.value.document;
  expect(doc.schemaVersion).toBe(40);expect(doc.paragraphStyles).toHaveLength(1);expect(doc.paragraphStyles![0]).toMatchObject({name:'Body',format:{fontSize:28,paragraphSpacing:10}});
  expect(doc.children).toHaveLength(2);for(const layer of doc.children){if(layer.kind!=='text')throw new Error('Expected text');expect(layer.paragraphStyle?.id).toBe(doc.paragraphStyles![0].id);expect(layer.fontSize).toBe(28);expect(layer.wrapWidth).toBe(240);}
  expect((doc.children[1]as any).paragraphStyle.overrides).toEqual({color:'#a43e29'});
  const section=page.getByRole('region',{name:'Paragraph styles',exact:true}),size=page.getByRole('spinbutton',{name:'Font size',exact:true});
  await size.fill('36');await size.press('Enter');await expect(section.getByRole('status')).toContainText('1 local override');
  await section.getByRole('button',{name:'Update style from text',exact:true}).click();const updated=await project('paragraph-styles-updated.luma');
  expect(updated.value.document.paragraphStyles![0].format.fontSize).toBe(36);expect(updated.value.document.children.map(layer=>layer.kind==='text'?layer.fontSize:null)).toEqual([36,36]);
  expect((updated.value.document.children[1]as any).paragraphStyle.overrides).toEqual({color:'#a43e29'});
  await section.getByRole('button',{name:'Reset style overrides',exact:true}).click();await expect(section.getByRole('status')).toContainText('Follows all style settings');
  await section.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('paragraph-styles-inspector.png')});
  await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
  for(let i=0;i<3;i++)await page.keyboard.press('Control+z');expect((await project('paragraph-styles-restored.luma')).value.document).toEqual(doc);
  const png=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),'paragraph-styles.png');
  await page.keyboard.press('Control+z');expect((await project('paragraph-styles-undone.luma')).value.document).toEqual(before.value.document);
  await page.keyboard.press('Control+Shift+z');await page.reload();expect(await page.evaluate(()=>'luma'in window)).toBe(false);
  await page.getByTestId('project-input').setInputFiles(authored.path);await expect(page.locator('.layer-row')).toHaveCount(2);await page.getByRole('button',{name:'Select Body first',exact:true}).click();
  await expect(section.getByRole('status')).toContainText('Linked to Body');await expect(size).toHaveValue('28');
  const reopened=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),'paragraph-styles-reopened.png');
  const checked=spawnSync(process.env.CANOLI_PSB_PYTHON??'python3',['-c',
    'from PIL import Image;from collections import Counter;import json,sys;a=Image.open(sys.argv[1]).convert("RGBA");b=Image.open(sys.argv[2]).convert("RGBA");assert a.size==b.size==(600,300);assert a.tobytes()==b.tobytes();left=Counter(a.crop((24,24,264,280)).getdata());right=Counter(a.crop((300,24,540,280)).getdata());assert left[(49,91,42,255)]>100;assert right[(164,62,41,255)]>100;print(json.dumps({"completePixels":600*300,"pngsIdentical":True,"greenInteriorPixels":left[(49,91,42,255)],"redInteriorPixels":right[(164,62,41,255)]}))',png,reopened],{encoding:'utf8'});
  expect(checked.status,checked.stderr).toBe(0);expect(errors).toEqual([]);await info.attach('paragraph-styles-independent',{body:checked.stdout,contentType:'application/json'});
});

test('production bilateral denoise guide, exact Inspector edits, undo and reopened native pixels match independent equations',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('/');expect(await page.evaluate(()=>'luma'in window)).toBe(false);
  const download=async(action:()=>Promise<unknown>,name:string)=>{const pending=page.waitForEvent('download');await action();const path=info.outputPath(name);await(await pending).saveAs(path);return path;};
  const project=async(name:string)=>{const path=await download(()=>page.getByRole('button',{name:'Save project',exact:true}).click(),name);return{path,value:await readProject(new Blob([new Uint8Array(await readFile(path))]))};};
  const pixels=new Uint8Array(96*64*4);let seed=7319841;
  for(let y=0;y<64;y++)for(let x=0;x<96;x++){
    const p=(y*96+x)*4,color=x<48?[60,85,110]:[185,210,235];
    for(let c=0;c<3;c++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;pixels[p+c]=color[c]+((seed>>>24)%25)-12;}pixels[p+3]=255;
  }
  const source=Buffer.from(await(await encodeRgbaPng(pixels,96,64)).arrayBuffer());
  await page.getByTestId('import-input').setInputFiles({name:'Fine noise.png',mimeType:'image/png',buffer:source});await expect(page.locator('.layer-row')).toHaveCount(1);
  const script=async(code:string)=>{
    await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();await page.getByLabel('Script code',{exact:true}).fill(code);
    await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByRole('button',{name:'Run script',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Close scripts',exact:true}).click();
  };
  await script('document.resize(96,64);document.selectedLayer.x=0;document.selectedLayer.y=0;document.selectedLayer.name="Fine noise";');const before=await project('bilateral-before.luma');
  const guide=await readFile('docs/SCRIPTING_API.md','utf8'),code=guide.match(/<!-- example: bilateral-denoise -->\s*```js\n([\s\S]*?)\n```/)?.[1];if(!code)throw new Error('Missing bilateral guide');
  await script(code);const authored=await project('bilateral-authored.luma'),layer=authored.value.document.children[0];
  expect(authored.value.document.schemaVersion).toBe(40);if(layer.kind!=='smart-object')throw new Error('Missing smart object');
  expect(layer.smartFilters?.[0]).toMatchObject({kind:'bilateral-denoise',radius:3,colorSigma:20,amount:.75});
  expect(authored.value.entries).toHaveLength(1);expect(Buffer.from(await authored.value.entries[0].blob.arrayBuffer())).toEqual(source);
  const card=page.getByRole('group',{name:'Bilateral denoise filter 1',exact:true}),number=card.getByRole('spinbutton',{name:'Denoise radius value',exact:true});
  await number.scrollIntoViewIfNeeded();await page.keyboard.press('Control+0');await page.screenshot({path:info.outputPath('bilateral-inspector.png')});
  await expect(card.getByRole('spinbutton',{name:'Color tolerance value',exact:true})).toHaveValue('20');await expect(card.getByRole('spinbutton',{name:'Denoise strength value',exact:true})).toHaveValue('0.75');
  await number.fill('5');await number.press('Enter');await expect(number).toHaveValue('5');
  await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();await page.keyboard.press('Control+z');await expect(number).toHaveValue('3');
  await page.keyboard.press('Control+z');expect((await project('bilateral-undone.luma')).value.document).toEqual(before.value.document);
  await page.keyboard.press('Control+Shift+z');await page.getByRole('button',{name:'Select Fine noise',exact:true}).click();await expect(card).toBeVisible();
  const png=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),'bilateral.png');
  await page.reload();expect(await page.evaluate(()=>'luma'in window)).toBe(false);await page.getByTestId('project-input').setInputFiles(authored.path);await expect(page.locator('.layer-row')).toHaveCount(1);
  await page.getByRole('button',{name:'Select Fine noise',exact:true}).click();await expect(number).toHaveValue('3');
  const reopened=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),'bilateral-reopened.png');
  const checked=spawnSync(process.env.CANOLI_PSB_PYTHON??'python3',['tests/helpers/bilateral-reference.py',authored.path,png,reopened],{encoding:'utf8'});
  expect(checked.status,checked.stderr).toBe(0);expect(errors).toEqual([]);await info.attach('bilateral-independent',{body:checked.stdout,contentType:'application/json'});
});

test('production median denoise guide, Inspector, source bytes, undo and reopened PNG agree without developer globals',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('/');expect(await page.evaluate(()=>'luma'in window)).toBe(false);
  const download=async(action:()=>Promise<unknown>,name:string)=>{const pending=page.waitForEvent('download');await action();const path=info.outputPath(name);await(await pending).saveAs(path);return path;};
  const project=async(name:string)=>{const path=await download(()=>page.getByRole('button',{name:'Save project',exact:true}).click(),name);return{path,value:await readProject(new Blob([new Uint8Array(await readFile(path))]))};};
  const pixels=new Uint8Array(96*64*4);for(let i=0;i<pixels.length;i+=4)pixels.set([70,100,130,255],i);
  pixels.set([255,255,255,255],(32*96+32)*4);pixels.set([0,0,0,255],(32*96+64)*4);
  const source=Buffer.from(await(await encodeRgbaPng(pixels,96,64)).arrayBuffer());
  await page.getByTestId('import-input').setInputFiles({name:'Speckles.png',mimeType:'image/png',buffer:source});await expect(page.locator('.layer-row')).toHaveCount(1);
  const script=async(code:string)=>{
    await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();await page.getByLabel('Script code',{exact:true}).fill(code);
    await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByRole('button',{name:'Run script',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Close scripts',exact:true}).click();
  };
  await script('document.resize(96,64);document.selectedLayer.x=0;document.selectedLayer.y=0;document.selectedLayer.name="Speckles";');const before=await project('median-before.luma');
  const guide=await readFile('docs/SCRIPTING_API.md','utf8'),code=guide.match(/<!-- example: median-denoise -->\s*```js\n([\s\S]*?)\n```/)?.[1];if(!code)throw new Error('Missing median guide');
  await script(code);const authored=await project('median-authored.luma'),layer=authored.value.document.children[0];
  expect(authored.value.document.schemaVersion).toBe(40);if(layer.kind!=='smart-object')throw new Error('Missing smart object');expect(layer.smartFilters?.[0]).toMatchObject({kind:'median',radius:1});
  expect(authored.value.entries).toHaveLength(1);expect(Buffer.from(await authored.value.entries[0].blob.arrayBuffer())).toEqual(source);
  const card=page.getByRole('group',{name:'Median denoise filter 1',exact:true}),number=card.getByRole('spinbutton',{name:'Denoise radius value',exact:true});
  await number.scrollIntoViewIfNeeded();await page.keyboard.press('Control+0');
  await page.screenshot({path:info.outputPath('median-inspector.png')});
  await number.fill('3');await number.press('Enter');await expect(number).toHaveValue('3');
  await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();await page.keyboard.press('Control+z');await expect(number).toHaveValue('1');
  await page.keyboard.press('Control+z');expect((await project('median-undone.luma')).value.document).toEqual(before.value.document);await page.keyboard.press('Control+Shift+z');await page.getByRole('button',{name:'Select Speckles',exact:true}).click();await expect(card).toBeVisible();
  const png=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),'median.png');
  await page.reload();expect(await page.evaluate(()=>'luma'in window)).toBe(false);await page.getByTestId('project-input').setInputFiles(authored.path);await expect(page.locator('.layer-row')).toHaveCount(1);
  await page.getByRole('button',{name:'Select Speckles',exact:true}).click();await expect(number).toHaveValue('1');
  const reopened=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),'median-reopened.png');
  const checked=spawnSync(process.env.CANOLI_PSB_PYTHON??'python3',['-c',
    'from PIL import Image;import sys;a=Image.open(sys.argv[1]).convert("RGBA");b=Image.open(sys.argv[2]).convert("RGBA");assert a.size==b.size==(96,64);assert a.tobytes()==b.tobytes();assert set(a.getdata())=={(70,100,130,255)};print("Complete native PNG and independent impulse-noise checks passed")',png,reopened],{encoding:'utf8'});
  expect(checked.status,checked.stderr).toBe(0);expect(errors).toEqual([]);await info.attach('median-independent',{body:checked.stdout,contentType:'text/plain'});
});

test('production documented wet mask preserves prepared alpha, editable geometry, source bytes and one undo without globals',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('/');expect(await page.evaluate(()=>'luma'in window)).toBe(false);
 const download=async(action:()=>Promise<unknown>,name:string)=>{const pending=page.waitForEvent('download');await action();const path=info.outputPath(name);await(await pending).saveAs(path);return path;};
 const project=async(name:string)=>{const path=await download(()=>page.getByRole('button',{name:'Save project',exact:true}).click(),name);return{path,value:await readProject(new Blob([new Uint8Array(await readFile(path))]))};};
 const output=Buffer.from(await(await encodeRgbaPng(new Uint8Array([255,255,255,128]),1,1)).arrayBuffer()),coverage=Buffer.from(await(await encodeRgbaPng(new Uint8Array([255,255,255,255]),1,1)).arrayBuffer());
 for(const [name,buffer] of [['Wet output.png',output],['Wet coverage.png',coverage]] as const){await page.getByTestId('import-input').setInputFiles({name,mimeType:'image/png',buffer});await expect(page.locator('.layer-row')).toHaveCount(name==='Wet output.png'?1:2);}
 const before=await project('before.luma'),guide=await readFile('docs/SCRIPTING_API.md','utf8'),code=guide.match(/<!-- example: wet-mask-prepared -->\s*```js\n([\s\S]*?)\n```/)?.[1];if(!code)throw new Error('Missing prepared mask guide example');
 await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();await page.getByLabel('Script code',{exact:true}).fill("document.resize(16,16);for(const layer of document.layers){layer.name=layer.name.replace('.png','');layer.visible=false;}\n"+code);await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('Prepared mask ready');await page.getByRole('button',{name:'Close scripts',exact:true}).click();
 const saved=await project('prepared-mask.luma'),layer=saved.value.document.children.at(-1);expect(saved.value.document.schemaVersion).toBe(40);if(layer?.kind!=='paint'||layer.mask?.kind!=='paint'||layer.mask.strokes[0]?.mode!=='wet')throw new Error('Missing editable prepared mask');expect(layer.strokes).toHaveLength(1);expect(saved.value.entries).toHaveLength(2);
 const originals=await Promise.all(saved.value.entries.map(async entry=>Buffer.from(await entry.blob.arrayBuffer())));expect(originals.some(bytes=>bytes.equals(output))).toBe(true);expect(originals.some(bytes=>bytes.equals(coverage))).toBe(true);
 const png=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),'mask.png');await page.keyboard.press('Control+z');expect((await project('undo.luma')).value.document).toEqual(before.value.document);await page.reload();expect(await page.evaluate(()=>'luma'in window)).toBe(false);await page.getByTestId('project-input').setInputFiles(saved.path);await expect(page.locator('.layer-row')).toHaveCount(3);const reopened=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),'reopened.png');
 const checked=spawnSync('python3',['-c',"from PIL import Image;import numpy as np,sys;a=np.asarray(Image.open(sys.argv[1]).convert('RGBA'));b=np.asarray(Image.open(sys.argv[2]).convert('RGBA'));assert a.shape==b.shape==(16,16,4);assert np.array_equal(a,b);assert a[4,4,3]==128;assert a[0,0,3]==255;assert np.max(np.abs(a[4,4,:3].astype(float)*128/255-np.array([42,89,104])*128/255))<=1;print('Prepared mask alpha and all project-reopened PNG pixels match')",png,reopened],{encoding:'utf8',timeout:30000});expect(checked.status,checked.stderr||checked.stdout).toBe(0);expect(errors).toEqual([]);await info.attach('production-prepared-wet-mask',{body:JSON.stringify({schema:40,noDeveloperGlobal:true,sourceBytesExact:true,oneStepUndo:true,independent:checked.stdout}),contentType:'application/json'});
});

test('production Mixer mask target changes only coverage with exact undo and project-reopened native pixels',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('/');expect(await page.evaluate(()=>'luma'in window)).toBe(false);
 const download=async(action:()=>Promise<unknown>,name:string)=>{const pending=page.waitForEvent('download');await action();const path=info.outputPath(name);await(await pending).saveAs(path);return path;};
 const project=async(name:string)=>{const path=await download(()=>page.getByRole('button',{name:'Save project',exact:true}).click(),name);return{path,value:await readProject(new Blob([new Uint8Array(await readFile(path))]))};};
 const sourcePixels=new Uint8Array(128*96*4);for(let p=0;p<sourcePixels.length;p+=4)sourcePixels.set([0,0,255,255],p);const source=Buffer.from(await(await encodeRgbaPng(sourcePixels,128,96)).arrayBuffer());await page.getByTestId('import-input').setInputFiles({name:'Mask source.png',mimeType:'image/png',buffer:source});await expect(page.locator('.layer-row')).toHaveCount(1);
 await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();await page.getByLabel('Script code',{exact:true}).fill("document.layers.at(0).mask=new LayerMask({base:1});print('Mask ready');");await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('Mask ready');await page.getByRole('button',{name:'Close scripts',exact:true}).click();const before=await project('before-mask.luma');
 await page.getByRole('button',{name:'Mixer brush',exact:true}).click();await page.keyboard.press('Control+1');await page.getByRole('combobox',{name:'Paint target',exact:true}).selectOption('mask-hide');await expect(page.getByLabel('Foreground color',{exact:true})).toHaveCount(0);await expect(page.getByRole('spinbutton',{name:'Initial coverage load value',exact:true})).toHaveValue('100');
 for(const [label,value] of [['Size value','8'],['Hardness value','100'],['Wetness value','0'],['Pickup value','0']] as const){const field=page.getByRole('spinbutton',{name:label,exact:true});await field.fill(value);await field.press('Enter');}await page.getByRole('checkbox',{name:'Pressure controls size',exact:true}).uncheck();
 const box=(await page.locator('.canvas-wrap').boundingBox())!;await page.mouse.move(box.x+32,box.y+40);await page.mouse.down();await page.mouse.move(box.x+64,box.y+40,{steps:8});await page.mouse.up();await expect(page.getByRole('button',{name:'Save project',exact:true})).toBeEnabled();const saved=await project('mixer-mask.luma'),layer=saved.value.document.children[0];
 expect(layer.kind).toBe('raster');expect(layer.mask?.kind).toBe('paint');expect(layer.mask?.strokes?.map(entry=>entry.mode)).toEqual(['wet']);expect(layer).not.toHaveProperty('erasures');expect(Buffer.from(await saved.value.entries.find(entry=>entry.id===(layer.kind==='raster'?layer.assetId:''))!.blob.arrayBuffer())).toEqual(source);
 const png=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),'mask-painted.png');await page.keyboard.press('Control+z');expect((await project('mask-undone.luma')).value.document).toEqual(before.value.document);await page.reload();await page.getByTestId('project-input').setInputFiles(saved.path);await expect(page.locator('.layer-row')).toHaveCount(1);const reopened=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),'mask-reopened.png');
 const checked=spawnSync('python3',['-c',"from PIL import Image;import numpy as np,sys;a=np.asarray(Image.open(sys.argv[1]).convert('RGBA'));b=np.asarray(Image.open(sys.argv[2]).convert('RGBA'));assert a.shape==b.shape==(96,128,4);assert np.array_equal(a,b);assert a[40,56,3]==0;assert a[0,0].tolist()==[0,0,255,255];print('Actual mask pointer coverage and every reopened pixel match')",png,reopened],{encoding:'utf8',timeout:30000});expect(checked.status,checked.stderr||checked.stdout).toBe(0);expect(errors).toEqual([]);await info.attach('production-mask-pointer',{body:JSON.stringify({schema:saved.value.document.schemaVersion,noDeveloperGlobal:true,oneStepUndo:true,sourceBytesExact:true,independent:checked.stdout}),contentType:'application/json'});
});

test('production Mixer gesture and saved preset preserve pixels, source bytes and one-step undo without globals',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('/');expect(await page.evaluate(()=>'luma'in window)).toBe(false);
  const download=async(action:()=>Promise<unknown>,name:string)=>{const pending=page.waitForEvent('download');await action();const path=info.outputPath(name);await(await pending).saveAs(path);return path;};
  const project=async(name:string)=>{const path=await download(()=>page.getByRole('button',{name:'Save project',exact:true}).click(),name);return{path,value:await readProject(new Blob([new Uint8Array(await readFile(path))]))};};
  const source=new Uint8Array(await(await encodeRgbaPng(new Uint8Array(128*96*4),128,96)).arrayBuffer());await page.getByTestId('import-input').setInputFiles({name:'Original transparent.png',mimeType:'image/png',buffer:Buffer.from(source)});await expect(page.locator('.layer-row')).toHaveCount(1);
  const before=await project('before.luma');await page.getByRole('button',{name:'Mixer brush',exact:true}).click();await page.keyboard.press('Control+1');
  for(const [label,value] of [['Size value','8'],['Hardness value','100'],['Wetness value','0'],['Pickup value','0']] as const){const input=page.getByRole('spinbutton',{name:label,exact:true});await input.fill(value);await input.press('Enter');}
  await page.getByLabel('Foreground color',{exact:true}).fill('#ff0000');await page.getByRole('checkbox',{name:'Pressure controls size',exact:true}).uncheck();
  await page.getByRole('button',{name:'Brush presets…',exact:true}).click();const presets=page.getByRole('dialog',{name:'Brush presets',exact:true});await presets.getByLabel('Preset name',{exact:true}).fill('Production Mixer');await presets.getByLabel('Include current foreground color',{exact:true}).check();await presets.getByRole('button',{name:'Save current as new',exact:true}).click();await expect(presets.getByRole('status')).toContainText('saved locally');await presets.getByRole('button',{name:'Close',exact:true}).click();
  const box=(await page.locator('.canvas-wrap').boundingBox())!;await page.mouse.move(box.x+32,box.y+40);await page.mouse.down();await page.mouse.move(box.x+64,box.y+40,{steps:8});await page.mouse.up();
  await expect(page.getByRole('button',{name:'Save project',exact:true})).toBeEnabled();const saved=await project('mixer.luma'),layer=saved.value.document.children[0];if(layer.kind!=='raster'||layer.erasures?.at(-1)?.stroke.kind!=='wet')throw new Error('Missing native wet pointer result');
  expect(layer.assetId).toBe(before.value.entries[0].id);expect(Buffer.from(await saved.value.entries.find(entry=>entry.id===layer.assetId)!.blob.arrayBuffer())).toEqual(Buffer.from(source));
  const png=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),'mixer.png');await page.keyboard.press('Control+z');expect((await project('undo.luma')).value.document).toEqual(before.value.document);
  await page.reload();expect(await page.evaluate(()=>'luma'in window)).toBe(false);await page.getByTestId('project-input').setInputFiles(saved.path);await expect(page.locator('.layer-row')).toHaveCount(1);const reopened=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),'reopened.png');
  await page.getByRole('button',{name:'Mixer brush',exact:true}).click();await page.getByRole('button',{name:'Brush presets…',exact:true}).click();const library=page.getByRole('dialog',{name:'Brush presets',exact:true});await library.getByRole('button',{name:/^Production Mixer Mixer brush/}).click();await library.getByRole('button',{name:'Apply preset',exact:true}).click();await expect(page.getByRole('spinbutton',{name:'Wetness value',exact:true})).toHaveValue('0');await expect(page.getByLabel('Foreground color',{exact:true})).toHaveValue('#ff0000');
  const checked=spawnSync('python3',['-c',"from PIL import Image;import numpy as np,sys;a=np.asarray(Image.open(sys.argv[1]).convert('RGBA'));b=np.asarray(Image.open(sys.argv[2]).convert('RGBA'));assert a.shape==b.shape==(96,128,4);assert np.array_equal(a,b);assert a[40,56].tolist()==[255,0,0,202];assert a[0,0].tolist()==[0,0,0,0];print('Native wet pointer pixels survive project reopen exactly')",png,reopened],{encoding:'utf8',timeout:30000});expect(checked.status,checked.stderr||checked.stdout).toBe(0);expect(errors).toEqual([]);await info.attach('production-wet-pointer',{body:JSON.stringify({schema:saved.value.document.schemaVersion,presetVersion:5,oneStepUndo:true,sourceBytesExact:true,noDeveloperGlobal:true,independent:checked.stdout}),contentType:'application/json'});
});
test('production prepared wet scripting preserves native alpha, one-step undo and project reopening without globals', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await page.goto('/'); expect(await page.evaluate(() => 'luma' in window)).toBe(false);
  const download = async (action: () => Promise<unknown>, name: string) => { const event = page.waitForEvent('download'); await action(); const path = info.outputPath(name); await (await event).saveAs(path); return path; };
  const project = async (name: string) => { const path = await download(() => page.getByRole('button', { name: 'Save project', exact: true }).click(), name); return { path, contents: await readProject(new Blob([new Uint8Array(await readFile(path))])) }; };
  const output = Buffer.from(await (await encodeRgbaPng(new Uint8Array([255, 0, 0, 128]), 1, 1)).arrayBuffer()), coverage = Buffer.from(await (await encodeRgbaPng(new Uint8Array([255, 255, 255, 255]), 1, 1)).arrayBuffer());
  for (const [name, buffer] of [['Wet output.png', output], ['Wet coverage.png', coverage]] as const) { await page.getByTestId('import-input').setInputFiles({ name, mimeType: 'image/png', buffer }); await expect(page.locator('.layer-row')).toHaveCount(name === 'Wet output.png' ? 1 : 2); }
  const before = await project('before-wet.luma'), guide = await readFile('docs/SCRIPTING_API.md', 'utf8'), code = guide.match(/<!-- example: wet-prepared -->\s*```js\n([\s\S]*?)\n```/)?.[1]; expect(code).toBeTruthy();
  await page.getByRole('button', { name: 'Scripts (Mod+Shift+K)', exact: true }).click();
  await page.getByLabel('Script code', { exact: true }).fill("document.resize(16,16); for (const layer of document.layers) { layer.name = layer.name.replace('.png',''); layer.visible = false; }\n" + code!);
  await page.getByRole('button', { name: 'Run script', exact: true }).click(); await expect(page.getByLabel('Script output')).toContainText('Prepared wet paint ready'); await page.getByRole('button', { name: 'Close scripts', exact: true }).click();
  const saved = await project('prepared-wet.luma'), paint = saved.contents.document.children.at(-1); if (paint?.kind !== 'paint') throw new Error('Missing prepared paint'); expect(paint.strokes[0].kind).toBe('wet'); expect(saved.contents.document.schemaVersion).toBe(40); expect(saved.contents.entries).toHaveLength(2);
  const stored = await Promise.all(saved.contents.entries.map(async entry => Buffer.from(await entry.blob.arrayBuffer()))); expect(stored.some(bytes => bytes.equals(output))).toBe(true); expect(stored.some(bytes => bytes.equals(coverage))).toBe(true);
  const png = await download(() => page.getByRole('button', { name: 'Export PNG', exact: true }).click(), 'prepared-wet.png');
  await page.keyboard.press('Control+z'); expect((await project('undone-wet.luma')).contents.document).toEqual(before.contents.document); await page.keyboard.press('Control+Shift+z');
  await page.reload(); expect(await page.evaluate(() => 'luma' in window)).toBe(false); await page.getByTestId('project-input').setInputFiles(saved.path); await expect(page.locator('.layer-row')).toHaveCount(3); const reopened = await download(() => page.getByRole('button', { name: 'Export PNG', exact: true }).click(), 'reopened-wet.png');
  const check = spawnSync('python3', ['-c', "from PIL import Image;import sys;a=Image.open(sys.argv[1]).convert('RGBA');b=Image.open(sys.argv[2]).convert('RGBA');assert a.size==b.size==(16,16);assert a.tobytes()==b.tobytes();assert a.getpixel((3,4))==(255,0,0,128);assert sum(p[3]>0 for p in a.getdata())==1;print('Native alpha and all reopened pixels match')", png, reopened], { encoding: 'utf8', timeout: 30000 }); expect(check.status, check.stdout + check.stderr).toBe(0); expect(errors).toEqual([]);
});
test('production portable texture packs reproduce exact native painting in a fresh browser context without globals',async({page,browser},info)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const download=async(target:typeof page,action:()=>Promise<unknown>,name:string)=>{const event=target.waitForEvent('download');await action();const file=info.outputPath(name);await(await event).saveAs(file);return file;};
 const prepare=async(target:typeof page)=>{await target.goto('/');expect(await target.evaluate(()=>'luma'in window)).toBe(false);await target.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();await target.getByLabel('Script code',{exact:true}).fill('document.resize(64,64);print("Portable brush canvas");');await target.getByRole('button',{name:'Run script',exact:true}).click();await expect(target.getByLabel('Script output')).toContainText('Portable brush canvas');await target.getByRole('button',{name:'Close scripts',exact:true}).click();await target.getByRole('button',{name:'Brush tool (B)',exact:true}).click();};
 const draw=async(target:typeof page)=>{await target.keyboard.press('Control+1');const box=(await target.locator('.canvas-wrap').boundingBox())!;await target.mouse.click(box.x+32,box.y+32);await expect(target.locator('.layer-row')).toHaveCount(1);};
 await prepare(page);for(const [label,value] of [['Size','32'],['Hardness','100'],['Tool opacity','100'],['Flow','100'],['Smoothing','0']]){const field=page.getByRole('spinbutton',{name:`${label} value`,exact:true});await field.fill(value);await field.press('Enter');}await page.getByLabel('Pressure controls size',{exact:true}).uncheck();await page.getByLabel('Foreground color',{exact:true}).fill('#ff0000');
 const bytes=new Uint8Array(64);for(let y=0;y<4;y++)for(let x=0;x<4;x++)bytes.set([x<2?0:255,x<2?0:255,x<2?0:255,255],(y*4+x)*4);const source=Buffer.from(await(await encodeRgbaPng(bytes,4,4)).arrayBuffer());
 await page.getByRole('button',{name:'Texture…',exact:true}).click();const texture=page.getByRole('dialog',{name:'Brush texture',exact:true});await texture.getByLabel('Brush texture image file',{exact:true}).setInputFiles({name:'Production portable.png',mimeType:'image/png',buffer:source});await expect(texture.getByAltText('Texture coverage preview')).toBeVisible();await texture.getByRole('button',{name:'Apply texture',exact:true}).click();
 const initial=await readProject(new Blob([new Uint8Array(await readFile(await download(page,()=>page.getByRole('button',{name:'Save project',exact:true}).click(),'portable-before.luma')))]));await page.getByRole('button',{name:'Brush presets…',exact:true}).click();const presets=page.getByRole('dialog',{name:'Brush presets',exact:true});await presets.getByLabel('Preset name',{exact:true}).fill('Production portable texture');await presets.getByLabel('Include current foreground color',{exact:true}).check();await presets.getByRole('button',{name:'Save current as new',exact:true}).click();await expect(presets.getByRole('status')).toContainText('saved locally');const pack=await download(page,()=>presets.getByRole('button',{name:'Export selected',exact:true}).click(),'production.canoli-brushes'),parsed=await readBrushContainer(new Blob([new Uint8Array(await readFile(pack))]));expect(parsed!.blobs).toHaveLength(1);expect(Buffer.from(await parsed!.blobs[0].arrayBuffer())).toEqual(source);await presets.getByRole('button',{name:'Delete preset',exact:true}).click();await expect(presets.getByRole('status')).toContainText('deleted');await presets.getByRole('button',{name:'Close',exact:true}).click();await draw(page);const png=await download(page,()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),'portable-original.png');await page.keyboard.press('Control+z');const undone=await readProject(new Blob([new Uint8Array(await readFile(await download(page,()=>page.getByRole('button',{name:'Save project',exact:true}).click(),'portable-undone.luma')))]));expect(undone.document).toEqual(initial.document);
 const context=await browser.newContext({viewport:{width:1440,height:1000}});try{
  const other=await context.newPage();other.on('pageerror',e=>errors.push(e.message));await prepare(other);await other.getByRole('button',{name:'Brush presets…',exact:true}).click();const library=other.getByRole('dialog',{name:'Brush presets',exact:true});await library.getByLabel('Import brush pack file',{exact:true}).setInputFiles(pack);await expect(library.getByRole('status')).toContainText('Imported 1');await library.getByRole('button',{name:'Apply preset',exact:true}).click();await expect(library).toBeHidden();await draw(other);const output=await download(other,()=>other.getByRole('button',{name:'Export PNG',exact:true}).click(),'portable-independent.png'),project=await readProject(new Blob([new Uint8Array(await readFile(await download(other,()=>other.getByRole('button',{name:'Save project',exact:true}).click(),'portable-independent.luma')))]));expect(project.entries).toHaveLength(1);expect(Buffer.from(await project.entries[0].blob.arrayBuffer())).toEqual(source);
  const checked=spawnSync('python3',['-c',"from PIL import Image;import numpy as np,sys;a=Image.open(sys.argv[1]).convert('RGBA');b=Image.open(sys.argv[2]).convert('RGBA');assert a.size==b.size==(64,64);assert np.array_equal(np.asarray(a),np.asarray(b));assert b.getpixel((26,32))==(255,0,0,255);assert b.getpixel((38,32))==(0,0,0,0);print('All native pixels match across independent browser storage contexts; source bytes and one-step undo preserved')",png,output],{encoding:'utf8',timeout:30000});expect(checked.status,checked.stderr||checked.stdout).toBe(0);expect(errors).toEqual([]);await info.attach('production-portable-texture',{body:JSON.stringify({version:4,sourceBytes:source.length,freshContext:true,noDeveloperGlobals:true,independent:checked.stdout}),contentType:'application/json'});
 }finally{await context.close();}
});

test('production texture controls author source-bearing projects with exact undo and native pixels after reload',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('/');expect(await page.evaluate(()=>'luma'in window)).toBe(false);
 const download=async(action:()=>Promise<unknown>,name:string)=>{const event=page.waitForEvent('download');await action();const path=info.outputPath(name);await(await event).saveAs(path);return path;};
 const read=async(path:string)=>readProject(new Blob([new Uint8Array(await readFile(path))]));
 await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();await page.getByLabel('Script code',{exact:true}).fill('document.resize(64,64);print("Texture canvas ready");');await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('Texture canvas ready');await page.getByRole('button',{name:'Close scripts',exact:true}).click();const initial=await read(await download(()=>page.getByRole('button',{name:'Save project',exact:true}).click(),'before.luma'));
 await page.getByRole('button',{name:'Brush tool (B)',exact:true}).click();for(const [label,value] of [['Size','32'],['Hardness','100'],['Tool opacity','100'],['Flow','100'],['Smoothing','0']]){const input=page.getByRole('spinbutton',{name:`${label} value`,exact:true});await input.fill(value);await input.press('Enter');}await page.getByLabel('Pressure controls size',{exact:true}).uncheck();await page.getByLabel('Foreground color',{exact:true}).fill('#ff0000');
 const pixels=new Uint8Array(64);for(let y=0;y<4;y++)for(let x=0;x<4;x++)pixels.set([x<2?0:255,x<2?0:255,x<2?0:255,255],(y*4+x)*4);const source=Buffer.from(await(await encodeRgbaPng(pixels,4,4)).arrayBuffer());
 await page.getByRole('button',{name:'Texture…',exact:true}).click();let dialog=page.getByRole('dialog',{name:'Brush texture',exact:true});await dialog.getByLabel('Brush texture image file',{exact:true}).setInputFiles({name:'Original portable grain.png',mimeType:'image/png',buffer:source});await expect(dialog.getByAltText('Texture coverage preview')).toBeVisible();await dialog.getByRole('button',{name:'Apply texture',exact:true}).click();await page.keyboard.press('Control+1');const box=(await page.locator('.canvas-wrap').boundingBox())!;await page.mouse.click(box.x+32,box.y+32);await expect(page.locator('.layer-row')).toHaveCount(1);
 const path=await download(()=>page.getByRole('button',{name:'Save project',exact:true}).click(),'textured.luma'),saved=await read(path),paint=saved.document.children[0];if(paint.kind!=='paint'||(paint.strokes[0].kind==='fill' || paint.strokes[0].kind === 'wet'))throw new Error('Missing authored textured brush');expect(paint.strokes[0].texture).toMatchObject({channel:'luminance',invert:false});expect(saved.entries).toHaveLength(1);expect(Buffer.from(await saved.entries[0].blob.arrayBuffer())).toEqual(source);expect([saved.entries[0].width,saved.entries[0].height]).toEqual([4,4]);const original=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),'textured.png');
 await page.keyboard.press('Control+z');expect((await read(await download(()=>page.getByRole('button',{name:'Save project',exact:true}).click(),'undone.luma'))).document).toEqual(initial.document);
 await page.getByRole('button',{name:'Brush presets…',exact:true}).click();const presets=page.getByRole('dialog',{name:'Brush presets',exact:true});await presets.getByRole('button',{name:'Save current as new',exact:true}).click();await expect(presets.getByRole('status')).toContainText('saved locally');await presets.getByRole('button',{name:/^Hard round Brush/}).click();await presets.getByRole('button',{name:'Apply preset',exact:true}).click();await expect(page.getByRole('button',{name:'Texture…',exact:true})).toBeVisible();
 await page.reload();expect(await page.evaluate(()=>'luma'in window)).toBe(false);await page.getByTestId('project-input').setInputFiles(path);await expect(page.locator('.layer-row')).toHaveCount(1);const reopened=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),'reopened.png');
 const checked=spawnSync('python3',['-c',"from PIL import Image;import numpy as np,sys;a=Image.open(sys.argv[1]).convert('RGBA');b=Image.open(sys.argv[2]).convert('RGBA');assert a.size==b.size==(64,64);assert np.array_equal(np.asarray(a),np.asarray(b));assert a.getpixel((26,32))==(255,0,0,255);assert a.getpixel((38,32))==(0,0,0,0);print('Every texture gesture pixel survives reload; original source bytes and one-step undo verified')",original,reopened],{encoding:'utf8',timeout:30000});expect(checked.status,checked.stderr||checked.stdout).toBe(0);expect(errors).toEqual([]);await info.attach('production-texture-controls',{body:JSON.stringify({sourceBytes:source.length,sourceSize:[4,4],nativePixels:checked.stdout,noDeveloperGlobal:true,exactUndo:true,legacyPresetsResetTexture:true}),contentType:'application/json'});
});

test('production portable brush presets survive reload and author self-contained undoable projects without globals',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('/');expect(await page.evaluate(()=>'luma'in window)).toBe(false);
 const download=async(action:()=>Promise<unknown>,name:string)=>{const pending=page.waitForEvent('download');await action();const path=info.outputPath(name);await(await pending).saveAs(path);return path;};const read=async(path:string)=>readProject(new Blob([new Uint8Array(await readFile(path))]));
 await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();await page.getByLabel('Script code',{exact:true}).fill('document.resize(64,64);print("Brush canvas ready");');await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('Brush canvas ready');await page.getByRole('button',{name:'Close scripts',exact:true}).click();const initialPath=await download(()=>page.getByRole('button',{name:'Save project',exact:true}).click(),'initial.luma'),initial=await read(initialPath);
 await page.getByRole('button',{name:'Brush tool (B)',exact:true}).click();for(const [label,value] of [['Size','60.5'],['Hardness','100'],['Tool opacity','40'],['Flow','30'],['Spacing','750.25'],['Smoothing','12.5']]){const input=page.getByRole('spinbutton',{name:`${label} value`,exact:true});await input.fill(value);await input.press('Enter');}await page.getByLabel('Foreground color',{exact:true}).fill('#ff0000');await page.getByLabel('Pressure controls opacity',{exact:true}).check();await page.getByRole('button',{name:'Pressure response…',exact:true}).click();const curve=page.getByRole('dialog',{name:'Pressure response',exact:true});await curve.getByLabel('Response preset',{exact:true}).selectOption('firm');await curve.getByRole('button',{name:'Apply response',exact:true}).click();
 await page.getByRole('button',{name:'Brush presets…',exact:true}).click();let dialog=page.getByRole('dialog',{name:'Brush presets',exact:true});await dialog.getByLabel('Preset name',{exact:true}).fill('Production ink');await dialog.getByLabel('Include current foreground color',{exact:true}).check();await dialog.getByRole('button',{name:'Save current as new',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('saved locally');const packPath=await download(()=>dialog.getByRole('button',{name:'Export selected',exact:true}).click(),'ink.canoli-brushes.json'),pack=JSON.parse(await readFile(packPath,'utf8'));expect(pack).toMatchObject({format:'canoli-brush-presets',version:1,presets:[{name:'Production ink',tool:'brush',color:'#ff0000',settings:{size:60.5,hardness:1,opacity:.4,flow:.3,spacing:7.5025,pressureOpacity:true}}]});expect(pack.presets[0].settings.pressureCurve.points[2]).toEqual({input:.5,output:.25});await dialog.getByRole('button',{name:'Close',exact:true}).click();
 await page.reload();expect(await page.evaluate(()=>'luma'in window)).toBe(false);await page.getByTestId('project-input').setInputFiles(initialPath);await page.getByRole('button',{name:'Brush tool (B)',exact:true}).click();await page.getByLabel('Foreground color',{exact:true}).fill('#0000ff');await page.getByRole('button',{name:'Brush presets…',exact:true}).click();dialog=page.getByRole('dialog',{name:'Brush presets',exact:true});await dialog.getByRole('button',{name:/^Production ink Brush/}).click();await dialog.getByRole('button',{name:'Apply preset',exact:true}).click();await expect(page.getByRole('spinbutton',{name:'Size value',exact:true})).toHaveValue('60.5');await expect(page.getByRole('spinbutton',{name:'Spacing value',exact:true})).toHaveValue('750.25');await expect(page.getByRole('spinbutton',{name:'Smoothing value',exact:true})).toHaveValue('12.5');await expect(page.getByLabel('Foreground color',{exact:true})).toHaveValue('#ff0000');const configured=await read(await download(()=>page.getByRole('button',{name:'Save project',exact:true}).click(),'configured.luma'));expect(configured.document).toEqual(initial.document);
 await page.keyboard.press('Control+1');const box=(await page.locator('.canvas-wrap').boundingBox())!;await page.mouse.click(box.x+32,box.y+32);const png=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),'ink.png'),savedPath=await download(()=>page.getByRole('button',{name:'Save project',exact:true}).click(),'ink.luma'),saved=await read(savedPath),layer=saved.document.children[0];if(layer.kind!=='paint')throw new Error('Missing preset-authored paint');const stroke=layer.strokes[0];if((stroke.kind==='fill' || stroke.kind === 'wet'))throw new Error('Missing brush');expect(stroke).toMatchObject({size:60.5,hardness:1,opacity:.4,flow:.3,color:'#ff0000',pressureOpacity:true});expect(stroke.spacing).toBe(pack.presets[0].settings.spacing);expect(stroke.pressureCurve).toEqual(pack.presets[0].settings.pressureCurve);
 await page.keyboard.press('Control+z');const undone=await read(await download(()=>page.getByRole('button',{name:'Save project',exact:true}).click(),'undo.luma'));expect(undone.document).toEqual(initial.document);await page.getByTestId('project-input').setInputFiles(savedPath);
 await page.getByRole('button',{name:'Brush presets…',exact:true}).click();dialog=page.getByRole('dialog',{name:'Brush presets',exact:true});await dialog.getByRole('button',{name:/^Production ink Brush/}).click();await dialog.getByRole('button',{name:'Delete preset',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('deleted');await dialog.getByRole('button',{name:'Close',exact:true}).click();await page.reload();await page.getByTestId('project-input').setInputFiles(savedPath);const reopened=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),'reopened.png'),restored=await read(await download(()=>page.getByRole('button',{name:'Save project',exact:true}).click(),'restored.luma'));expect(restored.document).toEqual(saved.document);
 const reference=await page.evaluate(()=>{const source=document.createElement('canvas'),target=document.createElement('canvas');source.width=source.height=target.width=target.height=1;const a=source.getContext('2d')!,b=target.getContext('2d')!;a.globalAlpha=.3;a.fillStyle='#ff0000';a.fillRect(0,0,1,1);const flow=[...a.getImageData(0,0,1,1).data];b.globalAlpha=.4;b.drawImage(source,0,0);const output=[...b.getImageData(0,0,1,1).data];source.width=source.height=target.width=target.height=0;return{flow,output};});expect(Math.abs(reference.output[3]-.3*.4*255)).toBeLessThanOrEqual(1);
 const checked=spawnSync('python3',['-c',"from PIL import Image;import numpy as np,sys;a=Image.open(sys.argv[1]).convert('RGBA');b=Image.open(sys.argv[2]).convert('RGBA');assert a.size==b.size==(64,64);assert np.array_equal(np.asarray(a),np.asarray(b));assert a.getpixel((32,32))==(255,0,0,int(sys.argv[3])),a.getpixel((32,32));print('Every preset-authored pixel survives deletion of its library preset and native project reopening; center matches independent two-surface native alpha')",png,reopened,String(reference.output[3])],{encoding:'utf8',timeout:30000});expect(checked.status,checked.stderr||checked.stdout).toBe(0);expect(errors).toEqual([]);await info.attach('production-brush-presets',{body:JSON.stringify({portableSettings:pack.presets[0].settings,nativeAlphaReference:reference,sourceIndependentProject:true,exactUndo:true,noDeveloperGlobal:true,independent:checked.stdout}),contentType:'application/json'});
});

test('production saved-brush documentation works without JavaScript at a narrow viewport',async({browser})=>{
 const context=await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:844}});try{const page=await context.newPage();await page.goto('http://127.0.0.1:4173/developer/brush-presets.html');await expect(page.getByRole('heading',{name:'Saved brush presets',exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.getByRole('link',{name:'Scripting API',exact:true}).click();const references=page.getByRole('link',{name:'BRUSH_PRESETS.md',exact:true});for(const reference of await references.all())await expect(reference).toHaveAttribute('href','brush-presets.html');await references.first().click();await expect(page.getByRole('heading',{name:'Saved brush presets',exact:true})).toBeVisible();}finally{await context.close();}
});

test('production documented pressure curves retain native pixels, editable values and exact gesture/script undo',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('/');expect(await page.evaluate(()=>'luma'in window)).toBe(false);
 const download=async(action:()=>Promise<unknown>,name:string)=>{const pending=page.waitForEvent('download');await action();const path=info.outputPath(name);await(await pending).saveAs(path);return path;};
 const read=async(path:string)=>readProject(new Blob([new Uint8Array(await readFile(path))]));
 const initial=await read(await download(()=>page.getByRole('button',{name:'Save project',exact:true}).click(),'initial.luma'));
 const example=(await readFile('docs/SCRIPTING_API.md','utf8')).match(/<!-- example: pressure-response -->\s*```js\n([\s\S]*?)\n```/)?.[1];expect(example).toBeTruthy();
 await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();await page.getByLabel('Script code',{exact:true}).fill(example!);await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('Pressure response study ready');await page.getByRole('button',{name:'Close scripts',exact:true}).click();
 const png=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),'pressure.png'),saved=await download(()=>page.getByRole('button',{name:'Save project',exact:true}).click(),'pressure.luma'),project=await read(saved);
 expect(project.document.schemaVersion).toBe(40);expect(project.document.width).toBe(320);const layer=project.document.children[0];if(layer.kind!=='paint')throw new Error('Missing authored pressure layer');expect(layer.strokes).toHaveLength(3);
 for(const stroke of layer.strokes){if((stroke.kind==='fill' || stroke.kind === 'wet'))throw new Error('Missing pressure stroke');expect(stroke.points[0].pressure).toBe(0);expect(stroke.points.at(-1)!.pressure).toBe(1);expect(stroke.pressureCurve).toBeTruthy();}
 await page.getByRole('button',{name:'Brush tool (B)',exact:true}).click();await page.getByRole('button',{name:'Pressure response…',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Pressure response',exact:true});await dialog.getByLabel('Response preset',{exact:true}).selectOption('firm');await dialog.getByRole('button',{name:'Apply response',exact:true}).click();
 const configured=await read(await download(()=>page.getByRole('button',{name:'Save project',exact:true}).click(),'configured.luma'));expect(configured.document).toEqual(project.document);
 await page.keyboard.press('Control+1');const box=(await page.locator('.canvas-wrap').boundingBox())!;await page.mouse.click(box.x+24,box.y+24);const drawn=await read(await download(()=>page.getByRole('button',{name:'Save project',exact:true}).click(),'drawn.luma'));const after=drawn.document.children[0];if(after.kind!=='paint')throw new Error('Missing painted stroke');expect(after.strokes).toHaveLength(4);const stroke=after.strokes[3];if((stroke.kind==='fill' || stroke.kind === 'wet'))throw new Error('Missing pressure dynamics');expect(stroke.pressureCurve?.points[2]).toEqual({input:.5,output:.25});
 await page.keyboard.press('Control+z');const undone=await read(await download(()=>page.getByRole('button',{name:'Save project',exact:true}).click(),'undone-gesture.luma'));expect(undone.document).toEqual(project.document);await page.keyboard.press('Control+z');const original=await read(await download(()=>page.getByRole('button',{name:'Save project',exact:true}).click(),'undone-script.luma'));expect(original.document).toEqual(initial.document);
 await page.getByTestId('project-input').setInputFiles(saved);const restored=await read(await download(()=>page.getByRole('button',{name:'Save project',exact:true}).click(),'restored.luma'));expect(restored.document).toEqual(project.document);const reopened=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),'reopened.png');
 const checked=spawnSync('python3',['-c',"from PIL import Image;import numpy as np,sys;a=np.asarray(Image.open(sys.argv[1]).convert('RGBA'));b=np.asarray(Image.open(sys.argv[2]).convert('RGBA'));assert a.shape==b.shape==(180,320,4);assert np.array_equal(a,b);assert np.count_nonzero(a[:,:,3])>100;print('Every production pressure-study pixel survives project reopening')",png,reopened],{encoding:'utf8',timeout:30000});expect(checked.status,checked.stderr||checked.stdout).toBe(0);expect(errors).toEqual([]);
 await info.attach('production-pressure-curves',{body:JSON.stringify({schema:32,strokes:3,futureStrokeCurve:'firm',independent:checked.stdout,exactGestureAndScriptUndo:true,noDeveloperGlobal:true}),contentType:'application/json'});
});

for(const fixture of ['pass-opacity-mask','authored'] as const)
test(`production native Photoshop hierarchy ${fixture} exports independent folders and masks and reopens editable`,async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('/');expect(await page.evaluate(()=>'luma'in window)).toBe(false);
 if(fixture==='authored'){
  const example=(await readFile('docs/SCRIPTING_API.md','utf8')).match(/<!-- example: photoshop-native-hierarchy -->\s*```js\n([\s\S]*?)\n```/)?.[1];expect(example).toBeTruthy();
  await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();await page.getByLabel('Script code',{exact:true}).fill(example!);await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('Native folder export ready');await page.getByRole('button',{name:'Close scripts',exact:true}).click();
 }else{
  await page.getByTestId('psd-input').setInputFiles('tests/fixtures/psd/groups/pass-opacity-mask.psd');const dialog=page.locator('.psd-import-dialog');await expect(dialog.locator('.psd-meta-card')).toBeVisible();await dialog.locator('input[value="layered"]').check();await dialog.getByRole('button',{name:'Import Layers',exact:true}).click();await expect(dialog).not.toBeVisible();
 }
 const download=async(action:()=>Promise<unknown>,name:string)=>{const pending=page.waitForEvent('download');await action();const path=info.outputPath(name);await(await pending).saveAs(path);return path;};
 const reference=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),'reference.png'),saved=await download(()=>page.getByRole('button',{name:'Save project',exact:true}).click(),'original.luma'),original=await readProject(new Blob([new Uint8Array(await readFile(saved))]));
 const cases=[];let psb='';
 for(const format of ['psd','psb']){
  await page.getByRole('button',{name:'Export…',exact:true}).click();const dialog=page.locator('.export-dialog');await dialog.getByLabel('Format',{exact:true}).selectOption(format);await expect(dialog.getByLabel(format.toUpperCase()+' layers',{exact:true})).toHaveValue('layers');await expect(dialog).toContainText('Nested folder hierarchy');await expect(dialog).toContainText('Editable pixel-mask channels');await expect(dialog).toContainText('off-canvas mask coverage');
  if(fixture==='authored'){await expect(dialog).toContainText('group fill is folded');await expect(dialog).toContainText('Separate fill opacity on retained unstyled Normal pixel layers');}
  const path=await download(()=>dialog.getByRole('button',{name:'Export .'+format,exact:true}).click(),'native.'+format);if(format==='psb')psb=path;
  cases.push({path,format,reference,source:fixture==='authored'?undefined:'tests/fixtures/psd/groups/pass-opacity-mask.psd'});
 }
 const after=await download(()=>page.getByRole('button',{name:'Save project',exact:true}).click(),'after-export.luma'),afterProject=await readProject(new Blob([new Uint8Array(await readFile(after))]));expect(afterProject.document).toEqual(original.document);
 for(const source of original.entries){const retained=afterProject.entries.find(value=>value.id===source.id)!;expect(Buffer.from(await retained.blob.arrayBuffer()).equals(Buffer.from(await source.blob.arrayBuffer()))).toBe(true);}
 const manifest=info.outputPath('independent.json');await writeFile(manifest,JSON.stringify(cases));const checked=spawnSync(process.env.CANOLI_PSB_PYTHON||'python3',['scripts/check-photoshop-hierarchy.py',manifest],{encoding:'utf8',timeout:120000});expect(checked.status,checked.stderr||checked.stdout).toBe(0);
 await page.getByTestId('psd-input').setInputFiles(psb);const dialog=page.locator('.psd-import-dialog');await expect(dialog.locator('.psd-meta-card')).toBeVisible();await expect(dialog.locator('input[value="layered"]')).toBeEnabled();await dialog.locator('input[value="layered"]').check();await dialog.getByRole('button',{name:'Import Layers',exact:true}).click();await expect(dialog).not.toBeVisible();
 const reopened=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),'reopened.png'),restoredPath=await download(()=>page.getByRole('button',{name:'Save project',exact:true}).click(),'restored.luma'),restored=await readProject(new Blob([new Uint8Array(await readFile(restoredPath))]));
 const group=restored.document.children[1];expect(group.kind).toBe('group');expect(group.mask?.kind).toBe('bitmap');expect(group.mask?.enabled).toBe(true);
 if(group.kind!=='group')throw new Error('Exported folder was flattened');
 if(fixture==='authored'){expect(group.opacity).toBe(64/255);expect(group.fillOpacity??1).toBe(1);expect(group.children[0].fillOpacity).toBe(128/255);expect(group.children[1]).toMatchObject({kind:'group',name:'Empty pass',blendMode:'pass-through'});}
 else expect(group.blendMode).toBe('pass-through');
 const pixels=spawnSync('python3',['-c',"from PIL import Image;import numpy as np,sys;a=np.asarray(Image.open(sys.argv[1]).convert('RGBA')).astype(int);b=np.asarray(Image.open(sys.argv[2]).convert('RGBA')).astype(int);assert a.shape==b.shape;assert np.array_equal(a[:,:,3],b[:,:,3]);assert np.abs(a-b).max()<=1;print('Every reimported alpha and RGB sample matches within one byte')",reference,reopened],{encoding:'utf8',timeout:30000});expect(pixels.status,pixels.stderr||pixels.stdout).toBe(0);expect(errors).toEqual([]);
 await info.attach('production-photoshop-native-hierarchy',{body:JSON.stringify({fixture,independent:JSON.parse(checked.stdout),reopened:pixels.stdout,sourcesUnchanged:true,noDeveloperGlobal:true}),contentType:'application/json'});
});


for(const fixture of ['pass','pass-opacity-mask','native-50mp-group'])
test(`production Photoshop group ${fixture} retains independent pixels, isolated OO undo and native project hierarchy`,async({page},info)=>{
 test.setTimeout(240000);const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/');expect(await page.evaluate(()=>'luma'in window)).toBe(false);
 await page.getByTestId('psd-input').setInputFiles(`tests/fixtures/psd/groups/${fixture}.psd`);
 const dialog=page.locator('.psd-import-dialog');await expect(dialog.locator('.psd-meta-card')).toBeVisible();await expect(dialog.locator('input[value="layered"]')).toBeEnabled();await dialog.locator('input[value="layered"]').check();await dialog.getByRole('button',{name:'Import Layers',exact:true}).click();await expect(dialog).not.toBeVisible({timeout:120000});
 const download=async(action:()=>Promise<unknown>,name:string)=>{const pending=page.waitForEvent('download');await action();const path=info.outputPath(name);await(await pending).saveAs(path);return path;};
 const original=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),'original.png');
 const saved=await download(()=>page.getByRole('button',{name:'Save project',exact:true}).click(),'groups.luma');
 const project=await readProject(new Blob([new Uint8Array(await readFile(saved))]));
 expect(project.document.schemaVersion).toBe(40);const group=project.document.children[1];expect(group.kind).toBe('group');expect(group.blendMode).toBe('pass-through');
 if(fixture==='pass-opacity-mask')expect(group.mask?.kind).toBe('bitmap');
 const example=(await readFile('docs/SCRIPTING_API.md','utf8')).match(/<!-- example: photoshop-group-edit -->\s*```js\n([\s\S]*?)\n```/)?.[1];expect(example).toBeTruthy();
 await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();await page.getByLabel('Script code',{exact:true}).fill(example!);await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('Imported group remains editable pass-through');await page.getByRole('button',{name:'Close scripts',exact:true}).click();
 const edited=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),'edited.png');expect((await readFile(edited)).equals(await readFile(original))).toBe(false);
 await page.keyboard.press('Control+z');
 const undone=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),'undone.png');
 await page.getByTestId('project-input').setInputFiles(saved);
 const reopened=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),'reopened.png');
 const reopenedProjectPath=await download(()=>page.getByRole('button',{name:'Save project',exact:true}).click(),'reopened.luma'),restored=await readProject(new Blob([new Uint8Array(await readFile(reopenedProjectPath))]));
 expect(restored.document).toEqual(project.document);expect(restored.entries.map(entry=>entry.id).sort()).toEqual(project.entries.map(entry=>entry.id).sort());
 for(const entry of project.entries){const other=restored.entries.find(value=>value.id===entry.id)!;expect(Buffer.from(await other.blob.arrayBuffer()).equals(Buffer.from(await entry.blob.arrayBuffer()))).toBe(true);}
 const checked=spawnSync('python3',['-c',"from PIL import Image;import numpy as np,sys;r=Image.open(sys.argv[1]).convert('RGBA');maximum=0\nfor path in sys.argv[2:]:\n a=Image.open(path).convert('RGBA');assert a.size==r.size\n for y in range(0,a.height,64):\n  box=(0,y,a.width,min(a.height,y+64));x=np.asarray(a.crop(box)).astype(int);z=np.asarray(r.crop(box)).astype(int);assert np.array_equal(x[:,:,3],z[:,:,3]);maximum=max(maximum,int(np.abs(x-z).max()))\nassert maximum<=1,maximum\nprint('Every original, undo and reopened alpha matches; maximum independent RGB error:',maximum)",`tests/fixtures/psd/groups/${fixture}.png`,original,undone,reopened],{encoding:'utf8',timeout:120000});
 expect(checked.status,checked.stderr).toBe(0);expect(errors).toEqual([]);expect(await page.evaluate(()=>'luma'in window)).toBe(false);
 await info.attach('production-photoshop-groups',{body:JSON.stringify({fixture,assets:project.entries.length,independent:checked.stdout,sourceBytesPreserved:true,edited:true,oneUndo:true,noDeveloperGlobals:true}),contentType:'application/json'});
});

for(const fixture of ['white-zip','density-zip','relative-prediction','feather-merged','native-50mp-mask','vector-only'])
test(`production Photoshop pixel mask ${fixture} preserves independent output, OO undo and native project sources`,async({page},info)=>{
 test.setTimeout(240000);const merged=fixture==='feather-merged'||fixture==='vector-only',errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('/');expect(await page.evaluate(()=>'luma'in window)).toBe(false);
 await page.getByTestId('psd-input').setInputFiles(`tests/fixtures/psd/masks/${fixture}.psd`);const dialog=page.locator('.psd-import-dialog');await expect(dialog.locator('.psd-meta-card')).toBeVisible();
 if(merged){await expect(dialog.locator('input[value="layered"]')).toBeDisabled();await expect(dialog).toContainText(fixture==='vector-only'?'Photoshop vector masks':'Photoshop mask feathering');}
 else await dialog.locator('input[value="layered"]').check();
 await dialog.getByRole('button',{name:merged?'Import Flattened':'Import Layers',exact:true}).click();await expect(dialog).not.toBeVisible({timeout:fixture==='native-50mp-mask'?120000:5000});
 const download=async(action:()=>Promise<unknown>,name:string)=>{const pending=page.waitForEvent('download');await action();const path=info.outputPath(name);await(await pending).saveAs(path);return path;};
 const original=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),'original.png');
 const saved=await download(()=>page.getByRole('button',{name:'Save project',exact:true}).click(),'masked.luma');
 const project=await readProject(new Blob([new Uint8Array(await readFile(saved))]));expect(project.entries).toHaveLength(merged?1:2);
 if(!merged){
  expect(project.document.children[0].mask?.kind).toBe('bitmap');
  const example=(await readFile('docs/SCRIPTING_API.md','utf8')).match(/<!-- example: photoshop-mask-edit -->\s*```js\n([\s\S]*?)\n```/)?.[1];expect(example).toBeTruthy();
  await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();await page.getByLabel('Script code',{exact:true}).fill(example!);await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('Imported pixel mask remains editable');await page.getByRole('button',{name:'Close scripts',exact:true}).click();await page.keyboard.press('Control+z');
 }
 const undone=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),'undone.png');await page.getByTestId('project-input').setInputFiles(saved);const reopened=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),'reopened.png');
 const checked=spawnSync('python3',['-c',"from PIL import Image;import numpy as np,sys;reference=Image.open(sys.argv[1]).convert('RGBA')\nfor path in sys.argv[2:]:\n image=Image.open(path).convert('RGBA');assert image.size==reference.size\n for y in range(0,image.height,64):\n  box=(0,y,image.width,min(image.height,y+64));assert np.array_equal(np.asarray(image.crop(box)),np.asarray(reference.crop(box))),y\nprint('Every original, OO-undo and project-reopened mask pixel matches the independent native-grid reference')",`tests/fixtures/psd/masks/${fixture}.png`,original,undone,reopened],{encoding:'utf8',timeout:120000});expect(checked.status,checked.stderr).toBe(0);expect(errors).toEqual([]);
 await info.attach('production-photoshop-pixel-mask',{body:JSON.stringify({fixture,assets:project.entries.length,independent:checked.stdout,noDeveloperGlobal:true}),contentType:'application/json'});
});

for (const fixture of ['rgba-prediction', 'gray-alpha-prediction']) for (const mode of ['layered', 'flatten'])
test(`production Photoshop ${fixture} ${mode} preserves independent alpha and prediction samples`, async ({page}, info) => {
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('/');expect(await page.evaluate(()=>'luma'in window)).toBe(false);
 await page.getByTestId('psd-input').setInputFiles(`tests/fixtures/psd/zip/${fixture}.psd`);const dialog=page.locator('.psd-import-dialog');await expect(dialog.locator('.psd-meta-card')).toBeVisible();
 await dialog.locator(`input[value="${mode}"]`).check();await dialog.getByRole('button',{name:mode==='layered'?'Import Layers':'Import Flattened',exact:true}).click();await expect(dialog).not.toBeVisible();
 const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Export PNG',exact:true}).click();const path=info.outputPath('prediction.png');await(await pending).saveAs(path);
 const checked=spawnSync('python3',['-c',"from PIL import Image;import numpy as np,sys;assert np.array_equal(np.asarray(Image.open(sys.argv[1]).convert('RGBA')),np.asarray(Image.open(sys.argv[2]).convert('RGBA')));print('Every production ZIP prediction and alpha sample matches the independent original')",path,`tests/fixtures/psd/zip/${fixture}.png`],{encoding:'utf8',timeout:30000});expect(checked.status,checked.stderr).toBe(0);expect(errors).toEqual([]);
 await info.attach('production-photoshop-zip-prediction',{body:JSON.stringify({fixture,mode,independent:checked.stdout,noDeveloperGlobal:true}),contentType:'application/json'});
});

for(const source of ['native-50mp.psd','zip/native-50mp-zip.psd']) test(`production native 50 MP Photoshop ${source} preflight, OO edit undo and project reopen preserve every input pixel`,async({page},info)=>{
 test.setTimeout(180000);const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('/');expect(await page.evaluate(()=>'luma'in window)).toBe(false);
 await page.getByTestId('psd-input').setInputFiles('tests/fixtures/psd/'+source);const dialog=page.locator('.psd-import-dialog');await expect(dialog.locator('.psd-meta-card')).toBeVisible();await expect(dialog).toContainText('10000 × 5000');await expect(dialog.locator('input[value="flatten"]')).toBeChecked();await dialog.getByRole('button',{name:'Import Flattened',exact:true}).click();await expect(dialog).not.toBeVisible();await expect(page.locator('.layer-row')).toHaveCount(1);
 const download=async(action:()=>Promise<unknown>,name:string)=>{const pending=page.waitForEvent('download');await action();const path=info.outputPath(name);await(await pending).saveAs(path);return path;};
 const original=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),'imported.png'),projectPath=await download(()=>page.getByRole('button',{name:'Save project',exact:true}).click(),'imported.luma');
 const project=await readProject(new Blob([new Uint8Array(await readFile(projectPath))]));expect(project.entries).toHaveLength(1);expect(project.entries[0].blob.type).toBe('image/png');expect([project.document.width,project.document.height]).toEqual([10000,5000]);
 const example=(await readFile('docs/SCRIPTING_API.md','utf8')).match(/<!-- example: photoshop-import-edit -->\s*```js\n([\s\S]*?)\n```/)?.[1];expect(example).toBeTruthy();await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();await page.getByLabel('Script code',{exact:true}).fill(example!);await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('Imported Photoshop pixels remain editable');await page.getByRole('button',{name:'Close scripts',exact:true}).click();await page.keyboard.press('Control+z');
 const undone=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),'undone.png');await page.getByTestId('project-input').setInputFiles(projectPath);const reopened=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),'reopened.png');
 const checked=spawnSync('python3',['-c',"from PIL import Image;import numpy as np,sys;reference=Image.open(sys.argv[1]).convert('RGBA')\nfor path in sys.argv[2:]:\n image=Image.open(path).convert('RGBA');assert image.size==reference.size==(10000,5000)\n for y in range(0,5000,64):\n  box=(0,y,10000,min(5000,y+64));assert np.array_equal(np.asarray(image.crop(box)),np.asarray(reference.crop(box)))\nprint('All imported, OO-undo and native-project-reopened pixels match the independent 50 MP Photoshop input')",'tests/fixtures/psd/native-50mp.png',original,undone,reopened],{encoding:'utf8',timeout:120000});expect(checked.status,checked.stderr).toBe(0);expect(errors).toEqual([]);await info.attach('production-photoshop-native-input',{body:JSON.stringify({independent:checked.stdout,sourceKind:project.entries[0].blob.type,noDeveloperGlobal:true}),contentType:'application/json'});
});

for (const fixture of [
 {file:'multipage.tif', page:2, reference:null},
 {file:'gray16-le.tif', page:0, reference:'gray16-le.png'},
]) test(`production TIFF import ${fixture.file} preserves selected pixels, editable undo and original project bytes`, async ({page}, info) => {
 const errors:string[]=[]; page.on('pageerror', error=>errors.push(error.message));
 await page.goto('/');
 expect(await page.evaluate(()=>'luma' in window)).toBe(false);
 await page.getByTestId('import-input').setInputFiles('tests/fixtures/tiff/'+fixture.file);
 const dialog = page.getByRole('dialog', {name:'Import TIFF', exact:true});
 await expect(dialog.getByLabel('TIFF page')).toHaveValue('0');
 await dialog.getByLabel('TIFF page').selectOption(String(fixture.page));
 const apply = dialog.getByRole('button', {name:'Import TIFF page', exact:true});
 if (fixture.reference) {
  await expect(apply).toBeDisabled();
  await dialog.getByRole('checkbox', {name:'Convert this page to 8-bit editing precision'}).check();
 }
 await expect(apply).toBeEnabled(); await apply.click(); await expect(dialog).not.toBeVisible();
 async function download(action:()=>Promise<unknown>, name:string) {
  const pending=page.waitForEvent('download'); await action();
  const path=info.outputPath(name); await(await pending).saveAs(path); return path;
 }
 const pngPath=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),'selected.png');
 const checked=spawnSync('python3',['-c',
  "from PIL import Image;import numpy as np,sys;a=Image.open(sys.argv[1]);b=Image.open(sys.argv[2]);b.seek(int(sys.argv[3]));a=np.asarray(a.convert('RGBA'));b=np.asarray(b.convert('RGBA'));assert a.shape==b.shape==(173,211,4);assert np.array_equal(a,b),int(np.abs(a.astype(int)-b).max());print('Every independently decoded selected-page RGBA pixel matches')",
  pngPath,'tests/fixtures/tiff/'+(fixture.reference??fixture.file),String(fixture.reference?0:fixture.page)],{encoding:'utf8',timeout:30000});
 expect(checked.status,checked.stderr).toBe(0);
 const projectPath=await download(()=>page.getByRole('button',{name:'Save project',exact:true}).click(),'selected.luma');
 const project=await readProject(new Blob([new Uint8Array(await readFile(projectPath))]));
 expect(project.entries).toHaveLength(1);
 expect(project.entries[0].tiff).toEqual({page:fixture.page,allowPrecisionLoss:!!fixture.reference});
 expect(Buffer.compare(Buffer.from(await project.entries[0].blob.arrayBuffer()),await readFile('tests/fixtures/tiff/'+fixture.file))).toBe(0);
 const guide=await readFile('docs/SCRIPTING_API.md','utf8'),source=guide.match(/<!-- example: tiff-import-edit -->\s*```js\n([\s\S]*?)\n```/)?.[1];
 expect(source).toBeTruthy();
 await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();
 await page.getByLabel('Script code',{exact:true}).fill(source!);
 await page.getByRole('button',{name:'Run script',exact:true}).click();
 await expect(page.getByLabel('Script output')).toContainText('TIFF source remains editable');
 await page.getByRole('button',{name:'Close scripts',exact:true}).click();
 const edited=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),'edited.png');
 expect((await readFile(edited)).equals(await readFile(pngPath))).toBe(false);
 await page.getByRole('button',{name:'Move tool (V)',exact:true}).click(); await page.keyboard.press('Control+z');
 const undone=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),'undone.png');
 expect((await readFile(undone)).equals(await readFile(pngPath))).toBe(true);
 await page.getByTestId('project-input').setInputFiles(projectPath);
 const reopened=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),'reopened.png');
 expect((await readFile(reopened)).equals(await readFile(pngPath))).toBe(true);
 expect(errors).toEqual([]);
 await info.attach('tiff-production-import',{body:JSON.stringify({fixture,independent:checked.stdout,originalBytes:true,projectReopened:true,scriptUndo:true,noDeveloperGlobal:true}),contentType:'application/json'});
});

for(const format of ['tiff','pdf','psb'] as const)test(`production ${format.toUpperCase()} export yields animation frames and records native long tasks`,async({page},info)=>{
 const extension=format==='tiff'?'tif':format;
 await page.goto('/');expect(await page.evaluate(()=>'luma' in window)).toBe(false);await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();await page.getByLabel('Script code',{exact:true}).fill(`document.resize(4096,4096);const paint=document.layers.add(new PaintLayer());paint.strokes.add(new PaintFill({bounds:{x:0,y:0,width:4096,height:4096},color:'#804020',opacity:.5}));document.layers.add(new TextLayer({text:'Native TIFF output',fontFamily:'monospace',fontSize:64,x:2000,y:60}));print('TIFF timing ready');`);await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('TIFF timing ready');await page.getByRole('button',{name:'Close scripts',exact:true}).click();await page.evaluate(()=>document.fonts.ready);
 const samples=[];
 for(let trial=0;trial<3;trial++){
  await page.getByRole('button',{name:'Export…',exact:true}).click();const dialog=page.locator('.export-dialog');await dialog.getByLabel('Format',{exact:true}).selectOption(format);
  await page.evaluate(async extension=>{
   const tasks:{start:number;duration:number}[]=[],observer=new PerformanceObserver(list=>{for(const e of list.getEntries())tasks.push({start:e.startTime,duration:e.duration});});observer.observe({type:'longtask'});
   const controlStart=performance.now();await new Promise<void>(resolve=>setTimeout(()=>{const start=performance.now();while(performance.now()-start<75){}resolve();},0));await new Promise(resolve=>setTimeout(resolve,100));
   const control=tasks.filter(t=>t.start>=controlStart&&t.duration>=50);if(!control.length)throw new Error('Native long-task positive control was not observed');
   const state={start:0,end:0,frames:0,last:0,maxFrameGap:0,control,tasks,observer,restore:()=>{}};(window as unknown as {tiffTiming:typeof state}).tiffTiming=state;
   const tick=()=>{if(!state.start||state.end)return;const now=performance.now();state.maxFrameGap=Math.max(state.maxFrameGap,now-state.last);state.last=now;state.frames++;requestAnimationFrame(tick);};
   const click=(event:MouseEvent)=>{if(!(event.target instanceof Element)||event.target.closest('button')?.textContent?.trim()!=='Export .'+extension)return;document.removeEventListener('click',click,true);state.start=state.last=performance.now();requestAnimationFrame(tick);};document.addEventListener('click',click,true);
   const original=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download.endsWith('.'+extension)&&this.href.startsWith('blob:'))state.end=performance.now();return original.call(this);};state.restore=()=>{HTMLAnchorElement.prototype.click=original;document.removeEventListener('click',click,true);observer.disconnect();};
  },extension);
  const pending=page.waitForEvent('download');await dialog.getByRole('button',{name:'Export .'+extension,exact:true}).click();await(await pending).saveAs(info.outputPath('timed-'+trial+'.'+extension));
  const result=await page.evaluate(async()=>{await new Promise(resolve=>setTimeout(resolve,100));const s=(window as unknown as {tiffTiming:{start:number;end:number;frames:number;maxFrameGap:number;control:{start:number;duration:number}[];tasks:{start:number;duration:number}[];observer:PerformanceObserver;restore:()=>void}}).tiffTiming;for(const e of s.observer.takeRecords())s.tasks.push({start:e.startTime,duration:e.duration});s.restore();return{start:s.start,end:s.end,milliseconds:s.end-s.start,frames:s.frames,maxFrameGap:s.maxFrameGap,positiveControl:s.control,longTasks:s.tasks.filter(t=>t.start<s.end&&t.start+t.duration>s.start),browser:navigator.userAgent};});expect(result.start).toBeGreaterThan(0);expect(result.end).toBeGreaterThan(result.start);expect(result.frames).toBeGreaterThan(0);samples.push(result);
 }
 await info.attach(format+'-production-responsiveness',{body:JSON.stringify({width:4096,height:4096,samples,limits:'Click to real Blob download dispatch; animation frames are scheduling evidence, not physical presentation. Local Chromium only; long tasks and peak memory require broader F14 acceptance.'}),contentType:'application/json'});
});

test('production documented PSB exports wide pixel layers and reopens through actual preflight',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 const source=(await readFile('docs/SCRIPTING_API.md','utf8')).match(/<!-- example: psb-composition -->\s*```js\n([\s\S]*?)\n```/)?.[1];expect(source).toBeTruthy();
 await page.goto('/');expect(await page.evaluate(()=>'luma'in window)).toBe(false);
 await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();await page.getByLabel('Script code',{exact:true}).fill(source!);await page.getByRole('button',{name:'Run script',exact:true}).click();
 await expect(page.getByLabel('Script output')).toContainText('PSB composition ready');await page.getByRole('button',{name:'Close scripts',exact:true}).click();await expect(page.locator('.layer-row')).toHaveCount(2);
 async function download(action:()=>Promise<unknown>,name:string){const pending=page.waitForEvent('download');await action();const path=info.outputPath(name);await(await pending).saveAs(path);return path;}
 const png=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),'reference.png');
 const project=await download(()=>page.getByRole('button',{name:'Save project',exact:true}).click(),'wide.luma');
 await page.keyboard.press('Control+z');await expect(page.locator('.layer-row')).toHaveCount(0);await page.keyboard.press('Control+Shift+z');await expect(page.locator('.layer-row')).toHaveCount(2);await page.getByTestId('project-input').setInputFiles(project);
 const cases=[];let layered='';
 for(const mode of ['layers','flatten']){
  await page.getByRole('button',{name:'Export…',exact:true}).click();const dialog=page.locator('.export-dialog');await dialog.getByLabel('Format',{exact:true}).selectOption('psd');await expect(dialog).toContainText('Choose PSB');
  await dialog.getByLabel('Format',{exact:true}).selectOption('psb');await dialog.getByLabel('PSB layers',{exact:true}).selectOption(mode);await expect(dialog).toContainText('PSB-compatible reader');await expect(dialog).toContainText('38417 × 160');
  const path=await download(()=>dialog.getByRole('button',{name:'Export .psb',exact:true}).click(),mode+'.psb');if(mode==='layers')layered=path;
  cases.push({path,reference:png,format:'psb',names:mode==='layers'?['PSB artwork','PSB caption']:['Untitled'],visibility:mode==='layers'?[true,true]:[true],singleLayerReference:mode==='flatten'});
 }
 const manifest=info.outputPath('cases.json');await writeFile(manifest,JSON.stringify(cases));const checked=spawnSync(process.env.CANOLI_PSB_PYTHON||'python3',['scripts/check-photoshop-export.py',manifest],{encoding:'utf8',timeout:120000});expect(checked.status,checked.stderr||checked.stdout).toBe(0);
 await page.getByTestId('psd-input').setInputFiles(layered);const preflight=page.getByRole('dialog',{name:'Import PSB — Preflight Inspection',exact:true});await expect(preflight).toBeVisible();await expect(preflight).toContainText('38417 × 160');await preflight.getByRole('button',{name:'Import Layers',exact:true}).click();await expect(preflight).not.toBeVisible();
 await expect(page.getByRole('button',{name:'Select PSB caption',exact:true})).toBeVisible();
 const reopened=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),'reopened.png');
 const pixels=spawnSync(process.env.CANOLI_PSB_PYTHON||'python3',['-c',"from PIL import Image;import numpy as np,sys;a=np.asarray(Image.open(sys.argv[1]).convert('RGBA')).astype(int);b=np.asarray(Image.open(sys.argv[2]).convert('RGBA')).astype(int);assert a.shape==b.shape==(160,38417,4);alpha=int(np.abs(a[:,:,3]-b[:,:,3]).max());rgb=float(np.abs(a[:,:,:3]*a[:,:,3:4]/255-b[:,:,:3]*b[:,:,3:4]/255).max());assert alpha<=1 and rgb<=1,(alpha,rgb);print(alpha,rgb)",png,reopened],{encoding:'utf8',timeout:30000});expect(pixels.status,pixels.stderr||pixels.stdout).toBe(0);expect(errors).toEqual([]);
 await info.attach('production-psb-independent',{body:checked.stdout,contentType:'application/json'});await info.attach('production-psb-reopen',{body:JSON.stringify({pixels:pixels.stdout,noDeveloperGlobal:true}),contentType:'application/json'});
});

test('production documented PDF exports native pixels at 72 and 300 DPI through save, undo and reopen',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 const source=(await readFile('docs/SCRIPTING_API.md','utf8')).match(/<!-- example: pdf-composition -->\s*```js\n([\s\S]*?)\n```/)?.[1];expect(source).toBeTruthy();
 await page.goto('/');expect(await page.evaluate(()=>'luma'in window)).toBe(false);
 await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();await page.getByLabel('Script code',{exact:true}).fill(source!);await page.getByRole('button',{name:'Run script',exact:true}).click();
 await expect(page.getByLabel('Script output')).toContainText('PDF composition ready');await page.getByRole('button',{name:'Close scripts',exact:true}).click();await expect(page.locator('.layer-row')).toHaveCount(2);
 async function download(action:()=>Promise<unknown>,name:string){const pending=page.waitForEvent('download');await action();const path=info.outputPath(name);await(await pending).saveAs(path);return path;}
 const png=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),'reference.png');
 const project=await download(()=>page.getByRole('button',{name:'Save project',exact:true}).click(),'composition.luma');
 await page.keyboard.press('Control+z');await expect(page.locator('.layer-row')).toHaveCount(0);await page.keyboard.press('Control+Shift+z');await expect(page.locator('.layer-row')).toHaveCount(2);
 await page.getByTestId('project-input').setInputFiles(project);await expect(page.locator('.layer-row')).toHaveCount(2);
 const results=[];
 for(const dpi of [72,300]){
  await page.getByRole('button',{name:'Export…',exact:true}).click();const dialog=page.locator('.export-dialog');await dialog.getByLabel('Format',{exact:true}).selectOption('pdf');
  const resolution=dialog.getByRole('spinbutton',{name:'PDF resolution',exact:true});await expect(resolution).toHaveValue('72');if(dpi!==72){await resolution.fill(String(dpi));await resolution.press('Enter');}
  await expect(dialog).toContainText('not searchable or selectable');await expect(dialog).toContainText('Native pixels stay unchanged');await expect(dialog).toContainText('not PDF/X');
  const pdf=await download(()=>dialog.getByRole('button',{name:'Export .pdf',exact:true}).click(),dpi+'.pdf');await expect(dialog).not.toBeVisible();
  const checked=spawnSync(process.env.CANOLI_PDF_PYTHON||'python3',['scripts/check-pdf-interoperability.py',pdf,png,'--dpi',String(dpi)],{encoding:'utf8',timeout:120000});
  expect(checked.status,checked.stderr||checked.stdout).toBe(0);results.push(JSON.parse(checked.stdout));
 }
 const reopened=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),'reopened.png');expect((await readFile(reopened)).equals(await readFile(png))).toBe(true);expect(errors).toEqual([]);
 await info.attach('production-pdf-independent',{body:JSON.stringify(results),contentType:'application/json'});
});

test('production documented TIFF exports exact classic/BigTIFF pixels after save, undo and reopen',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const guide=await readFile('docs/SCRIPTING_API.md','utf8'),source=guide.match(/<!-- example: tiff-composition -->\s*```js\n([\s\S]*?)\n```/)?.[1];expect(source).toBeTruthy();await page.goto('/');expect(await page.evaluate(()=>'luma' in window)).toBe(false);
 await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();await page.getByLabel('Script code',{exact:true}).fill(source!);await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('TIFF composition ready');await page.getByRole('button',{name:'Close scripts',exact:true}).click();await expect(page.locator('.layer-row')).toHaveCount(2);
 async function downloaded(click:()=>Promise<unknown>,path:string){const pending=page.waitForEvent('download');await click();const output=await pending;await output.saveAs(path);return output.suggestedFilename();}
 const png=info.outputPath('reference.png');await downloaded(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),png);const project=info.outputPath('composition.luma');expect(await downloaded(()=>page.getByRole('button',{name:'Save project',exact:true}).click(),project)).toMatch(/\.luma$/);await page.keyboard.press('Control+z');await expect(page.locator('.layer-row')).toHaveCount(0);await page.keyboard.press('Control+Shift+z');await expect(page.locator('.layer-row')).toHaveCount(2);await page.getByTestId('project-input').setInputFiles(project);await expect(page.locator('.layer-row')).toHaveCount(2);
 const cases=[];for(const variant of ['auto','classic','big']){
  await page.getByRole('button',{name:'Export…',exact:true}).click();const dialog=page.locator('.export-dialog');await dialog.getByLabel('Format',{exact:true}).selectOption('tiff');await dialog.getByLabel('TIFF compatibility').selectOption(variant);await expect(dialog).toContainText('one flattened image');await expect(dialog).toContainText('72 DPI');await expect(dialog).toContainText('2081 × 160');
  const path=info.outputPath(variant+'.tif');expect(await downloaded(()=>dialog.getByRole('button',{name:'Export .tif',exact:true}).click(),path)).toMatch(/\.tif$/);cases.push({path,width:2081,height:160,bigTiff:variant==='big',referencePng:png});await expect(dialog).toHaveCount(0);
 }
 const manifest=info.outputPath('tiff-cases.json');await writeFile(manifest,JSON.stringify(cases));const checked=spawnSync('python3',['scripts/check-tiff-interoperability.py',manifest],{encoding:'utf8',timeout:120000});expect(checked.status,checked.stderr||checked.stdout).toBe(0);await info.attach('production-tiff-independent',{body:checked.stdout,contentType:'application/json'});expect(errors).toEqual([]);
});

test("docs highlight examples without JavaScript and keep long code keyboard-scrollable", async ({
  browser,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  try {
    for (const [path, languages] of [
      ["scripting-api", ["javascript"]],
      ["api", ["bash", "http", "json"]],
      ["plugins", ["json"]],
    ] as const) {
      await page.goto(`http://127.0.0.1:4173/developer/${path}.html`);
      for (const language of languages) {
        const code = page
          .locator(`.syntax-highlighter code.language-${language}`)
          .first();
        await expect(code).toBeVisible();
        expect(
          await code.locator('span[class^="hljs-"]').count(),
        ).toBeGreaterThan(0);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    await page.goto("http://127.0.0.1:4173/developer/scripting-api.html");
    // Native focusable pre retains text selection/copy and horizontal keyboard scrolling.
    const pre = page.locator(".syntax-highlighter pre").first();
    await pre.focus();
    await expect(pre).toBeFocused();
    await expect(pre).toHaveAttribute("aria-label", "JavaScript code example");
    expect(
      await pre.evaluate((node) => node.scrollWidth > node.clientWidth),
    ).toBe(true);
    await page.keyboard.press("End");
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(() => pre.evaluate((node) => node.scrollLeft))
      .toBeGreaterThan(0);
  } finally {
    await context.close();
  }
});

test("production docs, fragment links and installed plugin commands work without developer globals", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  expect(await page.evaluate(() => "luma" in window)).toBe(false);
  const popup = context.waitForEvent("page");
  await page.getByRole("link", { name: "Developer docs", exact: true }).click();
  const guide = await popup;
  await expect(
    guide.getByRole("heading", { name: "Scripting API", exact: true }),
  ).toBeVisible();
  const broken = await guide.evaluate(() =>
    [...document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')]
      .map((a) => a.hash)
      .filter(
        (hash) => !document.getElementById(decodeURIComponent(hash.slice(1))),
      ),
  );
  expect(broken).toEqual([]);
  await guide
    .getByRole("navigation", { name: "Documentation" })
    .getByRole("link", { name: "Plugins", exact: true })
    .click();
  await expect(
    guide.getByRole("heading", { name: "Plugins and extensions", exact: true }),
  ).toBeVisible();
  await guide.close();
  await page.getByRole("button", { name: "Plugins (Mod+Shift+L)" }).click();
  await page.getByRole("button", { name: "Load example", exact: true }).click();
  await page
    .getByRole("button", { name: "Install plugin", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Run Add guide frame", exact: true })
    .click();
  await expect(page.getByLabel("Plugin output")).toContainText("Finished.");
  await page
    .getByRole("button", { name: "Close plugins", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Select Guide frame", exact: true }),
  ).toBeVisible();
  const exported = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export PNG", exact: true }).click();
  expect((await exported).suggestedFilename()).toMatch(/\.png$/);
  await page.keyboard.press("Control+z");
  await expect(page.locator(".layer-row")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("production brush and pencil draw live, commit and undo without developer globals", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page
    .getByRole("button", { name: "Brush tool (B)", exact: true })
    .click();
  const box = (await page.locator(".canvas-wrap").boundingBox())!;
  const image = () =>
    page
      .locator(".canvas-wrap canvas")
      .evaluate((node) => (node as HTMLCanvasElement).toDataURL());
  const empty = await image();
  await page.mouse.move(box.x + 70, box.y + 70);
  await page.mouse.down();
  await page.mouse.move(box.x + 250, box.y + 70, { steps: 24 });
  await expect.poll(image).not.toBe(empty);
  await page.mouse.up();
  await expect(
    page.getByRole("button", { name: "Select Brush painting", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Control+z");
  await expect(page.locator(".layer-row")).toHaveCount(0);
  await page.keyboard.press("Control+Shift+z");
  await page
    .getByRole("button", { name: "Select Brush painting", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Pencil tool (N)", exact: true })
    .click();
  const brush = await image();
  await page.mouse.move(box.x + 70, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 250, box.y + 100, { steps: 24 });
  await expect.poll(image).not.toBe(brush);
  await page.mouse.up();
  await page.keyboard.press("Control+z");
  await expect.poll(image).toBe(brush);
  await expect(page.locator(".layer-row")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("appearance follows the OS, persists overrides, and synchronizes editor and docs", async ({
  page,
  context,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  const root = page.locator("html");
  const appearance = page.getByRole("combobox", {
    name: "Appearance",
    exact: true,
    includeHidden: true,
  });
  await expect(root).toHaveAttribute("data-theme", "dark");
  await expect(appearance).toHaveValue("system");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(root).toHaveAttribute("data-theme", "light");
  await page
    .getByRole("button", { name: "Switch to dark mode", exact: true })
    .click();
  await page.reload();
  await expect(root).toHaveAttribute("data-theme", "dark");
  await expect(appearance).toHaveValue("dark");
  const guide = await context.newPage();
  await guide.goto("/developer/scripting-api.html");
  await expect(guide.locator("html")).toHaveAttribute("data-theme", "dark");
  await guide
    .getByRole("combobox", { name: "Appearance", exact: true })
    .selectOption("light");
  await expect(root).toHaveAttribute("data-theme", "light");
  await expect(appearance).toHaveValue("light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(root).toHaveAttribute("data-theme", "light");
  await page
    .getByRole("button", { name: "Switch to dark mode", exact: true })
    .focus();
  await page.keyboard.press("ArrowDown");
  await expect(appearance).toBeFocused();
  await appearance.selectOption("system");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Switch to light mode", exact: true }),
  ).toBeFocused();
  await expect(root).toHaveAttribute("data-theme", "dark");
  await expect(
    guide.getByRole("combobox", { name: "Appearance", exact: true }),
  ).toHaveValue("system");
  await guide.evaluate(() =>
    localStorage.setItem("luma.appearance.v1", "invalid"),
  );
  await expect(appearance).toHaveValue("system");
  await guide.close();
});

test("appearance changes preserve rendered pixels, export bytes, and undo history", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Brush tool (B)", exact: true })
    .click();
  const box = (await page.locator(".canvas-wrap").boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 150, box.y + 100, { steps: 8 });
  await page.mouse.up();
  await expect(
    page.getByRole("button", { name: "Undo (Mod+Z)", exact: true }),
  ).toBeEnabled();
  const exportBytes = async () => {
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export PNG", exact: true }).click();
    const download = await pending;
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  };
  const image = () =>
    page
      .locator(".canvas-wrap canvas")
      .evaluate((node) => (node as HTMLCanvasElement).toDataURL());
  const before = await exportBytes();
  const pixels = await image();
  for (const theme of ["dark", "light"]) {
    if ((await page.locator("html").getAttribute("data-theme")) !== theme) {
      await page
        .getByRole("button", { name: `Switch to ${theme} mode`, exact: true })
        .click();
    }
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    expect(await image()).toBe(pixels);
    expect(await exportBytes()).toEqual(before);
  }
  await page.getByRole("button", { name: "Undo (Mod+Z)", exact: true }).click();
  await expect(page.locator(".layer-row")).toHaveCount(0);
});

test("appearance works with unavailable storage and docs honor the OS without JavaScript", async ({
  browser,
}) => {
  const context = await browser.newContext({ colorScheme: "light" });
  await context.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("Blocked", "SecurityError");
      },
    });
  });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4173/");
  await page
    .getByRole("button", { name: "Switch to dark mode", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await context.close();
  const staticContext = await browser.newContext({
    javaScriptEnabled: false,
    colorScheme: "light",
  });
  const guide = await staticContext.newPage();
  await guide.goto("http://127.0.0.1:4173/developer/api.html");
  expect(
    await guide
      .locator("body")
      .evaluate((node) => getComputedStyle(node).backgroundColor),
  ).toBe("rgb(244, 243, 237)");
  await guide.emulateMedia({ colorScheme: "dark" });
  expect(
    await guide
      .locator("body")
      .evaluate((node) => getComputedStyle(node).backgroundColor),
  ).toBe("rgb(24, 28, 27)");
  await staticContext.close();
});

test("production metadata worker reads imported file facts and exports a private-field-free sidecar", async ({
  page,
}) => {
  await page.goto("/");
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 17;
    canvas.height = 23;
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((value) => resolve(value!)),
    );
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  await page.getByTestId("import-input").setInputFiles({
    name: "private-name.png",
    mimeType: "image/png",
    buffer: Buffer.from(bytes),
  });
  await page.getByText("Asset info", { exact: true }).click();
  const info = page.getByRole("region", { name: "Asset information" });
  await expect(info).toContainText("Decoded width");
  await expect(info).toContainText("private-name.png");
  await expect(
    info.getByRole("checkbox", { name: /Include private fields/ }),
  ).not.toBeChecked();
  const downloading = page.waitForEvent("download");
  await info.getByRole("button", { name: "Export metadata sidecar" }).click();
  const stream = await (await downloading).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const sidecar = JSON.parse(Buffer.concat(chunks).toString());
  expect(
    sidecar.fields.find((field: { id: string }) => field.id === "file:width")
      .value,
  ).toBe(17);
  expect(
    sidecar.fields.some(
      (field: { privacy: string }) => field.privacy === "private",
    ),
  ).toBe(false);
});

test("production scripting creates an editable Bézier layer mask with no developer globals", async ({
  page,
}) => {
  await page.goto("/");
  expect(await page.evaluate(() => "luma" in window)).toBe(false);
  await page
    .getByRole("button", { name: "Scripts (Mod+Shift+K)", exact: true })
    .click();
  await page.getByLabel("Script code").fill(`
    document.resize(200,120);
    const layer = document.layers.add(new PaintLayer({name:"Masked paint"}));
    layer.strokes.add(new PaintFill({bounds:{x:0,y:0,width:100,height:100},color:"#ee9955"}));
    layer.mask = new LayerMask({paths:[new VectorPath({closed:true,points:[{x:10,y:40,in:{x:10,y:0},out:{x:10,y:80}},{x:70,y:40,in:{x:70,y:80},out:{x:70,y:0}}]})],feather:8});
    document.selectedLayer = layer;
    layer.mask=layer.mask.paint(new BrushStroke({points:[{x:40,y:40}],size:10}),"hide");
    print("Geometry",layer.mask.kind,layer.mask.paths.length);
    print("Mask density", layer.mask.density);
  `);
  await page.getByRole("button", { name: "Run script", exact: true }).click();
  await expect(page.getByLabel("Script output")).toContainText(
    "Mask density 1",
  );
  await expect(page.getByLabel("Script output")).toContainText(
    "Geometry vector 1",
  );
  await page
    .getByRole("button", { name: "Close scripts", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "Enable layer mask" }),
  ).toBeChecked();
  await expect(
    page.getByRole("spinbutton", { name: "Mask feather value", exact: true }),
  ).toHaveValue("8");
  const link = page.getByRole("checkbox", {
    name: "Link mask to layer",
    exact: true,
  });
  await link.uncheck();
  const maskX = page.getByRole("spinbutton", { name: "Mask X", exact: true });
  await maskX.fill("5");
  await maskX.press("Enter");
  await page.getByRole("button", { name: "Undo (Mod+Z)", exact: true }).click();
  await expect(maskX).toHaveValue("0");
  await expect(link).not.toBeChecked();
  await page
    .getByRole("combobox", { name: "Move target", exact: true })
    .selectOption("mask");
  await page.getByLabel("Editing canvas", { exact: true }).focus();
  await page.keyboard.press("Shift+ArrowRight");
  await expect(maskX).toHaveValue("10");
  await page.keyboard.press("Control+z");
  await expect(maskX).toHaveValue("0");
  await page.getByRole("checkbox", { name: "Invert layer mask" }).check();
  await page.getByRole("button", { name: "Undo (Mod+Z)", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "Invert layer mask" }),
  ).not.toBeChecked();
  await page
    .getByRole("button", { name: "Vector pen (P)", exact: true })
    .click();
  await page.keyboard.press("Control+1");
  await page
    .getByRole("combobox", { name: "Pen target", exact: true })
    .selectOption("mask");
  const box = (await page.locator(".canvas-wrap").boundingBox())!;
  const artwork = () =>
    page
      .locator(".canvas-wrap canvas")
      .evaluate((node) => (node as HTMLCanvasElement).toDataURL());
  const before = await artwork();
  const anchors = page.locator('.drawing-overlay rect[stroke="#d5e79b"]');
  await expect(anchors).toHaveCount(2);
  await page.mouse.click(box.x + 40, box.y + 70);
  await expect(anchors).toHaveCount(3);
  await page.getByRole("button", { name: "Undo (Mod+Z)", exact: true }).click();
  await expect(anchors).toHaveCount(2);
  await expect.poll(artwork).toBe(before);
  await page.mouse.click(box.x + 10, box.y + 40);
  await page
    .getByRole("button", { name: "Insert midpoint", exact: true })
    .click();
  await expect(anchors).toHaveCount(3);
  await page.getByRole("button", { name: "Undo (Mod+Z)", exact: true }).click();
  await expect(anchors).toHaveCount(2);
  await expect.poll(artwork).toBe(before);
  await page.getByRole("button", { name: "New contour", exact: true }).click();
  for (const [x, y] of [
    [30, 30],
    [50, 30],
    [50, 50],
  ])
    await page.mouse.click(box.x + x, box.y + y);
  await page.keyboard.press("Enter");
  await expect(anchors).toHaveCount(5);
  await page.getByRole("button", { name: "Undo (Mod+Z)", exact: true }).click();
  await expect(anchors).toHaveCount(2);
  await expect.poll(artwork).toBe(before);
  await page.mouse.move(box.x + 10, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 20, box.y + 40, { steps: 3 });
  await page.mouse.up();
  await expect.poll(artwork).not.toBe(before);
  await page.getByRole("button", { name: "Undo (Mod+Z)", exact: true }).click();
  await expect.poll(artwork).toBe(before);
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export PNG", exact: true }).click();
  expect((await downloading).suggestedFilename()).toMatch(/\.png$/);
});

test("production painted masks expose brush targets and export through the bundled renderer", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Scripts (Mod+Shift+K)", exact: true })
    .click();
  await page.getByLabel("Script code").fill(`
    document.resize(200,150);
    const layer=document.layers.add(new PaintLayer({name:"Painted mask"}));
    layer.strokes.add(new PaintFill({bounds:{x:0,y:0,width:200,height:150},color:"#ffaa55"}));
    layer.mask=new LayerMask({base:1,feather:4}).paint(new BrushStroke({points:[{x:60,y:60}],size:30}),"hide");
    document.selectedLayer=layer;print(layer.mask.kind,layer.mask.strokes.length);
  `);
  await page.getByRole("button", { name: "Run script", exact: true }).click();
  await expect(page.getByLabel("Script output")).toContainText("paint 1");
  await page
    .getByRole("button", { name: "Close scripts", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Brush tool (B)", exact: true })
    .click();
  await page.keyboard.press("Control+1");
  await page
    .getByRole("combobox", { name: "Paint target", exact: true })
    .selectOption("mask-reveal");
  // Compare the completed 100% frame; an earlier fit-zoom frame has different dimensions.
  await expect(page.locator(".canvas-wrap canvas")).toHaveJSProperty("width", 200);
  await expect(page.locator(".canvas-wrap canvas")).toHaveJSProperty("height", 150);
  await expect(page.locator("footer .status-dot.working")).toHaveCount(0);
  const box = (await page.locator(".canvas-wrap").boundingBox())!;
  const artwork = () =>
    page
      .locator(".canvas-wrap canvas")
      .evaluate((node) => (node as HTMLCanvasElement).toDataURL());
  const before = await artwork();
  await page.mouse.move(box.x + 60, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 65, box.y + 60, { steps: 3 });
  await expect.poll(artwork).not.toBe(before);
  await page.mouse.up();
  await page.getByRole("button", { name: "Undo (Mod+Z)", exact: true }).click();
  await expect.poll(artwork).toBe(before);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export PNG", exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.png$/);
});

test("production crop uses precise bounds and on-canvas frames before export", async ({
  page,
}) => {
  await page.goto("/");
  expect(await page.evaluate(() => "luma" in window)).toBe(false);
  await page
    .getByRole("button", { name: "Scripts (Mod+Shift+K)", exact: true })
    .click();
  await page.getByLabel("Script code").fill(`
    document.resize(160,120);
    const layer=document.layers.add(new PaintLayer({name:"Crop artwork"}));
    layer.strokes.add(new PaintFill({bounds:{x:0,y:0,width:160,height:120},color:"#ee9955"}));
    document.selectedLayer=layer;
    document.selection=new MarqueeSelection({shape:"rectangle",x:20,y:15,width:80,height:60});
    print("Ready to crop");
  `);
  await page.getByRole("button", { name: "Run script", exact: true }).click();
  await expect(page.getByLabel("Script output")).toContainText("Ready to crop");
  await page
    .getByRole("button", { name: "Close scripts", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Crop canvas (C)", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Precise bounds…", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Crop canvas", exact: true });
  await expect(
    dialog.getByRole("spinbutton", { name: "Crop X", exact: true }),
  ).toHaveValue("20");
  await dialog.getByRole("button", { name: "Apply crop", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Undo (Mod+Z)", exact: true }).click();
  await page
    .getByRole("button", { name: "Redo (Mod+Shift+Z)", exact: true })
    .click();
  await page.keyboard.press("Control+1");
  await page.getByRole("button", { name: "New frame", exact: true }).click();
  const box = (await page.locator(".canvas-wrap").boundingBox())!;
  await page.mouse.move(box.x + 5, box.y + 5);
  await page.mouse.down();
  await page.mouse.move(box.x + 65, box.y + 45, { steps: 3 });
  await page.mouse.up();
  await expect(
    page.getByRole("group", { name: "Crop frame", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("group", { name: "Crop frame", exact: true }),
  ).toHaveCount(0);
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export PNG", exact: true }).click();
  const stream = await (await downloading).createReadStream(),
    chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const png = Buffer.concat(chunks);
  expect(png.subarray(1, 4).toString()).toBe("PNG");
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([60, 40]);
});

test('production polygonal lasso and scripting work without developer globals', async ({page}) => {
  await page.goto('/');
  expect(await page.evaluate(() => 'luma' in window)).toBe(false);
  await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();
  await page.getByLabel('Script code',{exact:true}).fill(`
    document.resize(100,100);
    document.selectPolygon([{x:10,y:10},{x:80,y:10},{x:10,y:80}]);
    const layer=document.layers.add(new PaintLayer({name:'Polygon artwork'}));
    layer.strokes.add(new PaintFill({bounds:{x:0,y:0,width:100,height:100},color:'#ff0000'}));
    layer.maskFromSelection(document.selection);
    print('Polygon selected',document.selection.regions.length);
  `);
  await page.getByRole('button',{name:'Run script',exact:true}).click();
  await expect(page.getByLabel('Script output')).toContainText('Polygon selected 1');
  await page.getByRole('button',{name:'Close scripts',exact:true}).click();
  await page.getByLabel('Editing canvas',{exact:true}).focus();
  await page.keyboard.press('Control+d');
  await page.keyboard.press('Control+1');
  await page.keyboard.press('l');
  await page.getByRole('combobox',{name:'Lasso mode',exact:true}).selectOption('polygon');
  const box=(await page.locator('.canvas-wrap').boundingBox())!;
  for (const [x,y] of [[10,10],[80,10],[10,80]]) await page.mouse.click(box.x+x,box.y+y);
  await expect(page.getByTestId('lasso-preview')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('lasso-preview')).toHaveCount(0);
  await expect(page.getByTestId('pixel-selection-outline')).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('pixel-selection-outline')).toHaveCount(0);
  const downloading = page.waitForEvent('download');
  await page.getByRole('button',{name:'Export PNG',exact:true}).click();
  const stream=await (await downloading).createReadStream(),chunks:Buffer[]=[];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const alpha=await page.evaluate(async (bytes) => {
    const image=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/png'}));
    const canvas=document.createElement('canvas');canvas.width=canvas.height=100;
    const c=canvas.getContext('2d')!;c.drawImage(image,0,0);image.close();
    const data=c.getImageData(0,0,100,100).data;
    return [data[(20*100+20)*4+3],data[(70*100+70)*4+3]];
  },[...Buffer.concat(chunks)]);
  expect(alpha).toEqual([255,0]);
});

test('production selection feathering, controls and mask export use bundled worker code',async({page})=>{
  await page.goto('/');
  expect(await page.evaluate(()=>'luma' in window)).toBe(false);
  await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();
  await page.getByLabel('Script code',{exact:true}).fill(`
    document.resize(64,64);
    document.selection=new MarqueeSelection({shape:'rectangle',x:20,y:20,width:20,height:20});
    await document.modifySelection({operation:'feather',radius:3});
    const layer=document.layers.add(new PaintLayer({name:'Soft selection'}));
    layer.strokes.add(new PaintFill({bounds:{x:0,y:0,width:64,height:64},color:'#ff0000'}));
    layer.maskFromSelection(document.selection);
    print('Feathered selection',document.selection.regions.length);
  `);
  await page.getByRole('button',{name:'Run script',exact:true}).click();
  await expect(page.getByLabel('Script output')).toContainText('Feathered selection 1');
  await page.getByRole('button',{name:'Close scripts',exact:true}).click();
  await page.getByRole('button',{name:'Modify selection…',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Modify selection',exact:true});
  await dialog.getByRole('combobox',{name:'Selection modification',exact:true}).selectOption('contract');
  await dialog.getByRole('button',{name:'Apply selection',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  const downloadEvent=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export PNG',exact:true}).click();
  const stream=await(await downloadEvent).createReadStream(),chunks:Buffer[]=[];
  for await(const chunk of stream!)chunks.push(Buffer.from(chunk));
  const alpha=await page.evaluate(async bytes=>{
    const image=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/png'}));
    const c=document.createElement('canvas');c.width=c.height=64;
    const ctx=c.getContext('2d')!;ctx.drawImage(image,0,0);image.close();
    const data=ctx.getImageData(0,0,64,64).data;
    return[data[(30*64+30)*4+3],data[(20*64+20)*4+3],data[(5*64+5)*4+3]];
  },[...Buffer.concat(chunks)]);
  expect(alpha[0]).toBe(255);expect(alpha[2]).toBe(0);
  expect(alpha[1]).toBeGreaterThan(0);expect(alpha[1]).toBeLessThan(255);
});

test('production chromatic adjustment controls and exported masks work without developer globals',async({page})=>{
  await page.goto('/');expect(await page.evaluate(()=>'luma' in window)).toBe(false);
  await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();
  await page.getByLabel('Script code',{exact:true}).fill(`
    document.resize(64,32);
    const artwork=document.layers.add(new PaintLayer({name:'Original'}));
    artwork.strokes.add(new PaintFill({bounds:{x:0,y:0,width:64,height:32},color:'#507896'}));
    document.layers.add(new AdjustmentLayer({name:'Color balance',adjustment:{kind:'color-balance',shadows:{red:0,green:0,blue:0},midtones:{red:20,green:0,blue:0},highlights:{red:0,green:0,blue:0},preserveLuminosity:false}}));
    const vivid=document.layers.add(new AdjustmentLayer({name:'Vibrance',adjustment:{kind:'vibrance',vibrance:0,saturation:-100}}));
    vivid.maskFromSelection(new MarqueeSelection({shape:'rectangle',x:0,y:0,width:32,height:32}));
    document.selectedLayer=vivid;
    print('Chromatic layers',document.layers.length);
  `);
  await page.getByRole('button',{name:'Run script',exact:true}).click();
  await expect(page.getByLabel('Script output')).toContainText('Chromatic layers 3');
  await page.getByRole('button',{name:'Close scripts',exact:true}).click();
  await expect(page.getByLabel('Adjustment type',{exact:true})).toHaveValue('vibrance');
  await expect(page.getByRole('spinbutton',{name:'Vibrance saturation value',exact:true})).toHaveValue('-100');
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Export PNG',exact:true}).click();
  const stream=await(await downloading).createReadStream(),chunks:Buffer[]=[];
  for await(const chunk of stream!)chunks.push(Buffer.from(chunk));
  const pixels=await page.evaluate(async bytes=>{
    const image=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/png'}));
    const c=document.createElement('canvas');c.width=64;c.height=32;const ctx=c.getContext('2d')!;ctx.drawImage(image,0,0);image.close();
    return[4,48].map(x=>Array.from(ctx.getImageData(x,8,1,1).data));
  },[...Buffer.concat(chunks)]);
  expect(pixels[0][0]).toBe(pixels[0][1]);expect(pixels[0][1]).toBe(pixels[0][2]);expect(pixels[0][3]).toBe(255);
  expect(pixels[1][0]).toBeGreaterThan(80);expect(pixels[1].slice(1)).toEqual([120,150,255]);
});

test('production gradient maps expose editable stops and export masked reversed colors without developer globals',async({page})=>{
  await page.goto('/');expect(await page.evaluate(()=>'luma' in window)).toBe(false);
  await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();
  await page.getByLabel('Script code',{exact:true}).fill(`
    document.resize(64,32);
    const original=document.layers.add(new PaintLayer({name:'Original'}));
    original.strokes.add(new PaintFill({bounds:{x:0,y:0,width:64,height:32},color:'#808080'}));
    const gradient=document.layers.add(new AdjustmentLayer({name:'Duotone',adjustment:{kind:'gradient-map',stops:[{position:0,color:'#ff0000'},{position:1,color:'#0000ff'}],reverse:false}}));
    gradient.maskFromSelection(new MarqueeSelection({shape:'rectangle',x:0,y:0,width:32,height:32}));
    document.selectedLayer=gradient;print('Gradient map ready');
  `);
  await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('Gradient map ready');
  await page.getByRole('button',{name:'Close scripts',exact:true}).click();
  await expect(page.getByLabel('Adjustment type',{exact:true})).toHaveValue('gradient-map');
  await expect(page.getByLabel('Stop 1 color',{exact:true})).toHaveValue('#ff0000');
  await page.getByLabel('Reverse gradient map',{exact:true}).check();
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Export PNG',exact:true}).click();
  const stream=await(await downloading).createReadStream(),chunks:Buffer[]=[];
  for await(const chunk of stream!)chunks.push(Buffer.from(chunk));
  const pixels=await page.evaluate(async bytes=>{
    const image=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/png'}));
    const c=document.createElement('canvas');c.width=64;c.height=32;const ctx=c.getContext('2d')!;ctx.drawImage(image,0,0);image.close();
    return[4,48].map(x=>Array.from(ctx.getImageData(x,8,1,1).data));
  },[...Buffer.concat(chunks)]);
  expect(pixels).toEqual([[128,0,127,255],[128,128,128,255]]);
});

test('production PSD renders adjustments and pixel layers, then reopens its exported layer stack',async({page})=>{
  await page.goto('/');expect(await page.evaluate(()=>'luma' in window)).toBe(false);
  await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();
  await page.getByLabel('Script code',{exact:true}).fill(`
    document.resize(64,32);
    const paint=document.layers.add(new PaintLayer({name:'Original'}));
    paint.strokes.add(new PaintFill({bounds:{x:0,y:0,width:64,height:32},color:'#808080'}));
    document.layers.add(new AdjustmentLayer({name:'Duotone',adjustment:{kind:'gradient-map',reverse:false,stops:[{position:0,color:'#ff0000'},{position:1,color:'#0000ff'}]}}));
    const top=document.layers.add(new PaintLayer({name:'Independent top'}));
    top.strokes.add(new PaintFill({bounds:{x:40,y:0,width:24,height:32},color:'#00ff00'}));
    print('PSD artwork ready');
  `);
  await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('PSD artwork ready');
  await page.getByRole('button',{name:'Close scripts',exact:true}).click();
  await page.getByRole('button',{name:'Export…',exact:true}).click();const dialog=page.locator('.export-dialog');
  await dialog.getByLabel('Format',{exact:true}).selectOption('psd');
  await expect(dialog.getByLabel('PSD layers',{exact:true})).toHaveValue('layers');
  await expect(dialog).toContainText('bottom 2 top-level layers are merged through “Duotone”');
  const pending=page.waitForEvent('download');await dialog.getByRole('button',{name:'Export .psd',exact:true}).click();
  const download=await pending,stream=await download.createReadStream(),chunks:Buffer[]=[];
  for await(const chunk of stream!)chunks.push(Buffer.from(chunk));const psd=Buffer.concat(chunks);
  expect(psd.subarray(0,4).toString()).toBe('8BPS');expect(psd.readUInt32BE(14)).toBe(32);expect(psd.readUInt32BE(18)).toBe(64);
  await page.getByTestId('psd-input').setInputFiles({name:'rendered.psd',mimeType:'image/vnd.adobe.photoshop',buffer:psd});
  const importing=page.locator('.psd-import-dialog');await expect(importing).toContainText('2 layers');
  await importing.getByRole('button',{name:'Import Layers',exact:true}).click();await expect(importing).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Select Independent top',exact:true})).toBeVisible();
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Export PNG',exact:true}).click();
  const pngStream=await(await downloading).createReadStream(),pngChunks:Buffer[]=[];for await(const chunk of pngStream!)pngChunks.push(Buffer.from(chunk));
  const pixels=await page.evaluate(async bytes=>{
    const image=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/png'})),c=document.createElement('canvas');c.width=64;c.height=32;
    const ctx=c.getContext('2d')!;ctx.drawImage(image,0,0);image.close();return[4,48].map(x=>Array.from(ctx.getImageData(x,8,1,1).data));
  },[...Buffer.concat(pngChunks)]);
  expect(pixels).toEqual([[127,0,128,255],[0,255,0,255]]);
});

test('production white balance uses bundled controls and WASM for a masked PNG without developer globals',async({page})=>{
  await page.goto('/');expect(await page.evaluate(()=>'luma' in window)).toBe(false);
  await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();
  await page.getByLabel('Script code',{exact:true}).fill(`
    document.resize(64,32);
    const original=document.layers.add(new PaintLayer({name:'Original'}));
    original.strokes.add(new PaintFill({bounds:{x:0,y:0,width:64,height:32},color:'#808080'}));
    const balance=document.layers.add(new AdjustmentLayer({name:'White balance',adjustment:{kind:'white-balance',temperature:6504,tint:0}}));
    balance.maskFromSelection(new MarqueeSelection({shape:'rectangle',x:0,y:0,width:32,height:32}));
    document.selectedLayer=balance;print('White balance ready');
  `);
  await page.getByRole('button',{name:'Run script',exact:true}).click();
  await expect(page.getByLabel('Script output')).toContainText('White balance ready');
  await page.getByRole('button',{name:'Close scripts',exact:true}).click();
  await expect(page.getByLabel('Adjustment type',{exact:true})).toHaveValue('white-balance');
  const temperature=page.getByRole('spinbutton',{name:'Temperature value',exact:true});
  await temperature.fill('12000');await temperature.press('Enter');
  const tint=page.getByRole('spinbutton',{name:'Tint value',exact:true});
  await tint.fill('20');await tint.press('Enter');
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Export PNG',exact:true}).click();
  const stream=await(await downloading).createReadStream(),chunks:Buffer[]=[];
  for await(const chunk of stream!)chunks.push(Buffer.from(chunk));
  const pixels=await page.evaluate(async bytes=>{
    const image=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/png'}));
    const canvas=document.createElement('canvas');canvas.width=64;canvas.height=32;
    const context=canvas.getContext('2d')!;context.drawImage(image,0,0);image.close();
    return[4,48].map(x=>Array.from(context.getImageData(x,8,1,1).data));
  },[...Buffer.concat(chunks)]);
  expect(pixels).toEqual([[141,127,104,255],[128,128,128,255]]);
});

test('production Cube file import, interpolation controls and masked PNG output work without developer globals',async({page})=>{
  await page.goto('/');expect(await page.evaluate(()=>'luma' in window)).toBe(false);
  await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();
  await page.getByLabel('Script code',{exact:true}).fill(`
    document.resize(64,32);
    const original=document.layers.add(new PaintLayer({name:'Original'}));
    original.strokes.add(new PaintFill({bounds:{x:0,y:0,width:64,height:32},color:'#507896'}));
    const look=new AdjustmentLayer({name:'Lookup'});
    look.setLut('LUT_1D_SIZE 2\\n0 0 0\\n1 1 1');document.layers.add(look);
    look.maskFromSelection(new MarqueeSelection({shape:'rectangle',x:0,y:0,width:32,height:32}));
    document.selectedLayer=look;print('Lookup ready');
  `);
  await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('Lookup ready');
  await page.getByRole('button',{name:'Close scripts',exact:true}).click();
  await page.getByLabel('LUT file',{exact:true}).setInputFiles({name:'swap.cube',mimeType:'text/plain',buffer:Buffer.from('TITLE "Production swap"\nLUT_3D_SIZE 2\n0 0 0\n0 0 1\n0 1 0\n0 1 1\n1 0 0\n1 0 1\n1 1 0\n1 1 1')});
  await expect(page.locator('.lut-controls')).toContainText('Production swap');
  await page.getByLabel('3D interpolation',{exact:true}).selectOption('trilinear');
  const amount=page.getByRole('spinbutton',{name:'LUT amount value',exact:true});await amount.fill('50');await amount.press('Enter');
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Export PNG',exact:true}).click();
  const stream=await(await downloading).createReadStream(),chunks:Buffer[]=[];for await(const chunk of stream!)chunks.push(Buffer.from(chunk));
  const pixels=await page.evaluate(async bytes=>{
    const image=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/png'})),canvas=document.createElement('canvas');canvas.width=64;canvas.height=32;
    const c=canvas.getContext('2d')!;c.drawImage(image,0,0);image.close();return[4,48].map(x=>Array.from(c.getImageData(x,8,1,1).data));
  },[...Buffer.concat(chunks)]);
  expect(pixels).toEqual([[115,120,115,255],[80,120,150,255]]);
});

test('production 65-point LUT import keeps the full table and records main-thread work',async({page})=>{
  const size=65,rows=['TITLE "Production 65"','LUT_3D_SIZE 65'];
  for(let b=0;b<size;b++)for(let g=0;g<size;g++)for(let r=0;r<size;r++)rows.push(`${b/(size-1)} ${g/(size-1)} ${r/(size-1)}`);
  const path=test.info().outputPath('production65.cube');await writeFile(path,rows.join('\n'));
  await page.goto('/');expect(await page.evaluate(()=>'luma' in window)).toBe(false);
  await page.keyboard.press('Control+k');await page.getByLabel('Search commands').fill('lookup');
  await page.getByRole('option',{name:'New Color Lookup (LUT) adjustment layer'}).click();
  await page.evaluate(()=>{(window as any).lutLongTasks=[];const observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())(window as any).lutLongTasks.push(entry.duration);});observer.observe({type:'longtask'});(window as any).lutObserver=observer;(window as any).lutStart=performance.now();});
  await page.getByLabel('LUT file',{exact:true}).setInputFiles(path);await expect(page.locator('.lut-controls')).toContainText('Production 65');
  const result=await page.evaluate(async()=>{await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));(window as any).lutObserver.disconnect();return{elapsedMs:performance.now()-(window as any).lutStart,longTasks:(window as any).lutLongTasks};});
  // Export round trip verifies all 65^3 entries without trusting a metadata label.
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Export .cube',exact:true}).click();
  const stream=await(await downloading).createReadStream(),chunks:Buffer[]=[];for await(const chunk of stream!)chunks.push(Buffer.from(chunk));
  const exported=Buffer.concat(chunks).toString(),entries=exported.trim().split('\n').filter(line=>/^[\d.-]/.test(line));
  expect(entries).toHaveLength(65**3);expect(entries[0]).toBe('0 0 0');expect(entries.at(-1)).toBe('1 1 1');
  console.log('Production 65-point LUT import:',JSON.stringify(result));
});

test('production Color Range samples actual colors, applies native coverage and exports a selection mask without developer globals',async({page})=>{
  await page.goto('/');expect(await page.evaluate(()=>'luma' in window)).toBe(false);
  await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();
  await page.getByLabel('Script code',{exact:true}).fill(`
    document.resize(64,32);
    const original=document.layers.add(new PaintLayer({name:'Original'}));
    original.strokes.add(new PaintFill({bounds:{x:0,y:0,width:32,height:32},color:'#ff0000'}));
    original.strokes.add(new PaintFill({bounds:{x:32,y:0,width:32,height:32},color:'#0000ff'}));
    document.selectedLayer=original;print('Color source ready');
  `);
  await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('Color source ready');
  await page.getByRole('button',{name:'Close scripts',exact:true}).click();await page.getByRole('button',{name:'Color Range…',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Color Range',exact:true});
  for(const [name,value] of [['Sample X','4'],['Sample Y','4']] as const){const field=dialog.getByRole('spinbutton',{name,exact:true});await field.fill(value);await field.press('Enter');}
  await dialog.getByRole('button',{name:'Sample pixel',exact:true}).click();await expect(dialog.getByLabel('Included color 1',{exact:true})).toHaveValue('#ff0000');
  const fuzziness=dialog.getByRole('spinbutton',{name:'Fuzziness value',exact:true});await fuzziness.fill('0');await fuzziness.press('Enter');
  await dialog.getByRole('button',{name:'Apply color range',exact:true}).click();await expect(dialog).toHaveCount(0);
  await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();await page.getByLabel('Script code',{exact:true}).fill(`document.selectedLayer.maskFromSelection(document.selection);print('Color mask ready');`);
  await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('Color mask ready');await page.getByRole('button',{name:'Close scripts',exact:true}).click();
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Export PNG',exact:true}).click();
  const stream=await(await downloading).createReadStream(),chunks:Buffer[]=[];for await(const chunk of stream!)chunks.push(Buffer.from(chunk));
  const pixels=await page.evaluate(async bytes=>{const image=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/png'})),canvas=document.createElement('canvas');canvas.width=64;canvas.height=32;const c=canvas.getContext('2d')!;c.drawImage(image,0,0);image.close();return[4,48].map(x=>Array.from(c.getImageData(x,4,1,1).data));},[...Buffer.concat(chunks)]);
  expect(pixels).toEqual([[255,0,0,255],[0,0,0,0]]);
});

test('production alpha channel constructors and Inspector load native coverage and export independent masks',async({page})=>{
  await page.goto('/');expect(await page.evaluate(()=>'luma' in window)).toBe(false);
  await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();await page.getByLabel('Script code',{exact:true}).fill(`
    document.resize(8,4);
    const source=document.layers.add(new PaintLayer({name:'Channel source'}));
    source.strokes.add(new PaintFill({color:'#ff0000',bounds:{x:0,y:0,width:8,height:4}}));
    document.selectedLayer=source;
    const channel=document.alphaChannels.add(new AlphaChannel({name:'Production alpha',selection:new MarqueeSelection({shape:'pixels',x:0,y:0,width:4,height:1,coverage:{width:4,height:1,runs:[1,255,2,128,4,0]}})}));
    await channel.load();print('Channel ready');
  `);await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('Channel ready');await page.getByRole('button',{name:'Close scripts',exact:true}).click();
  const panel=page.getByRole('region',{name:'Alpha channels',exact:true});await panel.getByRole('button',{name:/^Alpha channels/}).click();await expect(panel.getByLabel('Channel name',{exact:true})).toHaveValue('Production alpha');
  await panel.getByRole('button',{name:'Load channel selection',exact:true}).click();await expect(panel.getByRole('status').last()).toContainText('Loaded Production alpha');
  await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();await page.getByLabel('Script code',{exact:true}).fill(`document.selectedLayer.maskFromSelection(document.selection);print('Channel mask ready');`);await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('Channel mask ready');await page.getByRole('button',{name:'Close scripts',exact:true}).click();
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Export PNG',exact:true}).click();const stream=await(await downloading).createReadStream(),chunks:Buffer[]=[];for await(const chunk of stream!)chunks.push(Buffer.from(chunk));
  const alpha=await page.evaluate(async bytes=>{const image=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/png'})),canvas=document.createElement('canvas');canvas.width=8;canvas.height=4;const c=canvas.getContext('2d')!;c.drawImage(image,0,0);image.close();return[0,1,2,3].map(x=>c.getImageData(x,0,1,1).data[3]);},[...Buffer.concat(chunks)]);expect(alpha).toEqual([255,128,0,0]);
});

test('production Quick Selection brush and isolated refinement export real nonrectangular masks',async({page})=>{
  await page.goto('/');expect(await page.evaluate(()=>'luma' in window)).toBe(false);
  await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();
  await page.getByLabel('Script code',{exact:true}).fill(`
    document.resize(64,32);
    const source=document.layers.add(new PaintLayer({name:'Quick source'}));
    source.strokes.add(new PaintFill({color:'#0000ff',bounds:{x:0,y:0,width:64,height:32}}));
    source.strokes.add(new PaintFill({color:'#ff0000',bounds:{x:0,y:0,width:24,height:32}}));
    source.strokes.add(new PaintFill({color:'#ff0000',bounds:{x:24,y:24,width:16,height:8}}));
    source.strokes.add(new PaintFill({color:'#ff0000',bounds:{x:52,y:4,width:8,height:8}}));
    source.strokes.add(new PaintFill({color:'#0000ff',bounds:{x:8,y:8,width:4,height:4}}));
    document.selectedLayer=source;print('Quick source ready');
  `);
  await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('Quick source ready');
  await page.getByRole('button',{name:'Close scripts',exact:true}).click();
  await page.getByRole('button',{name:'Quick selection (Shift+W)',exact:true}).click();
  for(const [name,value] of [['Quick selection diameter value','1'],['Color tolerance value','0'],['Edge threshold value','0']]){
    const input=page.getByRole('spinbutton',{name,exact:true});await input.fill(value);await input.press('Enter');
  }
  await page.getByLabel('Editing canvas',{exact:true}).focus();await page.keyboard.press('Control+1');
  const box=(await page.locator('.canvas-wrap').boundingBox())!;await page.mouse.click(box.x+4.5,box.y+4.5);
  await expect(page.getByTestId('pixel-selection-outline')).toBeVisible();
  await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();
  await page.getByLabel('Script code',{exact:true}).fill(`
    if(!document.selection)throw new Error('Brush did not create a selection');
    await document.selectQuickSelection({points:[{x:54.5,y:8.5}],size:1,tolerance:0,edgeThreshold:0,operation:'add'});
    document.selectedLayer.maskFromSelection(document.selection);print('Quick mask ready');
  `);
  await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('Quick mask ready');
  await page.getByRole('button',{name:'Close scripts',exact:true}).click();
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Export PNG',exact:true}).click();
  const stream=await(await downloading).createReadStream(),chunks:Buffer[]=[];for await(const chunk of stream!)chunks.push(Buffer.from(chunk));
  const pixels=await page.evaluate(async bytes=>{
    const image=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/png'})),canvas=document.createElement('canvas');canvas.width=64;canvas.height=32;
    const c=canvas.getContext('2d')!;c.drawImage(image,0,0);image.close();return[[4,4],[30,28],[9,9],[54,8],[48,24]].map(([x,y])=>Array.from(c.getImageData(x,y,1,1).data));
  },[...Buffer.concat(chunks)]);
  expect(pixels).toEqual([[255,0,0,255],[255,0,0,255],[0,0,0,0],[255,0,0,255],[0,0,0,0]]);
});

test('production Select Subject preserves genuine source alpha through UI, isolated scripting and exported masks',async({page})=>{
  await page.goto('/');expect(await page.evaluate(()=>'luma' in window)).toBe(false);
  await page.getByTestId('import-input').setInputFiles('tests/fixtures/matting/cutout.png');
  await expect(page.locator('.document-summary')).toContainText('9 × 7');
  await page.getByRole('button',{name:'Subject',exact:true}).click();await expect(page.getByText('Subject selected',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();
  await page.getByLabel('Script code',{exact:true}).fill(`
    if(!document.selection || document.selection.regions[0].shape!=='pixels')throw new Error('Subject mask missing');
    await document.selectSubject({threshold:0.35});
    const channel=document.alphaChannels.capture('Production subject');
    document.selectedLayer.maskFromSelection(channel.selection);print('Subject mask ready');
  `);
  await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('Subject mask ready');
  await page.getByRole('button',{name:'Close scripts',exact:true}).click();
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Export PNG',exact:true}).click();
  const stream=await(await downloading).createReadStream(),chunks:Buffer[]=[];for await(const chunk of stream!)chunks.push(Buffer.from(chunk));
  const alpha=await page.evaluate(async bytes=>{
    const image=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/png'})),canvas=document.createElement('canvas');canvas.width=9;canvas.height=7;
    const c=canvas.getContext('2d')!;c.drawImage(image,0,0);image.close();return[[2,2],[3,2],[3,3],[7,5],[0,0]].map(([x,y])=>c.getImageData(x,y,1,1).data[3]);
  },[...Buffer.concat(chunks)]);expect(alpha).toEqual([255,64,0,16,0]);
});

test('production Refine Edge exposes corrected-layer output and isolated native matting exports real corrected RGB',async({page})=>{
  await page.goto('/');expect(await page.evaluate(()=>'luma' in window)).toBe(false);
  await page.getByTestId('import-input').setInputFiles('tests/fixtures/matting/color-line.png');await expect(page.locator('.layer-row')).toHaveCount(1);
  await page.getByRole('button',{name:'Refine',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Refine Edge',exact:true});await expect(dialog.getByTestId('refine-edge-apply')).toBeEnabled();
  await dialog.getByRole('checkbox',{name:'Decontaminate Colors',exact:true}).check();await expect(dialog.getByRole('combobox',{name:'Matting output',exact:true})).toHaveValue('new-layer');
  await expect(dialog.getByTestId('refine-edge-apply')).toBeEnabled();await dialog.screenshot({path:'/tmp/canoli-native-refine-edge.png'});await dialog.getByTestId('refine-edge-cancel').click();
  await page.getByTestId('import-input').setInputFiles('tests/fixtures/matting/color-line-trimap.png');await expect(page.locator('.layer-row')).toHaveCount(2);
  await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();await page.getByLabel('Script code',{exact:true}).fill(`
    const original=document.layers.at(0),labels=document.layers.at(1);
    labels.visible=false;document.selectedLayer=original;
    const sourceId=original.assetId;
    await original.refineEdge({solver:'color-line',radius:25,smoothness:0,decontaminate:true,trimapAssetId:labels.assetId});
    if(original.visible || original.assetId!==sourceId || document.selectedLayer.assetId===sourceId)throw new Error('Source preservation failed');
    print('Corrected matte ready');
  `);await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('Corrected matte ready');await page.getByRole('button',{name:'Close scripts',exact:true}).click();
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Export PNG',exact:true}).click();const stream=await(await downloading).createReadStream(),chunks:Buffer[]=[];for await(const chunk of stream!)chunks.push(Buffer.from(chunk));
  const pixel=await page.evaluate(async bytes=>{const image=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/png'})),canvas=document.createElement('canvas');canvas.width=9;canvas.height=5;const c=canvas.getContext('2d')!;c.drawImage(image,0,0);image.close();return Array.from(c.getImageData(4,2,1,1).data);},[...Buffer.concat(chunks)]);
  expect(pixel[3]).toBe(128);for(const [channel,value] of [199,20,11].entries())expect(Math.abs(pixel[channel]*128/255-value*128/255)).toBeLessThanOrEqual(1);
});

for(const name of ['wide-unknown','distant-native-patch'])test(`production global closed-form refinement solves ${name} with bundled workers and no developer globals`,async({page})=>{
  const fixture=JSON.parse(await readFile('tests/fixtures/matting/closed-form-reference.json','utf8')).cases.find((item:{name:string})=>item.name===name);
  const labels=new Uint8Array(fixture.width*fixture.height*4);fixture.labels.forEach((label:number,i:number)=>{labels[i*4]=labels[i*4+1]=labels[i*4+2]=255;labels[i*4+3]=label;});
  const sourceFile={name:'source.png',mimeType:'image/png',buffer:Buffer.from(await(await encodeRgbaPng(new Uint8Array(fixture.rgba),fixture.width,fixture.height)).arrayBuffer())},trimapFile={name:'trimap.png',mimeType:'image/png',buffer:Buffer.from(await(await encodeRgbaPng(labels,fixture.width,fixture.height)).arrayBuffer())};
  await page.goto('/');expect(await page.evaluate(()=>'luma' in window)).toBe(false);await page.getByTestId('import-input').setInputFiles(sourceFile);await expect(page.locator('.layer-row')).toHaveCount(1);
  await page.getByRole('button',{name:'Refine',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Refine Edge',exact:true});await expect(dialog.getByRole('combobox',{name:'Matting solver',exact:true})).toHaveValue('closed-form');await dialog.getByTestId('refine-edge-cancel').click();
  await page.getByTestId('import-input').setInputFiles(trimapFile);await expect(page.locator('.layer-row')).toHaveCount(2);
  await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();await page.getByLabel('Script code',{exact:true}).fill(`const source=document.layers.at(0),labels=document.layers.at(1);labels.visible=false;document.selectedLayer=source;await source.refineEdge({trimapAssetId:labels.assetId,smoothness:0});print('Global matte ready');`);await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('Global matte ready');await page.getByRole('button',{name:'Close scripts',exact:true}).click();
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Export PNG',exact:true}).click();const stream=await(await downloading).createReadStream(),chunks:Buffer[]=[];for await(const chunk of stream!)chunks.push(Buffer.from(chunk));
  const alpha=await page.evaluate(async({bytes,width,height})=>{const image=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/png'})),canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const c=canvas.getContext('2d')!;c.drawImage(image,0,0);image.close();return Array.from(c.getImageData(0,0,width,height).data).filter((_,i)=>i%4===3);},{bytes:[...Buffer.concat(chunks)],width:fixture.width,height:fixture.height});const errors=alpha.map((value,i)=>Math.abs(value-fixture.alpha[i]));expect(Math.max(...errors)).toBeLessThanOrEqual(1);expect(errors.reduce((a,b)=>a+b,0)/errors.length).toBeLessThan(.02);
});

test('production Design checks inspect native source metadata and export a read-only report through bundled workers',async({page})=>{
 await page.goto('/');expect(await page.evaluate(()=>'luma' in window)).toBe(false);await page.getByTestId('import-input').setInputFiles('tests/fixtures/matting/color-line.png');
 await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();await page.getByLabel('Script code',{exact:true}).fill(`document.selectedLayer.width=18;document.selectedLayer.height=10;const before=JSON.stringify(document.toJSON());const report=await document.preflight({outputDpi:300,minimumPpi:200});if(JSON.stringify(document.toJSON())!==before)throw new Error('Inspection changed the document');print('Production source PPI',report.findings.find(f=>f.code==='low-resolution').effectivePpi);`);await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('Production source PPI 150');await page.getByRole('button',{name:'Close scripts',exact:true}).click();
 await page.getByRole('button',{name:'Design checks',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Design checks',exact:true});await dialog.getByRole('button',{name:'Print sampling',exact:true}).click();await dialog.getByRole('spinbutton',{name:'Minimum source PPI',exact:true}).fill('200');await dialog.getByRole('spinbutton',{name:'Minimum source PPI',exact:true}).blur();await dialog.getByRole('button',{name:'Run checks',exact:true}).click();await expect(dialog.locator('[data-check-code="low-resolution"]')).toContainText('150.0 PPI');
 const download=page.waitForEvent('download');await dialog.getByRole('button',{name:'Download report',exact:true}).click();const stream=await(await download).createReadStream(),chunks:Buffer[]=[];for await(const chunk of stream!)chunks.push(Buffer.from(chunk));const report=JSON.parse(Buffer.concat(chunks).toString());expect(report.options).toMatchObject({outputDpi:300,minimumPpi:200});expect(report.findings.some((finding:{code:string})=>finding.code==='bounds-outside')).toBe(true);expect(report.version).toBe(1);
 await dialog.getByRole('button',{name:'Close design checks',exact:true}).click();await page.keyboard.press('Control+z');await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();await page.getByLabel('Script code',{exact:true}).fill(`print('Width after one undo',document.selectedLayer.width);`);await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('Width after one undo 9');
});

test('production SVG download preserves nested placement and isolated opacity from actual script constructors',async({page})=>{
 await page.goto('/');expect(await page.evaluate(()=>'luma' in window)).toBe(false);
 await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();
 await page.getByLabel('Script code',{exact:true}).fill(`
   document.resize(80,80);
   const group=document.layers.add(new LayerGroup({x:20,y:10,opacity:0.5}));
   const layer=group.layers.add(new VectorLayer({x:5,y:5,fillOpacity:0.5}));
   layer.transform=new AffineTransform(2,0,0,1,5,5);
   layer.paths.add(VectorPath.rectangle({x:0,y:0,width:10,height:20},0,{fill:'#ff0000',stroke:null}));
   layer.paths.add(VectorPath.rectangle({x:5,y:0,width:10,height:20},0,{fill:'#0000ff',stroke:null}));
   const own=layer.toSvg(80,80);
   if(!own.includes('matrix(2 0 0 1 5 5)') || own.includes('matrix(1 0 0 1 20 10)'))throw new Error('Layer-local SVG contract failed');
   const hidden=document.layers.add(new LayerGroup({visible:false}));
   const secret=hidden.layers.add(new VectorLayer());
   secret.paths.add(VectorPath.rectangle({x:0,y:0,width:80,height:80},0,{fill:'#00ff00',stroke:null}));
   print('SVG scene ready');
 `);
 await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('SVG scene ready');await page.getByRole('button',{name:'Close scripts',exact:true}).click();
 await page.getByRole('button',{name:'Export…',exact:true}).click();const dialog=page.locator('.export-dialog');await dialog.getByLabel('Format',{exact:true}).selectOption('svg');
 await expect(dialog).toContainText('full affine transforms');const downloading=page.waitForEvent('download');await dialog.getByRole('button',{name:'Export .svg',exact:true}).click();
 const download=await downloading;expect(download.suggestedFilename()).toMatch(/\.svg$/);const stream=await download.createReadStream(),chunks:Buffer[]=[];for await(const chunk of stream!)chunks.push(Buffer.from(chunk));
 const result=await page.evaluate(async text=>{
   const xml=new DOMParser().parseFromString(text,'image/svg+xml');const image=new Image(),url=URL.createObjectURL(new Blob([text],{type:'image/svg+xml'}));image.src=url;await image.decode();URL.revokeObjectURL(url);
   const canvas=document.createElement('canvas');canvas.width=80;canvas.height=80;const c=canvas.getContext('2d')!;c.drawImage(image,0,0);
   return{errors:xml.querySelectorAll('parsererror').length,paths:xml.querySelectorAll('path').length,samples:[[28,20],[40,20],[52,20],[5,5]].map(([x,y])=>Array.from(c.getImageData(x,y,1,1).data))};
 },Buffer.concat(chunks).toString());
 expect(result).toEqual({errors:0,paths:2,samples:[[255,0,0,64],[0,0,255,64],[0,0,255,64],[0,0,0,0]]});
 await page.keyboard.press('Control+z');await expect(page.locator('.layer-row')).toHaveCount(0);
});

test('production SVG masks preserve vector holes and native coverage through the real download flow',async({page})=>{
 await page.goto('/');expect(await page.evaluate(()=>'luma' in window)).toBe(false);await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();
 await page.getByLabel('Script code',{exact:true}).fill(`
  document.resize(160,96);const group=document.layers.add(new LayerGroup({x:12,y:8}));group.mask=new LayerMask({base:0.5,density:0.5});
  const layer=group.layers.add(new VectorLayer({x:4,y:4}));layer.paths.add(VectorPath.rectangle({x:-500,y:-500,width:2000,height:2000},0,{fill:'#ff0000',stroke:null}));
  layer.mask=new LayerMask({paths:[VectorPath.rectangle({x:8,y:8,width:64,height:48}),VectorPath.rectangle({x:24,y:20,width:24,height:20})]});
  if(!layer.toSvg(160,96).includes('<mask'))throw new Error('Standalone vector mask missing');
  let rejected=false;try{new VectorLayer().toSvg(0,96);}catch(error){rejected=true;}if(!rejected)throw new Error('Invalid SVG accepted');print('Masked SVG ready');
 `);await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('Masked SVG ready');await page.getByRole('button',{name:'Close scripts',exact:true}).click();
 await page.getByRole('button',{name:'Export…',exact:true}).click();const dialog=page.locator('.export-dialog');await dialog.getByLabel('Format',{exact:true}).selectOption('svg');await expect(dialog).toContainText('Editable unfeathered vector');await expect(dialog).toContainText('native-resolution PNG coverage tiles');
 const pending=page.waitForEvent('download');await dialog.getByRole('button',{name:'Export .svg',exact:true}).click();const stream=await(await pending).createReadStream(),chunks:Buffer[]=[];for await(const chunk of stream!)chunks.push(Buffer.from(chunk));
 const result=await page.evaluate(async text=>{
  const xml=new DOMParser().parseFromString(text,'image/svg+xml'),image=new Image(),url=URL.createObjectURL(new Blob([text],{type:'image/svg+xml'}));image.src=url;await image.decode();URL.revokeObjectURL(url);const canvas=document.createElement('canvas');canvas.width=160;canvas.height=96;const c=canvas.getContext('2d')!;c.drawImage(image,0,0);
  return{masks:xml.querySelectorAll('mask').length,tiles:xml.querySelectorAll('mask image').length,samples:[[10,10],[30,25],[48,40],[80,60]].map(([x,y])=>Array.from(c.getImageData(x,y,1,1).data))};
 },Buffer.concat(chunks).toString());expect(result).toEqual({masks:2,tiles:1,samples:[[0,0,0,0],[255,0,0,192],[0,0,0,0],[255,0,0,192]]});await page.keyboard.press('Control+z');await expect(page.locator('.layer-row')).toHaveCount(0);
});

test('production SVG filters preserve document-space shadows with zero fill and rotated parents',async({page})=>{
 await page.goto('/');expect(await page.evaluate(()=>'luma' in window)).toBe(false);await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();
 await page.getByLabel('Script code',{exact:true}).fill(`
  document.resize(160,120);const group=document.layers.add(new LayerGroup());group.transform=new AffineTransform(0,1,-1,0,100,10);
  const layer=group.layers.add(new VectorLayer({x:10,y:5,fillOpacity:0}));layer.paths.add(VectorPath.rectangle({x:0,y:0,width:32,height:24},0,{fill:'#804020',stroke:null}));
  layer.mask=new LayerMask({paths:[VectorPath.rectangle({x:0,y:0,width:32,height:24})]});
  layer.styles=new LayerStyle({dropShadow:{enabled:true,color:'#0020ff',opacity:1,x:20,y:12,blur:0},colorOverlay:{enabled:true,color:'#2040e0',opacity:0.5}});
  if(!layer.toSvg(160,120).includes('<filter'))throw new Error('Standalone effects missing');print('Styled SVG ready');
 `);await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('Styled SVG ready');await page.getByRole('button',{name:'Close scripts',exact:true}).click();
 await page.getByRole('button',{name:'Export…',exact:true}).click();const dialog=page.locator('.export-dialog');await dialog.getByLabel('Format',{exact:true}).selectOption('svg');await expect(dialog).toContainText('document-space drop shadows');await expect(dialog).toContainText('viewer supporting SVG filters');
 const pending=page.waitForEvent('download');await dialog.getByRole('button',{name:'Export .svg',exact:true}).click();const stream=await(await pending).createReadStream(),chunks:Buffer[]=[];for await(const chunk of stream!)chunks.push(Buffer.from(chunk));
 const result=await page.evaluate(async text=>{const xml=new DOMParser().parseFromString(text,'image/svg+xml'),image=new Image(),url=URL.createObjectURL(new Blob([text],{type:'image/svg+xml'}));image.src=url;await image.decode();URL.revokeObjectURL(url);const canvas=document.createElement('canvas');canvas.width=160;canvas.height=120;const c=canvas.getContext('2d')!;c.drawImage(image,0,0);return{filters:xml.querySelectorAll('filter').length,images:xml.querySelectorAll('image').length,samples:[[100,40],[75,30],[120,40]].map(([x,y])=>Array.from(c.getImageData(x,y,1,1).data))};},Buffer.concat(chunks).toString());
 expect(result).toEqual({filters:1,images:0,samples:[[0,32,255,255],[0,0,0,0],[0,0,0,0]]});await page.keyboard.press('Control+z');await expect(page.locator('.layer-row')).toHaveCount(0);
});

test('production SVG download retains a native photo, raster erasures and independent vector paths',async({page})=>{
 await page.goto('/');expect(await page.evaluate(()=>'luma' in window)).toBe(false);await page.getByTestId('import-input').setInputFiles('tests/fixtures/matting/color-line.png');
 await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();await page.getByLabel('Script code',{exact:true}).fill(`
  document.resize(64,40);const photo=document.selectedLayer;photo.x=4;photo.y=4;const copy=photo.duplicate();copy.x=20;copy.clear();
  const vector=document.layers.add(new VectorLayer());vector.paths.add(VectorPath.rectangle({x:40,y:8,width:12,height:12},0,{fill:'#ff0000',stroke:null}));print('Photo SVG ready');
 `);await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('Photo SVG ready');await page.getByRole('button',{name:'Close scripts',exact:true}).click();
 await page.getByRole('button',{name:'Export…',exact:true}).click();const dialog=page.locator('.export-dialog');await dialog.getByLabel('Format',{exact:true}).selectOption('svg');await expect(dialog).toContainText('without original source-file metadata');await expect(dialog).toContainText('including pixels hidden by masks or canvas clipping');await expect(dialog).toContainText('Raster tone effects and erasures are baked');
 const pending=page.waitForEvent('download');await dialog.getByRole('button',{name:'Export .svg',exact:true}).click();const stream=await(await pending).createReadStream(),chunks:Buffer[]=[];for await(const chunk of stream!)chunks.push(Buffer.from(chunk));
 const result=await page.evaluate(async text=>{const xml=new DOMParser().parseFromString(text,'image/svg+xml'),image=new Image(),url=URL.createObjectURL(new Blob([text],{type:'image/svg+xml'}));image.src=url;await image.decode();URL.revokeObjectURL(url);const canvas=document.createElement('canvas');canvas.width=64;canvas.height=40;const c=canvas.getContext('2d')!;c.drawImage(image,0,0);return{images:xml.querySelectorAll('defs > image').length,paths:xml.querySelectorAll('path').length,photoAlpha:c.getImageData(4,4,1,1).data[3],clearedAlpha:c.getImageData(20,4,1,1).data[3],vector:Array.from(c.getImageData(44,12,1,1).data)};},Buffer.concat(chunks).toString());
 expect(result.images).toBe(2);expect(result.paths).toBe(1);expect(result.photoAlpha).toBe(255);expect(result.clearedAlpha).toBe(0);expect(result.vector).toEqual([255,0,0,255]);await page.keyboard.press('Control+z');await expect(page.locator('.layer-row')).toHaveCount(1);
});

test('production documented SVG text stays editable and matches native PNG through actual downloads',async({page})=>{
 const guide=await readFile('docs/SCRIPTING_API.md','utf8'),source=guide.match(/<!-- example: svg-live-text -->\s*```js\n([\s\S]*?)\n```/)?.[1];expect(source).toBeTruthy();
 await page.goto('/');expect(await page.evaluate(()=>'luma' in window)).toBe(false);
 await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();await page.getByLabel('Script code',{exact:true}).fill(source!);await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('Editable SVG text ready');await page.getByRole('button',{name:'Close scripts',exact:true}).click();
 await page.getByRole('button',{name:'Export…',exact:true}).click();const dialog=page.locator('.export-dialog');await dialog.getByLabel('Format',{exact:true}).selectOption('svg');await expect(dialog).toContainText('Editable SVG text');await expect(dialog).toContainText('without embedding font files');await expect(dialog).not.toContainText('Text layers');
 async function download(click:()=>Promise<unknown>){const pending=page.waitForEvent('download');await click();const stream=await(await pending).createReadStream(),parts:Buffer[]=[];for await(const chunk of stream!)parts.push(Buffer.from(chunk));return Buffer.concat(parts);}
 const svg=await download(()=>dialog.getByRole('button',{name:'Export .svg',exact:true}).click()),png=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click());
 const result=await page.evaluate(async({svg,png})=>{
  const xml=new DOMParser().parseFromString(svg,'image/svg+xml');async function pixels(blob:Blob){const image=new Image(),url=URL.createObjectURL(blob);image.src=url;await image.decode();URL.revokeObjectURL(url);const canvas=document.createElement('canvas');canvas.width=240;canvas.height=120;const c=canvas.getContext('2d')!;c.drawImage(image,0,0);return c.getImageData(0,0,240,120).data;}
  const a=await pixels(new Blob([svg],{type:'image/svg+xml'})),b=await pixels(new Blob([new Uint8Array(png)],{type:'image/png'}));let alpha=0,premult=0,coverage=0;for(let i=0;i<a.length;i+=4){coverage+=a[i+3];alpha=Math.max(alpha,Math.abs(a[i+3]-b[i+3]));for(let c=0;c<3;c++)premult=Math.max(premult,Math.abs(a[i+c]*a[i+3]/255-b[i+c]*b[i+3]/255));}
  return{alpha,premult,coverage,lines:[...xml.querySelectorAll('text')].map(node=>node.textContent),embedded:xml.querySelectorAll('image').length};
 },{svg:svg.toString(),png:[...png]});expect(result.lines).toEqual(['Canoli','Studio']);expect(result.embedded).toBe(0);expect(result.coverage).toBeGreaterThan(100000);expect(result.alpha).toBeLessThanOrEqual(2);expect(result.premult).toBeLessThanOrEqual(3);await writeFile('/tmp/canoli-svg-text-production.json',JSON.stringify(result,null,2)+'\n');
 await page.keyboard.press('Control+z');await expect(page.locator('.layer-row')).toHaveCount(0);
});

test('production documented smart SVG keeps editable vectors and native filtered pixels through actual downloads',async({page})=>{
 const guide=await readFile('docs/SCRIPTING_API.md','utf8'),source=guide.match(/<!-- example: svg-smart-objects -->\s*```js\n([\s\S]*?)\n```/)?.[1];expect(source).toBeTruthy();await page.goto('/');expect(await page.evaluate(()=>'luma' in window)).toBe(false);
 await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();await page.getByLabel('Script code',{exact:true}).fill(source!);await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('Smart SVG ready');await page.getByRole('button',{name:'Close scripts',exact:true}).click();
 await page.getByRole('button',{name:'Export…',exact:true}).click();const dialog=page.locator('.export-dialog');await dialog.getByLabel('Format',{exact:true}).selectOption('svg');await expect(dialog).toContainText('Unfiltered master vector/raster/text/paint contents');await expect(dialog).toContainText('Native-rendered smart filters');await expect(dialog).toContainText('Shared master links and component identity are not retained');await expect(dialog).toContainText('Active smart filters and their master contents/filter masks are baked');
 async function download(click:()=>Promise<unknown>){const pending=page.waitForEvent('download');await click();const stream=await(await pending).createReadStream(),parts:Buffer[]=[];for await(const chunk of stream!)parts.push(Buffer.from(chunk));return Buffer.concat(parts);}
 const svg=await download(()=>dialog.getByRole('button',{name:'Export .svg',exact:true}).click()),png=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click());const result=await page.evaluate(async({svg,png})=>{
  const xml=new DOMParser().parseFromString(svg,'image/svg+xml');async function pixels(blob:Blob){const image=new Image(),url=URL.createObjectURL(blob);image.src=url;await image.decode();URL.revokeObjectURL(url);const canvas=document.createElement('canvas');canvas.width=240;canvas.height=140;const c=canvas.getContext('2d')!;c.drawImage(image,0,0);return c.getImageData(0,0,240,140).data;}
  const a=await pixels(new Blob([svg],{type:'image/svg+xml'})),b=await pixels(new Blob([new Uint8Array(png)],{type:'image/png'}));let alpha=0,premult=0;for(let i=0;i<a.length;i+=4){alpha=Math.max(alpha,Math.abs(a[i+3]-b[i+3]));for(let c=0;c<3;c++)premult=Math.max(premult,Math.abs(a[i+c]*a[i+3]/255-b[i+c]*b[i+3]/255));}
  return{alpha,premult,paths:xml.querySelectorAll('svg > g path').length,vectorClips:xml.querySelectorAll('mask path').length,images:xml.querySelectorAll('defs > image').length,original:Array.from(a.slice((20*240+20)*4,(20*240+20)*4+4)),filtered:Array.from(a.slice((20*240+124)*4,(20*240+124)*4+4))};
 },{svg:svg.toString(),png:[...png]});expect(result.paths).toBe(1);expect(result.vectorClips).toBe(1);expect(result.images).toBe(1);expect(result.original).toEqual([128,64,32,255]);expect(result.filtered[3]).toBe(255);expect(result.filtered).not.toEqual(result.original);expect(result.alpha).toBe(0);expect(result.premult).toBe(0);await writeFile('/tmp/canoli-svg-smart-production.json',JSON.stringify(result,null,2)+'\n');await page.keyboard.press('Control+z');await expect(page.locator('.layer-row')).toHaveCount(0);
});

test('production documented SVG paint retains editable dabs, erasers and native selection clips through actual downloads',async({page})=>{
 const guide=await readFile('docs/SCRIPTING_API.md','utf8'),source=guide.match(/<!-- example: svg-paint -->\s*```js\n([\s\S]*?)\n```/)?.[1];expect(source).toBeTruthy();await page.goto('/');expect(await page.evaluate(()=>'luma' in window)).toBe(false);
 await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();await page.getByLabel('Script code',{exact:true}).fill(source!);await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('Editable SVG paint ready');await page.getByRole('button',{name:'Close scripts',exact:true}).click();
 await page.getByRole('button',{name:'Export…',exact:true}).click();const dialog=page.locator('.export-dialog');await dialog.getByLabel('Format',{exact:true}).selectOption('svg');await expect(dialog).toContainText('Editable paint dab/fill geometry');await expect(dialog).toContainText('Original paint command settings and off-support brush dabs');await expect(dialog).toContainText('native-resolution PNG coverage tiles');
 async function download(click:()=>Promise<unknown>){const pending=page.waitForEvent('download');await click();const stream=await(await pending).createReadStream(),parts:Buffer[]=[];for await(const chunk of stream!)parts.push(Buffer.from(chunk));return Buffer.concat(parts);}
 const svg=await download(()=>dialog.getByRole('button',{name:'Export .svg',exact:true}).click()),png=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click());
 const result=await page.evaluate(async({svg,png})=>{
  const xml=new DOMParser().parseFromString(svg,'image/svg+xml');async function pixels(blob:Blob){const image=new Image(),url=URL.createObjectURL(blob);image.src=url;await image.decode();URL.revokeObjectURL(url);const canvas=document.createElement('canvas');canvas.width=160;canvas.height=112;const c=canvas.getContext('2d')!;c.drawImage(image,0,0);return c.getImageData(0,0,160,112).data;}
  const a=await pixels(new Blob([svg],{type:'image/svg+xml'})),b=await pixels(new Blob([new Uint8Array(png)],{type:'image/png'}));let alpha=0,premult=0;for(let i=0;i<a.length;i+=4){alpha=Math.max(alpha,Math.abs(a[i+3]-b[i+3]));for(let c=0;c<3;c++)premult=Math.max(premult,Math.abs(a[i+c]*a[i+3]/255-b[i+c]*b[i+3]/255));}
  return{alpha,premult,errors:xml.querySelectorAll('parsererror').length,circles:xml.querySelectorAll('circle').length,erasers:xml.querySelectorAll('filter feFuncA[slope="-1"]').length,sourceImages:xml.querySelectorAll('defs > image').length,clipTiles:xml.querySelectorAll('mask image').length,laterFill:Array.from(a.slice((42*160+60)*4,(42*160+60)*4+4)),outside:Array.from(a.slice(0,4))};
 },{svg:svg.toString(),png:[...png]});expect(result.errors).toBe(0);expect(result.circles).toBeGreaterThan(20);expect(result.erasers).toBe(1);expect(result.sourceImages).toBe(0);expect(result.clipTiles).toBe(1);expect(result.laterFill).toEqual([0,0,255,255]);expect(result.outside).toEqual([0,0,0,0]);expect(result.alpha).toBeLessThanOrEqual(3);expect(result.premult).toBeLessThanOrEqual(4);await writeFile('/tmp/canoli-svg-paint-production.json',JSON.stringify(result,null,2)+'\n');await page.keyboard.press('Control+z');await expect(page.locator('.layer-row')).toHaveCount(0);
});

test('production documented native SVG backdrop preserves adjustments and Blend If with later editable artwork',async({page})=>{
 const guide=await readFile('docs/SCRIPTING_API.md','utf8'),source=guide.match(/<!-- example: svg-native-backdrop -->\s*```js\n([\s\S]*?)\n```/)?.[1];expect(source).toBeTruthy();await page.goto('/');expect(await page.evaluate(()=>'luma' in window)).toBe(false);
 await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();await page.getByLabel('Script code',{exact:true}).fill(source!+`\nlet rejected=false;try{conditional.toSvg(160,112);}catch(error){rejected=String(error).includes('native backdrop preparation');}if(!rejected)throw new Error('Standalone Blend If was silently omitted');`);await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('Native SVG backdrop ready');await page.getByRole('button',{name:'Close scripts',exact:true}).click();
 await page.getByRole('button',{name:'Export…',exact:true}).click();const dialog=page.locator('.export-dialog');await dialog.getByLabel('Format',{exact:true}).selectOption('svg');await expect(dialog).toContainText('Native adjustment layers, pass-through groups and Blend If');await expect(dialog).toContainText('Conditional overlay');await expect(dialog).toContainText('Editable adjustment/Blend If settings and artwork/masks/styles inside native backdrop prefixes');
 async function download(click:()=>Promise<unknown>){const pending=page.waitForEvent('download');await click();const stream=await(await pending).createReadStream(),parts:Buffer[]=[];for await(const chunk of stream!)parts.push(Buffer.from(chunk));return Buffer.concat(parts);}
 const svg=await download(()=>dialog.getByRole('button',{name:'Export .svg',exact:true}).click()),png=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click());
 const result=await page.evaluate(async({svg,png})=>{
  const xml=new DOMParser().parseFromString(svg,'image/svg+xml');async function pixels(blob:Blob){const image=new Image(),url=URL.createObjectURL(blob);image.src=url;await image.decode();URL.revokeObjectURL(url);const canvas=document.createElement('canvas');canvas.width=160;canvas.height=112;const c=canvas.getContext('2d')!;c.drawImage(image,0,0);return c.getImageData(0,0,160,112).data;}
  const a=await pixels(new Blob([svg],{type:'image/svg+xml'})),b=await pixels(new Blob([new Uint8Array(png)],{type:'image/png'}));let alpha=0,premult=0;for(let i=0;i<a.length;i+=4){alpha=Math.max(alpha,Math.abs(a[i+3]-b[i+3]));for(let c=0;c<3;c++)premult=Math.max(premult,Math.abs(a[i+c]*a[i+3]/255-b[i+c]*b[i+3]/255));}
  return{alpha,premult,images:xml.querySelectorAll('defs > image').length,livePaths:xml.querySelectorAll('svg > g path').length,samples:[[24,24],[88,24],[120,24],[0,0]].map(([x,y])=>Array.from(a.slice((y*160+x)*4,(y*160+x)*4+4)))};
 },{svg:svg.toString(),png:[...png]});expect(result.images).toBe(1);expect(result.livePaths).toBe(1);expect(result.samples).toEqual([[255,128,64,255],[255,128,64,255],[0,255,0,255],[0,0,0,0]]);expect(result.alpha).toBe(0);expect(result.premult).toBe(0);await writeFile('/tmp/canoli-svg-composition-production.json',JSON.stringify(result,null,2)+'\n');await page.keyboard.press('Control+z');await expect(page.locator('.layer-row')).toHaveCount(0);
});

test('production SVG preflight imports editable geometry, preserves prior work and exports through bundled native code',async({page})=>{
 await page.goto('/');expect(await page.evaluate(()=>'luma' in window)).toBe(false);
 await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();await page.getByLabel('Script code',{exact:true}).fill('document.name = "Prior work"; document.layers.add(new VectorLayer({name:"Prior layer"}));');await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('Finished');await page.getByRole('button',{name:'Close scripts',exact:true}).click();
 const source='<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><path id="Frame" fill="#804020" fill-rule="evenodd" d="M8 8H152V112H8Z M32 32H128V88H32Z"/><rect id="Marker" x="64" y="48" width="32" height="24" fill="lime"/></svg>';
 await page.getByTestId('import-input').setInputFiles({name:'Artwork.svg',mimeType:'image/svg+xml',buffer:Buffer.from(source)});const dialog=page.getByRole('dialog',{name:'Import SVG',exact:true});await expect(dialog.getByRole('button',{name:'Import editable',exact:true})).toBeEnabled();await expect(dialog).toContainText('native path contours');await dialog.getByRole('button',{name:'Import editable',exact:true}).click();await expect(dialog).not.toBeVisible();await expect(page.getByRole('tab',{name:'Artwork',exact:true})).toHaveAttribute('aria-selected','true');await expect(page.getByRole('tab',{name:/Prior work/})).toBeVisible();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export PNG',exact:true}).click();const stream=await (await download).createReadStream(),chunks:Buffer[]=[];for await(const chunk of stream!)chunks.push(Buffer.from(chunk));const png=Buffer.concat(chunks);
 const result=await page.evaluate(async bytes=>{const bitmap=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/png'})),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const c=canvas.getContext('2d')!;c.drawImage(bitmap,0,0);bitmap.close();return{width:canvas.width,height:canvas.height,pixels:[[16,16],[40,40],[80,60],[0,0]].map(([x,y])=>Array.from(c.getImageData(x,y,1,1).data))};},[...png]);expect(result).toEqual({width:160,height:120,pixels:[[128,64,32,255],[0,0,0,0],[0,255,0,255],[0,0,0,0]]});
 await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();const guide=await readFile('docs/SCRIPTING_API.md','utf8'),example=guide.match(/<!-- example: svg-import-path -->\s*```js\n([\s\S]*?)\n```/)?.[1];expect(example).toBeTruthy();await page.getByLabel('Script code',{exact:true}).fill(example!);await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('one SVG contour');await page.getByRole('button',{name:'Close scripts',exact:true}).click();await page.keyboard.press('Control+z');await expect(page.getByLabel('Document name',{exact:true})).toHaveValue('Artwork');await expect(page.getByRole('button',{name:'Undo (Mod+Z)',exact:true})).toBeDisabled();await page.getByRole('tab',{name:/Prior work/}).click();await expect(page.getByRole('button',{name:'Select Prior layer',exact:true})).toBeVisible();
 await writeFile('/tmp/canoli-svg-import-production.json',JSON.stringify(result,null,2)+'\n');
});

test('production documented vector strokes retain editable inspector settings and native/SVG pixels',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
 const guide=await readFile('docs/SCRIPTING_API.md','utf8'),source=guide.match(/<!-- example: vector-stroke-styles -->\s*```js\n([\s\S]*?)\n```/)?.[1];expect(source).toBeTruthy();await page.goto('/');expect(await page.evaluate(()=>'luma' in window)).toBe(false);await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();await page.getByLabel('Script code',{exact:true}).fill(source!);await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('Stroke settings ready');await page.getByRole('button',{name:'Close scripts',exact:true}).click();
 await expect(page.getByLabel('Stroke cap',{exact:true})).toHaveValue('square');await expect(page.getByLabel('Stroke join',{exact:true})).toHaveValue('miter');await expect(page.getByLabel('Stroke miter limit',{exact:true})).toHaveValue('12');await expect(page.getByLabel('Stroke dash array',{exact:true})).toHaveValue('16, 24');
 async function bytes(download:import('@playwright/test').Download){const stream=await download.createReadStream(),chunks:Buffer[]=[];for await(const chunk of stream!)chunks.push(Buffer.from(chunk));return Buffer.concat(chunks);}
 const pendingPng=page.waitForEvent('download');await page.getByRole('button',{name:'Export PNG',exact:true}).click();const png=await bytes(await pendingPng);await page.getByRole('button',{name:'Export…',exact:true}).click();const dialog=page.locator('.export-dialog');await dialog.getByLabel('Format',{exact:true}).selectOption('svg');await expect(dialog).toContainText('stroke caps, joins, miter limits');const pendingSvg=page.waitForEvent('download');await dialog.getByRole('button',{name:'Export .svg',exact:true}).click();const svg=await bytes(await pendingSvg);
 const result=await page.evaluate(async({svg,png})=>{
  const xml=new DOMParser().parseFromString(svg,'image/svg+xml'),path=xml.querySelector('path')!,canvas=document.createElement('canvas');canvas.width=160;canvas.height=128;const c=canvas.getContext('2d')!;
  async function pixels(blob:Blob){const image=new Image(),url=URL.createObjectURL(blob);try{image.src=url;await image.decode();c.clearRect(0,0,160,128);c.drawImage(image,0,0);return c.getImageData(0,0,160,128).data;}finally{URL.revokeObjectURL(url);}}
  const a=await pixels(new Blob([svg],{type:'image/svg+xml'})),b=await pixels(new Blob([new Uint8Array(png)],{type:'image/png'}));return{attributes:{cap:path.getAttribute('stroke-linecap'),join:path.getAttribute('stroke-linejoin'),miter:path.getAttribute('stroke-miterlimit'),dash:path.getAttribute('stroke-dasharray'),offset:path.getAttribute('stroke-dashoffset')},images:xml.querySelectorAll('image').length,exact:a.every((v,i)=>v===b[i]),samples:[[16,40],[52,40],[64,40],[140,40]].map(([x,y])=>Array.from(b.slice((y*160+x)*4,(y*160+x)*4+4)))};
 },{svg:svg.toString(),png:[...png]});expect(result.attributes).toEqual({cap:'square',join:'miter',miter:'12',dash:'16 24',offset:'0'});expect(result.images).toBe(0);expect(result.exact).toBe(true);expect(result.samples).toEqual([[128,64,32,255],[0,0,0,0],[128,64,32,255],[0,0,0,0]]);
 await page.getByLabel('Stroke cap',{exact:true}).selectOption('butt');await page.keyboard.press('Control+z');await expect(page.getByLabel('Stroke cap',{exact:true})).toHaveValue('square');await page.keyboard.press('Control+z');await expect(page.locator('.layer-row')).toHaveCount(0);
 await page.getByTestId('import-input').setInputFiles({name:'Styled strokes.svg',mimeType:'image/svg+xml',buffer:svg});const preflight=page.getByRole('dialog',{name:'Import SVG',exact:true});await expect(preflight.getByRole('button',{name:'Import editable',exact:true})).toBeEnabled();await preflight.getByRole('button',{name:'Import editable',exact:true}).click();await expect(preflight).not.toBeVisible();await page.getByRole('button',{name:'Select path',exact:true}).click();await expect(page.getByLabel('Stroke cap',{exact:true})).toHaveValue('square');await expect(page.getByLabel('Stroke dash array',{exact:true})).toHaveValue('16, 24');expect(errors).toEqual([]);await writeFile('/tmp/canoli-vector-stroke-production.json',JSON.stringify(result,null,2)+'\n');
});

test('production documented gradient fills remain editable and survive actual SVG downloads and reimport',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const guide=await readFile('docs/SCRIPTING_API.md','utf8'),source=guide.match(/<!-- example: vector-gradient-fills -->\s*```js\n([\s\S]*?)\n```/)?.[1];expect(source).toBeTruthy();await page.goto('/');expect(await page.evaluate(()=>'luma' in window)).toBe(false);await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();await page.getByLabel('Script code',{exact:true}).fill(source!);await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('Gradient fill ready');await page.getByRole('button',{name:'Close scripts',exact:true}).click();await expect(page.getByLabel('Path fill type',{exact:true})).toHaveValue('linear');await expect(page.getByLabel('Gradient stop 1 color',{exact:true})).toHaveValue('#ff0000');
 async function bytes(download:import('@playwright/test').Download){const stream=await download.createReadStream(),chunks:Buffer[]=[];for await(const chunk of stream!)chunks.push(Buffer.from(chunk));return Buffer.concat(chunks);}
 const pendingPng=page.waitForEvent('download');await page.getByRole('button',{name:'Export PNG',exact:true}).click();const png=await bytes(await pendingPng);await page.getByRole('button',{name:'Export…',exact:true}).click();const dialog=page.locator('.export-dialog');await dialog.getByLabel('Format',{exact:true}).selectOption('svg');await expect(dialog).toContainText('linear and radial vector gradient fills');const pendingSvg=page.waitForEvent('download');await dialog.getByRole('button',{name:'Export .svg',exact:true}).click();const svg=await bytes(await pendingSvg);
 const result=await page.evaluate(async({svg,png})=>{
  async function pixels(blob:Blob){const image=new Image(),url=URL.createObjectURL(blob);try{image.src=url;await image.decode();const canvas=document.createElement('canvas');canvas.width=160;canvas.height=128;const c=canvas.getContext('2d')!;c.drawImage(image,0,0);return c.getImageData(0,0,160,128).data;}finally{URL.revokeObjectURL(url);}}
  const a=await pixels(new Blob([svg],{type:'image/svg+xml'})),b=await pixels(new Blob([new Uint8Array(png)],{type:'image/png'})),xml=new DOMParser().parseFromString(svg,'image/svg+xml');let max=0;for(let i=0;i<a.length;i++)max=Math.max(max,Math.abs(a[i]-b[i]));return{max,gradients:xml.querySelectorAll('linearGradient').length,images:xml.querySelectorAll('image').length,stops:[...xml.querySelectorAll('stop')].map(n=>n.getAttribute('stop-color')),samples:[16,80,143].map(x=>Array.from(b.slice((64*160+x)*4,(64*160+x)*4+4)))};
 },{svg:svg.toString(),png:[...png]});expect(result.max).toBeLessThanOrEqual(1);expect(result.gradients).toBe(1);expect(result.images).toBe(0);expect(result.stops).toEqual(['#ff0000','#0000ff']);for(let i=0;i<3;i++){const x=[16,80,143][i],t=(x+.5-16)/128;expect(Math.abs(result.samples[i][0]-255*(1-t))).toBeLessThanOrEqual(1);expect(Math.abs(result.samples[i][2]-255*t)).toBeLessThanOrEqual(1);expect(result.samples[i][3]).toBe(255);}
 await page.getByRole('button',{name:'Reverse fill',exact:true}).click();await page.keyboard.press('Control+z');await expect(page.getByLabel('Gradient stop 1 color',{exact:true})).toHaveValue('#ff0000');await page.keyboard.press('Control+z');await expect(page.locator('.layer-row')).toHaveCount(0);await page.getByTestId('import-input').setInputFiles({name:'Gradient.svg',mimeType:'image/svg+xml',buffer:svg});const preflight=page.getByRole('dialog',{name:'Import SVG',exact:true});await expect(preflight.getByRole('button',{name:'Import editable',exact:true})).toBeEnabled();await preflight.getByRole('button',{name:'Import editable',exact:true}).click();await expect(preflight).not.toBeVisible();await page.getByRole('button',{name:'Select path',exact:true}).click();await expect(page.getByLabel('Path fill type',{exact:true})).toHaveValue('linear');expect(errors).toEqual([]);await writeFile('/tmp/canoli-vector-gradient-production.json',JSON.stringify(result,null,2)+'\n');
});

test('documented compound path constructors retain editable holes in the production scripting runtime',async({page})=>{
 const guide=await readFile('docs/SCRIPTING_API.md','utf8'),source=guide.match(/<!-- example: vector-compound-paths -->\s*```js\n([\s\S]*?)\n```/)?.[1];expect(source).toBeTruthy();await page.goto('/');expect(await page.evaluate(()=>'luma' in window)).toBe(false);await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();await page.getByLabel('Script code',{exact:true}).fill(source!);await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('Compound ready: 2 contours');await page.getByRole('button',{name:'Close scripts',exact:true}).click();await expect(page.getByLabel('Path fill rule',{exact:true})).toHaveValue('evenodd');await expect(page.getByLabel('Closed path',{exact:true})).toBeDisabled();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export PNG',exact:true}).click();const file=await download,path=await file.path();expect(path).toBeTruthy();const pixels=await page.evaluate(async base64=>{const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0)),image=await createImageBitmap(new Blob([bytes],{type:'image/png'})),canvas=document.createElement('canvas');canvas.width=160;canvas.height=128;const c=canvas.getContext('2d')!;c.drawImage(image,0,0);image.close();return{outer:[...c.getImageData(20,20,1,1).data],hole:[...c.getImageData(80,64,1,1).data]};},(await readFile(path!)).toString('base64'));expect(pixels.outer).toEqual([237,153,102,255]);expect(pixels.hole).toEqual([0,0,0,0]);await page.keyboard.press('Control+z');await expect(page.locator('.layer-row')).toHaveCount(0);
});

test('production Boolean constructor example uses the bundled worker and retains an editable cutout without globals',async({page})=>{
 const guide=await readFile('docs/SCRIPTING_API.md','utf8'),source=guide.match(/<!-- example: vector-boolean -->\s*```js\n([\s\S]*?)\n```/)?.[1];expect(source).toBeTruthy();await page.goto('/');expect(await page.evaluate(()=>'luma' in window)).toBe(false);await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();await page.getByLabel('Script code',{exact:true}).fill(source!);await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('Boolean cutout ready');await page.getByRole('button',{name:'Close scripts',exact:true}).click();await expect(page.getByLabel('Path fill rule',{exact:true})).toHaveValue('nonzero');await expect(page.getByLabel('Closed path',{exact:true})).toBeDisabled();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export PNG',exact:true}).click();const path=await(await download).path();const result=await page.evaluate(async base64=>{const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0)),bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'})),canvas=document.createElement('canvas');canvas.width=160;canvas.height=128;const c=canvas.getContext('2d')!;c.drawImage(bitmap,0,0);bitmap.close();return{outer:[...c.getImageData(20,20,1,1).data],hole:[...c.getImageData(80,64,1,1).data]};},(await readFile(path!)).toString('base64'));expect(result.outer).toEqual([237,153,102,255]);expect(result.hole).toEqual([0,0,0,0]);await page.keyboard.press('Control+z');await expect(page.locator('.layer-row')).toHaveCount(0);await writeFile('/tmp/canoli-vector-boolean-production.json',JSON.stringify(result,null,2)+'\n');
});

test('production typography spacing example preserves real PNG glyphs, controls and atomic reset undo',async({page})=>{
 const source=(await readFile('docs/SCRIPTING_API.md','utf8')).match(/<!-- example: text-spacing -->\s*```js\n([\s\S]*?)\n```/)?.[1];expect(source).toBeTruthy();await page.goto('/');expect(await page.evaluate(()=>'luma' in window)).toBe(false);await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();await page.getByLabel('Script code',{exact:true}).fill(source!);await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('Typography spacing ready');await page.getByRole('button',{name:'Close scripts',exact:true}).click();await expect(page.getByLabel('Kerning',{exact:true})).toHaveValue('normal');await expect(page.getByRole('spinbutton',{name:'Word spacing value',exact:true})).toHaveValue('12');
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export PNG',exact:true}).click();const path=await(await download).path(),result=await page.evaluate(async base64=>{const image=await createImageBitmap(new Blob([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],{type:'image/png'})),canvas=document.createElement('canvas');canvas.width=480;canvas.height=160;const c=canvas.getContext('2d')!;c.drawImage(image,0,0);image.close();const actual=c.getImageData(0,0,480,160).data;c.clearRect(0,0,480,160);c.font='40px serif';c.textBaseline='top';c.fontKerning='normal';c.wordSpacing='12px';c.letterSpacing='1px';c.fillStyle='#2050a0';for(const [i,line] of ['AVATAR WA','Wide words'].entries())c.fillText(line,16,16+i*40*1.3);const expected=c.getImageData(0,0,480,160).data;let alpha=0,premult=0,coverage=0;for(let i=0;i<actual.length;i+=4){alpha=Math.max(alpha,Math.abs(actual[i+3]-expected[i+3]));coverage+=actual[i+3];for(let k=0;k<3;k++)premult=Math.max(premult,Math.abs(actual[i+k]*actual[i+3]/255-expected[i+k]*expected[i+3]/255));}return{alpha,premult,coverage};},(await readFile(path!)).toString('base64'));expect(result.alpha).toBeLessThanOrEqual(1);expect(result.premult).toBeLessThanOrEqual(1);expect(result.coverage).toBeGreaterThan(100000);
 await page.getByRole('button',{name:'Reset spacing',exact:true}).click();await expect(page.getByLabel('Kerning',{exact:true})).toHaveValue('auto');await expect(page.getByRole('spinbutton',{name:'Word spacing value',exact:true})).toHaveValue('0');await page.keyboard.press('Control+z');await expect(page.getByLabel('Kerning',{exact:true})).toHaveValue('normal');await expect(page.getByRole('spinbutton',{name:'Word spacing value',exact:true})).toHaveValue('12');await page.keyboard.press('Control+z');await expect(page.locator('.layer-row')).toHaveCount(0);await writeFile('/tmp/canoli-text-spacing-production.json',JSON.stringify(result,null,2)+'\n');
});

for(const selection of ['cold','selected'] as const)test(`production dense Boolean ${selection} selection records real UI frames and long tasks`,async({page})=>{
 await page.goto('/');expect(await page.evaluate(()=>'luma' in window)).toBe(false);const source=`document.resize(160,128);const layer=document.layers.add(new VectorLayer({name:'Dense Boolean'}));const points=cx=>Array.from({length:1000},(_,i)=>{const a=i/1000*Math.PI*2,k=4/3*Math.tan(Math.PI/2000);return{x:cx+48*Math.cos(a),y:64+48*Math.sin(a),in:{x:cx+48*Math.cos(a)+48*k*Math.sin(a),y:64+48*Math.sin(a)-48*k*Math.cos(a)},out:{x:cx+48*Math.cos(a)-48*k*Math.sin(a),y:64+48*Math.sin(a)+48*k*Math.cos(a)}};});layer.paths.add(new VectorPath({points:points(56),closed:true,fill:'#804020',stroke:null}));layer.paths.add(new VectorPath({points:points(104),closed:true,fill:'#00ff00',stroke:null}));document.selectedLayer=${selection==='selected'?'layer':'null'};print('Dense Boolean ready');`;
 await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();await page.getByLabel('Script code',{exact:true}).fill(source);await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('Dense Boolean ready');await page.getByRole('button',{name:'Close scripts',exact:true}).click();
 await page.getByRole('button',{name:'Find a command (Mod+K)',exact:true}).click();const search=page.getByRole('combobox',{name:'Search commands',exact:true});await search.fill('Combine vector paths');await search.press('Enter');const dialog=page.getByRole('dialog',{name:'Combine vector paths',exact:true});await expect(dialog).toBeVisible();
 await page.evaluate(()=>{
  const probe={done:false,result:null as null|{elapsedMs:number;frames:number;maxFrameGap:number;longTasks:number[]}};(window as unknown as {booleanUiProbe:typeof probe}).booleanUiProbe=probe;
  const tasks:PerformanceEntry[]=[],performanceObserver=new PerformanceObserver(list=>tasks.push(...list.getEntries()));performanceObserver.observe({type:'longtask'});
  let start=0,last=0,frames=0,gap=0,active=false,finishing=false;const tick=()=>{if(!active)return;const now=performance.now();gap=Math.max(gap,now-last);last=now;frames++;requestAnimationFrame(tick);};
  const mutation=new MutationObserver(()=>{if(!active||finishing||document.querySelector('[aria-labelledby="vector-boolean-title"]'))return;finishing=true;requestAnimationFrame(()=>requestAnimationFrame(()=>{const end=performance.now();active=false;tasks.push(...performanceObserver.takeRecords());performanceObserver.disconnect();mutation.disconnect();probe.result={elapsedMs:end-start,frames,maxFrameGap:gap,longTasks:tasks.filter(t=>t.startTime>=start&&t.startTime<=end).map(t=>t.duration)};probe.done=true;}));});mutation.observe(document.body,{childList:true,subtree:true});
  const click=(event:MouseEvent)=>{if(!(event.target instanceof Element)||event.target.closest('button')?.textContent?.trim()!=='Combine paths')return;document.removeEventListener('click',click,true);start=last=performance.now();active=true;requestAnimationFrame(tick);};document.addEventListener('click',click,true);
 });
 await dialog.getByRole('button',{name:'Combine paths',exact:true}).click();await expect(dialog).not.toBeVisible();await page.waitForFunction(()=>(window as unknown as {booleanUiProbe:{done:boolean}}).booleanUiProbe.done);const result=await page.evaluate(()=>(window as unknown as {booleanUiProbe:{result:{elapsedMs:number;frames:number;maxFrameGap:number;longTasks:number[]}}}).booleanUiProbe.result);expect(result.frames).toBeGreaterThan(0);await expect(page.getByLabel('Path fill rule',{exact:true})).toHaveValue('nonzero');await writeFile(`/tmp/canoli-vector-boolean-production-${selection}-responsiveness.json`,JSON.stringify({selection,...result},null,2)+'\n');
});

test('production paragraph script stays editable through native project, SVG/PNG downloads and undo without globals',async({page},info)=>{
 const guide=await readFile('docs/SCRIPTING_API.md','utf8'),source=guide.match(/<!-- example: paragraph-text -->\s*```js\n([\s\S]*?)```/)?.[1];if(!source)throw new Error('Missing documented paragraph example.');
 await page.goto('/');expect(await page.evaluate(()=>'luma'in window)).toBe(false);await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();await page.getByLabel('Script code',{exact:true}).fill(source);await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('Paragraph ready 280 18 20');await page.getByRole('button',{name:'Close scripts',exact:true}).click();await expect(page.getByRole('spinbutton',{name:'Paragraph width',exact:true})).toHaveValue('280');
 const pngDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Export PNG',exact:true}).click();const pngPath=await(await pngDownload).path();if(!pngPath)throw new Error('Missing PNG download');
 const png=(await readFile(pngPath)).toString('base64');
 await page.getByRole('button',{name:'Export…',exact:true}).click();await page.getByRole('combobox',{name:'Format',exact:true}).selectOption('svg');
 const svgDownload=page.waitForEvent('download');await page.locator('.export-dialog').getByRole('button',{name:'Export .svg',exact:true}).click();const svgPath=await(await svgDownload).path();if(!svgPath)throw new Error('Missing SVG download');const svg=await readFile(svgPath,'utf8');
 const result=await page.evaluate(async({png,svg})=>{
  const xml=new DOMParser().parseFromString(svg,'image/svg+xml');const pixels=async(blob:Blob)=>{const image=new Image(),url=URL.createObjectURL(blob),canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;try{image.src=url;await image.decode();const c=canvas.getContext('2d')!;c.drawImage(image,0,0);return c.getImageData(0,0,640,360).data;}finally{URL.revokeObjectURL(url);canvas.width=canvas.height=0;}};
  const a=await pixels(new Blob([Uint8Array.from(atob(png),c=>c.charCodeAt(0))],{type:'image/png'})),b=await pixels(new Blob([svg],{type:'image/svg+xml'}));let max=0,coverage=0;for(let i=0;i<a.length;i++){max=Math.max(max,Math.abs(a[i]-b[i]));if(i%4===3)coverage+=a[i];}return{max,coverage,texts:[...xml.querySelectorAll('text')].map(t=>t.textContent),images:xml.querySelectorAll('image').length};
 },{png,svg});expect(result.max).toBeLessThanOrEqual(1);expect(result.coverage).toBeGreaterThan(100000);expect(result.texts.length).toBeGreaterThan(2);expect(result.images).toBe(0);
 const saved=page.waitForEvent('download');await page.getByRole('button',{name:'Save project',exact:true}).click();const project=await saved;expect(project.suggestedFilename()).toMatch(/\.luma$/);const projectPath=await project.path();if(!projectPath)throw new Error('Missing native paragraph project');
 await page.keyboard.press('Control+z');await expect(page.locator('.layer-row')).toHaveCount(0);await page.getByTestId('project-input').setInputFiles(projectPath);await page.getByRole('button',{name:'Select Paragraph caption',exact:true}).click();await expect(page.getByRole('spinbutton',{name:'Paragraph width',exact:true})).toHaveValue('280');await expect(page.getByRole('textbox',{name:'Text content',exact:true})).toHaveValue('Editable paragraphs wrap to this width.\nThis is a second paragraph.');expect(await page.evaluate(()=>'luma'in window)).toBe(false);
 await info.attach('paragraph-production',{body:JSON.stringify({...result,projectReopened:true,noDeveloperGlobals:true,scriptUndo:true}),contentType:'application/json'});
});

test('production justified paragraphs export native whole lines, retain editability and restore exact undo without globals',async({page},info)=>{
 const guide=await readFile('docs/SCRIPTING_API.md','utf8'),source=guide.match(/<!-- example: justified-paragraph -->\s*```js\n([\s\S]*?)```/)?.[1];if(!source)throw new Error('Missing documented justification example');
 await page.goto('/');expect(await page.evaluate(()=>'luma'in window)).toBe(false);await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();await page.getByLabel('Script code',{exact:true}).fill(source);await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('Justification ready inter-word');await page.getByRole('button',{name:'Close scripts',exact:true}).click();await expect(page.getByLabel('Justification',{exact:true})).toHaveValue('inter-word');
 const pngDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Export PNG',exact:true}).click();const pngPath=await(await pngDownload).path();if(!pngPath)throw new Error('Missing PNG');const png=(await readFile(pngPath)).toString('base64');
 await page.getByRole('button',{name:'Export…',exact:true}).click();const dialog=page.locator('.export-dialog');await dialog.getByLabel('Format',{exact:true}).selectOption('svg');const svgDownload=page.waitForEvent('download');await dialog.getByRole('button',{name:'Export .svg',exact:true}).click();const svgPath=await(await svgDownload).path();if(!svgPath)throw new Error('Missing SVG');const svg=await readFile(svgPath,'utf8');
 const result=await page.evaluate(async({png,svg})=>{
  const pixels=async(blob:Blob)=>{const image=new Image(),url=URL.createObjectURL(blob),canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;try{image.src=url;await image.decode();const c=canvas.getContext('2d')!;c.drawImage(image,0,0);return c.getImageData(0,0,640,360).data;}finally{URL.revokeObjectURL(url);canvas.width=canvas.height=0;}};
  const a=await pixels(new Blob([Uint8Array.from(atob(png),c=>c.charCodeAt(0))],{type:'image/png'})),b=await pixels(new Blob([svg],{type:'image/svg+xml'}));let alpha=0,premult=0,coverage=0;for(let i=0;i<a.length;i+=4){alpha=Math.max(alpha,Math.abs(a[i+3]-b[i+3]));coverage+=a[i+3];for(let k=0;k<3;k++)premult=Math.max(premult,Math.abs(a[i+k]*a[i+3]/255-b[i+k]*b[i+3]/255));}const xml=new DOMParser().parseFromString(svg,'image/svg+xml');return{alpha,premult,coverage,lines:[...xml.querySelectorAll('text')].map(t=>({text:t.textContent,spacing:Number(t.getAttribute('word-spacing'))})),images:xml.querySelectorAll('image').length};
 },{png,svg});expect(result.alpha).toBe(0);expect(result.premult).toBe(0);expect(result.coverage).toBeGreaterThan(100000);expect(result.lines.length).toBeGreaterThan(2);expect(result.lines[0].spacing).toBeGreaterThan(0);expect(result.lines.at(-1)!.spacing).toBe(0);expect(result.images).toBe(0);
 const saved=page.waitForEvent('download');await page.getByRole('button',{name:'Save project',exact:true}).click();const project=await saved;expect(project.suggestedFilename()).toMatch(/\.luma$/);const projectPath=await project.path();if(!projectPath)throw new Error('Missing project');
 await page.getByLabel('Justification',{exact:true}).selectOption('none');await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();await page.keyboard.press('Control+z');await expect(page.getByLabel('Justification',{exact:true})).toHaveValue('inter-word');await page.keyboard.press('Control+z');await expect(page.locator('.layer-row')).toHaveCount(0);
 await page.getByTestId('project-input').setInputFiles(projectPath);await page.getByRole('button',{name:'Select Justified paragraph',exact:true}).click();await expect(page.getByLabel('Justification',{exact:true})).toHaveValue('inter-word');await expect(page.getByLabel('Paragraph width',{exact:true})).toHaveValue('280');expect(await page.evaluate(()=>'luma'in window)).toBe(false);
 await info.attach('justification-production',{body:JSON.stringify({...result,projectReopened:true,undo:true,noDeveloperGlobals:true}),contentType:'application/json'});
});

test('production whitespace SVG keeps literal text and native appearance through downloads, undo and project reopen',async({page},info)=>{
 const source=(await readFile('docs/SCRIPTING_API.md','utf8')).match(/<!-- example: svg-whitespace -->\s*```js\n([\s\S]*?)\n```/)?.[1];expect(source).toBeTruthy();
 await page.goto('/');expect(await page.evaluate(()=>'luma'in window)).toBe(false);await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();await page.getByLabel('Script code',{exact:true}).fill(source!);await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('Whitespace SVG ready');await page.getByRole('button',{name:'Close scripts',exact:true}).click();
 await page.getByRole('button',{name:'Select Whitespace caption',exact:true}).click();await expect(page.getByRole('textbox',{name:'Text content',exact:true})).toHaveValue('  alpha\u00a0beta gamma');
 async function download(click:()=>Promise<unknown>){const pending=page.waitForEvent('download');await click();const file=await pending,path=await file.path();if(!path)throw new Error('Missing download');return{bytes:await readFile(path),path,name:file.suggestedFilename()};}
 const png=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click());
 await page.getByRole('button',{name:'Export…',exact:true}).click();const dialog=page.locator('.export-dialog');await dialog.getByLabel('Format',{exact:true}).selectOption('svg');await expect(dialog).toContainText('whitespace boundaries');const svg=await download(()=>dialog.getByRole('button',{name:'Export .svg',exact:true}).click());
 const result=await page.evaluate(async({svg,png})=>{
  const pixels=async(blob:Blob)=>{const image=new Image(),url=URL.createObjectURL(blob),canvas=document.createElement('canvas');canvas.width=400;canvas.height=160;try{image.src=url;await image.decode();const c=canvas.getContext('2d')!;c.drawImage(image,0,0);return c.getImageData(0,0,400,160).data;}finally{URL.revokeObjectURL(url);canvas.width=canvas.height=0;}};
  const native=await pixels(new Blob([Uint8Array.from(atob(png),c=>c.charCodeAt(0))],{type:'image/png'})),actual=await pixels(new Blob([svg],{type:'image/svg+xml'}));
  const canvas=document.createElement('canvas');canvas.width=400;canvas.height=160;const c=canvas.getContext('2d')!;c.font='normal normal 24px monospace';c.fontKerning='normal';c.letterSpacing='0px';c.wordSpacing='8px';c.textAlign='left';c.direction='ltr';c.textBaseline='top';c.fillStyle='#2050a0';c.fillText('  alpha\u00a0beta gamma',24,24);const reference=c.getImageData(0,0,400,160).data;
  let svgMax=0,nativeMax=0,coverage=0;for(let i=0;i<actual.length;i++){svgMax=Math.max(svgMax,Math.abs(actual[i]-native[i]));nativeMax=Math.max(nativeMax,Math.abs(native[i]-reference[i]));if(i%4===3)coverage+=native[i];}
  const xml=new DOMParser().parseFromString(svg,'image/svg+xml'),text=xml.querySelector('text')!;return{svgMax,nativeMax,coverage,text:text.textContent,spacing:text.getAttribute('word-spacing'),texts:xml.querySelectorAll('text').length,images:xml.querySelectorAll('image').length,spans:[...text.querySelectorAll('tspan')].map(span=>({text:span.textContent,spacing:span.getAttribute('word-spacing'),attributes:span.attributes.length}))};
 },{svg:svg.bytes.toString(),png:png.bytes.toString('base64')});
 expect(result.svgMax).toBe(0);expect(result.nativeMax).toBe(0);expect(result.coverage).toBeGreaterThan(100000);expect(result.text).toBe('  alpha\u00a0beta gamma');expect(result.spacing).toBe('8');expect(result.texts).toBe(1);expect(result.images).toBe(0);expect(result.spans).toEqual([{text:'  ',spacing:'0',attributes:1},{text:' ',spacing:'0',attributes:1}]);
 const project=await download(()=>page.getByRole('button',{name:'Save project',exact:true}).click());expect(project.name).toMatch(/\.luma$/);
 const spacing=page.getByRole('spinbutton',{name:'Word spacing value',exact:true});await spacing.fill('12');await spacing.press('Enter');await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();await page.keyboard.press('Control+z');await expect(spacing).toHaveValue('8');const restored=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click());expect(restored.bytes.equals(png.bytes)).toBe(true);
 await page.keyboard.press('Control+z');await expect(page.locator('.layer-row')).toHaveCount(0);await page.getByTestId('project-input').setInputFiles(project.path);await page.getByRole('button',{name:'Select Whitespace caption',exact:true}).click();await expect(page.getByRole('textbox',{name:'Text content',exact:true})).toHaveValue('  alpha\u00a0beta gamma');await expect(spacing).toHaveValue('8');const reopened=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click());expect(reopened.bytes.equals(png.bytes)).toBe(true);expect(await page.evaluate(()=>'luma'in window)).toBe(false);
 await page.getByTestId('import-input').setInputFiles({name:'Whitespace.svg',mimeType:'image/svg+xml',buffer:svg.bytes});const preflight=page.getByRole('dialog',{name:'Import SVG',exact:true});await expect(preflight.getByRole('button',{name:'Import editable',exact:true})).toBeDisabled();await preflight.getByRole('button',{name:'Import flattened',exact:true}).click();await expect(preflight).not.toBeVisible();await expect(page.getByRole('button',{name:'Select Flattened SVG',exact:true})).toBeVisible();const flattened=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click());expect(flattened.bytes.equals(png.bytes)).toBe(true);
 await info.attach('svg-whitespace-production',{body:JSON.stringify({...result,undo:true,projectReopened:true,flattenedImport:true,noDeveloperGlobal:true}),contentType:'application/json'});
});

test('production documented tilt stamps and v2 brush packs retain exact PNGs, editable metadata and undo without globals',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('/');expect(await page.evaluate(()=>'luma'in window)).toBe(false);
 const download=async(action:()=>Promise<unknown>,name:string)=>{const pending=page.waitForEvent('download');await action();const path=info.outputPath(name);await(await pending).saveAs(path);return path;},read=async(path:string)=>readProject(new Blob([new Uint8Array(await readFile(path))]));
 const initial=await read(await download(()=>page.getByRole('button',{name:'Save project',exact:true}).click(),'initial.luma'));
 const example=(await readFile('docs/SCRIPTING_API.md','utf8')).match(/<!-- example: brush-tip-shape -->\s*```js\n([\s\S]*?)\n```/)?.[1];expect(example).toBeTruthy();await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();await page.getByLabel('Script code',{exact:true}).fill('document.resize(160,160);\n'+example!);await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('Tilt study ready');await page.getByRole('button',{name:'Close scripts',exact:true}).click();
 const saved=await download(()=>page.getByRole('button',{name:'Save project',exact:true}).click(),'tilt.luma'),authored=await read(saved),layer=authored.document.children[0];expect(authored.document.schemaVersion).toBe(40);if(layer.kind!=='paint'||(layer.strokes[0].kind==='fill' || layer.strokes[0].kind === 'wet'))throw new Error('Missing tip stroke');expect(layer.strokes[0]).toMatchObject({tip:{roundness:1,angle:0,tiltAngle:true,tiltRoundness:true},points:[{tilt:{altitude:Math.PI/4,azimuth:Math.PI/2}}]});const png=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),'tilt.png');
 await page.getByRole('button',{name:'Brush tool (B)',exact:true}).click();await page.getByRole('button',{name:'Brush tip…',exact:true}).click();const tip=page.getByRole('dialog',{name:'Brush tip',exact:true});await tip.getByLabel('Tip type',{exact:true}).selectOption('shaped');const angle=tip.getByRole('spinbutton',{name:'Tip angle value',exact:true});await angle.fill('35.5');await angle.press('Enter');await tip.getByLabel('Tilt controls angle',{exact:true}).check();await tip.getByRole('button',{name:'Apply tip',exact:true}).click();await page.getByRole('button',{name:'Brush presets…',exact:true}).click();let presets=page.getByRole('dialog',{name:'Brush presets',exact:true});await presets.getByLabel('Preset name',{exact:true}).fill('Production shaped');await presets.getByRole('button',{name:'Save current as new',exact:true}).click();await expect(presets.getByRole('status')).toContainText('saved locally');const packPath=await download(()=>presets.getByRole('button',{name:'Export selected',exact:true}).click(),'shaped.canoli-brushes.json'),pack=JSON.parse(await readFile(packPath,'utf8'));expect(pack).toMatchObject({format:'canoli-brush-presets',version:2,presets:[{version:2,settings:{tip:{angle:35.5,tiltAngle:true}}}]});await presets.getByRole('button',{name:'Close',exact:true}).click();
 await page.keyboard.press('Control+z');const undo=await read(await download(()=>page.getByRole('button',{name:'Save project',exact:true}).click(),'undo.luma'));expect(undo.document).toEqual(initial.document);
 await page.reload();expect(await page.evaluate(()=>'luma'in window)).toBe(false);await page.getByTestId('project-input').setInputFiles(saved);const reopened=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),'reopened.png');await page.getByRole('button',{name:'Brush tool (B)',exact:true}).click();await page.getByRole('button',{name:'Brush presets…',exact:true}).click();presets=page.getByRole('dialog',{name:'Brush presets',exact:true});await presets.getByRole('button',{name:/^Production shaped Brush/}).click();await presets.getByRole('button',{name:'Apply preset',exact:true}).click();await page.getByRole('button',{name:'Brush tip…',exact:true}).click();await expect(tip.getByRole('spinbutton',{name:'Tip angle value',exact:true})).toHaveValue('35.5');await expect(tip.getByLabel('Tilt controls angle',{exact:true})).toBeChecked();await tip.getByRole('button',{name:'Cancel',exact:true}).click();const restored=await read(await download(()=>page.getByRole('button',{name:'Save project',exact:true}).click(),'restored.luma'));expect(restored.document).toEqual(authored.document);
 const checked=spawnSync('python3',['-c',"from PIL import Image;import numpy as np,sys;a=np.asarray(Image.open(sys.argv[1]).convert('RGBA'));b=np.asarray(Image.open(sys.argv[2]).convert('RGBA'));assert a.shape==b.shape==(160,160,4);assert np.array_equal(a,b);assert a[80,80].tolist()==[255,0,0,255];assert a[110,80].tolist()==[255,0,0,255];assert a[80,110].tolist()==[0,0,0,0];print('Every tilted-stamp pixel survives project reopening; analytic axes and center match')",png,reopened],{encoding:'utf8',timeout:30000});expect(checked.status,checked.stderr||checked.stdout).toBe(0);expect(errors).toEqual([]);await info.attach('production-tip-contract',{body:JSON.stringify({schema:32,presetPack:2,independent:checked.stdout,noDeveloperGlobal:true}),contentType:'application/json'});
});

test('production symmetry scripts, v3 presets and actual painting retain self-contained project pixels and undo without globals',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('/');expect(await page.evaluate(()=>'luma'in window)).toBe(false);
 const download=async(action:()=>Promise<unknown>,name:string)=>{const pending=page.waitForEvent('download');await action();const path=info.outputPath(name);await(await pending).saveAs(path);return path;},read=async(path:string)=>readProject(new Blob([new Uint8Array(await readFile(path))]));
 const initial=await read(await download(()=>page.getByRole('button',{name:'Save project',exact:true}).click(),'initial.luma')),example=(await readFile('docs/SCRIPTING_API.md','utf8')).match(/<!-- example: brush-symmetry -->\s*```js\n([\s\S]*?)\n```/)?.[1];expect(example).toBeTruthy();await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();await page.getByLabel('Script code',{exact:true}).fill('document.resize(64,64);\n'+example!);await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('Four-way ink ready');await page.getByRole('button',{name:'Close scripts',exact:true}).click();const saved=await download(()=>page.getByRole('button',{name:'Save project',exact:true}).click(),'symmetry.luma'),authored=await read(saved),layer=authored.document.children[0];expect(authored.document.schemaVersion).toBe(40);if(layer.kind!=='paint'||(layer.strokes[0].kind==='fill' || layer.strokes[0].kind === 'wet'))throw new Error('Missing symmetry stroke');expect(layer.strokes[0].points).toHaveLength(1);expect(layer.strokes[0].symmetry!.copies).toHaveLength(3);const png=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),'original.png');
 await page.getByRole('button',{name:'Brush tool (B)',exact:true}).click();await page.getByRole('button',{name:'Symmetry…',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Brush symmetry',exact:true});await dialog.getByLabel('Symmetry mode',{exact:true}).selectOption('radial');for(const [label,value] of [['Symmetry center X','32.25'],['Symmetry center Y','31.75'],['Radial sectors value','8']]){const input=dialog.getByRole('spinbutton',{name:label,exact:true});await input.fill(value);await input.press('Enter');}await dialog.getByRole('button',{name:'Apply symmetry',exact:true}).click();await page.getByRole('button',{name:'Brush presets…',exact:true}).click();let presets=page.getByRole('dialog',{name:'Brush presets',exact:true});await presets.getByLabel('Preset name',{exact:true}).fill('Production radial');await presets.getByRole('button',{name:'Save current as new',exact:true}).click();await expect(presets.getByRole('status')).toContainText('saved locally');const pack=JSON.parse(await readFile(await download(()=>presets.getByRole('button',{name:'Export selected',exact:true}).click(),'symmetry.canoli-brushes.json'),'utf8'));expect(pack.version).toBe(3);expect(pack.presets[0].version).toBe(3);expect(pack.presets[0].settings.symmetry.copies).toHaveLength(7);await presets.getByRole('button',{name:'Close',exact:true}).click();const configured=await read(await download(()=>page.getByRole('button',{name:'Save project',exact:true}).click(),'configured.luma'));expect(configured.document).toEqual(authored.document);await page.keyboard.press('Control+z');expect((await read(await download(()=>page.getByRole('button',{name:'Save project',exact:true}).click(),'undo-script.luma'))).document).toEqual(initial.document);
 await page.reload();expect(await page.evaluate(()=>'luma'in window)).toBe(false);await page.getByTestId('project-input').setInputFiles(saved);await page.getByRole('button',{name:'Brush tool (B)',exact:true}).click();await page.getByRole('button',{name:'Brush presets…',exact:true}).click();presets=page.getByRole('dialog',{name:'Brush presets',exact:true});await presets.getByRole('button',{name:/^Production radial Brush/}).click();await presets.getByRole('button',{name:'Apply preset',exact:true}).click();await page.getByRole('button',{name:'Symmetry…',exact:true}).click();await expect(dialog.getByLabel('Symmetry mode',{exact:true})).toHaveValue('radial');await expect(dialog.getByRole('spinbutton',{name:'Symmetry center X',exact:true})).toHaveValue('32.25');await expect(dialog.getByRole('spinbutton',{name:'Symmetry center Y',exact:true})).toHaveValue('31.75');await expect(dialog.getByRole('spinbutton',{name:'Radial sectors value',exact:true})).toHaveValue('8');await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await page.locator('.layer-row').filter({hasText:'Four-way ink'}).click();await page.keyboard.press('Control+1');const box=(await page.locator('.canvas-wrap').boundingBox())!;await page.mouse.click(box.x+16.5,box.y+20.5);const drawn=await read(await download(()=>page.getByRole('button',{name:'Save project',exact:true}).click(),'drawn.luma')),paint=drawn.document.children[0];if(paint.kind!=='paint'||!paint.strokes[1]||(paint.strokes[1].kind==='fill' || paint.strokes[1].kind === 'wet'))throw new Error('Missing symmetric UI stroke');expect(paint.strokes).toHaveLength(2);expect(paint.strokes[1].symmetry).toEqual(pack.presets[0].settings.symmetry);await page.keyboard.press('Control+z');expect((await read(await download(()=>page.getByRole('button',{name:'Save project',exact:true}).click(),'undo-gesture.luma'))).document).toEqual(authored.document);
 await page.getByRole('button',{name:'Brush presets…',exact:true}).click();presets=page.getByRole('dialog',{name:'Brush presets',exact:true});await presets.getByRole('button',{name:/^Production radial Brush/}).click();await presets.getByRole('button',{name:'Delete preset',exact:true}).click();await presets.getByRole('button',{name:/^Hard round Brush/}).click();await presets.getByRole('button',{name:'Apply preset',exact:true}).click();await page.getByRole('button',{name:'Symmetry…',exact:true}).click();await expect(dialog.getByLabel('Symmetry mode',{exact:true})).toHaveValue('none');await dialog.getByRole('button',{name:'Cancel',exact:true}).click();const reopened=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),'reopened.png');const checked=spawnSync('python3',['-c',"from PIL import Image;import numpy as np,sys;a=np.asarray(Image.open(sys.argv[1]).convert('RGBA'));b=np.asarray(Image.open(sys.argv[2]).convert('RGBA'));assert a.shape==b.shape==(64,64,4);assert np.array_equal(a,b);assert all(a[y,x].tolist()==[255,0,0,255] for x,y in [(16,32),(32,16),(48,32),(32,48)]);assert a[32,32].tolist()==[0,0,0,0];print('All four-way stroke pixels survive library deletion/project reopen; analytic centers and empty center match')",png,reopened],{encoding:'utf8',timeout:30000});expect(checked.status,checked.stderr||checked.stdout).toBe(0);expect(errors).toEqual([]);await info.attach('production-symmetry',{body:JSON.stringify({schema:32,presetPack:3,independent:checked.stdout,noDeveloperGlobal:true,actualUiStrokeAndUndo:true}),contentType:'application/json'});
});

test('production BrushTexture example retains original sources, actual pixels and one-step undo without globals',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('/');expect(await page.evaluate(()=>'luma'in window)).toBe(false);
 const pixels=new Uint8Array(64*64*4);for(let i=3;i<pixels.length;i+=4)pixels[i]=255;const source=await encodeRgbaPng(pixels,64,64),sourcePath=info.outputPath('black-texture.png');await writeFile(sourcePath,new Uint8Array(await source.arrayBuffer()));
 const download=async(action:()=>Promise<unknown>,name:string)=>{const pending=page.waitForEvent('download');await action();const path=info.outputPath(name);await(await pending).saveAs(path);return path;},read=async(path:string)=>readProject(new Blob([new Uint8Array(await readFile(path))]));
 await page.getByTestId('import-input').setInputFiles(sourcePath);await expect(page.locator('.layer-row')).toHaveCount(1);const before=await read(await download(()=>page.getByRole('button',{name:'Save project',exact:true}).click(),'before.luma'));
 const guide=await readFile('docs/SCRIPTING_API.md','utf8'),code=guide.split('<!-- example: brush-texture -->')[1].split('```js\n')[1].split('```')[0];await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();await page.getByLabel('Script code',{exact:true}).fill(code);await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('Image-backed ink ready');await page.getByRole('button',{name:'Close scripts',exact:true}).click();
 const projectPath=await download(()=>page.getByRole('button',{name:'Save project',exact:true}).click(),'texture.luma'),project=await read(projectPath),paint=project.document.children[1];expect(project.document.schemaVersion).toBe(40);expect(project.document.children[0].visible).toBe(false);if(paint.kind!=='paint'||(paint.strokes[0].kind==='fill' || paint.strokes[0].kind === 'wet'))throw new Error('Missing authored texture');expect(paint.strokes[0].texture).toEqual({assetId:before.entries[0].id,channel:'luminance',invert:false});expect(project.entries).toHaveLength(1);expect(Buffer.from(await project.entries[0].blob.arrayBuffer())).toEqual(Buffer.from(await source.arrayBuffer()));
 const original=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),'texture.png');await page.keyboard.press('Control+z');const undone=await read(await download(()=>page.getByRole('button',{name:'Save project',exact:true}).click(),'undone.luma'));expect(undone.document).toEqual(before.document);await page.getByTestId('project-input').setInputFiles(projectPath);const reopened=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),'reopened.png');
 const checked=spawnSync('python3',['-c',"from PIL import Image;import numpy as np,sys;a=np.asarray(Image.open(sys.argv[1]).convert('RGBA'));b=np.asarray(Image.open(sys.argv[2]).convert('RGBA'));assert a.shape==b.shape==(64,64,4);assert np.array_equal(a,b);assert a[32,32].tolist()==[255,0,0,255];assert a[0,0].tolist()==[0,0,0,0];print('All authored texture pixels survive native project reopen; analytic center and empty corner match')",original,reopened],{encoding:'utf8',timeout:30000});expect(checked.status,checked.stderr||checked.stdout).toBe(0);expect(errors).toEqual([]);await info.attach('production-authored-brush-texture',{body:JSON.stringify({schema:32,sourceBytesExact:true,oneStepUndo:true,noDeveloperGlobal:true,independent:checked.stdout}),contentType:'application/json'});
});

test('production documented red-eye workflow retains editable masks, exact pixels, undo and project reopen without globals',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('/');expect(await page.evaluate(()=>'luma' in window)).toBe(false);
 const download=async(action:()=>Promise<unknown>,name:string)=>{const pending=page.waitForEvent('download');await action();const path=info.outputPath(name);await(await pending).saveAs(path);return path;};
 const project=async(name:string)=>{const path=await download(()=>page.getByRole('button',{name:'Save project',exact:true}).click(),name);return{path,value:await readProject(new Blob([new Uint8Array(await readFile(path))]))};};
 const before=await project('before.luma'),code=(await readFile('docs/SCRIPTING_API.md','utf8')).match(/<!-- example: red-eye-correction -->\s*```js\n([\s\S]*?)\n```/)?.[1];expect(code).toBeTruthy();
 await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();await page.getByLabel('Script code',{exact:true}).fill(code!);await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('Red-eye study ready; threshold 32');await page.getByRole('button',{name:'Close scripts',exact:true}).click();
 const saved=await project('red-eye.luma'),layer=saved.value.document.children.at(-1);expect(saved.value.document.schemaVersion).toBe(40);if(layer?.kind!=='adjustment'||layer.mask?.kind!=='selection')throw new Error('Missing editable pupil mask');expect(layer.adjustment).toEqual({kind:'red-eye',threshold:32,strength:100});expect(layer.mask.selection.regions).toHaveLength(2);
 const png=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),'corrected.png');await page.keyboard.press('Control+z');expect((await project('undo.luma')).value.document).toEqual(before.value.document);
 await page.reload();expect(await page.evaluate(()=>'luma' in window)).toBe(false);await page.getByTestId('project-input').setInputFiles(saved.path);await expect(page.locator('.layer-row')).toHaveCount(2);const reopened=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),'reopened.png');
 const checked=spawnSync('python3',['-c',"from PIL import Image;import numpy as np,sys;a=np.asarray(Image.open(sys.argv[1]).convert('RGBA'));b=np.asarray(Image.open(sys.argv[2]).convert('RGBA'));assert a.shape==b.shape==(48,96,4);assert np.array_equal(a,b);assert list(a[18,22])==[32,24,40,255];assert list(a[18,70])==[32,24,40,255];assert list(a[2,2])==[216,176,152,255];print('Both synthetic pupils corrected; exterior and all project-reopened pixels exact')",png,reopened],{encoding:'utf8',timeout:30000});expect(checked.status,checked.stderr||checked.stdout).toBe(0);expect(errors).toEqual([]);
 await info.attach('production-red-eye',{body:JSON.stringify({schema:40,noDeveloperGlobal:true,oneStepUndo:true,independent:checked.stdout}),contentType:'application/json'});
});

test('production native frequency layers preserve source bytes, exact pixels, isolated scripting and one undo without globals',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('/');expect(await page.evaluate(()=>'luma' in window)).toBe(false);
 const download=async(action:()=>Promise<unknown>,name:string)=>{const pending=page.waitForEvent('download');await action();const path=info.outputPath(name);await(await pending).saveAs(path);return path;};
 const project=async(name:string)=>{const path=await download(()=>page.getByRole('button',{name:'Save project',exact:true}).click(),name);return{path,value:await readProject(new Blob([new Uint8Array(await readFile(path))]))};};
 const pixels=new Uint8Array(64*32*4);for(let y=0;y<32;y++)for(let x=0;x<64;x++)pixels.set([(x*31+y*7)%256,(x*9+y*43)%256,(x*17+y*11)%256,[0,64,128,255][y%4]],(y*64+x)*4);
 const source=Buffer.from(await(await encodeRgbaPng(pixels,64,32)).arrayBuffer());await page.getByTestId('import-input').setInputFiles({name:'Frequency source.png',mimeType:'image/png',buffer:source});await expect(page.locator('.layer-row')).toHaveCount(1);
 const before=await project('before-frequency.luma'),originalPng=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),'original.png');
 await page.keyboard.press('Control+k');await page.getByRole('combobox',{name:'Search commands'}).fill('Frequency separation');await page.getByRole('option',{name:/Frequency separation/}).click();const preview=page.getByRole('img',{name:'Color and tone preview',exact:true});await expect(page.locator('.frequency-preview-caption')).toContainText('radius 4.0 px');const previewBefore=await preview.evaluate(node=>(node as HTMLCanvasElement).toDataURL());await page.getByLabel('Separation radius value',{exact:true}).fill('8');await page.getByLabel('Separation radius value',{exact:true}).press('Enter');await expect(page.locator('.frequency-preview-caption')).toContainText('radius 8.0 px');expect(await preview.evaluate(node=>(node as HTMLCanvasElement).toDataURL())).not.toBe(previewBefore);await page.getByLabel('Separation radius value',{exact:true}).fill('2');await page.getByLabel('Separation radius value',{exact:true}).press('Enter');await page.getByRole('button',{name:'Create frequency layers',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('button',{name:'Edit contents',exact:true})).toBeEnabled();
 const saved=await project('frequency.luma');expect(saved.value.document.schemaVersion).toBe(40);expect(saved.value.document.children[0]).toMatchObject({id:before.value.document.children[0].id,visible:false});expect(saved.value.document.children[1]).toMatchObject({kind:'group',name:'Frequency separation'});expect(saved.value.entries).toHaveLength(2);expect(Buffer.from(await saved.value.entries.find(entry=>entry.id===before.value.entries[0].id)!.blob.arrayBuffer())).toEqual(source);
 const output=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),'frequency.png');await page.getByLabel('Editing canvas',{exact:true}).focus();await page.keyboard.press('Control+z');expect((await project('undone.luma')).value.document).toEqual(before.value.document);
 await page.getByRole('button',{name:`Select ${before.value.document.children[0].name}`,exact:true}).click();
 const guide=await readFile('docs/SCRIPTING_API.md','utf8'),code=guide.match(/<!-- example: frequency-separation -->\s*```js\n([\s\S]*?)\n```/)?.[1];if(!code)throw new Error('Missing frequency recipe');
 await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();await page.getByLabel('Script code',{exact:true}).fill(code);await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('Frequency layers ready');await page.getByRole('button',{name:'Close scripts',exact:true}).click();const scripted=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),'scripted.png');
 await page.reload();expect(await page.evaluate(()=>'luma' in window)).toBe(false);await page.getByTestId('project-input').setInputFiles(saved.path);await page.getByRole('button',{name:'Select Frequency layers — edit contents',exact:true}).click();await expect(page.getByRole('button',{name:'Edit contents',exact:true})).toBeEnabled();const reopened=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),'reopened.png');
 await page.getByRole('button',{name:'Edit contents',exact:true}).click();await expect(page.getByRole('region',{name:'Smart-object contents'})).toBeVisible();await page.getByRole('button',{name:'Select Color retouch',exact:true}).click();const contentsBefore=await project('frequency-contents-before.luma'),shared=page.getByLabel('Shared separation radius value',{exact:true});await expect(shared).toHaveValue('2');await shared.fill('5');await shared.press('Enter');const contentsAfter=await project('frequency-contents-after.luma'),beforeGroup=contentsBefore.value.document.children[0],afterGroup=contentsAfter.value.document.children[0];if(beforeGroup.kind!=='group'||afterGroup.kind!=='group')throw new Error('Missing native frequency group');expect(afterGroup.frequencyRadius).toBe(5);expect(afterGroup.children).toEqual(beforeGroup.children);await page.getByLabel('Editing canvas',{exact:true}).focus();await page.keyboard.press('Control+z');expect((await project('frequency-radius-undo.luma')).value.document).toEqual(contentsBefore.value.document);
 const sharedCode=guide.match(/<!-- example: frequency-shared-radius -->\s*```js\n([\s\S]*?)\n```/)?.[1];if(!sharedCode)throw new Error('Missing shared radius guide');await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();await page.getByLabel('Script code',{exact:true}).fill(sharedCode);await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('Shared native radius 6');await page.getByRole('button',{name:'Close scripts',exact:true}).click();await expect(shared).toHaveValue('6');
 const checked=spawnSync('python3',['-c',"from PIL import Image;import numpy as np,sys;images=[np.asarray(Image.open(p).convert('RGBA')) for p in sys.argv[1:]];a=images[0];assert a.shape==(32,64,4);assert np.max(a[:,:,3])==255;assert np.min(a[:,:,3])==0;prem=lambda x:np.rint(x[:,:,:3].astype(float)*x[:,:,3:4]/255).astype(int);assert all(np.array_equal(a[:,:,3],b[:,:,3]) for b in images[1:]);assert all(np.max(abs(prem(a)-prem(b)))<=1 for b in images[1:]);print('Native UI, isolated script and reopened frequency PNGs preserve all premultiplied pixels and alpha')",originalPng,output,scripted,reopened],{encoding:'utf8',timeout:30000});expect(checked.status,checked.stderr||checked.stdout).toBe(0);expect(errors).toEqual([]);await info.attach('production-frequency',{body:JSON.stringify({schema:40,noDeveloperGlobal:true,sourceBytesExact:true,oneStepUndo:true,nativePreview:true,sharedRadius:true,independent:checked.stdout}),contentType:'application/json'});
});


test('production extreme bitmap placement survives isolated edits, native PNG, one undo and project reopen',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('/');expect(await page.evaluate(()=>'luma'in window)).toBe(false);
 const download=async(action:()=>Promise<unknown>,name:string)=>{const pending=page.waitForEvent('download');await action();const path=info.outputPath(name);await(await pending).saveAs(path);return path;};
 const project=async(name:string)=>{const path=await download(()=>page.getByRole('button',{name:'Save project',exact:true}).click(),name);return{path,value:await readProject(new Blob([new Uint8Array(await readFile(path))]))};};
 const pixels=new Uint8Array(32*32*4);for(let i=0;i<pixels.length;i+=4)pixels.set([255,0,0,128],i);const source=Buffer.from(await(await encodeRgbaPng(pixels,32,32)).arrayBuffer());await page.getByTestId('import-input').setInputFiles({name:'Precision source.png',mimeType:'image/png',buffer:source});await expect(page.locator('.layer-row')).toHaveCount(1);const before=await project('before.luma');
 await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();await page.getByLabel('Script code',{exact:true}).fill("const layer=document.activeLayer;layer.transform=new AffineTransform(1e9,0,0,1e9,-32e9+4.75,-16e9+16.5);layer.mask=LayerMask.fromBitmap(layer.assetId);print('Precision source remains editable');");await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('Precision source remains editable');await page.getByRole('button',{name:'Close scripts',exact:true}).click();
 const saved=await project('precision.luma'),png=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),'precision.png');expect(saved.value.document.children[0]).toMatchObject({kind:'raster',width:32,height:32});expect(Buffer.from(await saved.value.entries[0].blob.arrayBuffer())).toEqual(source);
 await page.getByLabel('Editing canvas',{exact:true}).focus();await page.keyboard.press('Control+z');expect((await project('undo.luma')).value.document).toEqual(before.value.document);await page.keyboard.press('Control+Shift+z');expect((await project('redo.luma')).value.document).toEqual(saved.value.document);
 await page.reload();expect(await page.evaluate(()=>'luma'in window)).toBe(false);await page.getByTestId('project-input').setInputFiles(saved.path);await expect(page.locator('.layer-row')).toHaveCount(1);const reopened=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),'reopened.png');
 const verified=spawnSync('python3',['-c',"from PIL import Image;import sys;a=Image.open(sys.argv[1]).convert('RGBA');b=Image.open(sys.argv[2]).convert('RGBA');assert a.size==b.size==(32,32);assert a.tobytes()==b.tobytes();assert all(a.getpixel((x,y))==((255,0,0,64)if x<5 else(0,0,0,0))for y in range(32)for x in range(32));print('All native pixels, source alpha and reopened output are exact')",png,reopened],{encoding:'utf8',timeout:30000});expect(verified.status,verified.stdout+verified.stderr).toBe(0);expect(errors).toEqual([]);await info.attach('production-extreme-bitmap-projection',{body:JSON.stringify({native:verified.stdout,sourceBytesExact:true,oneStepUndo:true,isolatedScript:true}),contentType:'application/json'});
});

test('production transformed smart artwork has identical viewport, native PNG and reopened pixels',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('/');expect(await page.evaluate(()=>'luma'in window)).toBe(false);
 const download=async(action:()=>Promise<unknown>,name:string)=>{const pending=page.waitForEvent('download');await action();const path=info.outputPath(name);await(await pending).saveAs(path);return path;},project=async(name:string)=>{const path=await download(()=>page.getByRole('button',{name:'Save project',exact:true}).click(),name);return{path,value:await readProject(new Blob([new Uint8Array(await readFile(path))]))};};
 const pixels=new Uint8Array(1024*384*4);for(let y=0;y<384;y++)for(let x=0;x<1024;x++)pixels.set([(x*31+y*7)%256,(x*9+y*43)%256,(x*17+y*11)%256,[0,1,64,128,255][(x+y)%5]],(y*1024+x)*4);const source=Buffer.from(await(await encodeRgbaPng(pixels,1024,384)).arrayBuffer());await page.getByTestId('import-input').setInputFiles({name:'Canonical source.png',mimeType:'image/png',buffer:source});await expect(page.locator('.layer-row')).toHaveCount(1);const before=await project('before-canonical.luma');
 await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();await page.getByLabel('Script code',{exact:true}).fill("const original=document.activeLayer;const smart=original.convertToSmartObject();const contents=smart.editContents();const image=contents.layers.at(0);image.transform=new AffineTransform(.93,.17,-.09,1.04,31,14);const vector=contents.layers.add(new VectorLayer());vector.paths.add(VectorPath.ellipse({x:47.25,y:13.5,width:900.3,height:330.7},{fill:'#eedd44',stroke:null}));smart.replaceContents(contents);smart.setFilters([new SmartToneFilter({exposure:.7,contrast:13,saturation:-30})]);smart.filterMask=LayerMask.fromBitmap(image.assetId,{x:31,y:14,basis:new AffineTransform(.75,.17,-.09,.8,0,0),density:.7});smart.transform=new AffineTransform(.93,.17,-.09,1.04,31,14);document.layers.add(new LayerGroup({name:'Canvas backend fixture',blendMode:'pass-through'}));document.selectedLayer=smart;print('Canonical artwork ready');");await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('Canonical artwork ready');await page.getByRole('button',{name:'Close scripts',exact:true}).click();await page.getByLabel('Editing canvas',{exact:true}).focus();await page.keyboard.press('Control+1');await expect(page.locator('footer .status-dot.working')).toHaveCount(0);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await expect(page.locator('footer')).toContainText('Standard rendering');
 const cropped=await page.locator('.canvas-wrap canvas[data-testid="artwork"]').evaluate(node=>{const canvas=node as HTMLCanvasElement,host=canvas.parentElement!;return{png:canvas.toDataURL(),x:parseFloat(host.style.left),y:parseFloat(host.style.top),width:canvas.width,height:canvas.height};}),croppedPath=info.outputPath('cropped-viewport.png');await writeFile(croppedPath,Buffer.from(cropped.png.split(',')[1],'base64'));expect([cropped.x,cropped.y,cropped.width,cropped.height].every(Number.isSafeInteger)).toBe(true);await page.setViewportSize({width:2000,height:1000});await page.waitForFunction(()=>{const canvas=document.querySelector('.canvas-wrap canvas[data-testid="artwork"]')as HTMLCanvasElement|null;return canvas?.width===1024&&canvas.height===384;});await expect(page.locator('footer .status-dot.working')).toHaveCount(0);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const displayed=await page.locator('.canvas-wrap canvas[data-testid="artwork"]').evaluate(canvas=>(canvas as HTMLCanvasElement).toDataURL()),viewport=info.outputPath('viewport.png');await writeFile(viewport,Buffer.from(displayed.split(',')[1],'base64'));const saved=await project('canonical.luma'),png=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),'canonical.png');expect(saved.value.document.schemaVersion).toBe(40);expect(saved.value.entries).toHaveLength(1);expect(Buffer.from(await saved.value.entries[0].blob.arrayBuffer())).toEqual(source);
 await page.getByLabel('Editing canvas',{exact:true}).focus();await page.keyboard.press('Control+z');expect((await project('canonical-undo.luma')).value.document).toEqual(before.value.document);await page.keyboard.press('Control+Shift+z');expect((await project('canonical-redo.luma')).value.document).toEqual(saved.value.document);await page.reload();expect(await page.evaluate(()=>'luma'in window)).toBe(false);await page.getByTestId('project-input').setInputFiles(saved.path);await expect(page.locator('.layer-row')).toHaveCount(2);const reopened=await download(()=>page.getByRole('button',{name:'Export PNG',exact:true}).click(),'canonical-reopened.png');
 const verified=spawnSync('python3',['-c',"from PIL import Image;import sys;images=[Image.open(p).convert('RGBA')for p in sys.argv[1:4]];crop=Image.open(sys.argv[4]).convert('RGBA');x,y,w,h=map(int,sys.argv[5:9]);assert crop.size==(w,h);assert crop.tobytes()==images[1].crop((x,y,x+w,y+h)).tobytes();assert all(i.size==(1024,384)for i in images);assert all(i.tobytes()==images[0].tobytes()for i in images[1:]);assert images[0].getbbox()is not None;assert len(set(images[0].getdata()))>10;print('Every RGBA byte agrees across displayed native artwork, streamed PNG and project reopening')",viewport,png,reopened,croppedPath,String(cropped.x),String(cropped.y),String(cropped.width),String(cropped.height)],{encoding:'utf8',timeout:30000});expect(verified.status,verified.stdout+verified.stderr).toBe(0);expect(errors).toEqual([]);await info.attach('production-canonical-canvas',{body:JSON.stringify({native:verified.stdout,sourceBytesExact:true,oneStepUndo:true,isolatedScript:true,noDeveloperGlobal:true,croppedViewportExact:true,crop:{x:cropped.x,y:cropped.y,width:cropped.width,height:cropped.height}}),contentType:'application/json'});
});
