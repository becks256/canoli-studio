import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

async function setNumber(page: Page, label: string, value: string) {
  const input = page.getByRole('spinbutton', { name: `${label} value`, exact: true });
  await input.fill(value); await input.press('Enter'); return input;
}
async function startSlide(page: Page, slider: Locator, fraction: number) {
  await slider.scrollIntoViewIfNeeded();
  const box = (await slider.boundingBox())!;
  await page.mouse.move(box.x + 3, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width * fraction, box.y + box.height / 2, { steps: 6 });
}

test('every numeric tool setting has synchronized quick and precise adjustment', async ({ page }) => {
  await page.goto('/');
  const variants = [
    { tool: 'Brush tool (B)', labels: ['Size', 'Hardness', 'Tool opacity'] },
    { tool: 'Pencil tool (N)', labels: ['Size', 'Tool opacity'] },
    { tool: 'Clone brush (S)', labels: ['Size', 'Hardness', 'Tool opacity'] },
    { tool: 'Vector pen (P)', labels: ['Pen width'] },
  ];
  for (const { tool, labels } of variants) {
    await page.getByRole('button', { name: tool, exact: true }).click();
    for (const label of labels) {
      const slider = page.getByRole('slider', { name: label, exact: true });
      await expect(slider).toBeVisible();
      const input = await setNumber(page, label, '32.5');
      await expect(input).toHaveValue('32.5');
      expect(await input.evaluate((node: HTMLInputElement) => node.validity.valid)).toBe(true);
      await expect(slider).toHaveAttribute('aria-valuenow', '32.5');
      await startSlide(page, slider, .6); await page.mouse.up();
      expect(Number(await input.inputValue())).toBeGreaterThan(32.5);
      await slider.focus(); await slider.press('Home');
      await expect(input).toHaveValue(label === 'Size' ? '0.1' : '0');
      await slider.press('End');
      await expect(input).toHaveValue(label === 'Size' ? '2048' : label === 'Pen width' ? '1024' : '100');
    }
  }
  expect(await page.evaluate(() => window.luma.editor.document.getSnapshot().past.length)).toBe(0);
  await page.getByRole('button', { name: 'Brush tool (B)', exact: true }).click();
  await setNumber(page, 'Size', '37.25');
  const input = page.getByRole('spinbutton', { name: 'Size value', exact: true });
  await input.fill('99999'); await input.press('Enter'); await expect(input).toHaveValue('37.25');
  await input.fill('12'); await input.press('Escape'); await expect(input).toHaveValue('37.25');
  await input.fill(''); await input.press('Tab'); await expect(input).toHaveValue('37.25');
  await expect(page.getByRole('button', { name: 'Brush tool (B)' })).toHaveAttribute('aria-pressed', 'true');
  await page.setViewportSize({ width: 1180, height: 850 });
  const bar = await page.locator('.tool-options').boundingBox();
  for (const label of ['Size', 'Hardness', 'Tool opacity']) {
    const field = await page.getByRole('spinbutton', { name: `${label} value`, exact: true }).boundingBox();
    expect(field!.x + field!.width).toBeLessThanOrEqual(bar!.x + bar!.width);
  }
  await page.screenshot({ path: 'test-results/luma-paired-tool-sliders.png' });
});

test('inspector sliders preview, commit once, cancel and accept precise values', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open sample composition', exact: true }).click();
  const history = () => page.evaluate(() => window.luma.editor.document.getSnapshot().past.length);
  const opacity = () => page.evaluate(() => window.luma.editor.document.selectedLayer!.opacity);
  const before = await history();
  const slider = page.getByRole('slider', { name: 'Opacity', exact: true });
  await startSlide(page, slider, .4);
  expect(await opacity()).toBe(1); expect(await history()).toBe(before);
  expect(Number(await page.getByRole('spinbutton', { name: 'Opacity value', exact: true }).inputValue())).toBeLessThan(100);
  await page.mouse.up();
  expect(await opacity()).toBeLessThan(1); expect(await history()).toBe(before + 1);
  await page.getByRole('button', { name: 'Move tool (V)', exact: true }).click();
  await page.keyboard.press('Control+z'); expect(await opacity()).toBe(1);
  await startSlide(page, slider, .25); await page.keyboard.press('Escape'); await page.mouse.up();
  expect(await opacity()).toBe(1); expect(await history()).toBe(before);
  await setNumber(page, 'Opacity', '42.5'); expect(await opacity()).toBe(.425);
  await setNumber(page, 'Exposure', '0.35');
  expect(await page.evaluate(() => {
    const layer = window.luma.editor.document.selectedLayer;
    return layer instanceof window.luma.RasterLayer ? layer.adjustments.at(0)!.exposure : null;
  })).toBe(.35);
  await page.getByLabel('Enable drop shadow').check();
  await setNumber(page, 'Shadow x', '-12.5');
  expect(await page.evaluate(() => window.luma.editor.document.selectedLayer!.styles.dropShadow.x)).toBe(-12.5);
  await page.evaluate(() => { window.luma.editor.document.selectedLayer!.x = 9007199254740001; });
  const exactPosition = page.getByRole('spinbutton', { name: 'X', exact: true });
  await expect(exactPosition).toHaveValue('9007199254740001');
  const positionHistory = await history();
  await exactPosition.focus(); await exactPosition.press('Tab');
  expect(await history()).toBe(positionHistory);
  await page.evaluate(() => { window.luma.editor.document.selectedLayer!.locked = true; });
  await expect(slider).toBeDisabled();
  await expect(page.getByRole('spinbutton', { name: 'Opacity value', exact: true })).toBeDisabled();
});

test('path width uses the same preview and single-undo slider behavior', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const { editor, VectorLayer, VectorPath } = window.luma;
    const layer = editor.document.layers.add(new VectorLayer());
    layer.paths.add(new VectorPath({ points: [{ x: 20, y: 20 }, { x: 200, y: 200 }], strokeWidth: 3 }));
    editor.document.selectedLayer = layer;
  });
  const width = () => page.evaluate(() => {
    const layer = window.luma.editor.document.selectedLayer;
    return layer instanceof window.luma.VectorLayer ? layer.paths.at(0)!.strokeWidth : null;
  });
  const before = await page.evaluate(() => window.luma.editor.document.getSnapshot().past.length);
  await startSlide(page, page.getByRole('slider', { name: 'Path stroke width', exact: true }), .35);
  expect(await width()).toBe(3);
  await page.mouse.up(); expect(await width()).toBeGreaterThan(3);
  expect(await page.evaluate(() => window.luma.editor.document.getSnapshot().past.length)).toBe(before + 1);
  await page.getByRole('button', { name: 'Move tool (V)', exact: true }).click();
  await page.keyboard.press('Control+z'); expect(await width()).toBe(3);
});
