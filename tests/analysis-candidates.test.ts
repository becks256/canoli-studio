import { AnalysisAdapterRegistry } from "../src/intelligence/adapters/registry";
import { LocalOcrAdapter } from "./fixtures/analysis/local-ocr";
import { describe, expect, it } from "vitest";
import { Document, RasterLayer, TextLayer, LayerGroup } from "../src/dom";
import { AnalysisService } from "../src/intelligence/candidates/service";
import type { OcrCandidate } from "../src/intelligence/candidates/types";
import type { ImageAsset } from "../src/core/assets";

function createFixture() {
  const document = new Document();
  const layer = document.layers.add(
    new RasterLayer({ assetId: "test-asset-1", width: 400, height: 300 }),
  );
  const asset: ImageAsset = {
    id: "test-asset-1",
    name: "vintage-poster-artwork.png",
    width: 400,
    height: 300,
    blob: new Blob([], { type: "image/png" }),
    bitmap: {} as ImageBitmap,
    thumbnail: "data:image/png;base64,",
  };
  return { document, layer, asset };
}

function createService() {
  const registry = new AnalysisAdapterRegistry();
  const ocr = new LocalOcrAdapter();
  ocr.analyzeOcr = async () => ({
    adapterId: ocr.id,
    executionMode: "local",
    durationMs: 0,
    fullText: "Fixture",
    blocks: [
      {
        id: "fixture",
        text: "Fixture",
        confidence: 1,
        bounds: { x: 20, y: 30, width: 40, height: 50 },
      },
    ],
  });
  registry.register(ocr); // Explicit test simulator, never production registration.
  return new AnalysisService(registry, (asset) => {
    const buffer = new Uint8Array(asset.width * asset.height * 4).fill(255);
    for (let y = 40; y < 200; y++)
      for (let x = 50; x < 300; x++) {
        const i = (y * asset.width + x) * 4;
        buffer[i] = buffer[i + 1] = buffer[i + 2] = 0;
      }
    return { width: asset.width, height: asset.height, buffer };
  });
}

describe("AnalysisService and Candidate Lifecycle", () => {
  it("proposes tag candidates, accepts into LayerMetadata with full undo/redo", async () => {
    const { document, layer, asset } = createFixture();
    const service = createService();

    // 1. Run tagging
    const candidates = await service.runAnalysis(
      layer,
      asset,
      "tagging",
      "local",
    );
    expect(candidates.length).toBeGreaterThan(0);
    const tagCandidate = candidates.find((c) => c.kind === "tag")!;
    expect(tagCandidate).toBeDefined();
    expect(tagCandidate.status).toBe("proposed");
    expect(tagCandidate.origin).toBe("local");

    // 2. Accept candidate
    service.acceptCandidate(document, tagCandidate);
    expect(
      service.getCandidates(layer.id).find((c) => c.id === tagCandidate.id)!
        .status,
    ).toBe("accepted");
    expect(layer.metadata.keywords).toContain(tagCandidate.tag);

    // 3. Undo transaction
    document.undo();
    expect(layer.metadata.keywords).not.toContain(tagCandidate.tag);

    // 4. Redo transaction
    document.redo();
    expect(layer.metadata.keywords).toContain(tagCandidate.tag);
  });

  it("proposes OCR candidates, accepts as TextLayer with undo/redo", async () => {
    const { document, layer, asset } = createFixture();
    const service = createService();

    // 1. Run OCR
    const candidates = await service.runAnalysis(layer, asset, "ocr", "local");
    expect(candidates.length).toBeGreaterThan(0);
    const ocrCandidate = candidates.find((c) => c.kind === "ocr")!;
    expect(ocrCandidate.status).toBe("proposed");

    const initialLayerCount = document.layers.length;

    // 2. Accept as TextLayer
    service.acceptCandidate(document, ocrCandidate, "text-layer");
    expect(
      service.getCandidates(layer.id).find((c) => c.id === ocrCandidate.id)!
        .status,
    ).toBe("accepted");
    expect(document.layers.length).toBe(initialLayerCount + 1);

    const addedLayer = document.layers.at(initialLayerCount);
    expect(addedLayer).toBeInstanceOf(TextLayer);
    expect((addedLayer as TextLayer).text).toBe(ocrCandidate.text);

    // 3. Undo/Redo
    document.undo();
    expect(document.layers.length).toBe(initialLayerCount);
    document.redo();
    expect(document.layers.length).toBe(initialLayerCount + 1);
  });

  it("accepts OCR candidates as marquee selection", async () => {
    const { document, layer, asset } = createFixture();
    const service = createService();

    const candidates = await service.runAnalysis(layer, asset, "ocr", "local");
    const ocrCandidate = candidates.find(
      (c): c is OcrCandidate => c.kind === "ocr",
    )!;

    service.acceptCandidate(document, ocrCandidate, "selection");
    expect(document.selection).not.toBeNull();
    const regions = document.selection!.regions;
    expect(regions.length).toBe(1);
    expect(regions[0].x).toBe(ocrCandidate.bounds.x);
    expect(regions[0].y).toBe(ocrCandidate.bounds.y);
  });

  it("proposes segmentation candidates, applies LayerMask with undo/redo", async () => {
    const { document, layer, asset } = createFixture();
    const service = createService();

    // 1. Run segmentation
    const candidates = await service.runAnalysis(
      layer,
      asset,
      "segmentation",
      "local",
    );
    expect(candidates.length).toBeGreaterThan(0);
    const segCandidate = candidates.find((c) => c.kind === "segmentation")!;
    expect(segCandidate.status).toBe("proposed");
    expect(layer.mask).toBeNull();

    // 2. Accept segmentation candidate
    service.acceptCandidate(document, segCandidate);
    expect(
      service.getCandidates(layer.id).find((c) => c.id === segCandidate.id)!
        .status,
    ).toBe("accepted");
    expect(layer.mask).not.toBeNull();
    expect(layer.mask?.kind).toBe(
      segCandidate.maskOptions.selection ? "selection" : "vector",
    );

    // 3. Undo removes mask
    document.undo();
    expect(layer.mask).toBeNull();

    // 4. Redo restores mask
    document.redo();
    expect(layer.mask).not.toBeNull();
  });

  it("rejects candidates without mutating document history", async () => {
    const { document, layer, asset } = createFixture();
    const service = createService();

    const candidates = await service.runAnalysis(
      layer,
      asset,
      "tagging",
      "local",
    );
    const cand = candidates[0];

    const snapshotBefore = document.toJSON();
    service.rejectCandidate(cand);
    expect(
      service.getCandidates(layer.id).find((c) => c.id === cand.id)!.status,
    ).toBe("rejected");
    expect(document.toJSON()).toEqual(snapshotBefore);
  });

  it("enforces layer lock and rolls back on locked layers", async () => {
    const { document, layer, asset } = createFixture();
    const service = createService();

    const candidates = await service.runAnalysis(
      layer,
      asset,
      "tagging",
      "local",
    );
    const cand = candidates[0];

    layer.locked = true;
    expect(() => service.acceptCandidate(document, cand)).toThrow(/unlock/i);
    expect(cand.status).toBe("proposed");
  });
});

it("maps sampled geometry through placed scale and nested position, and rejects replay", async () => {
  const { document, layer, asset } = createFixture();
  const parent = document.layers.add(new LayerGroup({ x: 30, y: 10 }));
  layer.moveTo(parent);
  layer.x = 20;
  layer.y = 10;
  layer.width = 40;
  layer.height = 30;
  const service = createService();
  const [ocr] = await service.runAnalysis(layer, asset, "ocr");
  const before = service.getCandidates(layer.id);
  service.acceptCandidate(document, ocr);
  const text = document.layers.at(document.layers.length - 1)!;
  expect({ x: text.x, y: text.y }).toEqual({ x: 52, y: 23 });
  expect(service.getCandidates(layer.id)).not.toBe(before);
  expect(before[0].status).toBe("proposed");
  expect(() => service.acceptCandidate(document, ocr)).toThrow(/no longer/);
  const candidates = await service.runAnalysis(layer, asset, "segmentation");
  const mask = candidates.find((c) => c.kind === "segmentation")!;
  service.acceptCandidate(document, mask);
  if (mask.kind !== "segmentation") throw new Error("Expected segmentation");
  expect(layer.mask!.selection.regions[0].width).toBeCloseTo(
    mask.bounds.width * 0.1,
  );
  const [tag] = await service.runAnalysis(layer, asset, "tagging");
  const snapshot = service.getCandidates(layer.id);
  service.rejectCandidate(tag);
  expect(service.getCandidates(layer.id)).not.toBe(snapshot);
  expect(() => service.acceptCandidate(document, tag)).toThrow(/no longer/);
});
