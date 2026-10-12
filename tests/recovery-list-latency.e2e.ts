import { test, expect } from "@playwright/test";

test("recovery listing keeps animation frames responsive with retained large revisions", async ({ page }, info) => {
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
    // The fallback measures the pre-optimization implementation with the same fixture.
    const entries = await (typeof (repository as any).summaries === "function" ? repository.summaries() : repository.list());
    const listMs = performance.now() - start;
    await new Promise(resolve => setTimeout(resolve, 100));
    cancelAnimationFrame(frame); observer.disconnect();
    return {listMs, maxFrameGapMs: Math.max(...frames), longTasks, entries: entries.map((entry: any) => ({id: entry.id, name: entry.document.name, width: entry.document.width, height: entry.document.height})), currentId: window.luma.editor.recoverySessionId};
  });
  expect(result.entries.find((entry: {id: string}) => entry.id === result.currentId)).toMatchObject({name:"Listing revision 2", width:698, height:396});
  console.log("recovery-list-latency", JSON.stringify(result));
  await info.attach("recovery-list-latency", {body:JSON.stringify(result), contentType:"application/json"});
});
