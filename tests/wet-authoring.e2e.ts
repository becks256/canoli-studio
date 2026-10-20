import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('authored smudge samples neutral paint and commits one reversible, persistent native result', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { PaintLayer, PaintFill, PencilStroke } = await import(/* @vite-ignore */ String('/src/dom/index.ts'));
    const { editor } = window.luma; editor.newDocument({ width: 32, height: 16 });
    const layer = editor.document.layers.add(new PaintLayer({ opacity: .5 }));
    for (const [x, color] of [[2, '#ff0000'], [3, '#00ff00'], [4, '#0000ff']] as const) layer.strokes.add(new PaintFill({ bounds: { x, y: 3, width: 1, height: 3 }, color }));
    editor.document.selectLayers([layer]); const before = editor.document.toJSON(), revision = editor.document.getSnapshot().revision;
    const read = async () => { const canvas = await editor.renderer.render(editor.document.toJSON(), editor.assetStore, { cache: false }); try { return [5, 6, 7].map(x => [...canvas.getContext('2d')!.getImageData(x, 4, 1, 1).data]); } finally { canvas.width = canvas.height = 0; } };
    const operation = await editor.applyWetPaint(new PencilStroke({ size: 3, pressureSize: false, points: [{ x: 3.5, y: 4.5 }, { x: 6.5, y: 4.5 }] }), { mix: { pickup: 0 } });
    const pixels = await read(), saved = editor.document.toJSON(), oneRevision = editor.document.getSnapshot().revision === revision + 1;
    const svg = await editor.export({ format: 'svg' }), url = URL.createObjectURL(svg.blob), image = new Image(), target = document.createElement('canvas'); target.width = 32; target.height = 16;
    let svgPixels: number[][];
    try { await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = reject; image.src = url; }); target.getContext('2d')!.drawImage(image, 0, 0); svgPixels = [5, 6, 7].map(x => [...target.getContext('2d')!.getImageData(x, 4, 1, 1).data]); }
    finally { URL.revokeObjectURL(url); target.width = target.height = 0; }
    editor.document.undo(); const undo = JSON.stringify(editor.document.toJSON()) === JSON.stringify(before); editor.document.redo(); const redo = JSON.stringify(editor.document.toJSON()) === JSON.stringify(saved);
    const project = await editor.saveProject(); await editor.openProject(new File([project], 'wet-paint.luma')); const reopened = await read();
    return { pixels, svgPixels, reopened, undo, redo, oneRevision, exactModel: JSON.stringify(editor.document.toJSON()) === JSON.stringify(saved), kind: operation?.kind, references: editor.assetStore.values().length };
  });
  expect(result).toMatchObject({ pixels: [[255, 0, 0, 128], [0, 255, 0, 128], [0, 0, 255, 128]], reopened: [[255, 0, 0, 128], [0, 255, 0, 128], [0, 0, 255, 128]], undo: true, redo: true, oneRevision: true, exactModel: true, kind: 'wet' }); expect(result.references).toBeGreaterThan(0);
  expect(result.svgPixels).toEqual(result.pixels);
});

test('native replacement lowers alpha, supports partial coverage and applies envelope once across overlapping tiles', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { AssetStore } = await import(/* @vite-ignore */ String('/src/core/assets.ts'));
    const { WetPaintStroke, PencilStroke, AffineTransform } = await import(/* @vite-ignore */ String('/src/dom/index.ts'));
    const { encodeRgbaPng } = await import(/* @vite-ignore */ String('/src/engine/png.ts'));
    const { compositeWetPaint } = await import(/* @vite-ignore */ String('/src/engine/wet-composite.ts'));
    const { PixelProcessor } = await import(/* @vite-ignore */ String('/src/engine/processor.ts'));
    const assets = new AssetStore(), processor = new PixelProcessor(), canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d')!, add = async (id: string, alpha: number) => assets.add(await encodeRgbaPng(new Uint8Array([255, 0, 0, alpha]), 1, 1), id, id, false), brush = new PencilStroke({ points: [{ x: .5, y: .5 }] });
    try {
      await add('output', 64); await add('coverage', 128); const tile = { x: 0, y: 0, width: 1, height: 1, assetId: 'output', coverage: { assetId: 'coverage' } }, space = { x: 0, y: 0, width: 1, height: 1, sx: 1, sy: 1 };
      context.fillStyle = '#0000ff'; context.fillRect(0, 0, 1, 1);
      await compositeWetPaint(new WetPaintStroke({ brush, tiles: [tile] }).toJSON(), assets, canvas, space, new AffineTransform(), processor); const partial = [...context.getImageData(0, 0, 1, 1).data];
      await add('red', 128); await add('full', 255); const replacement = { ...tile, assetId: 'red', coverage: { assetId: 'full' } };
      context.fillStyle = '#0000ff'; context.fillRect(0, 0, 1, 1); await compositeWetPaint(new WetPaintStroke({ brush, tiles: [replacement, replacement], opacity: .5 }).toJSON(), assets, canvas, space, new AffineTransform(), processor); const envelope = [...context.getImageData(0, 0, 1, 1).data];
      const before = [...context.getImageData(0, 0, 1, 1).data]; let rejected = false;
      try { await compositeWetPaint(new WetPaintStroke({ brush, tiles: [{ ...replacement, coverage: { assetId: 'output' } }] }).toJSON(), assets, canvas, space, new AffineTransform(), processor); } catch { rejected = true; }
      return { partial, envelope, rejected, unchanged: JSON.stringify(before) === JSON.stringify([...context.getImageData(0, 0, 1, 1).data]) };
    } finally { assets.dispose(); processor.dispose(); canvas.width = canvas.height = 0; }
  });
  for (const [actual, expected] of [[result.partial, [85, 0, 170, 191]], [result.envelope, [85, 0, 170, 191]]] as const) actual.forEach((value, index) => expect(Math.abs(value - expected[index])).toBeLessThanOrEqual(1));
  expect(result.rejected).toBe(true); expect(result.unchanged).toBe(true);
});

test('wet raster output extends native bounds, follows resizing and retains its original source', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { RasterLayer, PencilStroke } = await import(/* @vite-ignore */ String('/src/dom/index.ts'));
    const { encodeRgbaPng } = await import(/* @vite-ignore */ String('/src/engine/png.ts'));
    const { layerBounds } = await import(/* @vite-ignore */ String('/src/core/spatial.ts'));
    const { editor } = window.luma; editor.newDocument({ width: 128, height: 32 }); const pixels = new Uint8Array(64 * 32 * 4); for (let p = 0; p < pixels.length; p += 4) pixels.set([0, 0, 255, 255], p);
    const source = await editor.assetStore.add(await encodeRgbaPng(pixels, 64, 32), 'Original blue', undefined, false), original = await source.blob.arrayBuffer();
    const layer = editor.document.layers.add(new RasterLayer({ assetId: source.id, width: 32, height: 16, x: 2, y: 1 })); editor.document.selectLayers([layer]);
    await editor.applyWetPaint(new PencilStroke({ size: 1, pressureSize: false, points: [{ x: 34.5, y: 4.5 }], color: '#ff0000' }), { mode: 'mixer', mix: { flow: 1, wetness: 0, pickup: 0 } });
    const sample = async (x: number) => { const canvas = await editor.renderer.render(editor.document.toJSON(), editor.assetStore); try { return [...canvas.getContext('2d')!.getImageData(x, 5, 1, 1).data]; } finally { canvas.width = canvas.height = 0; } };
    const beforeResize = await sample(36), bounds = layerBounds(editor.document.toJSON(), layer.id); layer.width = 64; const resized = await sample(71), warm = await sample(71);
    const after = layer.toJSON(), { parsePsd } = await import(/* @vite-ignore */ String('/src/core/interchange/psd/parser.ts'));
    const psd = parsePsd(new Uint8Array(await (await editor.export({ format: 'psd', psdMode: 'layers' })).blob.arrayBuffer())), record = psd.layers[0], at = ((5 - record.top) * (record.right - record.left) + 71 - record.left) * 4;
    return { beforeResize, resized, warm, psdPixel: [...record.imageData.data.slice(at, at + 4)], psdRight: record.right, sourceId: after.kind === 'raster' ? after.assetId === source.id : false, bounds, originalSize: [source.width, source.height], currentSize: [layer.width, layer.height], sourceBytes: [...new Uint8Array(await source.blob.arrayBuffer())], originalBytes: [...new Uint8Array(original)] };
  });
  expect(result.beforeResize).toEqual([255, 0, 0, 255]); expect(result.resized).toEqual([255, 0, 0, 255]); expect(result.warm).toEqual(result.resized); expect(result.bounds!.x + result.bounds!.width).toBeGreaterThan(36); expect(result.sourceId).toBe(true); expect(result.sourceBytes).toEqual(result.originalBytes); expect(result.originalSize).toEqual([64, 32]); expect(result.currentSize).toEqual([64, 16]);
  expect(result.psdRight).toBeGreaterThan(71); expect(result.psdPixel).toEqual(result.resized);
});

test('wet preparation cancellation, human edits, no-op and locks leave no output assets or private databases', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { PaintLayer, PencilStroke } = await import(/* @vite-ignore */ String('/src/dom/index.ts'));
    const { editor } = window.luma; editor.newDocument({ width: 32, height: 16 }); const layer = editor.document.layers.add(new PaintLayer()); editor.document.selectLayers([layer]);
    const brush = new PencilStroke({ size: 1, points: [{ x: 4.5, y: 4.5 }], color: '#ff0000' }), before = JSON.stringify(editor.document.toJSON()), assets = editor.assetStore.values().length;
    const databases = async () => (await indexedDB.databases()).map(value => value.name).filter(name => name?.startsWith('canoli-wet-job-')).sort(); const db = await databases();
    const noop = await editor.applyWetPaint(brush), noopExact = before === JSON.stringify(editor.document.toJSON()); const abort = new AbortController(); let cancelled = false, stale = false;
    try { await editor.applyWetPaint(brush, { mode: 'mixer', signal: abort.signal, onProgress: () => abort.abort() }); } catch { cancelled = true; }
    const cancelExact = before === JSON.stringify(editor.document.toJSON());
    try { await editor.applyWetPaint(brush, { mode: 'mixer', onProgress: () => { editor.document.name = 'Human edit'; } }); } catch { stale = true; }
    const preservedHuman = editor.document.name === 'Human edit' && layer.strokes.length === 0; layer.locked = true; let locked = false; try { await editor.applyWetPaint(brush, { mode: 'mixer' }); } catch { locked = true; }
    return { noop: noop === null, noopExact, cancelled, cancelExact, stale, preservedHuman, locked, assetsExact: assets === editor.assetStore.values().length, cleaned: JSON.stringify(db) === JSON.stringify(await databases()) };
  });
  expect(result).toEqual({ noop: true, noopExact: true, cancelled: true, cancelExact: true, stale: true, preservedHuman: true, locked: true, assetsExact: true, cleaned: true });
});

test('documented prepared wet example executes in the isolated runtime and invalid alpha rolls back', async ({ page }) => {
  const guide = await readFile('docs/SCRIPTING_API.md', 'utf8'), code = guide.match(/<!-- example: wet-prepared -->\s*```js\n([\s\S]*?)\n```/)?.[1]; expect(code).toBeTruthy(); await page.goto('/');
  const result = await page.evaluate(async code => {
    const { RasterLayer } = await import(/* @vite-ignore */ String('/src/dom/index.ts')), { encodeRgbaPng } = await import(/* @vite-ignore */ String('/src/engine/png.ts'));
    const { editor } = window.luma; editor.newDocument({ width: 16, height: 16 });
    for (const [name, alpha] of [['Wet output', 128], ['Wet coverage', 255], ['Invalid coverage', 0]] as const) { const source = await editor.assetStore.add(await encodeRgbaPng(new Uint8Array([255, 0, 0, alpha]), 1, 1), name, undefined, false); editor.document.layers.add(new RasterLayer({ name, assetId: source.id, width: 1, height: 1, visible: false })); }
    const before = editor.document.toJSON(), logs = await editor.runScript(code!), after = editor.document.toJSON(); editor.document.undo(); const undo = JSON.stringify(before) === JSON.stringify(editor.document.toJSON()); editor.document.redo();
    let rejected = false; try { await editor.runScript("document.name = 'Must roll back';\n" + code!.replace("'Wet coverage'", "'Invalid coverage'")); } catch { rejected = true; }
    return { logs, undo, rejected, unchanged: JSON.stringify(after) === JSON.stringify(editor.document.toJSON()), kind: after.children.at(-1)?.kind === 'paint' ? (after.children.at(-1) as import('../src/core/model').PaintLayerData).strokes[0].kind : null };
  }, code);
  expect(result).toMatchObject({ undo: true, rejected: true, unchanged: true, kind: 'wet' }); expect(result.logs.join(' ')).toContain('Prepared wet paint ready');
});

test('authored wet paint edits a real 50 MP original without source-sized working canvases', async ({ page }, info) => {
  test.setTimeout(240000); await page.goto('/'); await page.getByTestId('import-input').setInputFiles('tests/fixtures/matting/native-50mp.png'); await expect(page.locator('.layer-row')).toHaveCount(1, { timeout: 120000 });
  const result = await page.evaluate(async () => {
    const { PencilStroke } = await import(/* @vite-ignore */ String('/src/dom/index.ts'));
    const { editor, RasterLayer } = window.luma, layer = editor.document.layers.at(0); if (!(layer instanceof RasterLayer)) throw new Error('Missing native source');
    const source = editor.assetStore.get(layer.assetId), hash = async (blob: Blob) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].join(','), original = await hash(source.blob), before = editor.document.toJSON();
    const created = new WeakSet<HTMLCanvasElement>(), working: { width: number; height: number }[] = [], create = document.createElement, width = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'width')!, height = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'height')!;
    const restore = () => { document.createElement = create; Object.defineProperty(HTMLCanvasElement.prototype, 'width', width); Object.defineProperty(HTMLCanvasElement.prototype, 'height', height); };
    document.createElement = function (...args: Parameters<Document['createElement']>) { const value = create.apply(document, args); if (value instanceof HTMLCanvasElement) created.add(value); return value; } as Document['createElement'];
    for (const [key, descriptor] of [['width', width], ['height', height]] as const) Object.defineProperty(HTMLCanvasElement.prototype, key, { ...descriptor, set(this: HTMLCanvasElement, value: number) { descriptor.set!.call(this, value); if (created.has(this)) working.push({ width: this.width, height: this.height }); } });
    try {
      const wet = await editor.applyWetPaint(new PencilStroke({ size: 1, pressureSize: false, points: [{ x: 9000.5, y: 4000.5 }, { x: 9004.5, y: 4000.5 }] }), { mix: { pickup: 0 } });
      const canvas = await editor.renderer.render(editor.document.toJSON(), editor.assetStore, { region: { x: 9004, y: 4000, width: 1, height: 1 }, cache: false }); const end = [...canvas.getContext('2d')!.getImageData(0, 0, 1, 1).data]; canvas.width = canvas.height = 0; restore();
      const saved = editor.document.toJSON(); editor.document.undo(); const undo = JSON.stringify(before) === JSON.stringify(editor.document.toJSON()); editor.document.redo(); const project = await editor.saveProject(); await editor.openProject(new File([project], 'wet-50mp.luma')); const reopened = editor.document.layers.at(0); if (!(reopened instanceof RasterLayer)) throw new Error('Missing reopened original');
      return { end, undo, exact: JSON.stringify(saved) === JSON.stringify(editor.document.toJSON()), sourceExact: original === await hash(editor.assetStore.get(reopened.assetId).blob), originalSize: [source.width, source.height], documentSize: [editor.document.width, editor.document.height], kind: wet?.kind, working };
    } finally { restore(); }
  });
  expect(result).toMatchObject({ end: [255, 0, 0, 128], undo: true, exact: true, sourceExact: true, originalSize: [10000, 5000], documentSize: [10000, 5000], kind: 'wet' }); expect(result.working.some(value => value.width * value.height > 0)).toBe(true); expect(result.working.every(value => value.width * value.height <= 4_000_000)).toBe(true); await info.attach('authored-wet-50mp', { body: JSON.stringify(result), contentType: 'application/json' });
});

test('partitioned affine wet rendering matches complete native composition with ordered following ink', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { PaintLayer, PaintFill, WetPaintStroke, PencilStroke, EraserStroke, AffineTransform } = await import(/* @vite-ignore */ String('/src/dom/index.ts'));
    const { drawPaint } = await import(/* @vite-ignore */ String('/src/engine/drawing.ts')), { localBounds } = await import(/* @vite-ignore */ String('/src/core/spatial.ts')), { encodeRgbaPng } = await import(/* @vite-ignore */ String('/src/engine/png.ts'));
    const { editor } = window.luma; editor.newDocument({ width: 420, height: 180 }); const layer = editor.document.layers.add(new PaintLayer());
    layer.strokes.add(new PaintFill({ bounds: { x: 0, y: 0, width: 300, height: 80 }, color: '#0000ff' }));
    const output = new Uint8Array(40 * 20 * 4), coverage = new Uint8Array(output.length); for (let p = 0; p < output.length; p += 4) { output.set([255, 0, 0, p / 4 % 3 ? 128 : 64], p); coverage.set([255, 255, 255, 255], p); }
    const pixels = await editor.assetStore.add(await encodeRgbaPng(output, 40, 20), 'Replacement', undefined, false), mask = await editor.assetStore.add(await encodeRgbaPng(coverage, 40, 20), 'Coverage', undefined, false);
    layer.strokes.add(new WetPaintStroke({ brush: new PencilStroke({ points: [{ x: 130, y: 30 }] }), tiles: [{ x: 120, y: 20, width: 40, height: 20, assetId: pixels.id, coverage: { assetId: mask.id } }], opacity: .7 }));
    layer.strokes.add(new EraserStroke({ size: 3, hardness: 1, opacity: .5, pressureSize: false, points: [{ x: 127.5, y: 30.5 }, { x: 145.5, y: 30.5 }] })); layer.strokes.add(new PencilStroke({ size: 3, pressureSize: false, color: '#00ff00', points: [{ x: 240.5, y: 40.5 }, { x: 280.5, y: 40.5 }] }));
    const raw = layer.toJSON(), bounds = localBounds(raw)!, left = Math.floor(bounds.x) - 2, top = Math.floor(bounds.y) - 2, width = Math.ceil(bounds.x + bounds.width) - left + 2, height = Math.ceil(bounds.y + bounds.height) - top + 2;
    const native = document.createElement('canvas'), expected = document.createElement('canvas'); native.width = width; native.height = height; expected.width = 420; expected.height = 180;
    try {
      await drawPaint(raw, editor.assetStore, native, { x: left, y: top, width, height, sx: 1, sy: 1 }, new AffineTransform(), editor.renderer.processor, undefined, undefined, undefined, undefined, undefined, undefined, true);
      const transform = new AffineTransform(1.1, .15, .2, .9, 3.25, 5.75); layer.transform = transform;
      const context = expected.getContext('2d')!; context.setTransform(transform.a, transform.b, transform.c, transform.d, transform.e, transform.f); context.drawImage(native, left, top); const reference = context.getImageData(0, 0, 420, 180).data;
      const actual = await editor.renderer.render(editor.document.toJSON(), editor.assetStore, { cache: false }); let maximum = 0, alphaMaximum = 0;
      try { const values = actual.getContext('2d')!.getImageData(0, 0, 420, 180).data; for (let p = 0; p < values.length; p += 4) { alphaMaximum = Math.max(alphaMaximum, Math.abs(values[p + 3] - reference[p + 3])); for (let c = 0; c < 3; c++) maximum = Math.max(maximum, Math.abs(values[p + c] * values[p + 3] / 255 - reference[p + c] * reference[p + 3] / 255)); } } finally { actual.width = actual.height = 0; }
      const frame = await editor.renderer.prepareViewport(editor.document.toJSON(), editor.assetStore); const backend = frame.backend; frame.dispose(); return { maximum, alphaMaximum, backend };
    } finally { native.width = native.height = expected.width = expected.height = 0; }
  });
  expect(result.maximum).toBeLessThanOrEqual(2); expect(result.alphaMaximum).toBeLessThanOrEqual(1); expect(result.backend).toBe('canvas2d');
});

test('actual resize handles use expanded wet ink while preserving one undoable source-plane resize', async ({ page }) => {
  await page.goto('/');
  const before = await page.evaluate(async () => {
    const { RasterLayer, PencilStroke, WetPaintStroke } = await import(/* @vite-ignore */ String('/src/dom/index.ts')), { encodeRgbaPng } = await import(/* @vite-ignore */ String('/src/engine/png.ts'));
    const { editor } = window.luma; editor.newDocument({ width: 128, height: 64 }); const sourcePixels = new Uint8Array(12 * 8 * 4); for (let p = 0; p < sourcePixels.length; p += 4) sourcePixels.set([0, 0, 255, 255], p);
    const source = await editor.assetStore.add(await encodeRgbaPng(sourcePixels, 12, 8), 'Original', undefined, false), output = await editor.assetStore.add(await encodeRgbaPng(new Uint8Array(16).fill(255), 2, 2), 'Ink', undefined, false);
    const layer = editor.document.layers.add(new RasterLayer({ assetId: source.id, width: 12, height: 8, x: 20, y: 10 })); layer.applyWetPaint(new WetPaintStroke({ brush: new PencilStroke({ points: [{ x: -1, y: 4 }] }), tiles: [{ x: -2, y: 3, width: 2, height: 2, assetId: output.id, coverage: { assetId: output.id } }] })); editor.document.selectLayers([layer]); return editor.document.toJSON();
  });
  await page.getByRole('button', { name: 'Move tool (V)', exact: true }).click(); await page.keyboard.press('Control+1');
  const handle = page.locator('.selection-outline .handle-se'); await expect(handle).toBeVisible(); const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 14, box.y + box.height / 2 + 8, { steps: 4 }); await page.mouse.up();
  await expect.poll(() => page.evaluate(() => { const {editor,RasterLayer}=window.luma, layer=editor.document.layers.at(0); if(!(layer instanceof RasterLayer))throw new Error('Missing resized image'); return [layer.x, layer.y, layer.width, layer.height]; })).toEqual([22, 10, 24, 16]);
  await page.keyboard.press('Control+z'); expect(await page.evaluate(() => window.luma.editor.document.toJSON())).toEqual(before);
});
