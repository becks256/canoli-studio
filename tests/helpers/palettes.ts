import {expect, type Page, type TestInfo} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {readProject} from '../../src/core/project';
import {openPngRows} from '../../server/png-rows';
export const paletteFixture = {format: 'canoli-color-palettes', version: 1, palettes: [{
  name: 'Botanical', description: 'Reviewed print colors', tags: ['Print'],
  swatches: [{name: 'Leaf', color: '#315b2a'}, {name: 'Flower', color: '#a43e29'}],
}]};
export async function openPalettes(page: Page) {
  await page.getByRole('button', {name: 'Color palettes', exact: true}).click();
  return page.getByRole('dialog', {name: 'Color palettes', exact: true});
}
export async function installPalette(page: Page, value: unknown = paletteFixture) {
  const dialog = await openPalettes(page);
  await dialog.getByTestId('palette-pack-input').setInputFiles({name: 'colors.canolipal', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value))});
  await expect(dialog.getByRole('status')).toContainText('Imported');
  return dialog;
}
async function nativeProject(page: Page, info: TestInfo, name: string) {
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', {name: 'Save project', exact: true}).click();
  const path = info.outputPath(name); await (await downloading).saveAs(path);
  return readProject(new Blob([new Uint8Array(await readFile(path))]));
}
export async function paletteProductionWorkflow(page: Page, info: TestInfo, production = false) {
  await page.goto('/'); expect(await page.evaluate(() => 'luma' in window)).toBe(!production);
  await page.getByRole('button', {name: 'Scripts (Mod+Shift+K)', exact: true}).click();
  await page.getByLabel('Script code', {exact: true}).fill("const text=document.layers.add(new TextLayer({text:'Palette color test',color:'#112233'}));document.selectedLayer=text;print('Palette text ready');");
  await page.getByRole('button', {name: 'Run script', exact: true}).click();
  await expect(page.getByLabel('Script output')).toContainText('Palette text ready');
  await page.getByRole('button', {name: 'Close scripts', exact: true}).click();
  const before = await nativeProject(page, info, 'palette-before.luma');
  let dialog = await installPalette(page);
  await dialog.getByRole('button', {name: 'Open color palette Botanical', exact: true}).click();
  await dialog.getByLabel('Palette name', {exact: true}).fill('Approved botanical');
  await dialog.getByRole('button', {name: 'Move swatch 2 earlier', exact: true}).click();
  await dialog.getByRole('button', {name: 'Save color palette', exact: true}).click();
  await expect(dialog.getByRole('button', {name: 'Open color palette Approved botanical', exact: true})).toBeVisible();
  const downloading = page.waitForEvent('download'); await dialog.getByRole('button', {name: 'Export selected palette', exact: true}).click();
  const packPath = info.outputPath('approved.canolipal'); await (await downloading).saveAs(packPath);
  const pack = JSON.parse(await readFile(packPath, 'utf8'));
  expect(pack.palettes[0].swatches.map((swatch: {name: string}) => swatch.name)).toEqual(['Flower', 'Leaf']);
  expect(pack.palettes[0].name).toBe('Approved botanical'); expect(Object.keys(pack.palettes[0])).not.toContain('id');
  await dialog.getByRole('button', {name: 'Clear color palettes…', exact: true}).click();
  await dialog.getByRole('button', {name: 'Clear saved palettes', exact: true}).click();
  await dialog.getByTestId('palette-pack-input').setInputFiles(packPath);
  await expect(dialog.getByRole('button', {name: 'Open color palette Approved botanical', exact: true})).toBeVisible();
  await dialog.getByRole('button', {name: 'Done', exact: true}).click();
  expect((await nativeProject(page, info, 'palette-after-management.luma')).document).toEqual(before.document);
  const choose = page.getByRole('button', {name: 'Choose text color from palettes', exact: true});
  await choose.click(); dialog = page.getByRole('dialog', {name: 'Color palettes', exact: true});
  await dialog.getByRole('button', {name: 'Open color palette Approved botanical', exact: true}).click();
  await dialog.getByRole('button', {name: 'Use swatch Leaf #315b2a', exact: true}).click();
  await expect(dialog).toHaveCount(0); await expect(page.getByLabel('Text color', {exact: true})).toHaveValue('#315b2a');
  await page.getByRole('button', {name: 'Undo (Mod+Z)', exact: true}).click();
  await expect(page.getByLabel('Text color', {exact: true})).toHaveValue('#112233');
  await page.getByRole('button', {name: 'Redo (Mod+Shift+Z)', exact: true}).click();
  await expect(page.getByLabel('Text color', {exact: true})).toHaveValue('#315b2a');
  const pngDownload = page.waitForEvent('download'); await page.getByRole('button', {name: 'Export PNG', exact: true}).click();
  const pngPath = info.outputPath('palette-accepted.png'); await (await pngDownload).saveAs(pngPath);
  const decoded = openPngRows(await readFile(pngPath)); let opaqueMatches = 0, otherOpaque = 0;
  for await (const strip of decoded.strips) for (let offset = 0; offset < strip.pixels.length; offset += 4) {
    if (strip.pixels[offset + 3] !== 255) continue;
    if (strip.pixels[offset] === 0x31 && strip.pixels[offset + 1] === 0x5b && strip.pixels[offset + 2] === 0x2a) opaqueMatches++;
    else otherOpaque++;
  }
  expect(opaqueMatches).toBeGreaterThan(20); expect(otherOpaque).toBe(0);
  await info.attach('palette-pixels.json', {body: JSON.stringify({opaqueMatches, otherOpaque, color: '#315b2a', width: decoded.width, height: decoded.height}), contentType: 'application/json'});
  const accepted = await nativeProject(page, info, 'palette-accepted.luma');
  await page.reload(); dialog = await openPalettes(page);
  await dialog.getByLabel('Search palettes and swatches', {exact: true}).fill('ＡＰＰＲＯＶＥＤ leaf print');
  await expect(dialog.getByRole('button', {name: 'Open color palette Approved botanical', exact: true})).toBeVisible();
  await info.attach('palette-management.png', {body: await dialog.screenshot(), contentType: 'image/png'});
  await dialog.getByRole('button', {name: 'Done', exact: true}).click();
  await page.getByTestId('project-input').setInputFiles(info.outputPath('palette-accepted.luma'));
  await expect(page.locator('.layer-row')).toHaveCount(1);
  await page.locator('.layer-row').first().getByRole('button', {name: /^Select /}).click();
  await expect(page.getByLabel('Text color', {exact: true})).toHaveValue('#315b2a');
  expect((await nativeProject(page, info, 'palette-reopened.luma')).document).toEqual(accepted.document);
}
