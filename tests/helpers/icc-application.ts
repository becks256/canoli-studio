import {expect,type Page,type TestInfo}from '@playwright/test';
import {writeFile}from 'node:fs/promises';
import {spawnSync}from 'node:child_process';
import {historyScript,historyProject,historyPng}from './history-inspector';

export async function iccApplicationWorkflow(page:Page,info:TestInfo,production=false){
 await page.goto('/');expect(await page.evaluate(()=>'luma'in window)).toBe(!production);
 await historyScript(page,"document.resize(96,64);const layer=document.layers.add(new PaintLayer({name:'ICC native artwork'}));for(const [x,color,opacity]of [[0,'#ff0000',1],[32,'#30b060',.5],[64,'#2060ff',.01]])layer.strokes.add(new PaintFill({bounds:{x,y:0,width:32,height:64},color,opacity}));document.selectedLayer=layer",'ICC artwork ready');
 const before=await historyProject(page,info,'icc-before.luma'),baseline=await historyPng(page,info,'icc-srgb.png');
 const openColor=async()=>{await page.getByRole('button',{name:'Color',exact:true}).click();return page.locator('.color-profile-dialog');};
 let dialog=await openColor();await dialog.getByLabel('Output RGB profile',{exact:true}).selectOption('display-p3');await dialog.getByLabel('Simulate Output Gamut (Soft Proof)').check();await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
 expect((await historyPng(page,info,'icc-cancel.png')).bytes).toEqual(baseline.bytes);
 dialog=await openColor();await dialog.getByLabel('Import ICC profile',{exact:true}).setInputFiles('tests/fixtures/icc-native/narrow-rgb.icc');await expect(dialog.locator('strong').filter({hasText:'narrow-rgb.icc'})).toBeVisible();
 await dialog.getByLabel('Simulate Output Gamut (Soft Proof)').check();
 const imported=(await dialog.getByLabel('Output RGB profile',{exact:true}).inputValue());
 await dialog.getByLabel('Simulated target profile',{exact:true}).selectOption(imported);
 await dialog.getByLabel('Gamut warning',{exact:true}).check();await dialog.getByLabel('Warning color',{exact:true}).fill('#ff00ff');
 await dialog.getByRole('button',{name:'Apply Settings',exact:true}).click();await expect(dialog).toHaveCount(0);
 await expect(page.getByTestId('proof-status')).toContainText('applied');await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();await page.keyboard.press('Control+1');await expect(page.getByTestId('proof-status')).toContainText('applied');
 await expect.poll(()=>page.getByTestId('artwork').evaluate(canvas=>{const c=canvas as HTMLCanvasElement;if(canvas.dataset.renderer!=='canvas2d')return null;return[...c.getContext('2d')!.getImageData(Math.min(4,c.width-1),Math.min(4,c.height-1),1,1).data];})).toEqual([255,0,255,255]);
 await page.screenshot({path:info.outputPath('icc-proof.png')});
 const converted=await historyPng(page,info,'icc-output.png');
 const exportFile=async(format:string,extension:string)=>{
  await page.getByRole('button',{name:'Export…',exact:true}).click();const dialog=page.locator('.export-dialog');await dialog.getByLabel('Format',{exact:true}).selectOption(format);await expect(dialog).toContainText('narrow-rgb.icc');
  const pending=page.waitForEvent('download');await dialog.getByRole('button',{name:`Export .${extension}`,exact:true}).click();const path=info.outputPath('icc-output.'+extension);await(await pending).saveAs(path);await expect(dialog).toHaveCount(0);return path;
 };
 const tiff=await exportFile('tiff','tif'),pdf=await exportFile('pdf','pdf');
 const checked=spawnSync(process.env.CANOLI_PDF_PYTHON||'python3',['scripts/check-icc-delivery.py',baseline.path,'tests/fixtures/icc-native/narrow-rgb.icc',converted.path,tiff,pdf],{encoding:'utf8',timeout:120000});expect(checked.status,checked.stderr||checked.stdout).toBe(0);
 const after=await historyProject(page,info,'icc-after.luma');expect(after.value.document).toEqual(before.value.document);expect(after.value.history).toEqual(before.value.history);
 await page.getByRole('button',{name:'Recover work',exact:true}).click();await page.getByRole('button',{name:'Save workspace',exact:true}).click();await expect(page.getByText('Workspace saved in this browser, including tab order and canvas views.',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Close recovery',exact:true}).click();
 await page.reload();await page.getByRole('button',{name:'Recover work',exact:true}).click();await page.getByRole('button',{name:'Restore workspace',exact:true}).click();await expect(page.getByTestId('proof-status')).toContainText('applied');
 expect((await historyPng(page,info,'icc-workspace-restored.png')).bytes).toEqual(converted.bytes);
 dialog=await openColor();await expect(dialog.getByLabel('Output RGB profile').locator('option')).toHaveCount(5);await expect(dialog.getByLabel('Output RGB profile',{exact:true})).toHaveValue(imported);await expect(dialog.getByLabel('Simulate Output Gamut (Soft Proof)')).toBeChecked();await dialog.getByLabel('Simulate Output Gamut (Soft Proof)').uncheck();await dialog.getByRole('button',{name:'Apply Settings',exact:true}).click();await expect(page.getByTestId('proof-status')).toHaveCount(0);
 expect((await historyPng(page,info,'icc-proof-disabled.png')).bytes).toEqual(converted.bytes);
 const result={production,independent:JSON.parse(checked.stdout),sourceAndHistoryUnchanged:true,proofPixel:[255,0,255,255],proofExcludedFromDelivery:true,workspaceRetainedCompleteCustomProfile:true};await writeFile(info.outputPath('icc-application.json'),JSON.stringify(result,null,2));await info.attach('icc-application',{body:JSON.stringify(result),contentType:'application/json'});
}
