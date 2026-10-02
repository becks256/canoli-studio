import { describe, expect, it } from "vitest";
import {
  Document,
  VectorLayer,
  VectorPath,
  TextLayer,
  PaintLayer,
} from "../src/dom";
import { EditorApplication } from "../src/editor";
import { getExportCapabilityReport } from "../src/engine/export";

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
                const data = new Uint8ClampedArray(w * h * 4);
                data.fill(255);
                return { data };
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

describe("multi-format export engine with capability reports (F11)", () => {
  it("generates honest capability reports for PNG, JPEG, WebP, and SVG", () => {
    const doc = new Document({ width: 400, height: 300 });
    const vLayer = new VectorLayer({ name: "Vector Art" });
    doc.layers.add(vLayer);
    vLayer.paths.add(
      VectorPath.rectangle({ x: 10, y: 10, width: 80, height: 80 }),
    );

    const tLayer = new TextLayer({ text: "Caption" });
    doc.layers.add(tLayer);

    const docData = doc.toJSON();

    // PNG Report
    const pngReport = getExportCapabilityReport(docData, { format: "png" });
    expect(pngReport.format).toBe("png");
    expect(pngReport.featuresPreserved).toContain(
      "Full alpha channel (transparency)",
    );
    expect(pngReport.warnings.some((w) => w.includes("rasterized"))).toBe(true);

    // JPEG Report
    const jpegReport = getExportCapabilityReport(docData, {
      format: "jpeg",
      backgroundColor: "#ffeedd",
    });
    expect(jpegReport.format).toBe("jpeg");
    expect(jpegReport.warnings.some((w) => w.includes("transparency"))).toBe(
      true,
    );
    expect(jpegReport.warnings.some((w) => w.includes("#ffeedd"))).toBe(true);
    expect(
      jpegReport.featuresDegradedOrOmitted.some((f) =>
        f.includes("Alpha channel"),
      ),
    ).toBe(true);

    // WebP Report
    const webpReport = getExportCapabilityReport(docData, {
      format: "webp",
      quality: 0.85,
    });
    expect(webpReport.format).toBe("webp");
    expect(webpReport.warnings.some((w) => w.includes("Lossy WebP"))).toBe(
      true,
    );

    // SVG Report
    const svgReport = getExportCapabilityReport(docData, { format: "svg" });
    expect(svgReport.format).toBe("svg");
    expect(svgReport.featuresPreserved).toContain(
      "Infinitely scalable Bézier vector paths",
    );
    expect(svgReport.warnings.some((w) => w.includes("omitted"))).toBe(true);
    expect(svgReport.featuresDegradedOrOmitted).toContain("Text layers");

    // PSD Report
    const psdReport = getExportCapabilityReport(docData, { format: "psd" });
    expect(psdReport.format).toBe("psd");
    expect(psdReport.featuresPreserved).toContain(
      "Layer opacity and blend modes",
    );
    expect(psdReport.warnings.some((w) => w.includes("rasterized"))).toBe(true);
  });

  it("exports document to standalone SVG with clean path representations", async () => {
    const editor = new EditorApplication();
    const doc = editor.document;
    const vLayer = new VectorLayer({ name: "Icons" });
    doc.layers.add(vLayer);
    vLayer.paths.add(
      VectorPath.rectangle({ x: 20, y: 30, width: 100, height: 60 }, 4, {
        stroke: "#00ff00",
        strokeWidth: 2,
        fill: "#0000ff",
      }),
    );

    const result = await editor.export({ format: "svg" });
    expect(result.extension).toBe("svg");
    expect(result.mimeType).toBe("image/svg+xml");

    const text = await result.blob.text();
    expect(text).toContain("<svg ");
    expect(text).toContain("<path ");
    expect(text).toContain('fill="#0000ff"');
    expect(text).toContain('stroke="#00ff00"');
  });

  it("exports document to PNG and JPEG through editor export API", async () => {
    const editor = new EditorApplication();
    const doc = editor.document;
    const pLayer = new PaintLayer({ name: "Paint" });
    doc.layers.add(pLayer);

    // PNG
    const pngResult = await editor.export({ format: "png" });
    expect(pngResult.extension).toBe("png");
    expect(pngResult.mimeType).toBe("image/png");
    expect(pngResult.blob.size).toBeGreaterThan(0);

    // JPEG
    const jpegResult = await editor.export({
      format: "jpeg",
      quality: 0.85,
      backgroundColor: "#ffffff",
    });
    expect(jpegResult.extension).toBe("jpg");
    expect(jpegResult.blob.size).toBeGreaterThan(0);

    // WebP
    const webpResult = await editor.export({
      format: "webp",
      quality: 0.8,
    });
    expect(webpResult.extension).toBe("webp");
    expect(webpResult.blob.size).toBeGreaterThan(0);

    // PSD
    const psdResult = await editor.export({ format: "psd" });
    expect(psdResult.extension).toBe("psd");
    expect(psdResult.mimeType).toBe("image/vnd.adobe.photoshop");
    expect(psdResult.blob.size).toBeGreaterThan(0);
  });
});
