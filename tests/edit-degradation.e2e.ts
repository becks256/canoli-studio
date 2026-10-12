import { expect, test } from "@playwright/test";

test("repeated edits share selection data, avoid thumbnail rerenders and keep autosave off the UI thread", async ({ page }, testInfo) => {
  const workers: string[] = [];
  page.on("worker", worker => workers.push(worker.url()));
  await page.goto("/");
  await page.getByRole("button", { name: "Move tool (V)", exact: true }).click();
  await page.evaluate(() => {
    const { editor, PaintLayer, PaintFill, MarqueeSelection } = window.luma;
    editor.newDocument({ width: 500, height: 400 });
    for (let i = 0; i < 8; i++) {
      const layer = editor.document.layers.add(new PaintLayer({ name: `Paint ${i}` }));
      layer.strokes.add(new PaintFill({ bounds: { x: i * 20, y: 20, width: 16, height: 16 }, color: "#ff0000" }));
    }
    editor.document.selection = new MarqueeSelection({ shape: "pixels", x: 0, y: 0, width: 500, height: 400,
      coverage: { width: 500, height: 400, runs: Array.from({ length: 200000 }, (_, i) => i % 2 ? 128 : (i / 2 + 1) * 2) } });
  });
  await expect(page.locator('.pixel-thumb[src^="data:image/png"]')).toHaveCount(8);
  const result = await page.evaluate(async () => {
    const e = window.luma.editor;
    let thumbnails = 0;
    const original = e.pixels.thumbnail.bind(e.pixels);
    e.pixels.thumbnail = (...args) => { thumbnails++; return original(...args); };
    const samples: number[] = [];
    for (let i = 0; i < 25; i++) {
      const start = performance.now(); e.document.name = `Repeated edit ${i}`;
      samples.push(performance.now() - start);
      await new Promise(requestAnimationFrame);
    }
    await new Promise(resolve => setTimeout(resolve, 200));
    const state = e.document.getSnapshot();
    const selectionCopies = new Set([state.document, ...state.past.map(entry => entry.document)]
      .map(document => document.selection).filter(Boolean)).size;
    let frames = 0, done = false;
    const frame = () => { if (!done) { frames++; requestAnimationFrame(frame); } };
    requestAnimationFrame(frame);
    await e.workspaceAutosave.flush(); done = true;
    const saved = e.workspaceAutosave.getSnapshot().status;
    e.document.undo(); const undone = e.document.name;
    e.document.redo();
    return { samples, selectionCopies, thumbnails, frames, undone, redone: e.document.name,
      saved };
  });
  await testInfo.attach("repeated-edit-timings", { body: JSON.stringify(result, null, 2), contentType: "application/json" });
  expect(result.selectionCopies).toBe(1);
  expect(result.thumbnails).toBe(0);
  expect(result.frames).toBeGreaterThan(0);
  expect(workers.some(url => url.includes("project-encoder"))).toBe(true);
  expect(result.saved).toBe("saved");
  expect(result.undone).toBe("Repeated edit 23");
  expect(result.redone).toBe("Repeated edit 24");
});
