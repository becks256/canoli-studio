import {test, expect} from '@playwright/test';
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

test('cold native float source preparation retains every tile identity and reports storage costs', async ({page}, info) => {
  test.setTimeout(600000);
  const original = await readFile('tests/fixtures/tiff-float/native-50mp.tif');
  await page.goto('/');
  const result = await page.evaluate(async bytes => {
    const {FloatRasterSource} = await import(/* @vite-ignore */ String('/src/core/float-source/source.ts'));
    const {FloatTileRepository} = await import(/* @vite-ignore */ String('/src/core/float-source/storage.ts'));
    const editor = window.luma.editor, before = {model: JSON.stringify(editor.document.toJSON()), past: editor.document.getSnapshot().past.length};
    const append = FloatTileRepository.prototype.appendBatch;
    const open = IDBFactory.prototype.open, transaction = IDBDatabase.prototype.transaction;
    const costs = {opens: 0, openMs: 0, transactions: 0, transactionMs: 0, appends: 0, appendMs: 0, maxBatch: 0};
    IDBFactory.prototype.open = function(...args: Parameters<typeof open>) {
      const start = performance.now(), request = open.apply(this, args);
      if (args[0] === 'canoli-float-tiles') { costs.opens++; request.addEventListener('success', () => costs.openMs += performance.now() - start); }
      return request;
    };
    IDBDatabase.prototype.transaction = function(...args: Parameters<typeof transaction>) {
      const start = performance.now(), result = transaction.apply(this, args);
      if (this.name === 'canoli-float-tiles') { costs.transactions++; result.addEventListener('complete', () => costs.transactionMs += performance.now() - start); }
      return result;
    };
    FloatTileRepository.prototype.appendBatch = async function(...args: Parameters<typeof append>) {
      const start = performance.now(), batch = args[2]; costs.appends++; costs.maxBatch = Math.max(costs.maxBatch, Array.isArray(batch) ? batch.length : 0);
      try { return await append.apply(this, args); } finally { costs.appendMs += performance.now() - start; }
    };
    const source = await FloatRasterSource.openTiff(new Blob([new Uint8Array(bytes)], {type: 'image/tiff'}));
    try {
      const start = performance.now(), manifest = await source.prepare(), prepareMs = performance.now() - start;
      const unchanged = before.model === JSON.stringify(editor.document.toJSON()) && before.past === editor.document.getSnapshot().past.length;
      return {prepareMs, costs, unchanged, descriptor: manifest.descriptor, prepared: manifest.prepared, tiles: manifest.tiles, originalBytes: source.original.size};
    } finally {
      source.dispose(); FloatTileRepository.prototype.appendBatch = append;
      IDBFactory.prototype.open = open; IDBDatabase.prototype.transaction = transaction;
    }
  }, [...original]);
  expect(result.unchanged).toBe(true);
  expect(result.descriptor).toMatchObject({width: 10000, height: 5000, sourceSha256: createHash('sha256').update(original).digest('hex')});
  expect(result.tiles.length).toBe(Math.ceil(10000 / result.descriptor.tileWidth) * Math.ceil(5000 / result.descriptor.tileHeight));
  const identity = createHash('sha256').update(JSON.stringify({descriptor: result.descriptor, prepared: result.prepared, tiles: result.tiles})).digest('hex');
  await writeFile(info.outputPath('cold-source.json'), JSON.stringify({...result, identity}, null, 2));
});
