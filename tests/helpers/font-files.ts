import {expect,type Page,type TestInfo} from '@playwright/test';
import {historyScript,historyProject,historyPng} from './history-inspector';
import {openFontManager} from './font-management';
import {readFile} from 'node:fs/promises';

export async function fontFilesWorkflow(page:Page,info:TestInfo,production=false){
  await page.goto('/');expect(await page.evaluate(()=>'luma'in window)).toBe(!production);
  await historyScript(page,"document.resize(300,120);document.layers.add(new TextLayer({name:'Embedded font target',text:'AAAA',fontFamily:'serif',fontSize:40,x:20,y:20}));",'Font target ready');
  const before=await historyPng(page,info,'font-file-before.png');
  const dialog=await openFontManager(page);await dialog.locator('summary').filter({hasText:'Inspect font files'}).click();
  await dialog.getByTestId('font-source-input').setInputFiles('tests/fixtures/fonts/Collection.ttc');
  await expect(dialog.getByLabel('Font file face',{exact:true})).toBeVisible();
  await expect(dialog.getByRole('button',{name:'Embed selected face',exact:true})).toHaveCount(0);
  await dialog.getByLabel('Font file face',{exact:true}).selectOption('1');
  await dialog.getByRole('button',{name:'Embed selected face',exact:true}).click();
  await expect(dialog.getByRole('region',{name:'Embedded font files',exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'serif',exact:true}).click();
  await dialog.getByLabel('Replacement font preset',{exact:true}).selectOption({label:'Canoli Source Bold (embedded)'});
  await expect(dialog.getByRole('button',{name:'Replace font',exact:true})).toBeEnabled();await dialog.getByRole('button',{name:'Replace font',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Canoli Source Bold',exact:true})).toBeVisible();await page.screenshot({path:info.outputPath('font-files-embedded.png')});
  await dialog.getByLabel('Search document fonts',{exact:true}).fill('Source Bold');await expect(dialog.getByRole('button',{name:'Canoli Source Bold',exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Done',exact:true}).click();
  const after=await historyPng(page,info,'font-file-after.png');expect(after.bytes.equals(before.bytes)).toBe(false);
  await page.getByRole('button',{name:'Undo (Mod+Z)',exact:true}).click();expect((await historyPng(page,info,'font-file-undo.png')).bytes).toEqual(before.bytes);
  await page.getByRole('button',{name:'Redo (Mod+Shift+Z)',exact:true}).click();expect((await historyPng(page,info,'font-file-redo.png')).bytes).toEqual(after.bytes);
  const project=await historyProject(page,info,'font-file.luma'),font=project.value.document.fontFiles![0];
  expect(project.value.fonts).toHaveLength(1);expect(font.resource.report.faces[0].index).toBe(1);expect(project.value.document.children[0]).toMatchObject({fontFamily:font.resource.report.faces[0].cssFamily});
  expect(Buffer.from(await project.value.fonts[0].original.arrayBuffer())).toEqual(await readFile('tests/fixtures/fonts/Collection.ttc'));
  // Script constructors must shape against the same native face before emitting
  // commands, rather than replacing the font only after fallback measurement.
  const guide=await readFile('docs/SCRIPTING_API.md','utf8'),example=guide.match(/<!-- example: embedded-font-script -->\s*```js\n([\s\S]*?)\n```/)?.[1];
  expect(example).toBeTruthy();await historyScript(page,example!,'Embedded metrics ready');
  const measured=await historyProject(page,info,'font-file-script.luma'),copy=measured.value.document.children[1],original=project.value.document.children[0];
  if(copy.kind!=='text'||original.kind!=='text')throw new Error('Expected native text layers.');expect(copy.width).toBeCloseTo(original.width,3);
  await page.reload();await page.getByTestId('project-input').setInputFiles(project.path);await expect(page.getByRole('button',{name:'Select Embedded font target',exact:true})).toBeVisible();
  const reopened=await historyPng(page,info,'font-file-reopened.png');expect(reopened.bytes).toEqual(after.bytes);
}
