import {expect, type Page, type TestInfo} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {historyScript,openHistoryInspector,historyProject,historyPng} from './history-inspector';
export async function comparisonImage(page:Page,info:TestInfo,label:string,name:string){
 const bytes=Buffer.from(await page.getByRole('img',{name:label,exact:true}).evaluate(async element=>Array.from(new Uint8Array(await(await fetch((element as HTMLImageElement).src)).arrayBuffer()))));
 await writeFile(info.outputPath(name),bytes);await info.attach(name,{body:bytes,contentType:'image/png'});return bytes;
}
export async function historyComparisonsWorkflow(page:Page,info:TestInfo,production=false){
 await page.goto('/');expect(await page.evaluate(()=>'luma'in window)).toBe(!production);
 await historyScript(page,"document.resize(400,300);const layer=document.layers.add(new PaintLayer({name:'Comparison target',x:30,y:20}));layer.strokes.add(new PaintFill({bounds:{x:0,y:0,width:120,height:90},color:'#ff0000'}));document.selectedLayer=layer",'Comparison red ready');
 await historyScript(page,"document.selectedLayer.strokes.add(new PaintFill({bounds:{x:0,y:0,width:120,height:90},color:'#0000ff'}))",'Comparison blue ready');
 let dialog=await openHistoryInspector(page);await dialog.getByLabel('Branch name',{exact:true}).fill('Green alternative');await dialog.getByRole('button',{name:'Create branch from current state',exact:true}).click();await dialog.getByRole('button',{name:'Done',exact:true}).click();
 await historyScript(page,"document.selectedLayer.strokes.add(new PaintFill({bounds:{x:0,y:0,width:120,height:90},color:'#00ff00'}))",'Comparison green ready');
 const green=await historyPng(page,info,'comparison-green-full.png');
 dialog=await openHistoryInspector(page);await expect(dialog.getByRole('list',{name:'History branch ancestry',exact:true}).getByRole('button')).toHaveCount(2);
 await dialog.getByText('Save a new comparison',{exact:true}).click();await dialog.getByLabel('New comparison name',{exact:true}).fill('Blue versus green');
 await dialog.getByLabel('Before comparison state',{exact:true}).selectOption({label:'Branch Main: accepted tip'});
 for(const [field,value]of Object.entries({x:30,y:20,width:120,height:90})){const input=dialog.getByLabel(`New region ${field}`,{exact:true});await input.fill(String(value));await input.press('Tab');}
 await dialog.getByRole('button',{name:'Save new comparison',exact:true}).click();
 await expect(dialog.getByLabel('Saved history comparison',{exact:true}).getByRole('option',{selected:true})).toHaveText('Blue versus green');
 await dialog.getByRole('button',{name:'Preview saved comparison',exact:true}).click();
 await expect(dialog.getByRole('img',{name:'Saved comparison difference',exact:true})).toBeVisible();await expect(dialog.getByRole('status')).toContainText('10800 of 10800 displayed pixels changed');
 await expect(dialog.getByRole('status')).toContainText('mean absolute channel delta 127.5000/255');
 await comparisonImage(page,info,'Saved comparison before','comparison-before.png');const initialAfter=await comparisonImage(page,info,'Saved comparison after','comparison-after.png');await comparisonImage(page,info,'Saved comparison difference','comparison-difference.png');
 await info.attach('saved-comparison-ui.png',{body:await dialog.screenshot(),contentType:'image/png'});
 await dialog.getByLabel('Saved comparison name',{exact:true}).fill('Reviewed comparison');await dialog.getByRole('button',{name:'Save comparison details',exact:true}).click();
 await dialog.getByLabel('Saved history branch',{exact:true}).selectOption({label:'Main'});await dialog.getByRole('button',{name:'Switch to branch tip',exact:true}).click();
 await dialog.getByLabel('Saved history branch',{exact:true}).selectOption({label:'Green alternative'});await dialog.getByRole('button',{name:'Delete branch',exact:true}).click();await dialog.getByRole('button',{name:'Confirm delete branch',exact:true}).click();
 await expect(dialog.getByRole('list',{name:'History branch ancestry',exact:true}).getByRole('button')).toHaveCount(1);await dialog.getByRole('button',{name:'Done',exact:true}).click();
 const saved=await historyProject(page,info,'comparisons-pinned.luma');expect(saved.value.history?.version).toBe(3);if(saved.value.history?.version!==3)throw Error('Saved comparison missing');
 expect(saved.value.history.branches).toHaveLength(1);expect(saved.value.history.comparisons[0]).toMatchObject({name:'Reviewed comparison',region:{x:30,y:20,width:120,height:90}});
 await page.getByTestId('project-input').setInputFiles(saved.path);dialog=await openHistoryInspector(page);await dialog.getByRole('button',{name:'Preview saved comparison',exact:true}).click();await expect(dialog.getByRole('img',{name:'Saved comparison difference',exact:true})).toBeVisible();
 expect(await comparisonImage(page,info,'Saved comparison after','comparison-reopened-after.png')).toEqual(initialAfter);
 await dialog.getByLabel('Comparison branch name',{exact:true}).fill('Recovered green');await dialog.getByRole('button',{name:'Continue after as branch',exact:true}).click();
 await expect(dialog.getByLabel('Saved history branch',{exact:true}).getByRole('option',{selected:true})).toHaveText('Recovered green (active)');
 await dialog.getByRole('button',{name:'Delete saved comparison',exact:true}).click();await dialog.getByRole('button',{name:'Keep comparison',exact:true}).click();await expect(dialog.getByLabel('Saved history comparison',{exact:true})).toBeVisible();
 await dialog.getByRole('button',{name:'Delete saved comparison',exact:true}).click();await dialog.getByRole('button',{name:'Confirm delete comparison',exact:true}).click();await expect(dialog.getByLabel('Saved history comparison',{exact:true})).toHaveCount(0);
 await dialog.getByRole('button',{name:'Done',exact:true}).click();await expect(page.getByRole('button',{name:'Undo (Mod+Z)',exact:true})).toBeDisabled();
 expect((await historyPng(page,info,'comparison-restored-green-full.png')).bytes).toEqual(green.bytes);
 const afterDelete=await historyProject(page,info,'comparisons-after-delete.luma');expect(afterDelete.value.history?.version).toBe(2);
}
