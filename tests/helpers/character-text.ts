import {expect,type Page,type TestInfo} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {historyScript,historyPng,historyProject} from './history-inspector';

export async function characterTextWorkflow(page:Page,info:TestInfo,production=false){
 await page.setViewportSize({width:1280,height:720});await page.goto('/');expect(await page.evaluate(()=>'luma'in window)).toBe(!production);
 const guide=await readFile('docs/SCRIPTING_API.md','utf8'),code=guide.match(/<!-- example: character-ranges -->\s*```js\n([\s\S]*?)\n```/)?.[1];if(!code)throw new Error('Missing character-range example.');
 await historyScript(page,'document.resize(400,240);\n'+code,'Character example complete');await page.getByRole('button',{name:'Select Character study',exact:true}).click();
 const first=await historyProject(page,info,'characters-before.luma'),firstPng=await historyPng(page,info,'characters-before.png');expect(first.value.document.children[0]).toMatchObject({text:'Canoli Design',characterRanges:[{start:0,end:6,format:{fontSize:48,color:'#a43e29'}}]});
 const content=page.getByRole('textbox',{name:'Text content',exact:true});await page.locator('.character-formatting-panel summary').click();await content.focus();await content.press('Home');await content.press('Shift+ArrowRight');
 const size=page.getByRole('spinbutton',{name:'Selected font size',exact:true});await expect(size).toBeEnabled();await size.fill('60');await size.press('Escape');await expect(size).toHaveValue('48');await size.fill('60');await size.press('Enter');await expect(size).toHaveValue('60');
 const saved=await historyProject(page,info,'characters-edited.luma'),png=await historyPng(page,info,'characters-edited.png');expect(saved.value.document.children[0]).toMatchObject({characterRanges:[{start:0,end:1,format:{fontSize:60,color:'#a43e29'}},{start:1,end:6,format:{fontSize:48,color:'#a43e29'}}]});expect(png.bytes).not.toEqual(firstPng.bytes);
 await page.getByRole('button',{name:'Undo (Mod+Z)',exact:true}).click();expect((await historyProject(page,info,'characters-undone.luma')).value.document).toEqual(first.value.document);await page.getByRole('button',{name:'Redo (Mod+Shift+Z)',exact:true}).click();expect((await historyPng(page,info,'characters-redone.png')).bytes).toEqual(png.bytes);
 await page.reload();await page.getByTestId('project-input').setInputFiles(saved.path);await expect(page.getByRole('button',{name:'Select Character study',exact:true})).toBeVisible();expect((await historyProject(page,info,'characters-reopened.luma')).value.document).toEqual(saved.value.document);expect((await historyPng(page,info,'characters-reopened.png')).bytes).toEqual(png.bytes);await page.getByRole('button',{name:'Select Character study',exact:true}).click();await page.locator('.character-formatting-panel summary').click();await page.screenshot({path:info.outputPath('character-formatting.png')});
}
