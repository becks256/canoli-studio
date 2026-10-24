import {expect, type Page, type TestInfo} from '@playwright/test';
import {historyPng, historyProject, historyScript} from './history-inspector';

/** Exercise the ordinary UI in development and in the release without globals. */
export async function layerControlsWorkflow(page:Page, info:TestInfo) {
  await page.goto('/');
  await historyScript(page, `
    document.resize(400,300);
    const group = new LayerGroup({name:'Icon group'});
    group.layers.add(new TextLayer({name:'Primary label',text:'Before',x:40,y:40}));
    group.layers.add(new TextLayer({name:'Secondary label',text:'Second',x:40,y:100}));
    document.layers.add(group);
  `, 'Layer controls ready');
  const select = (name:string) => page.getByRole('button', {name:`Select ${name}`,exact:true});
  const row = (name:string) => page.locator('.layer-row').filter({has:select(name)});
  const undo = page.getByRole('button', {name:'Undo (Mod+Z)',exact:true});
  await select('Primary label').click();
  const content = page.getByRole('textbox', {name:'Text content',exact:true});
  await content.fill('After typing');
  await expect(select('Primary label')).toHaveAttribute('aria-pressed','true');
  await expect(select('Primary label').locator('svg.lucide-type')).toHaveCount(1);
  const expectedProject = await historyProject(page,info,'layer-controls-edited.luma');
  const expectedPng = await historyPng(page,info,'layer-controls-edited.png');

  await page.getByRole('button',{name:'Hide Secondary label',exact:true}).click();
  await expect(page.getByRole('button',{name:'Show Secondary label',exact:true}).locator('svg.lucide-eye-off')).toHaveCount(1);
  await undo.click();
  await expect(page.getByRole('button',{name:'Hide Secondary label',exact:true}).locator('svg.lucide-eye')).toHaveCount(1);

  await row('Icon group').hover();
  await page.getByRole('button',{name:'Lock Icon group',exact:true}).click();
  await expect(page.getByRole('button',{name:'Unlock Icon group',exact:true}).locator('svg.lucide-lock-keyhole')).toHaveCount(1);
  await expect(content).toBeDisabled();
  await expect(page.getByRole('button',{name:'Hide Primary label',exact:true})).toBeDisabled();
  await expect(row('Primary label')).toHaveAttribute('draggable','false');
  await undo.click();
  await row('Icon group').hover();
  await expect(page.getByRole('button',{name:'Lock Icon group',exact:true}).locator('svg.lucide-unlock-keyhole')).toHaveCount(1);
  await expect(content).toBeEnabled();
  await expect(row('Primary label')).toHaveAttribute('draggable','true');

  const toggle = page.getByRole('button',{name:'Toggle Icon group',exact:true});
  await toggle.click();
  await expect(toggle.locator('svg.lucide-chevron-right')).toHaveCount(1);
  await expect(select('Primary label')).toHaveCount(0);
  await toggle.click();
  await expect(toggle.locator('svg.lucide-chevron-down')).toHaveCount(1);
  await select('Secondary label').click();
  await expect(select('Secondary label')).toHaveAttribute('aria-pressed','true');
  await expect(select('Primary label')).toHaveAttribute('aria-pressed','false');
  await expect(content).toHaveValue('Second');
  expect((await historyProject(page,info,'layer-controls-restored.luma')).value.document).toEqual(expectedProject.value.document);
  expect((await historyPng(page,info,'layer-controls-restored.png')).bytes).toEqual(expectedPng.bytes);
}
