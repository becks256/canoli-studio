import {prepareDeliveryVariants} from './delivery-preparation';
import{isFloatDocument}from'../../core/float-document';
import {captureRasterExportSources} from '../../engine/raster-export-source';
import {exportTiff} from '../../engine/tiff';
import {exportPdf} from '../../engine/pdf';
import {deliverySettingsKey,deliverySettingsHash,verifyDeliveryContract} from './delivery-contract';
import {prepareColorOutputSource} from '../../core/color/output-source';
import {documentFontFiles} from '../../core/font-files';
import {withRecipeFonts} from '../recipes/font-preparation';
import type {FontSourceStore} from '../../fonts/store';
import {captureRetainedHistory,captureProjectHistory,type RetainedHistory} from '../../core/history';
import {isCameraRawFile} from '../../core/interchange/raw/files';
import {batchRawSourceSchema,rawBatchDocument} from './raw';
import {readBatchPreparation,preparationInputs} from './preparation';
import {prepareRawAsset} from '../../engine/raw-import';
import {serializeProject} from '../../core/project';
import {rawBlobHash} from '../../core/interchange/raw/source';
import type {RawImportControl} from '../../core/interchange/raw/types';
import { Document } from "../../dom";
import { executeRecipePackage } from "../recipes/package-executor";
import { readRecipePackage } from "../recipes/package";
/**
 * Resumable Batch Runner Engine.
 *
 * Implements Ticket T15, Milestones W02 & W03:
 * - Deterministic, resumable execution of batch jobs across asset sets
 * - Idempotency and deduplication guard: succeeded items are NEVER re-executed or re-billed
 * - Selective retry for failed items without re-running successes
 * - Human-approved budget ceiling verification before start
 * - Delivery variant generation (aspect ratios, formats, naming templates, SHA-256)
 * - Automatic delivery manifest generation
 * - Complete isolation from document undo history
 */

import { AssetStore } from "../../core/assets";
import {
  createDocument,
  createRaster,
  id,
  type DocumentData,
} from "../../core/model";
import { fittedRenderer } from "../../engine/fitted-renderer";
import { exportPng } from "../../engine/png";
import {exportAvif} from '../../engine/avif';
import type { DocumentRenderer } from "../../engine/renderer";
import { CanvasRenderer } from "../../engine/renderer";
import type { BudgetLedger } from "../jobs/ledger";
import { BudgetExceededError } from "../jobs/types";
import { executeRecipeAsync } from '../recipes/async-executor';
import {compileEditPlan} from '../recipes/executor';
import type { RecipeService } from "../recipes/service";
import type { Recipe } from "../recipes/types";
import {
  computeSha256,
  formatDeliverableFileName,
  generateDeliveryManifest,
} from "./manifest";
import type { BatchStorage } from "./storage";
import { validateBatchConfig } from "./schema";
import type {
  BatchConfig,
  BatchItem,
  BatchRun,
  DeliveryDeliverable,
  DeliveryVariantSpec,
} from "./types";

export type BatchEventType =
  | "run_started"
  | "run_paused"
  | "run_cancelled"
  | "run_completed"
  | "run_failed"
  | "item_progress"
  | "item_started"
  | "item_completed"
  | "item_failed"
  | "item_skipped";

export interface BatchEvent {
  type: BatchEventType;
  runId: string;
  itemId?: string;
  item?: BatchItem;
  run?: BatchRun;
  error?: string;
  progress?:Parameters<NonNullable<RawImportControl['onProgress']>>[0];
}

export interface BatchRunnerOptions {
  storage: BatchStorage;
  budgetLedger: BudgetLedger;
  recipes: RecipeService;
  renderer?: DocumentRenderer;
}

export class BatchRunner {
  private storage: BatchStorage;
  private budgetLedger: BudgetLedger;
  private renderer: DocumentRenderer;
  private runErrors = new Map<string, Error>();
  private channel?: BroadcastChannel;
  private ownership = new Map<string, Promise<void>>();
  private startingRuns = new Map<string, Promise<BatchRun>>();
  private activeControllers = new Map<string, AbortController>();
  private activeRunPromises = new Map<string, Promise<void>>();
  private pauseFlags = new Set<string>();
  private listeners = new Set<(event: BatchEvent) => void>();

  constructor(options: BatchRunnerOptions) {
    this.storage = options.storage;
    this.budgetLedger = options.budgetLedger;
    this.renderer = options.renderer ?? new CanvasRenderer();
    if (
      typeof window !== "undefined" &&
      typeof BroadcastChannel !== "undefined"
    ) {
      this.channel = new BroadcastChannel("luma-batch-control");
      this.channel.onmessage = (event) => {
        const runId = event.data?.runId;
        if (typeof runId !== "string" || !this.activeControllers.has(runId))
          return;
        void this.storage
          .getRun(runId)
          .then((run) => {
            if (run?.status === "cancelled") {
              this.activeControllers.get(runId)?.abort();
              this.emit({ type: "run_cancelled", runId, run });
            } else if (run?.status === "paused") {
              this.pauseFlags.add(runId);
              this.emit({ type: "run_paused", runId, run });
            }
          })
          .catch((error) => {
            this.activeControllers.get(runId)?.abort();
            this.emit({ type: "run_failed", runId, error: String(error) });
          });
      };
    }
  }

  dispose(): void {
    for (const controller of this.activeControllers.values())
      controller.abort();
    this.channel?.close();
    this.listeners.clear();
  }

  subscribe(listener: (event: BatchEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: BatchEvent): void {
    for (const l of this.listeners) {
      try {
        l(structuredClone(event));
      } catch (err) {
        console.error("BatchRunner listener error:", err);
      }
    }
  }

  /**
   * Estimates cost and checks budget limits for a batch configuration.
   */
  async estimateBatch(config:BatchConfig,items:BatchItem[]){
    const recipe=config.recipeSnapshot;
    if(recipe?.fontFiles?.length&&items.some(item=>!item.preparation)){
      const file=config.recipePackageSnapshot;if(!file)throw new Error('Font batch recipes require captured portable font sources.');
      const contents=await readRecipePackage(file);
      if(contents.recipe.id!==config.recipeId||JSON.stringify(contents.recipe)!==JSON.stringify(recipe))throw new Error('Batch recipe package does not match its captured recipe.');
      return withRecipeFonts(contents.fonts,undefined,[],{},()=>{},fonts=>this.estimateBatchCommands(config,items,fonts));
    }
    return this.estimateBatchCommands(config,items);
  }
  private estimateBatchCommands(config:BatchConfig,items:BatchItem[],fonts?:FontSourceStore):{totalEstimatedCostCents:number;perItemEstimates:Record<string,number>;approved:boolean;error?:string}{
    let recipe: Recipe | undefined;

    if (config.recipeId) {
      recipe = config.recipeSnapshot;
      if (!recipe || recipe.id !== config.recipeId) {
        throw new Error(
          "Batch recipe snapshot is missing or incompatible. Create a new batch to choose a recipe explicitly.",
        );
      }
    }

    const perItemEstimates: Record<string, number> = {};
    let totalEstimatedCostCents = 0;

    for (const item of items) {
      if(!item.source.raw&&isCameraRawFile({name:item.source.name,type:item.source.mimeType}))throw new Error('Saved RAW source has no reviewed settings. Create a new batch.');
      if(item.source.raw){const raw=batchRawSourceSchema.parse(item.source.raw);if(raw.report.displayWidth!==item.source.width||raw.report.displayHeight!==item.source.height)throw new Error('RAW batch source dimensions differ from its native report.');}
      if(!Number.isFinite(item.estimatedCostCents)||item.estimatedCostCents<0)throw new Error('Batch item cost must be finite and nonnegative.');
      let recipeUnitCostCents = 0;
      if (recipe&&!item.preparation) {
        // Match the initial item document and merged parameters used by executeItem.
        const assetId=item.source.assetId||'estimate-source';
        let sampleDoc=createDocument(item.name,item.source.width,item.source.height),sampleLayer=createRaster(item.name,assetId,item.source.width,item.source.height) as import('../../core/model').LayerData;
        if(item.source.raw){
          const raw=batchRawSourceSchema.parse(item.source.raw);
          if(raw.report.displayWidth!==item.source.width||raw.report.displayHeight!==item.source.height)throw new Error('RAW batch source dimensions differ from its native report.');
          const staged=rawBatchDocument(item.name,item.source.width,item.source.height,assetId);sampleDoc=staged.document.toJSON();sampleLayer=staged.layer.toJSON();
        }else sampleDoc.children.push(sampleLayer);
        const plan = compileEditPlan(recipe,sampleDoc,sampleLayer.id,{...config.recipeParams,...item.parameters},undefined,
          item.source.raw||fonts?{fonts,get(key:string){if(key!==assetId)throw new Error('Recipe source metadata is unavailable.');return{width:item.source.width,height:item.source.height,...(item.source.raw?{raw:{report:item.source.raw.report}}:{})};}}:undefined);
        if (!plan.valid)
          return {
            totalEstimatedCostCents: 0,
            perItemEstimates: {},
            approved: false,
            error: `${item.name}: Recipe preflight failed: ${plan.errors.join("; ")}`,
          };
        recipeUnitCostCents = plan.summary.estimatedSpendCents;
      }
      // Base cost + variant rendering overhead + recipe cost
      const itemCost =
        Math.round(
          (recipeUnitCostCents + (item.estimatedCostCents || 0)) * 100,
        ) / 100;
      perItemEstimates[item.id] = itemCost;
      totalEstimatedCostCents += itemCost;
    }

    totalEstimatedCostCents = Math.round(totalEstimatedCostCents * 100) / 100;

    // Verify against batch ceiling
    if (
      config.budgetCeilingCents > 0 &&
      totalEstimatedCostCents > config.budgetCeilingCents
    ) {
      return {
        totalEstimatedCostCents,
        perItemEstimates,
        approved: false,
        error: `Total estimated batch cost ($${(totalEstimatedCostCents / 100).toFixed(2)}) exceeds configured batch ceiling ($${(config.budgetCeilingCents / 100).toFixed(2)}).`,
      };
    }

    // Local deterministic work makes no provider call and needs no spending approval.
    if(totalEstimatedCostCents===0)return {totalEstimatedCostCents,perItemEstimates,approved:true};

    // Verify against human-approved budget
    const budget = this.budgetLedger.getBudget(config.budgetId);
    if (!budget) {
      return {
        totalEstimatedCostCents,
        perItemEstimates,
        approved: false,
        error: `Budget allocation '${config.budgetId}' was not found.`,
      };
    }

    if (!budget.consentGiven) {
      return {
        totalEstimatedCostCents,
        perItemEstimates,
        approved: false,
        error: `Explicit human consent is required for budget '${config.budgetId}' before starting batch.`,
      };
    }

    const availableCeiling = this.budgetLedger.getAvailableCeiling(
      config.budgetId,
    );
    if (totalEstimatedCostCents > availableCeiling) {
      return {
        totalEstimatedCostCents,
        perItemEstimates,
        approved: false,
        error: `Total estimated batch cost ($${(totalEstimatedCostCents / 100).toFixed(2)}) exceeds remaining available budget ceiling ($${(availableCeiling / 100).toFixed(2)}).`,
      };
    }

    return {
      totalEstimatedCostCents,
      perItemEstimates,
      approved: true,
    };
  }

  /**
   * Starts or resumes a batch run.
   */
  startBatch(runId: string, retryFailed = false): Promise<BatchRun> {
    const starting = this.startingRuns.get(runId);
    if (starting) return starting;
    const pending = this.startOwned(runId, retryFailed).finally(() =>
      this.startingRuns.delete(runId),
    );
    this.startingRuns.set(runId, pending);
    return pending;
  }

  private async startOwned(
    runId: string,
    retryFailed: boolean,
  ): Promise<BatchRun> {
    const owned = this.ownership.get(runId);
    if (owned) {
      const current = await this.storage.getRun(runId);
      if (current?.status === "running" && this.activeRunPromises.has(runId))
        return current;
      await owned;
    }
    if (typeof window === "undefined")
      return this.startOrResume(runId, retryFailed);
    if (!navigator.locks)
      throw new Error(
        "Safe batch execution requires browser Web Locks support.",
      );
    let resolveStart!: (run: BatchRun) => void;
    let rejectStart!: (error: unknown) => void;
    const started = new Promise<BatchRun>((resolve, reject) => {
      resolveStart = resolve;
      rejectStart = reject;
    });
    const ownership = navigator.locks
      .request(`luma-batch:${runId}`, { ifAvailable: true }, async (lock) => {
        if (!lock)
          throw new Error(
            "This batch is already running in another tab. Use that tab or wait for it to finish.",
          );
        const run = await this.startOrResume(runId, retryFailed);
        resolveStart(run);
        await this.activeRunPromises.get(runId);
      })
      .catch(rejectStart)
      .finally(() => this.ownership.delete(runId));
    this.ownership.set(runId, ownership);
    return started;
  }

  private async startOrResume(
    runId: string,
    retryFailed: boolean,
  ): Promise<BatchRun> {
    let run = await this.storage.getRun(runId);
    if (!run) throw new Error(`Batch run '${runId}' not found.`);
    const validation = validateBatchConfig(run.config);
    if (!validation.valid)
      throw new Error(
        `Invalid saved batch configuration: ${validation.errors.join("; ")}`,
      );

    // A paused worker may still be finishing an item; do not start a second pool.
    const active = this.activeRunPromises.get(runId);
    if (active) {
      if (run.status === "running") return run;
      await active;
      return this.startOrResume(runId, retryFailed);
    }

    const capturedSettings=JSON.stringify(run.config.variants.map(deliverySettingsKey));
    const capturedStatus=run.status;
    const workingCheckpoints=(value:BatchRun)=>JSON.stringify(value.items.map(item=>[item.id,item.checkpoint,item.deliverables]));
    const capturedCheckpoints=workingCheckpoints(run);
    const colors=await prepareDeliveryVariants(run.config.variants);
    for(const item of run.items)for(const delivery of item.deliverables){
      const variant=run.config.variants.find(v=>v.id===delivery.variantId);if(!variant)throw new Error('An accepted variant was removed from batch settings. Create a new batch.');
      const float=!!item.checkpoint&&isFloatDocument(item.checkpoint);if(delivery.color?.version===2&&!float)throw new Error('An accepted float delivery requires its float working checkpoint.');
      const format=variant.format==='tiff'&&variant.tiffPrecision==='float32'?'rgba-float32':variant.format==='tiff'&&variant.tiffPrecision==='uint16'?'rgba16':'rgba8',key=await deliverySettingsHash(variant)+(float?':float:'+format:'');
      if(float&&variant.color&&!colors.has(key))colors.set(key,await prepareColorOutputSource(variant.color,{},format));
      await verifyDeliveryContract(variant,delivery,colors.get(key)?.receipt,float?'linear-srgb-float32':'srgb8');
    }

    const fresh=await this.storage.getRun(runId);
    if(!fresh||fresh.status!==capturedStatus||workingCheckpoints(fresh)!==capturedCheckpoints||JSON.stringify(fresh.config.variants.map(deliverySettingsKey))!==capturedSettings)throw new Error('Batch state or delivery settings changed during profile preflight. Start again explicitly.');
    run = await this.storage.updateRun(runId, (current) => {
      if(current.status!==capturedStatus||workingCheckpoints(current)!==capturedCheckpoints||JSON.stringify(current.config.variants.map(deliverySettingsKey))!==capturedSettings)throw new Error('Batch state changed during delivery preflight.');
      for (const item of current.items) {
        if (item.status === "running") item.status = "pending";
        if (retryFailed && item.status === "failed") {
          item.status = "pending";
          item.error = undefined;
          item.retryCount++;
        }
      }
      if (current.status === "running" || retryFailed) current.status = "idle";
      this.updateRunSummary(current);
      current.updatedAt = new Date().toISOString();
    });

    // Filter pending items to process
    const pendingItems = run.items.filter((i) => i.status === "pending");

    if (pendingItems.length === 0) {
      return this.storage.updateRun(runId, (current) => {
        current.status = current.items.some((item) => item.status === "failed")
          ? "failed"
          : current.items.some((item) => item.status === "cancelled")
            ? "cancelled"
            : "completed";
        this.updateRunSummary(current);
        current.updatedAt = new Date().toISOString();
      });
    }

    const estimate = await this.estimateBatch(run.config, pendingItems);
    if (!estimate.approved) {
      throw new BudgetExceededError(
        estimate.error || "Batch preflight budget check failed.",
      );
    }

    run = await this.storage.updateRun(runId, (current) => {
      if (current.status !== run!.status)
        throw new Error(
          "Batch state changed during preflight. Start again explicitly.",
        );
      current.status = "running";
      this.updateRunSummary(current);
      current.updatedAt = new Date().toISOString();
    });

    this.runErrors.delete(runId);
    const controller = new AbortController();
    this.activeControllers.set(runId, controller);
    this.pauseFlags.delete(runId);

    this.emit({ type: "run_started", runId, run });

    // Launch worker loop asynchronously and retain promise
    const queuePromise = this.processQueue(runId, controller.signal)
      .catch((error) => {
        const failure =
          error instanceof Error ? error : new Error(String(error));
        controller.abort();
        this.runErrors.set(runId, failure);
        this.emit({ type: "run_failed", runId, error: failure.message });
      })
      .finally(() => {
        this.activeRunPromises.delete(runId);
      });
    this.activeRunPromises.set(runId, queuePromise);

    return run;
  }

  /**
   * Awaits completion of an active batch run.
   */
  async waitForRun(runId: string): Promise<BatchRun> {
    const p = this.activeRunPromises.get(runId);
    if (p) {
      await p;
    }
    const failure = this.runErrors.get(runId);
    if (failure) throw failure;
    const run = await this.storage.getRun(runId);
    if (!run) throw new Error(`Batch run '${runId}' not found.`);
    return run;
  }

  /**
   * Pauses an active batch run gracefully.
   */
  async pauseBatch(runId: string): Promise<void> {
    this.pauseFlags.add(runId);
    const run = await this.storage.updateRun(runId, (current) => {
      if (current.status === "running") current.status = "paused";
      current.updatedAt = new Date().toISOString();
    });
    this.channel?.postMessage({ runId });
    if (run.status === "paused") this.emit({ type: "run_paused", runId, run });
  }

  /**
   * Cancels a batch run and aborts all active item workers.
   */
  async cancelBatch(runId: string): Promise<void> {
    const controller = this.activeControllers.get(runId);
    if (controller) {
      controller.abort();
      this.activeControllers.delete(runId);
    }
    this.pauseFlags.delete(runId);

    const run = await this.storage.updateRun(runId, (current) => {
      current.status = "cancelled";
      for (const item of current.items) {
        if (item.status === "pending" || item.status === "running")
          item.status = "cancelled";
      }
      this.updateRunSummary(current);
      current.updatedAt = new Date().toISOString();
    });

    this.channel?.postMessage({ runId });
    this.emit({ type: "run_cancelled", runId, run });
  }

  /**
   * Resets all failed items to pending and resumes execution.
   * Does NOT re-execute or re-bill any succeeded items.
   */
  async retryFailed(runId: string): Promise<BatchRun> {
    return this.startBatch(runId, true);
  }

  async deleteRun(runId: string): Promise<void> {
    if (this.activeRunPromises.has(runId) || this.startingRuns.has(runId)) {
      throw new Error(
        "Pause or cancel the batch and wait for workers to finish before deleting it.",
      );
    }
    if (typeof window === "undefined") return this.storage.deleteRun(runId);
    if (!navigator.locks)
      throw new Error(
        "Safe batch deletion requires browser Web Locks support.",
      );
    await navigator.locks.request(
      `luma-batch:${runId}`,
      { ifAvailable: true },
      async (lock) => {
        if (!lock)
          throw new Error(
            "This batch is active in another tab. Wait for its workers to finish before deleting it.",
          );
        await this.storage.deleteRun(runId);
      },
    );
  }

  /**
   * Core worker queue processing items concurrently.
   */
  private async processQueue(
    runId: string,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      const run = await this.storage.getRun(runId);
      if (!run) return;

      const concurrency = Math.max(1, Math.min(8, run.config.concurrency || 2));

      const claimed = new Set<string>();
      let pickLock = Promise.resolve();
      const synchronizedPick = (): Promise<BatchItem | null> => {
        const next = pickLock.then(async () => {
          if (signal.aborted || this.pauseFlags.has(runId)) return null;
          const currentRun = await this.storage.updateRun(runId, (current) => {
            if (
              current.status !== "running" ||
              signal.aborted ||
              this.pauseFlags.has(runId)
            )
              return;
            const item = current.items.find(
              (candidate) => candidate.status === "pending",
            );
            if (item) {
              item.status = "running";
              item.startedAt = new Date().toISOString();
            }
          });
          if (currentRun.status !== "running") return null;
          const nextItem = currentRun.items.find(
            (item) => item.status === "running" && !claimed.has(item.id),
          );
          if (!nextItem) return null;
          claimed.add(nextItem.id);
          this.emit({
            type: "item_started",
            runId,
            itemId: nextItem.id,
            item: nextItem,
          });

          return nextItem;
        });
        pickLock = next.then(
          () => {},
          () => {},
        );
        return next;
      };

      const updateItemState = async (
        itemId: string,
        patch: Partial<BatchItem>,
      ): Promise<void> => {
        const next = pickLock.then(async () => {
          await this.storage.updateRun(runId, (currentRun) => {
            const target = currentRun.items.find((i) => i.id === itemId);
            if (target && target.status !== "cancelled")
              Object.assign(target, patch);
            this.updateRunSummary(currentRun);
            currentRun.updatedAt = new Date().toISOString();
          });
        });
        pickLock = next.then(
          () => {},
          () => {},
        );
        await next;
      };

      const worker = async (): Promise<void> => {
        while (!signal.aborted && !this.pauseFlags.has(runId)) {
          const item = await synchronizedPick();
          if (!item) break;

          try {
            await this.executeItem(
              run.config,
              runId,
              item,
              signal,
              async () => {
                await updateItemState(item.id, {
                  deliverables: item.deliverables,
                  source: item.source,
                  ...(item.checkpoint?{checkpoint:item.checkpoint}:{}),
                });
              },
            );
            if (signal.aborted) throw new Error("Batch execution aborted");
            await updateItemState(item.id, {
              status: "succeeded",
              deliverables: item.deliverables,
              actualCostCents: item.actualCostCents,
              checkpoint: item.checkpoint,
              completedAt: item.completedAt,
              durationMs: item.durationMs,
              error: undefined,
            });
            this.emit({ type: "item_completed", runId, itemId: item.id, item });
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            const now = new Date().toISOString();
            await updateItemState(item.id, {
              status: "failed",
              error: msg,
              completedAt: now,
            });
            item.status = "failed";
            item.error = msg;
            item.completedAt = now;
            this.emit({
              type: "item_failed",
              runId,
              itemId: item.id,
              item,
              error: msg,
            });

            if (run.config.stopOnFirstFailure) {
              this.pauseFlags.add(runId);
            }
          }
        }
      };

      const pool: Promise<void>[] = [];
      for (let i = 0; i < concurrency; i++) {
        pool.push(
          worker().catch((error) => {
            this.activeControllers.get(runId)?.abort();
            throw error;
          }),
        );
      }

      const settled = await Promise.allSettled(pool);
      const rejected = settled.find((result) => result.status === "rejected");
      if (rejected?.status === "rejected") throw rejected.reason;

      // Final completion verification
      if (!signal.aborted) {
        const finalRun = await this.storage.updateRun(runId, (current) => {
          if (current.status === "cancelled") return;
          if (this.pauseFlags.has(runId) || current.status === "paused") {
            current.status = "paused";
          } else if (
            !current.items.some(
              (item) => item.status === "pending" || item.status === "running",
            )
          ) {
            current.status = current.items.some(
              (item) => item.status === "failed",
            )
              ? "failed"
              : current.items.some((item) => item.status === "cancelled")
                ? "cancelled"
                : "completed";
            current.completedAt = new Date().toISOString();
          }
          this.updateRunSummary(current);
          current.updatedAt = new Date().toISOString();
        });
        if (finalRun.status === "paused")
          this.emit({ type: "run_paused", runId, run: finalRun });
        if (finalRun.status === "failed")
          this.emit({
            type: "run_failed",
            runId,
            run: finalRun,
            error: `${finalRun.summary.failed} batch item(s) failed. Review item errors and retry failed items.`,
          });
        if (finalRun.status === "completed") {
          try {
            finalRun.deliveryManifest =
              await generateDeliveryManifest(finalRun);
          } catch (error) {
            delete finalRun.deliveryManifest;
            finalRun.deliveryManifestError =
              error instanceof Error ? error.message : String(error);
          }
          this.emit({ type: "run_completed", runId, run: finalRun });
        }
      }
    } finally {
      this.activeControllers.delete(runId);
    }
  }

  /**
   * Executes a single batch item: loads source, applies recipe,
   * generates variant crops/formats, computes SHA-256 digests,
   * and saves deliverables.
   */
  private async executeItem(
    config: BatchConfig,
    runId: string,
    item: BatchItem,
    signal: AbortSignal,
    checkpoint: () => Promise<void>,
  ): Promise<void> {
    if (signal.aborted) {
      item.status = "cancelled";
      return;
    }

    // Invariant: never re-run or re-export succeeded items
    if (item.status === "succeeded") {
      this.emit({ type: "item_skipped", runId, itemId: item.id, item });
      return;
    }

    const startTime = Date.now();
    let assets = new AssetStore();

    try {
      const sourceBlob =
        item.source.blob ||
        (await this.storage.getDeliverableBlob(`src-${item.id}`));
      if (!sourceBlob)
        throw new Error(`Source image bytes are missing for '${item.name}'.`);
      const digest = await computeSha256(await sourceBlob.arrayBuffer());
      if (item.source.sha256 && item.source.sha256 !== digest) {
        throw new Error(
          `Source integrity verification failed for '${item.name}'. Restore the original source before retrying.`,
        );
      }
      if (!item.source.sha256 && item.deliverables.length > 0) {
        throw new Error(
          "Cannot verify the original source for this legacy partial batch. Create a new batch explicitly.",
        );
      }
      item.source.sha256 = digest;
      const progress:RawImportControl['onProgress']=value=>this.emit({type:'item_progress',runId,itemId:item.id,progress:value});
      let doc:DocumentData,baseLayer:import('../../core/model').LayerData,preparedHistory:RetainedHistory|undefined;
      const historyOrigin={surface:'host' as const,batch:{runId,itemId:item.id}};
      if(item.preparation){
        const accepted=await readBatchPreparation(this.storage,config,item,signal);assets.dispose();assets=accepted.assets;doc=accepted.document;preparedHistory=accepted.history;baseLayer=doc.children[0];
      }else{
        if(item.source.raw){
          if(item.deliverables.length)throw new Error('RAW outputs have no accepted prepared scene. Restore the checkpoint or create a new batch.');
          const raw=batchRawSourceSchema.parse(item.source.raw);
          const source=await prepareRawAsset(assets,sourceBlob,raw.originalName,raw.options,{signal,onProgress:progress},()=>signal.throwIfAborted());
          if(source.width!==item.source.width||source.height!==item.source.height)throw new Error('RAW native dimensions changed. Review the original before creating a new batch.');
          const prepared=rawBatchDocument(item.name,source.width,source.height,source.id,historyOrigin);preparedHistory=captureProjectHistory(prepared.document.getSnapshot());doc=prepared.document.toJSON();baseLayer=prepared.layer.toJSON();
        }else{
          const assetId=item.source.assetId||id(),source=await assets.add(sourceBlob,item.name,assetId,false);
          doc=createDocument(item.name,source.width,source.height);baseLayer=createRaster(item.name,assetId,source.width,source.height);doc.children.push(baseLayer);
        }
      }

      // 3. Apply Recipe if configured
      let actualSpendCents = 0;
      if (config.recipeId&&!item.preparation) {
        const recipe = config.recipeSnapshot;
        if (!recipe || recipe.id !== config.recipeId) {
          throw new Error(
            "Batch recipe snapshot is missing or incompatible. Create a new batch to choose a recipe explicitly.",
          );
        }

        if (recipe) {
          const mergedParams = {
            ...(config.recipeParams || {}),
            ...(item.parameters || {}),
          };

          if (config.recipePackageId) {
            const file = config.recipePackageSnapshot;
            if (!file)
              throw new Error("Batch portable recipe snapshot is missing.");
            const packaged = await readRecipePackage(file);
            if (
              packaged.recipe.id !== config.recipePackageId ||
              JSON.stringify(packaged.recipe) !== JSON.stringify(recipe)
            ) {
              throw new Error(
                "Batch recipe package does not match its captured recipe.",
              );
            }
            if (signal.aborted) throw new Error("Batch execution aborted");
            const stagingDocument = Document._fromWorkspace(doc,preparedHistory);stagingDocument._setDefaultHistoryOrigin(historyOrigin);
            stagingDocument.assetStore = assets;
            stagingDocument.selectedLayer = stagingDocument.getLayer(
              baseLayer.id,
            )!;
            const result = await executeRecipePackage(
              file,
              stagingDocument,
              mergedParams,
              ()=>signal.throwIfAborted(),
              {signal,onProgress:progress},
            );
            if (signal.aborted) throw new Error("Batch execution aborted");
            doc = stagingDocument.toJSON();preparedHistory=captureRetainedHistory(stagingDocument.getSnapshot());
            actualSpendCents += result.plan.summary.estimatedSpendCents;
          } else {
            const stagingDocument=Document._fromWorkspace(doc,preparedHistory);stagingDocument._setDefaultHistoryOrigin(historyOrigin);stagingDocument.assetStore=assets;
            stagingDocument.selectedLayer=stagingDocument.getLayer(baseLayer.id)!;
            const result=await executeRecipeAsync(recipe,stagingDocument,mergedParams,{signal,onProgress:progress});
            if(!result.success)throw new Error(result.error??`Recipe '${recipe.name}' failed.`);
            doc=stagingDocument.toJSON();preparedHistory=captureRetainedHistory(stagingDocument.getSnapshot());
            actualSpendCents += result.plan.summary.estimatedSpendCents;
          }
        }
      }

      if((item.source.raw||isFloatDocument(doc)||documentFontFiles(doc).length)&&!item.preparation){
        signal.throwIfAborted();
        const history=preparedHistory;
        const project=await serializeProject(doc,assets,history),inputsSha256=await preparationInputs(config,item);
        const metadata={version:1 as const,sha256:await rawBlobHash(project),byteLength:project.size,inputsSha256};signal.throwIfAborted();
        await this.storage.commitPreparation(runId,item.id,project,metadata);item.preparation=metadata;signal.throwIfAborted();
      }

      // 4. Generate Delivery Variants
      // Bind partial precision outputs to their accepted working scene too.
      if(isFloatDocument(doc)){item.checkpoint=doc;await checkpoint();signal.throwIfAborted();}
      const previousDeliverables = [...item.deliverables];
      const deliverables: DeliveryDeliverable[] = [];

      for (const variant of config.variants) {
        if (signal.aborted) throw new Error("Batch execution aborted");

        const existing = previousDeliverables.find(
          (d) => d.variantId === variant.id,
        );
        if(existing)await verifyDeliveryContract(variant,existing,undefined,isFloatDocument(doc)?'linear-srgb-float32':'srgb8');
        const existingBlob = existing
          ? await this.storage.getDeliverableBlob(existing.id)
          : null;
        if (
          existing &&
          existingBlob &&
          (await computeSha256(await existingBlob.arrayBuffer())) ===
            existing.sha256
        ) {
          deliverables.push(existing);
          continue;
        }
        const deliverable = await this.renderVariant(
          doc,
          assets,
          item,
          variant,
          config.outputNamingTemplate,
          signal,
        );

        if (signal.aborted) throw new Error("Batch execution aborted");
        await this.storage.commitDeliverable(runId, item.id, deliverable);
        delete deliverable.blob;
        deliverables.push(deliverable);
        item.deliverables = [...deliverables];
        await checkpoint();
      }

      // 5. Commit Item Success
      item.deliverables = deliverables;
      item.actualCostCents = actualSpendCents;
      item.checkpoint = doc;
      item.status = "succeeded";
      item.completedAt = new Date().toISOString();
      item.durationMs = Date.now() - startTime;
      item.error = undefined;
    } finally {
      assets.dispose();
    }
  }

  /**
   * Renders a specific delivery variant crop/format from the document.
   */
  private async renderVariant(
    doc: DocumentData,
    assets: AssetStore,
    item: BatchItem,
    variant: DeliveryVariantSpec,
    outputNamingTemplate: string,
    signal?:AbortSignal,
  ): Promise<DeliveryDeliverable> {
    const delivId = `${item.id}:${variant.id}`;
    const sourceCheck=captureRasterExportSources(doc,assets,{signal},'batch delivery');
    try{
    const settingsSha256=await deliverySettingsHash(variant);sourceCheck();
    const floatFormat=variant.format==='tiff'&&variant.tiffPrecision==='float32'?'rgba-float32':variant.format==='tiff'&&variant.tiffPrecision==='uint16'?'rgba16':'rgba8';
    const preparedColor=variant.color?await prepareColorOutputSource(variant.color,{signal},isFloatDocument(doc)?floatFormat:undefined):undefined;sourceCheck();

    // Scale and fit layers into variant geometry
    const variantDoc = createDocument(
      `${item.name}_${variant.name}`,
      variant.targetWidth,
      variant.targetHeight,
    );
    if(isFloatDocument(doc)){variantDoc.colorSpace=doc.colorSpace;variantDoc.precision=doc.precision;}

    const deliveryRenderer = fittedRenderer(
      this.renderer,
      doc,
      variant.targetWidth,
      variant.targetHeight,
      variant.fit,
    );

    // Render output Blob with format conformance and production error propagation
    let blob: Blob;
    try {
      if (variant.format === "png") {
        blob = await exportPng(variantDoc, assets, deliveryRenderer,{signal},preparedColor?.output);
      } else if(variant.format==='tiff'){
        blob=await exportTiff(variantDoc,assets,deliveryRenderer,variant.tiffVariant,{signal},preparedColor?.output,variant.tiffPrecision);
      } else if(variant.format==='pdf'){
        blob=await exportPdf(variantDoc,assets,deliveryRenderer,variant.pdfDpi,{signal},preparedColor?.output);
      } else if(variant.format==='avif'){
        blob=await exportAvif(variantDoc,assets,deliveryRenderer,{quality:variant.quality,lossless:variant.avifLossless,speed:variant.avifSpeed},{signal},doc);
      } else if (variant.format === "jpeg" || variant.format === "webp") {
        const mimeType =
          variant.format === "jpeg" ? "image/jpeg" : "image/webp";
        const renderedCanvas = await deliveryRenderer.render(
          variantDoc,
          assets,
          {
            region: {
              x: 0,
              y: 0,
              width: variant.targetWidth,
              height: variant.targetHeight,
            },
            maxPixels: variant.targetWidth * variant.targetHeight,
            maxDimension: Math.max(variant.targetWidth, variant.targetHeight),
            cache: false,
            readback: true,
          },
        );

        try {
          if (typeof renderedCanvas.toBlob === "function") {
            const rawBlob = await new Promise<Blob | null>((resolve) => {
              renderedCanvas.toBlob(resolve, mimeType, variant.quality??0.92);
            });

            if (rawBlob) {
              const header = new Uint8Array(
                await rawBlob.slice(0, 12).arrayBuffer(),
              );
              const isPngFallback =
                header.length >= 8 &&
                header[0] === 0x89 &&
                header[1] === 0x50 &&
                header[2] === 0x4e;
              if (isPngFallback) {
                throw new Error(
                  `Platform canvas.toBlob fell back to PNG instead of requested ${variant.format.toUpperCase()} format.`,
                );
              }
              if (
                variant.format === "jpeg" &&
                (header[0] !== 0xff || header[1] !== 0xd8)
              ) {
                throw new Error(
                  "Platform failed to produce valid JPEG byte stream.",
                );
              }
              if (
                variant.format === "webp" &&
                (header[0] !== 0x52 ||
                  header[1] !== 0x49 ||
                  header[8] !== 0x57 ||
                  header[9] !== 0x45)
              ) {
                throw new Error(
                  "Platform failed to produce valid WebP byte stream.",
                );
              }
              blob = rawBlob;
            } else {
              throw new Error(
                `Failed to encode canvas to ${variant.format.toUpperCase()}.`,
              );
            }
          } else {
            throw new Error(
              `Canvas toBlob encoding is not supported in this environment.`,
            );
          }
        } finally {
          renderedCanvas.width = renderedCanvas.height = 0;
        }
      } else {
        throw new Error(
          `Unsupported deliverable format: ${(variant as any).format}`,
        );
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Variant rendering failed for '${variant.name}': ${message}`,
      );
    }

    sourceCheck();
    const arrayBuffer = await blob.arrayBuffer();
    sourceCheck();
    const digest = await computeSha256(arrayBuffer);sourceCheck();

    // Format safe deliverable filename
    const template =
      variant.nameTemplate || outputNamingTemplate || "{name}_{variant}";
    const fileName = formatDeliverableFileName(template, item, variant);

    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    const div = gcd(variant.targetWidth, variant.targetHeight);
    const aspectRatio = `${variant.targetWidth / div}:${variant.targetHeight / div}`;

    return {
      id: delivId,
      itemId: item.id,
      variantId: variant.id,
      settingsSha256,
      ...(preparedColor?{color:preparedColor.receipt}:{}),
      variantName: variant.name,
      format: variant.format,
      width: variant.targetWidth,
      height: variant.targetHeight,
      aspectRatio,
      fileName,
      byteLength: arrayBuffer.byteLength,
      sha256: digest,
      blob,
      createdAt: new Date().toISOString(),
    };
    }finally{sourceCheck.release();}
  }

  private updateRunSummary(run: BatchRun): void {
    let total = run.items.length;
    let pending = 0;
    let running = 0;
    let succeeded = 0;
    let failed = 0;
    let skipped = 0;
    let cancelled = 0;
    let totalEst = 0;
    let totalAct = 0;
    let approved = 0;
    let rejected = 0;
    let flagged = 0;

    for (const item of run.items) {
      totalEst += item.estimatedCostCents || 0;
      totalAct += item.actualCostCents || 0;

      if (item.status === "pending") pending++;
      else if (item.status === "running") running++;
      else if (item.status === "succeeded") succeeded++;
      else if (item.status === "failed") failed++;
      else if (item.status === "skipped") skipped++;
      else if (item.status === "cancelled") cancelled++;

      if (item.reviewState === "approved") approved++;
      else if (item.reviewState === "rejected") rejected++;
      else if (item.reviewState === "flagged") flagged++;
    }

    run.summary = {
      total,
      pending,
      running,
      succeeded,
      failed,
      skipped,
      cancelled,
      totalEstimatedCostCents: Math.round(totalEst * 100) / 100,
      totalActualCostCents: Math.round(totalAct * 100) / 100,
      approvedCount: approved,
      rejectedCount: rejected,
      flaggedCount: flagged,
    };
  }
}
