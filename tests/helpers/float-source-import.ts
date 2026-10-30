import {expect, type Page, type TestInfo} from '@playwright/test';
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {historyProject, historyScript} from './history-inspector';

/** Normal picker -> native working source -> complete fitted viewport. */
export async function floatSourceImportWorkflow(page: Page, info: TestInfo, production = false, roundTrip = true) {
  await page.goto('/'); expect(await page.evaluate(() => 'luma' in window)).toBe(!production);
  const original = await readFile('tests/fixtures/tiff-float/native-50mp.tif');
  await page.getByTestId('import-input').setInputFiles('tests/fixtures/tiff-float/native-50mp.tif');
  const dialog = page.getByRole('dialog', {name: 'Import TIFF', exact: true});
  await dialog.getByLabel('TIFF editing precision', {exact: true}).selectOption('float32');
  await expect(dialog.getByLabel('Convert this page to 8-bit editing precision')).toHaveCount(0);
  await dialog.getByRole('button', {name: 'Import TIFF page', exact: true}).evaluate(button => {
    const probe = {start: 0, readyMs: 0, error: '', size: [] as number[]};
    (window as any).__canoliColdImport = probe;
    button.addEventListener('click', () => {
      probe.start = performance.now();
      const tick = () => {
        const status = document.querySelector('footer.canvas-status')?.textContent ?? '';
        if (status.includes('Preview unavailable')) { probe.error = status; return; }
        if (status.includes('10000 × 5000 px') && status.includes('Ready')) {
          const canvas = document.querySelector('[data-testid="artwork"]') as HTMLCanvasElement | null;
          if (canvas?.width && canvas.height) {
            const bytes = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
            let visible = false; for (let i = 3; i < bytes.length; i += 4) if (bytes[i]) { visible = true; break; }
            if (visible) { probe.readyMs = performance.now() - probe.start; probe.size = [canvas.width, canvas.height]; return; }
          }
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, {once: true, capture: true});
  });
  await dialog.getByRole('button', {name: 'Import TIFF page', exact: true}).click();
  await expect(dialog).toHaveCount(0, {timeout: 300000});
  await expect.poll(() => page.evaluate(() => { const probe = (window as any).__canoliColdImport; return probe.error || probe.readyMs > 0; }), {timeout: 300000}).toBe(true);
  const frame = () => page.getByTestId('artwork').evaluate(async element => {
    const canvas = element as HTMLCanvasElement, bytes = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    return {size: [canvas.width, canvas.height], sha256: [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))].map(v => v.toString(16).padStart(2, '0')).join('')};
  });
  const visible = await frame(), probe = await page.evaluate(() => (window as any).__canoliColdImport);
  const saved = await historyProject(page, info, 'cold-import.luma');
  expect(saved.value.document).toMatchObject({width: 10000, height: 5000, precision: 'float32', colorSpace: 'linear-srgb'});
  expect(saved.value.entries).toHaveLength(1);
  expect([saved.value.entries[0].width, saved.value.entries[0].height]).toEqual([10000, 5000]);
  expect(Buffer.from(await saved.value.entries[0].blob.arrayBuffer())).toEqual(original);
  if (roundTrip) {
    await historyScript(page, 'document.layers.at(0).visible=false', 'Cold import hidden');
    const hidden = await historyProject(page, info, 'cold-import-hidden.luma');
    await page.getByRole('button', {name: 'Undo (Mod+Z)', exact: true}).click();
    expect((await historyProject(page, info, 'cold-import-undone.luma')).value.document).toEqual(saved.value.document);
    await page.getByRole('button', {name: 'Redo (Mod+Shift+Z)', exact: true}).click();
    expect((await historyProject(page, info, 'cold-import-redone.luma')).value.document).toEqual(hidden.value.document);
    await page.getByTestId('project-input').setInputFiles(saved.path);
    // The previous frame can still match while the asynchronous open is working.
    await expect(page.getByRole('button', {name: 'Save project', exact: true})).toBeEnabled({timeout: 300000});
    await expect.poll(async () => (await frame()).sha256, {timeout: 300000}).toBe(visible.sha256);
    const reopened = await historyProject(page, info, 'cold-import-reopened.luma');
    expect(reopened.value.document).toEqual(saved.value.document);
    expect(Buffer.from(await reopened.value.entries[0].blob.arrayBuffer())).toEqual(original);
  }
  expect(await page.evaluate(() => 'luma' in window)).toBe(!production);
  const result = {production, roundTrip, readyMs: probe.readyMs, frame: visible, originalSize: [10000, 5000], originalBytes: original.length, originalSha256: createHash('sha256').update(original).digest('hex'), originalExact: true};
  await writeFile(info.outputPath('cold-import.json'), JSON.stringify(result, null, 2)); return result;
}
