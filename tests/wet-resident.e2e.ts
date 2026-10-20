import { expect, test } from '@playwright/test';

test('resident wet epochs stay private until flush and capture caller buffers', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createWetTileStore } = await import(/* @vite-ignore */ String('/src/engine/wet-store.ts'));
    const { createWetWorkingCache } = await import(/* @vite-ignore */ String('/src/engine/wet-cache.ts'));
    const store = await createWetTileStore(), cache = createWetWorkingCache(store, 64, () => {});
    const put = IDBObjectStore.prototype.put; let writes = 0;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.transaction.db.name.startsWith('canoli-wet-job-')) writes++;
      return put.apply(this, args);
    };
    try {
      const original = new Uint8ClampedArray([1, 2, 3, 4]);
      const pending = cache.put('original', original); original.fill(99); await pending;
      for (let epoch = 0; epoch < 20; epoch++) {
        await cache.batch([
          { type: 'put', key: `epoch/${epoch}`, value: new Float32Array([epoch / 32]) },
          ...(epoch ? [{ type: 'remove' as const, key: `epoch/${epoch - 1}` }] : []),
        ]);
      }
      const before = writes, privateOriginal = await store.get('original') === undefined;
      let refusedClear = false; try { cache.clear(); } catch { refusedClear = true; }
      await cache.flush(['original', 'epoch/19']);
      const persistedWrites = writes; cache.clear();
      const captured = [...(await store.get('original'))!], latest = [...(await store.get('epoch/19'))!];
      return { before, privateOriginal, refusedClear, persistedWrites, captured, latest, bounded: cache.peak <= 64 };
    } finally { IDBObjectStore.prototype.put = put; cache.discard(); await store.dispose(); }
  });
  expect(result).toEqual({ before: 0, privateOriginal: true, refusedClear: true, persistedWrites: 2, captured: [1, 2, 3, 4], latest: [19 / 32], bounded: true });
});

test('failed dirty eviction preserves the complete resident epoch and atomic backing state', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createWetTileStore } = await import(/* @vite-ignore */ String('/src/engine/wet-store.ts'));
    const { createWetWorkingCache } = await import(/* @vite-ignore */ String('/src/engine/wet-cache.ts'));
    const store = await createWetTileStore(), cache = createWetWorkingCache(store, 8, () => {}), put = IDBObjectStore.prototype.put;
    try {
      await cache.put('a', new Uint8ClampedArray([1, 2, 3, 4]));
      await cache.put('b', new Float32Array([.5]));
      let calls = 0, rejected = false;
      IDBObjectStore.prototype.put = function (...args) {
        if (this.transaction.db.name.startsWith('canoli-wet-job-') && ++calls === 2) throw new DOMException('Resident eviction quota failure', 'QuotaExceededError');
        return put.apply(this, args);
      };
      try { await cache.put('c', new Uint8ClampedArray(8).fill(7)); }
      catch (error) { rejected = error instanceof DOMException && error.name === 'QuotaExceededError'; }
      finally { IDBObjectStore.prototype.put = put; }
      const rollback = { a: [...(await cache.get('a'))!], b: [...(await cache.get('b'))!], c: await cache.get('c') === undefined, backingA: await store.get('a') === undefined, backingB: await store.get('b') === undefined, bytes: cache.bytes };
      await cache.put('c', new Uint8ClampedArray(8).fill(7));
      await cache.flush(['a', 'b', 'c']); cache.clear();
      return { rejected, rollback, recovered: { a: [...(await store.get('a'))!], b: [...(await store.get('b'))!], c: [...(await store.get('c'))!] }, bounded: cache.peak <= 8 };
    } finally { IDBObjectStore.prototype.put = put; cache.discard(); await store.dispose(); }
  });
  expect(result).toEqual({ rejected: true, rollback: { a: [1, 2, 3, 4], b: [.5], c: true, backingA: true, backingB: true, bytes: 8 }, recovered: { a: [1, 2, 3, 4], b: [.5], c: Array(8).fill(7) }, bounded: true });
});

test('only a fresh exclusive native store uses resident working data', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createWetTileStore } = await import(/* @vite-ignore */ String('/src/engine/wet-store.ts'));
    const { createWetWorkingCache } = await import(/* @vite-ignore */ String('/src/engine/wet-cache.ts'));
    const { WetTileCache } = await import(/* @vite-ignore */ String('/src/engine/wet-state.ts'));
    const fresh = await createWetTileStore(), used = await createWetTileStore(), modified = await createWetTileStore(), zero = await createWetTileStore();
    const stores = [fresh, used, modified, zero];
    try {
      await used.put('existing', new Uint8ClampedArray([1]));
      const actualPut = modified.put; modified.put = (...args: Parameters<typeof actualPut>) => actualPut(...args);
      const resident = createWetWorkingCache(fresh, 16, () => {});
      const second = createWetWorkingCache(fresh, 16, () => {});
      const fallbacks = [createWetWorkingCache(used, 16, () => {}), createWetWorkingCache(modified, 16, () => {}), createWetWorkingCache(zero, 0, () => {})];
      await Promise.all(fallbacks.map((cache, index) => cache.put('saved', new Uint8ClampedArray([index + 2]))));
      const persisted = await Promise.all(stores.slice(1).map(async store => [...(await store.get('saved'))!]));
      return { native: resident.constructor !== WetTileCache, exclusive: second.constructor === WetTileCache, fallbacks: fallbacks.every(cache => cache.constructor === WetTileCache), persisted };
    } finally { await Promise.all(stores.map(store => store.dispose())); }
  });
  expect(result).toEqual({ native: true, exclusive: true, fallbacks: true, persisted: [[2], [3], [4]] });
});

test('resident cache rejects changed sources, replaced storage and closed storage before publishing', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createWetTileStore } = await import(/* @vite-ignore */ String('/src/engine/wet-store.ts'));
    const { createWetWorkingCache } = await import(/* @vite-ignore */ String('/src/engine/wet-cache.ts'));
    const results = [];
    for (const mode of ['source', 'methods', 'closed', 'version']) {
      const store = await createWetTileStore(); let current = true;
      const cache = createWetWorkingCache(store, 16, () => { if (!current) throw new Error('Source changed'); });
      await cache.put('unpublished', new Uint8ClampedArray([1, 2, 3, 4]));
      const read = store.get; let upgrade: IDBOpenDBRequest | undefined;
      try {
        if (mode === 'source') current = false;
        if (mode === 'methods') store.get = (key: string) => read(key);
        if (mode === 'closed') await store.dispose();
        if (mode === 'version') {
          const names = (await indexedDB.databases()).filter(entry => entry.name?.startsWith('canoli-wet-job-'));
          if (names.length !== 1) throw new Error('Expected one private owner');
          upgrade = indexedDB.open(names[0].name!, 2);
          await new Promise<void>((resolve, reject) => { upgrade!.onsuccess = () => { upgrade!.result.close(); resolve(); }; upgrade!.onerror = () => reject(upgrade!.error); });
        }
        let rejected = false; try { await cache.flush(['unpublished']); } catch { rejected = true; }
        const missing = mode === 'closed' || mode === 'version' ? true : await read('unpublished') === undefined;
        results.push({ mode, rejected, missing });
      } finally { cache.discard(); await store.dispose(); }
    }
    return results;
  });
  expect(result).toEqual(['source', 'methods', 'closed', 'version'].map(mode => ({ mode, rejected: true, missing: true })));
});

test('native resident, evicted and zero-cache prefixes preserve exact affine textured symmetry output and owned results', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createWetStrokeSession } = await import(/* @vite-ignore */ String('/src/engine/wet-session.ts'));
    const { PixelProcessor } = await import(/* @vite-ignore */ String('/src/engine/processor.ts'));
    const { AssetStore } = await import(/* @vite-ignore */ String('/src/core/assets.ts'));
    const { BrushStroke, AffineTransform, MarqueeSelection } = await import(/* @vite-ignore */ String('/src/dom/index.ts'));
    const { encodeRgbaPng } = await import(/* @vite-ignore */ String('/src/engine/png.ts'));
    const processor = new PixelProcessor(), assets = new AssetStore();
    const bytes = new Uint8Array(4 * 4 * 4);
    for (let i = 0; i < bytes.length; i += 4) bytes.set([i % 8 ? 255 : 0, 60, 120, 255], i);
    await assets.add(await encodeRgbaPng(bytes, 4, 4), 'Native texture', 'tip', false);
    const points = [{ x: 2.5, y: 3.5, pressure: .6, tilt: { altitude: .4, azimuth: .2 } }, { x: 8.5, y: 7.5, pressure: 1, tilt: { altitude: .8, azimuth: 1 } }, { x: 5.5, y: 9.5, pressure: .4, tilt: { altitude: .3, azimuth: 2 } }];
    const brush = new BrushStroke({ size: 6, spacing: .3, opacity: .6, flow: .7, pressureOpacity: true, tip: { roundness: .5, angle: 23, tiltAngle: true }, texture: { assetId: 'tip', channel: 'luminance', invert: false }, symmetry: { copies: [new AffineTransform(-1, .1, .2, 1, 9, 0).toJSON()] }, clip: new MarqueeSelection({ shape: 'rectangle', x: 1, y: 1, width: 11, height: 10 }), points }).toJSON();
    const source = async (region: { x: number; y: number; width: number; height: number }) => {
      const out = new Uint8ClampedArray(region.width * region.height * 4);
      for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width; x++) out.set([((region.x + x) * 31) & 255, ((region.y + y) * 47) & 255, 80, 128], (y * region.width + x) * 4);
      return out;
    };
    const read = async (output: import('../src/engine/wet-state').WetStrokeResult) => {
      const values: [string, number[]][] = [];
      for await (const tile of output.tiles()) for (let y = 0; y < tile.region.height; y++) for (let x = 0; x < tile.region.width; x++) {
        const p = y * tile.region.width + x;
        if (tile.changed[p]) values.push([`${tile.region.x + x},${tile.region.y + y}`, [...tile.before.slice(p * 4, p * 4 + 4), ...tile.pixels.slice(p * 4, p * 4 + 4)]]);
      }
      return values.sort(([a], [b]) => a.localeCompare(b));
    };
    const transform = new AffineTransform(1.1, .2, .1, .9, -.5, 1.5);
    const modes: { prefix: [string, number[]][]; end: [string, number[]][]; stable: boolean; peak: number; budget: number }[] = [];
    try {
      for (const cacheBytes of [0, 128, 32 * 1024 * 1024]) {
        const session = await createWetStrokeSession({ ...brush, points: points.slice(0, 1) }, source, processor, { assets, transform, tileSize: 8, cacheBytes });
        let prefix, final;
        try {
          await session.append(points.slice(1, 2)); prefix = await session.snapshot(); const before = await read(prefix);
          await session.append(points.slice(2)); final = await session.finish(); await session.dispose();
          const end = await read(final), stable = JSON.stringify(before) === JSON.stringify(await read(prefix));
          modes.push({ prefix: before, end, stable, peak: final.diagnostics.peakCacheBytes, budget: cacheBytes });
        } finally { await session.dispose(); await prefix?.dispose(); await final?.dispose(); }
      }
      return { exact: modes.every(mode => JSON.stringify(mode.prefix) === JSON.stringify(modes[0].prefix) && JSON.stringify(mode.end) === JSON.stringify(modes[0].end)), stable: modes.every(mode => mode.stable), bounded: modes.every(mode => mode.peak <= mode.budget), changed: modes[0].end.length };
    } finally { assets.dispose(); processor.dispose(); }
  });
  expect(result).toMatchObject({ exact: true, stable: true, bounded: true }); expect(result.changed).toBeGreaterThan(0);
});

test('a native result flush quota failure publishes no document, history or assets and releases the job', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { PaintLayer, PencilStroke } = await import(/* @vite-ignore */ String('/src/dom/index.ts'));
    const { editor } = window.luma; editor.newDocument({ width: 32, height: 16 });
    const layer = editor.document.layers.add(new PaintLayer()); editor.document.selectLayers([layer]);
    const before = JSON.stringify(editor.document.toJSON()), revision = editor.document.getSnapshot().revision, assets = editor.assetStore.values().length;
    const names = async () => (await indexedDB.databases()).map(entry => entry.name).filter(name => name?.startsWith('canoli-wet-job-')).sort(), databases = await names();
    const put = IDBObjectStore.prototype.put; let resultWrites = 0, rejected = false;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.transaction.db.name.startsWith('canoli-wet-job-') && String(args[1]).startsWith('result/')) { resultWrites++; throw new DOMException('Mandatory result flush quota failure', 'QuotaExceededError'); }
      return put.apply(this, args);
    };
    try {
      try { await editor.applyWetPaint(new PencilStroke({ size: 1, pressureSize: false, points: [{ x: 4.5, y: 4.5 }, { x: 7.5, y: 4.5 }], color: '#ff0000' }), { mode: 'mixer' }); }
      catch (error) { rejected = String(error).includes('Mandatory result flush quota failure'); }
      return { rejected, resultWrites, exact: before === JSON.stringify(editor.document.toJSON()), revision: revision === editor.document.getSnapshot().revision, assets: assets === editor.assetStore.values().length, cleaned: JSON.stringify(databases) === JSON.stringify(await names()) };
    } finally { IDBObjectStore.prototype.put = put; }
  });
  expect(result).toEqual({ rejected: true, resultWrites: 1, exact: true, revision: true, assets: true, cleaned: true });
});
