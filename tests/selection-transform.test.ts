import { expect, it } from "vitest";
import {
  AffineTransform,
  Document,
  MarqueeSelection,
  PaintLayer,
  BrushStroke,
  LayerMask,
} from "../src/dom";
import { containsSelection } from "../src/core/drawing";
import { cropFromSelection } from "../src/core/crop";
import { validateDocument } from "../src/core/model";
import { readProject, serializeProject } from "../src/core/project";
import { parseCommands } from "../src/core/validation";
import { rasterizeSelection } from "../src/ai/diff/engine";

it("composes affine selection values without losing region identity or Boolean ordering", () => {
  const source = new MarqueeSelection({
    shape: "rectangle",
    x: 0,
    y: 0,
    width: 10,
    height: 20,
  });
  const rotated = source.transformed(new AffineTransform(0, 1, -1, 0, 40, 10));
  expect(cropFromSelection(rotated.toJSON())).toEqual({
    x: 20,
    y: 10,
    width: 20,
    height: 10,
  });
  expect(containsSelection(rotated.toJSON(), 30, 15)).toBe(true);
  expect(containsSelection(rotated.toJSON(), 30, 25)).toBe(false);
  const translated = rotated.translated(5, -3);
  expect(containsSelection(translated.toJSON(), 35, 12)).toBe(true);
  expect(cropFromSelection(translated.toJSON())).toEqual({
    x: 25,
    y: 7,
    width: 20,
    height: 10,
  });
  const hole = new MarqueeSelection({
    shape: "ellipse",
    x: 0,
    y: 0,
    width: 8,
    height: 4,
  }).transformed(new AffineTransform(1, 0.5, 0, 1, 26, 11));
  const combined = rotated.combine(hole, "subtract");
  expect(containsSelection(combined.toJSON(), 30, 15)).toBe(false);
  expect(containsSelection(rotated.toJSON(), 30, 15)).toBe(true);
  expect(source.toJSON().regions[0].transform).toBeUndefined();
  const coverage = rasterizeSelection(combined.toJSON(), 64, 64);
  expect(coverage[15 * 64 + 30]).toBe(0);
  expect(coverage[12 * 64 + 22]).toBe(255);
});

it("rejects singular, nonfinite and malformed affine selection commands without changing history", () => {
  const doc = new Document();
  const selection = new MarqueeSelection({
    shape: "rectangle",
    x: 0,
    y: 0,
    width: 10,
    height: 10,
  });
  doc.selection = selection;
  const before = doc.toJSON();
  const revision = doc.getSnapshot().revision;
  expect(() => selection.transformed(new AffineTransform(1, 2, 2, 4))).toThrow(
    /singular/,
  );
  expect(() => new AffineTransform(NaN)).toThrow(/finite/);
  expect(() =>
    parseCommands([
      {
        type: "selection.set",
        selection: {
          regions: [
            {
              ...selection.regions[0],
              transform: { a: 1, b: 2, c: 2, d: 4, e: 0, f: 0 },
            },
          ],
        },
      },
    ]),
  ).toThrow(/invertible/);
  expect(doc.toJSON()).toEqual(before);
  expect(doc.getSnapshot().revision).toBe(revision);
});

it("migrates old documents and round-trips transformed selection, clips and masks with undo", async () => {
  const doc = Document.fromJSON({
    ...new Document().toJSON(),
    schemaVersion: 4,
  });
  expect(doc.toJSON().schemaVersion).toBe(40);
  const selection = new MarqueeSelection({
    shape: "ellipse",
    x: 2,
    y: 3,
    width: 12,
    height: 18,
  }).transformed(new AffineTransform(-1, 0.5, 0.25, 1, 24, 5));
  const paint = doc.layers.add(new PaintLayer());
  doc.transaction("Affine selection workflow", () => {
    doc.selection = selection;
    paint.mask = new LayerMask({ selection });
    paint.strokes.add(
      new BrushStroke({ size: 8, points: [{ x: 10, y: 12 }], clip: selection }),
    );
  });
  const expected = doc.toJSON();
  doc.undo();
  expect(doc.selection).toBeNull();
  expect(paint.mask).toBeNull();
  doc.redo();
  expect(doc.toJSON()).toEqual(expected);
  const file = await serializeProject(expected, {
    get() {
      throw new Error("No source assets should be needed");
    },
  });
  expect((await readProject(file)).document).toEqual(expected);
  expect(() => validateDocument({ ...expected, schemaVersion: 4 })).toThrow(
    /schema version 5/,
  );
  const maskOnly = structuredClone(expected);
  maskOnly.selection = null;
  expect(() => validateDocument({ ...maskOnly, schemaVersion: 4 })).toThrow(
    /schema version 5/,
  );
});
