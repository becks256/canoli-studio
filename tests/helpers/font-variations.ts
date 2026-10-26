import {expect,type Page,type TestInfo} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {openFontManager} from './font-management';
import {historyScript,historyPng,historyProject} from './history-inspector';

export async function fontVariationsWorkflow(page:Page,info:TestInfo,production=false){
 await page.setViewportSize({width:1280,height:720});await page.goto('/');expect(await page.evaluate(()=>'luma'in window)).toBe(!production);
 await historyScript(page,"document.resize(320,160);for(const [name,y]of [['Default axes',12],['Variable axes',72]])document.layers.add(new TextLayer({name,text:'AAAA',fontSize:40,fontFamily:'serif',color:'#2468ac',x:12,y}));document.selectedLayer=document.layers.at(1);",'Axis targets ready');
 const manager=await openFontManager(page);await manager.locator('summary').filter({hasText:'Inspect font files'}).click();await manager.getByTestId('font-source-input').setInputFiles('tests/fixtures/font-variations/Axes.ttf');await manager.getByRole('button',{name:'Embed selected face',exact:true}).click();await expect(manager.getByRole('region',{name:'Embedded font files',exact:true})).toBeVisible();await manager.getByRole('button',{name:'Done',exact:true}).click();
 await historyScript(page,"const font=document.fonts.files.items[0];for(const layer of document.layers)if(layer instanceof TextLayer)layer.fontFamily=font.family;document.selectedLayer.fontVariationSettings='\"TEST\" 50, \"wght\" 600';",'Native axes ready');
 const font=await readFile('tests/fixtures/font-variations/Axes.ttf'),staticFont=await readFile('tests/fixtures/font-variations/Axes-mid.ttf');
 const reference=await page.evaluate(async({font,staticFont})=>{
  for(const[family,bytes]of [['IndependentDefaultAxes',font],['IndependentStaticAxes',staticFont]]as const){const face=new FontFace(family,new Uint8Array(bytes).buffer);await face.load();document.fonts.add(face);}
  const canvas=document.createElement('canvas');canvas.width=320;canvas.height=160;const context=canvas.getContext('2d')!;context.textBaseline='top';context.fillStyle='#2468ac';context.font='normal 40px IndependentDefaultAxes';context.fillText('AAAA',12,12);context.font='normal 40px IndependentStaticAxes';context.fillText('AAAA',12,72);return canvas.toDataURL();
 },{font:[...font],staticFont:[...staticFont]});
 await writeFile(info.outputPath('axes-reference.png'),Buffer.from(reference.split(',')[1],'base64'));
 const before=await historyPng(page,info,'axes-before.png'),projectBefore=await historyProject(page,info,'axes-before.luma');
 await page.getByRole('button',{name:'Select Variable axes',exact:true}).click();await page.locator('.variable-font-axes summary').click();const field=page.getByRole('spinbutton',{name:/^Axis TEST/});await expect(field).toHaveValue('50');
 await field.fill('20.5');await field.press('Escape');await expect(field).toHaveValue('50');expect((await historyProject(page,info,'axes-cancelled.luma')).value.document).toEqual(projectBefore.value.document);
 await field.fill('20.5');await field.press('Enter');const edited=await historyPng(page,info,'axes-edited.png');expect(edited.bytes).not.toEqual(before.bytes);
 await page.getByRole('button',{name:'Undo (Mod+Z)',exact:true}).click();expect((await historyPng(page,info,'axes-undo.png')).bytes).toEqual(before.bytes);await page.getByRole('button',{name:'Redo (Mod+Shift+Z)',exact:true}).click();expect((await historyPng(page,info,'axes-redo.png')).bytes).toEqual(edited.bytes);
 const saved=await historyProject(page,info,'axes-saved.luma');expect(saved.value.document.children[1]).toMatchObject({fontVariationSettings:'"TEST" 20.5, "wght" 600'});expect(Buffer.from(await saved.value.fonts[0].original.arrayBuffer())).toEqual(font);
 await page.getByRole('button',{name:'Use matching default for TEST',exact:true}).click();expect((await historyProject(page,info,'axes-one-reset.luma')).value.document.children[1]).toMatchObject({fontVariationSettings:'"wght" 600'});await page.getByRole('button',{name:'Undo (Mod+Z)',exact:true}).click();
 await page.getByRole('button',{name:'Reset variable axes',exact:true}).click();expect((await historyProject(page,info,'axes-reset.luma')).value.document.children[1]).toMatchObject({fontVariationSettings:'normal'});await page.getByRole('button',{name:'Undo (Mod+Z)',exact:true}).click();
 await page.reload();await page.getByTestId('project-input').setInputFiles(saved.path);await expect(page.getByRole('button',{name:'Select Variable axes',exact:true})).toBeVisible();expect((await historyPng(page,info,'axes-reopened.png')).bytes).toEqual(edited.bytes);
 await page.getByRole('button',{name:'Select Variable axes',exact:true}).click();await page.locator('.variable-font-axes summary').click();await expect(page.getByRole('spinbutton',{name:/^Axis TEST/})).toHaveValue('20.5');await page.screenshot({path:info.outputPath('axes-controls.png')});
}
