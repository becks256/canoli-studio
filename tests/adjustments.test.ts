import { describe, expect, it } from "vitest";
import {
  evaluateMonotoneCubicSpline,
  evaluateLevelsLut,
  computeAdjustmentLuts,
  curvesAdjustmentSchema,
  levelsAdjustmentSchema,
  toneAdjustmentSchema,
  defaultCurvesAdjustment,
} from "../src/core/adjustments";
import { Document, AdjustmentLayer } from "../src/dom";
import { SCHEMA_VERSION, validateDocument } from "../src/core/model";

describe("adjustment math and schemas", () => {
  it("computes identity monotone cubic spline for linear endpoints", () => {
    const lut = evaluateMonotoneCubicSpline([
      { x: 0, y: 0 },
      { x: 255, y: 255 },
    ]);
    expect(lut).toHaveLength(256);
    expect(lut[0]).toBe(0);
    expect(lut[128]).toBe(128);
    expect(lut[255]).toBe(255);
    for (let i = 0; i < 256; i++) {
      expect(lut[i]).toBe(i);
    }
  });

  it("computes monotonic S-curve without overshoot or non-monotonic oscillations", () => {
    // S-curve for contrast boost
    const points = [
      { x: 0, y: 0 },
      { x: 64, y: 32 },
      { x: 192, y: 224 },
      { x: 255, y: 255 },
    ];
    const lut = evaluateMonotoneCubicSpline(points);
    expect(lut[0]).toBe(0);
    expect(lut[64]).toBe(32);
    expect(lut[192]).toBe(224);
    expect(lut[255]).toBe(255);

    // Fritsch-Carlson ensures strictly non-decreasing monotone output
    for (let i = 1; i < 256; i++) {
      expect(lut[i]).toBeGreaterThanOrEqual(lut[i - 1]);
    }
  });

  it("computes flat horizontal segment without overshoot", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 50, y: 100 },
      { x: 150, y: 100 },
      { x: 255, y: 255 },
    ];
    const lut = evaluateMonotoneCubicSpline(points);
    // Flat segment from x=50 to 150 must stay flat at 100
    for (let x = 50; x <= 150; x++) {
      expect(lut[x]).toBe(100);
    }
  });

  it("evaluates levels transfer function with black/white points and gamma", () => {
    // Identity levels
    const identityLut = evaluateLevelsLut({
      inputBlack: 0,
      inputWhite: 255,
      gamma: 1.0,
      outputBlack: 0,
      outputWhite: 255,
    });
    for (let i = 0; i < 256; i++) {
      expect(identityLut[i]).toBe(i);
    }

    // High contrast levels: inputBlack=50, inputWhite=200
    const contrastLut = evaluateLevelsLut({
      inputBlack: 50,
      inputWhite: 200,
      gamma: 1.0,
      outputBlack: 0,
      outputWhite: 255,
    });
    expect(contrastLut[0]).toBe(0);
    expect(contrastLut[50]).toBe(0);
    expect(contrastLut[200]).toBe(255);
    expect(contrastLut[255]).toBe(255);
    expect(contrastLut[125]).toBe(128);

    // Gamma > 1 (brightens midtones)
    const gammaLut = evaluateLevelsLut({
      inputBlack: 0,
      inputWhite: 255,
      gamma: 2.0,
      outputBlack: 0,
      outputWhite: 255,
    });
    expect(gammaLut[128]).toBeGreaterThan(128); // Midtone is brightened

    // Output levels restriction: outputBlack=50, outputWhite=200
    const outputLut = evaluateLevelsLut({
      inputBlack: 0,
      inputWhite: 255,
      gamma: 1.0,
      outputBlack: 50,
      outputWhite: 200,
    });
    expect(outputLut[0]).toBe(50);
    expect(outputLut[255]).toBe(200);
  });

  it("computes 768-byte composite LUTs combining master and channel adjustments", () => {
    const luts = computeAdjustmentLuts({
      kind: "curves",
      rgb: [
        { x: 0, y: 0 },
        { x: 255, y: 255 },
      ],
      red: [
        { x: 0, y: 0 },
        { x: 255, y: 128 },
      ],
    });

    expect(luts.combined).toHaveLength(768);
    expect(luts.r).toHaveLength(256);
    expect(luts.g).toHaveLength(256);
    expect(luts.b).toHaveLength(256);

    // Green and blue are linear master
    expect(luts.g[255]).toBe(255);
    expect(luts.b[255]).toBe(255);
    // Red is scaled to max 128
    expect(luts.r[255]).toBe(128);
  });

  it("validates adjustment schemas and rejects malformed values", () => {
    // Curves require at least 2 points
    expect(() =>
      curvesAdjustmentSchema.parse({
        kind: "curves",
        rgb: [{ x: 0, y: 0 }],
      }),
    ).toThrow();

    // Curves require strictly increasing X coordinates
    expect(() =>
      curvesAdjustmentSchema.parse({
        kind: "curves",
        rgb: [
          { x: 0, y: 0 },
          { x: 100, y: 50 },
          { x: 100, y: 80 }, // Duplicate X
          { x: 255, y: 255 },
        ],
      }),
    ).toThrow(/strictly increasing/);

    // Levels require inputWhite > inputBlack
    expect(() =>
      levelsAdjustmentSchema.parse({
        kind: "levels",
        rgb: {
          inputBlack: 150,
          inputWhite: 100,
          gamma: 1.0,
          outputBlack: 0,
          outputWhite: 255,
        },
      }),
    ).toThrow(/strictly greater/);

    // Tone parameters must be within finite bounds
    expect(() =>
      toneAdjustmentSchema.parse({
        kind: "tone",
        exposure: 5, // max 3
        contrast: 0,
        saturation: 0,
      }),
    ).toThrow();
  });

  it("requires document schema version 4 for adjustment layers", () => {
    const doc = new Document({ width: 100, height: 100 });
    doc.layers.add(
      new AdjustmentLayer({
        name: "Curves",
        adjustment: defaultCurvesAdjustment(),
      }),
    );

    const json = doc.toJSON();
    expect(json.schemaVersion).toBe(SCHEMA_VERSION);
    expect(json.schemaVersion).toBe(41);

    // Validating under schema version 3 should throw
    const v3 = { ...json, schemaVersion: 3 };
    expect(() => validateDocument(v3)).toThrow(/schema version 4/);
  });

  it("executes adjustment layer commands with undo/redo and patch validation", () => {
    const doc = new Document({ width: 200, height: 200 });
    const layer = doc.layers.add(
      new AdjustmentLayer({
        name: "Test Curves",
        adjustment: defaultCurvesAdjustment(),
      }),
    );

    expect(layer.adjustmentKind).toBe("curves");

    // Patch adjustment to levels
    layer.setLevels({
      inputBlack: 10,
      inputWhite: 240,
      gamma: 1.2,
      outputBlack: 5,
      outputWhite: 250,
    });

    expect(layer.adjustmentKind).toBe("levels");
    const levelsAdj = layer.adjustment as any;
    expect(levelsAdj.rgb.inputBlack).toBe(10);
    expect(levelsAdj.rgb.inputWhite).toBe(240);

    // Undo reverts back to curves
    doc.undo();
    expect(layer.adjustmentKind).toBe("curves");

    // Redo brings levels back
    doc.redo();
    expect(layer.adjustmentKind).toBe("levels");
    expect((layer.adjustment as any).rgb.inputBlack).toBe(10);
  });
});
