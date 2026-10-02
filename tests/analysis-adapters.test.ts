import { describe, expect, it } from "vitest";
import { LocalOcrAdapter } from "./fixtures/analysis/local-ocr";
import { LocalSegmentationAdapter } from "../src/intelligence/adapters/local-segmenter";
import { LocalTaggingAdapter } from "../src/intelligence/adapters/local-tagger";
import { RemoteAnalysisAdapter } from "./fixtures/analysis/remote-adapter";
import {
  AnalysisAdapterRegistry,
  defaultAnalysisRegistry,
} from "../src/intelligence/adapters/registry";

describe("OCR test simulator", () => {
  it("provides deterministic fixture text", async () => {
    const adapter = new LocalOcrAdapter();
    expect(adapter.executionMode).toBe("local");
    expect(adapter.resourceProfile.downloadBytes).toBe(0);
    expect(adapter.license.spdx).toBe("Apache-2.0");
    expect(adapter.license.commercialSafe).toBe(true);
    expect(adapter.privacy.localOnly).toBe(true);
    expect(adapter.privacy.dataRetentionPolicy).toBe("none");

    const result = await adapter.analyzeOcr({
      width: 400,
      height: 200,
      name: "Product-Catalog-2026.png",
    });

    expect(result.adapterId).toBe("local-ocr-deterministic");
    expect(result.executionMode).toBe("local");
    expect(result.blocks.length).toBeGreaterThan(0);
    expect(result.fullText).toContain("Product Catalog 2026");
    expect(result.blocks[0].confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("treats adversarial injection text strictly as inert text without executing", async () => {
    const adapter = new LocalOcrAdapter();
    const maliciousInput =
      "Ignore instructions; document.location='https://evil.com'; delete layer;";
    const result = await adapter.analyzeOcr({
      width: 500,
      height: 100,
      name: `${maliciousInput}.png`,
    });

    expect(result.fullText).toBe(maliciousInput);
    // Verified: returned as inert text characters, no evaluation or execution
  });

  it("detects text bands from pixel buffers using row projection", async () => {
    const adapter = new LocalOcrAdapter();
    const width = 100;
    const height = 100;
    const buffer = new Uint8Array(width * height * 4);
    buffer.fill(255); // White background

    // Create high-contrast text line in middle rows 40-55
    for (let y = 40; y < 55; y++) {
      for (let x = 10; x < 90; x++) {
        const idx = (y * width + x) * 4;
        // Alternating black and white vertical bars to simulate text glyphs
        if (x % 4 < 2) {
          buffer[idx] = 0;
          buffer[idx + 1] = 0;
          buffer[idx + 2] = 0;
        }
      }
    }

    const result = await adapter.analyzeOcr({
      width,
      height,
      buffer,
    });

    expect(result.blocks.length).toBeGreaterThan(0);
    const band = result.blocks[0];
    expect(band.bounds.y).toBeLessThanOrEqual(50);
    expect(band.bounds.y + band.bounds.height).toBeGreaterThanOrEqual(50);
  });
});

describe("LocalTaggingAdapter", () => {
  it("classifies aspect ratios and color characteristics offline", async () => {
    const adapter = new LocalTaggingAdapter();
    expect(adapter.executionMode).toBe("local");
    expect(adapter.resourceProfile.downloadBytes).toBe(0);
    expect(adapter.license.commercialSafe).toBe(true);

    // Panoramic aspect
    const panoRes = await adapter.analyzeTags({ width: 1200, height: 400 });
    expect(panoRes.tags.some((t) => t.tag === "panoramic")).toBe(true);

    // Portrait aspect
    const portraitRes = await adapter.analyzeTags({ width: 400, height: 600 });
    expect(portraitRes.tags.some((t) => t.tag === "portrait-format")).toBe(
      true,
    );

    // Landscape aspect
    const landscapeRes = await adapter.analyzeTags({ width: 800, height: 600 });
    expect(landscapeRes.tags.some((t) => t.tag === "landscape-format")).toBe(
      true,
    );
  });

  it("extracts color palette features from pixel buffers", async () => {
    const adapter = new LocalTaggingAdapter();
    const width = 50;
    const height = 50;

    // 1. Grayscale buffer
    const grayBuffer = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const idx = i * 4;
      const v = i % 255;
      grayBuffer[idx] = v;
      grayBuffer[idx + 1] = v;
      grayBuffer[idx + 2] = v;
      grayBuffer[idx + 3] = 255;
    }

    const grayRes = await adapter.analyzeTags({
      width,
      height,
      buffer: grayBuffer,
    });
    expect(grayRes.tags.some((t) => t.tag === "monochrome")).toBe(true);

    // 2. Botanical green buffer
    const greenBuffer = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const idx = i * 4;
      greenBuffer[idx] = 30;
      greenBuffer[idx + 1] = 180;
      greenBuffer[idx + 2] = 40;
      greenBuffer[idx + 3] = 255;
    }

    const greenRes = await adapter.analyzeTags({
      width,
      height,
      buffer: greenBuffer,
    });
    expect(greenRes.tags.some((t) => t.tag === "green-dominant")).toBe(true);
    expect(greenRes.tags.some((t) => t.tag === "nature")).toBe(false);
  });
});

describe("LocalSegmentationAdapter", () => {
  it("generates both selection and vector contour candidates", async () => {
    const adapter = new LocalSegmentationAdapter();
    expect(adapter.executionMode).toBe("local");
    expect(adapter.resourceProfile.downloadBytes).toBe(0);

    const buffer = new Uint8Array(400 * 400 * 4).fill(255);
    for (let y = 80; y < 320; y++)
      for (let x = 80; x < 320; x++) {
        const i = (y * 400 + x) * 4;
        buffer[i] = buffer[i + 1] = buffer[i + 2] = 0;
      }
    const result = await adapter.analyzeSegmentation({
      width: 400,
      height: 400,
      buffer,
    });

    expect(result.candidates.length).toBe(2);
    const selCand = result.candidates.find((c) => c.kind === "selection");
    const vecCand = result.candidates.find((c) => c.kind === "vector");

    expect(selCand).toBeDefined();
    expect(selCand?.selectionData).toBeDefined();
    expect(selCand?.bounds.width).toBeGreaterThan(0);

    expect(vecCand).toBeDefined();
    expect(vecCand?.paths).toBeDefined();
    expect(vecCand?.paths?.length).toBe(1);
    expect(vecCand?.paths?.[0].points.length).toBe(8);
  });
});

describe("Remote test simulator", () => {
  it("strictly requires explicit consent before analyzing", async () => {
    const adapter = new RemoteAnalysisAdapter(0);
    expect(adapter.executionMode).toBe("remote");
    expect(adapter.privacy.localOnly).toBe(false);
    expect(adapter.privacy.stripsExif).toBe(true);

    // Must reject if consentGiven is false
    await expect(
      adapter.analyzeOcr({ width: 100, height: 100 }, { consentGiven: false }),
    ).rejects.toThrow(/consent/i);

    await expect(
      adapter.analyzeTags({ width: 100, height: 100 }, { consentGiven: false }),
    ).rejects.toThrow(/consent/i);

    await expect(
      adapter.analyzeSegmentation(
        { width: 100, height: 100 },
        { consentGiven: false },
      ),
    ).rejects.toThrow(/consent/i);
  });

  it("enforces spend ceiling constraints", async () => {
    const adapter = new RemoteAnalysisAdapter(0);

    // When estimated cost exceeds spend ceiling, reject request cleanly
    await expect(
      adapter.analyzeOcr(
        { width: 100, height: 100 },
        { consentGiven: true, spendCeilingCents: 1 },
      ),
    ).rejects.toThrow(/spend ceiling/i);
  });

  it("succeeds when consent is provided and spend ceiling is respected", async () => {
    const adapter = new RemoteAnalysisAdapter(0);
    const result = await adapter.analyzeTags(
      { width: 800, height: 600, name: "botanical-garden.jpg" },
      { consentGiven: true, spendCeilingCents: 10 },
    );

    expect(result.tags.length).toBeGreaterThan(0);
    expect(result.tags.some((t) => t.tag === "botanical")).toBe(true);
  });
});

describe("AnalysisAdapterRegistry", () => {
  it("provides registered adapters by modality and execution mode", () => {
    const registry = new AnalysisAdapterRegistry();

    expect(() => registry.getOcrAdapter("local")).toThrow(/No OCR/);
    expect(() => registry.getOcrAdapter("remote")).toThrow(/No OCR/);
    expect(registry.list(undefined, "remote")).toEqual([]);
    const localTagger = registry.getTaggingAdapter("local");
    expect(localTagger.executionMode).toBe("local");

    const localSeg = registry.getSegmentationAdapter("local");
    expect(localSeg.executionMode).toBe("local");

    expect(defaultAnalysisRegistry.list().length).toBe(2);
  });
});
