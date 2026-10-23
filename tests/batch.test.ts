import { AssetStore } from "../src/core/assets";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  computeSha256,
  formatDeliverableFileName,
  generateDeliveryManifest,
  verifyDeliveryManifest,
} from "../src/ai/batch/manifest";
import {
  validateBatchConfig,
  validateBatchItem,
  validateDeliveryManifest,
} from "../src/ai/batch/schema";
import { BatchRunnerService } from "../src/ai/batch/service";
import { BatchStorage } from "../src/ai/batch/storage";
import type {
  BatchConfig,
  BatchItem,
  BatchRun,
  BatchSourceImage,
  DeliveryVariantSpec,
} from "../src/ai/batch/types";
import { DEFAULT_DELIVERY_VARIANTS } from "../src/ai/batch/types";
import { createZipArchive, crc32 } from "../src/ai/batch/zip";
import { BudgetLedger } from "../src/ai/jobs/ledger";
import { RasterLayer } from "../src/dom";
import { EditorApplication } from "../src/editor";

// Worker stub for Node test environment (for EditorApplication's PixelProcessor)
if (typeof globalThis.Worker === "undefined") {
  globalThis.Worker = class MockWorker {
    postMessage() {}
    addEventListener() {}
    removeEventListener() {}
    terminate() {}
  } as unknown as typeof Worker;
}

describe("T15: Resumable Batch Runner & Delivery Manifest", () => {
  let editor: EditorApplication;
  let storage: BatchStorage;
  let ledger: BudgetLedger;
  let batchService: BatchRunnerService;

  beforeEach(() => {
    editor = new EditorApplication();
    storage = new BatchStorage();
    // Unit fixtures provide image bytes and decoding/rendering explicitly.
    const getBlob = storage.getDeliverableBlob.bind(storage);
    vi.spyOn(storage, "getDeliverableBlob").mockImplementation(
      async (id) =>
        (await getBlob(id)) ??
        (id.startsWith("src-")
          ? new Blob([new Uint8Array([1])], { type: "image/png" })
          : null),
    );
    vi.spyOn(AssetStore.prototype, "add").mockImplementation(async function (
      this: AssetStore,
      blob,
      name,
      assetId,
    ) {
      const asset = {
        id: assetId!,
        name,
        width: 200,
        height: 200,
        blob,
        bitmap: { width: 200, height: 200, close() {} } as ImageBitmap,
        thumbnail: "",
      };
      this.install(asset, true);
      return asset;
    });
    vi.spyOn(editor.renderer, "render").mockImplementation(
      async (doc, _assets, options) => {
        const width =
          options?.outputSize?.width ?? options?.region?.width ?? doc.width;
        const height =
          options?.outputSize?.height ?? options?.region?.height ?? doc.height;
        return {
          width,
          height,
          getContext: () => ({
            getImageData: () => ({
              data: new Uint8ClampedArray(width * height * 4),
            }),
          }),
        } as unknown as HTMLCanvasElement;
      },
    );
    ledger = new BudgetLedger();
    ledger.createBudget({
      budgetId: "default-budget",
      approverId: "artist",
      approvedCeilingCents: 500, // $5.00
      consentGiven: true,
    });
    batchService = new BatchRunnerService({
      budgetLedger: ledger,
      recipes: editor.recipes,
      renderer: editor.renderer,
      storage,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("isolates execution and later subscribers from mutable event payloads", async () => {
    const run = await batchService.createBatch(
      {
        name: "Observer isolation",
        budgetId: "default-budget",
        variants: [
          {
            id: "small",
            name: "small",
            targetWidth: 16,
            targetHeight: 16,
            format: "png",
            fit: "fill",
          },
        ],
      },
      [
        {
          id: "source",
          name: "source.png",
          width: 200,
          height: 200,
          mimeType: "image/png",
          byteLength: 1,
        },
      ],
    );
    const observed: string[] = [];
    batchService.subscribe((event) => {
      if (event.type === "item_started" && event.item) {
        event.item.status = "succeeded";
        event.item.source.sha256 = "mutated";
      }
    });
    batchService.subscribe((event) => {
      if (event.type === "item_started" && event.item)
        observed.push(event.item.status);
    });
    await batchService.start(run.id);
    const done = await batchService.waitForRun(run.id);
    expect(observed).toEqual(["running"]);
    expect(done.items[0].status).toBe("succeeded");
    expect(done.items[0].deliverables).toHaveLength(1);
    expect(done.items[0].source.sha256).not.toBe("mutated");
    expect(
      await storage.getDeliverableBlob(done.items[0].deliverables[0].id),
    ).toBeInstanceOf(Blob);
  });

  it("resumes an interrupted item without rendering an already checkpointed variant again", async () => {
    const render = vi.mocked(editor.renderer.render);
    const original = render.getMockImplementation()!;
    render.mockImplementation(async (...args) => {
      if (args[2]?.outputSize?.width === 200)
        throw new Error("interrupted second variant");
      return original(...args);
    });
    const run = await batchService.createBatch(
      {
        name: "Checkpoint recovery",
        budgetId: "default-budget",
        variants: [100, 200].map((width) => ({
          id: String(width),
          name: String(width),
          targetWidth: width,
          targetHeight: 16,
          format: "png",
          fit: "fill",
        })),
      },
      [
        {
          id: "source",
          name: "source.png",
          width: 200,
          height: 200,
          mimeType: "image/png",
          byteLength: 1,
        },
      ],
    );
    await batchService.start(run.id);
    const failed = await batchService.waitForRun(run.id);
    expect(failed.items[0].status).toBe("failed");
    expect(failed.items[0].deliverables).toHaveLength(1);
    const completedVariant = failed.items[0].deliverables[0];
    failed.status = "running";
    failed.items[0].status = "running";
    await storage.saveRun(failed);
    render.mockClear();
    render.mockImplementation(original);
    const recovered = new BatchRunnerService({
      storage,
      budgetLedger: ledger,
      recipes: editor.recipes,
      renderer: editor.renderer,
    });
    await Promise.all([recovered.resume(run.id), recovered.resume(run.id)]);
    const done = await recovered.waitForRun(run.id);
    expect(done.items[0].status).toBe("succeeded");
    expect(done.items[0].deliverables).toHaveLength(2);
    expect(done.items[0].deliverables[0].id).toBe(completedVariant.id);
    expect(done.items[0].deliverables[0].sha256).toBe(completedVariant.sha256);
    expect(
      render.mock.calls.filter((call) => call[2]?.outputSize?.width === 100),
    ).toHaveLength(0);
    expect(
      render.mock.calls.filter((call) => call[2]?.outputSize?.width === 200),
    ).toHaveLength(1);
  });

  it("persists a paused state after stop-on-first-failure and can resume", async () => {
    const render = vi.mocked(editor.renderer.render);
    render.mockRejectedValueOnce(new Error("Output failed"));
    const run = await batchService.createBatch(
      {
        name: "Stop on failure",
        budgetId: "default-budget",
        stopOnFirstFailure: true,
        concurrency: 1,
        variants: [
          {
            id: "small",
            name: "small",
            targetWidth: 16,
            targetHeight: 16,
            format: "png",
            fit: "fill",
          },
        ],
      },
      ["first", "second"].map((id) => ({
        id,
        name: id + ".png",
        width: 200,
        height: 200,
        mimeType: "image/png",
        byteLength: 1,
      })),
    );
    const events: string[] = [];
    batchService.subscribe((event) => events.push(event.type));
    await batchService.start(run.id);
    const paused = await batchService.waitForRun(run.id);
    expect(paused.status).toBe("paused");
    expect(paused.items.map((item) => item.status)).toEqual([
      "failed",
      "pending",
    ]);
    expect(events).toContain("run_paused");
    await batchService.resume(run.id);
    const resumed = await batchService.waitForRun(run.id);
    expect(resumed.items.map((item) => item.status)).toEqual([
      "failed",
      "succeeded",
    ]);
  });

  it("retains the batch recipe after its saved definition is edited and deleted", async () => {
    const recipe = structuredClone(editor.recipes.getPresets()[0]);
    recipe.id = "snapshot-test";
    recipe.steps = [
      {
        id: "rename",
        name: "Rename source",
        target: { role: "selected" },
        action: { type: "layer.update", patch: { name: "Original recipe" } },
      },
    ];
    await editor.recipes.saveRecipe(recipe);
    const run = await batchService.createBatch(
      {
        name: "Snapshot",
        budgetId: "default-budget",
        recipeId: recipe.id,
        variants: [
          {
            id: "small",
            name: "small",
            targetWidth: 16,
            targetHeight: 16,
            format: "png",
            fit: "fill",
          },
        ],
      },
      [
        {
          id: "source",
          name: "source.png",
          width: 200,
          height: 200,
          mimeType: "image/png",
          byteLength: 1,
        },
      ],
    );
    recipe.steps[0].action = {
      type: "layer.update",
      patch: { name: "Changed recipe" },
    };
    await editor.recipes.saveRecipe(recipe);
    await editor.recipes.deleteRecipe(recipe.id);
    await batchService.start(run.id);
    const done = await batchService.waitForRun(run.id);
    expect(done.items[0].status).toBe("succeeded");
    expect(done.items[0].checkpoint?.children[0].name).toBe("Original recipe");
    const legacy = structuredClone(run);
    delete legacy.config.recipeSnapshot;
    await storage.saveRun(legacy);
    await expect(batchService.resume(run.id)).rejects.toThrow(
      "snapshot is missing",
    );
    await expect(
      batchService.createBatch(
        { name: "Missing", budgetId: "default-budget", recipeId: "missing" },
        [],
      ),
    ).rejects.toThrow("was not found");
  });

  describe("Schema Validation", () => {
    it("validates valid batch configurations", () => {
      const validConfig: BatchConfig = {
        id: "batch-1",
        name: "Test Batch",
        variants: DEFAULT_DELIVERY_VARIANTS,
        concurrency: 2,
        budgetCeilingCents: 200,
        budgetId: "default-budget",
        stopOnFirstFailure: false,
        outputNamingTemplate: "{name}_{variant}",
      };
      const result = validateBatchConfig(validConfig);
      expect(result.valid).toBe(true);
      expect(result.data?.name).toBe("Test Batch");
    });

    it("rejects invalid batch configuration", () => {
      const invalidConfig = {
        id: "",
        name: "",
        variants: [], // At least one variant required
        concurrency: 20, // Max 8
        budgetCeilingCents: -50, // Negative budget
        budgetId: "",
      };
      const result = validateBatchConfig(invalidConfig);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("validates batch item schemas", () => {
      const item: BatchItem = {
        id: "item-1",
        name: "hero_image",
        source: {
          id: "src-1",
          name: "hero_image.png",
          width: 800,
          height: 600,
          mimeType: "image/png",
          byteLength: 1024,
        },
        status: "pending",
        reviewState: "unreviewed",
        estimatedCostCents: 10,
        actualCostCents: 0,
        deliverables: [],
        retryCount: 0,
      };
      const result = validateBatchItem(item);
      expect(result.valid).toBe(true);
    });
  });

  describe("Cryptographic SHA-256 & Delivery Manifest", () => {
    it("matches standard SHA-256 vectors including a sliced byte view", async () => {
      expect(await computeSha256("")).toBe(
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      );
      const bytes = new TextEncoder().encode("xabcx");
      expect(await computeSha256(bytes.subarray(1, 4))).toBe(
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      );
    });

    it("rejects unavailable or failed cryptography instead of inventing a digest", async () => {
      const original = globalThis.crypto;
      try {
        vi.stubGlobal("crypto", undefined);
        await expect(computeSha256("abc")).rejects.toThrow(
          "requires Web Crypto",
        );
        vi.stubGlobal("crypto", {
          subtle: {
            digest: async () => {
              throw new Error("Digest failed");
            },
          },
        });
        await expect(computeSha256("abc")).rejects.toThrow("Digest failed");
      } finally {
        vi.stubGlobal("crypto", original);
      }
    });

    it("computes accurate deterministic SHA-256 digests", async () => {
      const hash1 = await computeSha256("test-content-string");
      const hash2 = await computeSha256("test-content-string");
      const hash3 = await computeSha256("different-string");

      expect(hash1).toHaveLength(64);
      expect(hash1).toBe(hash2);
      expect(hash1).not.toBe(hash3);
    });

    it("formats safe deliverable filenames using template variables", () => {
      const item: BatchItem = {
        id: "item-1",
        name: "summer_campaign_product.png",
        source: {
          id: "s-1",
          name: "summer_campaign_product.png",
          width: 1920,
          height: 1080,
          mimeType: "image/png",
          byteLength: 2048,
        },
        status: "pending",
        reviewState: "unreviewed",
        estimatedCostCents: 0,
        actualCostCents: 0,
        deliverables: [],
        retryCount: 0,
      };

      const variant: DeliveryVariantSpec = {
        id: "v-square",
        name: "Square",
        targetWidth: 1080,
        targetHeight: 1080,
        format: "png",
        fit: "cover",
      };

      const fileName = formatDeliverableFileName(
        "{name}_{variant}_{width}x{height}",
        item,
        variant,
      );
      expect(fileName).toBe("summer_campaign_product_square_1080x1080.png");
    });

    it("generates and verifies delivery manifest cryptographic integrity", async () => {
      const run: BatchRun = {
        id: "run-test-manifest",
        config: {
          id: "cfg-1",
          name: "Manifest Test",
          variants: DEFAULT_DELIVERY_VARIANTS,
          concurrency: 2,
          budgetCeilingCents: 100,
          budgetId: "default-budget",
          stopOnFirstFailure: false,
          outputNamingTemplate: "{name}_{variant}",
        },
        status: "completed",
        items: [
          {
            id: "it-1",
            name: "item_alpha",
            source: {
              id: "src-1",
              name: "alpha.png",
              width: 800,
              height: 600,
              mimeType: "image/png",
              byteLength: 5000,
              sha256:
                "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            },
            status: "succeeded",
            reviewState: "approved",
            estimatedCostCents: 10,
            actualCostCents: 10,
            deliverables: [
              {
                id: "deliv-1",
                itemId: "it-1",
                variantId: "var-1x1",
                variantName: "Square (1:1)",
                format: "png",
                width: 1080,
                height: 1080,
                aspectRatio: "1:1",
                fileName: "item_alpha_1x1.png",
                byteLength: 12000,
                sha256:
                  "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
                createdAt: new Date().toISOString(),
              },
            ],
            retryCount: 0,
          },
        ],
        summary: {
          total: 1,
          pending: 0,
          running: 0,
          succeeded: 1,
          failed: 0,
          skipped: 0,
          cancelled: 0,
          totalEstimatedCostCents: 10,
          totalActualCostCents: 10,
          approvedCount: 1,
          rejectedCount: 0,
          flaggedCount: 0,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const legacy = structuredClone(run);
      legacy.completedAt = new Date().toISOString();
      delete legacy.items[0].source.sha256;
      await expect(generateDeliveryManifest(legacy)).rejects.toThrow(
        "Source provenance is unavailable",
      );
      await batchService.storage.saveRun(legacy);
      const inventory = await batchService.listRuns();
      expect(
        inventory.find((item) => item.id === legacy.id)?.deliveryManifestError,
      ).toContain("Source provenance");
      expect(
        (await batchService.getRun(legacy.id))?.deliveryManifest,
      ).toBeUndefined();
      await expect(
        batchService.exportDeliveryPackageZip(legacy.id),
      ).rejects.toThrow("Source provenance");
      // A caller supplying bytes later cannot establish which source produced old outputs.
      legacy.items[0].source.blob = new Blob(["replacement"]);
      await expect(generateDeliveryManifest(legacy)).rejects.toThrow(
        "Source provenance",
      );
      legacy.items[0].deliverables = [];
      expect(
        (await generateDeliveryManifest(legacy)).deliverables,
      ).toHaveLength(0);

      const manifest = await generateDeliveryManifest(run);
      expect(manifest.schemaVersion).toBe(2);
      expect(manifest.batchId).toBe("run-test-manifest");
      expect(manifest.deliverables).toHaveLength(1);
      expect(manifest.integrity.manifestHash).toHaveLength(64);
      expect(validateDeliveryManifest(manifest).valid).toBe(true);

      // Verify valid manifest
      const verification = await verifyDeliveryManifest(manifest);
      expect(verification.valid).toBe(true);
      expect(verification.calculatedHash).toBe(manifest.integrity.manifestHash);

      // Tampered manifest test: altering file path or hash MUST fail verification
      const tampered = structuredClone(manifest);
      tampered.deliverables[0].filePath = "deliverables/hacked.png";
      const tamperedCheck = await verifyDeliveryManifest(tampered);
      expect(tamperedCheck.valid).toBe(false);
      for (const mutate of [
        (m: typeof manifest) => {
          m.deliverables[0].sourceHash = "c".repeat(64);
        },
        (m: typeof manifest) => {
          m.deliverables[0].width++;
        },
        (m: typeof manifest) => {
          m.summary.totalCostCents++;
        },
        (m: typeof manifest) => {
          m.batchName = "Altered";
        },
        (m: typeof manifest) => {
          m.deliverables[0].itemId = "other";
        },
      ]) {
        const changed = structuredClone(manifest);
        mutate(changed);
        expect((await verifyDeliveryManifest(changed)).valid).toBe(false);
      }
      expect((await verifyDeliveryManifest(null)).valid).toBe(false);
      expect(
        (await verifyDeliveryManifest({ ...manifest, schemaVersion: 1 })).valid,
      ).toBe(false);
      expect(
        (await verifyDeliveryManifest({ ...manifest, unknown: true })).valid,
      ).toBe(false);
      const reordered = Object.fromEntries(Object.entries(manifest).reverse());
      expect((await verifyDeliveryManifest(reordered)).valid).toBe(true);
    });
  });

  describe("PKZIP 2.0 Packaging", () => {
    it("creates compliant uncompressed ZIP archive with CRC32 verification", async () => {
      const data1 = new TextEncoder().encode("Hello World ZIP content 1");
      const data2 = new TextEncoder().encode("Hello World ZIP content 2");

      expect(crc32(data1)).toBeGreaterThan(0);

      const zipBlob = createZipArchive([
        { name: "delivery-manifest.json", data: data1 },
        { name: "deliverables/variant1.png", data: data2 },
      ]);

      expect(zipBlob.type).toBe("application/zip");
      expect(zipBlob.size).toBeGreaterThan(data1.length + data2.length);

      const buffer = await zipBlob.arrayBuffer();
      const view = new DataView(buffer);

      // Verify PKZIP local header signature 0x04034b50
      expect(view.getUint32(0, true)).toBe(0x04034b50);
    });
  });

  it("rejects duplicate variant IDs before creation or resuming saved work", async () => {
    const variants: DeliveryVariantSpec[] = [16, 32].map((width) => ({
      id: "same",
      name: `Size ${width}`,
      targetWidth: width,
      targetHeight: 16,
      format: "png",
      fit: "fill",
    }));
    const source = {
      id: "source",
      name: "source.png",
      width: 200,
      height: 200,
      mimeType: "image/png",
      byteLength: 1,
    };
    const config = {
      name: "Duplicate variants",
      budgetId: "default-budget",
      variants,
    };
    await expect(batchService.createBatch(config, [source])).rejects.toThrow(
      /variant IDs must be unique/,
    );
    expect(await storage.listRuns()).toEqual([]);
    const run = await batchService.createBatch(
      { ...config, variants: [variants[0]] },
      [source],
    );
    run.config.variants = variants;
    await storage.saveRun(run);
    await expect(batchService.resume(run.id)).rejects.toThrow(
      /variant IDs must be unique/,
    );
    expect(await storage.getRun(run.id)).toEqual(run);
    expect(editor.renderer.render).not.toHaveBeenCalled();
  });

  it("preserves long delivery extensions and collision suffixes through ZIP export", async () => {
    const run = await batchService.createBatch(
      {
        name: "Long names",
        budgetId: "default-budget",
        outputNamingTemplate: "a".repeat(180),
        variants: [16, 32].map((width) => ({
          id: String(width),
          name: `Size ${width}`,
          targetWidth: width,
          targetHeight: 16,
          format: "png",
          fit: "fill",
        })),
      },
      [
        {
          id: "source",
          name: "source.png",
          width: 200,
          height: 200,
          mimeType: "image/png",
          byteLength: 1,
        },
      ],
    );
    await batchService.start(run.id);
    const done = await batchService.waitForRun(run.id);
    const paths = done.deliveryManifest!.deliverables.map(
      (delivery) => delivery.filePath,
    );
    expect(paths).toEqual([
      `deliverables/${"a".repeat(180)}.png`,
      `deliverables/${"a".repeat(178)}_2.png`,
    ]);
    const zip = new Uint8Array(
      await (await batchService.exportDeliveryPackageZip(run.id)).arrayBuffer(),
    );
    const view = new DataView(zip.buffer);
    const names: string[] = [];
    let offset = 0;
    while (view.getUint32(offset, true) === 0x04034b50) {
      const nameLength = view.getUint16(offset + 26, true);
      names.push(
        new TextDecoder().decode(
          zip.subarray(offset + 30, offset + 30 + nameLength),
        ),
      );
      offset +=
        30 +
        nameLength +
        view.getUint16(offset + 28, true) +
        view.getUint32(offset + 18, true);
    }
    expect(names).toEqual(["delivery-manifest.json", ...paths]);
    for (const format of ["jpeg", "webp"] as const) {
      expect(
        formatDeliverableFileName(
          `${"a".repeat(180)}.${format}`,
          done.items[0],
          { ...run.config.variants[0], format },
        ),
      ).toBe(`${"a".repeat(180)}.${format}`);
    }
  });

  it("exports and verifies deliveries with maximum-length valid variant IDs", async () => {
    const run = await batchService.createBatch(
      {
        name: "Long variant",
        budgetId: "default-budget",
        variants: [
          {
            id: "v".repeat(64),
            name: "Variant",
            targetWidth: 16,
            targetHeight: 16,
            format: "png",
            fit: "contain",
          },
        ],
      },
      [
        {
          id: "source",
          name: "source.png",
          width: 200,
          height: 200,
          mimeType: "image/png",
          byteLength: 1,
        },
      ],
    );
    await batchService.start(run.id);
    const completed = await batchService.waitForRun(run.id);
    expect(completed.status).toBe("completed");
    expect(completed.deliveryManifestError).toBeUndefined();
    expect(
      (await verifyDeliveryManifest(completed.deliveryManifest!)).valid,
    ).toBe(true);
    expect(
      (await batchService.exportDeliveryPackageZip(run.id)).size,
    ).toBeGreaterThan(0);
  });

  it("rejects oversized encoded filenames instead of truncating fields", () => {
    const entry = { name: "image.png", data: new Uint8Array() };
    expect(() =>
      createZipArchive([{ ...entry, name: "é".repeat(32768) }]),
    ).toThrow(/filename/);
  });

  describe("Deduplication & Resumability Invariants", () => {
    it("never re-runs or re-bills succeeded items upon resume", async () => {
      const sources: BatchSourceImage[] = [
        {
          id: "src-1",
          name: "image_1.png",
          width: 200,
          height: 200,
          mimeType: "image/png",
          byteLength: 1000,
        },
        {
          id: "src-2",
          name: "image_2.png",
          width: 200,
          height: 200,
          mimeType: "image/png",
          byteLength: 1000,
        },
      ];

      const run = await batchService.createBatch(
        {
          name: "Resume Test Batch",
          budgetId: "default-budget",
          variants: [
            {
              id: "v-small",
              name: "Small",
              targetWidth: 100,
              targetHeight: 100,
              format: "png",
              fit: "cover",
            },
          ],
        },
        sources,
      );

      // Execute first time
      await batchService.start(run.id);
      await batchService.waitForRun(run.id);

      const completedRun = await batchService.getRun(run.id);
      expect(completedRun).not.toBeNull();
      expect(completedRun!.status).toBe("completed");
      expect(completedRun!.summary.succeeded).toBe(2);

      const item1FirstDeliverableId = completedRun!.items[0].deliverables[0].id;
      const item1FirstCompletedAt = completedRun!.items[0].completedAt;

      // Resume again: since all items succeeded, none should be touched or re-rendered
      await batchService.resume(run.id);
      await batchService.waitForRun(run.id);

      const resumedRun = await batchService.getRun(run.id);
      expect(resumedRun!.items[0].deliverables[0].id).toBe(
        item1FirstDeliverableId,
      );
      expect(resumedRun!.items[0].completedAt).toBe(item1FirstCompletedAt);
      expect(resumedRun!.summary.succeeded).toBe(2);
    });

    it("recovers interrupted items in 'running' state after simulated reload and resumes queue", async () => {
      const sources: BatchSourceImage[] = [
        {
          id: "src-interrupted-1",
          name: "img1.png",
          width: 100,
          height: 100,
          mimeType: "image/png",
          byteLength: 500,
        },
        {
          id: "src-interrupted-2",
          name: "img2.png",
          width: 100,
          height: 100,
          mimeType: "image/png",
          byteLength: 500,
        },
      ];

      const run = await batchService.createBatch(
        {
          name: "Interrupted Reload Run",
          budgetId: "default-budget",
          variants: [
            {
              id: "v-square",
              name: "Square",
              targetWidth: 64,
              targetHeight: 64,
              format: "png",
              fit: "cover",
            },
          ],
        },
        sources,
      );

      // Simulate a crash/reload while running:
      // Item 0 was running, item 1 was pending, and run status was "running" in storage
      run.status = "running";
      run.items[0].status = "running";
      run.items[1].status = "pending";
      await storage.saveRun(run);

      // Create a new batch service instance to simulate fresh in-memory state after reload
      const reloadedBatchService = new BatchRunnerService({
        budgetLedger: ledger,
        recipes: editor.recipes,
        renderer: editor.renderer,
        storage,
      });

      // Resuming the run should recover item 0 from "running" -> "pending" and execute all items
      await reloadedBatchService.resume(run.id);
      await reloadedBatchService.waitForRun(run.id);

      const completed = await reloadedBatchService.getRun(run.id);
      expect(completed).not.toBeNull();
      expect(completed!.status).toBe("completed");
      expect(completed!.summary.succeeded).toBe(2);
      expect(completed!.items[0].status).toBe("succeeded");
      expect(completed!.items[1].status).toBe("succeeded");
    });

    it("retries ONLY failed items without re-running successes", async () => {
      const sources: BatchSourceImage[] = [
        {
          id: "src-1",
          name: "item_success.png",
          width: 200,
          height: 200,
          mimeType: "image/png",
          byteLength: 1000,
        },
        {
          id: "src-2",
          name: "item_fail.png",
          width: 200,
          height: 200,
          mimeType: "image/png",
          byteLength: 1000,
        },
      ];

      const run = await batchService.createBatch(
        {
          name: "Selective Retry Batch",
          budgetId: "default-budget",
          variants: [
            {
              id: "v-1",
              name: "Thumb",
              targetWidth: 64,
              targetHeight: 64,
              format: "png",
              fit: "cover",
            },
          ],
        },
        sources,
      );

      // Manually mark item 2 as failed to simulate a transient network/worker error
      run.items[0].status = "succeeded";
      run.items[0].deliverables = [
        {
          id: "deliv-success",
          itemId: run.items[0].id,
          variantId: "v-1",
          variantName: "Thumb",
          format: "png",
          width: 64,
          height: 64,
          aspectRatio: "1:1",
          fileName: "item_success_Thumb.png",
          byteLength: 500,
          sha256:
            "1111111111111111111111111111111111111111111111111111111111111111",
          createdAt: new Date().toISOString(),
        },
      ];
      run.items[1].status = "failed";
      run.items[1].error = "Simulated worker timeout";
      run.summary.succeeded = 1;
      run.summary.failed = 1;
      run.summary.pending = 0;
      await storage.saveRun(run);

      // Trigger retryFailed
      await batchService.retryFailed(run.id);
      await batchService.waitForRun(run.id);

      const afterRetry = await batchService.getRun(run.id);
      expect(afterRetry).not.toBeNull();
      // Item 1 must still have its original deliverable
      expect(afterRetry!.items[0].status).toBe("succeeded");
      expect(afterRetry!.items[0].deliverables[0].id).toBe("deliv-success");
      // Item 2 must now have succeeded with retryCount = 1
      expect(afterRetry!.items[1].status).toBe("succeeded");
      expect(afterRetry!.items[1].retryCount).toBe(1);
      expect(afterRetry!.items[1].deliverables).toHaveLength(1);
    });
  });

  describe("Budget Ceiling Enforcement", () => {
    it("rejects enabled AI steps before dispatch and respects per-item conditional overrides", async () => {
      const recipe = structuredClone(editor.recipes.getPresets()[0]);
      recipe.id = "conditional-ai";
      recipe.parameters = [
        {
          name: "generate",
          label: "Generate",
          type: "boolean",
          default: false,
        },
      ];
      recipe.steps = [
        {
          id: "ai",
          name: "Generate artwork",
          condition: { param: "generate", op: "truthy" },
          action: {
            type: "ai.generate",
            modality: "text-to-image",
            prompt: "Artwork",
            estimatedCostCents: 2,
          },
        },
      ];
      await editor.recipes.saveRecipe(recipe);
      const run = await batchService.createBatch(
        {
          name: "Conditional AI",
          budgetId: "default-budget",
          recipeId: recipe.id,
        },
        [
          {
            id: "source",
            name: "art.png",
            width: 200,
            height: 200,
            mimeType: "image/png",
            byteLength: 1,
            parameters: { generate: true },
          },
        ],
      );
      expect(await batchService.estimateBatch(run.id)).toMatchObject({
        approved: false,
        error: expect.stringContaining("ai.generate"),
      });
      await expect(batchService.start(run.id)).rejects.toThrow("ai.generate");
      const rejected = await batchService.getRun(run.id);
      expect(rejected!.items[0].status).toBe("pending");
      expect(rejected!.items[0].deliverables).toEqual([]);
      expect(editor.renderer.render).not.toHaveBeenCalled();
      run.config.recipeParams = { generate: true };
      run.items[0].parameters = { generate: false };
      await storage.saveRun(run);
      expect(await batchService.estimateBatch(run.id)).toMatchObject({
        approved: true,
        totalEstimatedCostCents: 0,
      });
    });

    it("preflights targets using each source name and rejects invalid local edits", async () => {
      const recipe = structuredClone(editor.recipes.getPresets()[0]);
      recipe.id = "named-target";
      recipe.parameters = [];
      recipe.steps = [
        {
          id: "rename",
          name: "Rename",
          target: { by: "name", pattern: "art" },
          action: { type: "layer.update", patch: { name: "Ready" } },
        },
      ];
      await editor.recipes.saveRecipe(recipe);
      const run = await batchService.createBatch(
        {
          name: "Named target",
          budgetId: "default-budget",
          recipeId: recipe.id,
        },
        [
          {
            id: "source",
            name: "art.png",
            width: 200,
            height: 200,
            mimeType: "image/png",
            byteLength: 1,
          },
        ],
      );
      expect(await batchService.estimateBatch(run.id)).toMatchObject({
        approved: true,
      });
      run.items[0].name = "another";
      await storage.saveRun(run);
      expect(await batchService.estimateBatch(run.id)).toMatchObject({
        approved: false,
        error: expect.stringContaining("another"),
      });
    });

    it("rejects execution if estimated spend exceeds configured budget ceiling", async () => {
      const sources: BatchSourceImage[] = [
        {
          id: "src-1",
          name: "img1.png",
          width: 400,
          height: 400,
          mimeType: "image/png",
          byteLength: 2000,
        },
      ];

      const run = await batchService.createBatch(
        {
          name: "Budget Ceiling Test",
          budgetId: "default-budget",
          budgetCeilingCents: 5, // Extremely low ceiling ($0.05)
          variants: DEFAULT_DELIVERY_VARIANTS,
        },
        sources,
      );

      // Artificially assign higher estimated cost
      run.items[0].estimatedCostCents = 50; // $0.50 > $0.05
      await storage.saveRun(run);

      await expect(batchService.start(run.id)).rejects.toThrow(
        /exceeds configured batch ceiling/i,
      );
    });

    it("rejects execution if budget consent was not given", async () => {
      ledger.createBudget({
        budgetId: "unconsented-budget",
        approverId: "artist",
        approvedCeilingCents: 1000,
        consentGiven: false, // Consent missing
      });

      const sources: BatchSourceImage[] = [
        {
          id: "src-1",
          name: "img1.png",
          width: 400,
          height: 400,
          mimeType: "image/png",
          byteLength: 2000,
        },
      ];

      const run = await batchService.createBatch(
        {
          name: "Unconsented Test",
          budgetId: "unconsented-budget",
          variants: DEFAULT_DELIVERY_VARIANTS,
        },
        sources,
      );

      run.items[0].estimatedCostCents=1;
      await storage.saveRun(run);
      await expect(batchService.start(run.id)).rejects.toThrow(
        /human consent is required/i,
      );
    });
  });

  describe("Human Review States & Isolation Invariants", () => {
    it("updates human review states and recalculates manifest summary", async () => {
      const sources: BatchSourceImage[] = [
        {
          id: "src-1",
          name: "img1.png",
          width: 100,
          height: 100,
          mimeType: "image/png",
          byteLength: 1000,
        },
      ];

      const run = await batchService.createBatch(
        {
          name: "Review Test",
          budgetId: "default-budget",
          variants: [
            {
              id: "v-1",
              name: "Thumb",
              targetWidth: 50,
              targetHeight: 50,
              format: "png",
              fit: "cover",
            },
          ],
        },
        sources,
      );

      await batchService.start(run.id);
      await batchService.waitForRun(run.id);

      // Initially unreviewed
      let currentRun = await batchService.getRun(run.id);
      expect(currentRun!.items[0].reviewState).toBe("unreviewed");

      // Approve item
      await batchService.setReviewState(
        run.id,
        currentRun!.items[0].id,
        "approved",
        "Approved by QA",
      );

      currentRun = await batchService.getRun(run.id);
      expect(currentRun!.items[0].reviewState).toBe("approved");
      expect(currentRun!.items[0].reviewNotes).toBe("Approved by QA");
      expect(currentRun!.summary.approvedCount).toBe(1);

      // Verify updated manifest contains approved status
      expect(currentRun!.deliveryManifest?.summary.approvedCount).toBe(1);
      expect(currentRun!.deliveryManifest?.deliverables[0].reviewState).toBe(
        "approved",
      );
    });

    it("ensures zero document undo history pollution during batch runs", async () => {
      // Setup active document in editor with one layer
      editor.newDocument({ name: "ActiveDoc", width: 500, height: 500 });
      editor.document.layers.add(
        new RasterLayer({
          name: "BaseCanvasLayer",
          assetId: "asset-base",
          width: 500,
          height: 500,
        }),
      );

      const initialCanUndo = editor.document.canUndo;
      const initialCanRedo = editor.document.canRedo;
      const initialRevision = editor.document.getSnapshot().revision;

      // Run a batch job
      const sources: BatchSourceImage[] = [
        {
          id: "src-batch-1",
          name: "batch_asset_1.png",
          width: 300,
          height: 300,
          mimeType: "image/png",
          byteLength: 1500,
        },
      ];

      const run = await batchService.createBatch(
        {
          name: "Zero Undo Pollution Batch",
          budgetId: "default-budget",
          variants: DEFAULT_DELIVERY_VARIANTS,
        },
        sources,
      );

      await batchService.start(run.id);
      await batchService.waitForRun(run.id);

      // Invariant: active editor document's undo/redo stack is completely untouched
      expect(editor.document.canUndo).toBe(initialCanUndo);
      expect(editor.document.canRedo).toBe(initialCanRedo);
      expect(editor.document.getSnapshot().revision).toBe(initialRevision);
      expect(editor.document.layers).toHaveLength(1);
      expect(editor.document.layers.at(0)?.name).toBe("BaseCanvasLayer");
    });

    it("exports colliding source names with unique manifest paths and matching bytes", async () => {
      const run = await batchService.createBatch(
        {
          name: "Collisions",
          budgetId: "default-budget",
          variants: [
            {
              id: "square",
              name: "Square",
              targetWidth: 16,
              targetHeight: 16,
              format: "png",
              fit: "cover",
            },
          ],
        },
        ["a b.png", "a_b.png", "A_B.png", "a_b_square_2.png"].map(
          (name, index) => ({
            id: `source-${index}`,
            name,
            width: 2,
            height: 2,
            mimeType: "image/png",
            byteLength: 1,
          }),
        ),
      );
      await batchService.start(run.id);
      await batchService.waitForRun(run.id);
      const bytes = new Uint8Array(
        await (
          await batchService.exportDeliveryPackageZip(run.id)
        ).arrayBuffer(),
      );
      const view = new DataView(bytes.buffer);
      const entries = new Map<string, Uint8Array>();
      let offset = 0;
      while (view.getUint32(offset, true) === 0x04034b50) {
        const size = view.getUint32(offset + 18, true);
        const length = view.getUint16(offset + 26, true);
        const extra = view.getUint16(offset + 28, true);
        const name = new TextDecoder().decode(
          bytes.slice(offset + 30, offset + 30 + length),
        );
        expect(entries.has(name)).toBe(false);
        const start = offset + 30 + length + extra;
        entries.set(name, bytes.slice(start, start + size));
        offset = start + size;
      }
      const manifest = JSON.parse(
        new TextDecoder().decode(entries.get("delivery-manifest.json")),
      );
      expect(manifest.deliverables).toHaveLength(4);
      expect(
        new Set(
          manifest.deliverables.map((d: { filePath: string }) =>
            d.filePath.toLowerCase(),
          ),
        ).size,
      ).toBe(4);
      for (const delivery of manifest.deliverables) {
        expect(await computeSha256(entries.get(delivery.filePath)!)).toBe(
          delivery.sha256,
        );
      }
      expect((await verifyDeliveryManifest(manifest)).valid).toBe(true);
    });

    it("exports delivery package ZIP containing manifest and deliverables", async () => {
      const sources: BatchSourceImage[] = [
        {
          id: "src-pkg-1",
          name: "product.png",
          width: 200,
          height: 200,
          mimeType: "image/png",
          byteLength: 2000,
        },
      ];

      const run = await batchService.createBatch(
        {
          name: "Package Export Batch",
          budgetId: "default-budget",
          variants: [
            {
              id: "v-square",
              name: "Square",
              targetWidth: 100,
              targetHeight: 100,
              format: "png",
              fit: "cover",
            },
          ],
        },
        sources,
      );

      await batchService.start(run.id);
      await batchService.waitForRun(run.id);

      const zipBlob = await batchService.exportDeliveryPackageZip(run.id);
      expect(zipBlob.type).toBe("application/zip");
      expect(zipBlob.size).toBeGreaterThan(100);
    });

    it("rejects corrupted stored outputs before exporting a delivery package", async () => {
      const run = await batchService.createBatch(
        {
          name: "Integrity",
          budgetId: "default-budget",
          variants: [
            {
              id: "tiny",
              name: "Tiny",
              targetWidth: 16,
              targetHeight: 16,
              format: "png",
              fit: "fill",
            },
          ],
        },
        [
          {
            id: "source",
            name: "source.png",
            width: 200,
            height: 200,
            mimeType: "image/png",
            byteLength: 1,
          },
        ],
      );
      await batchService.start(run.id);
      const completed = await batchService.waitForRun(run.id);
      const output = completed.items[0].deliverables[0];
      const original = (await storage.getDeliverableBlob(output.id))!;
      const changed = new Uint8Array(await original.arrayBuffer());
      changed[changed.length - 1] ^= 1;
      await storage.saveDeliverableBlob(output.id, new Blob([changed]));
      await expect(
        batchService.exportDeliveryPackageZip(run.id),
      ).rejects.toThrow("integrity verification");
      await storage.saveDeliverableBlob(
        output.id,
        new Blob([changed.slice(1)]),
      );
      await expect(
        batchService.exportDeliveryPackageZip(run.id),
      ).rejects.toThrow("integrity verification");
      await storage.saveDeliverableBlob(output.id, original);
      await expect(
        batchService.exportDeliveryPackageZip(run.id),
      ).resolves.toBeInstanceOf(Blob);
    });

    it("fails item when rendering fails in production mode without synthetic fallback", async () => {
      const failingRenderer = {
        render: async () => {
          throw new Error("WebGL context lost during variant composition");
        },
        clearCache: () => {},
        dispose: () => {},
      };

      const failingBatchService = new BatchRunnerService({
        budgetLedger: ledger,
        recipes: editor.recipes,
        renderer: failingRenderer as any,
        storage,
      });

      const run = await failingBatchService.createBatch(
        {
          name: "Failing Production Run",
          budgetId: "default-budget",
          variants: [
            {
              id: "v-square",
              name: "Square",
              targetWidth: 100,
              targetHeight: 100,
              format: "png",
              fit: "cover",
            },
          ],
        },
        [
          {
            id: "src-fail",
            name: "fail.png",
            width: 100,
            height: 100,
            mimeType: "image/png",
            byteLength: 500,
          },
        ],
      );

      const events: string[] = [];
      failingBatchService.subscribe((event) => events.push(event.type));
      await failingBatchService.start(run.id);
      await failingBatchService.waitForRun(run.id);

      const completed = await failingBatchService.getRun(run.id);
      expect(completed).not.toBeNull();
      expect(completed!.status).toBe("failed");
      expect(events).toContain("run_failed");
      expect(events).not.toContain("run_completed");
      expect(completed!.summary.failed).toBe(1);
      expect(completed!.items[0].status).toBe("failed");
      expect(completed!.items[0].error).toContain(
        "Variant rendering failed for 'Square'",
      );
    });
  });
});
