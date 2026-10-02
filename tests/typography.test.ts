import { describe, expect, it } from "vitest";
import { Document, TextLayer } from "../src/dom";
import { createText, measureTextBounds } from "../src/core/model";
import { drawText } from "../src/engine/drawing";
import { createCanvas, release } from "../src/engine/canvas";
import { AffineTransform } from "../src/core/affine";

if (typeof globalThis.document === "undefined") {
  globalThis.document = {
    createElement(tag: string) {
      if (tag === "canvas") {
        return {
          width: 0,
          height: 0,
          getContext() {
            return {
              save() {},
              restore() {},
              resetTransform() {},
              setTransform() {},
              transform() {},
              translate() {},
              scale() {},
              rotate() {},
              beginPath() {},
              closePath() {},
              moveTo() {},
              lineTo() {},
              arc() {},
              bezierCurveTo() {},
              fill() {},
              stroke() {},
              fillRect() {},
              clearRect() {},
              fillText() {},
              drawImage() {},
              getImageData(_x: number, _y: number, w: number, h: number) {
                return { data: new Uint8ClampedArray(w * h * 4) };
              },
              createImageData(w: number, h: number) {
                return { data: new Uint8ClampedArray(w * h * 4) };
              },
              putImageData() {},
            };
          },
          toBlob(cb: (b: Blob) => void, type?: string) {
            cb(new Blob(["mock-image"], { type: type || "image/png" }));
          },
        };
      }
      return {};
    },
  } as unknown as typeof document;
}

describe("professional typography engine (F08)", () => {
  it("creates TextLayer with letterSpacing, fontWeight, fontStyle, and direction", () => {
    const layer = new TextLayer({
      text: "Luma Design",
      fontSize: 48,
      fontFamily: "sans-serif",
      fontWeight: "bold",
      fontStyle: "italic",
      letterSpacing: 4,
      direction: "ltr",
    });

    expect(layer.text).toBe("Luma Design");
    expect(layer.fontSize).toBe(48);
    expect(layer.fontWeight).toBe("bold");
    expect(layer.fontStyle).toBe("italic");
    expect(layer.letterSpacing).toBe(4);
    expect(layer.direction).toBe("ltr");

    const json = layer.toJSON();
    expect(json.kind).toBe("text");
    if (json.kind === "text") {
      expect(json.fontWeight).toBe("bold");
      expect(json.fontStyle).toBe("italic");
      expect(json.letterSpacing).toBe(4);
      expect(json.direction).toBe("ltr");
    }
  });

  it("calculates text bounds accounting for letter spacing", () => {
    const normalBounds = measureTextBounds(
      "Hello World",
      32,
      "sans-serif",
      1.2,
      {
        letterSpacing: 0,
      },
    );
    const spacedBounds = measureTextBounds(
      "Hello World",
      32,
      "sans-serif",
      1.2,
      {
        letterSpacing: 10,
      },
    );

    // Spaced text bounds must be wider by roughly letterSpacing * (charCount - 1)
    expect(spacedBounds.width).toBeGreaterThan(normalBounds.width);
    expect(spacedBounds.width - normalBounds.width).toBeCloseTo(
      10 * ("Hello World".length - 1),
      0,
    );
  });

  it("mutates typography properties on attached TextLayer through undoable commands", () => {
    const doc = new Document();
    const textLayer = new TextLayer({ text: "Headline" });
    doc.layers.add(textLayer);

    expect(textLayer.letterSpacing).toBeUndefined();
    expect(textLayer.fontWeight).toBeUndefined();

    textLayer.letterSpacing = 2.5;
    expect(textLayer.letterSpacing).toBe(2.5);

    textLayer.fontWeight = "700";
    expect(textLayer.fontWeight).toBe("700");

    textLayer.fontStyle = "italic";
    expect(textLayer.fontStyle).toBe("italic");

    textLayer.direction = "rtl";
    expect(textLayer.direction).toBe("rtl");

    // Undo fontStyle
    doc.undo(); // undo direction
    expect(textLayer.direction).toBeUndefined();
    expect(textLayer.fontStyle).toBe("italic");

    doc.undo(); // undo fontStyle
    expect(textLayer.fontStyle).toBeUndefined();

    doc.undo(); // undo fontWeight
    expect(textLayer.fontWeight).toBeUndefined();

    doc.undo(); // undo letterSpacing
    expect(textLayer.letterSpacing).toBeUndefined();

    doc.redo();
    expect(textLayer.letterSpacing).toBe(2.5);
  });

  it("renders text applying styling, letterSpacing, and direction to 2D context", () => {
    const canvas = createCanvas(200, 100);
    const space = { x: 0, y: 0, width: 200, height: 100, sx: 1, sy: 1 };
    const world = new AffineTransform();

    const layer = createText("Title", "مرحبا بالعالم", {
      fontSize: 24,
      fontFamily: "Arial",
      fontWeight: "bold",
      fontStyle: "italic",
      letterSpacing: 2,
      direction: "rtl",
    });

    expect(() => drawText(layer, canvas, space, world)).not.toThrow();
    release(canvas);
  });

  it("recomputes text layer bounds when letterSpacing or fontWeight is updated via layer.update", () => {
    const doc = new Document();
    const textLayer = new TextLayer({
      text: "Wide Track",
      fontSize: 24,
      letterSpacing: 0,
    });
    doc.layers.add(textLayer);
    const initialWidth = textLayer.width;

    textLayer.letterSpacing = 12;
    expect(textLayer.width).toBeGreaterThan(initialWidth);

    doc.undo();
    expect(textLayer.width).toBe(initialWidth);
  });
});

it("explicit text reflow refreshes bounds atomically and respects locks", () => {
  const doc = new Document();
  const layer = new TextLayer({ text: "Reflow", fontSize: 24 });
  const measured = layer.toJSON();
  const stale = { ...measured, width: 1, height: 1 };
  doc._dispatch({ type: "layer.add", layer: stale });
  const attached = doc.getLayer(layer.id) as TextLayer;
  attached.reflow();
  expect(attached.toJSON()).toEqual(measured);
  doc.undo();
  expect(attached.toJSON()).toEqual(stale);
  doc.redo();
  const count = doc.getSnapshot().past.length;
  attached.reflow();
  expect(doc.getSnapshot().past.length).toBe(count);
  attached.locked = true;
  expect(() => attached.reflow()).toThrow(/Unlock/);
});
