import { test, expect } from "@playwright/test";

for (const { size, retained } of [{ size: 800, retained: 0 }, { size: 2000, retained: 0 }, { size: 2000, retained: 16 }]) test(`filter-mask brush on ${size}px smart filter stack with ${retained} strokes records live response`, async ({ page }, info) => {
  await page.goto("/");
  await page.evaluate(async ({ size, retained }) => {
    const { editor, LayerMask, SmartToneFilter, GaussianBlurFilter, UnsharpMaskFilter, BrushStroke } = window.luma;
    editor.newDocument({ width: size, height: size * 0.75 });
    const canvas = new OffscreenCanvas(size, size * 0.75), context = canvas.getContext("2d")!;
    context.fillStyle = "#ff0000"; context.fillRect(0, 0, canvas.width, canvas.height);
    const raster = await editor.importImage(new File([await canvas.convertToBlob()], "filter-mask.png", { type: "image/png" }));
    const smart = raster.convertToSmartObject();
    smart.setFilters([new GaussianBlurFilter({ sigma: 2 }), new UnsharpMaskFilter({ sigma: 1, amount: 0.2 }), new SmartToneFilter({ saturation: -100 })]);
    smart.filterMask = new LayerMask({ base: 1, strokes: Array.from({ length: retained }, (_, i) => ({
      mode: "hide" as const,
      stroke: new BrushStroke({ size: 30, opacity: 0.1, hardness: 0.5,
        points: Array.from({ length: 200 }, (_, j) => ({ x: size * (0.1 + j * 0.004), y: size * (0.25 + i * 0.005), pressure: 1 })) }),
    })) });
    editor.document.selectedLayer = smart;
    editor.tools.configure({ size: 30, hardness: 1, opacity: 1, flow: 1, smoothing: 0, pressureSize: false, pressureOpacity: false });
  }, { size, retained });
  await page.getByRole("button", { name: "Brush tool (B)", exact: true }).click();
  await page.getByRole("combobox", { name: "Paint target", exact: true }).selectOption("filter-mask-hide");
  await page.getByRole("button", { name: "Brush tool (B)", exact: true }).click();
  await expect(page.locator("footer .status-dot.working")).toHaveCount(0);
  await page.evaluate(() => {
    const editor = window.luma.editor;
    const state = { beforeMask: editor.renderer.maskDiagnostics, samples: [] as number[], preparation: [] as number[], phases: [] as { method: string; ms: number }[], longTasks: [] as number[], input: 0, revision: editor.document.getSnapshot().revision };
    (window as any).filterMaskTiming = state;
    const processor = Object.getPrototypeOf(editor.renderer.processor);
    for (const method of ["spatialFilter", "process", "mixFilteredOwned"]) {
      const original = processor[method];
      processor[method] = async function (...args: unknown[]) {
        const start = performance.now();
        try { return await original.apply(this, args); }
        finally { state.phases.push({ method, ms: performance.now() - start }); }
      };
    }
    const move = editor.tools.move.bind(editor.tools);
    editor.tools.move = (...args) => { state.input = performance.now(); return move(...args); };
    const prepare = editor.renderer.prepareViewport.bind(editor.renderer);
    editor.renderer.prepareViewport = async (...args) => {
      const input = state.input, drawing = editor.tools.getSnapshot().drawing, start = performance.now();
      const frame = await prepare(...args), present = frame.present.bind(frame);
      if (input && drawing) state.preparation.push(performance.now() - start);
      frame.present = canvas => {
        present(canvas);
        if (input && drawing) state.samples.push(performance.now() - input);
      };
      return frame;
    };
    new PerformanceObserver(list => { for (const entry of list.getEntries()) state.longTasks.push(entry.duration); }).observe({ type: "longtask" });
  });
  const profiler = process.env.LUMA_PROFILE ? await page.context().newCDPSession(page) : undefined;
  if (profiler) { await profiler.send("Profiler.enable"); await profiler.send("Profiler.start"); }
  const box = (await page.locator(".canvas-wrap").boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.4);
  await page.mouse.down();
  for (let i = 1; i <= 25; i++) {
    await page.mouse.move(box.x + box.width * (0.2 + i * 0.02), box.y + box.height * 0.4);
    await page.waitForTimeout(16);
  }
  const during = await page.evaluate(() => window.luma.editor.document.getSnapshot().revision);
  await page.mouse.up();
  await expect(page.locator("footer .status-dot.working")).toHaveCount(0);
  const result = await page.evaluate(() => {
    const editor = window.luma.editor, state = (window as any).filterMaskTiming;
    const mask = (editor.document.selectedLayer as InstanceType<typeof window.luma.SmartObjectLayer>).filterMask!.toJSON();
    return { ...state, afterMask: editor.renderer.maskDiagnostics, after: editor.document.getSnapshot().revision, strokes: mask.strokes?.length };
  });
  if (profiler) {
    const { profile } = await profiler.send("Profiler.stop");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(info.outputPath("filter-mask.cpuprofile"), JSON.stringify(profile));
    await profiler.detach();
  }
  expect(during).toBe(result.revision);
  expect(result.after).toBe(result.revision + 1);
  expect(result.strokes).toBe(retained + 1);
  console.log("filter-mask-latency", JSON.stringify({ size, retained, ...result }));
  expect(result.samples.length).toBeGreaterThan(5);
  await info.attach("filter-mask-latency", { body: JSON.stringify(result), contentType: "application/json" });
});
