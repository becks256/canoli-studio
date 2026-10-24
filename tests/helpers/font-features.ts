import {expect,type Page,type TestInfo}from'@playwright/test';
import {readFile}from'node:fs/promises';
import {historyScript,historyProject,historyPng}from'./history-inspector';

export async function fontFeaturesWorkflow(page:Page,info:TestInfo,production=false){
 const guide=await readFile('docs/FONT_FEATURES.md','utf8'),source=guide.match(/<!-- example: native-font-features -->\s*```js\n([\s\S]*?)\n```/)![1];
 await page.goto('/');expect(await page.evaluate(()=>'luma'in window)).toBe(!production);
 await historyScript(page,'document.resize(640,240);\n'+source,'Native font study ready');await page.getByRole('button',{name:'Select Native font study',exact:true}).click();
 const capitals=page.getByLabel('Capitals',{exact:true}),stretch=page.getByLabel('Font stretch',{exact:true}),weight=page.getByRole('spinbutton',{name:'Weight value',exact:true});
 await expect(capitals).toHaveValue('small-caps');await expect(stretch).toHaveValue('semi-condensed');await expect(weight).toHaveValue('553.25');
 const first=await historyProject(page,info,'font-features-before.luma'),firstPng=await historyPng(page,info,'font-features-before.png');
 await page.keyboard.press('Control+z');await expect(page.locator('.layer-row')).toHaveCount(0);await page.keyboard.press('Control+Shift+z');await page.getByRole('button',{name:'Select Native font study',exact:true}).click();await expect(capitals).toHaveValue('small-caps');
 await capitals.selectOption('all-small-caps');await stretch.selectOption('expanded');
 const beforeWeight=await historyProject(page,info,'font-features-before-weight.luma');await weight.fill('612.5');await weight.press('Escape');await expect(weight).toHaveValue('553.25');
 expect((await historyProject(page,info,'font-features-weight-cancelled.luma')).value.document).toEqual(beforeWeight.value.document);
 await weight.fill('612.5');await weight.press('Enter');await expect(weight).toHaveValue('612.5');
 const saved=await historyProject(page,info,'font-features-edited.luma'),png=await historyPng(page,info,'font-features-edited.png'),text=saved.value.document.children[0];
 expect(text.kind).toBe('text');if(text.kind!=='text')throw new Error('Expected text');
 expect(text).toMatchObject({fontVariantCaps:'all-small-caps',fontStretch:'expanded',fontWeight:'612.5',text:'Canoli Studio — original ß é'});expect(saved.value.document.schemaVersion).toBe(43);expect(text.paragraphStyle!.overrides).toEqual({fontVariantCaps:'all-small-caps',fontStretch:'expanded',fontWeight:'612.5'});expect(png.bytes).not.toEqual(firstPng.bytes);
 await page.getByRole('button',{name:'Reset font features',exact:true}).click();await expect(capitals).toHaveValue('normal');await expect(stretch).toHaveValue('normal');await expect(weight).toHaveValue('612.5');await page.keyboard.press('Control+z');await expect(capitals).toHaveValue('all-small-caps');await expect(stretch).toHaveValue('expanded');
 expect((await historyProject(page,info,'font-features-reset-undone.luma')).value.document).toEqual(saved.value.document);
 await page.getByRole('button',{name:'Export…',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Export Document',exact:true});await dialog.getByLabel('Format',{exact:true}).selectOption('svg');
 await expect(dialog).toContainText('Capital variants and font stretch request font features');
 const pending=page.waitForEvent('download'),svgPath=info.outputPath('font-features.svg');await dialog.getByRole('button',{name:'Export .svg',exact:true}).click();await(await pending).saveAs(svgPath);
 const xml=await readFile(svgPath,'utf8');expect(xml).toContain('font-variant-caps:all-small-caps;font-stretch:expanded');expect(xml).toContain('font-weight="612.5"');expect(xml).toContain('<text ');
 await page.getByTestId('import-input').setInputFiles(saved.path);await page.getByRole('button',{name:'Select Native font study',exact:true}).click();await expect(capitals).toHaveValue('all-small-caps');await expect(stretch).toHaveValue('expanded');await expect(weight).toHaveValue('612.5');
 expect((await historyProject(page,info,'font-features-reopened.luma')).value.document).toEqual(saved.value.document);expect((await historyPng(page,info,'font-features-reopened.png')).bytes).toEqual(png.bytes);
 const content=page.getByRole('textbox',{name:'Text content',exact:true});await content.focus();await content.press('Control+a');expect(await content.evaluate(element=>{const input=element as HTMLTextAreaElement;return{start:input.selectionStart,end:input.selectionEnd,length:input.value.length};})).toEqual({start:0,end:text.text.length,length:text.text.length});await content.press('ArrowRight');
 expect(first.value.document.children[0].kind).toBe('text');return{source,svgPath,projectPath:saved.path};
}
