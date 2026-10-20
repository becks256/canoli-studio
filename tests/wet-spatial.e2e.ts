import { expect, test } from '@playwright/test';

test('private native working databases preserve typed tiles, isolate jobs and delete only their own records', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createWetTileStore } = await import(/* @vite-ignore */ String('/src/engine/wet-store.ts'));
    const names = async () => (await indexedDB.databases()).map(value => value.name).filter(name => name?.startsWith('canoli-wet-job-')).sort();
    const before = await names(), a = await createWetTileStore(), b = await createWetTileStore();
    try {
      const pixels = new Uint8ClampedArray([255, 0, 0, 128]), carried = new Float32Array([.5, 0, 0, .5]);
      await a.put('same', pixels); await b.put('same', carried); pixels.fill(0); carried.fill(0);
      const first = await a.get('same'), second = await b.get('same'); const active = (await names()).length - before.length;
      await a.dispose(); const surviving = await b.get('same'); let closed = false;
      try { await a.get('same'); } catch { closed = true; }
      await b.dispose();
      return { first: [...first!], second: [...second!], types: [first instanceof Uint8ClampedArray, second instanceof Float32Array], surviving: [...surviving!], active, closed, cleaned: JSON.stringify(await names()) === JSON.stringify(before) };
    } finally { await a.dispose(); await b.dispose(); }
  });
  expect(result).toEqual({ first: [255, 0, 0, 128], second: [.5, 0, 0, .5], types: [true, true], surviving: [.5, 0, 0, .5], active: 2, closed: true, cleaned: true });
});

test('native orphan cleanup follows worker termination and preserves live jobs', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { cleanupWetTileStores, createWetTileStore } = await import(/* @vite-ignore */ String('/src/engine/wet-store.ts'));
    const live = await createWetTileStore(); await live.put('retained', new Uint8ClampedArray([1, 2, 3, 4]));
    const before = (await indexedDB.databases()).map(value => value.name);
    const source = `import { createWetTileStore } from ${JSON.stringify(location.origin + '/src/engine/wet-store.ts')}; const before = new Set((await indexedDB.databases()).map(value => value.name)); const store = await createWetTileStore(); await store.put('abandoned', new Uint8ClampedArray([99,88,77,66])); self.postMessage((await indexedDB.databases()).map(value => value.name).find(name => name?.startsWith('canoli-wet-job-') && !before.has(name)));`;
    const url = URL.createObjectURL(new Blob([source], { type: 'application/javascript' })), worker = new Worker(url, { type: 'module' });
    try {
      const abandoned = await new Promise<string>((resolve, reject) => { worker.onmessage = event => resolve(event.data); worker.onerror = event => reject(new Error(event.message)); });
      worker.terminate(); await navigator.locks.request(abandoned, async () => {}); await cleanupWetTileStores(indexedDB);
      const names = (await indexedDB.databases()).map(value => value.name), retained = await live.get('retained');
      return { hadAbandoned: !!abandoned, removed: !names.includes(abandoned), liveUnchanged: [...retained!], beforeStillPresent: before.every(name => names.includes(name)) };
    } finally { worker.terminate(); URL.revokeObjectURL(url); await live.dispose(); }
  });
  expect(result).toEqual({ hadAbandoned: true, removed: true, liveUnchanged: [1, 2, 3, 4], beforeStillPresent: true });
});

test('native spatial smudge moves a striped footprint across tiles and cropped results own their bytes', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { prepareWetStroke } = await import(/* @vite-ignore */ String('/src/engine/wet-stroke.ts'));
    const { PixelProcessor } = await import(/* @vite-ignore */ String('/src/engine/processor.ts'));
    const { PencilStroke } = await import(/* @vite-ignore */ String('/src/dom/index.ts'));
    const processor = new PixelProcessor();
    const source = async (region: { x: number; y: number; width: number; height: number }) => {
      const out = new Uint8ClampedArray(region.width * region.height * 4);
      for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width; x++) { const xx = region.x + x, yy = region.y + y; if (yy >= 3 && yy <= 5 && xx >= 2 && xx <= 4) out.set([[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]][xx - 2], (y * region.width + x) * 4); }
      return out;
    };
    const prepared = await prepareWetStroke(new PencilStroke({ size: 3, pressureSize: false, points: [{ x: 3.5, y: 4.5, pressure: 1 }, { x: 6.5, y: 4.5, pressure: 1 }] }).toJSON(), source, processor, { tileSize: 8, cacheBytes: 0, mix: { pickup: 0 } });
    try {
      const values: Record<string, number[]> = {}, cropped: Record<string, number[]> = {};
      for await (const tile of prepared.tiles()) for (let y = 0; y < tile.region.height; y++) for (let x = 0; x < tile.region.width; x++) if (tile.changed[y * tile.region.width + x]) values[`${tile.region.x + x},${tile.region.y + y}`] = [...tile.pixels.slice((y * tile.region.width + x) * 4, (y * tile.region.width + x + 1) * 4)];
      for await (const tile of prepared.tiles({ x: 5, y: 4, width: 3, height: 1 })) for (let x = 0; x < tile.region.width; x++) cropped[`${tile.region.x + x},4`] = [...tile.pixels.slice(x * 4, x * 4 + 4)];
      const retained = (await prepared.tiles().next()).value!.pixels, snapshot = retained.slice(); retained.fill(17);
      const again = (await prepared.tiles().next()).value!.pixels; const independent = snapshot.every((value: number, index: number) => again[index] === value);
      const diagnostics = prepared.diagnostics; await prepared.dispose();
      return { end: [values['5,4'], values['6,4'], values['7,4']], crop: [cropped['5,4'], cropped['6,4'], cropped['7,4']], independent, retainedAfterDispose: retained.byteLength > 0, diagnostics };
    } finally { await prepared.dispose(); processor.dispose(); }
  });
  const expected = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]];
  expect(result.end).toEqual(expected); expect(result.crop).toEqual(expected); expect(result.independent).toBe(true); expect(result.retainedAfterDispose).toBe(true); expect(result.diagnostics).toMatchObject({ dabs: 4, peakCacheBytes: 0 });
});

test('native textured tilted affine replay is identical under tile repartitioning and cache eviction', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { prepareWetStroke } = await import(/* @vite-ignore */ String('/src/engine/wet-stroke.ts'));
    const { PixelProcessor } = await import(/* @vite-ignore */ String('/src/engine/processor.ts'));
    const { AssetStore } = await import(/* @vite-ignore */ String('/src/core/assets.ts'));
    const { AffineTransform } = await import(/* @vite-ignore */ String('/src/core/affine.ts'));
    const { BrushStroke } = await import(/* @vite-ignore */ String('/src/dom/index.ts'));
    const processor = new PixelProcessor(), assets = new AssetStore(), canvas = document.createElement('canvas'); canvas.width = canvas.height = 4;
    const context = canvas.getContext('2d')!; context.fillRect(0, 0, 2, 4); context.fillStyle = '#ffffff'; context.fillRect(2, 0, 2, 4);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!))); await assets.add(blob, 'Spatial texture', 'tip', false);
    const input = new BrushStroke({ size: 7, opacity: .63, flow: .43, spacing: .4, pressureSize: true, pressureOpacity: true, tip: { roundness: .7, angle: 19, tiltAngle: true, tiltRoundness: true }, texture: { assetId: 'tip', channel: 'luminance', invert: false }, symmetry: { copies: [new AffineTransform(-1, 0, .2, 1, 6, 1).toJSON()] }, points: [{ x: -1.5, y: 2.5, pressure: .5, tilt: { altitude: .8, azimuth: .4 } }, { x: 7.5, y: 5.5, pressure: 1, tilt: { altitude: 1.2, azimuth: 1.1 } }] }).toJSON();
    const read = async (region: { x: number; y: number; width: number; height: number }) => { const out = new Uint8ClampedArray(region.width * region.height * 4); for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width; x++) { const xx = region.x + x, yy = region.y + y; out.set([(xx * 71) & 255, (yy * 37) & 255, (xx * 23 + yy * 17) & 255, ((xx + yy) * 57) & 255], (y * region.width + x) * 4); } return out; };
    const options = { assets, transform: new AffineTransform(.9, .2, .3, 1.1, 3, -2), load: { color: [255, 20, 70, 191] as [number, number, number, number], load: .23 }, mix: { pickup: .43, wetness: .17 } };
    const a = await prepareWetStroke(input, read, processor, { ...options, tileSize: 8, cacheBytes: 0 });
    const b = await prepareWetStroke(input, read, processor, { ...options, tileSize: 16, cacheBytes: 512 * 1024 });
    try {
      const collect = async (value: typeof a) => { const out: Record<string, number[]> = {}; for await (const tile of value.tiles()) for (let y = 0; y < tile.region.height; y++) for (let x = 0; x < tile.region.width; x++) if (tile.changed[y * tile.region.width + x]) out[`${tile.region.x + x},${tile.region.y + y}`] = [...tile.pixels.slice((y * tile.region.width + x) * 4, (y * tile.region.width + x + 1) * 4)]; return out; };
      const aa = await collect(a), bb = await collect(b), keys = Object.keys(aa).sort();
      return { exact: JSON.stringify(keys) === JSON.stringify(Object.keys(bb).sort()) && keys.every(key => JSON.stringify(aa[key]) === JSON.stringify(bb[key])), changed: keys.length, dabs: [a.diagnostics.dabs, b.diagnostics.dabs], cache: [a.diagnostics.peakCacheBytes, b.diagnostics.peakCacheBytes], sourceAlive: assets.get('tip').bitmap.width === 4, sourceBytes: await assets.get('tip').blob.arrayBuffer().then((bytes: ArrayBuffer) => bytes.byteLength === blob.size) };
    } finally { await a.dispose(); await b.dispose(); processor.dispose(); assets.dispose(); canvas.width = canvas.height = 0; }
  });
  expect(result.exact).toBe(true); expect(result.changed).toBeGreaterThan(0); expect(result.dabs[0]).toBe(result.dabs[1]); expect(result.cache[0]).toBe(0); expect(result.cache[1]).toBeLessThanOrEqual(512 * 1024); expect(result.sourceAlive).toBe(true); expect(result.sourceBytes).toBe(true);
});

test('native cancellation and quota failure delete private working state without touching the document', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { prepareWetStroke } = await import(/* @vite-ignore */ String('/src/engine/wet-stroke.ts'));
    const { PixelProcessor } = await import(/* @vite-ignore */ String('/src/engine/processor.ts'));
    const { PencilStroke } = await import(/* @vite-ignore */ String('/src/dom/index.ts'));
    const processor = new PixelProcessor(), documentBefore = JSON.stringify(window.luma.editor.document.toJSON()), names = async () => (await indexedDB.databases()).map(db => db.name).filter(name => name?.startsWith('canoli-wet-job-')).sort();
    const before = await names(), abort = new AbortController(), errors: string[] = [], input = new PencilStroke({ size: 1, points: [{ x: 1.5, y: 1.5, pressure: 1 }, { x: 4.5, y: 1.5, pressure: 1 }] }).toJSON();
    const source = async (region: { width: number; height: number }) => new Uint8ClampedArray(region.width * region.height * 4);
    const put = IDBObjectStore.prototype.put;
    try {
      try { await prepareWetStroke(input, source, processor, { tileSize: 8, load: { load: 1, color: [255, 0, 0, 255] }, signal: abort.signal, onProgress: () => abort.abort(new Error('Cancelled native stroke')) }); } catch (error) { errors.push(String(error)); }
      const afterCancel = JSON.stringify(await names()) === JSON.stringify(before);
      IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) { if (this.name === 'tiles' && this.transaction.db.name.startsWith('canoli-wet-job-')) throw new DOMException('Injected private quota failure', 'QuotaExceededError'); return put.apply(this, args); };
      // A transparent, unloaded stroke is a no-op and needs no persisted
      // result. Deposit pigment so this exercises mandatory output storage.
      try { const result = await prepareWetStroke(input, source, processor, { tileSize: 8, load: { load: 1, color: [255, 0, 0, 255] } }); await result.dispose(); } catch (error) { errors.push(String(error)); }
      return { errors, afterCancel, afterQuota: JSON.stringify(await names()) === JSON.stringify(before), documentUnchanged: JSON.stringify(window.luma.editor.document.toJSON()) === documentBefore };
    } finally { IDBObjectStore.prototype.put = put; processor.dispose(); }
  });
  expect(result.errors).toHaveLength(2); expect(result.errors[0]).toContain('Cancelled native stroke'); expect(result.errors[1]).toContain('quota failure'); expect(result.afterCancel).toBe(true); expect(result.afterQuota).toBe(true); expect(result.documentUnchanged).toBe(true);
});

test('captured native source identity rejects replacement while retaining foreign artwork and document history', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { prepareDocumentWetStroke } = await import(/* @vite-ignore */ String('/src/engine/wet-document.ts'));
    const { PixelProcessor } = await import(/* @vite-ignore */ String('/src/engine/processor.ts'));
    const { CanvasRenderer } = await import(/* @vite-ignore */ String('/src/engine/renderer.ts'));
    const { AssetStore } = await import(/* @vite-ignore */ String('/src/core/assets.ts'));
    const { Document: StudioDocument, RasterLayer, PencilStroke } = await import(/* @vite-ignore */ String('/src/dom/index.ts'));
    const processor = new PixelProcessor(), renderer = new CanvasRenderer(), assets = new AssetStore(), foreign = new AssetStore(), canvas = document.createElement('canvas'); canvas.width = canvas.height = 16; canvas.getContext('2d')!.fillRect(0, 0, 16, 16);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!))); await assets.add(blob, 'Original', 'source', false); await foreign.add(blob, 'Foreign', 'replacement', false);
    const doc = new StudioDocument({ width: 16, height: 16 }); doc.layers.add(new RasterLayer({ assetId: 'source', width: 16, height: 16 })); const before = JSON.stringify(doc.toJSON()), revision = doc.getSnapshot().revision, replacement = foreign.get('replacement');
    let error = '', swapped = false;
    try {
      try { await prepareDocumentWetStroke(doc.toJSON(), assets, renderer, processor, new PencilStroke({ size: 1, points: [{ x: 1.5, y: 1.5, pressure: 1 }, { x: 4.5, y: 1.5, pressure: 1 }] }).toJSON(), { mode: 'all-layers' }, { tileSize: 8, load: { load: 1, color: [255, 0, 0, 255] }, onProgress: () => { if (!swapped) { swapped = true; assets.remove('source'); foreign.shareTo(assets, 'replacement', 'source'); } } }); } catch (reason) { error = String(reason); }
      return { error, swapped, foreignRetained: assets.get('source').bitmap === replacement.bitmap && assets.get('source').bitmap.width === 16, documentUnchanged: JSON.stringify(doc.toJSON()) === before && revision === doc.getSnapshot().revision };
    } finally { processor.dispose(); renderer.dispose(); assets.dispose(); foreign.dispose(); canvas.width = canvas.height = 0; }
  });
  expect(result.error).toContain('source changed'); expect(result.swapped).toBe(true); expect(result.foreignRetained).toBe(true); expect(result.documentUnchanged).toBe(true);
});

test('native 50 MP preparation transports fractional alpha and survives source-project reopening without source-sized canvases', async ({ page }, info) => {
  test.setTimeout(240000); await page.goto('/');
  await page.getByTestId('import-input').setInputFiles('tests/fixtures/matting/native-50mp.png'); await expect(page.locator('.layer-row')).toHaveCount(1, { timeout: 120000 });
  const result = await page.evaluate(async () => {
    const { prepareDocumentWetStroke } = await import(/* @vite-ignore */ String('/src/engine/wet-document.ts'));
    const { PixelProcessor } = await import(/* @vite-ignore */ String('/src/engine/processor.ts'));
    const { PencilStroke } = await import(/* @vite-ignore */ String('/src/dom/index.ts'));
    const { editor, RasterLayer } = window.luma, processor = new PixelProcessor(), layer = editor.document.layers.at(0);
    if (!(layer instanceof RasterLayer)) throw new Error('Missing native raster source');
    const asset = editor.assetStore.get(layer.assetId), before = JSON.stringify(editor.document.toJSON()), revision = editor.document.getSnapshot().revision;
    const hash = async (blob: Blob) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(value => value.toString(16).padStart(2, '0')).join('');
    const sourceHash = await hash(asset.blob), created = new WeakSet<HTMLCanvasElement>(), working: { width: number; height: number }[] = [], create = document.createElement;
    const width = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'width')!, height = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'height')!;
    const restore = () => { document.createElement = create; Object.defineProperty(HTMLCanvasElement.prototype, 'width', width); Object.defineProperty(HTMLCanvasElement.prototype, 'height', height); };
    document.createElement = function (...args: Parameters<Document['createElement']>) { const value = create.apply(document, args); if (value instanceof HTMLCanvasElement) created.add(value); return value; } as Document['createElement'];
    for (const [key, descriptor] of [['width', width], ['height', height]] as const) Object.defineProperty(HTMLCanvasElement.prototype, key, { ...descriptor, set(this: HTMLCanvasElement, value: number) { descriptor.set!.call(this, value); if (created.has(this)) working.push({ width: this.width, height: this.height }); } });
    let prepared: Awaited<ReturnType<typeof prepareDocumentWetStroke>> | undefined;
    try {
      prepared = await prepareDocumentWetStroke(editor.document.toJSON(), editor.assetStore, editor.renderer, processor, new PencilStroke({ size: 1, pressureSize: false, points: [{ x: 9000.5, y: 4000.5, pressure: 1 }, { x: 9004.5, y: 4000.5, pressure: 1 }] }).toJSON(), { mode: 'all-layers' }, { mix: { pickup: 0 } });
      restore();
      const unchanged = before === JSON.stringify(editor.document.toJSON()) && revision === editor.document.getSnapshot().revision;
      const project = await editor.saveProject(); await editor.openProject(new File([project], 'wet-source-50mp.luma')); const restored = editor.document.layers.at(0); if (!(restored instanceof RasterLayer)) throw new Error('Missing reopened native source');
      let end: number[] = []; for await (const tile of prepared.tiles({ x: 9004, y: 4000, width: 1, height: 1 })) end = [...tile.pixels];
      return { end, unchanged, reopened: before === JSON.stringify(editor.document.toJSON()), sourceExact: sourceHash === await hash(editor.assetStore.get(restored.assetId).blob), size: [asset.width, asset.height], nativeLayer: [restored.width, restored.height], working, diagnostics: prepared.diagnostics };
    } finally { restore(); await prepared?.dispose(); processor.dispose(); }
  });
  expect(result.end).toEqual([255, 0, 0, 128]); expect(result.unchanged).toBe(true); expect(result.reopened).toBe(true); expect(result.sourceExact).toBe(true); expect(result.size).toEqual([10000, 5000]); expect(result.nativeLayer).toEqual([10000, 5000]); expect(result.working.length).toBeGreaterThan(0); expect(result.working.some(value => value.width * value.height > 0)).toBe(true); expect(result.working.every(value => value.width * value.height <= 4_000_000)).toBe(true); expect(result.diagnostics.dabs).toBe(5);
  await info.attach('wet-native-50mp', { body: JSON.stringify(result), contentType: 'application/json' });
});
