import {test, expect} from '@playwright/test';
import {readFile, writeFile} from 'node:fs/promises';

const originalPath = 'tests/fixtures/tiff-float/rgba-raw-le.tif';
const expectedSha256 = '99f25377d308953a00dc2bb2ffbcfe148036c49e676652ef24bc1b07d81b11ec';

for (const fault of ['corrupt-last', 'duplicate', 'skipped', 'empty', 'oversized', 'quota-second', 'caller-mutation', 'caller-mutation-late'] as const)
  test(`float staging batch is atomic after ${fault}`, async ({page}, info) => {
    await page.goto('/');
    const result = await page.evaluate(async ({bytes, fault}) => {
      const {FloatRasterSource} = await import(/* @vite-ignore */ String('/src/core/float-source/source.ts'));
      const {FloatTileRepository} = await import(/* @vite-ignore */ String('/src/core/float-source/storage.ts'));
      const Native = window.Worker, captured: any[] = [];
      window.Worker = class extends Native {
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options);
          if (String(url).includes('prepare.worker')) this.addEventListener('message', event => {
            if (event.data.kind === 'tiles') captured.push(...event.data.tiles);
          });
        }
      };
      const doc = window.luma.editor.document, before = {model: JSON.stringify(doc.toJSON()), past: doc.getSnapshot().past.length};
      const original = new Blob([new Uint8Array(bytes)], {type: 'image/tiff'}), source = await FloatRasterSource.openTiff(original);
      const repository = new FloatTileRepository(), add = IDBObjectStore.prototype.add, open = IDBFactory.prototype.open;
      try {
        const manifest = await source.prepare(); window.Worker = Native;
        if (captured.length !== 2) throw new Error('Expected the actual two-tile native preparation packet.');
        const buildId = crypto.randomUUID(); await repository.begin(manifest.descriptor, buildId);
        let batch = structuredClone(captured), additions = 0;
        if (fault === 'corrupt-last') batch[1].blob = new Blob([new Uint8Array(batch[1].blob.size)]);
        if (fault === 'duplicate') batch[1] = batch[0];
        if (fault === 'skipped') batch = [batch[1]];
        if (fault === 'empty') batch = [];
        if (fault === 'oversized') batch = Array.from({length: 9}, () => batch[0]);
        if (fault === 'quota-second') IDBObjectStore.prototype.add = function(value: unknown, key?: IDBValidKey) {
          if (this.name === 'tiles' && ++additions === 2) throw new DOMException('Second tile quota fixture', 'QuotaExceededError');
          return add.call(this, value, key!);
        };
        let error = '';
        if (fault === 'caller-mutation-late') IDBFactory.prototype.open = function(...args: Parameters<typeof open>) {
          const request = open.apply(this, args);
          request.addEventListener('success', () => { batch[0].meta.index = 1; batch[1].blob = new Blob([new Uint8Array(batch[1].blob.size)]); });
          return request;
        };
        try {
          const pending = repository.appendBatch(manifest.descriptor, buildId, batch);
          if (fault === 'caller-mutation') { batch[0].meta.index = 1; batch[1].blob = new Blob([new Uint8Array(batch[1].blob.size)]); }
          await pending;
        }
        catch (cause) { error = String(cause); }
        finally { IDBObjectStore.prototype.add = add; IDBFactory.prototype.open = open; }
        const state = async () => {
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open('canoli-float-tiles');
            request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
          });
          try {
            return await new Promise<{next: number; tiles: number; ready: string; exact: boolean}>((resolve, reject) => {
              const tx = db.transaction(['stages', 'tiles', 'sources'], 'readonly');
              const stage = tx.objectStore('stages').get(buildId), tiles = tx.objectStore('tiles').count(IDBKeyRange.bound([buildId, 0], [buildId, Number.MAX_SAFE_INTEGER]));
              const ready = tx.objectStore('sources').get(manifest.key);
              const last = tx.objectStore('tiles').get([buildId, 1]);
              tx.oncomplete = async () => {
                try {
                  const hash = last.result ? [...new Uint8Array(await crypto.subtle.digest('SHA-256', await last.result.blob.arrayBuffer()))].map(v => v.toString(16).padStart(2, '0')).join('') : null;
                  resolve({next: stage.result.next, tiles: tiles.result, ready: ready.result.buildId, exact: hash === null || hash === captured[1].meta.encodedSha256});
                } catch (error) { reject(error); }
              };
              tx.onabort = () => reject(tx.error);
            });
          } finally { db.close(); }
        };
        const failed = await state();
        if (!fault.startsWith('caller-mutation')) await repository.appendBatch(manifest.descriptor, buildId, captured);
        const retry = await state(); await repository.discard(buildId);
        const pixels = await source.readWindow({x: 0, y: 0, width: 131, height: 79});
        const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', pixels.buffer as ArrayBuffer))].map(v => v.toString(16).padStart(2, '0')).join('');
        return {fault, error, additions, failed: {...failed, ready: failed.ready === manifest.buildId}, retry: {...retry, ready: retry.ready === manifest.buildId}, sha256, originalSame: source.original === original, unchanged: before.model === JSON.stringify(doc.toJSON()) && before.past === doc.getSnapshot().past.length};
      } finally { window.Worker = Native; IDBObjectStore.prototype.add = add; IDBFactory.prototype.open = open; repository.dispose(); source.dispose(); }
    }, {bytes: [...await readFile(originalPath)], fault});
    if (fault.startsWith('caller-mutation')) {
      expect(result.error).toBe(''); expect(result.failed).toEqual({next: 2, tiles: 2, ready: true, exact: true});
    } else {
      expect(result.error).not.toBe(''); expect(result.failed).toEqual({next: 0, tiles: 0, ready: true, exact: true});
    }
    expect(result.retry).toEqual({next: 2, tiles: 2, ready: true, exact: true});
    expect(result.sha256).toBe(expectedSha256);
    expect(result.originalSame && result.unchanged).toBe(true);
    if (fault === 'quota-second') expect(result.additions).toBe(2);
    await writeFile(info.outputPath('batch-' + fault + '.json'), JSON.stringify(result, null, 2));
  });

for (const fault of ['corrupt-last', 'duplicate', 'skipped', 'empty', 'oversized'] as const)
  test(`malformed native worker batch ${fault} cannot publish a source and a fresh retry succeeds`, async ({page}, info) => {
    await page.goto('/');
    const result = await page.evaluate(async ({bytes, fault}) => {
      const {FloatRasterSource} = await import(/* @vite-ignore */ String('/src/core/float-source/source.ts'));
      const Native = window.Worker; let injected = false;
      window.Worker = class extends Native {
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options);
          if (String(url).includes('prepare.worker')) this.addEventListener('message', event => {
            if (injected || event.data.kind !== 'tiles') return;
            injected = true; event.stopImmediatePropagation(); const data = structuredClone(event.data);
            if (fault === 'corrupt-last') data.tiles[1].blob = new Blob([new Uint8Array(data.tiles[1].blob.size)]);
            if (fault === 'duplicate') data.tiles[1] = data.tiles[0];
            if (fault === 'skipped') data.tiles = [data.tiles[1]];
            if (fault === 'empty') data.tiles = [];
            if (fault === 'oversized') data.tiles = Array.from({length: 9}, () => data.tiles[0]);
            this.dispatchEvent(new MessageEvent('message', {data}));
          });
        }
      };
      const doc = window.luma.editor.document, before = {model: JSON.stringify(doc.toJSON()), past: doc.getSnapshot().past.length};
      const original = new Blob([new Uint8Array(bytes)], {type: 'image/tiff'}), source = await FloatRasterSource.openTiff(original);
      try {
        let error = ''; try { await source.prepare(); } catch (cause) { error = String(cause); } finally { window.Worker = Native; }
        const counts = await new Promise<Record<string, number>>((resolve, reject) => {
          const request = indexedDB.open('canoli-float-tiles'); request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result, tx = db.transaction(['sources', 'stages', 'tiles'], 'readonly'), result: Record<string, number> = {};
            for (const name of ['sources', 'stages', 'tiles']) { const count = tx.objectStore(name).count(); count.onsuccess = () => { result[name] = count.result; }; }
            tx.oncomplete = () => { db.close(); resolve(result); }; tx.onabort = () => { db.close(); reject(tx.error); };
          };
        });
        const retry = await source.prepare(), pixels = await source.readWindow({x: 0, y: 0, width: 131, height: 79});
        const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', pixels.buffer as ArrayBuffer))].map(v => v.toString(16).padStart(2, '0')).join('');
        return {fault, error, injected, counts, tiles: retry.tiles.length, sha256, originalSame: source.original === original, unchanged: before.model === JSON.stringify(doc.toJSON()) && before.past === doc.getSnapshot().past.length};
      } finally { window.Worker = Native; source.dispose(); }
    }, {bytes: [...await readFile(originalPath)], fault});
    expect(result.injected).toBe(true); expect(result.error).not.toBe('');
    expect(result.counts).toEqual({sources: 0, stages: 0, tiles: 0});
    expect(result.tiles).toBe(2); expect(result.sha256).toBe(expectedSha256);
    expect(result.originalSame && result.unchanged).toBe(true);
    await writeFile(info.outputPath('worker-' + fault + '.json'), JSON.stringify(result, null, 2));
  });
