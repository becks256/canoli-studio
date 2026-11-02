import { beforeAll, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import {
  Document,
  VectorLayer,
  VectorPath,
  LayerGroup,
  TextLayer,
  AffineTransform,
} from "../src/dom";
import { compileFloatVectorGradient } from "../src/core/float-vector-gradient";
import { renderFloatVector } from "../src/engine/float-vector";
import { FloatPixelProcessor } from "../src/engine/float-pixels";
import { instantiateKernel } from "../src/engine/wasm";
const world = new AffineTransform(),
  area = { x: 0, y: 0, width: 1, height: 1 },
  words = (v: Float32Array) => [
    ...new Uint32Array(v.buffer, v.byteOffset, v.length),
  ];
const stops = [
  { position: 0, color: "#ff0000", opacity: 0.25 },
  { position: 1, color: "#0000ff", opacity: 0.75 },
];
let native: FloatPixelProcessor;
beforeAll(async () => {
  native = new FloatPixelProcessor(
    await instantiateKernel(
      new Uint8Array(await readFile("public/wasm/pixels.wasm")),
    ),
  );
});
const processor = {
  floatComposite: async (
    ...args: Parameters<FloatPixelProcessor["composite"]>
  ) => native.composite(...args),
};

it("linear vector paint interpolates continuous unassociated linear color and alpha, including padding", () => {
  const sample = compileFloatVectorGradient(
    { kind: "linear", start: { x: 0, y: 0 }, end: { x: 8, y: 0 }, stops },
    world,
  );
  expect(sample(4, 9)).toEqual([0.5, 0, 0.5, 0.5]);
  expect(sample(-1, 0)).toEqual([1, 0, 0, 0.25]);
  expect(sample(9, 0)).toEqual([0, 0, 1, 0.75]);
  const opaque = compileFloatVectorGradient(
    {
      kind: "linear",
      start: { x: 0, y: 0 },
      end: { x: 1024, y: 0 },
      stops: [
        { position: 0, color: "#000000" },
        { position: 1, color: "#ffffff" },
      ],
    },
    world,
  );
  expect(opaque(512, 0)).toEqual([0.5, 0.5, 0.5, 1]);
  expect(
    new Set(
      Array.from({ length: 1024 }, (_, x) =>
        Math.fround(opaque(x + 0.5, 0)[0]),
      ),
    ).size,
  ).toBe(1024);
});
it("transparent stops retain unassociated color and duplicate stops preserve authored hard transitions", () => {
  const sample = compileFloatVectorGradient(
    {
      kind: "linear",
      start: { x: 0, y: 0 },
      end: { x: 1, y: 0 },
      stops: [
        { position: 0, color: "#ff0000", opacity: 0 },
        { position: 0.5, color: "#00ff00", opacity: 0.5 },
        { position: 0.5, color: "#0000ff", opacity: 1 },
        { position: 1, color: "#ffffff" },
      ],
    },
    world,
  );
  expect(sample(0.25, 0)).toEqual([0.5, 0.5, 0, 0.25]);
  expect(sample(0.5, 0)).toEqual([0, 0, 1, 1]);
});
it("gradient paint transforms compose after ancestor/layer placement without moving geometry", () => {
  const placed = AffineTransform.translation(7, 11)
      .multiply(AffineTransform.rotation(0.37))
      .multiply(AffineTransform.scale(-2, 0.75)),
    paint = AffineTransform.translation(3, 5).multiply(
      AffineTransform.scale(4, 2),
    );
  const sample = compileFloatVectorGradient(
      {
        kind: "linear",
        start: { x: 0, y: 0 },
        end: { x: 8, y: 0 },
        transform: paint.toJSON(),
        stops,
      },
      placed,
    ),
    p = placed.multiply(paint).point({ x: 4, y: 6 });
  const rgba = sample(p.x, p.y);
  rgba.forEach((v, i) => expect(v).toBeCloseTo([0.5, 0, 0.5, 0.5][i], 14));
});
it("radial gradients select the last nonnegative-radius cone root and retain transparent uncovered sectors", () => {
  const base = {
    kind: "radial" as const,
    start: { x: 0, y: 0, radius: 0 },
    end: { x: 0, y: 0, radius: 8 },
    stops,
  };
  expect(compileFloatVectorGradient(base, world)(4, 0)).toEqual([
    0.5, 0, 0.5, 0.5,
  ]);
  expect(compileFloatVectorGradient(base, world)(1e308, 0)).toEqual([
    0, 0, 1, 0.75,
  ]);
  const shrinking = compileFloatVectorGradient(
    {
      ...base,
      start: { x: 0, y: 0, radius: 8 },
      end: { x: 0, y: 0, radius: 4 },
    },
    world,
  );
  expect(shrinking(6, 0)).toEqual([0.5, 0, 0.5, 0.5]);
  expect(shrinking(0, 0)).toEqual([0, 0, 1, 0.75]);
  const cone = compileFloatVectorGradient(
    { ...base, end: { x: 8, y: 0, radius: 4 } },
    world,
  );
  expect(cone(2, 0)).toEqual([0.5, 0, 0.5, 0.5]);
  expect(cone(-1, 0)).toEqual([0, 0, 0, 0]);
  expect(cone(0, 8)).toEqual([0, 0, 0, 0]);
  const tangent = compileFloatVectorGradient(
    { ...base, end: { x: 8, y: 0, radius: 8 } },
    world,
  );
  expect(tangent(0, 0)).toEqual([0, 0, 1, 0.75]);
  expect(tangent(4, 0)).toEqual([0.75, 0, 0.25, 0.375]);
});
it("editable native paths share float conversion, nested locks, strict transactions and exact Undo/reopen", () => {
  const doc = new Document(),
    group = doc.layers.add(new LayerGroup()),
    layer = group.layers.add(new VectorLayer()),
    path = layer.paths.add(
      VectorPath.rectangle({ x: 0, y: 0, width: 16, height: 8 }),
    );
  path.fillGradient = {
    kind: "linear",
    start: { x: 0, y: 0 },
    end: { x: 8, y: 0 },
    stops,
  };
  const byte = doc.toJSON();
  doc.convertToFloat();
  const converted = doc.toJSON();
  doc.undo();
  expect(doc.toJSON()).toEqual(byte);
  doc.redo();
  expect(doc.toJSON()).toEqual(converted);
  doc.transaction("Native vectors", () => {
    path.fill = "#208040";
    path.strokeDashArray = [2, 1];
    layer.opacity = 0.64123;
  });
  const after = doc.toJSON();
  expect(Document.fromJSON(after).toJSON()).toEqual(after);
  doc.undo();
  expect(doc.toJSON()).toEqual(converted);
  doc.redo();
  expect(doc.toJSON()).toEqual(after);
  group.locked = true;
  expect(() => (path.fill = "#ffffff")).toThrow(/lock/i);
  group.locked = false;
  const saved = doc.toJSON();
  expect(() =>
    doc.transaction("Invalid mixed edit", () => {
      path.fill = "#000000";
      doc.layers.add(new TextLayer());
    }),
  ).toThrow("declared original font");
  expect(doc.toJSON()).toEqual(saved);
});
it("native WASM composes each path fill then stroke in authored order without byte color staging", async () => {
  const path = VectorPath.rectangle({ x: 0, y: 0, width: 2, height: 2 }, 0, {
      fill: "#ff0000",
      stroke: "#0000ff",
      strokeWidth: 1,
    }).toJSON(),
    coverage = async (_path: unknown, phase: string) =>
      new Float32Array([phase === "fill" ? 0.375 : 0.625]);
  const result = await renderFloatVector(
      { paths: [path] },
      area,
      world,
      processor,
      () => {},
      coverage,
    ),
    a = 0.625 + 0.375 * 0.375,
    expected = new Float32Array([(0.375 * 0.375) / a, 0, 0.625 / a, a]);
  expect(words(result)).toEqual(words(expected));
});
it("gradient stop alpha and scalar coverage multiply once before native source-over", async () => {
  const path = VectorPath.rectangle({ x: 0, y: 0, width: 2, height: 2 }, 0, {
      fillGradient: {
        kind: "linear",
        start: { x: 0, y: 0 },
        end: { x: 1, y: 0 },
        stops,
      },
      stroke: null,
    }).toJSON(),
    mask = Math.fround(17 / 255);
  const result = await renderFloatVector(
    { paths: [path] },
    area,
    world,
    processor,
    () => {},
    async () => new Float32Array([mask]),
  );
  expect(words(result)).toEqual(
    words(new Float32Array([0.5, 0, 0.5, 0.5 * mask])),
  );
});
it("native vector paint removes extreme translation before adding pixel-center offsets", async () => {
  const origin = 2 ** 52 + 32,
    path = VectorPath.rectangle({ x: 0, y: 0, width: 8, height: 8 }, 0, {
      stroke: null,
      fillGradient: {
        kind: "linear",
        start: { x: 0, y: 0 },
        end: { x: 8, y: 0 },
        stops,
      },
    }).toJSON();
  const result = await renderFloatVector(
    { paths: [path] },
    { x: origin + 2, y: 0, width: 1, height: 1 },
    AffineTransform.translation(origin, 0),
    processor,
    () => {},
    async () => new Float32Array([1]),
  );
  expect(words(result)).toEqual(
    words(new Float32Array([0.6875, 0, 0.3125, 0.40625])),
  );
});
it("invalid asynchronous coverage, native result geometry and cancellation reject before publication", async () => {
  const paths = [
    VectorPath.rectangle({ x: 0, y: 0, width: 2, height: 2 }, 0, {
      fill: "#ff0000",
      stroke: null,
    }).toJSON(),
  ];
  for (const mask of [
    new Float32Array(0),
    new Float32Array([NaN]),
    new Float32Array([1.1]),
  ])
    await expect(
      renderFloatVector(
        { paths },
        area,
        world,
        processor,
        () => {},
        async () => mask,
      ),
    ).rejects.toThrow();
  await expect(
    renderFloatVector(
      { paths },
      area,
      world,
      { floatComposite: async () => new Float32Array(8) },
      () => {},
      async () => new Float32Array([1]),
    ),
  ).rejects.toThrow("geometry");
  let cancelled = false;
  await expect(
    renderFloatVector(
      { paths },
      area,
      world,
      processor,
      () => {
        if (cancelled) throw new Error("Cancelled vector");
      },
      async () => {
        cancelled = true;
        return new Float32Array([1]);
      },
    ),
  ).rejects.toThrow("Cancelled vector");
});
