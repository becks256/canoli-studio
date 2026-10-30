import {expect, type Page, type TestInfo} from '@playwright/test';
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {historyProject, historyScript} from './history-inspector';

/** Keyboard selection can change while a pointer remains captured on a handle. */
export async function gestureSelectionWorkflow(page: Page, info: TestInfo, production = false) {
  await page.goto('/');
  expect(await page.evaluate(() => 'luma' in window)).toBe(!production);
  const original = await readFile('tests/fixtures/psd/native-50mp.png');
  await page.getByTestId('import-input').setInputFiles({name: 'Selection original.png', mimeType: 'image/png', buffer: original});
  await expect(page.getByRole('button', {name: 'Select Selection original.png', exact: true})).toBeVisible({timeout: 120000});
  await historyScript(page, "const first=document.layers.at(0);document.resize(600,450);first.update({x:80,y:100,width:160,height:80});document.layers.add(new RasterLayer({name:'Other selection',assetId:first.assetId,x:360,y:260,width:40,height:40}));document.selectedLayer=first", 'Selection scene ready');
  const initial = await historyProject(page, info, 'selection-initial.luma');
  await historyScript(page, 'document.selectedLayer.x=81', 'Selection edit ready');
  const before = await historyProject(page, info, 'selection-before.luma');
  await page.getByRole('button', {name: 'Move tool (V)', exact: true}).click();
  await page.keyboard.press('Control+1');
  await page.getByLabel('Snap to canvas and guides', {exact: true}).uncheck();
  const handle = (await page.locator('.selection-outline [data-handle="se"]').boundingBox())!;
  const start = {x: handle.x + handle.width / 2, y: handle.y + handle.height / 2};
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(start.x + 20, start.y + 12);
  const other = page.getByRole('button', {name: 'Select Other selection', exact: true});
  await other.focus(); await page.keyboard.press('Enter');
  await expect(other).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.move(start.x + 36, start.y + 24); await page.mouse.up();
  const after = await historyProject(page, info, 'selection-after.luma');
  expect(after.value.document).toEqual(before.value.document);
  expect(after.value.entries).toHaveLength(1);
  expect([after.value.entries[0].width, after.value.entries[0].height]).toEqual([10000, 5000]);
  expect(Buffer.from(await after.value.entries[0].blob.arrayBuffer())).toEqual(original);
  await page.getByRole('button', {name: 'Undo (Mod+Z)', exact: true}).click();
  expect((await historyProject(page, info, 'selection-undone.luma')).value.document).toEqual(initial.value.document);
  await page.getByRole('button', {name: 'Redo (Mod+Shift+Z)', exact: true}).click();
  expect((await historyProject(page, info, 'selection-redone.luma')).value.document).toEqual(before.value.document);
  expect(await page.evaluate(() => 'luma' in window)).toBe(!production);
  await writeFile(info.outputPath('selection-original.json'), JSON.stringify({sourceSize: [10000, 5000], sourceBytes: original.length, sourceSha256: createHash('sha256').update(original).digest('hex'), unchanged: true, undoRedo: true, production}, null, 2));
}
