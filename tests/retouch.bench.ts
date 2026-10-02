import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { cpus, platform, arch } from "node:os";

test("production healing pipeline benchmark", async ({
  page,
  browser,
}, info) => {
  await page.goto("/");
  await page.waitForFunction(() => !!window.luma?.editor);
  const measurements = await page.evaluate(async () => {
    const editor = window.luma.editor;
    const NativeWorker = window.Worker;
    let phases: Record<string, number> = {};
    window.Worker = class extends NativeWorker {
      private starts = new Map<number, { start: number; phase: string }>();
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener("message", (event) => {
          const pending = this.starts.get(event.data.id);
          if (!pending) return;
          this.starts.delete(event.data.id);
          phases[pending.phase] =
            (phases[pending.phase] ?? 0) + performance.now() - pending.start;
        });
      }
      postMessage(
        message: any,
        transfer: Transferable[] | StructuredSerializeOptions = [],
      ) {
        if (message.id)
          this.starts.set(message.id, {
            start: performance.now(),
            phase: message.donorSearch
              ? "donorSearch"
              : message.poisson
                ? "poissonSolve"
                : "otherWorkerRequests",
          });
        if (Array.isArray(transfer)) super.postMessage(message, transfer);
        else super.postMessage(message, transfer);
      }
    } as typeof Worker;
    const render = editor.renderer.render.bind(editor.renderer);
    editor.renderer.render = async (...args: Parameters<typeof render>) => {
      const start = performance.now();
      try {
        return await render(...args);
      } finally {
        phases.renderSampling =
          (phases.renderSampling ?? 0) + performance.now() - start;
      }
    };
    const results = [];
    try {
      for (const texture of ["flat", "periodic"] as const)
        for (const size of [16, 32, 64, 128]) {
          const edge = size * 4,
            center = edge / 2;
          editor.newDocument({ width: edge, height: edge });
          const canvas = new OffscreenCanvas(edge, edge),
            context = canvas.getContext("2d")!;
          const expected = context.createImageData(edge, edge);
          for (let y = 0; y < edge; y++)
            for (let x = 0; x < edge; x++) {
              const value =
                texture === "flat" ? 100 : 100 + (x % 8) * 2 + (y % 8) * 3;
              expected.data.set([value, value, value, 255], (y * edge + x) * 4);
            }
          context.putImageData(expected, 0, 0);
          context.fillStyle = "#ff0000";
          context.fillRect(center - 1, center - 1, 3, 3);
          const blob = await canvas.convertToBlob({ type: "image/png" });
          await editor.importImage(
            new File([blob], "benchmark.png", { type: "image/png" }),
          );
          const source = editor.assetStore.values()[0];
          const brush = new window.luma.BrushStroke({
            points: [{ x: center, y: center, pressure: 1 }],
            size,
            hardness: 1,
            flow: 1,
            opacity: 1,
            pressureSize: false,
            pressureOpacity: false,
          });
          const samples = [];
          for (let iteration = -1; iteration < 3; iteration++) {
            phases = {};
            const history = editor.document.getSnapshot().past.length;
            const start = performance.now();
            await editor.healStroke(
              brush,
              { mode: "all-layers" },
              { mode: "source" },
              size,
            );
            const totalMs = performance.now() - start,
              measuredPhases = { ...phases };
            const surface = await render(
              editor.document.toJSON(),
              editor.assetStore,
              { cache: false, readback: true },
            );
            const actual = surface
              .getContext("2d")!
              .getImageData(0, 0, edge, edge).data;
            surface.width = surface.height = 0;
            if (
              !actual.every(
                (value, index) =>
                  Math.abs(value - expected.data[index]) <=
                  (index % 4 === 3 ? 0 : 1),
              ) ||
              (source.blob !== blob &&
                (await source.blob.text()) !== (await blob.text())) ||
              editor.document.getSnapshot().past.length !== history + 1
            )
              throw new Error("Healing benchmark correctness check failed.");
            editor.document.undo();
            if (editor.document.layers.length !== 1)
              throw new Error("Healing benchmark undo failed.");
            if (iteration >= 0)
              samples.push({ totalMs, phasesMs: measuredPhases });
          }
          results.push({
            texture,
            brushDiameter: size,
            imageEdge: edge,
            searchRadius: size,
            samples,
          });
        }
      return results;
    } finally {
      window.Worker = NativeWorker;
      editor.renderer.render = render;
    }
  });
  const results = measurements.map((item) => {
    const values = item.samples
      .map((sample) => sample.totalMs)
      .sort((a, b) => a - b);
    return { ...item, medianMs: values[1], meets50ms: values[1] <= 50 };
  });
  expect(results).toHaveLength(8);
  const report = {
    measuredAt: new Date().toISOString(),
    browser: browser.version(),
    host: { cpu: cpus()[0]?.model, platform: platform(), arch: arch() },
    fixture:
      "Flat gray and periodic 8px texture images, central 3x3 red blemish, one hard circular brush, all-layer sampling, every output pixel checked against clean reference (RGB tolerance 1/255, exact alpha); one warm-up then three samples per size.",
    scope:
      "Production host healing call including fresh worker startup, brush coverage, native sampling, search, solve, PNG encoding/decoding, installation and history commit. Validation/render/undo excluded from timed interval.",
    limitations: [
      "Flat and periodic synthetic contexts are not a representative real-photo quality evaluation.",
      "Phase durations are round-trip wall time and may overlap; do not sum them.",
      "Warm browser/OS caches; dedicated numerical worker is new for each stroke.",
      "128px maximum measured diameter; the entire under-256px performance gate is not established.",
    ],
    results,
  };
  const path = info.outputPath("healing-pipeline.json");
  await writeFile(path, JSON.stringify(report, null, 2));
  await info.attach("healing-pipeline", {
    path,
    contentType: "application/json",
  });
  console.log(
    JSON.stringify(
      results.map(({ texture, brushDiameter, medianMs, meets50ms }) => ({
        texture,
        brushDiameter,
        medianMs,
        meets50ms,
      })),
    ),
  );
});
