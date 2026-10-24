import {expect,type Page,type TestInfo} from '@playwright/test';
import {historyScript,historyProject,historyPng} from './history-inspector';

export async function layerRowEventsWorkflow(page:Page,info:TestInfo){
  await page.goto('/');
  await historyScript(page,`document.resize(400,300);
    const paint=document.layers.add(new PaintLayer({name:'Alpha row',x:40,y:50}));
    paint.strokes.add(new PaintFill({bounds:{x:0,y:0,width:32,height:24},color:'#39745a'}));
    const text=document.layers.add(new TextLayer({name:'Editing row',text:'Original',x:100,y:100}));
    document.selectedLayer=text;`,'Row event artwork ready');
  await page.getByRole('button',{name:'Select Editing row',exact:true}).click();
  const before=await historyPng(page,info,'row-events-before.png');
  await page.getByRole('img',{name:'Alpha row thumbnail',exact:true}).click({modifiers:['Control']});
  await expect(page.getByTestId('pixel-selection-outline')).toBeVisible();
  await historyScript(page,`if(document.selectedLayer.name!=='Editing row')throw new Error('Thumbnail changed the active layer');`,'Thumbnail kept active layer');
  const content=page.getByRole('textbox',{name:'Text content',exact:true});
  await content.fill('Updated while selected');
  await page.getByRole('button',{name:'Hide Alpha row',exact:true}).locator('svg').click();
  await expect(page.getByRole('button',{name:'Show Alpha row',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Show Alpha row',exact:true}).locator('svg').click();
  const undo=page.getByRole('button',{name:'Undo (Mod+Z)',exact:true});
  await undo.click();await expect(page.getByRole('button',{name:'Show Alpha row',exact:true})).toBeVisible();
  await undo.click();await expect(page.getByRole('button',{name:'Hide Alpha row',exact:true})).toBeVisible();
  await undo.click();await expect(content).toHaveValue('Original');
  const saved=await historyProject(page,info,'row-events-restored.luma');
  expect(saved.value.document.selection).not.toBeNull();
  const node=saved.value.document.children.find(layer=>layer.name==='Editing row');expect(node).toMatchObject({kind:'text',text:'Original'});
  expect((await historyPng(page,info,'row-events-restored.png')).bytes).toEqual(before.bytes);
}
