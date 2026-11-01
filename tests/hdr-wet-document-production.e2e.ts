import {test,expect} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {readProject} from '../src/core/project';
import {historyProject,historyScript} from './helpers/history-inspector';

test('production HDR isolated edits retain exact native TIFF delivery, source files and one Undo without developer globals',async({page},info)=>{
 const fixture='tests/fixtures/hdr-wet-document/setup.luma',input=await readProject(new Blob([new Uint8Array(await readFile(fixture))])),guide=await readFile('docs/HDR_WET_DOCUMENTS.md','utf8'),code=guide.match(/<!-- example: hdr-wet-prepared -->\s*```js\n([\s\S]*?)\n```/)![1];
 await page.goto('/');expect(await page.evaluate(()=>'luma'in window)).toBe(false);await page.getByTestId('project-input').setInputFiles(fixture);await expect(page.getByRole('button',{name:'Select HDR target',exact:true})).toBeVisible();
 const tiff=async(name:string)=>{await page.getByRole('button',{name:'Export…',exact:true}).click();const dialog=page.locator('.export-dialog');await dialog.getByLabel('Format',{exact:true}).selectOption('tiff');await dialog.getByLabel('TIFF precision',{exact:true}).selectOption('float32');await dialog.getByLabel('Use output RGB profile for high-precision TIFF',{exact:true}).uncheck();const download=page.waitForEvent('download');await dialog.getByRole('button',{name:'Export .tif',exact:true}).click();await(await download).saveAs(info.outputPath(name+'.tif'));await expect(dialog).toHaveCount(0);};
 await tiff('before');await historyScript(page,code,'Production HDR ready');const changed=await historyProject(page,info,'hdr-production.luma');expect(changed.value.document.schemaVersion).toBe(57);const target=changed.value.document.children.find(layer=>layer.name==='HDR target');expect(target?.kind).toBe('raster');if(target?.kind!=='raster'||target.erasures?.[0].stroke.kind!=='wet')throw new Error('Missing HDR operation');const stroke=target.erasures[0].stroke;expect(stroke.precision).toBe('float32');await expect(page.getByRole('button',{name:'Undo (Mod+Z)',exact:true})).toBeEnabled();
 for(const entry of input.entries){const output=changed.value.entries.find(row=>row.id===entry.id);expect(Buffer.from(await output!.blob.arrayBuffer())).toEqual(Buffer.from(await entry.blob.arrayBuffer()));}
 for(const[name,id]of [['pixels',stroke.tiles[0].assetId],['coverage',stroke.tiles[0].coverage.assetId]] as const){const asset=changed.value.entries.find(entry=>entry.id===id)!;await writeFile(info.outputPath(name+'.tif'),Buffer.from(await asset.blob.arrayBuffer()));}
 await tiff('production');await page.getByRole('button',{name:'Undo (Mod+Z)',exact:true}).click();expect((await historyProject(page,info,'hdr-production-undo.luma')).value.document).toEqual(input.document);await page.getByRole('button',{name:'Redo (Mod+Shift+Z)',exact:true}).click();expect((await historyProject(page,info,'hdr-production-redo.luma')).value.document).toEqual(changed.value.document);await tiff('redo');
 await page.getByTestId('project-input').setInputFiles(changed.path);await expect(page.getByRole('button',{name:'Select HDR target',exact:true})).toBeVisible();await tiff('reopened');expect(await page.evaluate(()=>'luma'in window)).toBe(false);
 const reference=spawnSync(process.env.CANOLI_REFERENCE_PYTHON??'python3',['scripts/check-hdr-wet-document.py',info.outputDir],{encoding:'utf8',timeout:120000});expect(reference.status,reference.stderr||reference.stdout).toBe(0);await writeFile(info.outputPath('independent-production-hdr.json'),reference.stdout);
});

test.describe('HDR prepared edit guide',()=>{
 test.use({javaScriptEnabled:false,viewport:{width:390,height:844}});
 test('built signatures and isolation boundary remain readable without JavaScript',async({page})=>{
  await page.goto('/developer/hdr-wet-documents.html');await expect(page.getByRole('heading',{name:'Prepared HDR wet document edits',exact:true})).toBeVisible();await expect(page.locator('main')).toContainText('schema 57');await expect(page.locator('main')).toContainText('remain separate required work');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 });
});
