import {expect, type Page, type TestInfo} from '@playwright/test';
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {historyPng, historyProject, historyScript} from './history-inspector';

export async function layerKeyboardWorkflow(page: Page, info: TestInfo, production = false) {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); expect(await page.evaluate(() => 'luma' in window)).toBe(!production);
  const original = await readFile('tests/fixtures/psd/native-50mp.png');
  await page.getByTestId('import-input').setInputFiles({name: 'Keyboard original.png', mimeType: 'image/png', buffer: original});
  await expect(page.getByRole('button', {name: 'Select Keyboard original.png', exact: true})).toBeVisible({timeout: 120000});
  await historyScript(page, "const source=document.layers.at(0);document.resize(400,300);source.update({name:'Source',x:20,y:40,width:80,height:40});const group=document.layers.add(new LayerGroup({name:'Collection'}));group.layers.add(new RasterLayer({name:'Amber',assetId:source.assetId,x:130,y:80,width:40,height:20}));group.layers.add(new RasterLayer({name:'Blue',assetId:source.assetId,x:230,y:130,width:40,height:20}));document.selectedLayer=source", 'Keyboard scene ready');
  const row = (name: string) => page.getByRole('treeitem', {name, exact: true});
  const before = await historyProject(page, info, 'keyboard-before.luma'), png = await historyPng(page, info, 'keyboard-before.png');
  const sourceExact = async (value: typeof before.value) => {
    expect(value.entries).toHaveLength(1); expect([value.entries[0].width, value.entries[0].height]).toEqual([10000, 5000]);
    expect(Buffer.from(await value.entries[0].blob.arrayBuffer())).toEqual(original);
  };
  await sourceExact(before.value);
  await row('Source').focus(); await page.keyboard.press('Home'); await expect(row('Collection')).toBeFocused();
  await page.keyboard.press('ArrowRight'); await expect(row('Blue')).toBeFocused(); await page.keyboard.press('Enter');
  await expect(row('Blue')).toHaveAttribute('aria-selected', 'true'); await expect(row('Source')).toHaveAttribute('aria-selected', 'false');
  await page.keyboard.press('Shift+End');
  for (const name of ['Blue', 'Amber', 'Source']) await expect(row(name)).toHaveAttribute('aria-selected', 'true');
  await expect(row('Collection')).toHaveAttribute('aria-selected', 'false'); await page.keyboard.press('Control+a');
  for (const name of ['Collection', 'Blue', 'Amber', 'Source']) await expect(row(name)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.type('am'); await expect(row('Amber')).toBeFocused();
  const after = await historyProject(page, info, 'keyboard-after-navigation.luma');
  expect(after.value.document).toEqual(before.value.document); await sourceExact(after.value);
  expect((await historyPng(page, info, 'keyboard-after-navigation.png')).bytes).toEqual(png.bytes);
  await row('Source').focus(); await page.keyboard.press('Enter'); await page.keyboard.press('Tab');
  await expect(page.getByRole('button', {name: 'Lock Source', exact: true})).toBeFocused(); await page.keyboard.press('Tab');
  await expect(page.getByRole('button', {name: 'Hide Source', exact: true})).toBeFocused();
  await page.keyboard.down('Space'); await expect(page.locator('.viewport')).not.toHaveClass(/\bhand\b/); await page.keyboard.up('Space');
  await expect(page.getByRole('button', {name: 'Show Source', exact: true})).toBeFocused();
  const hidden = await historyProject(page, info, 'keyboard-hidden.luma');
  expect(hidden.value.document.children[0].visible).toBe(false); await sourceExact(hidden.value);
  expect((await historyPng(page, info, 'keyboard-hidden.png')).bytes).not.toEqual(png.bytes);
  await page.keyboard.press('Control+z');
  expect((await historyProject(page, info, 'keyboard-undone.luma')).value.document).toEqual(before.value.document);
  expect((await historyPng(page, info, 'keyboard-undone.png')).bytes).toEqual(png.bytes);
  // A distinct visible marker proves that opening the saved file actually replaced the document.
  await historyScript(page, "document.layers.add(new LayerGroup({name:'Replacement marker'}))", 'Replacement marker ready');
  await expect(page.getByRole('treeitem')).toHaveCount(5); await page.getByTestId('project-input').setInputFiles(before.path);
  await expect(page.getByRole('treeitem')).toHaveCount(4); await expect(row('Replacement marker')).toHaveCount(0);
  const reopened = await historyProject(page, info, 'keyboard-reopened.luma');
  expect(reopened.value.document).toEqual(before.value.document); await sourceExact(reopened.value);
  expect((await historyPng(page, info, 'keyboard-reopened.png')).bytes).toEqual(png.bytes);
  expect(await page.evaluate(() => 'luma' in window)).toBe(!production); expect(errors).toEqual([]);
  await writeFile(info.outputPath('keyboard-original.json'), JSON.stringify({production, originalSize: [10000, 5000], originalBytes: original.length,
    originalSha256: createHash('sha256').update(original).digest('hex'), navigationPreservedModelAndPng: true, oneUndo: true, reopened: true}, null, 2));
}
