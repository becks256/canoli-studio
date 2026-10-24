import {expect,type Page,type TestInfo} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {openFontManager} from './font-management';
import {historyScript,historyProject,historyPng} from './history-inspector';

export async function fontRelinkWorkflow(page:Page,info:TestInfo,production=false){
  await page.goto('/');expect(await page.evaluate(()=>'luma'in window)).toBe(!production);
  await historyScript(page,"document.resize(300,120);document.layers.add(new TextLayer({name:'Relink target',text:'AAAA',fontFamily:'serif',fontSize:40,x:20,y:20}));",'Relink target ready');
  let dialog=await openFontManager(page);await dialog.locator('summary').filter({hasText:'Inspect font files'}).click();await dialog.getByTestId('font-source-input').setInputFiles('tests/fixtures/fonts/Regular.ttf');
  await dialog.getByRole('button',{name:'Embed selected face',exact:true}).click();await expect(dialog.getByRole('region',{name:'Embedded font files',exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'serif',exact:true}).click();await dialog.getByLabel('Replacement font preset',{exact:true}).selectOption({label:'Canoli Source Regular (embedded)'});await expect(dialog.getByRole('button',{name:'Replace font',exact:true})).toBeEnabled();await dialog.getByRole('button',{name:'Replace font',exact:true}).click();await dialog.getByRole('button',{name:'Done',exact:true}).click();
  const before=await historyPng(page,info,'relink-before.png'),original=await historyProject(page,info,'relink-before.luma');
  dialog=await openFontManager(page);await dialog.getByRole('button',{name:'Choose replacement for Canoli Source Regular',exact:true}).click();await dialog.getByTestId('font-source-input').setInputFiles('tests/fixtures/fonts/Bold.ttf');await dialog.getByRole('button',{name:'Relink selected face',exact:true}).click();await expect(dialog.getByText('Font relinked. Close this dialog to use Undo.',{exact:true})).toBeVisible();await page.screenshot({path:info.outputPath('font-relinked.png')});await dialog.getByRole('button',{name:'Done',exact:true}).click();
  const after=await historyPng(page,info,'relink-after.png');expect(after.bytes.equals(before.bytes)).toBe(false);
  const changed=await historyProject(page,info,'relink-after.luma');expect(changed.value.document.fontFiles).toHaveLength(1);expect(changed.value.document.fontFiles![0].id).not.toBe(original.value.document.fontFiles![0].id);expect(changed.value.document.fontFiles![0].name).toBe('Canoli Source Regular');expect(changed.value.document.fontFiles![0].resource.report.faces[0].fullName).toBe('Canoli Source Bold');expect(Buffer.from(await changed.value.fonts[0].original.arrayBuffer())).toEqual(await readFile('tests/fixtures/fonts/Bold.ttf'));
  await page.getByRole('button',{name:'Undo (Mod+Z)',exact:true}).click();expect((await historyPng(page,info,'relink-undo.png')).bytes).toEqual(before.bytes);await page.getByRole('button',{name:'Redo (Mod+Shift+Z)',exact:true}).click();expect((await historyPng(page,info,'relink-redo.png')).bytes).toEqual(after.bytes);
  await page.reload();await page.getByTestId('project-input').setInputFiles(changed.path);await expect(page.getByRole('button',{name:'Select Relink target',exact:true})).toBeVisible();expect((await historyPng(page,info,'relink-reopened.png')).bytes).toEqual(after.bytes);
}
