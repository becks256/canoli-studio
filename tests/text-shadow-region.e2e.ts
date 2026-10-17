import {test, expect} from '@playwright/test';

test('bounded text shadows preserve complete glyphs, effects and native output grids', async ({page}, info) => {
  await page.goto('/');
  const results = await page.evaluate(async () => {
    const {Document, TextLayer, LayerGroup, LayerStyle, LayerMask, MarqueeSelection, AffineTransform, editor} = window.luma;
    const {CanvasRenderer} = await import(/* @vite-ignore */ String('/src/engine/renderer.ts'));
    const renderer = new CanvasRenderer();
    await document.fonts.ready;
    const reports: {id: string; max: number; ink: number}[] = [];
    try {
      for (const [id, text, spacing] of [
        ['overhang', '  fj Ág j\u0301\nمرحبا שלום 🙂', -0.6],
        ['overlap', 'A A\nV V', -45],
        ['multiline', '\n\nA\n\nB\n', 2],
        ['empty', '\n \t', 0],
      ] as const) for (const align of ['left', 'center', 'right'] as const) {
        renderer.clearCache();
        const doc = new Document({width: 640, height: 420});
        const group = doc.layers.add(new LayerGroup({x: 230.25, y: 100.75, opacity: 0.71}));
        group.transform = new AffineTransform(0.9, 0.17, -0.12, 1.1, 230.25, 100.75);
        const layer = group.layers.add(new TextLayer({text, align, direction: align === 'right' ? 'rtl' : 'ltr',
          fontFamily: 'serif', fontSize: 27, fontStyle: 'italic', fontWeight: 'bold',
          letterSpacing: -0.4, wordSpacing: spacing, fontKerning: 'normal', opacity: 0.63, color: '#e7814b'}));
        layer.transform = new AffineTransform(-0.91, 0.22, 0.15, 1.07, 40.3, -0.4);
        layer.styles = new LayerStyle({colorOverlay: {enabled: true, color: '#3355e0', opacity: 0.4},
          dropShadow: {enabled: true, color: '#443366', opacity: 0.65, blur: 7.7, x: -29.25, y: 17.75}});
        if (id === 'multiline') layer.mask = new LayerMask({selection: new MarqueeSelection({shape: 'ellipse', x: -70, y: -10, width: 180, height: 250}), feather: 3, density: 0.7});
        const snapshot = doc.getSnapshot().document;
        for (const options of [{}, {region: {x: 123.25, y: 30.75, width: 380, height: 280}, outputSize: {width: 475, height: 224}}]) {
          const read = async (cache: boolean): Promise<Uint8ClampedArray> => {
            const canvas: HTMLCanvasElement = await renderer.render(snapshot, editor.assetStore, {...options, cache});
            try {return canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;}
            finally {canvas.width = canvas.height = 0;}
          };
          const fresh = await read(false);
          for (const phase of ['cold', 'warm']) {
            const actual = await read(true);
            let max = 0, ink = 0;
            for (let i = 0; i < actual.length; i++) {max = Math.max(max, Math.abs(actual[i] - fresh[i])); if (i % 4 === 3) ink += actual[i];}
            reports.push({id: `${id}-${align}-${options.region ? 'region' : 'full'}-${phase}`, max, ink});
          }
        }
      }
      return reports;
    } finally {renderer.dispose();}
  });
  await info.attach('shadow-region-pixels', {body: JSON.stringify(results), contentType: 'application/json'});
  expect(results).toHaveLength(48);
  for (const result of results) {
    expect(result.max, result.id).toBe(0);
    if (!result.id.startsWith('empty')) expect(result.ink, result.id).toBeGreaterThan(0);
  }
});

test('cold shadow work follows glyph ink rather than the full document surface', async ({page}, info) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const {Document, TextLayer, LayerStyle, editor} = window.luma;
    const {CanvasRenderer} = await import(/* @vite-ignore */ String('/src/engine/renderer.ts'));
    const doc = new Document({width: 1200, height: 900});
    const layer = doc.layers.add(new TextLayer({text: 'Small shadow', x: 80, y: 80, fontSize: 32}));
    layer.styles = new LayerStyle({dropShadow: {enabled: true, blur: 12, x: 2, y: 4, opacity: 0.5}});
    const renderer = new CanvasRenderer(), areas: number[] = [];
    const original = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (this: CanvasRenderingContext2D, ...args: Parameters<typeof original>) {
      if (this.filter.startsWith('blur(')) {
        const source = args[0] as HTMLCanvasElement;
        areas.push(source.width * source.height);
      }
      return original.apply(this, args);
    } as typeof original;
    try {
      const canvas: HTMLCanvasElement = await renderer.render(doc.getSnapshot().document, editor.assetStore);
      const ink = canvas.getContext('2d')!.getImageData(0, 0, 1200, 900).data.some((v, i) => i % 4 === 3 && v > 0);
      canvas.width = canvas.height = 0;
      return {areas, ink, bytes: renderer.cache.byteLength};
    } finally {CanvasRenderingContext2D.prototype.drawImage = original; renderer.dispose();}
  });
  await info.attach('shadow-work-area', {body: JSON.stringify(result), contentType: 'application/json'});
  expect(result.ink).toBe(true);
  expect(result.areas).toHaveLength(1);
  expect(result.areas[0]).toBeLessThan(1200 * 900 / 4);
  expect(result.bytes).toBeLessThan(1200 * 900);
});

test('unavailable native ink metrics retain full shadow pixels', async ({page}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const {Document, TextLayer, LayerStyle, editor} = window.luma;
    const {CanvasRenderer} = await import(/* @vite-ignore */ String('/src/engine/renderer.ts'));
    const renderer = new CanvasRenderer(), doc = new Document({width: 400, height: 200});
    const layer = doc.layers.add(new TextLayer({text: '  fj Ág 🙂', fontFamily: 'serif', fontStyle: 'italic', x: 60, y: 60, fontSize: 28}));
    layer.styles = new LayerStyle({dropShadow: {enabled: true, blur: 8.3, x: -16.25, y: 12.75, opacity: 0.6}});
    const original = CanvasRenderingContext2D.prototype.measureText;
    const read = async (cache: boolean): Promise<Uint8ClampedArray> => {
      const surface = await renderer.render(doc.getSnapshot().document, editor.assetStore, {cache});
      try {return surface.getContext('2d')!.getImageData(0, 0, 400, 200).data;}
      finally {surface.width = surface.height = 0;}
    };
    try {
      const expected = await read(false);
      CanvasRenderingContext2D.prototype.measureText = function(text) {
        const metrics = original.call(this, text);
        return new Proxy(metrics, {get(target, key) {return key === 'actualBoundingBoxRight' ? NaN : Reflect.get(target, key, target);}});
      };
      const cold = await read(true), warm = await read(true);
      return {ink: expected.some((v, i) => i % 4 === 3 && v > 0), equal: [cold, warm].every(data => data.every((v, i) => v === expected[i]))};
    } finally {CanvasRenderingContext2D.prototype.measureText = original; renderer.dispose();}
  });
  expect(result).toEqual({ink: true, equal: true});
});

test('shadow text and font edits invalidate compact pixels and undo restores exact artwork', async ({page}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const {Document, TextLayer, LayerStyle, editor} = window.luma;
    const {CanvasRenderer} = await import(/* @vite-ignore */ String('/src/engine/renderer.ts'));
    const renderer = new CanvasRenderer(), doc = new Document({width: 640, height: 300});
    const layer = doc.layers.add(new TextLayer({text: 'A A', x: 40, y: 30, fontSize: 36}));
    layer.styles = new LayerStyle({dropShadow: {enabled: true, blur: 8, x: 20, y: 15, opacity: 0.5}});
    const read = async (cache: boolean): Promise<Uint8ClampedArray> => {
      const surface = await renderer.render(doc.getSnapshot().document, editor.assetStore, {cache});
      try {return surface.getContext('2d')!.getImageData(0, 0, 640, 300).data;}
      finally {surface.width = surface.height = 0;}
    };
    try {
      const before = await read(true), json = JSON.stringify(doc.toJSON()), history = doc.getSnapshot().past.length;
      doc.transaction('Edit shadow type', () => {layer.text = 'WW WWW\nשָׁלוֹם 🙂'; layer.fontFamily = 'serif'; layer.fontStyle = 'italic'; layer.wordSpacing = 9;});
      const after = await read(true), reference = await read(false);
      doc.undo();
      const restored = await read(true);
      return {changed: after.some((v, i) => v !== before[i]), equal: after.every((v, i) => v === reference[i]),
        restored: restored.every((v, i) => v === before[i]), model: JSON.stringify(doc.toJSON()) === json, history: doc.getSnapshot().past.length === history};
    } finally {renderer.dispose();}
  });
  expect(result).toEqual({changed: true, equal: true, restored: true, model: true, history: true});
});

test('a loaded font refreshes shadow ink without changing model or history', async ({page}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const {editor, TextLayer, LayerStyle} = window.luma;
    const doc = editor.newDocument({width: 640, height: 240});
    const layer = doc.layers.add(new TextLayer({text: 'iiii WWWW fj', fontFamily: 'Canoli Shadow Font Test', fontSize: 32, x: 60, y: 60}));
    layer.styles = new LayerStyle({dropShadow: {enabled: true, blur: 9, x: -20, y: 15, opacity: 0.6}});
    doc.selectedLayer = layer;
    const read = async (cache: boolean) => {
      const surface = await editor.renderer.render(doc.getSnapshot().document, editor.assetStore, {cache});
      try {return [...surface.getContext('2d')!.getImageData(0, 0, 640, 240).data];}
      finally {surface.width = surface.height = 0;}
    };
    const before = JSON.stringify(doc.toJSON()), history = doc.getSnapshot().past.length;
    const fallback = await read(true);
    const face = new FontFace('Canoli Shadow Font Test', 'url(/node_modules/@fontsource/dm-mono/files/dm-mono-latin-400-normal.woff2)');
    const loaded = new Promise<void>(resolve => document.fonts.addEventListener('loadingdone', () => resolve(), {once: true}));
    document.fonts.add(face);
    await document.fonts.load('32px "Canoli Shadow Font Test"'); await loaded;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const cached = await read(true), fresh = await read(false);
    return {changed: cached.some((v, i) => v !== fallback[i]), equal: cached.every((v, i) => v === fresh[i]),
      model: JSON.stringify(doc.toJSON()) === before, history: doc.getSnapshot().past.length - history};
  });
  expect(result).toEqual({changed: true, equal: true, model: true, history: 0});
});
