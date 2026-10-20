import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const directory = 'tests/fixtures/psd/zip/';
const manifest = JSON.parse(readFileSync(directory + 'manifest.json', 'utf8')) as {
  cases: {file: string; reference: string; width: number; height: number; layers: number}[];
};

for (const fixture of manifest.cases.filter(value => value.layers)) {
  for (const mode of ['layered', 'flatten'] as const) {
    test(`Photoshop ZIP ${fixture.file} ${mode} uses real workers and preserves every source sample`, async ({page}, info) => {
      await page.goto('/');
      await page.getByTestId('psd-input').setInputFiles(directory + fixture.file);
      const dialog = page.locator('.psd-import-dialog');
      await expect(dialog.locator('.psd-meta-card')).toBeVisible();
      await expect(dialog).not.toContainText('unsupported compression');
      await dialog.locator(`input[value="${mode}"]`).check();
      const apply = dialog.getByRole('button', {name: mode === 'layered' ? 'Import Layers' : 'Import Flattened', exact: true});
      await expect(apply).toBeEnabled(); await apply.click();
      await expect(dialog).not.toBeVisible();
      const source = await page.evaluate(async () => {
        const {editor} = window.luma, asset = editor.assetStore.values()[0];
        const hash = await crypto.subtle.digest('SHA-256', await asset.blob.arrayBuffer());
        const model = JSON.stringify(editor.document.toJSON()), project = await editor.saveProject();
        await editor.openProject(new File([project], 'zip.luma'));
        return {width: asset.width, height: asset.height, exactModel: model === JSON.stringify(editor.document.toJSON()),
          exactSource: [...new Uint8Array(hash)].join() === [...new Uint8Array(await crypto.subtle.digest('SHA-256', await editor.assetStore.values()[0].blob.arrayBuffer()))].join()};
      });
      expect(source).toEqual({width: fixture.width, height: fixture.height, exactModel: true, exactSource: true});
      const pending = page.waitForEvent('download');
      await page.getByRole('button', {name: 'Export PNG', exact: true}).click();
      const path = info.outputPath('decoded.png'); await (await pending).saveAs(path);
      const checked = spawnSync('python3', ['-c',
        "from PIL import Image;import numpy as np,sys;a=np.asarray(Image.open(sys.argv[1]).convert('RGBA'));b=np.asarray(Image.open(sys.argv[2]).convert('RGBA'));assert a.shape==b.shape;assert np.array_equal(a,b),int(np.abs(a.astype(int)-b).max());print('Every imported and project-reopened RGBA sample equals the independent original')",
        path, directory + fixture.reference], {encoding: 'utf8', timeout: 30000});
      expect(checked.status, checked.stderr).toBe(0);
      await info.attach('photoshop-zip-independent', {body: JSON.stringify({fixture, mode, source, independent: checked.stdout}), contentType: 'application/json'});
    });
  }
}

for (const operation of ['inspect', 'import'] as const) {
  test(`Photoshop ZIP ${operation} rejects a corrupt checksum without publishing partial work`, async ({page}) => {
    await page.goto('/');
    const bytes = [...readFileSync(directory + 'rgba-prediction.psd')]; bytes[bytes.length - 1] ^= 1;
    const result = await page.evaluate(async ({bytes, operation}) => {
      const {editor, TextLayer} = window.luma;
      editor.document.layers.add(new TextLayer({text: 'Keep my work'}));
      const before = JSON.stringify(editor.document.toJSON()); let error = '';
      try {
        if (operation === 'inspect') await editor.inspectPsd(new Uint8Array(bytes));
        else await editor.openPsd(new Uint8Array(bytes));
      } catch (cause) { error = String(cause); }
      const unchanged = before === JSON.stringify(editor.document.toJSON()), assetCount = editor.assetStore.values().length;
      const valid = await fetch('/tests/fixtures/psd/zip/rgba-prediction.psd').then(response => response.blob());
      const retry = await editor.inspectPsd(valid);
      return {error, unchanged, assetCount, retry: retry.report.canImportAsLayers};
    }, {bytes, operation});
    expect(result.error).toMatch(/Photoshop ZIP/); expect(result.unchanged).toBe(true);
    expect(result.assetCount).toBe(0); expect(result.retry).toBe(true);
  });
}

test('native ZIP cancellation terminates its worker and a new ZIP import succeeds', async ({page}, info) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const {editor, TextLayer} = window.luma;
    editor.document.layers.add(new TextLayer({text: 'Keep this tab'}));
    const owner = editor.document, before = JSON.stringify(owner.toJSON());
    const file = await fetch('/tests/fixtures/psd/zip/native-50mp-zip.psd').then(response => response.blob());
    const abort = new AbortController(), Native = window.Worker;
    let workers = 0, terminated = 0, error = '';
    window.Worker = new Proxy(Native, {construct(Target, args) {
      const worker = Reflect.construct(Target, args) as Worker;
      if (String(args[0]).includes('photoshop-import.worker')) {
        workers++; const terminate = worker.terminate.bind(worker);
        worker.terminate = () => {terminated++; terminate();};
      }
      return worker;
    }});
    try {
      await editor.openPsd(file, {}, {signal: abort.signal, onProgress: progress => {
        if (progress.phase === 'decoding') setTimeout(() => abort.abort(new Error('Cancel native ZIP')), 20);
      }});
    } catch (cause) {error = String(cause);} finally {window.Worker = Native;}
    const unchanged = editor.document === owner && before === JSON.stringify(owner.toJSON()), assetCount = editor.assetStore.values().length;
    const retry = await editor.openPsd(await fetch('/tests/fixtures/psd/zip/rgba-zip.psd').then(response => response.blob()));
    return {workers, terminated, error, unchanged, assetCount, retry: retry.assets.size};
  });
  expect(result.workers).toBe(1); expect(result.terminated).toBe(1); expect(result.error).toContain('Cancel native ZIP');
  expect(result.unchanged).toBe(true); expect(result.assetCount).toBe(0); expect(result.retry).toBe(1);
  await info.attach('photoshop-zip-cancel', {body: JSON.stringify(result), contentType: 'application/json'});
});
