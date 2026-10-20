import { expect, test } from '@playwright/test';

for (const target of ['layer', 'mask', 'filter-mask'] as const) test(`native ${target} prefixes reuse unchanged pixels, own retired frames and commit without decoding again`, async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async target => {
    const { Document, PaintLayer, PaintFill, LayerMask, SmartObjectLayer, SmartToneFilter, PencilStroke } = await import(/* @vite-ignore */ String('/src/dom/index.ts'));
    const { editor } = window.luma; editor.newDocument({ width: 256, height: 128 });
    let layer;
    if (target === 'filter-mask') {
      const master = new Document({ width: 256, height: 128 }); master.layers.add(new PaintLayer()).strokes.add(new PaintFill({ bounds: { x: 0, y: 0, width: 256, height: 128 }, color: '#202020' }));
      const componentId = editor.document.defineComponent(master); layer = editor.document.layers.add(new SmartObjectLayer({ componentId, width: 256, height: 128 })); layer.addFilter(new SmartToneFilter({ exposure: 1 })); layer.filterMask = new LayerMask({ base: 1 });
    } else {
      layer = editor.document.layers.add(new PaintLayer()); layer.strokes.add(new PaintFill({ bounds: { x: 0, y: 0, width: 256, height: 128 }, color: '#0000ff' }));
      if (target === 'mask') layer.mask = new LayerMask({ base: 1 });
    }
    editor.document.selectedLayer = layer;
    const before = JSON.stringify(editor.document.toJSON()), revision = editor.document.getSnapshot().revision, assetCount = editor.assetStore.values().length;
    const read = async (document: Parameters<typeof editor.renderer.render>[0], assets: Parameters<typeof editor.renderer.render>[1]) => {
      const canvas = await editor.renderer.render(document, assets, { cache: false });
      try { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data))].join(','); }
      finally { canvas.width = canvas.height = 0; }
    };
    const decode = window.createImageBitmap; let decodes = 0;
    window.createImageBitmap = function (...args: Parameters<typeof createImageBitmap>) { decodes++; return decode.apply(window, args); } as typeof createImageBitmap;
    const job = await editor._beginWetPaint(new PencilStroke({ size: 4, hardness: 1, pressureSize: false, points: [{ x: 4.5, y: 64.5 }], color: '#ff0000' }), { mode: 'mixer', target, load: { load: 1, color: target === 'layer' ? [255, 0, 0, 255] : [0, 0, 0, 0] }, mix: { pickup: 0, wetness: 0 } });
    let first, second, release: (() => void) | undefined;
    try {
      await job.append([{ x: 144.5, y: 64.5, pressure: 1 }]); first = await job.preview(); if (!first) throw new Error('Missing first prefix');
      release = first.retain(); const initialHash = await read(first.document, first.assets), original = first.operation.toJSON().tiles.find(tile => tile.x < 128 && tile.x + tile.width <= 128)!;
      if (!original) throw new Error('Missing completed first native cell');
      const source = first.assets.get(original.assetId); first.dispose(); const start = decodes;
      await job.append([{ x: 160.5, y: 64.5, pressure: 1 }]); second = await job.preview(); if (!second) throw new Error('Missing next prefix');
      const reused = second.operation.toJSON().tiles.find(tile => tile.assetId === original.assetId), nextHash = await read(second.document, second.assets), addedDecodes = decodes - start;
      const sameSource = !!reused && second.assets.get(reused.assetId).blob === source.blob && second.assets.get(reused.assetId).bitmap === source.bitmap;
      const privateState = before === JSON.stringify(editor.document.toJSON()) && revision === editor.document.getSnapshot().revision && assetCount === editor.assetStore.values().length;
      const startCommit = decodes; second.dispose(); const retiredClosed = second.isDisposed;
      await job.commit(); await job.dispose(); const commitDecodes = decodes - startCommit;
      const finalHash = await read(editor.document._read(), editor.assetStore), retainedHash = await read(first.document, first.assets), after = JSON.stringify(editor.document.toJSON());
      editor.document.undo(); const undo = before === JSON.stringify(editor.document.toJSON()); editor.document.redo(); const redo = after === JSON.stringify(editor.document.toJSON());
      release(); release = undefined;
      return { sameSource, addedDecodes, commitDecodes, privateState, retiredClosed, firstClosed: first.isDisposed, exactCommit: nextHash === finalHash, retained: initialHash === retainedHash, changed: initialHash !== nextHash, undo, redo, oneHistory: editor.document.getSnapshot().revision === revision + 3 };
    } finally { window.createImageBitmap = decode; release?.(); first?.dispose(); second?.dispose(); await job.dispose(); }
  }, target);
  expect(result).toEqual({ sameSource: true, addedDecodes: 2, commitDecodes: 0, privateState: true, retiredClosed: true, firstClosed: true, exactCommit: true, retained: true, changed: true, undo: true, redo: true, oneHistory: true });
});

test('failed replacement releases its private delta and cache but preserves an earlier owned prefix', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { PaintLayer, PencilStroke } = await import(/* @vite-ignore */ String('/src/dom/index.ts'));
    const { editor } = window.luma; editor.newDocument({ width: 256, height: 128 }); editor.document.selectedLayer = editor.document.layers.add(new PaintLayer());
    const names = async () => (await indexedDB.databases()).map(entry => entry.name).filter(name => name?.startsWith('canoli-wet-job-')).sort(), databases = await names();
    const before = JSON.stringify(editor.document.toJSON()), revision = editor.document.getSnapshot().revision, count = editor.assetStore.values().length;
    const job = await editor._beginWetPaint(new PencilStroke({ size: 4, pressureSize: false, points: [{ x: 4.5, y: 64.5 }], color: '#ff0000' }), { mode: 'mixer', mix: { pickup: 0, wetness: 0 } });
    const read = async (frame: NonNullable<Awaited<ReturnType<typeof job.preview>>>) => {
      const canvas = await editor.renderer.render(frame.document, frame.assets, { cache: false });
      try { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data))].join(','); }
      finally { canvas.width = canvas.height = 0; }
    };
    const decode = window.createImageBitmap; let frame;
    try {
      await job.append([{ x: 144.5, y: 64.5, pressure: 1 }]); frame = await job.preview(); if (!frame) throw new Error('Missing retained prefix'); const hash = await read(frame);
      await job.append([{ x: 160.5, y: 64.5, pressure: 1 }]); window.createImageBitmap = async () => { throw new Error('Injected prefix decode failure'); };
      let rejected = false; try { await job.preview(); } catch { rejected = true; } finally { window.createImageBitmap = decode; }
      await job.dispose();
      return { rejected, stable: hash === await read(frame), stale: !frame.isCurrent(), unchanged: before === JSON.stringify(editor.document.toJSON()) && revision === editor.document.getSnapshot().revision, assets: count === editor.assetStore.values().length, cleaned: JSON.stringify(databases) === JSON.stringify(await names()) };
    } finally { window.createImageBitmap = decode; frame?.dispose(); await job.dispose(); }
  });
  expect(result).toEqual({ rejected: true, stable: true, stale: true, unchanged: true, assets: true, cleaned: true });
});

for (const mode of ['storage-version', 'closed-pixels'] as const) test(`unchanged prefix rejects ${mode} invalidation without publishing or leaking its workspace`, async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async mode => {
    const { editor, PaintLayer, PencilStroke } = window.luma;
    editor.newDocument({ width: 64, height: 64 }); editor.document.selectedLayer = editor.document.layers.add(new PaintLayer());
    const names = async () => (await indexedDB.databases()).filter(row => row.name?.startsWith('canoli-wet-job-')).map(row => row.name!).sort(), databases = await names();
    const before = JSON.stringify(editor.document.toJSON()), revision = editor.document.getSnapshot().revision, assets = editor.assetStore.values().length;
    const job = await editor._beginWetPaint(new PencilStroke({ size: 4, pressureSize: false, points: [{ x: 8, y: 8 }], color: '#ff0000' }), { mode: 'mixer' });
    let first, unexpected;
    try {
      first = await job.preview(); if (!first) throw new Error('Missing prefix');
      if (mode === 'closed-pixels') first.assets.get(first.operation.toJSON().tiles[0].assetId).bitmap.close();
      else {
        const owned = (await names()).filter(name => !databases.includes(name)); if (owned.length !== 1) throw new Error('Expected one active numeric workspace');
        await new Promise<void>((resolve, reject) => { const request = indexedDB.open(owned[0], 2); request.onsuccess = () => { request.result.close(); resolve(); }; request.onerror = () => reject(request.error); });
      }
      let rejected = false; try { unexpected = await job.preview(); } catch { rejected = true; }
      await job.dispose();
      return { rejected, unchanged: before === JSON.stringify(editor.document.toJSON()) && revision === editor.document.getSnapshot().revision, assets: assets === editor.assetStore.values().length, cleaned: JSON.stringify(databases) === JSON.stringify(await names()) };
    } finally { first?.dispose(); unexpected?.dispose(); await job.dispose(); }
  }, mode);
  expect(result).toEqual({ rejected: true, unchanged: true, assets: true, cleaned: true });
});

for (const cacheBytes of [0, 32 * 1024 * 1024]) test(`native epoch-only projection checks storage lifetime with cache budget ${cacheBytes}`, async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async cacheBytes => {
    const { createWetStrokeSession } = await import(/* @vite-ignore */ String('/src/engine/wet-session.ts'));
    const { PixelProcessor } = await import(/* @vite-ignore */ String('/src/engine/processor.ts'));
    const { PencilStroke } = await import(/* @vite-ignore */ String('/src/dom/index.ts'));
    const processor = new PixelProcessor(), names = async () => (await indexedDB.databases()).filter(row => row.name?.startsWith('canoli-wet-job-')).map(row => row.name!).sort(), databases = await names();
    const session = await createWetStrokeSession(new PencilStroke({ size: 1, pressureSize: false, points: [{ x: 4.5, y: 4.5 }] }).toJSON(), async (region: { width: number; height: number }) => new Uint8ClampedArray(region.width * region.height * 4), processor, { cacheBytes, tileSize: 8, load: { load: 1, color: [255, 0, 0, 255] }, mix: { pickup: 0 } });
    let snapshot, unexpected;
    try {
      snapshot = await session.snapshot(); const epochs = new Map<string, string>();
      for await (const tile of snapshot.tiles()) epochs.set(`${tile.region.x},${tile.region.y}`, tile.epoch!);
      await snapshot.dispose(); const owned = (await names()).filter(name => !databases.includes(name)); if (owned.length !== 1 || !epochs.size) throw new Error('Missing active native projection');
      await new Promise<void>((resolve, reject) => { const request = indexedDB.open(owned[0], 2); request.onsuccess = () => { request.result.close(); resolve(); }; request.onerror = () => reject(request.error); });
      let rejected = false; try { unexpected = await session.snapshotSince(epochs); } catch { rejected = true; }
      await session.dispose(); return { rejected, cleaned: JSON.stringify(databases) === JSON.stringify(await names()) };
    } finally { await unexpected?.result.dispose(); await snapshot?.dispose(); await session.dispose(); processor.dispose(); }
  }, cacheBytes);
  expect(result).toEqual({ rejected: true, cleaned: true });
});

test('ready wet prefixes start promptly and later preparations share one gesture frame boundary', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createWetCadenceHarness } = await import(/* @vite-ignore */ String('/tests/fixtures/wet-cadence.tsx'));
    const { editor, PaintLayer, PaintFill } = window.luma; editor.newDocument({ width: 128, height: 96 });
    const layer = editor.document.layers.add(new PaintLayer()); layer.strokes.add(new PaintFill({ bounds: { x: 0, y: 0, width: 128, height: 96 }, color: '#0000ff' })); editor.document.selectedLayer = layer;
    await document.fonts.ready;
    const fixture = createWetCadenceHarness(editor); fixture.show(null); Reflect.set(window, 'wetCadenceFixture', fixture);
    Reflect.set(window, 'wetCadenceBefore', JSON.stringify(editor.document.toJSON()));
  });
  const state = () => page.evaluate(() => { const fixture = Reflect.get(window, 'wetCadenceFixture'); return { starts: fixture.starts, rendering: fixture.rendering }; });
  const pixel = (x: number) => page.evaluate(x => Reflect.get(window, 'wetCadenceFixture').pixel(x), x);
  await expect.poll(() => pixel(32)).toEqual([0, 0, 255, 255]);
  await expect.poll(async () => (await state()).rendering).toBe(false);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  try {
    await page.evaluate(async () => {
      const fixture = Reflect.get(window, 'wetCadenceFixture'); fixture.pause();
      const { editor, PencilStroke } = window.luma;
      const job = await editor._beginWetPaint(new PencilStroke({ size: 8, hardness: 1, pressureSize: false, pressureOpacity: false, points: [{ x: 32, y: 40 }], color: '#ff0000' }), { mode: 'mixer', mix: { wetness: 0, pickup: 0 } });
      Reflect.set(window, 'wetCadenceJob', job); const frame = await job.preview(); if (!frame) throw new Error('Missing first prefix');
      Reflect.set(window, 'wetCadenceFrames', [frame]); fixture.show(frame);
    });
    await expect.poll(() => pixel(32)).toEqual([255, 0, 0, 255]);
    await expect.poll(() => state()).toEqual({ starts: 1, rendering: false });
    await page.evaluate(async () => {
      const job = Reflect.get(window, 'wetCadenceJob'); await job.append([{ x: 64, y: 40, pressure: 1 }]); const frame = await job.preview(); if (!frame) throw new Error('Missing next prefix');
      Reflect.get(window, 'wetCadenceFrames').push(frame); Reflect.get(window, 'wetCadenceFixture').show(frame);
    });
    await expect.poll(() => state()).toEqual({ starts: 1, rendering: true });
    expect(await pixel(64)).toEqual([0, 0, 255, 255]);
    await page.evaluate(() => Reflect.get(window, 'wetCadenceFixture').releaseFrame());
    await expect.poll(() => pixel(64)).toEqual([255, 0, 0, 255]);
    await expect.poll(() => state()).toEqual({ starts: 2, rendering: false });
    await page.evaluate(async () => {
      const job = Reflect.get(window, 'wetCadenceJob'); await job.append([{ x: 80, y: 40, pressure: 1 }]); const frame = await job.preview(); if (!frame) throw new Error('Missing queued prefix');
      Reflect.get(window, 'wetCadenceFrames').push(frame); Reflect.get(window, 'wetCadenceFixture').show(frame);
    });
    await expect.poll(() => state()).toEqual({ starts: 2, rendering: true }); expect(await pixel(80)).toEqual([0, 0, 255, 255]);
    await page.evaluate(async () => { await Reflect.get(window, 'wetCadenceJob').dispose(); const fixture = Reflect.get(window, 'wetCadenceFixture'); fixture.show(null); fixture.restore(); });
    await expect.poll(() => pixel(32)).toEqual([0, 0, 255, 255]);
    expect(await page.evaluate(() => JSON.stringify(window.luma.editor.document.toJSON()) === Reflect.get(window, 'wetCadenceBefore'))).toBe(true);
  } finally {
    await page.evaluate(async () => { Reflect.get(window, 'wetCadenceFixture')?.dispose(); for (const frame of Reflect.get(window, 'wetCadenceFrames') ?? []) frame.dispose(); await Reflect.get(window, 'wetCadenceJob')?.dispose(); }).catch(() => {});
  }
});
