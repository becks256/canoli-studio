import {expect, test} from '@playwright/test';

test('cold dense text and font replacement bound drawing work while preserving reference pixels', async ({page}, info) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const {Document, TextLayer, editor} = window.luma;
    const {CanvasRenderer} = await import(/* @vite-ignore */ String('/src/engine/renderer.ts'));
    const doc = new Document({width: 800, height: 600});
    doc.transaction('Dense text', () => {
      for (let i = 0; i < 64; i++) doc.layers.add(new TextLayer({
        text: `${i} ${'Native font replacement '.repeat(40)}`,
        x: (i % 8) * 95, y: Math.floor(i / 8) * 60,
        fontFamily: 'serif', fontSize: 16, color: '#315b2a', opacity: 0.63,
      }));
    });
    await document.fonts.ready;
    const renderer = new CanvasRenderer();
    const read = async (cache: boolean): Promise<Uint8ClampedArray> => {
      const canvas = await renderer.render(doc.getSnapshot().document, editor.assetStore, {cache});
      try {return canvas.getContext('2d')!.getImageData(0, 0, 800, 600).data;}
      finally {canvas.width = canvas.height = 0;}
    };
    const reports: {phase: string; max: number; ink: number; areas: number[]}[] = [];
    try {
      for (const phase of ['cold', 'font-replacement', 'undo']) {
        if (phase === 'font-replacement') doc.fonts.replace('serif', 'monospace');
        if (phase === 'undo') {doc.undo(); renderer.clearCache();}
        const expected = await read(false), areas: number[] = [];
        const original = CanvasRenderingContext2D.prototype.fillText;
        let actual: Uint8ClampedArray;
        CanvasRenderingContext2D.prototype.fillText = function (...args) {
          areas.push(this.canvas.width * this.canvas.height);
          return original.apply(this, args);
        };
        try {actual = await read(true);}
        finally {CanvasRenderingContext2D.prototype.fillText = original;}
        let max = 0, ink = 0;
        for (let i = 0; i < actual.length; i++) {
          max = Math.max(max, Math.abs(actual[i] - expected[i]));
          if (i % 4 === 3) ink += actual[i];
        }
        reports.push({phase, max, ink, areas});
        const warm = await read(true);
        if (warm.some((value, i) => value !== expected[i])) throw new Error('Retained text changed reference pixels.');
      }
      return reports;
    } finally {renderer.dispose();}
  });
  await info.attach('text-work-area', {body: JSON.stringify(result), contentType: 'application/json'});
  expect(result).toHaveLength(3);
  for (const report of result) {
    expect(report.max, report.phase).toBe(0);
    expect(report.ink, report.phase).toBeGreaterThan(0);
    expect(report.areas, report.phase).toHaveLength(64);
    expect(report.areas.reduce((sum, area) => sum + area, 0), report.phase).toBeLessThan(64 * 800 * 600 / 10);
  }
});

test('unavailable native ink metrics keep the full plain-text reference path', async ({page}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const {Document, TextLayer, AffineTransform, editor} = window.luma;
    const {CanvasRenderer} = await import(/* @vite-ignore */ String('/src/engine/renderer.ts'));
    const doc = new Document({width: 500, height: 300});
    const layer = doc.layers.add(new TextLayer({text: '  fj Ág j\u0301\nمرحبا שלום 🙂',
      fontFamily: 'serif', fontSize: 27, fontStyle: 'italic', align: 'center',
      x: 200, y: 80, opacity: 0.63, color: '#315b2a'}));
    layer.transform = new AffineTransform(0.91, 0.22, -0.15, 1.07, 0.3, -0.4);
    await document.fonts.ready;
    const renderer = new CanvasRenderer(), areas: number[] = [];
    const measure = CanvasRenderingContext2D.prototype.measureText;
    const fill = CanvasRenderingContext2D.prototype.fillText;
    const read = async (cache: boolean): Promise<Uint8ClampedArray> => {
      const canvas = await renderer.render(doc.getSnapshot().document, editor.assetStore, {cache});
      try {return canvas.getContext('2d')!.getImageData(0, 0, 500, 300).data;}
      finally {canvas.width = canvas.height = 0;}
    };
    try {
      const expected = await read(false);
      CanvasRenderingContext2D.prototype.measureText = function (text) {
        const metrics = measure.call(this, text);
        return new Proxy(metrics, {get(target, key) {
          return key === 'actualBoundingBoxRight' ? NaN : Reflect.get(target, key, target);
        }});
      };
      CanvasRenderingContext2D.prototype.fillText = function (...args) {
        areas.push(this.canvas.width * this.canvas.height);
        return fill.apply(this, args);
      };
      const actual = await read(true);
      return {equal: actual.every((value, i) => value === expected[i]),
        ink: actual.some((value, i) => i % 4 === 3 && value > 0), areas};
    } finally {
      CanvasRenderingContext2D.prototype.measureText = measure;
      CanvasRenderingContext2D.prototype.fillText = fill;
      renderer.dispose();
    }
  });
  expect(result.equal).toBe(true);
  expect(result.ink).toBe(true);
  expect(result.areas).toEqual([500 * 300, 500 * 300]);
});
