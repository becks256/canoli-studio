import {expect, type Page, type TestInfo} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {readProject} from '../../src/core/project';

export async function historyScript(page: Page, code: string, marker: string) {
  await page.getByRole('button', {name: 'Scripts (Mod+Shift+K)', exact: true}).click();
  await page.getByLabel('Script code', {exact: true}).fill(code + `;print(${JSON.stringify(marker)});`);
  await page.getByRole('button', {name: 'Run script', exact: true}).click();
  await expect(page.getByLabel('Script output')).toContainText(marker);
  await page.getByRole('button', {name: 'Close scripts', exact: true}).click();
}
export async function openHistoryInspector(page: Page) {
  await page.getByRole('button', {name: 'History', exact: true}).click();
  await page.getByRole('button', {name: 'Inspect retained history', exact: true}).click();
  return page.getByRole('dialog', {name: 'Inspect history', exact: true});
}
export async function historyProject(page: Page, info: TestInfo, name: string) {
  const pending = page.waitForEvent('download'); await page.getByRole('button', {name: 'Save project', exact: true}).click();
  const path = info.outputPath(name); await (await pending).saveAs(path);
  return {path, value: await readProject(new Blob([new Uint8Array(await readFile(path))]))};
}
export async function historyPng(page: Page, info: TestInfo, name: string) {
  const pending = page.waitForEvent('download', {timeout: 180000}); await page.getByRole('button', {name: 'Export PNG', exact: true}).click();
  const path = info.outputPath(name); await (await pending).saveAs(path); return {path, bytes: await readFile(path)};
}
export async function historyInspectorProductionWorkflow(page: Page, info: TestInfo, production = false) {
  await page.goto('/'); expect(await page.evaluate(() => 'luma' in window)).toBe(!production);
  await historyScript(page, "document.resize(400,300);const layer=document.layers.add(new PaintLayer({name:'History target',x:30,y:20}));layer.strokes.add(new PaintFill({bounds:{x:0,y:0,width:120,height:90},color:'#ff0000'}));document.selectedLayer=layer", 'History red ready');
  const red = await historyPng(page, info, 'history-red.png');
  await historyScript(page, "document.selectedLayer.strokes.add(new PaintFill({bounds:{x:0,y:0,width:120,height:90},color:'#0000ff'}))", 'History blue ready');
  const blue = await historyProject(page, info, 'history-blue.luma'), bluePng = await historyPng(page, info, 'history-blue.png');
  await historyScript(page, "document.resize(800,600);document.name='History resized'", 'History resized ready');
  const resized = await historyProject(page, info, 'history-resized.luma');
  let dialog = await openHistoryInspector(page);
  await dialog.getByRole('button', {name: /^Inspect history state 2:/}).click();
  await expect(dialog.getByRole('region', {name: 'Selected history changes', exact: true})).toContainText(/strokes/i);
  await dialog.getByRole('button', {name: 'Preview before and after', exact: true}).click();
  await expect(dialog.getByRole('img', {name: 'History before operation', exact: true})).toBeVisible();
  await expect(dialog.getByRole('img', {name: 'History after operation', exact: true})).toBeVisible();
  const sample = async (name: string) => dialog.getByRole('img', {name, exact: true}).evaluate(async element => {
    const image = element as HTMLImageElement; await image.decode(); const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0); return {size: [canvas.width, canvas.height], pixel: Array.from(context.getImageData(80, 60, 1, 1).data)};
  });
  expect(await sample('History before operation')).toEqual({size: [400, 300], pixel: [255, 0, 0, 255]});
  expect(await sample('History after operation')).toEqual({size: [400, 300], pixel: [0, 0, 255, 255]});
  await info.attach('history-inspector.png', {body: await dialog.screenshot(), contentType: 'image/png'});
  await dialog.getByRole('button', {name: 'Done', exact: true}).click();
  expect((await historyProject(page, info, 'history-after-inspection.luma')).value.document).toEqual(resized.value.document);
  dialog = await openHistoryInspector(page); await dialog.getByRole('button', {name: /^Inspect history state 2:/}).click();
  await dialog.getByRole('button', {name: 'Move to selected history state', exact: true}).click(); await expect(dialog).toHaveCount(0);
  expect((await historyProject(page, info, 'history-jumped.luma')).value.document).toEqual(blue.value.document);
  expect((await historyPng(page, info, 'history-jumped.png')).bytes).toEqual(bluePng.bytes);
  await page.getByRole('button', {name: 'Redo (Mod+Shift+Z)', exact: true}).click();
  expect((await historyProject(page, info, 'history-redone.luma')).value.document).toEqual(resized.value.document);
  await page.getByRole('button', {name: 'Undo (Mod+Z)', exact: true}).click();
  await page.getByRole('button', {name: 'Undo (Mod+Z)', exact: true}).click();
  expect((await historyPng(page, info, 'history-back-to-red.png')).bytes).toEqual(red.bytes);
}
