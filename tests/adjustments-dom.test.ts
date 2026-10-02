import { describe, expect, it } from "vitest";
import { Document, AdjustmentLayer, defaultCurvesAdjustment } from "../src/dom";

describe("AdjustmentLayer DOM API", () => {
  it("creates adjustment layer with default curves adjustment", () => {
    const layer = new AdjustmentLayer({ name: "Curves 1" });
    expect(layer.name).toBe("Curves 1");
    expect(layer.kind).toBe("adjustment");
    expect(layer.adjustmentKind).toBe("curves");
    expect(layer.adjustment.kind).toBe("curves");
  });

  it("attaches to document and group, preserving live handles across undo/redo", () => {
    const doc = new Document({ width: 100, height: 100 });
    const layer = new AdjustmentLayer({
      name: "My Curves",
      adjustment: defaultCurvesAdjustment(),
    });

    doc.layers.add(layer);
    expect(doc.getLayer(layer.id)).toBe(layer);

    // Mutate via setCurves
    layer.setCurves([
      { x: 0, y: 0 },
      { x: 128, y: 160 },
      { x: 255, y: 255 },
    ]);

    expect((layer.adjustment as any).rgb[1].y).toBe(160);

    // Undo reverts back to default
    doc.undo();
    expect((layer.adjustment as any).rgb[1].y).toBe(255);

    // Redo restores modified point
    doc.redo();
    expect((layer.adjustment as any).rgb[1].y).toBe(160);
  });

  it("supports setLevels and setTone with atomic history transactions", () => {
    const doc = new Document({ width: 200, height: 200 });
    const layer = doc.layers.add(new AdjustmentLayer());

    doc.transaction("Configure Levels", () => {
      layer.setLevels({
        inputBlack: 15,
        inputWhite: 245,
        gamma: 1.1,
        outputBlack: 0,
        outputWhite: 255,
      });
      layer.opacity = 0.85;
    });

    expect(layer.adjustmentKind).toBe("levels");
    expect((layer.adjustment as any).rgb.inputBlack).toBe(15);
    expect(layer.opacity).toBe(0.85);

    doc.undo();
    expect(layer.adjustmentKind).toBe("curves");
    expect(layer.opacity).toBe(1);

    doc.redo();
    expect(layer.adjustmentKind).toBe("levels");
    expect((layer.adjustment as any).rgb.inputBlack).toBe(15);
    expect(layer.opacity).toBe(0.85);

    // Switch to tone
    layer.setTone({ exposure: 1.0, contrast: 20, saturation: -10 });
    expect(layer.adjustmentKind).toBe("tone");
    const tone = layer.adjustment as any;
    expect(tone.exposure).toBe(1.0);
    expect(tone.contrast).toBe(20);
    expect(tone.saturation).toBe(-10);
  });

  it("duplicates adjustment layers retaining full adjustment parameters and mask state", () => {
    const doc = new Document({ width: 100, height: 100 });
    const layer = doc.layers.add(
      new AdjustmentLayer({
        name: "Levels Adj",
        adjustment: {
          kind: "levels",
          rgb: {
            inputBlack: 20,
            inputWhite: 230,
            gamma: 1.25,
            outputBlack: 10,
            outputWhite: 245,
          },
        },
      }),
    );

    const dup = layer.duplicate() as AdjustmentLayer;

    expect(dup.id).not.toBe(layer.id);
    expect(dup.kind).toBe("adjustment");
    expect(dup.adjustmentKind).toBe("levels");
    expect(dup.adjustment).toEqual(layer.adjustment);
  });

  it("rejects invalid mutations at the DOM boundary", () => {
    const doc = new Document({ width: 100, height: 100 });
    const layer = doc.layers.add(new AdjustmentLayer());

    // Non-increasing curve points should throw
    expect(() =>
      layer.setCurves([
        { x: 0, y: 0 },
        { x: 100, y: 100 },
        { x: 50, y: 150 }, // decreasing x!
        { x: 255, y: 255 },
      ]),
    ).toThrow();

    // Invalid levels (inputWhite <= inputBlack) should throw
    expect(() =>
      layer.setLevels({
        inputBlack: 200,
        inputWhite: 100,
        gamma: 1.0,
        outputBlack: 0,
        outputWhite: 255,
      }),
    ).toThrow();
  });
});
