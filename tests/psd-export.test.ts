import { expect, it } from "vitest";
import { Document, PaintLayer, AdjustmentLayer, LayerGroup, LayerStyle, defaultGradientMapAdjustment } from "../src/dom";
import type { AssetStore } from "../src/core/assets";
import type { DocumentRenderer, RenderOptions } from "../src/engine/renderer";
import { exportPsd } from "../src/engine/psd";
import { getExportCapabilityReport } from "../src/engine/export";
import { parsePsd } from "../src/core/interchange/psd/parser";

if (typeof globalThis.ImageData === "undefined") globalThis.ImageData = class {
  width: number; height: number; data: Uint8ClampedArray;
  constructor(width: number, height: number) { this.width = width; this.height = height; this.data = new Uint8ClampedArray(width * height * 4); }
} as unknown as typeof ImageData;

function fixture() {
  const calls: { x: number; y: number; width: number; height: number }[] = [], canvases: HTMLCanvasElement[] = [];
  const renderer = {
    async render(_document: unknown, _assets: unknown, options: RenderOptions) {
      const region = options.region!; calls.push({ ...region });
      const data = new Uint8ClampedArray(region.width * region.height * 4);
      for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width; x++)
        data.set([(x + region.x) % 256, (y + region.y) % 256, 140, (y + region.y) % 2 ? 128 : 255], (y * region.width + x) * 4);
      const canvas = { width: region.width, height: region.height, getContext: () => ({ getImageData: () => ({ data }) }) } as unknown as HTMLCanvasElement;
      canvases.push(canvas); return canvas;
    }, clearCache() {}, dispose() {},
  } as DocumentRenderer;
  return { renderer, calls, canvases, assets: {} as AssetStore };
}

it("assembles native RLE rows across bounded tiles without changing source state or retaining canvases", async () => {
  const doc = new Document({ width: 2050, height: 130 }); doc.layers.add(new PaintLayer({ name: "Pixels 🎨" }));
  const before = doc.toJSON(), { renderer, assets, calls, canvases } = fixture();
  const progress: number[] = [];
  const blob = await exportPsd(before, assets, renderer, "layers", { onProgress: value => { if (value.fraction !== null) progress.push(value.fraction); } });
  const parsed = parsePsd(await blob.arrayBuffer());
  expect(parsed.header.width).toBe(2050); expect(parsed.header.height).toBe(130);
  expect(parsed.layers[0].name).toBe("Pixels 🎨");
  for (const [x, y] of [[0, 0], [2047, 63], [2048, 64], [2049, 129]]) {
    const index = (y * 2050 + x) * 4;
    expect([...parsed.layers[0].imageData!.data.slice(index, index + 4)]).toEqual([x % 256, y % 256, 140, y % 2 ? 128 : 255]);
    expect(parsed.composite!.data[index + 3]).toBe(y % 2 ? 128 : 255);
  }
  expect(calls.length).toBeGreaterThan(2);
  expect(calls.every(call => call.width <= 2048 && call.height <= 64 && call.width * call.height * 4 <= 1_000_000)).toBe(true);
  expect(canvases.every(canvas => canvas.width === 0 && canvas.height === 0)).toBe(true);
  expect(progress.at(-1)).toBe(1); expect(progress.every((value, i) => i === 0 || value >= progress[i - 1])).toBe(true);
  expect(doc.toJSON()).toEqual(before);
});

it("rejects format limits and aborts between strips, releasing rendered surfaces before returning", async () => {
  const { renderer, assets, calls, canvases } = fixture();
  const tooWide = new Document({ width: 30001, height: 1 });
  await expect(exportPsd(tooWide.toJSON(), assets, renderer)).rejects.toThrow(/PSD supports dimensions/);
  expect(tooWide.width).toBe(30001); expect(calls).toHaveLength(0);
  const doc = new Document({ width: 32, height: 200 }); doc.layers.add(new PaintLayer());
  const abort = new AbortController();
  await expect(exportPsd(doc.toJSON(), assets, renderer, "layers", {
    signal: abort.signal, onProgress: value => { if ((value.fraction ?? 0) > 0) abort.abort(); },
  })).rejects.toMatchObject({ name: "AbortError" });
  expect(calls).toHaveLength(1); expect(canvases[0].width).toBe(0);
  await expect(exportPsd(doc.toJSON(), assets, renderer, "layers", { signal: abort.signal })).rejects.toMatchObject({ name: "AbortError" });
});

it("preflight describes the real dependency merge, group baking and explicit flatten choice", () => {
  const doc = new Document(); doc.layers.add(new PaintLayer());
  const group = doc.layers.add(new LayerGroup({ name: "Isolated" })); group.layers.add(new AdjustmentLayer({ adjustment: defaultGradientMapAdjustment() }));
  const before = getExportCapabilityReport(doc.toJSON(), { format: "psd" });
  expect(before.warnings.some(value => /bottom \d/.test(value))).toBe(false);
  expect(before.warnings.some(value => value.includes("child layers and hierarchy"))).toBe(true);
  const top = doc.layers.add(new PaintLayer({ name: "Blend dependent" }));
  top.styles = new LayerStyle({ blendIf: { enabled: true } });
  const report = getExportCapabilityReport(doc.toJSON(), { format: "psd" });
  expect(report.warnings.some(value => value.includes("bottom 3 top-level layers are merged through “Blend dependent”"))).toBe(true);
  const flat = getExportCapabilityReport(doc.toJSON(), { format: "psd", psdMode: "flatten" });
  expect(flat.warnings.some(value => value.includes("one pixel layer"))).toBe(true);
  expect(flat.featuresPreserved).not.toContain("Layer opacity and blend modes");
});
