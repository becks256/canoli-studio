import { test, expect } from '@playwright/test';

test('a newer document cancels cold replay and presents without waiting for obsolete pixels', async ({ page }) => {
  const cancelEnabled = process.env.LUMA_CANCEL_BASELINE !== '1';
  await page.goto('/');
  await page.getByRole('button', { name: 'Move tool (V)', exact: true }).click();
  await page.evaluate(async (cancelEnabled) => {
    await document.fonts.ready;
    const { editor: e, PaintLayer, BrushStroke, PaintFill } = window.luma;
    const state = { started: 0, changed: 0, aborted: false, completed: false, presented: 0, pixel: [] as number[], error: '' };
    (window as any).cancellationResult = state;
    const prepare = e.renderer.prepareViewport.bind(e.renderer);
    e.renderer.prepareViewport = async (doc, assets, options) => {
      const heavy = doc.name === 'Obsolete paint';
      if (heavy) {
        state.started = performance.now();
        setTimeout(() => {
          state.changed = performance.now();
          e.newDocument({ name: 'Latest document', width: 698, height: 396 });
          const layer = e.document.layers.add(new PaintLayer());
          layer.strokes.add(new PaintFill({ bounds: { x: 0, y: 0, width: 698, height: 396 }, color: '#207040' }));
        }, 0);
      }
      try {
        const frame = await prepare(doc, assets, cancelEnabled ? options : { ...options, isCancelled: undefined });
        if (heavy) state.completed = true;
        if (doc.name === 'Latest document' && doc.children.length) {
          const present = frame.present.bind(frame);
          frame.present = canvas => {
            present(canvas);
            state.presented = performance.now();
            state.pixel = [...canvas.getContext('2d')!.getImageData(20,20,1,1).data];
          };
        }
        return frame;
      } catch (error) {
        if (heavy) {
          state.aborted = error instanceof DOMException && error.name === 'AbortError';
          state.error = error instanceof Error ? error.message : String(error);
        }
        throw error;
      }
    };
    e.newDocument({ name: 'Obsolete paint', width: 698, height: 396 });
    const layer = e.document.layers.add(new PaintLayer());
    layer.strokes.add(new BrushStroke({ points: Array.from({ length: 1200 }, (_, i) => ({ x: i % 2 ? 680 : 10, y: 10 + (i % 120) * 3 })), size: 24, hardness: .5, color: '#5588aa', opacity: .5 }));
  }, cancelEnabled);
  await expect.poll(() => page.evaluate(() => (window as any).cancellationResult.presented)).toBeGreaterThan(0);
  const result = await page.evaluate(() => (window as any).cancellationResult);
  console.log('render-cancellation', JSON.stringify({ cancelEnabled, ...result, latestMs: result.presented - result.changed }));
  expect(result.aborted).toBe(cancelEnabled);
  expect(result.completed).toBe(!cancelEnabled);
  expect(result.pixel).toEqual([32,112,64,255]);
  await expect(page.getByText('Render superseded.', { exact: true })).toHaveCount(0);
});

