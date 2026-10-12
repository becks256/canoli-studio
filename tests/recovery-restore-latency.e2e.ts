import { test, expect } from "@playwright/test";

test("recovery preparation keeps animation frames responsive with retained large revisions", async ({ page }, info) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const { editor: e, PaintLayer, BrushStroke } = window.luma;
    e.newDocument({ width: 698, height: 396 });
    const layer = new PaintLayer({ visible: false });
    for (let i = 0; i < 64; i++) layer.strokes.add(new BrushStroke({points: Array.from({length: 4000}, (_, j) => ({x: j % 698, y: i * 5, pressure: 1}))}));
    e.document.layers.add(layer);
    for (let i = 0; i < 3; i++) {
      e.document.name = `Listing revision ${i}`;
      await e.recovery.flush();
    }
    await e.workspaceAutosave.flush();
  });
  await expect(page.locator("footer .status-dot.working")).toHaveCount(0);
  const result = await page.evaluate(async () => {
    const repository = window.luma.editor.recovery.repository;
    const longTasks: number[] = [], frames: number[] = [];
    const observer = new PerformanceObserver(list => { for (const entry of list.getEntries()) longTasks.push(entry.duration); });
    observer.observe({type: "longtask"});
    let last = performance.now(), frame = 0;
    const tick = () => { const now = performance.now(); frames.push(now - last); last = now; frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick);
    await new Promise(resolve => setTimeout(resolve, 100));
    frames.length = 0; longTasks.length = 0;
    const start = performance.now();
    const restored = await repository.restore(window.luma.editor.recoverySessionId);
    const restoreMs = performance.now() - start;
    await new Promise(resolve => setTimeout(resolve, 100));
    cancelAnimationFrame(frame); observer.disconnect();
    return {restoreMs, maxFrameGapMs: Math.max(...frames), longTasks, skipped: restored.skipped, bytes: restored.blob.size, savedAt: restored.savedAt};
  });
  expect(result.skipped).toBe(0);
  expect(result.bytes).toBeGreaterThan(1000000);
  expect(result.savedAt).toBeGreaterThan(0);
  console.log("recovery-restore-latency", JSON.stringify(result));
  await info.attach("recovery-restore-latency", {body:JSON.stringify(result), contentType:"application/json"});
});
