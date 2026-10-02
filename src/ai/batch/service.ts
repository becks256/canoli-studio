import { readRecipePackage } from "../recipes/package";
import { batchItemNames } from "./source-names";
/**
 * High-level Batch Runner Service.
 * Coordinates batch job lifecycle, persistence, execution, review,
 * and delivery packaging.
 */

import { id } from "../../core/model";
import type { BudgetLedger } from "../jobs/ledger";
import type { RecipeService } from "../recipes/service";
import type { DocumentRenderer } from "../../engine/renderer";
import { computeSha256, generateDeliveryManifest } from "./manifest";
import { BatchRunner, type BatchEvent } from "./runner";
import { validateBatchConfig } from "./schema";
import { BatchStorage } from "./storage";
import type {
  BatchConfig,
  BatchItem,
  BatchItemReviewState,
  BatchRun,
  BatchSourceInput,
  DeliveryVariantSpec,
} from "./types";
import { DEFAULT_DELIVERY_VARIANTS } from "./types";
import {
  createZipArchiveAsync,
  type ZipBlobEntry,
  type ZipExportOptions,
} from "./zip";

export interface BatchServiceOptions {
  budgetLedger: BudgetLedger;
  recipes: RecipeService;
  renderer?: DocumentRenderer;
  storage?: BatchStorage;
}

export class BatchRunnerService {
  private readonly recipes: RecipeService;
  readonly storage: BatchStorage;
  readonly runner: BatchRunner;
  private unsubscribeRunner?: () => void;
  private listeners = new Set<(event: BatchEvent) => void>();

  constructor(options: BatchServiceOptions) {
    this.recipes = options.recipes;
    this.storage = options.storage ?? new BatchStorage();
    this.runner = new BatchRunner({
      storage: this.storage,
      budgetLedger: options.budgetLedger,
      recipes: options.recipes,
      renderer: options.renderer,
    });

    this.unsubscribeRunner = this.runner.subscribe((event) => {
      for (const listener of this.listeners) {
        try {
          listener(structuredClone(event));
        } catch (e) {
          console.error("BatchRunnerService listener error:", e);
        }
      }
    });
  }

  subscribe(listener: (event: BatchEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Creates a new BatchRun record in storage from a config and list of source images.
   */
  async createBatch(
    configInput: Partial<BatchConfig> & { name: string; budgetId: string },
    sourceImages: BatchSourceInput[],
  ): Promise<BatchRun> {
    configInput = structuredClone(configInput);
    sourceImages = structuredClone(sourceImages);
    const runId = configInput.id || `batch-${id()}`;
    const variants: DeliveryVariantSpec[] =
      configInput.variants && configInput.variants.length > 0
        ? configInput.variants
        : DEFAULT_DELIVERY_VARIANTS;

    const config: BatchConfig = {
      id: runId,
      name: configInput.name.trim() || "Untitled Batch",
      recipeId: configInput.recipeId,
      recipePackageId: configInput.recipePackageId,
      recipeParams: configInput.recipeParams || {},
      variants,
      concurrency: Math.max(1, Math.min(8, configInput.concurrency || 2)),
      budgetCeilingCents: Math.max(0, configInput.budgetCeilingCents || 0),
      budgetId: configInput.budgetId,
      stopOnFirstFailure: configInput.stopOnFirstFailure ?? false,
      outputNamingTemplate:
        configInput.outputNamingTemplate || "{name}_{variant}",
    };

    const validation = validateBatchConfig(config);
    if (!validation.valid) {
      throw new Error(
        `Invalid batch configuration: ${validation.errors.join("; ")}`,
      );
    }

    if (config.recipePackageId) {
      if (config.recipeId)
        throw new Error("Choose either a JSON recipe or a portable package.");
      const file = await this.recipes.packages.get(config.recipePackageId);
      if (!file) throw new Error("Portable recipe package was not found.");
      const { recipe } = await readRecipePackage(file);
      config.recipeId = recipe.id;
      config.recipeSnapshot = structuredClone(recipe);
      config.recipePackageSnapshot = file;
    } else if (config.recipeId) {
      const recipe = this.recipes.getRecipe(config.recipeId);
      if (!recipe)
        throw new Error(
          `Recipe '${config.recipeId}' was not found. Batch was not created.`,
        );
      config.recipeSnapshot = structuredClone(recipe);
    }

    const itemNames = batchItemNames(sourceImages);
    const items: BatchItem[] = [];
    for (let index = 0; index < sourceImages.length; index++) {
      const { parameters, ...src } = sourceImages[index];
      if (src.blob) {
        const digest = await computeSha256(await src.blob.arrayBuffer());
        if (src.sha256 && src.sha256 !== digest)
          throw new Error(
            `Source integrity verification failed for '${src.name}'.`,
          );
        src.sha256 = digest;
        src.byteLength = src.blob.size;
      }
      const itemName = itemNames[index];
      const itemId = `item-${id()}-${index + 1}`;

      items.push({
        id: itemId,
        name: itemName,
        source: src,
        parameters: parameters ? structuredClone(parameters) : undefined,
        status: "pending",
        reviewState: "unreviewed",
        estimatedCostCents: 0,
        actualCostCents: 0,
        deliverables: [],
        retryCount: 0,
      });
    }

    const run: BatchRun = {
      id: runId,
      config,
      status: "idle",
      items,
      summary: {
        total: items.length,
        pending: items.length,
        running: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
        cancelled: 0,
        totalEstimatedCostCents: 0,
        totalActualCostCents: 0,
        approvedCount: 0,
        rejectedCount: 0,
        flaggedCount: 0,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.storage.createRun(run);
    return run;
  }

  async estimateBatch(runId: string) {
    const run = await this.storage.getRun(runId);
    if (!run) throw new Error(`Batch run '${runId}' not found.`);
    return this.runner.estimateBatch(run.config, run.items);
  }

  async start(runId: string): Promise<BatchRun> {
    return this.runner.startBatch(runId);
  }

  async waitForRun(runId: string): Promise<BatchRun> {
    const run = await this.runner.waitForRun(runId);
    if (run.completedAt) await this.attachManifest(run);
    return run;
  }

  async pause(runId: string): Promise<void> {
    return this.runner.pauseBatch(runId);
  }

  async resume(runId: string): Promise<BatchRun> {
    return this.runner.startBatch(runId);
  }

  async cancel(runId: string): Promise<void> {
    return this.runner.cancelBatch(runId);
  }

  async retryFailed(runId: string): Promise<BatchRun> {
    return this.runner.retryFailed(runId);
  }

  async getRun(runId: string): Promise<BatchRun | null> {
    const run = await this.storage.getRun(runId);
    if (run?.completedAt) await this.attachManifest(run);
    return run;
  }

  async listRuns(): Promise<BatchRun[]> {
    const runs = await this.storage.listRuns();
    for (const run of runs) if (run.completedAt) await this.attachManifest(run);
    return runs;
  }

  private async attachManifest(run: BatchRun): Promise<void> {
    delete run.deliveryManifest;
    delete run.deliveryManifestError;
    try {
      run.deliveryManifest = await generateDeliveryManifest(run);
    } catch (error) {
      run.deliveryManifestError =
        error instanceof Error ? error.message : String(error);
    }
  }

  async deleteRun(runId: string): Promise<void> {
    return this.runner.deleteRun(runId);
  }

  async setReviewState(
    runId: string,
    itemId: string,
    reviewState: BatchItemReviewState,
    reviewNotes?: string,
  ): Promise<void> {
    await this.storage.updateItemReviewState(
      runId,
      itemId,
      reviewState,
      reviewNotes,
    );
    const run = await this.getRun(runId);
    if (run) {
      this.runner.emit({
        type: "item_completed",
        runId,
        itemId,
        item: run.items.find((i) => i.id === itemId),
        run,
      });
    }
  }

  async getDeliverableBlob(deliverableId: string): Promise<Blob | null> {
    return this.storage.getDeliverableBlob(deliverableId);
  }

  /**
   * Generates a complete delivery package ZIP containing:
   * 1. delivery-manifest.json (with cryptographically verified SHA-256 hashes)
   * 2. all rendered deliverables organized by variant and name
   */
  async exportDeliveryPackageZip(
    runId: string,
    options: ZipExportOptions = {},
  ): Promise<Blob> {
    options = { ...options };
    options.signal?.throwIfAborted();
    const run = await this.storage.getRun(runId);
    if (!run) throw new Error(`Batch run '${runId}' not found.`);

    const manifest = await generateDeliveryManifest(run);

    const entries: ZipBlobEntry[] = [];

    // Add delivery-manifest.json
    const manifestJson = JSON.stringify(manifest, null, 2);
    entries.push({
      name: "delivery-manifest.json",
      data: new Blob([manifestJson]),
    });

    // The manifest owns collision-resolved archive paths, including legacy runs.
    for (const deliv of manifest.deliverables) {
      options.signal?.throwIfAborted();
      const blob = await this.storage.getDeliverableBlob(deliv.deliverableId);
      if (!blob) {
        throw new Error(
          `Deliverable blob '${deliv.filePath}' (id: ${deliv.deliverableId}) was not found in storage.`,
        );
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (
        bytes.byteLength !== deliv.byteLength ||
        (await computeSha256(bytes)) !== deliv.sha256
      ) {
        throw new Error(
          `Deliverable '${deliv.filePath}' failed integrity verification. Stored bytes do not match the recorded output; export was cancelled.`,
        );
      }
      options.signal?.throwIfAborted();
      entries.push({ name: deliv.filePath, data: blob });
    }

    return createZipArchiveAsync(entries, options);
  }

  dispose(): void {
    this.runner.dispose();
    if (this.unsubscribeRunner) {
      this.unsubscribeRunner();
      this.unsubscribeRunner = undefined;
    }
    this.listeners.clear();
  }
}
