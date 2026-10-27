import {prepareDeliveryVariants} from './delivery-preparation';
import {captureColorOutput} from '../../core/color/output-source';
import type {ColorOutput} from '../../core/color/color-settings';
import type {IccControl} from '../../core/color/icc-client';
import {encodeDeliveryPreset,readDeliveryPreset,type DeliveryPreset} from './delivery-preset';
import {isCameraRawFile} from '../../core/interchange/raw/files';
import {readBatchPreparation} from './preparation';
import {prepareRawBatchSource,batchRawSourceSchema} from './raw';
import type {RawDecodeOptions,RawImportControl} from '../../core/interchange/raw/types';
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
  private disposed=false;
  private readonly colorControllers=new Set<AbortController>();
  private readonly rawControllers=new Set<AbortController>();
  private assertOpen(){if(this.disposed)throw new Error('The batch service is disposed.');}
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
  async prepareRawSource(file:File,options:RawDecodeOptions={},control:RawImportControl={}){
    this.assertOpen();const controller=new AbortController();this.rawControllers.add(controller);
    const signal=control.signal?AbortSignal.any([control.signal,controller.signal]):controller.signal;
    try{const source=await prepareRawBatchSource(file,options,{...control,signal});this.assertOpen();return source;}
    finally{this.rawControllers.delete(controller);}
  }

  private async withColorControl<T>(control:IccControl,action:(control:IccControl)=>Promise<T>,commits=false):Promise<T>{
    this.assertOpen();const controller=new AbortController();this.colorControllers.add(controller);
    const signal=control.signal?AbortSignal.any([control.signal,controller.signal]):controller.signal;
    try{signal.throwIfAborted();const result=await action({...control,signal});if(!commits){signal.throwIfAborted();this.assertOpen();}return result;}
    finally{this.colorControllers.delete(controller);}
  }
  captureColorOutput(output:ColorOutput,control:IccControl={}){return this.withColorControl(control,current=>captureColorOutput(output,current));}
  exportDeliveryPreset(input:DeliveryPreset,control:IccControl={}){const captured=structuredClone(input);return this.withColorControl(control,async current=>{await prepareDeliveryVariants(captured.variants,current);return encodeDeliveryPreset(captured,current.signal);});}
  importDeliveryPreset(file:Blob,control:IccControl={}){return this.withColorControl(control,async current=>{const preset=await readDeliveryPreset(file,current.signal);await prepareDeliveryVariants(preset.variants,current);return preset;});}

  createBatch(configInput:Partial<BatchConfig>&{name:string;budgetId:string},sourceImages:BatchSourceInput[],control:IccControl={}):Promise<BatchRun>{
    return this.withColorControl(control,current=>this.createBatchOwned(configInput,sourceImages,current),true);
  }
  private async createBatchOwned(
    configInput:Partial<BatchConfig>&{name:string;budgetId:string},sourceImages:BatchSourceInput[],control:IccControl,
  ):Promise<BatchRun>{
    this.assertOpen();
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
      const { recipe,deliveryPreset } = await readRecipePackage(file);
      if(deliveryPreset){const preset=await this.importDeliveryPreset(deliveryPreset,control);if(configInput.variants===undefined)config.variants=preset.variants;}
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
      if(recipe.fontFiles?.length||recipe.delivery){config.recipePackageSnapshot=await this.recipes.exportRecipePackage(recipe);config.recipePackageId=recipe.id;if(recipe.delivery&&configInput.variants===undefined){const contents=await readRecipePackage(config.recipePackageSnapshot);if(!contents.deliveryPreset)throw new Error('Missing recipe delivery preset.');config.variants=(await this.importDeliveryPreset(contents.deliveryPreset,control)).variants;}}
    }

    await prepareDeliveryVariants(config.variants,control);this.assertOpen();control.signal?.throwIfAborted();
    const itemNames = batchItemNames(sourceImages);
    const items: BatchItem[] = [];
    for (let index = 0; index < sourceImages.length; index++) {
      control.signal?.throwIfAborted();
      const { parameters, ...src } = sourceImages[index];
      if(!src.raw&&isCameraRawFile({name:src.name,type:src.mimeType}))throw new Error('Review RAW settings and explicit precision consent before creating a batch.');
      if(src.raw){
        src.raw=batchRawSourceSchema.parse(src.raw);
        if(!src.blob)throw new Error('RAW batch creation requires complete original bytes.');
        const verified=await this.prepareRawSource(new File([src.blob],src.raw.originalName,{type:src.blob.type}),src.raw.options,{signal:control.signal});
        if(verified.width!==src.width||verified.height!==src.height||JSON.stringify(verified.raw!.report)!==JSON.stringify(src.raw.report))throw new Error('RAW batch source metadata changed. Review the source again.');
      }
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

    this.assertOpen();
    control.signal?.throwIfAborted();await this.storage.createRun(run,control.signal);
    return run;
  }

  async getPreparedProject(runId:string,itemId:string):Promise<Blob>{
    this.assertOpen();
    const run=await this.storage.getRun(runId),item=run?.items.find(value=>value.id===itemId);
    if(!run||!item)throw new Error('Batch item was not found.');
    const prepared=await readBatchPreparation(this.storage,run.config,item);
    prepared.assets.dispose();this.assertOpen();return prepared.blob;
  }

  async estimateBatch(runId: string) {
    const run = await this.storage.getRun(runId);
    if (!run) throw new Error(`Batch run '${runId}' not found.`);
    return this.runner.estimateBatch(run.config, run.items);
  }

  async start(runId: string): Promise<BatchRun> {
    this.assertOpen();
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
    this.assertOpen();
    return this.runner.startBatch(runId);
  }

  async cancel(runId: string): Promise<void> {
    return this.runner.cancelBatch(runId);
  }

  async retryFailed(runId: string): Promise<BatchRun> {
    this.assertOpen();
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

    if(run.config.variants.some(variant=>variant.color||['tiff','pdf'].includes(variant.format))){
      const preset=await encodeDeliveryPreset({name:run.config.name,variants:run.config.variants},options.signal);
      entries.push({name:'delivery-preset.canoli-delivery',data:preset});
    }
    const preparations=[],fontPreparations=[];
    for(const item of run.items.filter(item=>item.source.raw||item.preparation)){
      options.signal?.throwIfAborted();
      if(item.deliverables.length&&!item.preparation)throw new Error('RAW deliverables have no accepted editable project. Restore the prepared checkpoint before packaging.');
      if(!item.preparation)continue;
      const blob=await this.getPreparedProject(runId,item.id),path=`projects/${item.id}.luma`;
      options.signal?.throwIfAborted();entries.push({name:path,data:blob});
      if(item.source.raw)preparations.push({itemId:item.id,sourceSha256:item.source.sha256,originalName:item.source.raw.originalName,options:item.source.raw.options,projectPath:path,projectSha256:item.preparation.sha256,projectByteLength:blob.size,inputsSha256:item.preparation.inputsSha256});
      else fontPreparations.push({itemId:item.id,sourceSha256:item.source.sha256,originalName:item.source.name,projectPath:path,projectSha256:item.preparation.sha256,projectByteLength:blob.size,inputsSha256:item.preparation.inputsSha256});
    }
    if(preparations.length){
      const record={format:'canoli-raw-batch',version:1,batchId:run.id,preparations};
      entries.push({name:'raw-preparation.json',data:new Blob([JSON.stringify({...record,integrity:{sha256:await computeSha256(JSON.stringify(record))}},null,2)])});
    }
    if(fontPreparations.length){
      const record={format:'canoli-font-batch',version:1,batchId:run.id,preparations:fontPreparations};
      entries.push({name:'font-preparation.json',data:new Blob([JSON.stringify({...record,integrity:{sha256:await computeSha256(JSON.stringify(record))}},null,2)])});
    }
    return createZipArchiveAsync(entries, options);
  }

  dispose(): void {
    this.disposed=true;for(const controller of this.colorControllers)controller.abort();this.colorControllers.clear();for(const controller of this.rawControllers)controller.abort();this.rawControllers.clear();
    this.runner.dispose();
    if (this.unsubscribeRunner) {
      this.unsubscribeRunner();
      this.unsubscribeRunner = undefined;
    }
    this.listeners.clear();
  }
}
