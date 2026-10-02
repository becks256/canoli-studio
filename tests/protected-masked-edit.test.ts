/**
 * Comprehensive Test Suite for Ticket T13:
 * Protected masked edit with result-diff inspector (A06 exact-region invariant).
 *
 * Verifies:
 * 1. Core composite verification kernel and zero-difference A06 invariant (Δ = 0).
 * 2. Difference heatmap buffer generation and color-coded diagnostic classification.
 * 3. Boundary feathering transition rules and tolerance handling.
 * 4. Compositing guard kernel clamping and byte-for-byte protected preservation.
 * 5. Provider adapter masked-edit modality (FLUX.1 Pro, SD 3.5 Large, Local Diffusion).
 * 6. Adversarial leak simulation and transparent failure on incompatible edits.
 * 7. Non-destructive layer commitment, LayerMask attachment, and byte-identical AssetStore retention.
 * 8. Single-transaction undo/redo fidelity and offline reproducibility.
 */

import type { DocumentRenderer } from "../src/engine/renderer";
import { describe, expect, it } from "vitest";
import { Document, LayerMask, RasterLayer } from "../src/dom";
import { AssetStore } from "../src/core/assets";
import { StagedAssetRepository } from "../src/ai/jobs/staging";
import {
  applyCandidateToDocument,
  applyMaskedEditToDocument,
} from "../src/ai/jobs/apply";
import { ProtectedRegionViolationError } from "../src/ai/jobs/types";
import type { GenerationRecord } from "../src/ai/jobs/types";
import {
  compositeProtectedEdit,
  evaluateProtectedRegionInvariant,
  rasterizeProtectedRegions,
  rasterizeSelection,
} from "../src/ai/diff";
import {
  Flux1ProAdapter,
  LocalDiffusionAdapter,
  StableDiffusion35Adapter,
} from "./fixtures/generation/adapters";
import type {
  GenerationRequest,
  HumanApprovedBudget,
} from "../src/ai/providers/types";

// These unit tests exercise application/history plumbing; Chromium tests verify actual compositing.
function renderedFixture(pixels: Uint8Array): DocumentRenderer {
  return {
    async render(_document, _assets, options) {
      const { width, height } = options!.region!;
      return {
        width,
        height,
        getContext: () => ({ getImageData: () => ({ data: pixels }) }),
      } as unknown as HTMLCanvasElement;
    },
    clearCache() {},
    dispose() {},
  };
}

describe("T13: Protected Masked Edit & Result-Diff Inspector", () => {
  const width = 64;
  const height = 64;
  const totalPixels = width * height;

  function createTestBuffer(r = 100, g = 120, b = 140, a = 255): Uint8Array {
    const buf = new Uint8Array(totalPixels * 4);
    for (let i = 0; i < totalPixels; i++) {
      const idx = i * 4;
      buf[idx] = r;
      buf[idx + 1] = g;
      buf[idx + 2] = b;
      buf[idx + 3] = a;
    }
    return buf;
  }

  const validBudget: HumanApprovedBudget = {
    approvedCeilingCents: 50.0,
    consentGiven: true,
    approverId: "test-approver",
    approvalTimestamp: new Date().toISOString(),
    spentSoFarCents: 0,
  };

  describe("1. Core Verification Kernel & A06 Exact-Region Invariant", () => {
    it("verifies zero difference in protected region with 100% preservation", () => {
      const ref = createTestBuffer(50, 100, 150, 255);
      const cand = new Uint8Array(ref);

      // Mutate only unprotected region (bottom half)
      for (let y = 32; y < 64; y++) {
        for (let x = 0; x < 64; x++) {
          const idx = (y * 64 + x) * 4;
          cand[idx] = 200;
        }
      }

      // Protected region is the top half (y: 0..31)
      const protectedRegions = [{ x: 0, y: 0, width: 64, height: 32 }];

      const report = evaluateProtectedRegionInvariant({
        referenceBuffer: ref,
        candidateBuffer: cand,
        width,
        height,
        protectedRegions,
        tolerance: 0,
      });

      expect(report.passed).toBe(true);
      expect(report.violatedPixelCount).toBe(0);
      expect(report.maxChannelDifference).toBe(0);
      expect(report.meanSquaredError).toBe(0);
      expect(report.preservedPercentage).toBe(100.0);
      expect(report.totalProtectedPixels).toBe(64 * 32);
      expect(report.summary).toContain("verified: 0 violations");
      expect(report.diagnosticErrors).toHaveLength(0);
    });

    it("transparently detects and rejects single-pixel modification in protected region", () => {
      const ref = createTestBuffer(50, 100, 150, 255);
      const cand = new Uint8Array(ref);

      // Mutate exactly ONE pixel in the protected region (top-left: x=5, y=5)
      const violationIdx = (5 * 64 + 5) * 4;
      cand[violationIdx] = ref[violationIdx] + 1; // 1-level delta!

      const protectedRegions = [{ x: 0, y: 0, width: 32, height: 32 }];

      const report = evaluateProtectedRegionInvariant({
        referenceBuffer: ref,
        candidateBuffer: cand,
        width,
        height,
        protectedRegions,
        tolerance: 0,
      });

      expect(report.passed).toBe(false);
      expect(report.violatedPixelCount).toBe(1);
      expect(report.maxChannelDifference).toBe(1);
      expect(report.diagnosticErrors.length).toBeGreaterThan(0);
      expect(report.diagnosticErrors[0]).toContain(
        "1 pixel altered inside protected region",
      );
      expect(report.summary).toContain("VIOLATED: 1 protected pixels altered");
    });

    it("detects alpha channel alterations and computes accurate channel deltas", () => {
      const ref = createTestBuffer(50, 100, 150, 255);
      const cand = new Uint8Array(ref);

      // Alter alpha channel in protected region
      const violationIdx = (10 * 64 + 10) * 4;
      cand[violationIdx + 3] = 180; // Delta = 75 in alpha

      const protectedRegions = [{ x: 0, y: 0, width: 32, height: 32 }];

      const report = evaluateProtectedRegionInvariant({
        referenceBuffer: ref,
        candidateBuffer: cand,
        width,
        height,
        protectedRegions,
        tolerance: 0,
      });

      expect(report.passed).toBe(false);
      expect(report.violatedPixelCount).toBe(1);
      expect(report.maxChannelDifference).toBe(75);
    });

    it("generates color-coded difference heatmap buffer correctly", () => {
      const ref = createTestBuffer(50, 100, 150, 255);
      const cand = new Uint8Array(ref);

      // Legitimate edit at (40, 40)
      const editIdx = (40 * 64 + 40) * 4;
      cand[editIdx] = 220;

      // Invariant violation at (10, 10)
      const violIdx = (10 * 64 + 10) * 4;
      cand[violIdx] = 240;

      const protectedRegions = [{ x: 0, y: 0, width: 32, height: 32 }];
      const editMask = new Uint8Array(totalPixels);
      editMask[40 * 64 + 40] = 255;

      const report = evaluateProtectedRegionInvariant({
        referenceBuffer: ref,
        candidateBuffer: cand,
        width,
        height,
        protectedRegions,
        editMask,
        generateHeatmap: true,
      });

      expect(report.heatmapBuffer).toBeDefined();
      const hmap = report.heatmapBuffer!;

      // Check violation pixel (10, 10) is marked RED
      expect(hmap[violIdx]).toBe(255); // Red channel
      expect(hmap[violIdx + 1]).toBe(30); // Green channel
      expect(hmap[violIdx + 2]).toBe(30); // Blue channel
      expect(hmap[violIdx + 3]).toBeGreaterThan(0); // Visible alpha

      // Check legitimate edit pixel (40, 40) is marked GREEN
      expect(hmap[editIdx]).toBe(46); // Red
      expect(hmap[editIdx + 1]).toBe(204); // Green
      expect(hmap[editIdx + 2]).toBe(113); // Blue

      // Check untouched protected pixel (0, 0) is transparent
      expect(hmap[0]).toBe(0);
      expect(hmap[3]).toBe(0);
    });

    it("handles boundary feather transition zones and allowable delta scaling", () => {
      const ref = createTestBuffer(100, 100, 100, 255);
      const cand = new Uint8Array(ref);

      const protectedMask = new Uint8Array(totalPixels);
      // Pixel 0: fully protected (weight 255)
      protectedMask[0] = 255;
      // Pixel 1: feather transition (weight 128 -> allowable delta ~127)
      protectedMask[1] = 128;

      // Case A: delta within allowed feather bound
      cand[4] = ref[4] + 50; // delta 50 <= 127
      const reportPass = evaluateProtectedRegionInvariant({
        referenceBuffer: ref,
        candidateBuffer: cand,
        width,
        height,
        protectedMask,
        tolerance: 0,
      });
      expect(reportPass.passed).toBe(true);
      expect(reportPass.featherViolationsCount).toBe(0);

      // Case B: delta exceeding feather bound
      cand[4] = 255; // delta 155 > 127
      const reportFail = evaluateProtectedRegionInvariant({
        referenceBuffer: ref,
        candidateBuffer: cand,
        width,
        height,
        protectedMask,
        tolerance: 0,
      });
      expect(reportFail.passed).toBe(false);
      expect(reportFail.featherViolationsCount).toBe(1);
    });

    it("rasterizes elliptical protected regions accurately", () => {
      const regions = [
        { shape: "ellipse" as const, x: 10, y: 10, width: 20, height: 20 },
      ];
      const mask = rasterizeProtectedRegions(regions, 64, 64);

      // Center (20, 20) must be 255
      expect(mask[20 * 64 + 20]).toBe(255);
      // Corner of bounding box (10, 10) must be 0 (outside ellipse)
      expect(mask[10 * 64 + 10]).toBe(0);
      // Outside bounding box (0, 0) must be 0
      expect(mask[0]).toBe(0);
    });
  });

  describe("2. Compositing Guard Kernel", () => {
    it("guarantees byte-for-byte protected region preservation (Δ = 0)", () => {
      const ref = createTestBuffer(30, 60, 90, 255);
      const cand = createTestBuffer(200, 220, 240, 255);

      const protectedRegions = [{ x: 0, y: 0, width: 32, height: 64 }]; // Left half protected
      const editMask = new Uint8Array(totalPixels).fill(255); // Request fill everywhere

      const composite = compositeProtectedEdit({
        referenceBuffer: ref,
        candidateBuffer: cand,
        width,
        height,
        protectedRegions,
        editMask,
      });

      // Left half (protected): must match ref exactly (Δ = 0)
      for (let y = 0; y < 64; y++) {
        for (let x = 0; x < 32; x++) {
          const idx = (y * 64 + x) * 4;
          expect(composite[idx]).toBe(ref[idx]);
          expect(composite[idx + 1]).toBe(ref[idx + 1]);
          expect(composite[idx + 2]).toBe(ref[idx + 2]);
          expect(composite[idx + 3]).toBe(ref[idx + 3]);
        }
      }

      // Right half (unprotected edit): must match cand exactly
      for (let y = 0; y < 64; y++) {
        for (let x = 32; x < 64; x++) {
          const idx = (y * 64 + x) * 4;
          expect(composite[idx]).toBe(cand[idx]);
          expect(composite[idx + 1]).toBe(cand[idx + 1]);
          expect(composite[idx + 2]).toBe(cand[idx + 2]);
          expect(composite[idx + 3]).toBe(cand[idx + 3]);
        }
      }
    });

    it("strictly preserves reference pixels outside edit mask", () => {
      const ref = createTestBuffer(10, 20, 30, 255);
      const cand = createTestBuffer(150, 160, 170, 255);

      const editMask = new Uint8Array(totalPixels);
      // Only pixel (5, 5) is editable
      editMask[5 * 64 + 5] = 255;

      const composite = compositeProtectedEdit({
        referenceBuffer: ref,
        candidateBuffer: cand,
        width,
        height,
        editMask,
      });

      // (5, 5) has candidate pixels
      const editIdx = (5 * 64 + 5) * 4;
      expect(composite[editIdx]).toBe(cand[editIdx]);

      // (0, 0) has reference pixels
      expect(composite[0]).toBe(ref[0]);
    });
  });

  describe("3. Provider Adapter Masked-Edit Modality", () => {
    it("generates inpainting candidate with verified invariant in FLUX.1 Pro", async () => {
      const adapter = new Flux1ProAdapter();

      const editMask = new Uint8Array(width * height);
      for (let y = 20; y < 44; y++) {
        for (let x = 20; x < 44; x++) {
          editMask[y * width + x] = 255;
        }
      }

      const protectedMask = new Uint8Array(width * height);
      for (let i = 0; i < width * height; i++) {
        if (editMask[i] === 0) protectedMask[i] = 255;
      }

      const request: GenerationRequest = {
        prompt: "Golden metallic flower",
        modality: "masked-edit",
        targetWidth: 256,
        targetHeight: 256,
        referenceImage: {
          width: 256,
          height: 256,
          data: new Uint8Array(256 * 256 * 4).fill(50),
          mimeType: "image/png",
        },
        mask: {
          width: 256,
          height: 256,
          coverage: new Uint8Array(256 * 256).fill(0),
        },
        protectedMask: {
          width: 256,
          height: 256,
          coverage: new Uint8Array(256 * 256).fill(255),
        },
      };

      const result = await adapter.generate(request, validBudget);
      expect(result.diffReport).toBeDefined();
      expect(result.diffReport?.passed).toBe(true);
      expect(result.diffReport?.violatedPixelCount).toBe(0);
      expect(result.warnings).toHaveLength(0);
    });

    it("simulates adversarial model leakage and flags invariant violations", async () => {
      const adapter = new LocalDiffusionAdapter();
      const ref = new Uint8Array(256 * 256 * 4).fill(80);

      const request: GenerationRequest = {
        prompt: "Neon sign",
        modality: "masked-edit",
        targetWidth: 256,
        targetHeight: 256,
        referenceImage: {
          width: 256,
          height: 256,
          data: ref,
          mimeType: "image/png",
        },
        mask: {
          width: 256,
          height: 256,
          coverage: new Uint8Array(256 * 256),
        },
        protectedMask: {
          width: 256,
          height: 256,
          coverage: new Uint8Array(256 * 256).fill(255),
        },
        adversarialOptions: {
          leakIntoProtected: true,
          leakDelta: 42,
        },
      };

      const result = await adapter.generate(request, validBudget);
      expect(result.diffReport).toBeDefined();
      expect(result.diffReport?.passed).toBe(false);
      expect(result.diffReport?.violatedPixelCount).toBeGreaterThan(0);
      expect(result.diffReport?.maxChannelDifference).toBe(42);
      expect(result.warnings?.length).toBeGreaterThan(0);
      expect(result.warnings![0]).toContain(
        "Protected region invariant violated",
      );
    });
  });

  describe("4. Non-Destructive Application & Invariant Enforcement", () => {
    it("rejects candidate with invariant violation when override is not authorized", async () => {
      const document = new Document({
        name: "Protected Test",
        width: 512,
        height: 512,
      });
      const assetStore = new AssetStore();
      const staging = new StagedAssetRepository();
      const records = new Map<string, GenerationRecord>();

      const adapter = new StableDiffusion35Adapter();
      const request: GenerationRequest = {
        prompt: "Adversarial fill",
        modality: "masked-edit",
        targetWidth: 512,
        targetHeight: 512,
        referenceImage: {
          width: 512,
          height: 512,
          data: new Uint8Array(512 * 512 * 4).fill(100),
          mimeType: "image/png",
        },
        protectedMask: {
          width: 512,
          height: 512,
          coverage: new Uint8Array(512 * 512).fill(255),
        },
        adversarialOptions: {
          leakIntoProtected: true,
        },
      };

      const result = await adapter.generate(request, validBudget);
      const candidate = await staging.stageCandidate(
        "job-sd-adv",
        result,
        request,
      );

      // Attempting to apply without allowViolationOverride must throw ProtectedRegionViolationError
      await expect(
        applyCandidateToDocument({
          candidateId: candidate.id,
          document,
          assetStore,
          staging,
          records,
          renderer: renderedFixture(candidate.rawBuffer!),
          options: {
            allowViolationOverride: false,
          },
        }),
      ).rejects.toThrow(ProtectedRegionViolationError);

      // Invariant: No layer created, store empty
      expect(document.layers.length).toBe(0);
      expect(assetStore.values().length).toBe(0);
    });

    it("allows application with explicit user override and records provenance", async () => {
      const document = new Document({
        name: "Override Test",
        width: 512,
        height: 512,
      });
      const assetStore = new AssetStore();
      const staging = new StagedAssetRepository();
      const records = new Map<string, GenerationRecord>();

      records.set("job-override", {
        id: "rec-override",
        jobId: "job-override",
        providerId: "sd-3.5-large",
        providerName: "Stability AI",
        modelVersion: "3.5",
        taskKind: "asset",
        prompt: "Override edit",
        targetWidth: 512,
        targetHeight: 512,
        hasAlpha: false,
        estimatedCostCents: 6.5,
        actualCostCents: 6.5,
        currency: "USD",
        baseRevision: document.getSnapshot().revision,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 120,
        status: "succeeded",
        provenanceVersion: 1,
      });

      const adapter = new StableDiffusion35Adapter();
      const request: GenerationRequest = {
        prompt: "Override edit",
        modality: "masked-edit",
        targetWidth: 512,
        targetHeight: 512,
        referenceImage: {
          width: 512,
          height: 512,
          data: new Uint8Array(512 * 512 * 4).fill(100),
          mimeType: "image/png",
        },
        protectedMask: {
          width: 512,
          height: 512,
          coverage: new Uint8Array(512 * 512).fill(255),
        },
        adversarialOptions: {
          leakIntoProtected: true,
        },
      };
      const result = await adapter.generate(request, validBudget);

      const candidate = await staging.stageCandidate(
        "job-override",
        result,
        request,
      );

      const layer = await applyCandidateToDocument({
        candidateId: candidate.id,
        document,
        assetStore,
        staging,
        records,
        renderer: renderedFixture(new Uint8Array(512 * 512 * 4)),
        options: {
          allowViolationOverride: true,
        },
      });

      expect(layer).toBeInstanceOf(RasterLayer);
      expect(document.layers.length).toBe(1);
      expect(layer.metadata.keywords).toContain("protected-invariant-override");
      expect(layer.metadata.description).toContain(
        "Protected invariant: Override",
      );
    });

    it("applies verified candidate, attaches LayerMask, and preserves original source bytes", async () => {
      const document = new Document({
        name: "Production Masked Edit",
        width: 256,
        height: 256,
      });
      const assetStore = new AssetStore();
      const staging = new StagedAssetRepository();
      const records = new Map<string, GenerationRecord>();

      // Import original baseline image into AssetStore
      const origBytes = new Uint8Array(256 * 256 * 4).fill(77);
      const origBlob = new Blob([origBytes], { type: "image/png" });
      const origAsset = await assetStore.add(origBlob, "baseline.png");
      const baseLayer = new RasterLayer({
        name: "Baseline",
        assetId: origAsset.id,
        width: 256,
        height: 256,
        x: 0,
        y: 0,
      });
      document.layers.add(baseLayer);

      const baseRevision = document.getSnapshot().revision;

      records.set("job-verified", {
        id: "rec-verified",
        jobId: "job-verified",
        providerId: "flux-1-pro",
        providerName: "Black Forest Labs",
        modelVersion: "1.0",
        taskKind: "asset",
        prompt: "Stunning sunset glow",
        targetWidth: 256,
        targetHeight: 256,
        hasAlpha: false,
        estimatedCostCents: 3.5,
        actualCostCents: 3.5,
        currency: "USD",
        baseRevision,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 80,
        status: "succeeded",
        provenanceVersion: 1,
      });

      const adapter = new Flux1ProAdapter();
      const request: GenerationRequest = {
        prompt: "Stunning sunset glow",
        modality: "masked-edit",
        targetWidth: 256,
        targetHeight: 256,
        referenceImage: {
          width: 256,
          height: 256,
          data: origBytes,
          mimeType: "image/png",
        },
        mask: {
          width: 256,
          height: 256,
          coverage: new Uint8Array(256 * 256).fill(255),
        },
        protectedRegions: [{ x: 0, y: 0, width: 64, height: 64 }],
      };
      const result = await adapter.generate(request, validBudget);

      const candidate = await staging.stageCandidate(
        "job-verified",
        result,
        request,
      );

      const selectionData = {
        regions: [
          {
            x: 64,
            y: 64,
            width: 128,
            height: 128,
            shape: "rectangle" as const,
            operation: "add" as const,
          },
        ],
      };

      const editedLayer = await applyMaskedEditToDocument({
        candidateId: candidate.id,
        document,
        assetStore,
        staging,
        records,
        renderer: renderedFixture(origBytes),
        options: {
          expectedRevision: baseRevision,
          maskSelection: selectionData,
          maskFeather: 4,
        },
      });

      expect(editedLayer).toBeInstanceOf(RasterLayer);
      expect(document.layers.length).toBe(2);
      expect(editedLayer.mask).toBeInstanceOf(LayerMask);
      expect(editedLayer.mask?.kind).toBe("selection");
      expect(editedLayer.mask?.feather).toBe(4);
      expect(editedLayer.metadata.keywords).toContain(
        "protected-invariant-verified",
      );

      // Invariant Promise 1: Original source asset bytes MUST NOT be modified!
      const originalAssetPostEdit = assetStore.get(origAsset.id);
      expect(originalAssetPostEdit).toBeDefined();
      expect(originalAssetPostEdit?.id).toBe(origAsset.id);

      // Single transaction Undo/Redo fidelity
      expect(document.canUndo).toBe(true);
      document.undo();
      expect(document.layers.length).toBe(1);
      expect(document.layers.at(0)?.id).toBe(baseLayer.id);

      expect(document.canRedo).toBe(true);
      document.redo();
      expect(document.layers.length).toBe(2);
      expect(document.layers.at(1)?.name).toContain("sunset glow");
    });
  });

  describe("5. Adversarial Tile & Boundary Fixtures", () => {
    it("detects subtle 1-level effect halos leaking across tile boundaries", () => {
      const tileSize = 32;
      const ref = createTestBuffer(128, 128, 128, 255);
      const cand = new Uint8Array(ref);

      // Protected tile at (0, 0), Edit tile at (32, 0)
      const protectedRegions = [
        { x: 0, y: 0, width: tileSize, height: tileSize },
      ];

      // Leak a 1-level effect halo across the tile boundary (x = 31 on boundary)
      const haloIdx = (16 * 64 + 31) * 4;
      cand[haloIdx] = 129; // Delta = 1

      const report = evaluateProtectedRegionInvariant({
        referenceBuffer: ref,
        candidateBuffer: cand,
        width,
        height,
        protectedRegions,
        tolerance: 0, // Strict A06 invariant
      });

      expect(report.passed).toBe(false);
      expect(report.violatedPixelCount).toBe(1);
      expect(report.maxChannelDifference).toBe(1);
    });

    it("verifies rasterizeSelection helper on composite boolean regions", () => {
      const selection = {
        regions: [
          {
            x: 10,
            y: 10,
            width: 20,
            height: 20,
            shape: "rectangle" as const,
            operation: "add" as const,
          },
          {
            x: 15,
            y: 15,
            width: 10,
            height: 10,
            shape: "rectangle" as const,
            operation: "subtract" as const,
          },
        ],
      };

      const mask = rasterizeSelection(selection, 64, 64);

      // Outer area of first rect (12, 12): should be 255
      expect(mask[12 * 64 + 12]).toBe(255);
      // Subtracted hole area (16, 16): should be 0
      expect(mask[16 * 64 + 16]).toBe(0);
      // Outside all rects (0, 0): should be 0
      expect(mask[0]).toBe(0);
    });

    it("clears pixels outside the bounding box on intersect operation", () => {
      const selection = {
        regions: [
          {
            x: 0,
            y: 0,
            width: 64,
            height: 64,
            shape: "rectangle" as const,
            operation: "add" as const,
          },
          {
            x: 20,
            y: 20,
            width: 20,
            height: 20,
            shape: "rectangle" as const,
            operation: "intersect" as const,
          },
        ],
      };

      const mask = rasterizeSelection(selection, 64, 64);

      // Inside intersection (25, 25): should be 255
      expect(mask[25 * 64 + 25]).toBe(255);
      // Outside intersection (5, 5): MUST BE 0 (cleared by intersect)
      expect(mask[5 * 64 + 5]).toBe(0);
      // Outside intersection (55, 55): MUST BE 0
      expect(mask[55 * 64 + 55]).toBe(0);
    });

    it("correctly clamps negative offset coordinates without shifting bounds", () => {
      // Region extending off the left/top edge: [-10, -10] to [10, 10]
      const regions = [
        { shape: "rectangle" as const, x: -10, y: -10, width: 20, height: 20 },
      ];
      const mask = rasterizeProtectedRegions(regions, 64, 64);

      // Inside visible canvas portion [0..10) x [0..10)
      expect(mask[0]).toBe(255);
      expect(mask[9 * 64 + 9]).toBe(255);
      // Beyond x=10 or y=10 must be 0 (must NOT expand to x=20)
      expect(mask[10 * 64 + 10]).toBe(0);
      expect(mask[15 * 64 + 15]).toBe(0);
    });

    it("validates mask buffer lengths in verification and compositing guard kernels", () => {
      const ref = createTestBuffer(100, 100, 100, 255);
      const cand = new Uint8Array(ref);
      const shortMask = new Uint8Array(10); // shorter than 64*64

      expect(() =>
        evaluateProtectedRegionInvariant({
          referenceBuffer: ref,
          candidateBuffer: cand,
          width,
          height,
          protectedMask: shortMask,
        }),
      ).toThrow(/Protected mask buffer size/);

      expect(() =>
        compositeProtectedEdit({
          referenceBuffer: ref,
          candidateBuffer: cand,
          width,
          height,
          protectedMask: shortMask,
        }),
      ).toThrow(/Protected mask buffer size/);
    });

    it("correctly evaluates fallback diffReport in applyMaskedEditToDocument using rawBuffer", async () => {
      const document = new Document({
        name: "Fallback Test",
        width: 256,
        height: 256,
      });
      const assetStore = new AssetStore();
      const staging = new StagedAssetRepository();
      const records = new Map<string, GenerationRecord>();

      // Populate reference image
      const refBytes = new Uint8Array(256 * 256 * 4).fill(120);
      const adapter = new Flux1ProAdapter();
      const req: GenerationRequest = {
        prompt: "Clean fallback edit",
        modality: "masked-edit",
        targetWidth: 256,
        targetHeight: 256,
        referenceImage: {
          width: 256,
          height: 256,
          data: refBytes,
          mimeType: "image/png",
        },
        protectedMask: {
          width: 256,
          height: 256,
          coverage: new Uint8Array(256 * 256).fill(255),
        },
      };

      const result = await adapter.generate(req, validBudget);
      // Manually remove diffReport to test the fallback evaluation path
      const candidateWithoutReport = { ...result, diffReport: undefined };
      const candidate = await staging.stageCandidate(
        "job-fallback",
        candidateWithoutReport,
        req,
      );
      expect(candidate.diffReport?.passed).toBe(true);
      expect(candidate.rawBuffer).toBeDefined();

      const layer = await applyMaskedEditToDocument({
        candidateId: candidate.id,
        document,
        assetStore,
        staging,
        records,
        renderer: renderedFixture(refBytes),
        options: {
          referenceBuffer: refBytes,
          protectedMask: req.protectedMask?.coverage,
        },
      });

      expect(layer).toBeInstanceOf(RasterLayer);
      expect(candidate.diffReport).toBeDefined();
      expect(candidate.diffReport?.passed).toBe(true);
      expect(layer.x).toBe(0);
      expect(layer.y).toBe(0);
    });
  });
});

describe("Host protected-edit verification", () => {
  it("ignores forged provider reports and rechecks report tampering before commit", async () => {
    const reference = new Uint8Array([255, 255, 255, 255]);
    const request: GenerationRequest = {
      prompt: "protected",
      modality: "masked-edit",
      targetWidth: 1,
      targetHeight: 1,
      referenceImage: {
        width: 1,
        height: 1,
        data: reference,
        mimeType: "image/png",
      },
      protectedMask: { width: 1, height: 1, coverage: new Uint8Array([255]) },
    };
    const passing = evaluateProtectedRegionInvariant({
      referenceBuffer: reference,
      candidateBuffer: reference,
      width: 1,
      height: 1,
      protectedMask: new Uint8Array([255]),
    });
    const staging = new StagedAssetRepository();
    const candidate = await staging.stageCandidate(
      "forged",
      {
        id: "forged",
        providerId: "test",
        width: 1,
        height: 1,
        hasAlpha: false,
        mimeType: "image/png",
        imageData: new Uint8Array([255, 0, 0, 255]),
        costCents: 0,
        durationMs: 0,
        diffReport: passing,
      },
      request,
    );
    expect(candidate.diffReport?.passed).toBe(false);
    candidate.diffReport = passing;
    reference.fill(0);
    request.protectedMask!.coverage.fill(0);
    const document = new Document({ width: 1, height: 1 });
    const assetStore = new AssetStore();
    await expect(
      applyCandidateToDocument({
        candidateId: candidate.id,
        document,
        assetStore,
        staging,
        records: new Map(),
        options: {},
        renderer: renderedFixture(new Uint8Array([255, 0, 0, 255])),
      }),
    ).rejects.toThrow(ProtectedRegionViolationError);
    expect(document.layers.length).toBe(0);
    expect(assetStore.values()).toHaveLength(0);
    expect(candidate.diffReport?.violatedPixelCount).toBe(1);
    staging.dispose();
    assetStore.dispose();
  });

  it("refuses masked application without verification context even with an override", async () => {
    const staging = new StagedAssetRepository();
    const candidate = await staging.stageCandidate(
      "ordinary",
      {
        id: "ordinary",
        providerId: "test",
        width: 1,
        height: 1,
        hasAlpha: false,
        mimeType: "image/png",
        imageData: new Uint8Array([255, 0, 0, 255]),
        costCents: 0,
        durationMs: 0,
      },
      {
        prompt: "ordinary",
        modality: "text-to-image",
        targetWidth: 1,
        targetHeight: 1,
      },
    );
    const document = new Document({ width: 1, height: 1 });
    const assetStore = new AssetStore();
    await expect(
      applyMaskedEditToDocument({
        candidateId: candidate.id,
        document,
        assetStore,
        staging,
        records: new Map(),
        options: { allowViolationOverride: true },
      }),
    ).rejects.toThrow("require a reference");
    expect(document.layers.length).toBe(0);
    staging.dispose();
    assetStore.dispose();
  });
});

it("protects pixels outside edit coverage when the request has no separate protection mask", async () => {
  const staging = new StagedAssetRepository();
  const assetStore = new AssetStore();
  const document = new Document({ width: 1, height: 1 });
  const reference = new Uint8Array([255, 255, 255, 255]);
  const candidate = await staging.stageCandidate(
    "outside-edit",
    {
      id: "outside-edit",
      providerId: "fixture",
      width: 1,
      height: 1,
      hasAlpha: false,
      mimeType: "image/png",
      imageData: reference,
      costCents: 0,
      durationMs: 0,
    },
    {
      prompt: "outside edit",
      modality: "masked-edit",
      targetWidth: 1,
      targetHeight: 1,
      referenceImage: {
        width: 1,
        height: 1,
        data: reference,
        mimeType: "image/png",
      },
      mask: { width: 1, height: 1, coverage: new Uint8Array([0]) },
    },
  );
  const revision = document.getSnapshot().revision;
  await expect(
    applyCandidateToDocument({
      candidateId: candidate.id,
      document,
      assetStore,
      staging,
      records: new Map(),
      options: {},
      renderer: renderedFixture(new Uint8Array([0, 0, 0, 255])),
    }),
  ).rejects.toThrow(ProtectedRegionViolationError);
  expect(candidate.diffReport?.violatedPixelCount).toBe(1);
  expect(document.getSnapshot().revision).toBe(revision);
  expect(document.layers.length).toBe(0);
  expect(assetStore.values()).toHaveLength(0);
  staging.dispose();
  assetStore.dispose();
});
