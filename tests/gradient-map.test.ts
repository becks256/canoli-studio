import { beforeAll, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { Document, AdjustmentLayer, LayerMask, MarqueeSelection, defaultGradientMapAdjustment } from "../src/dom";
import { gradientMapAdjustmentSchema, type GradientMapAdjustmentData } from "../src/core/gradient-map";
import { validateDocument } from "../src/core/model";
import { parseCommands } from "../src/core/validation";
import { adjustGradientMap } from "../src/engine/gradient-map";
import { instantiateKernel, applyGradientMap, type PixelKernel } from "../src/engine/wasm";
import { RecipeRecorder, executeRecipe } from "../src/ai/recipes";

let kernel: PixelKernel;
beforeAll(async () => { kernel = await instantiateKernel(new Uint8Array(await readFile("public/wasm/pixels.wasm"))); });
const colors: GradientMapAdjustmentData = { kind: "gradient-map", reverse: false, stops: [
  { position: 0, color: "#ff0000" }, { position: 1, color: "#0000ff" },
] };

it("maps known brightness values, interpolates stops, clamps endpoints and preserves alpha", () => {
  const input = new Uint8ClampedArray([0, 0, 0, 0, 128, 128, 128, 128, 255, 255, 255, 255, 255, 0, 0, 1]);
  expect([...adjustGradientMap(input, colors)]).toEqual([255, 0, 0, 0, 127, 0, 128, 128, 0, 0, 255, 255, 201, 0, 54, 1]);
  expect([...adjustGradientMap(input, { ...colors, reverse: true }).slice(0, 4)]).toEqual([0, 0, 255, 0]);
  const partial = { ...colors, stops: [{ position: .25, color: "#123456" }, { position: .75, color: "#ABCDEF" }] };
  const result = adjustGradientMap(input, partial);
  expect([...result.slice(0, 4)]).toEqual([18, 52, 86, 0]);
  expect([...result.slice(8, 12)]).toEqual([171, 205, 239, 255]);
  const gray = adjustGradientMap(new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 64, 0, 0, 255, 128]), defaultGradientMapAdjustment());
  expect([...gray]).toEqual([54, 54, 54, 255, 182, 182, 182, 64, 18, 18, 18, 128]);
});

it("actual WASM agrees with the reference over a seeded corpus, 32 stops, reversal and memory growth", () => {
  const pixels = new Uint8ClampedArray(65536 * 4); let seed = 4327;
  for (let i = 0; i < pixels.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; pixels[i] = seed >>> 24; }
  const original = pixels.slice();
  const many = { ...colors, stops: Array.from({ length: 32 }, (_, i) => ({ position: i / 31, color: i % 2 ? "#fa8132" : "#095aa0" })) };
  for (const settings of [defaultGradientMapAdjustment(), colors, many, { ...colors, stops: [{ position: .2, color: "#112233" }, { position: .8, color: "#fedcba" }] }]) {
    for (const reverse of [false, true]) {
      const options = { ...settings, reverse }, actual = applyGradientMap(kernel, pixels, options), expected = adjustGradientMap(pixels, options);
      expect(actual.findIndex((v, i) => v !== expected[i]), JSON.stringify(options)).toBe(-1);
      for (let i = 3; i < pixels.length; i += 4) if (actual[i] !== pixels[i]) throw new Error("Alpha changed");
    }
  }
  expect(pixels).toEqual(original);
  expect(() => applyGradientMap(kernel, new Uint8ClampedArray(3), colors)).toThrow(/RGBA/);
  expect(applyGradientMap(kernel, new Uint8ClampedArray(), colors)).toHaveLength(0);
});

it("validates the current schema, migrates older documents, isolates settings and shares locks/history/rollback", () => {
  const doc = new Document(), empty = doc.toJSON(), settings = structuredClone(colors);
  const layer = doc.layers.add(new AdjustmentLayer({ adjustment: settings })); settings.stops[0].color = "#123456";
  expect(layer.adjustment).toEqual(colors);
  layer.mask = new LayerMask({ selection: new MarqueeSelection({ shape: "rectangle", x: 0, y: 0, width: 10, height: 10 }) });
  const saved = doc.toJSON(); expect(saved.schemaVersion).toBe(27); expect(Document.fromJSON(saved).toJSON()).toEqual(saved); expect(Document.fromJSON({...saved,schemaVersion:18}).toJSON()).toEqual(saved);
  for (let schemaVersion = 1; schemaVersion <= 18; schemaVersion++) {
    expect(Document.fromJSON({ ...empty, schemaVersion }).toJSON().schemaVersion).toBe(27);
  }
  expect(() => validateDocument({ ...saved, schemaVersion: 17 })).toThrow(/schema version 18/);
  const before = doc.getSnapshot();
  const invalid = [
    { ...colors, stops: [] }, { ...colors, stops: [colors.stops[0]] },
    { ...colors, stops: colors.stops.slice().reverse() }, { ...colors, extra: true },
    { ...colors, reverse: undefined }, { ...colors, stops: [{ position: NaN, color: "#000000" }, colors.stops[1]] },
    { ...colors, stops: [{ position: 0, color: "red" }, colors.stops[1]] },
    { ...colors, stops: [{ position: 0, color: "#ffffff00" }, colors.stops[1]] },
    { ...colors, stops: [{ position: 0, color: "#ffffff", extra: 1 }, colors.stops[1]] },
    { ...colors, stops: colors.stops.map(stop => ({ ...stop, position: .5 })) },
    { ...colors, stops: Array.from({ length: 33 }, (_, i) => ({ position: i / 32, color: "#000000" })) },
  ];
  for (const adjustment of invalid) {
    expect(() => gradientMapAdjustmentSchema.parse(adjustment)).toThrow();
    expect(() => parseCommands([{ type: "layer.update", id: layer.id, patch: { adjustment } }])).toThrow();
    expect(() => { layer.adjustment = adjustment as any; }).toThrow(); expect(doc.getSnapshot()).toBe(before);
  }
  layer.adjustment = { ...colors, reverse: true }; doc.undo(); expect(layer.adjustment).toEqual(colors);
  doc.redo(); expect(layer.adjustment).toEqual({ ...colors, reverse: true });
  const checkpoint = doc.getSnapshot();
  expect(() => doc.transaction("Bad gradient", () => { layer.adjustment = colors; doc.resize(-1, 20); })).toThrow();
  expect(doc.getSnapshot()).toBe(checkpoint);
  layer.locked = true; expect(() => { layer.adjustment = colors; }).toThrow(/lock/i);
});

it("records portable gradient settings for deterministic offline recipe replay", () => {
  const doc = new Document(), recorder = new RecipeRecorder(); recorder.start();
  doc.onCommand((command, before, after) => recorder.recordCommand(command, before, after));
  const layer = doc.layers.add(new AdjustmentLayer({ adjustment: colors })); layer.adjustment = { ...colors, reverse: true };
  const recipe = recorder.stop({ name: "Duotone" }), target = new Document();
  expect(executeRecipe(recipe, target).success).toBe(true);
  expect((target.layers.at(0) as AdjustmentLayer).adjustment).toEqual(layer.adjustment);
  target.undo(); expect(target.layers.length).toBe(0);
});
