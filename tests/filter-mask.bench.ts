import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { cpus, platform, arch, totalmem } from "node:os";

test("production filter-mask update benchmark", async ({
  page,
  browser,
}, info) => {
  await page.addInitScript(() => {
    const counters = {
      spatial: 0,
      mix: 0,
      feather: 0,
      spatialMs: 0,
      mixMs: 0,
      featherMs: 0,
    };
    Object.assign(window, { filterBenchmarkCounters: counters });
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      private requests = new Map<
        number,
        { kind: "spatialMs" | "mixMs" | "featherMs"; start: number }
      >();
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener("message", (event) => {
          const request = this.requests.get(event.data.id);
          if (!request) return;
          this.requests.delete(event.data.id);
          counters[request.kind] += performance.now() - request.start;
        });
      }
      postMessage(
        message: any,
        transfer: Transferable[] | StructuredSerializeOptions = [],
      ) {
        if (message.spatialFilter) counters.spatial++;
        if (message.filteredMix) counters.mix++;
        if (message.feather) counters.feather++;
        const kind = message.spatialFilter
          ? "spatialMs"
          : message.filteredMix
            ? "mixMs"
            : message.feather
              ? "featherMs"
              : undefined;
        if (kind)
          this.requests.set(message.id, { kind, start: performance.now() });
        if (Array.isArray(transfer)) super.postMessage(message, transfer);
        else super.postMessage(message, transfer);
      }
    } as typeof Worker;
  });
  await page.goto("/");
  await page.waitForFunction(() => !!window.luma?.editor);
  const measurements = await page.evaluate(async () => {
    const {
      editor,
      Document,
      RasterLayer,
      GaussianBlurFilter,
      UnsharpMaskFilter,
      LayerMask,
      BrushStroke,
    } = window.luma;
    const cases = [
      {
        name: "512-square-two-filters",
        width: 512,
        height: 512,
        region: { x: 0, y: 0, width: 512, height: 512 },
        output: { width: 512, height: 512 },
        count: 2,
      },
      {
        name: "2048-fit-four-filters",
        width: 2048,
        height: 2048,
        region: { x: 0, y: 0, width: 2048, height: 2048 },
        output: { width: 1024, height: 1024 },
        count: 4,
      },
      ...[0, 12].map((feather) => ({
        name: `2048-dense-feather-${feather}`,
        width: 2048,
        height: 2048,
        region: { x: 0, y: 0, width: 2048, height: 2048 },
        output: { width: 1024, height: 1024 },
        count: 4,
        dense: true,
        feather,
      })),
      ...[0, 12].map((feather) => ({
        name: `2048-full-frame-feather-${feather}`,
        width: 2048,
        height: 2048,
        region: { x: 0, y: 0, width: 2048, height: 2048 },
        output: { width: 1024, height: 1024 },
        count: 4,
        dense: true,
        feather,
        fullFrame: true,
      })),
      {
        name: "50mp-native-crop-four-filters",
        width: 10000,
        height: 5000,
        region: { x: 4096, y: 2048, width: 1024, height: 768 },
        output: { width: 1024, height: 768 },
        count: 4,
      },
    ];
    const counters = (
      window as unknown as {
        filterBenchmarkCounters: {
          spatial: number;
          mix: number;
          feather: number;
          spatialMs: number;
          mixMs: number;
          featherMs: number;
        };
      }
    ).filterBenchmarkCounters;
    const results = [];
    for (const fixture of cases) {
      editor.renderer.clearCache();
      const source = new OffscreenCanvas(fixture.width, fixture.height),
        c = source.getContext("2d")!;
      c.fillStyle = "#d76b34";
      c.fillRect(0, 0, fixture.width, fixture.height);
      for (let y = 0; y < fixture.height; y += 128) {
        c.fillStyle = y % 256 ? "#20556b" : "#91c084";
        c.fillRect(0, y, fixture.width, 48);
      }
      const blob = await source.convertToBlob();
      source.width = source.height = 1;
      const asset = await editor.assetStore.add(
        blob,
        fixture.name,
        undefined,
        false,
      );
      const hash = await crypto.subtle.digest(
        "SHA-256",
        await blob.arrayBuffer(),
      );
      const doc = new Document({
        width: fixture.width,
        height: fixture.height,
      });
      const layer = doc.layers
        .add(
          new RasterLayer({
            assetId: asset.id,
            width: fixture.width,
            height: fixture.height,
          }),
        )
        .convertToSmartObject();
      layer.setFilters(
        Array.from({ length: fixture.count }, (_, i) =>
          i % 2
            ? new UnsharpMaskFilter({ sigma: 3, amount: 0.5 })
            : new GaussianBlurFilter({ sigma: 3 }),
        ),
      );
      let mask = new LayerMask({
        base: 1,
        feather: "feather" in fixture ? fixture.feather : 0,
      });
      if ("dense" in fixture && fixture.dense) {
        for (let y = 32; y < fixture.height; y += 128)
          mask = mask.paint(
            new BrushStroke({
              points: [
                { x: 0, y },
                { x: fixture.width, y },
              ],
              size: 80,
              hardness: 0.5,
              pressureSize: false,
            }),
            "hide",
          );
      }
      layer.filterMask = mask;
      const options = {
        region: fixture.region,
        outputSize: fixture.output,
        readback: true,
      };
      async function render(cache: boolean) {
        const before = counters.spatial,
          beforeMix = counters.mix,
          beforeStages = { ...counters };
        const start = performance.now();
        const canvas = await editor.renderer.render(
          doc.toJSON(),
          editor.assetStore,
          { ...options, cache },
        );
        const ms = performance.now() - start;
        return {
          canvas,
          ms,
          filterCalls: counters.spatial - before,
          mixCalls: counters.mix - beforeMix,
          stages: {
            spatialMs: counters.spatialMs - beforeStages.spatialMs,
            mixMs: counters.mixMs - beforeStages.mixMs,
            featherMs: counters.featherMs - beforeStages.featherMs,
            featherCalls: counters.feather - beforeStages.feather,
          },
        };
      }
      const cold = await render(true);
      cold.canvas.width = cold.canvas.height = 0;
      const cachedStages: {
          spatialMs: number;
          mixMs: number;
          featherMs: number;
          featherCalls: number;
        }[] = [],
        uncachedStages: typeof cachedStages = [];
      const cachedMs: number[] = [],
        uncachedMs: number[] = [],
        differences: number[] = [],
        cachedFilterCalls: number[] = [],
        uncachedFilterCalls: number[] = [],
        cachedMixCalls: number[] = [],
        uncachedMixCalls: number[] = [];
      for (let i = 0; i < 3; i++) {
        const points =
          "fullFrame" in fixture
            ? Array.from({ length: 4 }, (_, row) => {
                const y = 304 + row * 512 + i * 8;
                return row % 2
                  ? [
                      { x: fixture.width, y },
                      { x: 0, y },
                    ]
                  : [
                      { x: 0, y },
                      { x: fixture.width, y },
                    ];
              }).flat()
            : [{ x: fixture.region.x + 80 + i * 48, y: fixture.region.y + 48 }];
        layer.filterMask = layer.filterMask.paint(
          new BrushStroke({ points, size: 48, hardness: 0.7 }),
          "hide",
        );
        const retained = await render(true),
          reference = await render(false);
        const a = retained.canvas
          .getContext("2d")!
          .getImageData(0, 0, fixture.output.width, fixture.output.height).data;
        const b = reference.canvas
          .getContext("2d")!
          .getImageData(0, 0, fixture.output.width, fixture.output.height).data;
        let difference = 0;
        for (let j = 0; j < a.length; j++)
          difference = Math.max(difference, Math.abs(a[j] - b[j]));
        cachedStages.push(retained.stages);
        uncachedStages.push(reference.stages);
        differences.push(difference);
        cachedMs.push(retained.ms);
        uncachedMs.push(reference.ms);
        cachedFilterCalls.push(retained.filterCalls);
        uncachedFilterCalls.push(reference.filterCalls);
        cachedMixCalls.push(retained.mixCalls);
        uncachedMixCalls.push(reference.mixCalls);
        retained.canvas.width =
          retained.canvas.height =
          reference.canvas.width =
          reference.canvas.height =
            0;
      }
      const median = (values: number[]) => [...values].sort((a, b) => a - b)[1];
      results.push({
        fixture,
        sourceDimensions: [asset.width, asset.height],
        sourceBytes: blob.size,
        sourceHash: [...new Uint8Array(hash)]
          .map((v) => v.toString(16).padStart(2, "0"))
          .join(""),
        coldMs: cold.ms,
        cachedStages,
        uncachedStages,
        cachedMs,
        uncachedMs,
        cachedFilterCalls,
        uncachedFilterCalls,
        cachedMixCalls,
        uncachedMixCalls,
        cachedMedianMs: median(cachedMs),
        uncachedMedianMs: median(uncachedMs),
        maxPixelDifference: Math.max(...differences),
      });
      editor.renderer.clearCache();
      editor.assetStore.remove(asset.id);
    }
    return {
      results,
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
    };
  });
  for (const item of measurements.results) {
    expect(item.maxPixelDifference).toBe(0);
    expect(item.sourceDimensions).toEqual([
      item.fixture.width,
      item.fixture.height,
    ]);
    if ("dense" in item.fixture)
      expect(item.cachedMixCalls.every((calls) => calls > 0)).toBe(true);
    if ("fullFrame" in item.fixture)
      expect(item.cachedMixCalls).toEqual([16, 16, 16]);
  }
  const report = {
    schemaVersion: 1,
    measuredAt: new Date().toISOString(),
    browser: browser.version(),
    host: {
      platform: platform(),
      arch: arch(),
      cpu: cpus()[0]?.model,
      logicalCpus: cpus().length,
      totalMemoryBytes: totalmem(),
    },
    ...measurements,
    limitations: [
      "Worker stage timings are host round trips, including queueing/transfer/scheduling, not isolated WASM CPU time.",
      "Synthetic stripe corpus; not photo-quality evaluation.",
      "Production renderer timings exclude pointer dispatch, React, presentation and readback verification.",
      "Three paired samples per case; cached measurement always precedes uncached.",
      "50 MP case samples a native crop, not fit-to-window or full-document export.",
      "Shared headless host; not a hardware-independent latency guarantee.",
    ],
  };
  const path = info.outputPath("filter-mask-benchmark.json");
  await writeFile(path, JSON.stringify(report, null, 2));
  await info.attach("filter-mask-benchmark", {
    path,
    contentType: "application/json",
  });
  console.log(
    JSON.stringify(
      measurements.results.map(
        ({ fixture, cachedMedianMs, uncachedMedianMs }) => ({
          name: fixture.name,
          cachedMedianMs,
          uncachedMedianMs,
        }),
      ),
    ),
  );
});
