import {expect,type Page,type TestInfo}from '@playwright/test';
import {writeFile}from 'node:fs/promises';
import {spawnSync}from 'node:child_process';
import {historyProject,historyPng}from './history-inspector';

export async function photoshopClippingWorkflow(page:Page,info:TestInfo,fixture:'normal'|'ungrouped'){
 await page.goto('/');expect(await page.evaluate(()=>'luma'in window)).toBe(false);
 await page.getByTestId('psd-input').setInputFiles(`tests/fixtures/psd/clipping/${fixture}.psd`);
 const dialog=page.locator('.psd-import-dialog');await expect(dialog.locator('.psd-meta-card')).toBeVisible();
 if(fixture==='ungrouped'){
  await expect(dialog.locator('input[value="layered"]')).toBeDisabled();await expect(dialog).toContainText('ungrouped clipping blend requires the merged composite');await dialog.getByRole('button',{name:'Import Flattened',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(page.locator('.layer-row')).toHaveCount(1);return;
 }
 await expect(dialog).toContainText('Editable sibling pixel clipping');await dialog.getByRole('button',{name:'Import Layers',exact:true}).click();await expect(dialog).toHaveCount(0);
 await page.getByRole('button',{name:'Select Clipped green',exact:true}).click();await expect(page.getByLabel('Clip to base layer',{exact:true})).toBeChecked();
 const original=await historyProject(page,info,'imported.luma'),png=await historyPng(page,info,'imported.png');expect(original.value.document.children.map(layer=>!!layer.clipped)).toEqual([false,false,true]);
 await page.getByLabel('Clip to base layer',{exact:true}).uncheck();await expect(page.getByLabel('Clip to base layer',{exact:true})).not.toBeChecked();await page.getByRole('button',{name:'Undo (Mod+Z)',exact:true}).click();expect((await historyProject(page,info,'undone.luma')).value.document).toEqual(original.value.document);expect((await historyPng(page,info,'undone.png')).bytes).toEqual(png.bytes);
 const cases=[];
 for(const format of ['psd','psb']){
  await page.getByRole('button',{name:'Export…',exact:true}).click();const output=page.locator('.export-dialog');await output.getByLabel('Format',{exact:true}).selectOption(format);await expect(output).toContainText('Editable sibling pixel clipping');const pending=page.waitForEvent('download');await output.getByRole('button',{name:'Export .'+format,exact:true}).click();const path=info.outputPath('native.'+format);await(await pending).saveAs(path);cases.push({path,reference:png.path,format,names:['Backdrop','Base','Clipped green'],visibility:[true,true,true],clipping:[false,false,true]});
 }
 const path=info.outputPath('independent-cases.json');await writeFile(path,JSON.stringify(cases));const checked=spawnSync(process.env.CANOLI_PSB_PYTHON??'python3',['scripts/check-photoshop-export.py',path],{encoding:'utf8',timeout:120000});await writeFile(info.outputPath('independent.json'),checked.stdout);expect(checked.status,checked.stderr||checked.stdout).toBe(0);
 await page.reload();expect(await page.evaluate(()=>'luma'in window)).toBe(false);await page.getByTestId('project-input').setInputFiles(original.path);expect((await historyPng(page,info,'reopened.png')).bytes).toEqual(png.bytes);
}
