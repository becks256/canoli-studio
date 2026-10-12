import { test, expect } from '@playwright/test';

test('direct renders remain independent and explicit cancellation releases temporary canvases', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { CanvasRenderer } = await import(/* @vite-ignore */ String('/src/engine/renderer.ts'));
    const { Document, PaintLayer, BrushStroke, editor: e } = window.luma;
    const doc = new Document({ width: 200, height: 100 });
    const layer = doc.layers.add(new PaintLayer());
    layer.strokes.add(new BrushStroke({ points: Array.from({ length: 600 }, (_, i) => ({ x: i % 2 ? 190 : 10, y: 10 + i % 80 })), size: 20, hardness: .5 }));
    const renderer = new CanvasRenderer();
    const created: HTMLCanvasElement[] = [];
    const create = document.createElement.bind(document);
    document.createElement = ((...args: Parameters<typeof create>) => {
      const element = create(...args);
      if (element instanceof HTMLCanvasElement) created.push(element);
      return element;
    }) as typeof document.createElement;
    let cancelled = false, aborted = false;
    const timer = setTimeout(() => { cancelled = true; }, 0);
    try {
      try { await renderer.render(doc.getSnapshot().document, e.assetStore, { cache: false, isCancelled: () => cancelled }); }
      catch (error) { aborted = error instanceof DOMException && error.name === 'AbortError'; }
      const released = created.every(canvas => canvas.width <= 1 && canvas.height <= 1);
      document.createElement = create;
      const canvas = await renderer.render(doc.getSnapshot().document, e.assetStore, { cache: false });
      const painted = canvas.getContext('2d')!.getImageData(100,50,1,1).data[3] > 0;
      canvas.width = canvas.height = 1;
      return { aborted, released, painted };
    } finally { clearTimeout(timer); document.createElement = create; renderer.dispose(); }
  });
  expect(result).toEqual({ aborted: true, released: true, painted: true });
});
