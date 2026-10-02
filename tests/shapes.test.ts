import { describe, expect, it } from "vitest";
import {
  Document,
  VectorLayer,
  VectorPath,
  createRectanglePath,
  createEllipsePath,
  createPolygonPath,
  formatSvgPathD,
  parseSvgPath,
  KAPPA,
} from "../src/dom";
import { EditorApplication } from "../src/editor";

if (typeof globalThis.Worker === "undefined") {
  globalThis.Worker = class MockWorker {
    postMessage() {}
    addEventListener() {}
    removeEventListener() {}
    terminate() {}
  } as unknown as typeof Worker;
}

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

describe("vector and shape editing (F07)", () => {
  it("creates sharp and rounded rectangle paths using smooth cubic Béziers", () => {
    // Sharp rectangle
    const sharp = createRectanglePath(
      { x: 0, y: 0, width: 100, height: 50 },
      0,
    );
    expect(sharp.points.length).toBe(4);
    expect(sharp.closed).toBe(true);

    // Rounded rectangle with cornerRadius = 10
    const rounded = createRectanglePath(
      { x: 0, y: 0, width: 100, height: 50 },
      10,
    );
    expect(rounded.points.length).toBe(8);
    expect(rounded.closed).toBe(true);

    // Verify control point offset corresponds to KAPPA
    const p0 = rounded.points[0];
    const p1 = rounded.points[1];
    expect(p0.x).toBe(10);
    expect(p0.y).toBe(0);
    // Anchor 0 incoming handle must curve smoothly from Anchor 7
    expect(p0.in.x).toBeCloseTo(10 - 10 * KAPPA, 2);
    expect(p0.in.y).toBe(0);
    expect(p1.x).toBe(90);
    expect(p1.out.x).toBeCloseTo(90 + 10 * KAPPA, 2);
  });

  it("creates ellipse paths with 4 cubic Béziers approximating a circular/oval shape", () => {
    const ellipse = createEllipsePath({ x: 10, y: 20, width: 80, height: 60 });
    expect(ellipse.points.length).toBe(4);
    expect(ellipse.closed).toBe(true);

    // Center is (50, 50), rx = 40, ry = 30
    // Top anchor is (50, 20)
    expect(ellipse.points[0].x).toBe(50);
    expect(ellipse.points[0].y).toBe(20);
    // Right anchor is (90, 50)
    expect(ellipse.points[1].x).toBe(90);
    expect(ellipse.points[1].y).toBe(50);
    // Bottom anchor is (50, 80)
    expect(ellipse.points[2].x).toBe(50);
    expect(ellipse.points[2].y).toBe(80);
    // Left anchor is (10, 50)
    expect(ellipse.points[3].x).toBe(10);
    expect(ellipse.points[3].y).toBe(50);
  });

  it("creates regular polygon paths with specified side count", () => {
    const hex = createPolygonPath({ x: 100, y: 100 }, 50, 6);
    expect(hex.points.length).toBe(6);
    expect(hex.closed).toBe(true);

    const triangle = createPolygonPath({ x: 0, y: 0 }, 30, 3);
    expect(triangle.points.length).toBe(3);
    expect(triangle.closed).toBe(true);
  });

  it("formats SVG path string and parses back with bidirectional fidelity", () => {
    const original = createEllipsePath({ x: 0, y: 0, width: 100, height: 100 });
    const d = formatSvgPathD(original);
    expect(d).toContain("M ");
    expect(d).toContain("C ");
    expect(d).toContain("Z");

    const parsedAnchors = parseSvgPath(d);
    expect(parsedAnchors.length).toBe(4);
    expect(parsedAnchors[0].x).toBeCloseTo(original.points[0].x, 1);
    expect(parsedAnchors[0].y).toBeCloseTo(original.points[0].y, 1);
  });

  it("exports vector layer to complete standalone SVG document", () => {
    const doc = new Document({ width: 800, height: 600 });
    const layer = new VectorLayer({ name: "Icons" });
    doc.layers.add(layer);

    const rect = VectorPath.rectangle(
      { x: 50, y: 50, width: 200, height: 100 },
      8,
      {
        stroke: "#ffffff",
        strokeWidth: 3,
        fill: "#ff0000",
      },
    );
    layer.paths.add(rect);

    const svg = layer.toSvg(800, 600);
    expect(svg).toContain('viewBox="0 0 800 600"');
    expect(svg).toContain('<path d="');
    expect(svg).toContain('fill="#ff0000"');
    expect(svg).toContain('stroke="#ffffff"');
    expect(svg).toContain('stroke-width="3"');
  });

  it("adds shapes via ToolController and supports undo/redo", () => {
    const editor = new EditorApplication();
    const controller = editor.tools;

    const path1 = controller.addShape("rectangle", {
      x: 10,
      y: 10,
      width: 100,
      height: 50,
      cornerRadius: 5,
    });
    expect(path1).toBeDefined();

    const layer = editor.document.selectedLayer as VectorLayer;
    expect(layer).toBeInstanceOf(VectorLayer);
    expect(layer.paths.length).toBe(1);

    const path2 = controller.addShape("ellipse", {
      x: 20,
      y: 20,
      width: 60,
      height: 60,
    });
    expect(path2).toBeDefined();
    expect(layer.paths.length).toBe(2);

    editor.document.undo();
    expect(layer.paths.length).toBe(1);
    editor.document.redo();
    expect(layer.paths.length).toBe(2);
  });

  it("imports SVG path via ToolController into vector layer", () => {
    const editor = new EditorApplication();
    const controller = editor.tools;

    const imported = controller.importSvgPath("M 0 0 L 100 0 L 100 100 Z");
    expect(imported).toBeDefined();
    expect(imported.points.length).toBe(3);
    expect(imported.closed).toBe(true);

    const layer = editor.document.selectedLayer as VectorLayer;
    expect(layer).toBeInstanceOf(VectorLayer);
    expect(layer.paths.length).toBe(1);
  });
});
