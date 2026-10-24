import {expect,type Page,type TestInfo} from '@playwright/test';
import {historyScript,historyProject,historyPng} from './history-inspector';

export async function openFontManager(page:Page){
 await page.getByRole('button',{name:'Find a command (Mod+K)',exact:true}).click();
 await page.getByRole('combobox',{name:'Search commands',exact:true}).fill('Document fonts');await page.keyboard.press('Enter');
 return page.getByRole('dialog',{name:'Document fonts',exact:true});
}
const scene=(font:string)=>`document.resize(400,300);
 const body=document.paragraphStyles.add(new ParagraphStyle({name:'Body',format:{fontFamily:${JSON.stringify(font)},fontSize:22,color:'#315b2a'}}));
 const child=document.paragraphStyles.add(new ParagraphStyle({name:'Caption',basedOn:body,format:{letterSpacing:1}}));
 const text=document.layers.add(new TextLayer({name:'Inherited caption',text:'Canoli é العربية',x:20,y:25}));text.paragraphStyle=child;
 const second=document.layers.add(new TextLayer({name:'Explicit caption',text:'SWEET Studio',x:20,y:85}));second.paragraphStyle=child;second.fontFamily=${JSON.stringify(font)};
 const hidden=document.layers.add(new TextLayer({name:'Hidden text',text:'Hidden',visible:false,fontFamily:${JSON.stringify(font)}}));
 const master=new Document({width:190,height:70});const masterText=master.layers.add(new TextLayer({name:'Master text',text:'Embedded é',fontFamily:${JSON.stringify(font)},fontSize:18,color:'#315b2a',x:4,y:6}));
 const component=document.defineComponent(master,{name:'Caption master'});const instance=document.placeSmartObject(component);instance.x=180;instance.y=170;
 document.selectedLayer=text;`;

export async function fontManagementWorkflow(page:Page,info:TestInfo){
 await page.goto('/');await historyScript(page,scene('monospace'),'Direct font reference ready');
 const expected=await historyPng(page,info,'fonts-reference.png');
 await page.getByRole('button',{name:'New document tab',exact:true}).click();
 await historyScript(page,scene('serif'),'Original font scene ready');
 const before=await historyProject(page,info,'fonts-before.luma'),beforePng=await historyPng(page,info,'fonts-before.png');
 const dialog=await openFontManager(page);await dialog.getByRole('button',{name:'serif',exact:true}).click();
 await expect(dialog.getByText(/4 text layers, 2 paragraph styles, 1 explicit font override, 1 embedded document/)).toBeVisible();
 await dialog.getByLabel('Replacement font preset',{exact:true}).selectOption('monospace');await expect(dialog.getByRole('button',{name:'Replace font',exact:true})).toBeEnabled();await page.screenshot({path:info.outputPath('font-manager-desktop.png')});await dialog.getByRole('button',{name:'Replace font',exact:true}).click();
 await expect(dialog.getByRole('status').filter({hasText:'Font replaced.'})).toBeVisible();await dialog.getByRole('button',{name:'Done',exact:true}).click();
 const after=await historyProject(page,info,'fonts-after.luma');expect((await historyPng(page,info,'fonts-after.png')).bytes).toEqual(expected.bytes);
 expect(after.value.document.paragraphStyles!.find(style=>style.name==='Caption')!.basedOn!.overrides).toEqual({letterSpacing:1});
 const first=after.value.document.children.find(layer=>layer.name==='Inherited caption')!;expect(first).toMatchObject({kind:'text',fontFamily:'monospace',paragraphStyle:{overrides:{}}});
 await page.getByRole('button',{name:'Undo (Mod+Z)',exact:true}).click();expect((await historyProject(page,info,'fonts-undone.luma')).value.document).toEqual(before.value.document);expect((await historyPng(page,info,'fonts-undone.png')).bytes).toEqual(beforePng.bytes);
 await page.getByRole('button',{name:'Redo (Mod+Shift+Z)',exact:true}).click();
 await page.reload();await page.getByTestId('project-input').setInputFiles(after.path);await expect(page.getByRole('button',{name:'Select Inherited caption',exact:true})).toBeVisible();
 expect((await historyPng(page,info,'fonts-reopened.png')).bytes).toEqual(expected.bytes);
 await historyScript(page,`if(document.fonts.items.some(item=>item.family==='serif'))throw new Error('Font request was lost on reopen');document.fonts.replace('monospace','serif');`,'Isolated font replacement ready');
 expect((await historyPng(page,info,'fonts-scripted.png')).bytes).toEqual(beforePng.bytes);
}
