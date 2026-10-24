import { describe, it, expect } from "vitest";
import {
  BrushStroke,
  PencilStroke,
  CloneStroke,
  Document,
  LayerGroup,
  PaintLayer,
  LayerMask,
  MarqueeSelection,
  VectorLayer,
  VectorPath,
} from "../src/dom";
import { parseCommands } from "../src/core/validation";

const selection = () =>
  new MarqueeSelection({
    shape: "rectangle",
    x: 30,
    y: 45,
    width: 50,
    height: 60,
  });
describe("layer mask contract", () => {
  it("captures document selection in local coordinates and shares locks and history", () => {
    const doc = new Document();
    const group = doc.layers.add(new LayerGroup({ x: 10, y: 20 }));
    const layer = group.layers.add(new PaintLayer({ x: 5, y: 7 }));
    doc.selection = selection();
    layer.maskFromSelection(doc.selection!);
    expect(layer.mask!.selection.regions[0]).toMatchObject({ x: 15, y: 18 });
    doc.undo();
    expect(layer.mask).toBeNull();
    doc.redo();
    group.locked = true;
    expect(() => {
      layer.mask = null;
    }).toThrow(/Unlock/);
    group.locked = false;
    expect(() =>
      doc.transaction("invalid", () => {
        layer.mask = null;
        layer.opacity = 3;
      }),
    ).toThrow();
    expect(layer.mask).not.toBeNull();
  });
  it("copies mask values and preserves them across duplication, reparenting and migration", () => {
    const doc = new Document();
    const layer = doc.layers.add(new PaintLayer());
    layer.mask = new LayerMask({ selection: selection(), density: 0.6 });
    const copy = layer.duplicate();
    copy.mask = copy.mask!.with({ inverted: true });
    expect(layer.mask!.inverted).toBe(false);
    const dto = layer.mask!.toJSON();
    if (dto.kind !== "selection") throw new Error("Expected selection mask");
    dto.selection.regions[0].x = 999;
    expect(layer.mask!.selection.regions[0].x).toBe(30);
    const parent = doc.layers.add(new LayerGroup({ x: 40, y: 20 }));
    layer.moveTo(parent, { preservePosition: true });
    expect(layer.x).toBe(-40);
    expect(layer.y).toBe(-20);
    expect(layer.mask!.selection.regions[0]).toMatchObject({ x: 30, y: 45 });
    const restored = Document.fromJSON(doc.toJSON());
    expect(restored.getLayer(layer.id)!.mask!.density).toBe(0.6);
    for (const version of [1, 2, 3] as const) {
      const legacy = new Document().toJSON();
      legacy.schemaVersion = version;
      expect(Document.fromJSON(legacy).toJSON().schemaVersion).toBe(42);
    }
    const invalid = doc.toJSON();
    invalid.schemaVersion = 2;
    expect(() => Document.fromJSON(invalid)).toThrow(/schema version 3/);
  });
  it("rejects invalid masks at constructor and command boundaries", () => {
    expect(
      () => new LayerMask({ selection: selection(), density: 2 }),
    ).toThrow();
    const mask = new LayerMask({ selection: selection() }).toJSON();
    expect(() =>
      parseCommands([
        {
          type: "layer.update",
          id: "layer",
          patch: { mask: { ...mask, inverted: "true" } },
        },
      ]),
    ).toThrow();
    expect(() =>
      parseCommands([
        {
          type: "layer.update",
          id: "layer",
          patch: { mask: { ...mask, unsupported: 20 } },
        },
      ]),
    ).toThrow();
  });
});

describe("Bézier layer masks", () => {
  const path = () =>
    new VectorPath({
      closed: true,
      points: [
        { x: 0, y: 0, out: { x: 20, y: -10 } },
        { x: 40, y: 0 },
        { x: 40, y: 40 },
        { x: 0, y: 40 },
      ],
    });
  it("copies path geometry into target coordinates without retaining a live source link", () => {
    const doc = new Document();
    const group = doc.layers.add(new LayerGroup({ x: 100, y: 20 }));
    const source = group.layers.add(new VectorLayer({ x: 10, y: 5 }));
    const original = source.paths.add(path());
    const target = doc.layers.add(new PaintLayer({ x: 30, y: 10 }));
    target.maskFromPaths(source);
    expect(target.mask!.kind).toBe("vector");
    expect(target.mask!.paths[0].points[0]).toMatchObject({
      x: 80,
      y: 15,
      out: { x: 100, y: 5 },
    });
    expect(target.mask!.fillRule).toBe("evenodd");
    original.update({
      points: path().points.map((p) => ({ ...p, x: p.x + 3 })),
    });
    expect(target.mask!.paths[0].points[0].x).toBe(80);
    const edit = target.mask!.paths;
    edit[0].update({ points: path().points });
    expect(target.mask!.paths[0].points[0].x).toBe(80);
    target.mask = target.mask!.with({ paths: edit, fillRule: "nonzero" });
    expect(target.mask!.paths[0].points[0].x).toBe(0);
    doc.undo();
    expect(target.mask!.paths[0].points[0].x).toBe(80);
    const restored = Document.fromJSON(doc.toJSON());
    expect(restored.getLayer(target.id)!.mask!.toJSON()).toEqual(
      target.mask!.toJSON(),
    );
  });
  it("rejects open paths, incompatible sources and invalid mask settings", () => {
    const open = path();
    open.closed = false;
    expect(() => new LayerMask({ paths: [open] })).toThrow(/closed/);
    const doc = new Document();
    const target = doc.layers.add(new PaintLayer());
    expect(() => target.maskFromPaths(new VectorLayer())).toThrow(
      /same document/,
    );
    const source = doc.layers.add(new VectorLayer());
    expect(() => target.maskFromPaths(source)).toThrow(/no paths/);
    source.paths.add(path());
    target.locked = true;
    expect(() => target.maskFromPaths(source)).toThrow(/Unlock/);
    const mask = new LayerMask({ paths: [path()] });
    expect(() => mask.selection).toThrow(/vector mask/);
    expect(() => mask.with({ density: null as unknown as number })).toThrow();
    expect(() =>
      parseCommands([
        {
          type: "layer.update",
          id: "target",
          patch: { mask: { ...mask.toJSON(), fillRule: "bad" } },
        },
      ]),
    ).toThrow();
  });
  it("limits aggregate mask geometry while accepting an empty hide-all mask", () => {
    expect(new LayerMask({ paths: [] }).toJSON()).toMatchObject({
      kind: "vector",
      paths: [],
    });
    const points = Array.from({ length: 10001 }, (_, i) => ({
      x: i,
      y: i % 2,
    }));
    const many = new VectorPath({ closed: true, points });
    expect(() => new LayerMask({ paths: [many, many] })).toThrow(/20,000/);
  });
});

it("persists fractional feathering, defaults old masks to zero, and validates its range", () => {
  const doc = new Document();
  const layer = doc.layers.add(new PaintLayer());
  layer.mask = new LayerMask({ selection: selection(), feather: 12.5 });
  expect(layer.mask!.feather).toBe(12.5);
  layer.mask = layer.mask!.with({ feather: 3 });
  doc.undo();
  expect(layer.mask!.feather).toBe(12.5);
  expect(
    Document.fromJSON(doc.toJSON()).getLayer(layer.id)!.mask!.feather,
  ).toBe(12.5);
  const old = doc.toJSON();
  delete old.children[0].mask!.feather;
  expect(Document.fromJSON(old).getLayer(layer.id)!.mask!.feather).toBe(0);
  expect(
    () => new LayerMask({ selection: selection(), feather: 129 }),
  ).toThrow();
  expect(
    () => new LayerMask({ selection: selection(), feather: -1 }),
  ).toThrow();
});

it("links and unlinks masks without moving their canvas position across ancestor changes", () => {
  const doc = new Document();
  const group = doc.layers.add(new LayerGroup({ x: 10, y: 20 }));
  const layer = group.layers.add(new PaintLayer({ x: 5, y: 7 }));
  layer.mask = new LayerMask({ selection: selection(), x: 3, y: 4 });
  layer.setMaskLinked(false);
  expect(layer.mask!.toJSON()).toMatchObject({ linked: false, x: 18, y: 31 });
  group.x = 60;
  layer.x = 15;
  expect(layer.mask!.x).toBe(18);
  layer.setMaskLinked(true);
  expect(layer.mask!.toJSON()).toMatchObject({ linked: true, x: -57, y: 4 });
  doc.undo();
  expect(layer.mask!.toJSON()).toMatchObject({ linked: false, x: 18, y: 31 });
  const past = doc.getSnapshot().past.length;
  layer.setMaskLinked(false);
  expect(doc.getSnapshot().past).toHaveLength(past);
  group.locked = true;
  expect(() => layer.setMaskLinked(true)).toThrow(/Unlock/);
  expect(() => layer.setMaskLinked(undefined as unknown as boolean)).toThrow(
    /boolean/,
  );
});
it("persists independent mask coordinates and validates offsets", () => {
  const doc = new Document();
  const layer = doc.layers.add(new PaintLayer());
  layer.mask = new LayerMask({
    selection: selection(),
    linked: false,
    x: 12.5,
    y: -8,
  });
  const restored = Document.fromJSON(doc.toJSON()).getLayer(layer.id)!;
  expect(restored.mask!.toJSON()).toMatchObject({
    linked: false,
    x: 12.5,
    y: -8,
  });
  const group = doc.layers.add(new LayerGroup({ x: 90, y: 30 }));
  layer.moveTo(group);
  expect(layer.mask!.toJSON()).toMatchObject({ linked: false, x: 12.5, y: -8 });
  expect(layer.duplicate().mask!.toJSON()).toEqual(layer.mask!.toJSON());
  const old = doc.toJSON();
  const value = old.children.find((node) => node.kind === "group")!;
  if (value.kind !== "group") throw new Error("Expected group");
  delete value.children[0].mask!.x;
  delete value.children[0].mask!.y;
  delete value.children[0].mask!.linked;
  const legacy = Document.fromJSON(old).getLayer(layer.id)!.mask!;
  expect([legacy.x, legacy.y, legacy.linked]).toEqual([0, 0, true]);
  expect(
    () => new LayerMask({ selection: selection(), x: Infinity }),
  ).toThrow();
  expect(
    () =>
      new LayerMask({
        selection: selection(),
        linked: "yes" as unknown as boolean,
      }),
  ).toThrow();
});

it("painted masks retain immutable strokes, settings, locks and history", () => {
  const doc = new Document(),
    layer = doc.layers.add(new PaintLayer());
  const empty = new LayerMask({ base: 1, x: 5, linked: false });
  const hide = new BrushStroke({
    points: [{ x: 20, y: 30 }],
    size: 24,
    opacity: 0.5,
  });
  layer.mask = empty
    .paint(hide, "hide")
    .paint(new PencilStroke({ points: [{ x: 20, y: 30 }], size: 2 }), "reveal");
  expect(empty.strokes).toHaveLength(0);
  expect(layer.mask!.strokes.map((entry) => entry.mode)).toEqual([
    "hide",
    "reveal",
  ]);
  expect(layer.mask!.with({ feather: 4 }).strokes).toHaveLength(2);
  expect(layer.mask!.with({ base: 0 }).base).toBe(0);
  const restored = Document.fromJSON(doc.toJSON()).getLayer(layer.id)!.mask!;
  expect(restored.toJSON()).toEqual(layer.mask!.toJSON());
  layer.mask = layer.mask!.with({ strokes: [] });
  doc.undo();
  expect(layer.mask!.strokes).toHaveLength(2);
  layer.locked = true;
  expect(() => {
    layer.mask = layer.mask!.paint(hide);
  }).toThrow(/Unlock/);
  expect(() => new LayerMask({ base: 2 })).toThrow();
  expect(() =>
    empty.paint(
      new CloneStroke({
        points: [{ x: 0, y: 0 }],
        tiles: [{ assetId: "source", x: 0, y: 0, width: 1, height: 1 }],
      }),
    ),
  ).toThrow(/brush or pencil/);
  expect(
    new LayerMask({ selection: selection() }).paint(hide).selection.toJSON(),
  ).toEqual(selection().toJSON());
  expect(() =>
    parseCommands([
      {
        type: "layer.update",
        id: layer.id,
        patch: {
          mask: {
            ...restored.toJSON(),
            strokes: [{ mode: "erase", stroke: hide.toJSON() }],
          },
        },
      },
    ]),
  ).toThrow();
});

it("refines selection and vector masks without replacing their editable geometry", () => {
  const stroke = new BrushStroke({ points: [{ x: 40, y: 50 }], size: 20 });
  const path = new VectorPath({
    closed: true,
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ],
  });
  for (const mask of [
    new LayerMask({ selection: selection(), x: 5, feather: 4 }),
    new LayerMask({ paths: [path], fillRule: "nonzero", x: 5, feather: 4 }),
  ]) {
    expect(mask.strokes).toEqual([]);
    const refined = mask.paint(stroke, "hide");
    expect(refined.kind).toBe(mask.kind);
    expect(refined.strokes).toHaveLength(1);
    expect(refined.with({ density: 0.5 }).strokes).toHaveLength(1);
    expect(refined.with({ strokes: [] }).toJSON()).toEqual({
      ...mask.toJSON(),
      strokes: [],
    });
    const doc = new Document(),
      layer = doc.layers.add(new PaintLayer());
    layer.mask = refined;
    expect(
      Document.fromJSON(doc.toJSON()).getLayer(layer.id)!.mask!.toJSON(),
    ).toEqual(refined.toJSON());
    if (refined.kind === "vector")
      expect(refined.paths[0].points).toEqual(path.points);
    else expect(refined.selection.toJSON()).toEqual(selection().toJSON());
    expect(refined.with({ base: 1 }).strokes).toHaveLength(1);
  }
});
