import { it, expect } from "vitest";
import {
  Document,
  RasterLayer,
  LayerMask,
  MaskPlane,
  PerspectiveTransform,
  AffineTransform,
  VectorPath,
  MarqueeSelection,
  BrushStroke,
} from "../src/dom";
import {
  appendMaskPlaneSteps,
  affineMaskPose,
  compileMaskPlane,
  maskPosePoint,
  type MaskPlanePoseData,
  type MaskPlaneData,
} from "../src/core/mask-plane";
import { compileProjectiveField } from "../src/core/projective-field";
import {
  SCHEMA_VERSION,
  validateDocument,
  referencedAssets,
} from "../src/core/model";
import { remapLayerAssets } from "../src/core/asset-references";
const perspective = new PerspectiveTransform({
    corners: [
      { x: 0.1, y: 0 },
      { x: 0.9, y: 0.1 },
      { x: 1, y: 1 },
      { x: 0, y: 0.8 },
    ],
  }),
  transform = new AffineTransform(1.2, 0.2, 0.3, -0.9, 200, 300);
const plane = () =>
  new MaskPlane({
    reference: { assetId: "original-grid" },
    basis: AffineTransform.rotation(0.2),
    pose: { width: 100, height: 80, perspective, transform },
  });

it("owns constructor values and retains the plane through every mask geometry and refinement", () => {
  const value = plane(),
    before = value.toJSON();
  const ref = value.reference;
  if ("assetId" in ref) ref.assetId = "foreign";
  const copy = value.toJSON();
  copy.pose.transform.e = 999;
  copy.steps.push({ pose: before.pose, inverse: false });
  expect(value.toJSON()).toEqual(before);
  expect(Object.isFrozen(value)).toBe(true);
  const masks = [
    new LayerMask({ base: 1 }),
    new LayerMask({
      selection: new MarqueeSelection({
        x: 1,
        y: 2,
        width: 3,
        height: 4,
        shape: "rectangle",
      }),
    }),
    new LayerMask({
      paths: [
        new VectorPath({
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: 8, y: 0 },
            { x: 4, y: 6 },
          ],
        }),
      ],
    }),
    LayerMask.fromBitmap("mask-source"),
    new LayerMask({
      rasterErasures: { width: 20, height: 10, operations: [] },
    }),
  ];
  for (const original of masks) {
    const mask = original
      .with({ plane: value })
      .paint(new BrushStroke({ points: [{ x: 4, y: 3 }], size: 2 }));
    expect(mask.plane!.toJSON()).toEqual(before);
    expect(LayerMask._fromJSON(mask.toJSON()).toJSON()).toEqual(mask.toJSON());
    expect(mask.with({ density: 0.4 }).plane!.toJSON()).toEqual(before);
    expect(mask.with({ plane: null }).plane).toBeNull();
  }
});
it("gates retained planes at schema 56 and includes/remaps geometry-only originals", () => {
  const doc = new Document(),
    layer = doc.layers.add(
      new RasterLayer({ assetId: "pixels", width: 100, height: 80 }),
    );
  layer.mask = new LayerMask({ base: 1, plane: plane() });
  const data = doc.toJSON();
  expect(data.schemaVersion).toBe(SCHEMA_VERSION);
  expect(referencedAssets(data)).toContain("original-grid");
  data.schemaVersion = 55;
  expect(() => validateDocument(data)).toThrow(/version 56/);
  const copy = layer.toJSON();
  remapLayerAssets(
    copy,
    new Map([
      ["pixels", "new-pixels"],
      ["original-grid", "new-grid"],
    ]),
  );
  expect(copy.mask?.plane?.reference).toEqual({
    kind: "asset",
    assetId: "new-grid",
  });
  expect(layer.mask!.plane!.reference).toEqual({ assetId: "original-grid" });
});
it("rejects plain constructor substitutes, null/unknown fields and singular native bases", () => {
  const options = {
    reference: { assetId: "original" },
    pose: { width: 100, height: 80, perspective, transform },
  };
  for (const invalid of [
    { ...options, extra: 1 },
    { ...options, phase: null },
    { ...options, steps: null },
    { ...options, reference: { assetId: "a", width: 3, height: 4 } },
    { ...options, basis: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } },
    {
      ...options,
      pose: { ...options.pose, perspective: perspective.toJSON() },
    },
    { ...options, steps: [{ pose: options.pose, inverse: null }] },
  ])
    expect(() => new MaskPlane(invalid as never)).toThrow();
  expect(
    () => new LayerMask({ base: 1, plane: plane().toJSON() as never }),
  ).toThrow(/constructor/);
  expect(
    () =>
      new MaskPlane({
        ...options,
        basis: new AffineTransform(0, 0, 0, 0, 0, 0),
      }),
  ).toThrow();
});
it("cancels inverse attachment poses before arithmetic and preserves every legacy compiled ABI coefficient", () => {
  const value = plane().toJSON(),
    step = { pose: value.pose, inverse: true };
  expect(appendMaskPlaneSteps([step], { ...step, inverse: false })).toEqual([]);
  const ref = { width: 310, height: 230 },
    corners = perspective
      .toPixels(100, 80)
      .map((p) => transform.point(p)) as any,
    old = compileProjectiveField({
      sourceWidth: 310,
      sourceHeight: 230,
      corners,
      field: { x: 0, y: 0, width: 1, height: 1 },
      source: { x: 0, y: 0, width: 1, height: 1 },
      output: { x: 0, y: 0, width: 1, height: 1 },
      background: 0,
    });
  const current = compileMaskPlane(value, ref, [
    step,
    { ...step, inverse: false },
  ]);
  expect(current.mapping.matrix).toEqual([...old.values.subarray(0, 9)]);
  expect(current.mapping.inputOrigin).toEqual(old.inputOrigin);
  const cancelled = compileMaskPlane(value, { width: 100, height: 80 }, [step]);
  expect(cancelled.mapping.matrix).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  expect(cancelled.mapping.inputOrigin).toEqual({ x: 0, y: 0 });
});
it("composes changed owner poses in relative frames and agrees with independent point inversion", () => {
  const value = plane().toJSON(),
    captured = value.pose,
    newPose: MaskPlanePoseData = {
      ...captured,
      transform: {
        ...captured.transform,
        e: captured.transform.e + 17,
        f: captured.transform.f - 9,
      },
    },
    compiled = compileMaskPlane(value, { width: 100, height: 80 }, [
      { pose: captured, inverse: true },
      { pose: newPose, inverse: false },
    ]);
  const point = { x: 40, y: 30 },
    world = maskPosePoint(newPose, point),
    m = compiled.mapping,
    x = world.x - m.inputOrigin.x,
    y = world.y - m.inputOrigin.y,
    a = m.matrix,
    w = a[6] * x + a[7] * y + a[8];
  expect((a[0] * x + a[1] * y + a[2]) / w).toBeCloseTo(point.x, 10);
  expect((a[3] * x + a[4] * y + a[5]) / w).toBeCloseTo(point.y, 10);
  const moved = compileMaskPlane(value, { width: 100, height: 80 }, [
      {
        pose: affineMaskPose(AffineTransform.translation(13, -7)),
        inverse: false,
      },
    ]),
    at = maskPosePoint(captured, point),
    q = moved.mapping,
    dx = at.x + 13 - q.inputOrigin.x,
    dy = at.y - 7 - q.inputOrigin.y,
    b = q.matrix,
    v = b[6] * dx + b[7] * dy + b[8];
  expect((b[0] * dx + b[1] * dy + b[2]) / v).toBeCloseTo(point.x, 10);
  expect((b[3] * dx + b[4] * dy + b[5]) / v).toBeCloseTo(point.y, 10);
});
it("retains empty versus authored placement steps without mutating captured records", () => {
  const value: MaskPlaneData = plane().toJSON(),
    before = structuredClone(value),
    steps = appendMaskPlaneSteps(value.steps, {
      pose: affineMaskPose(new AffineTransform()),
      inverse: false,
    });
  expect(steps).toEqual([]);
  expect(value).toEqual(before);
});

it("captures document selections and source cubic paths without projective point approximation", () => {
  const doc = new Document({ width: 300, height: 200 }),
    layer = doc.layers.add(
      new RasterLayer({ assetId: "pixels", width: 100, height: 80 }),
    );
  layer.transform = transform;
  layer.perspective = perspective;
  const selection = new MarqueeSelection({
      x: 25,
      y: 35,
      width: 80,
      height: 40,
      shape: "ellipse",
    }),
    before = doc.toJSON(),
    past = doc.getSnapshot().past.length;
  layer.maskFromSelection(selection);
  expect(layer.mask!.selection!.toJSON()).toEqual(selection.toJSON());
  expect(layer.mask!.linked).toBe(true);
  expect(layer.mask!.plane!.reference).toEqual({ width: 1, height: 1 });
  expect(doc.getSnapshot().past.length).toBe(past + 1);
  doc.undo();
  expect(doc.toJSON()).toEqual(before);
  doc.redo();
});

it("discloses baked retained mask planes through reset perspective and reachable smart masters", async () => {
  const { getExportCapabilityReport } = await import("../src/engine/export");
  const doc = new Document(),
    layer = doc.layers.add(
      new RasterLayer({
        assetId: "pixels",
        width: 100,
        height: 80,
        perspective,
      }),
    );
  layer.mask = new LayerMask({ base: 1 });
  layer.setMaskLinked(false);
  layer.perspective = null;
  for (const nested of [false, true]) {
    if (nested) doc.createSmartObject([doc.layers.at(0)!]);
    for (const format of ["svg", "psd", "psb"] as const) {
      const report = getExportCapabilityReport(doc.toJSON(), { format });
      expect(report.featuresDegradedOrOmitted.join(" ")).toMatch(
        /retained mask planes/i,
      );
      expect(report.warnings.join(" ")).toMatch(/baked|bake/);
    }
  }
});
