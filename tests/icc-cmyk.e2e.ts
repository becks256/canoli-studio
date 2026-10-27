import{test,expect}from'@playwright/test';
import{writeFile}from'node:fs/promises';
import{historyScript,historyProject,historyPng}from'./helpers/history-inspector';
test('a CMYK ICC file is selectable only for actual canvas proof, preserving RGB delivery and original artwork',async({page},info)=>{
 await page.goto('/');await historyScript(page,"document.resize(64,64);const layer=document.layers.add(new PaintLayer());layer.strokes.add(new PaintFill({bounds:{x:0,y:0,width:64,height:64},color:'#ff0000'}));document.selectedLayer=layer",'CMYK proof source ready');
 const before=await historyProject(page,info,'cmyk-before.luma'),png=await historyPng(page,info,'cmyk-before.png');
 await page.getByRole('button',{name:'Color',exact:true}).click();const dialog=page.locator('.color-profile-dialog');await dialog.getByLabel('Import ICC profile',{exact:true}).setInputFiles('tests/fixtures/icc-native/synthetic-cmyk.icc');await expect(dialog.locator('strong').filter({hasText:'synthetic-cmyk.icc'})).toBeVisible();
 await expect(dialog.getByLabel('Output RGB profile').locator('option')).toHaveCount(4);await expect(dialog.getByLabel('Simulated target profile').locator('option')).toHaveCount(5);await expect(dialog.getByLabel('Simulate Output Gamut (Soft Proof)')).toBeChecked();await expect(dialog.getByLabel('Simulated target profile').locator('option:checked')).toHaveText('synthetic-cmyk.icc');
 await dialog.getByRole('button',{name:'Apply Settings',exact:true}).click();await expect(page.getByTestId('proof-status')).toContainText('applied');await expect(page.getByTestId('proof-status')).toContainText('synthetic-cmyk.icc');
 const pixel=await page.getByTestId('artwork').evaluate(canvas=>[...(canvas as HTMLCanvasElement).getContext('2d')!.getImageData(1,1,1,1).data]);// Independent synthetic-cmyk-proof-1-1-0.rgba maps sRGB red to [255,0,11]; alpha is copied.
 expect(pixel).toEqual([255,0,11,255]);
 expect((await historyPng(page,info,'cmyk-proof-delivery.png')).bytes).toEqual(png.bytes);const after=await historyProject(page,info,'cmyk-after.luma');expect(after.value.document).toEqual(before.value.document);expect(after.value.history).toEqual(before.value.history);await page.screenshot({path:info.outputPath('cmyk-device-proof.png')});await writeFile(info.outputPath('icc-cmyk-ui.json'),JSON.stringify({syntheticDevice:true,proofApplied:true,pixel,rgbOutputOnly:true,proofExcludedFromDelivery:true,sourceAndHistoryUnchanged:true,physicalQualityProven:false},null,2));
});
