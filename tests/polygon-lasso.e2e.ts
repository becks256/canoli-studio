import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function setup(page: Page) {
  await page.goto('/');
  await page.evaluate(() => window.luma.editor.newDocument({width:100,height:100}));
  await page.keyboard.press('Control+1');
  await page.keyboard.press('l');
  await page.getByRole('combobox',{name:'Lasso mode',exact:true}).selectOption('polygon');
  const box = (await page.locator('.canvas-wrap').boundingBox())!;
  return {
    click: async (x:number,y:number) => page.mouse.click(box.x+x,box.y+y),
    hover: async (x:number,y:number) => page.mouse.move(box.x+x,box.y+y),
    revision: () => page.evaluate(() => window.luma.editor.document.getSnapshot().revision),
    selection: () => page.evaluate(() => window.luma.editor.document.selection?.toJSON() ?? null),
    selected: (x:number,y:number) => page.evaluate(async ({x,y}) => {
      const {containsSelection} = await import(/* @vite-ignore */ String('/src/core/drawing.ts'));
      return containsSelection(window.luma.editor.document.selection!.toJSON(),x,y);
    }, {x,y}),
  };
}

test('polygon corners stay transient, support backspace, and commit once on Enter', async ({page}) => {
  const editor = await setup(page), before = await editor.revision();
  await editor.click(10,10);
  await editor.click(80,10);
  await editor.hover(80,80);
  await expect(page.getByTestId('lasso-preview')).toBeVisible();
  expect(await editor.selection()).toBeNull();
  expect(await editor.revision()).toBe(before);
  await expect(page.getByRole('button',{name:'Finish selection',exact:true})).toBeDisabled();
  await editor.click(80,80);
  await page.keyboard.press('Backspace');
  expect(await page.evaluate(() => window.luma.editor.tools.polygonLassoPointCount)).toBe(2);
  await editor.click(10,80);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('lasso-preview')).toHaveCount(0);
  expect(await editor.revision()).toBe(before+1);
  expect(await editor.selected(20,20)).toBe(true);
  expect(await editor.selected(70,70)).toBe(false);
  const selection = await editor.selection();
  await page.keyboard.press('Control+z');
  expect(await editor.selection()).toBeNull();
  await page.keyboard.press('Control+Shift+z');
  expect(await editor.selection()).toEqual(selection);
});

test('closing a polygon and the finish button preserve Boolean modes and locked layers', async ({page}) => {
  const editor = await setup(page);
  await page.evaluate(() => {
    const {editor,PaintLayer} = window.luma;
    editor.document.layers.add(new PaintLayer({locked:true,name:'Protected'}));
  });
  await editor.click(10,10); await editor.click(80,10); await editor.click(10,80); await editor.click(10,10);
  expect(await editor.selected(20,20)).toBe(true);
  const original = await editor.selection();
  await page.keyboard.down('Alt');
  await editor.click(15,15);
  await page.keyboard.up('Alt');
  await editor.click(30,15); await editor.click(30,30); await editor.click(15,30);
  await page.getByRole('button',{name:'Finish selection',exact:true}).click();
  expect(await editor.selected(20,20)).toBe(false);
  expect(await editor.selected(40,20)).toBe(true);
  await page.getByLabel('Editing canvas',{exact:true}).focus();
  await page.keyboard.press('Control+z');
  expect(await editor.selection()).toEqual(original);
  await page.getByRole('combobox',{name:'Selection operation',exact:true}).selectOption('add');
  await editor.click(60,60); await editor.click(80,60); await editor.click(80,80); await editor.click(60,80);
  await page.keyboard.press('Enter');
  expect(await editor.selected(70,70)).toBe(true);
  expect(await page.evaluate(() => window.luma.editor.document.layers.at(0)!.locked)).toBe(true);
});

test('escape, tool/mode changes, blur and document revisions discard draft polygons', async ({page}) => {
  const editor = await setup(page);
  for (const action of ['escape','mode','tool','blur','revision','pointercancel'] as const) {
    await page.keyboard.press('l');
    await page.getByRole('combobox',{name:'Lasso mode',exact:true}).selectOption('polygon');
    const selection = await editor.selection();
    await editor.click(10,10); await editor.click(80,10); await editor.click(10,80);
    const revision = await editor.revision();
    if (action === 'escape') await page.keyboard.press('Escape');
    if (action === 'mode') await page.getByRole('combobox',{name:'Lasso mode',exact:true}).selectOption('freeform');
    if (action === 'tool') await page.keyboard.press('v');
    if (action === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    if (action === 'revision') await page.evaluate(() => {window.luma.editor.document.name='Changed';});
    if (action === 'pointercancel') await page.getByLabel('Editing canvas',{exact:true}).dispatchEvent('pointercancel');
    await expect(page.getByTestId('lasso-preview')).toHaveCount(0);
    expect(await editor.selection()).toEqual(selection);
    expect(await editor.revision()).toBe(revision+(action==='revision'?1:0));
  }
});

test('scripted polygons render actual mask alpha, reopen and undo atomically', async ({page}) => {
  await setup(page);
  const guide = await readFile('docs/SCRIPTING_API.md','utf8');
  const example = guide.match(/```js\n\/\/ example: polygon-selection\n([\s\S]*?)```/)![1];
  await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();
  await page.getByLabel('Script code',{exact:true}).fill(`
    ${example}
    const layer=document.layers.add(new PaintLayer({name:'Polygon artwork'}));
    layer.strokes.add(new PaintFill({bounds:{x:0,y:0,width:100,height:100},color:'#ff0000'}));
    layer.maskFromSelection(document.selection);
    print('Polygon ready',document.selection.regions.length);
  `);
  await page.getByRole('button',{name:'Run script',exact:true}).click();
  await expect(page.getByLabel('Script output')).toContainText('Polygon ready 1');
  await page.getByRole('button',{name:'Close scripts',exact:true}).click();
  const result = await page.evaluate(async () => {
    const editor = window.luma.editor, document = editor.document;
    const snapshot = document.toJSON();
    const png = await editor.exportPng();
    const image = await createImageBitmap(png);
    const canvas = globalThis.document.createElement('canvas');canvas.width=canvas.height=100;
    const context=canvas.getContext('2d')!;context.drawImage(image,0,0);image.close();
    const rgba = context.getImageData(0,0,100,100).data;
    const alpha = (x:number,y:number) => rgba[(y*100+x)*4+3];
    const project=await editor.saveProject();
    document.undo();
    const undone={layers:document.layers.length,selection:document.selection};
    document.redo();
    await editor.openProject(new File([project],'polygon.luma'));
    return {alpha:[alpha(20,20),alpha(70,70),alpha(44,45)],undone,reopened:editor.document.toJSON(),snapshot};
  });
  expect(result.alpha[0]).toBe(255);
  expect(result.alpha[1]).toBe(0);
  expect(result.alpha[2]).toBeGreaterThan(0);
  expect(result.alpha[2]).toBeLessThan(255);
  expect(result.undone).toEqual({layers:0,selection:null});
  expect(result.reopened).toEqual(result.snapshot);
});

test('polygon selection plugins install inertly and require write permission at host commit', async ({page}) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    const editor = window.luma.editor, before = editor.document.toJSON();
    const plugin = {
      format:'luma-plugin' as const,apiVersion:1 as const,id:'test.polygon',name:'Polygon test',version:'1.0.0',
      permissions:['document:read'] as ('document:read'|'document:write')[],
      commands:[{id:'select',title:'Select polygon',source:'document.selectPolygon([{x:10,y:10},{x:80,y:10},{x:10,y:80}]);'}],
    };
    editor.plugins.install(plugin);
    const inert = JSON.stringify(editor.document.toJSON()) === JSON.stringify(before);
    let error='';
    try {await editor.runPlugin(plugin.id,'select');} catch (value) {error=String(value);}
    const unchanged = JSON.stringify(editor.document.toJSON()) === JSON.stringify(before);
    editor.plugins.install({...plugin,permissions:['document:read','document:write']});
    editor.plugins.grantPermission(plugin.id,'document:write');
    await editor.runPlugin(plugin.id,'select');
    const selected = editor.document.selection?.toJSON();
    editor.document.undo();
    return {inert,error,unchanged,selected,restored:editor.document.toJSON(),before};
  });
  expect(result.inert).toBe(true);
  expect(result.error).toMatch(/read.only|permission/i);
  expect(result.unchanged).toBe(true);
  expect(result.selected!.regions[0].shape).toBe('pixels');
  expect(result.restored).toEqual(result.before);
});

test('typing shortcuts and temporary panning preserve the polygon draft', async ({page}) => {
  const editor=await setup(page);
  await editor.click(10,10);await editor.click(80,10);
  const name=page.getByRole('textbox',{name:'Document name',exact:true});
  const original=await name.inputValue();
  await name.fill(original+'x');
  await name.press('Backspace');
  expect(await name.inputValue()).toBe(original);
  expect(await page.evaluate(() => window.luma.editor.tools.polygonLassoPointCount)).toBe(2);
  await page.getByLabel('Editing canvas',{exact:true}).focus();
  const box=(await page.locator('.canvas-wrap').boundingBox())!;
  await page.keyboard.down('Space');
  await page.mouse.move(box.x+50,box.y+50);await page.mouse.down();
  await page.mouse.move(box.x+75,box.y+65);await page.mouse.up();
  await page.keyboard.up('Space');
  expect(await page.evaluate(() => window.luma.editor.tools.polygonLassoPointCount)).toBe(2);
  const moved=(await page.locator('.canvas-wrap').boundingBox())!;
  expect(moved.x).toBeCloseTo(box.x+25);
  expect(moved.y).toBeCloseTo(box.y+15);
  await page.mouse.click(moved.x+10,moved.y+80);
  await page.keyboard.press('Enter');
  expect(await editor.selected(20,20)).toBe(true);
  expect(await editor.selected(70,70)).toBe(false);
});
