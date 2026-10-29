import{expect,type Page,type TestInfo}from'@playwright/test';
import{readFile,writeFile}from'node:fs/promises';
import{createHash}from'node:crypto';
import{spawnSync}from'node:child_process';
import{historyProject,historyPng,historyScript}from'./history-inspector';

/** Ordinary controls only, also runs with every developer global absent. */
export async function floatProofWorkflow(page:Page,info:TestInfo,production=false,device='narrow-rgb'){
 const original='tests/fixtures/uint16-float/u16-all-levels.tif';
 await page.goto('/');expect(await page.evaluate(()=>'luma'in window)).toBe(!production);
 await page.getByTestId('import-input').setInputFiles(original);
 const admission=page.getByRole('dialog',{name:'Import TIFF',exact:true});
 await admission.getByLabel('TIFF editing precision',{exact:true}).selectOption('float32');
 await admission.getByRole('button',{name:'Import TIFF page',exact:true}).click();await expect(admission).toHaveCount(0);
 const before=await historyProject(page,info,'float-proof-before.luma'),plain=await historyPng(page,info,'float-proof-plain.png');
 expect(before.value.document.precision).toBe('float32');
 const open=async()=>{await page.getByRole('button',{name:'Color',exact:true}).click();return page.locator('.color-profile-dialog');};
 let dialog=await open();await expect(dialog.getByLabel('Simulate Output Gamut (Soft Proof)')).toBeEnabled();
 await dialog.getByLabel('Simulate Output Gamut (Soft Proof)').check();await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
 expect((await historyPng(page,info,'float-proof-cancel.png')).bytes).toEqual(plain.bytes);
 dialog=await open();await dialog.getByLabel('Import ICC profile',{exact:true}).setInputFiles('tests/fixtures/icc-native/'+device+'.icc');
 await expect(dialog.locator('strong').filter({hasText:device+'.icc'})).toBeVisible();
 await dialog.getByLabel('Simulate Output Gamut (Soft Proof)').check();
 const profile=await dialog.getByLabel('Simulated target profile',{exact:true}).getByRole('option',{name:device+'.icc',exact:true}).getAttribute('value');if(!profile)throw new Error('Imported proof device option is missing.');
 await dialog.getByLabel('Output RGB profile',{exact:true}).selectOption('srgb');
 await dialog.getByLabel('Simulate Output Gamut (Soft Proof)').check();
 await dialog.getByLabel('Simulated target profile',{exact:true}).selectOption(profile!);
 await dialog.getByLabel('Gamut warning',{exact:true}).check();await dialog.getByLabel('Warning color',{exact:true}).fill('#c731e9');await expect(dialog.getByRole('heading',{name:'Color Settings & ICC Profile',exact:true})).toBeInViewport({ratio:1});await expect(dialog.getByRole('button',{name:'Apply Settings',exact:true})).toBeInViewport({ratio:1});await page.screenshot({path:info.outputPath('float-proof-settings.png')});
 await dialog.getByRole('button',{name:'Apply Settings',exact:true}).click();await expect(dialog).toHaveCount(0);
 await expect(page.getByTestId('proof-status')).toContainText('applied');
 await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();await page.keyboard.press('Control+1');
 await expect(page.getByTestId('proof-status')).toContainText('applied');
 const alarms=await page.getByTestId('artwork').evaluate(element=>{const canvas=element as HTMLCanvasElement,pixels=canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data;let count=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]===199&&pixels[i+1]===49&&pixels[i+2]===233&&pixels[i+3]===255)count++;return count;});expect(alarms).toBeGreaterThan(0);
 await page.screenshot({path:info.outputPath('float-proof-applied.png')});
 const unchanged=await historyProject(page,info,'float-proof-settings.luma');expect(unchanged.value.document).toEqual(before.value.document);expect(unchanged.value.history).toEqual(before.value.history);
 expect((await historyPng(page,info,'float-proof-enabled.png')).bytes).toEqual(plain.bytes);
 await historyScript(page,'document.layers.at(0).adjustments.add(new ToneAdjustment({exposure:.5}));','Native float proof edit ready');
 await expect(page.getByTestId('proof-status')).toContainText('applied');
 const edited=await historyProject(page,info,'float-proof-edited.luma'),editedPng=await historyPng(page,info,'float-proof-edited.png');expect(editedPng.bytes).not.toEqual(plain.bytes);
 const exportFile=async(format:'tiff'|'pdf',name:string)=>{await page.getByRole('button',{name:'Export…',exact:true}).click();const dialog=page.locator('.export-dialog');await dialog.getByLabel('Format',{exact:true}).selectOption(format);if(format==='tiff'){await dialog.getByLabel('TIFF precision',{exact:true}).selectOption('float32');await expect(dialog).toContainText('RGB output: Linear sRGB.');await dialog.getByLabel('Use output RGB profile for high-precision TIFF',{exact:true}).check();await expect(dialog).toContainText('RGB output: sRGB IEC61966-2.1.');}const pending=page.waitForEvent('download');await dialog.getByRole('button',{name:format==='tiff'?'Export .tif':'Export .pdf',exact:true}).click();const path=info.outputPath(name);await(await pending).saveAs(path);await expect(dialog).toHaveCount(0);return{path,bytes:await readFile(path)};};
 const proofTiff=await exportFile('tiff','float-proof-enabled.tif'),proofPdf=await exportFile('pdf','float-proof-enabled.pdf'),independent=[];
 for(const[file,precision]of[[editedPng,'uint8'],[proofTiff,'float32'],[proofPdf,'uint8']]as const){const checked=spawnSync(process.env.CANOLI_PDF_PYTHON||'python3',['scripts/check-float-document.py',file.path,'--source-name','u16-all-levels.tif','--native-lcms','/tmp/canoli-color-lcms2.19.1-native.so','--precision',precision,'--profile','srgb','--tone',JSON.stringify({exposure:.5,contrast:0,saturation:0})],{encoding:'utf8',timeout:120000});expect(checked.status,checked.stderr||checked.stdout).toBe(0);independent.push(JSON.parse(checked.stdout));}

 await page.getByRole('button',{name:'Undo (Mod+Z)',exact:true}).click();
 expect((await historyProject(page,info,'float-proof-undone.luma')).value.document).toEqual(before.value.document);
 expect((await historyPng(page,info,'float-proof-undone.png')).bytes).toEqual(plain.bytes);
 await page.getByRole('button',{name:'Redo (Mod+Shift+Z)',exact:true}).click();
 await expect(page.getByTestId('proof-status')).toContainText('applied');
 await page.getByRole('button',{name:'Recover work',exact:true}).click();await page.getByRole('button',{name:'Save workspace',exact:true}).click();
 await expect(page.getByText('Workspace saved in this browser, including tab order and canvas views.',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Close recovery',exact:true}).click();
 await page.reload();await page.getByRole('button',{name:'Recover work',exact:true}).click();await page.getByRole('button',{name:'Restore workspace',exact:true}).click();
 await expect(page.getByTestId('proof-status')).toContainText('applied');
 const restored=await historyProject(page,info,'float-proof-restored.luma');expect(restored.value.document).toEqual(edited.value.document);expect(restored.value.history).toEqual(edited.value.history);
 const image=restored.value.entries.find(e=>e.tiff);expect(image).toBeTruthy();expect(new Uint8Array(await image!.blob.arrayBuffer())).toEqual(new Uint8Array(await readFile(original)));
 expect((await historyPng(page,info,'float-proof-restored.png')).bytes).toEqual(editedPng.bytes);
 dialog=await open();await expect(dialog.getByLabel('Simulated target profile',{exact:true})).toHaveValue(profile);await expect(dialog.getByLabel('Warning color',{exact:true})).toHaveValue('#c731e9');
 await dialog.getByLabel('Simulate Output Gamut (Soft Proof)').uncheck();await dialog.getByRole('button',{name:'Apply Settings',exact:true}).click();
 await expect(page.getByTestId('proof-status')).toHaveCount(0);expect((await historyPng(page,info,'float-proof-disabled.png')).bytes).toEqual(editedPng.bytes);expect((await exportFile('tiff','float-proof-disabled.tif')).bytes).toEqual(proofTiff.bytes);expect((await exportFile('pdf','float-proof-disabled.pdf')).bytes).toEqual(proofPdf.bytes);
 await page.screenshot({path:info.outputPath('float-proof-workflow.png')});
 await writeFile(info.outputPath('float-proof-workflow.json'),JSON.stringify({production,device,opaqueAlarmPixels:alarms,proofExcludedFromOriginalAndEditedDelivery:true,independent,sourceAndHistoryExact:true,workspaceRetainedProfileAndSettings:true,undoRedoExact:true,originalSha256:createHash('sha256').update(await readFile(original)).digest('hex')},null,2));
}
