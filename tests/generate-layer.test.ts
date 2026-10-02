import { registerSimulationAdapters } from "./fixtures/generation/adapters";
/**
 * Unit & Integration Test Suite for Ticket T12:
 * Generate-as-Layer UI, Candidate Review and Apply Operation.
 *
 * Verifies:
 * - Concrete evaluated provider adapters (Flux1ProAdapter, StableDiffusion35Adapter, LocalDiffusionAdapter).
 * - Opaque composite and transparent cutout generation with edge antialiasing.
 * - Dimension conformance, modality filtering, and budget/consent enforcement.
 * - Candidate staging isolation (no document/undo pollution until approved).
 * - Revision conflict guard and explicit re-placement override.
 * - Single-entry document undo/redo preserving asset references without external API calls.
 * - Layer provenance metadata with zero credential leakage.
 * - Project serialization and offline reopen parity (preserves generated layers and assets).
 */

import { describe, expect, it } from "vitest";
import { LayerGroup, RasterLayer } from "../src/dom";
import { EditorApplication } from "../src/editor";
import {
  Flux1ProAdapter,
  LocalDiffusionAdapter,
  StableDiffusion35Adapter,
} from "./fixtures/generation/adapters";
import {
  BudgetExceededError,
  ConsentRequiredError,
  JobCancelledError,
  RevisionConflictError,
} from "../src/ai/jobs/types";
import type { HumanApprovedBudget } from "../src/ai/providers/types";
import { readProject } from "../src/core/project";

// Worker stub for Node test environment (for EditorApplication's PixelProcessor)
if (typeof globalThis.Worker === "undefined") {
  globalThis.Worker = class MockWorker {
    postMessage() {}
    addEventListener() {}
    removeEventListener() {}
    terminate() {}
  } as unknown as typeof Worker;
}

// ImageBitmap stub for Node test environment
if (typeof globalThis.createImageBitmap === "undefined") {
  globalThis.createImageBitmap = (async (source: any) => {
    let width = 512;
    let height = 512;
    if (source instanceof Blob) {
      const buf = await source.arrayBuffer();
      const bytes = new Uint8Array(buf);
      if (
        bytes.length >= 24 &&
        bytes[0] === 137 &&
        bytes[1] === 80 &&
        bytes[2] === 78 &&
        bytes[3] === 71
      ) {
        const view = new DataView(buf);
        width = view.getUint32(16);
        height = view.getUint32(20);
      }
    } else if (
      source &&
      typeof source.width === "number" &&
      typeof source.height === "number"
    ) {
      width = source.width;
      height = source.height;
    }
    return {
      width,
      height,
      close: () => {},
    } as unknown as ImageBitmap;
  }) as typeof createImageBitmap;
}

describe("T12: Evaluated AI Provider Adapters", () => {
  const defaultBudget: HumanApprovedBudget = {
    approvedCeilingCents: 100, // $1.00
    spentSoFarCents: 0,
    approverId: "artist",
    consentGiven: true,
    approvalTimestamp: "2026-09-27T00:00:00Z",
  };

  it("FLUX.1 Pro generates opaque and transparent images with valid bounds", async () => {
    const adapter = new Flux1ProAdapter(0.001); // Fast simulated latency

    // 1. Opaque generation
    const opaqueResult = await adapter.generate(
      {
        prompt: "Cinematic portrait of a robot",
        modality: "text-to-image",
        targetWidth: 512,
        targetHeight: 512,
        requireAlpha: false,
      },
      defaultBudget,
    );

    expect(opaqueResult.width).toBe(512);
    expect(opaqueResult.height).toBe(512);
    expect(opaqueResult.hasAlpha).toBe(false);
    expect(opaqueResult.imageData.byteLength).toBe(512 * 512 * 4);
    expect(opaqueResult.costCents).toBe(3.5); // 3.5¢ standard cost

    // 2. Transparent cutout generation
    const cutoutResult = await adapter.generate(
      {
        prompt: "Isolated botanical fern",
        modality: "text-to-image",
        targetWidth: 512,
        targetHeight: 512,
        requireAlpha: true,
      },
      defaultBudget,
    );

    expect(cutoutResult.width).toBe(512);
    expect(cutoutResult.height).toBe(512);
    expect(cutoutResult.hasAlpha).toBe(true);

    // Verify alpha channel has both transparent (0) and opaque (255) pixels
    let zeroAlpha = 0;
    let fullAlpha = 0;
    let partialAlpha = 0;
    for (let i = 3; i < cutoutResult.imageData.length; i += 4) {
      const a = cutoutResult.imageData[i];
      if (a === 0) zeroAlpha++;
      else if (a === 255) fullAlpha++;
      else partialAlpha++;
    }

    expect(zeroAlpha).toBeGreaterThan(0);
    expect(fullAlpha).toBeGreaterThan(0);
    expect(partialAlpha).toBeGreaterThan(0); // Edge antialiasing
  });

  it("Stable Diffusion 3.5 Large accounts for secondary matting cost on cutouts", async () => {
    const adapter = new StableDiffusion35Adapter(0.001);

    // Standard opaque
    const opaqueResult = await adapter.generate(
      {
        prompt: "Retro sci-fi poster",
        modality: "text-to-image",
        targetWidth: 512,
        targetHeight: 512,
        requireAlpha: false,
      },
      defaultBudget,
    );
    expect(opaqueResult.costCents).toBe(6.5); // 6.5¢ standard cost

    // Cutout requiring two-pass matting
    const cutoutResult = await adapter.generate(
      {
        prompt: "Retro robot cutout",
        modality: "text-to-image",
        targetWidth: 512,
        targetHeight: 512,
        requireAlpha: true,
      },
      defaultBudget,
    );
    // 6.5¢ base + 2.0¢ secondary matting = 8.5¢
    expect(cutoutResult.costCents).toBe(8.5);
  });

  it("Local On-Device diffusion charges zero cost", async () => {
    const adapter = new LocalDiffusionAdapter(0.001);

    const result = await adapter.generate(
      {
        prompt: "Local sketch",
        modality: "text-to-image",
        targetWidth: 512,
        targetHeight: 512,
        requireAlpha: false,
      },
      defaultBudget,
    );

    expect(result.costCents).toBe(0);
  });

  it("enforces dimension conformance bounds", async () => {
    const adapter = new Flux1ProAdapter(0.001);

    // Dimension too small
    await expect(
      adapter.generate(
        {
          prompt: "Tiny icon",
          modality: "text-to-image",
          targetWidth: 64,
          targetHeight: 64,
        },
        defaultBudget,
      ),
    ).rejects.toThrow(/exceed provider bounds/);

    // Dimension too large
    await expect(
      adapter.generate(
        {
          prompt: "Huge panorama",
          modality: "text-to-image",
          targetWidth: 4096,
          targetHeight: 4096,
        },
        defaultBudget,
      ),
    ).rejects.toThrow(/exceed provider bounds/);
  });

  it("rejects unsupported modalities", async () => {
    const adapter = new Flux1ProAdapter(0.001);

    await expect(
      adapter.generate(
        {
          prompt: "Segment this",
          modality: "segmentation" as any,
          targetWidth: 512,
          targetHeight: 512,
        },
        defaultBudget,
      ),
    ).rejects.toThrow(/does not support modality/);
  });

  it("enforces explicit human consent before generation", async () => {
    const adapter = new Flux1ProAdapter(0.001);

    await expect(
      adapter.generate(
        {
          prompt: "Unauthorized prompt",
          modality: "text-to-image",
          targetWidth: 512,
          targetHeight: 512,
        },
        { ...defaultBudget, consentGiven: false },
      ),
    ).rejects.toThrow(ConsentRequiredError);
  });

  it("enforces budget ceiling limit", async () => {
    const adapter = new Flux1ProAdapter(0.001);

    // Budget has only 1¢ remaining, but FLUX costs 4¢
    await expect(
      adapter.generate(
        {
          prompt: "Expensive request",
          modality: "text-to-image",
          targetWidth: 512,
          targetHeight: 512,
        },
        {
          ...defaultBudget,
          approvedCeilingCents: 10,
          spentSoFarCents: 9.5,
        },
      ),
    ).rejects.toThrow(BudgetExceededError);
  });

  it("supports cooperative cancellation via AbortSignal", async () => {
    const adapter = new Flux1ProAdapter(0.5); // Slower simulated latency
    const controller = new AbortController();

    const promise = adapter.generate(
      {
        prompt: "Cancel me quickly",
        modality: "text-to-image",
        targetWidth: 512,
        targetHeight: 512,
      },
      defaultBudget,
      controller.signal,
    );

    // Abort after 5ms
    setTimeout(() => controller.abort(), 5);

    await expect(promise).rejects.toThrow(JobCancelledError);
  });
});

describe("T12: Generate-as-Layer Application Workflow", () => {
  it("executes complete lifecycle: submit -> stage -> review -> apply -> undo/redo", async () => {
    const editor = new EditorApplication();
    registerSimulationAdapters(editor.ai.providerRegistry);
    editor.newDocument({ width: 1000, height: 800 });

    const doc = editor.document;
    expect(doc.layers.length).toBe(0);
    const initialRev = doc.getSnapshot().revision;

    // 1. Submit generation job
    const baseRevision = doc.getSnapshot().revision;
    const job = await editor.ai.submit(
      {
        prompt: "Stylized golden coin",
        modality: "text-to-image",
        targetWidth: 256,
        targetHeight: 256,
        requireAlpha: true,
      },
      {
        budgetId: "default-budget",
        baseRevision,
        providerId: "flux-1-pro",
      },
    );

    // 2. Wait for candidate result
    const candidate = await job.result();
    expect(candidate).toBeDefined();
    expect(candidate.width).toBe(256);
    expect(candidate.height).toBe(256);
    expect(candidate.hasAlpha).toBe(true);

    // 3. Staging isolation: document layers and undo history remain pristine
    expect(doc.layers.length).toBe(0);
    expect(doc.canUndo).toBe(false);
    expect(doc.getSnapshot().revision).toBe(initialRev);

    // 4. Apply candidate as a new layer
    const createdLayer = await editor.applyGeneratedCandidate(candidate.id, {
      expectedRevision: baseRevision,
      layerName: "Golden Coin",
      width: 256,
      height: 256,
    });

    expect(createdLayer).toBeInstanceOf(RasterLayer);
    expect(doc.layers.length).toBe(1);
    expect(doc.layers.at(0)).toBe(createdLayer);
    expect(createdLayer.name).toBe("Golden Coin");
    expect(createdLayer.width).toBe(256);
    expect(createdLayer.height).toBe(256);
    // Centered by default: (1000 - 256) / 2 = 372; (800 - 256) / 2 = 272
    expect(createdLayer.x).toBe(372);
    expect(createdLayer.y).toBe(272);

    // 5. Verify provenance metadata
    expect(createdLayer.name).toBe("Golden Coin");
    expect(createdLayer.metadata).toBeDefined();
    expect(createdLayer.metadata?.title).toContain("Stylized golden coin");
    expect(createdLayer.metadata?.description).toContain("FLUX.1 Pro");
    expect(createdLayer.metadata?.keywords).toContain("ai-generated");
    expect(createdLayer.metadata?.keywords).toContain("transparent");

    // Provenance security check: zero secret keys or tokens in metadata
    const metadataStr = JSON.stringify(createdLayer.metadata);
    expect(metadataStr).not.toContain("api_key");
    expect(metadataStr).not.toContain("apiKey");
    expect(metadataStr).not.toContain("auth_token");
    expect(metadataStr).not.toContain("secret");

    // 6. Single-entry Undo
    expect(doc.canUndo).toBe(true);
    doc.undo();
    expect(doc.layers.length).toBe(0);
    expect(doc.canUndo).toBe(false);
    expect(doc.canRedo).toBe(true);

    // 7. Single-entry Redo restores the exact layer and asset without external calls
    doc.redo();
    expect(doc.layers.length).toBe(1);
    expect(doc.layers.at(0)?.id).toBe(createdLayer.id);
    expect((doc.layers.at(0) as RasterLayer).assetId).toBe(
      createdLayer.assetId,
    );

    editor.dispose();
  });

  it("inserts generated layer into target LayerGroup if specified", async () => {
    const editor = new EditorApplication();
    registerSimulationAdapters(editor.ai.providerRegistry);
    editor.newDocument({ width: 800, height: 600 });
    const doc = editor.document;

    const group = new LayerGroup({ name: "Characters" });
    doc.layers.add(group);

    const baseRevision = doc.getSnapshot().revision;
    const job = await editor.ai.submit(
      {
        prompt: "Pixel hero",
        modality: "text-to-image",
        targetWidth: 256,
        targetHeight: 256,
      },
      {
        budgetId: "default-budget",
        baseRevision,
        providerId: "flux-1-pro",
      },
    );

    const candidate = await job.result();
    const createdLayer = await editor.applyGeneratedCandidate(candidate.id, {
      expectedRevision: baseRevision,
      parentId: group.id,
      layerName: "Hero Sprite",
    });

    expect(doc.layers.length).toBe(1);
    expect(doc.layers.at(0)).toBe(group);
    expect(group.layers.length).toBe(1);
    expect(group.layers.at(0)).toBe(createdLayer);

    editor.dispose();
  });

  it("handles revision concurrency conflicts cleanly", async () => {
    const editor = new EditorApplication();
    registerSimulationAdapters(editor.ai.providerRegistry);
    editor.newDocument({ width: 800, height: 600 });
    const doc = editor.document;

    const baseRevision = doc.getSnapshot().revision;
    const job = await editor.ai.submit(
      {
        prompt: "Mystic orb",
        modality: "text-to-image",
        targetWidth: 256,
        targetHeight: 256,
      },
      {
        budgetId: "default-budget",
        baseRevision,
        providerId: "flux-1-pro",
      },
    );

    const candidate = await job.result();

    // Document is edited while candidate is being reviewed
    doc.transaction("User manual edit", () => {
      doc.layers.add(new LayerGroup({ name: "Manual Group" }));
    });
    const newRevision = doc.getSnapshot().revision;
    expect(newRevision).toBeGreaterThan(baseRevision);

    // Attempting to apply with original baseRevision must throw RevisionConflictError
    await expect(
      editor.applyGeneratedCandidate(candidate.id, {
        expectedRevision: baseRevision,
      }),
    ).rejects.toThrow(RevisionConflictError);

    // Staging remains valid; user explicitly overrides/re-places via allowStaleRevision
    const layer = await editor.applyGeneratedCandidate(candidate.id, {
      expectedRevision: newRevision,
      allowStaleRevision: true,
      layerName: "Orb Layer",
    });

    expect(layer).toBeDefined();
    expect(doc.layers.length).toBe(2);

    editor.dispose();
  });

  it("preserves applied generated layers and assets across project save and reopen", async () => {
    const editor = new EditorApplication();
    registerSimulationAdapters(editor.ai.providerRegistry);
    editor.newDocument({ width: 640, height: 480 });
    const doc = editor.document;

    const baseRevision = doc.getSnapshot().revision;
    const job = await editor.ai.submit(
      {
        prompt: "Neon cyber car",
        modality: "text-to-image",
        targetWidth: 256,
        targetHeight: 256,
      },
      {
        budgetId: "default-budget",
        baseRevision,
        providerId: "flux-1-pro",
      },
    );

    const candidate = await job.result();
    const layer = await editor.applyGeneratedCandidate(candidate.id, {
      expectedRevision: baseRevision,
      layerName: "Cyber Car",
    });

    // Save project to blob
    const savedBlob = await editor.saveProject();
    expect(savedBlob.size).toBeGreaterThan(0);

    // Read project directly via binary container reader
    const projectData = await readProject(savedBlob);
    expect(projectData.document.children.length).toBe(1);
    expect(projectData.document.children[0].name).toBe("Cyber Car");
    expect(projectData.entries.length).toBe(1);
    expect(projectData.entries[0].id).toBe(layer.assetId);

    // Reopen in a new EditorApplication
    const newEditor = new EditorApplication();
    const file = new File([savedBlob], "project.luma", {
      type: "application/octet-stream",
    });
    await newEditor.openProject(file);

    expect(newEditor.document.layers.length).toBe(1);
    const restoredLayer = newEditor.document.layers.at(0) as RasterLayer;
    expect(restoredLayer.name).toBe("Cyber Car");
    expect(restoredLayer.width).toBe(256);
    expect(restoredLayer.height).toBe(256);

    // Verify metadata was persisted across save/reopen
    expect(restoredLayer.metadata?.title).toContain("Neon cyber car");
    expect(restoredLayer.metadata?.keywords).toContain("ai-generated");

    editor.dispose();
    newEditor.dispose();
  });

  it("allows candidate discard and collects staging memory", async () => {
    const editor = new EditorApplication();
    registerSimulationAdapters(editor.ai.providerRegistry);
    editor.newDocument({ width: 500, height: 500 });

    const job = await editor.ai.submit(
      {
        prompt: "Temporary cloud",
        modality: "text-to-image",
        targetWidth: 256,
        targetHeight: 256,
      },
      {
        budgetId: "default-budget",
        baseRevision: editor.document.getSnapshot().revision,
        providerId: "flux-1-pro",
      },
    );

    const candidate = await job.result();
    expect(editor.ai.staging.getCandidate(candidate.id)).toBeDefined();

    // Discard candidate
    await editor.ai.discardCandidate(candidate.id);
    expect(editor.ai.staging.getCandidate(candidate.id)).toBeUndefined();

    // Candidate cannot be applied after discard
    await expect(editor.applyGeneratedCandidate(candidate.id)).rejects.toThrow(
      /not found/,
    );

    editor.dispose();
  });
});
