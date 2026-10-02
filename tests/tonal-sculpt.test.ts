import { expect, it } from "vitest";
import { Document, LayerGroup, MarqueeSelection, TextLayer } from "../src/dom";

it("adds a root tonal layer in document coordinates and captures selection and inputs", () => {
  const document = new Document({ width: 10000, height: 5000 });
  const group = document.layers.add(new LayerGroup({ x: 100, y: 200 }));
  document.selectedLayer = group.layers.add(new TextLayer({ text: "Target" }));
  document.selection = new MarqueeSelection({
    shape: "rectangle",
    x: 10,
    y: 20,
    width: 30,
    height: 40,
  });
  const selection = document.selection.toJSON();
  const before = document.toJSON();
  const history = document.getSnapshot().past.length;
  const path = [{ x: 15, y: 25, pressure: 0.5 }];
  const layer = document.applyTonalSculpt(path, "burn", "shadows", 0.4, {
    size: 12,
  });
  path[0].x = 999;
  expect(document.toJSON().children.at(-1)?.id).toBe(layer.id);
  expect([layer.x, layer.y]).toEqual([0, 0]);
  expect(layer.adjustment).toMatchObject({
    kind: "tonal",
    strokes: [
      {
        mode: "burn",
        range: "shadows",
        exposure: 0.4,
        protectTones: true,
        brush: {
          size: 12,
          clip: selection,
          points: [{ x: 15, y: 25, pressure: 0.5 }],
        },
      },
    ],
  });
  expect(document.getSnapshot().past.length).toBe(history + 1);
  const after = document.toJSON();
  document.undo();
  expect(document.toJSON()).toEqual(before);
  document.redo();
  expect(document.toJSON()).toEqual(after);
});

it("rejects invalid tonal operations atomically and composes in caller transactions", () => {
  const document = new Document();
  const before = document.toJSON();
  for (const [path, exposure, options] of [
    [[], 1, {}],
    [[{ x: NaN, y: 0 }], 1, {}],
    [[{ x: 0, y: 0 }], 2, {}],
    [[{ x: 0, y: 0 }], 1, { size: -1 }],
    [[{ x: 0, y: 0 }], 1, { flow: 2 }],
    [[{ x: 0, y: 0 }], 1, { unexpected: true }],
  ] as const) {
    expect(() =>
      document.applyTonalSculpt(
        path as any,
        "dodge",
        "midtones",
        exposure,
        options as any,
      ),
    ).toThrow();
    expect(document.toJSON()).toEqual(before);
    expect(document.getSnapshot().past).toHaveLength(0);
  }
  document.transaction("Two tonal strokes", () => {
    document.applyTonalSculpt([{ x: 10, y: 20 }], "dodge", "midtones", 0.5, {
      clipSelection: false,
    });
    document.applyTonalSculpt([{ x: 20, y: 20 }], "burn", "highlights", 0.25);
  });
  expect(document.layers.length).toBe(2);
  expect(document.getSnapshot().past).toHaveLength(1);
  document.undo();
  expect(document.toJSON()).toEqual(before);
});
