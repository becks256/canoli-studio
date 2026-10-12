import { test, expect } from "@playwright/test";

for (const points of [1000, 4000]) test(`workspace autosave with ${64 * points} points measures transport and input`, async ({ page }, info) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Move tool (V)", exact: true }).click();
  await page.evaluate(async points => {
    const { editor, PaintLayer, BrushStroke } = window.luma;
    editor.newDocument({ width: 698, height: 396 });
    const layer = new PaintLayer({ visible: false });
    for (let i = 0; i < 64; i++) layer.strokes.add(new BrushStroke({
      points: Array.from({ length: points }, (_, j) => ({ x: j % 698, y: i * 5, pressure: 1 })),
    }));
    editor.document.layers.add(layer);
    await editor.recovery.flush();
    await editor.workspaceAutosave.flush();
  }, points);
  const result = await page.getByRole("button", { name: "Pencil tool (N)", exact: true }).evaluate(async button => {
    const editor = window.luma.editor;
    for (let i = 0; i < 4; i++) editor.document.name = `Autosave revision ${i}`;
    await editor.recovery.flush();
    const tasks: { start: number; duration: number }[] = [], posts: number[] = [];
    const observer = new PerformanceObserver(list => { for (const e of list.getEntries()) tasks.push({ start: e.startTime, duration: e.duration }); });
    observer.observe({ type: "longtask" });
    const original = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message: unknown, options?: Transferable[] | StructuredSerializeOptions) {
      const start = performance.now();
      try {
        if (Array.isArray(options)) return original.call(this, message, { transfer: options });
        return original.call(this, message, options);
      }
      finally { posts.push(performance.now() - start); }
    };
    const start = performance.now();
    let done = false;
    const input = new Promise<{ ms: number; beforeSave: boolean; selected: boolean }>(resolve => setTimeout(() => {
      (button as HTMLButtonElement).click();
      requestAnimationFrame(() => resolve({ ms: performance.now() - start, beforeSave: !done, selected: button.getAttribute("aria-pressed") === "true" }));
    }, 0));
    let saveMs: number;
    try {
      await editor.workspaceAutosave.flush();
      done = true;
      saveMs = performance.now() - start;
    } finally { Worker.prototype.postMessage = original; }
    const control = await input, end = performance.now();
    await new Promise(resolve => setTimeout(resolve, 100));
    observer.disconnect();
    const saved = await editor.workspaceAutosave.load();
    const entry = saved!.documents[saved!.activeIndex];
    return { saveMs, control, posts, longTasks: tasks.filter(t => t.start + t.duration > start && t.start < end), savedName: entry.name, bytes: entry.project.size, history: editor.document.getSnapshot().past.length };
  });
  expect(result.savedName).toBe("Autosave revision 3");
  expect(result.control.selected).toBe(true);
  expect(result.bytes).toBeGreaterThan(0);
  expect(result.posts.length).toBeGreaterThan(0);
  expect(result.control.beforeSave).toBe(true);
  expect(result.history).toBeGreaterThanOrEqual(5);
  console.log("workspace-save-latency", JSON.stringify({ points: 64 * points, ...result }));
  await info.attach("workspace-save-latency", { body: JSON.stringify(result), contentType: "application/json" });
});
