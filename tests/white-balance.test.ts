import { beforeAll, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { Document, AdjustmentLayer, LayerMask, MarqueeSelection, defaultWhiteBalanceAdjustment } from "../src/dom";
import { whiteBalanceMatrix, whiteBalanceWhitePoint, whiteBalanceAdjustmentSchema } from "../src/core/white-balance";
import { adjustWhiteBalance } from "../src/engine/white-balance";
import { instantiateKernel, applyWhiteBalance, type PixelKernel } from "../src/engine/wasm";
import { validateDocument } from "../src/core/model";
import { parseCommands } from "../src/core/validation";
import { RecipeRecorder, executeRecipe } from "../src/ai/recipes";

let kernel: PixelKernel;
beforeAll(async () => { kernel = await instantiateKernel(new Uint8Array(await readFile("public/wasm/pixels.wasm"))); });

it("agrees with independent Colour Science whitepoint/Bradford matrices across ranges, tint and polynomial boundaries", async () => {
  const reference = JSON.parse(await readFile("tests/fixtures/white-balance-reference.json", "utf8"));
  expect(reference.cases).toHaveLength(24);
  for (const value of reference.cases) {
    const options = { kind: "white-balance" as const, temperature: value.temperature, tint: value.tint };
    const actual = whiteBalanceMatrix(options).flat(), point = whiteBalanceWhitePoint(options);
    for (let c = 0; c < 3; c++) expect(Math.abs(point[c] - value.whitePoint[c]), JSON.stringify(options)).toBeLessThan(1e-8);
    for (let i = 0; i < 9; i++) expect(Math.abs(actual[i] - value.matrix.flat()[i]), JSON.stringify(options)).toBeLessThan(1e-7);
  }
});

it("neutral settings preserve all bytes and temperature/tint correct gray in the documented directions", () => {
  const pixels = new Uint8ClampedArray([0, 0, 0, 0, 80, 120, 150, 128, 128, 128, 128, 255, 255, 255, 255, 64]);
  expect(adjustWhiteBalance(pixels, defaultWhiteBalanceAdjustment())).toEqual(pixels);
  expect(whiteBalanceMatrix(defaultWhiteBalanceAdjustment())).toEqual([[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
  const gray = new Uint8ClampedArray([128, 128, 128, 255]);
  const warm = adjustWhiteBalance(gray, { kind: "white-balance", temperature: 12000, tint: 0 });
  const cool = adjustWhiteBalance(gray, { kind: "white-balance", temperature: 2856, tint: 0 });
  const magenta = adjustWhiteBalance(gray, { kind: "white-balance", temperature: 6504, tint: 100 });
  const green = adjustWhiteBalance(gray, { kind: "white-balance", temperature: 6504, tint: -100 });
  expect(warm[0]).toBeGreaterThan(warm[2]); expect(cool[2]).toBeGreaterThan(cool[0]);
  expect((magenta[0] + magenta[2]) / 2).toBeGreaterThan(magenta[1]); expect((green[0] + green[2]) / 2).toBeLessThan(green[1]);
});

it("actual WASM matches the JS pixel reference over extrema, alpha, memory growth and immutable caller buffers", () => {
  const source = new Uint8ClampedArray(65536 * 4); let seed = 10491;
  for (let i = 0; i < source.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; source[i] = seed >>> 24; }
  const original = source.slice();
  for (const temperature of [2000, 2856, 4000, 6504, 12000, 25000]) for (const tint of [-100, 0, 100]) {
    const settings = { kind: "white-balance" as const, temperature, tint };
    const actual = applyWhiteBalance(kernel, source, settings), expected = adjustWhiteBalance(source, settings);
    const mismatch = actual.findIndex((value, i) => value !== expected[i]);
    expect(mismatch, JSON.stringify({ settings, mismatch, actual: actual[mismatch], expected: expected[mismatch] })).toBe(-1);
  }
  expect(source).toEqual(original);
  expect(() => applyWhiteBalance(kernel, new Uint8ClampedArray(3), defaultWhiteBalanceAdjustment())).toThrow(/RGBA/);
  expect(applyWhiteBalance(kernel, new Uint8ClampedArray(), defaultWhiteBalanceAdjustment())).toHaveLength(0);
});

it("white balance persists in the current schema, migrates v18 and shares validation, locks, history and rollback", () => {
  const doc = new Document(), empty = doc.toJSON();
  const options = defaultWhiteBalanceAdjustment(), layer = doc.layers.add(new AdjustmentLayer({ adjustment: options })); options.temperature = 25000;
  expect(layer.adjustment).toEqual(defaultWhiteBalanceAdjustment());
  layer.mask = new LayerMask({ selection: new MarqueeSelection({ shape: "rectangle", x: 0, y: 0, width: 10, height: 10 }) });
  const stored = doc.toJSON(); expect(stored.schemaVersion).toBe(39); expect(Document.fromJSON(stored).toJSON()).toEqual(stored);
  expect(() => validateDocument({ ...stored, schemaVersion: 18 })).toThrow(/schema version 19/);
  expect(Document.fromJSON({ ...empty, schemaVersion: 18 }).toJSON()).toEqual(empty);
  const before = doc.getSnapshot();
  for (const adjustment of [{ kind: "white-balance", temperature: 1999, tint: 0 }, { kind: "white-balance", temperature: 25001, tint: 0 },
    { kind: "white-balance", temperature: NaN, tint: 0 }, { kind: "white-balance", temperature: 6504, tint: 101 },
    { kind: "white-balance", temperature: 6504 }, { ...defaultWhiteBalanceAdjustment(), extra: true }]) {
    expect(() => whiteBalanceAdjustmentSchema.parse(adjustment)).toThrow();
    expect(() => parseCommands([{ type: "layer.update", id: layer.id, patch: { adjustment } }])).toThrow();
    expect(() => { layer.adjustment = adjustment as any; }).toThrow(); expect(doc.getSnapshot()).toBe(before);
  }
  layer.adjustment = { kind: "white-balance", temperature: 9000, tint: -30 }; doc.undo(); expect(layer.adjustment).toEqual(defaultWhiteBalanceAdjustment()); doc.redo();
  expect(layer.adjustment).toEqual({ kind: "white-balance", temperature: 9000, tint: -30 });
  const checkpoint = doc.getSnapshot();
  expect(() => doc.transaction("Invalid balance", () => { layer.adjustment = defaultWhiteBalanceAdjustment(); doc.resize(-1, 20); })).toThrow();
  expect(doc.getSnapshot()).toBe(checkpoint); layer.locked = true; expect(() => { layer.adjustment = defaultWhiteBalanceAdjustment(); }).toThrow(/lock/i);
});

it("records portable white balance commands for deterministic offline recipe replay", () => {
  const doc = new Document(), recorder = new RecipeRecorder(); recorder.start();
  doc.onCommand((command, before, after) => recorder.recordCommand(command, before, after));
  const layer = doc.layers.add(new AdjustmentLayer({ adjustment: { kind: "white-balance", temperature: 2856, tint: 20 } }));
  const recipe = recorder.stop({ name: "Balance" }), target = new Document(); expect(executeRecipe(recipe, target).success).toBe(true);
  expect((target.layers.at(0) as AdjustmentLayer).adjustment).toEqual(layer.adjustment); target.undo(); expect(target.layers.length).toBe(0);
});
