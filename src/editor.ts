import {exportTiffPages as encodeTiffPages} from './engine/tiff';
import {z} from 'zod';
import {prepareCharacterTextMetrics} from './engine/styled-text-layout';
import {characterInputForLayer} from './core/character-layout';
import {characterRangeSchema} from './core/text-ranges';
import type {FontInspection,FontInspectOptions,FontPrepareOptions,FontSourceControl,PreparedFontSource} from './fonts/types';
import {validateTiffVariant,type TiffPagesExportOptions} from './core/tiff';
import {captureRetainedHistory, captureProjectHistory, retainedDocuments} from './core/history';
import {freeze} from './core/immutable';
import {historyTimeline} from './core/history-inspection';
import {renderHistoryComparison, type HistoryComparisonPreview} from './engine/history-comparison';
import {PaletteLibrary} from './palettes/service';
import {ArtworkLibrary} from './library/service';
import type {ArtworkMetadata} from './library/model';
import {CanvasRenderer} from './engine/renderer';
import {captureAssetSource} from "./core/assets";
import {ChatGptConnections} from './integrations/chatgpt/host';
import {rawDevelopOptionsSchema} from "./core/interchange/raw/types";
import {prepareRawImport,developRawComponent} from "./engine/raw-import";
import {rawSourceMetadata,ownRawSource} from "./core/interchange/raw/source";
import {RecentFilesService} from './workspace/recent-service';
import {LensLibraryService} from './core/interchange/lens/library';
import { separateFrequencies,prepareFrequencySeparation } from "./engine/frequency-separation";
import type { FrequencySeparationOptions } from "./core/frequency-separation";
import {captureFrequencyRadius} from './core/frequency-separation';
import { captureVectorBoolean, vectorBooleanSelectionSchema } from './core/vector-boolean';
import {remapLayerAssets} from './core/asset-references';
import {BrushTextureSourceOwner} from './brushes/texture-source';
import type { VectorBooleanRequest, VectorBooleanControl, VectorBooleanResult } from './core/vector-boolean';
import { prepareVectorBoolean } from './engine/prepare-vector-boolean';
import {inspectSvgFile,prepareSvgImport} from './engine/svg-import';
import type {SvgImportControl,SvgImportOptions,SvgImportReport} from './core/svg-import';
import { encodeRgbaPng } from "./engine/png";
import {prepareMatting} from './engine/prepare-matting';
import {preparePreflight} from './engine/preflight';
import type {PreflightOptions,PreflightControl} from './core/preflight';
import type {RefineEdgeControl} from './core/matting';
import { prepareSubject } from './engine/prepare-subject';
import { selectSubjectOptionsSchema, type SelectSubjectControl } from './core/subject-selection';
import { prepareColorRange } from "./engine/color-range";
import { prepareQuickSelection } from './engine/prepare-quick-selection';
import { quickSelectionOptionsSchema } from './core/quick-selection';
import { prepareChannelSelection } from './engine/prepare-channel';
import { channelLoadSchema } from './core/alpha-channels';
import { colorRangeOptionsSchema } from "./core/color-range";
import { prepareSelectionModification } from "./engine/prepare-selection";
import { selectionModificationSchema } from "./core/selection-modification";
import { parseCommands } from "./core/validation";
import { checkExport, type ExportControl } from "./engine/export-control";
import { ProjectEncoder } from "./workspace/project-encoder";
import { RasterEditing } from "./raster-editing";
import { rebindLayerComps } from "./core/layer-comps";
import { prepareSmartRaster } from "./engine/smart-raster";
import { computeSha256 } from "./ai/batch/manifest";
import { ComponentRegistry } from "./core/smart/manager";
import { prepareHealingStroke } from "./engine/healing";
import { prepareRetouchPatch } from "./engine/patch";
import { PixelProcessor } from "./engine/processor";
import type {
  PatchOptions,
  PoissonBlendOptions,
  RetouchSamplingOptions,
} from "./core/retouch/types";
import {
  WorkspaceRepository,
  workspaceSchema,
  type SavedWorkspace,
} from "./workspace/repository";
import { WorkspaceAutosave } from "./workspace/autosave";
import { DocumentSession } from "./workspace/document-session";
import { ToolController } from "./tools";
import { BrushPresetLibrary } from './brushes/library';
import {BrushPreset,type BrushTool} from './brushes/presets';
import {verifyPresetSource} from './brushes/sources';
import { AssetStore } from "./core/assets";
import {fontFilesForArtwork,documentFontFiles} from './core/font-files';
import {captureProjectFonts} from './core/font-project';
import { loadProject, serializeProject } from "./core/project";
import {
  Document,
  LayerGroup,
  RasterLayer,
  SmartObjectLayer,
  LayerMask,
  AdjustmentLayer,
  PatchAdjustment,
  BrushStroke,
} from "./dom";
import { createDemo } from "./demo";
import type {
  SelectSubjectOptions,
  RefineEdgeOptions,
} from "./intelligence/matting/types";
import type { SelectionData } from "./core/drawing";
import { AdaptiveRenderer } from "./engine/adaptive";
import { ScriptRunner } from "./scripting/runner";
import { exportDocument, getExportCapabilityReport, getTiffPagesCapabilityReport } from "./engine/export";
import {prepareTiffImport} from './engine/tiff-import';
import {prepareAvifImport} from './engine/avif-import';
import {importParagraphStyles} from './core/paragraph-styles';
import {inspectTiffFile} from './core/interchange/tiff/client';
import {inspectAvifFile} from './core/interchange/avif/client';
import {inspectRawFile} from './core/interchange/raw/client';
import type {RawDecodeOptions,RawImportControl,RawImportReport} from './core/interchange/raw/types';
import type {AvifDecodeOptions,AvifImportControl,AvifImportReport} from './core/interchange/avif/types';
import type {TiffDecodeOptions,TiffImportControl,TiffImportReport} from './core/interchange/tiff/types';
import type {
  ExportOptions,
  ExportResult,
  ExportCapabilityReport,
} from "./engine/export";
import { execute } from "./core/commands";
import { referencedAssets, allLayers, id,findLayer } from "./core/model";
import { layerTransform } from "./core/spatial";
import {
  PluginRegistry,
  browserPluginStorage,
  type PluginPermission,
} from "./plugins";
import { HostBridge } from "./scripting/bridge";
import { ScriptRetouch } from "./scripting/retouch";
import { BudgetLedger } from "./ai/jobs/ledger";
import { StagedAssetRepository } from "./ai/jobs/staging";
import { GenerationCandidateStorage } from "./ai/jobs/candidate-storage";
import { GenerationJournal } from "./ai/jobs/journal";
import { GenerationJobService } from "./ai/jobs/service";
import { ProviderRegistry } from "./ai/providers/registry";
import { RecipeService } from "./ai/recipes";
import type { ApplyCandidateOptions } from "./ai/jobs/types";
import type { ApplyMaskedEditOptions } from "./ai/jobs/apply";
import { BatchRunnerService } from "./ai/batch";
import {
  type PsdImportOptions,
  type PsdImportResult,
} from "./core/interchange/psd";
import type { StandardRgbSpaceId, SoftProofOptions } from "./core/color/types";
import {inspectPhotoshop,decodePhotoshop} from './engine/photoshop-import';
import { validateWetPaintAssets } from './core/wet-assets';
import { wetBrowserAssets } from './engine/wet-composite';
import { applyPreparedWetPaint, createPreparedWetPaintJob, type ApplyWetPaintOptions, type WetBrushBuilder } from './engine/wet-authoring';
export type { ApplyWetPaintOptions } from './engine/wet-authoring';
import type {PhotoshopInput,PhotoshopInspection,PhotoshopImportControl} from './core/photoshop-import';

/** Application services own assets and I/O; the DOM itself is browser-independent. */
export class EditorApplication {
  separateFrequencies(layerId: string, options: FrequencySeparationOptions = {}, control: {signal?: AbortSignal} = {}) {
    const generation=this.ioGeneration;
    return separateFrequencies(this,layerId,options,control,()=>{if(generation!==this.ioGeneration||this.retouchDisposed)throw new Error('The editor session changed during frequency separation.');});
  }
  prepareFrequencySeparation(layerId:string,control:{signal?:AbortSignal}={}) {
    const generation=this.ioGeneration;
    return prepareFrequencySeparation(this,layerId,control,()=>{if(generation!==this.ioGeneration||this.retouchDisposed)throw new Error('The editor session changed during frequency separation.');});
  }
  /** Trusted host editing; isolated scripts use prepared values/shared commands. */
  applyWetPaint(brush: BrushStroke, options: ApplyWetPaintOptions = {}) {
    const generation = this.ioGeneration;
    return applyPreparedWetPaint(this, brush, options, () => { if (generation !== this.ioGeneration || this.retouchDisposed) throw new Error('The wet-paint application session changed.'); });
  }
  /** @internal Pointer tools share private preparation and the public commit path. */
  _beginWetPaint(brush: WetBrushBuilder, options: ApplyWetPaintOptions = {}) {
    const generation = this.ioGeneration;
    return createPreparedWetPaintJob(this, brush, options, () => { if (generation !== this.ioGeneration || this.retouchDisposed) throw new Error('The wet-paint application session changed.'); });
  }
  readonly pixels = new RasterEditing(this);
  get recovery() {
    return this.activeSession.recovery;
  }
  readonly workspaceRepository = new WorkspaceRepository();
  readonly workspaceAutosave = new WorkspaceAutosave(
    this.workspaceRepository,
    () => this.captureWorkspace(),
  );
  private workspaceInitialization?: Promise<boolean>;
  private workspaceProjects = new WeakMap<
    DocumentSession,
    { state: import("./core/store").EditorState; project: Promise<Blob> }
  >();
  private workspaceSaveTail: Promise<void> = Promise.resolve();
  private sessions: DocumentSession[] = [];
  private activeSession!: DocumentSession;
  private componentEdits = new Map<
    DocumentSession,
    {
      owner: DocumentSession;
      componentId: string;
      ownerRevision: number;
      appliedRevision: number;
    }
  >();
  private ioGeneration = 0;
  private photoshopJobs=new Set<AbortController>();
  private rawJobs=new Set<AbortController>();
  private avifJobs=new Set<AbortController>();
  private fontJobs=new Set<AbortController>();
  private photoshopCommits=new Set<AbortController>();
  private idleRetouchProcessor: PixelProcessor | null = null;
  private retouchProcessors = new Set<PixelProcessor>();
  private retouchDisposed = false;
  readonly renderer = new AdaptiveRenderer();
  readonly scripts = new ScriptRunner();
  readonly tools = new ToolController(this);
  readonly recentFiles = new RecentFilesService();
  readonly lensProfiles = new LensLibraryService();
  readonly artworkLibrary = new ArtworkLibrary();
  readonly palettes = new PaletteLibrary();
  private historyPreviewClosed = false;
  private historyPreviews = new Set<AbortController>();
  readonly chatGpt = new ChatGptConnections(this);
  readonly brushPresets = new BrushPresetLibrary();
  readonly brushTextureSource = new BrushTextureSourceOwner();
  private presetApplyAbort:AbortController|null=null;
  readonly plugins = new PluginRegistry(browserPluginStorage());
  readonly ai: GenerationJobService;
  readonly recipes: RecipeService;
  readonly batch: BatchRunnerService;
  private activeDocument = new Document();
  private assets = new AssetStore();
  private currentProfileId: StandardRgbSpaceId = "srgb";
  private currentSoftProof: SoftProofOptions | null = null;
  private listeners = new Set<() => void>();
  private booleanControllers = new Set<AbortController>();
  private unsubscribe = () => {};
  private snapshot = this.makeSnapshot();

  constructor() {
    this.activeDocument.assetStore = this.assets;
    this.activeSession = this.createSession(this.activeDocument, this.assets);
    const budgetLedger = new BudgetLedger();
    budgetLedger.createBudget({
      budgetId: "default-budget",
      approverId: "artist",
      approvedCeilingCents: 100.0,
      consentGiven: true,
    });
    this.ai = new GenerationJobService({
      providerRegistry: new ProviderRegistry(),
      budgetLedger,
      staging: new StagedAssetRepository(),
      journal:
        typeof window === "undefined" ? undefined : new GenerationJournal(),
      candidateStorage:
        typeof window === "undefined"
          ? undefined
          : new GenerationCandidateStorage(),
    });
    this.recipes = new RecipeService(this);
    this.batch = new BatchRunnerService({
      budgetLedger,
      recipes: this.recipes,
      renderer: this.renderer,
    });
    this.observe();
  }
  get recoverySessionId() {
    return this.activeSession.id;
  }
  get openDocuments(): readonly Document[] {
    return this.sessions.map((session) => session.document);
  }
  private readonly projectEncoder = new ProjectEncoder();
  private async captureWorkspace(): Promise<SavedWorkspace> {
    const sessions = [...this.sessions];
    const activeIndex = sessions.indexOf(this.activeSession);
    const pending = sessions.map((session) => ({
      name: session.document.name,
      componentEdit: (() => {
        const context = this.componentEdits.get(session);
        const ownerIndex = context ? sessions.indexOf(context.owner) : -1;
        if (!context || ownerIndex < 0) return undefined;
        return {
          ownerIndex,
          componentId: context.componentId,
          sourceUnchanged:
            context.ownerRevision ===
            context.owner.document.getSnapshot().revision,
          contentsApplied:
            context.appliedRevision === session.document.getSnapshot().revision,
        };
      })(),
      selectedIds: [...session.document.getSnapshot().selectedIds],
      view: structuredClone(session.view),
      colorProfile: session.colorProfile,
      softProof: structuredClone(session.softProof),
      project: this.captureWorkspaceProject(session),
    }));
    const savedAt = Date.now();
    const encoded = Promise.all(
      pending.map(async (entry) => ({
        ...entry,
        project: await entry.project,
      })),
    );
    return { version: 2, savedAt, activeIndex, documents: await encoded };
  }
  private captureWorkspaceProject(session: DocumentSession): Promise<Blob> {
    const state = session.document.getSnapshot();
    const cached = this.workspaceProjects.get(session);
    if (
      cached?.state.document === state.document &&
      cached.state.past === state.past &&
      cached.state.future === state.future &&
      cached.state.branches === state.branches && cached.state.activeBranchId === state.activeBranchId && cached.state.comparisons === state.comparisons && cached.state.provenance === state.provenance
    )
      return cached.project;
    const entry = {
      state,
      project: this.projectEncoder.encode(state.document, session.assets, freeze(captureRetainedHistory(state))),
    };
    this.workspaceProjects.set(session, entry);
    void entry.project.catch(() => {
      if (this.workspaceProjects.get(session) === entry)
        this.workspaceProjects.delete(session);
    });
    return entry.project;
  }
  initializeWorkspaceRecovery(): Promise<boolean> {
    return (this.workspaceInitialization ??= (async () => {
      try {
        await this.workspaceAutosave.acquire();
        let restored = false;
        if (this.workspaceRepository.restoreOnStartup) {
          const saved =
            (await this.workspaceAutosave.load()) ??
            (await this.workspaceRepository.load());
          if (saved) {
            await this.restoreSavedWorkspace(saved);
            restored = true;
          }
        }
        this.workspaceAutosave.start();
        if (
          this.ioGeneration > 0 ||
          this.sessions.length > 1 ||
          this.activeDocument.getSnapshot().revision > 0
        ) {
          this.workspaceAutosave.schedule();
        }
        return restored;
      } catch (error) {
        this.workspaceAutosave.reportError(error);
        throw error;
      }
    })());
  }
  async restoreAutomaticWorkspace(id?: string): Promise<Document[]> {
    const saved = id
      ? await this.workspaceRepository.loadAutomatic(id)
      : await this.workspaceAutosave.load();
    if (!saved)
      throw new Error(
        "No automatic workspace checkpoint is available for this tab.",
      );
    return this.restoreSavedWorkspace(saved);
  }
  async saveWorkspaceVersion(name: string): Promise<string> {
    return this.workspaceRepository.createVersion(
      name,
      await this.captureWorkspace(),
    );
  }
  async saveWorkspace(): Promise<void> {
    const encoded = this.captureWorkspace();
    // Observe early encoding rejection while an older checkpoint may still be writing.
    void encoded.catch(() => {});
    const write = this.workspaceSaveTail
      .catch(() => {})
      .then(async () => {
        await this.workspaceRepository.save(await encoded);
      });
    this.workspaceSaveTail = write;
    await write;
  }

  async restoreWorkspace(versionId?: string): Promise<Document[]> {
    const workspace = await this.workspaceRepository.load(versionId);
    if (!workspace) throw new Error("No saved workspace is available.");
    return this.restoreSavedWorkspace(workspace);
  }
  private async restoreSavedWorkspace(
    workspace: SavedWorkspace,
  ): Promise<Document[]> {
    workspace = workspaceSchema.parse(workspace);
    const decoded: { document: Document; assets: AssetStore }[] = [];
    try {
      for (const entry of workspace.documents) {
        const loaded = await loadProject(entry.project);
        try {
          decoded.push({
            document: Document._fromWorkspace(loaded.document, loaded.history),
            assets: loaded.assets,
          });
        } catch (error) {
          loaded.assets.dispose();
          throw error;
        }
      }
      for (const entry of workspace.documents) {
        const link = entry.componentEdit;
        if (
          link?.sourceUnchanged &&
          !decoded[link.ownerIndex].document
            .toJSON()
            .components?.some((component) => component.id === link.componentId)
        )
          throw new Error(
            "Saved component editing link refers to a missing source master.",
          );
      }
    } catch (error) {
      for (const entry of decoded) entry.assets.dispose();
      throw error;
    }
    const initial =
      this.sessions.length === 1 &&
      this.activeDocument.getSnapshot().revision === 0 &&
      !this.activeDocument.layers.length
        ? this.activeSession
        : null;
    const restored = decoded.map((entry, index) => {
      const session = this.createSession(entry.document, entry.assets);
      session.view = structuredClone(workspace.documents[index].view);
      session.colorProfile = workspace.documents[index].colorProfile;
      session.softProof = structuredClone(workspace.documents[index].softProof);
      entry.document.selectLayers(
        workspace.documents[index].selectedIds.flatMap((id) => {
          const layer = entry.document.getLayer(id);
          return layer ? [layer] : [];
        }),
      );
      session.savedRevision = -1; // A browser checkpoint is not a downloaded backup.
      session.recovery.schedule(
        session.id,
        entry.document.toJSON(),
        entry.assets,
      );
      return session;
    });
    workspace.documents.forEach((entry, index) => {
      const link = entry.componentEdit;
      if (!link) return;
      const owner = restored[link.ownerIndex],
        contents = restored[index];
      this.componentEdits.set(contents, {
        owner,
        componentId: link.componentId,
        ownerRevision: link.sourceUnchanged
          ? owner.document.getSnapshot().revision
          : -1,
        appliedRevision: link.contentsApplied
          ? contents.document.getSnapshot().revision
          : -1,
      });
    });
    this.activateDocument(restored[workspace.activeIndex].document);
    if (initial) {
      this.sessions.splice(this.sessions.indexOf(initial), 1);
      initial.dispose();
    }
    this.publish();
    return restored.map((session) => session.document);
  }

  /** Trusted host operation: capture, solve privately, then commit one adjustment layer. */
  async applyPatch(
    sourceOffset: { x: number; y: number },
    sampling: RetouchSamplingOptions = { mode: "all-layers" },
    options: PatchOptions = {},
    signal?: AbortSignal,
  ): Promise<AdjustmentLayer> {
    return this.commitRetouch(sourceOffset, sampling, options, signal);
  }

  async healStroke(
    brush: BrushStroke,
    sampling: RetouchSamplingOptions = { mode: "all-layers" },
    options: PoissonBlendOptions = {},
    radius = 64,
    signal?: AbortSignal,
  ): Promise<AdjustmentLayer> {
    if (!(brush instanceof BrushStroke))
      throw new Error("Healing requires a BrushStroke.");
    return this.commitRetouch(
      null,
      sampling,
      options,
      signal,
      brush.toJSON() as import("./core/drawing").BrushStrokeData,
      radius,
    );
  }

  private async commitRetouch(
    sourceOffset: { x: number; y: number } | null,
    sampling: RetouchSamplingOptions,
    options: PatchOptions,
    signal?: AbortSignal,
    brush?: import("./core/drawing").BrushStrokeData,
    radius = 64,
  ): Promise<AdjustmentLayer> {
    const document = this.document,
      assets = this.assetStore;
    const revision = document.getSnapshot().revision,
      generation = this.ioGeneration;
    const selectedId = document.selectedLayer?.id ?? null;
    const selection = document.selection;
    if (!selection && !brush)
      throw new Error("Select a region to patch first.");
    const check = () => {
      signal?.throwIfAborted();
      if (
        this.ioGeneration !== generation ||
        this.document !== document ||
        this.assetStore !== assets ||
        !this.sessions.some((session) => session.document === document) ||
        document.getSnapshot().revision !== revision ||
        (document.selectedLayer?.id ?? null) !== selectedId
      )
        throw new Error(
          "Document changed while preparing the patch. Retry after reviewing the target.",
        );
    };
    check();
    if (this.retouchDisposed) throw new Error("The editor has been disposed.");
    const processor = this.idleRetouchProcessor ?? new PixelProcessor();
    this.idleRetouchProcessor = null;
    this.retouchProcessors.add(processor);
    let reusable = false;
    let cancelled = false;
    const cancelWorker = () => { cancelled = true; processor.dispose(); };
    signal?.addEventListener("abort", cancelWorker, { once: true });
    const staging = new AssetStore();
    let installed: string | undefined;
    let transferred = false;
    try {
      check();
      const capturedSampling = {
        ...sampling,
        layerId: sampling.layerId ?? selectedId ?? undefined,
      };
      const patch = brush
        ? await prepareHealingStroke(
            document.toJSON(),
            assets,
            this.renderer,
            processor,
            brush,
            capturedSampling,
            options,
            radius,
            signal,
          )
        : await prepareRetouchPatch(
            document.toJSON(),
            assets,
            this.renderer,
            processor,
            selection!.toJSON(),
            sourceOffset!,
            capturedSampling,
            options,
            signal,
          );
      check();
      // Encode the detached correction directly. HTMLCanvasElement.toBlob can
      // defer its idle task for a full second while editor renders are pending.
      const rgba = new Uint8Array(patch.correctedPixels);
      for (let p = 0; p < patch.coverage.length; p++)
        rgba[p * 4 + 3] = patch.coverage[p];
      const blob = await encodeRgbaPng(
        rgba,
        patch.bounds.width,
        patch.bounds.height,
      );
      check();
      const asset = await staging.add(blob, "Retouch patch", id(), false);
      check();
      const layer = new AdjustmentLayer({
        name: brush ? "Healing stroke" : "Retouch patch",
        x: patch.bounds.x,
        y: patch.bounds.y,
        adjustment: new PatchAdjustment({
          assetId: asset.id,
          width: patch.bounds.width,
          height: patch.bounds.height,
        }),
      });
      assets.install(asset, false);
      installed = asset.id;
      transferred = true;
      document.transaction(brush ? "Healing stroke" : "Patch selection", () =>
        document.layers.add(layer),
      );
      installed = undefined;
      reusable = true;
      return layer;
    } finally {
      if (installed) assets.remove(installed);
      if (!transferred)
        for (const asset of staging.values()) asset.bitmap.close();
      signal?.removeEventListener("abort", cancelWorker);
      staging.metadata.dispose();
      this.retouchProcessors.delete(processor);
      if (reusable && !cancelled && !this.retouchDisposed && !this.idleRetouchProcessor)
        this.idleRetouchProcessor = processor;
      else processor.dispose();
    }
  }

  /** Explicitly refresh a linked master from a user-selected local file; cached pixels remain portable. */
  async relinkSmartObject(
    instance: SmartObjectLayer,
    file: File,
  ): Promise<void> {
    const owner = this.sessions.find(
      (session) => session.document === instance.document,
    );
    if (!owner || !instance.isAttached || !(file instanceof File))
      throw new Error("Choose a file and a smart object in an open document.");
    const revision = owner.document.getSnapshot().revision,
      componentId = instance.componentId;
    const assertLifetime = owner.assets.captureLifetime();
    const check = () => {
      assertLifetime();
      if (
        !this.sessions.includes(owner) ||
        owner.document.getSnapshot().revision !== revision
      )
        throw new Error(
          "Document changed while reading the linked source. Retry from the current instance.",
        );
    };
    check();
    const definition = new ComponentRegistry(
      owner.document.toJSON().components,
    ).get(componentId);
    const digest = await computeSha256(await file.arrayBuffer());
    check();
    const staging = new AssetStore();
    let installed: string | undefined,
      transferred = false;
    try {
      const asset = await staging.add(file, file.name, id(), false);
      check();
      const command = {
        type: "component.set" as const,
        definition: {
          ...definition,
          source: {
            kind: "asset" as const,
            assetId: asset.id,
            width: asset.width,
            height: asset.height,
            link: {
              kind: "local-file" as const,
              name: file.name,
              sha256: digest,
              byteLength: file.size,
              lastModified: file.lastModified,
            },
          },
        },
      };
      execute(owner.document.toJSON(), command); // Validate graph, all dependent locks and metadata before publishing pixels.
      owner.assets.install(asset, false);
      installed = asset.id;
      transferred = true;
      owner.document._dispatch(command);
      installed = undefined;
    } finally {
      if (installed) owner.assets.remove(installed);
      if (!transferred)
        for (const asset of staging.values()) asset.bitmap.close();
      staging.metadata.dispose();
    }
  }

  async rasterizeSmartObject(
    instance: SmartObjectLayer,
    signal?: AbortSignal,
  ): Promise<RasterLayer> {
    const owner = this.sessions.find(
      (session) => session.document === instance.document,
    );
    if (!owner || !instance.isAttached)
      throw new Error("Choose a smart object in an open document.");
    const revision = owner.document.getSnapshot().revision;
    const assertLifetime = owner.assets.captureLifetime();
    const check = () => {
      signal?.throwIfAborted();
      assertLifetime();
      if (
        !this.sessions.includes(owner) ||
        owner.document.getSnapshot().revision !== revision
      )
        throw new Error(
          "Document changed during rasterization. Retry the current instance.",
        );
    };
    check();
    const staging = new AssetStore();
    let installed: string | undefined;
    let transferred = false;
    try {
      const prepared = await prepareSmartRaster(
        owner.document.toJSON(),
        instance.id,
        owner.assets,
        this.renderer,
        check,
      );
      const asset = await staging.add(
        prepared.blob,
        instance.name,
        prepared.layer.assetId,
        false,
      );
      check();
      owner.assets.install(asset, false);
      installed = asset.id;
      transferred = true;
      owner.document._dispatch({
        type: "smartObject.convertToRaster",
        id: instance.id,
        layer: prepared.layer,
      });
      installed = undefined;
      const result = owner.document.getLayer(prepared.layer.id) as RasterLayer;
      owner.document.selectedLayer = result;
      return result;
    } finally {
      if (installed) owner.assets.remove(installed);
      if (!transferred)
        for (const asset of staging.values()) asset.bitmap.close();
      staging.metadata.dispose();
    }
  }

  /** Open an independently owned contents tab; changes require explicit application. */
  async editSmartObject(instance: SmartObjectLayer): Promise<Document> {
    if (instance.linkedSource)
      throw new Error(
        "Embed the linked source snapshot before opening editable contents.",
      );
    const owner = this.sessions.find(
      (session) => session.document === instance.document,
    );
    if (!owner || !instance.isAttached)
      throw new Error("Choose a smart object in an open document.");
    for (const [session, context] of this.componentEdits) {
      if (
        context.owner === owner &&
        context.componentId === instance.componentId
      ) {
        this.activateDocument(session.document);
        return session.document;
      }
    }
    const ownerRevision = owner.document.getSnapshot().revision,
      generation = this.ioGeneration;
    const assertOwner = owner.assets.captureLifetime();
    const componentId = instance.componentId;
    const contents = owner.document.getComponent(componentId).toJSON();
    contents.id = id();
    rebindLayerComps(contents);
    const file = await serializeProject(contents, owner.assets);
    const loaded = await loadProject(file);
    try {
      assertOwner();
      if (
        !this.sessions.includes(owner) ||
        owner.document.getSnapshot().revision !== ownerRevision ||
        this.ioGeneration !== generation
      )
        throw new Error(
          "Source document changed while opening contents. Retry from the current smart object.",
        );
      const document = Document.fromJSON(loaded.document);
      const session = this.createSession(document, loaded.assets);
      session.colorProfile = owner.colorProfile;
      this.componentEdits.set(session, {
        owner,
        componentId,
        ownerRevision,
        appliedRevision: document.getSnapshot().revision,
      });
      this.activateDocument(document);
      return document;
    } catch (error) {
      loaded.assets.dispose();
      throw error;
    }
  }

  /** Retain contents as an ordinary document, dropping only the ephemeral apply link. */
  detachSmartObjectContents(document: Document = this.activeDocument): void {
    const session = this.sessions.find((item) => item.document === document);
    if (!session || !this.componentEdits.has(session))
      throw new Error("This tab is not a smart-object editing session.");
    this.componentEdits.delete(session);
    this.publish();
  }

  /** Apply a contents snapshot and its nested definitions in one guarded parent transaction. */
  async applySmartObjectContents(
    document: Document = this.activeDocument,
  ): Promise<void> {
    const session = this.sessions.find((item) => item.document === document);
    const context = session && this.componentEdits.get(session);
    if (!session || !context)
      throw new Error(
        "This tab is not an active smart-object editing session.",
      );
    const revision = document.getSnapshot().revision;
    const assertSource = session.assets.captureLifetime(),
      assertOwner = context.owner.assets.captureLifetime();
    const assertCurrent = () => {
      assertSource();
      assertOwner();
      if (
        !this.sessions.includes(session) ||
        !this.sessions.includes(context.owner)
      )
        throw new Error("The contents or source document was closed.");
      if (document.getSnapshot().revision !== revision)
        throw new Error(
          "Contents changed while applying. Retry the current contents.",
        );
      if (
        context.owner.document.getSnapshot().revision !== context.ownerRevision
      )
        throw new Error(
          "Source document changed since contents were opened or applied. Keep this tab as a backup and reopen the current master.",
        );
    };
    assertCurrent();
    const { components = [], ...contents } = document.toJSON();
    const definitions = components.filter(
      (definition) => definition.id !== context.componentId,
    );
    definitions.push({
      id: context.componentId,
      name: contents.name,
      source: { kind: "document", document: contents },
    });
    const command = {
      type: "component.replaceAll" as const,
      definitions: new ComponentRegistry(definitions).values(),
    };
    const proposed = execute(context.owner.document.toJSON(), command);
    const originals = [...referencedAssets(proposed)].map((key) =>
      session.assets.has(key)
        ? session.assets.get(key)
        : context.owner.assets.get(key),
    );
    const staged = new AssetStore(),
      transferred = new Set<string>();
    let committed = false;
    try {
      for (const asset of originals) {
        if (context.owner.assets.has(asset.id)) {
          const previous = context.owner.assets.get(asset.id);
          if (
            previous.width !== asset.width ||
            previous.height !== asset.height ||
            JSON.stringify(previous.tiff) !== JSON.stringify(asset.tiff) ||
            JSON.stringify(previous.avif) !== JSON.stringify(asset.avif) ||
            JSON.stringify(previous.raw?rawSourceMetadata(previous.raw):null)!==JSON.stringify(asset.raw?rawSourceMetadata(asset.raw):null) ||
            (await computeSha256(await previous.blob.arrayBuffer())) !==
              (await computeSha256(await asset.blob.arrayBuffer()))
          )
            throw new Error(
              "An image asset ID conflicts with the source document. Import it with a new identity before applying.",
            );
        } else await staged.add(asset.blob, asset.name, asset.id, false,{tiff:asset.tiff,avif:asset.avif,raw:asset.raw});
        assertCurrent();
      }
      assertCurrent();
      for (const asset of staged.values()) {
        context.owner.assets.install(asset, false);
        transferred.add(asset.id);
      }
      context.owner.document._dispatch(command);
      committed = true;
      context.ownerRevision = context.owner.document.getSnapshot().revision;
      context.appliedRevision = revision;
      this.publish();
    } finally {
      if (!committed)
        for (const key of transferred) context.owner.assets.remove(key);
      for (const asset of staged.values())
        if (!transferred.has(asset.id)) asset.bitmap.close();
      staged.metadata.dispose();
    }
  }

  private captureSelectedArtwork() {
    const source=this.activeDocument,roots=source.layerSelection.rootLayers;
    if(!roots.length)throw new Error('Select artwork to save or copy first.');
    const snapshot=source.toJSON(),copies=roots.map(layer=>{
      const copy=structuredClone(captureFrequencyRadius(snapshot,layer.toJSON())),world=layerTransform(snapshot,layer.id)!.toJSON();
      copy.x=world.e;copy.y=world.f;copy.transform={...world,e:0,f:0};return copy;
    });
    return{snapshot,copies};
  }

  async saveArtworkToLibrary(metadata:ArtworkMetadata,control:{signal?:AbortSignal}={}) {
    control.signal?.throwIfAborted();if(!this.artworkLibrary.getSnapshot().available)throw new Error('The local artwork library is unavailable.');
    const {snapshot,copies}=this.captureSelectedArtwork(),base=new Document({name:'Saved artwork',width:snapshot.width,height:snapshot.height}).toJSON();
    base.id=snapshot.id;base.children=copies;const registry=new ComponentRegistry(snapshot.components),roots=allLayers(copies).flatMap(node=>node.kind==='smart-object'?[node.componentId]:[]),reachable=new Set(roots.flatMap(key=>[...registry.reachableFrom(key)]));
    base.components=[...reachable].map(key=>structuredClone(registry.get(key)));base.paragraphStyles=importParagraphStyles(snapshot,base,copies,id);
    const fontFiles=fontFilesForArtwork(snapshot,base);if(fontFiles.length)base.fontFiles=fontFiles;
    const capturedFonts=new Map(captureProjectFonts([base],this.assets.fonts).map(value=>[value.descriptor.report.faces[0].id,value]));
    const captured=new Map([...referencedAssets(base)].map(key=>{const asset=this.assets.get(key);return[key,{id:asset.id,name:asset.name,width:asset.width,height:asset.height,blob:asset.blob,...(asset.tiff?{tiff:{...asset.tiff}}:{}),...(asset.avif?{avif:{...asset.avif}}:{}),...(asset.raw?{raw:ownRawSource(asset.raw)}:{})}] as const;}));
    return this.artworkLibrary.save(()=>this.projectEncoder.encode(base,{fonts:{get(key){const font=capturedFonts.get(key);if(!font)throw new Error('Missing captured artwork font.');return font;}},get(key){const asset=captured.get(key);if(!asset)throw new Error('Missing captured artwork source.');return asset;}},{version:1,past:[],future:[]}),metadata,control.signal);
  }

  async placeLibraryArtwork(entryId:string,control:{signal?:AbortSignal}={}) {
    const destination=this.activeSession,target=this.activeDocument,revision=target.getSnapshot().revision,lifetime=destination.assets.captureLifetime();
    const check=()=>{control.signal?.throwIfAborted();lifetime();if(this.activeSession!==destination||!this.sessions.includes(destination)||target.getSnapshot().revision!==revision)throw new Error('The destination changed while artwork was preparing. Choose it again.');};
    check();const value=await this.artworkLibrary.read(entryId,control.signal);check();const loaded=await loadProject(value.blob,{prepareImmutable:true});
    try{check();return await this.copyArtworkTo(loaded.document,structuredClone(loaded.document.children),loaded.assets,target,{check,signal:control.signal,label:'Place library artwork',shareSources:true,commit:run=>this.artworkLibrary.commitPlacement(value,run,control.signal)});}finally{loaded.assets.dispose();}
  }

  /** Private reference previews of retained states; never executes recorded commands. */
  async previewHistory(position:number,control:{signal?:AbortSignal}={}):Promise<{before:Blob|null;after:Blob}> {
    if(this.historyPreviewClosed)throw new Error('Editor is closed.');
    control.signal?.throwIfAborted();
    const target=this.document,snapshot=target.getSnapshot(),timeline=historyTimeline(snapshot);
    if(!Number.isSafeInteger(position)||position<0||position>=timeline.length)throw new Error('History position is outside the retained timeline.');
    const abort=new AbortController(),assets=new AssetStore(),renderer=new CanvasRenderer();
    const cancel=()=>abort.abort(control.signal?.reason),check=()=>{
      abort.signal.throwIfAborted();
      if(this.historyPreviewClosed||this.document!==target||target.getSnapshot().revision!==snapshot.revision)
        throw new Error('History changed during preview. Reload the timeline.');
    },changed=()=>{try{check();}catch(cause){abort.abort(cause);}};
    const stopDocument=target.subscribe(changed),stopEditor=this.subscribe(changed),disposeRenderer=()=>renderer.dispose();
    control.signal?.addEventListener('abort',cancel,{once:true});abort.signal.addEventListener('abort',disposeRenderer,{once:true});this.historyPreviews.add(abort);
    try {
      check();const sourceIds=new Set([...referencedAssets(timeline[position].document),...(position?referencedAssets(timeline[position-1].document):[])]);for(const assetId of sourceIds)this.assetStore.shareTo(assets,assetId,assetId);
      for(const state of [timeline[position].document,...(position?[timeline[position-1].document]:[])])for(const font of documentFontFiles(state)){this.assetStore.fonts.shareTo(assets.fonts,font.id);assets.fonts.activate(font.id);}
      const render=async(document:import('./core/model').DocumentData)=>{
        let canvas:HTMLCanvasElement|undefined;
        try {
          check();canvas=await renderer.render(document,assets,{cache:false,scale:Math.min(1,512/document.width,512/document.height),maxPixels:512*512,maxDimension:512,isCancelled:()=>abort.signal.aborted});
          check();const blob=await new Promise<Blob>((resolve,reject)=>canvas!.toBlob(value=>{if(abort.signal.aborted)reject(abort.signal.reason);else if(value)resolve(value);else reject(new Error('History preview could not be encoded.'));},'image/png'));
          check();return blob;
        }finally{if(canvas){canvas.width=0;canvas.height=0;}}
      };
      const before=position?await render(timeline[position-1].document):null,after=await render(timeline[position].document);check();return{before,after};
    }catch(cause){if(abort.signal.aborted)throw abort.signal.reason;throw cause;}finally{stopDocument();stopEditor();control.signal?.removeEventListener('abort',cancel);abort.signal.removeEventListener('abort',disposeRenderer);this.historyPreviews.delete(abort);renderer.dispose();assets.dispose();}
  }

  async previewHistoryComparison(id: string, control: {signal?: AbortSignal} = {}): Promise<HistoryComparisonPreview> {
    if (this.historyPreviewClosed) throw new Error('Editor is closed.');
    control.signal?.throwIfAborted();
    const target = this.document, snapshot = target.getSnapshot(), comparison = snapshot.comparisons.find(value => value.id === id);
    if (!comparison) throw new Error('History comparison not found.');
    const abort = new AbortController(), assets = new AssetStore(), renderer = new CanvasRenderer();
    const cancel = () => abort.abort(control.signal?.reason), check = () => {
      abort.signal.throwIfAborted();
      if (this.historyPreviewClosed || this.document !== target || target.getSnapshot().revision !== snapshot.revision)
        throw new Error('History changed during comparison preview. Reload the timeline.');
    }, changed = () => {try {check();} catch (cause) {abort.abort(cause);}};
    const stopDocument = target.subscribe(changed), stopEditor = this.subscribe(changed), disposeRenderer = () => renderer.dispose();
    control.signal?.addEventListener('abort', cancel, {once: true}); abort.signal.addEventListener('abort', disposeRenderer, {once: true}); this.historyPreviews.add(abort);
    try {
      check(); const ids = new Set([...referencedAssets(comparison.before), ...referencedAssets(comparison.after)]);
      for (const assetId of ids) this.assetStore.shareTo(assets, assetId, assetId);
      for(const state of [comparison.before,comparison.after])for(const font of documentFontFiles(state)){this.assetStore.fonts.shareTo(assets.fonts,font.id);assets.fonts.activate(font.id);}
      const value = await renderHistoryComparison(comparison, assets, renderer, check, () => abort.signal.aborted); check(); return value;
    } catch (cause) {if (abort.signal.aborted) throw abort.signal.reason; throw cause;}
    finally {stopDocument(); stopEditor(); control.signal?.removeEventListener('abort', cancel); abort.signal.removeEventListener('abort', disposeRenderer); this.historyPreviews.delete(abort); renderer.dispose(); assets.dispose();}
  }

  async previewLibraryArtwork(entryId:string,control:{signal?:AbortSignal}={}):Promise<Blob> {
    const value=await this.artworkLibrary.read(entryId,control.signal),loaded=await loadProject(value.blob,{prepareImmutable:true}),renderer=new CanvasRenderer();let canvas:HTMLCanvasElement|undefined;
    try{control.signal?.throwIfAborted();canvas=await renderer.render(loaded.document,loaded.assets,{cache:false,scale:Math.min(1,256/loaded.document.width,256/loaded.document.height),maxPixels:65536,maxDimension:256,isCancelled:()=>!!control.signal?.aborted});control.signal?.throwIfAborted();const blob=await new Promise<Blob>((resolve,reject)=>canvas!.toBlob(blob=>{if(control.signal?.aborted)reject(control.signal.reason);else if(blob)resolve(blob);else reject(new Error('Artwork preview could not be encoded.'));},'image/png'));await this.artworkLibrary.commitPlacement(value,()=>{},control.signal);return blob;}
    finally{if(canvas){canvas.width=0;canvas.height=0;}renderer.dispose();loaded.assets.dispose();}
  }

  async copySelectedLayersTo(target: Document) {
    if(this.activeDocument===target)throw new Error('Choose another open document as the copy destination.');
    const {snapshot,copies}=this.captureSelectedArtwork();return this.copyArtworkTo(snapshot,copies,this.assets,target);
  }

  private async copyArtworkTo(snapshot:import('./core/model').DocumentData,copies:import('./core/model').LayerData[],sourceAssets:AssetStore,target:Document,control:{check?():void;signal?:AbortSignal;label?:string;shareSources?:boolean;commit?(run:()=>void):Promise<void>}={}) {
    const destination=this.sessions.find(session=>session.document===target);if(!destination)throw new Error('Choose an open document as the copy destination.');
    const registry = new ComponentRegistry(snapshot.components);
    const paragraphStyles=importParagraphStyles(snapshot,target._read(),copies,id);
    const componentRoots = allLayers(copies).flatMap((node) =>
      node.kind === "smart-object" ? [node.componentId] : [],
    );
    const reachable = new Set(
      componentRoots.flatMap((key) => [...registry.reachableFrom(key)]),
    );
    const componentIds = Object.fromEntries(
      [...reachable].map((key) => [key, id()]),
    );
    const definitions = registry.copyDefinitions(componentRoots, componentIds);
    const fontFiles=fontFilesForArtwork(snapshot,{...snapshot,fontFiles:undefined,children:copies,components:definitions,paragraphStyles});
    const assetIds = referencedAssets({
      ...snapshot,
      children: copies,
      components: [...reachable].map((key) => registry.get(key)),
    });
    // Capture immutable original blobs before yielding; closing the source cannot revoke this snapshot.
    const originals = [...assetIds].map((key) => sourceAssets.get(key));
    const replacements = new Map(originals.map((asset) => [asset.id, id()]));
    const revision = target.getSnapshot().revision;
    const assertLifetime = destination.assets.captureLifetime();
    const assertTarget = () => {
      control.signal?.throwIfAborted();control.check?.();assertLifetime();
      if (
        !this.sessions.includes(destination) ||
        target.getSnapshot().revision !== revision
      )
        throw new Error(
          "Destination changed while copying artwork. Try again.",
        );
    };
    const remapLayers = (
      layers: import("./core/model").LayerData[],
      remapComponents = true,
    ) => {
      const layerIds = new Map<string, string>();
      for (const node of allLayers(layers)) {
        remapLayerAssets(node,replacements);
        const previousId = node.id;
        node.id = id();
        layerIds.set(previousId, node.id);
        if (node.kind === "smart-object" && remapComponents)
          node.componentId = componentIds[node.componentId];
        if (node.kind === "raster") {
          for (const effect of node.effects) effect.id = id();
        }
        if (node.kind === "smart-object") {
          for (const entry of node.filterMask?.strokes ?? [])
            entry.stroke.id = id();
        }
        for (const entry of node.mask?.strokes ?? []) entry.stroke.id = id();
        if (node.kind === "paint")
          for (const stroke of node.strokes) {
            stroke.id = id();
          }
        if (node.kind === "vector")
          for (const path of node.paths) {
            path.id = id();
            for (const contour of path.subpaths ?? []) contour.id = id();
          }
      }
      return layerIds;
    };
    remapLayers(copies);
    for (const definition of definitions) {
      if (definition.source.kind === "asset")
        definition.source.assetId = replacements.get(
          definition.source.assetId,
        )!;
      else {
        const layerIds = remapLayers(
          definition.source.document.children,
          false,
        );
        rebindLayerComps(definition.source.document, layerIds);
      } // Master references were already remapped by the registry.
    }
    const commands: import("./core/commands").EditorCommand[] = [
      ...fontFiles.map(file=>({type:'font.file.add' as const,file})),
      ...paragraphStyles.map(style=>({type:'paragraphStyle.set' as const,style})),
      ...(definitions.length
        ? [
            {
              type: "component.replaceAll" as const,
              definitions: [
                ...(target.toJSON().components ?? []),
                ...definitions,
              ],
            },
          ]
        : []),
      ...copies.map((layer) => ({ type: "layer.add" as const, layer })),
    ];
    const command = {
      type: "transaction" as const,
      label: control.label??"Copy artwork from document",
      commands,
    };
    execute(target.toJSON(), command); // Validate the entire target before decoding or publishing images.
    const staging = new AssetStore(),
      installed = new Set<string>();
    let committed = false;
    const fontLeases:import('./fonts/store').FontSourceLease[]=[];
    try {
      // Independent leases are acquired before image decoding yields, so closing
      // the source cannot change the captured artwork's native font identity.
      for(const file of fontFiles)fontLeases.push(sourceAssets.fonts.stageTo(destination.assets.fonts,file.id));
      for (const asset of originals) {
        const copy = control.shareSources?sourceAssets.shareTo(staging,asset.id,replacements.get(asset.id)!):await staging.add(
          asset.blob,
          asset.name,
          replacements.get(asset.id)!,
          false,
          {tiff:asset.tiff,avif:asset.avif,raw:asset.raw},
        );
        if (copy.width !== asset.width || copy.height !== asset.height)
          throw new Error(
            "Copied image dimensions do not match the captured source.",
          );
        assertTarget();
      }
      assertTarget();
      for (const asset of staging.values()) {
        if(control.shareSources)staging.shareTo(destination.assets,asset.id,asset.id);
        else destination.assets.install(asset, false);
        installed.add(asset.id);
      }
      const publish=()=>{assertTarget();try{target._dispatch(command);}finally{committed=target.getSnapshot().revision!==revision;}};
      try{
        if(control.commit)await control.commit(publish);else publish();
        const layers = copies.map((copy) => target.getLayer(copy.id)!);
        target.selectLayers(layers);
        return layers;
      }catch(error){if(committed)throw new Error('Artwork was placed, but a listener or acknowledgement failed. Inspect the document before retrying.',{cause:error});throw error;}
    } finally {
      for(const lease of fontLeases)lease.release();
      if (!committed)
        for (const key of installed) destination.assets.remove(key);
      if(control.shareSources)staging.dispose();
      else{
        for (const asset of staging.values())if (!installed.has(asset.id)) asset.bitmap.close();
        staging.metadata.dispose();
      }
    }
  }

  moveDocument(document: Document, index: number): void {
    const previous = this.sessions.findIndex(
      (session) => session.document === document,
    );
    if (previous < 0)
      throw new Error("Document is not open in this workspace.");
    if (!Number.isInteger(index) || index < 0 || index >= this.sessions.length)
      throw new Error("Tab position is out of range.");
    if (previous === index) return;
    const [session] = this.sessions.splice(previous, 1);
    this.sessions.splice(index, 0, session);
    this.publish();
  }
  get documentSessions(): readonly DocumentSession[] {
    return [...this.sessions];
  }
  get hasUnsavedDocuments() {
    return this.sessions.some(
      (session) =>
        session.dirty ||
        (this.componentEdits.has(session) &&
          this.componentEdits.get(session)!.appliedRevision !==
            session.document.getSnapshot().revision),
    );
  }
  get document() {
    return this.activeDocument;
  }
  get assetStore() {
    return this.assets;
  }
  get analysis() {
    return this.assets.analysis;
  }
  preflight(options:PreflightOptions={},control:PreflightControl={}){
    return this.document.preflight(options,control);
  }
  get colorProfile(): StandardRgbSpaceId {
    return this.currentProfileId;
  }
  get softProof(): SoftProofOptions | null {
    return this.currentSoftProof;
  }

  setColorProfile(profileId: StandardRgbSpaceId): void {
    this.currentProfileId = profileId;
    this.activeSession.colorProfile = profileId;
    this.publish();
  }

  setSoftProof(options: SoftProofOptions | null): void {
    this.currentSoftProof = options;
    this.activeSession.softProof = options;
    this.publish();
  }

  async selectSubject(options?: SelectSubjectOptions,control?:SelectSubjectControl): Promise<SelectionData> {
    return this.activeDocument.selectSubject(options,control);
  }

  async removeBackground(
    targetLayer?: RasterLayer,
    options?: RefineEdgeOptions,
    control?:RefineEdgeControl,
  ): Promise<RasterLayer> {
    return this.activeDocument.removeBackground(targetLayer, options,control);
  }

  async refineEdge(options: RefineEdgeOptions = {},control?:RefineEdgeControl): Promise<LayerMask> {
    const layer = this.activeDocument.selectedLayer;
    if (!(layer instanceof RasterLayer)) {
      throw new Error("Select a raster layer to refine its edge.");
    }
    return layer.refineEdge(options,control);
  }

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private makeSnapshot() {
    return {
      document: this.activeDocument,
      assets: this.assets,
      state: this.activeDocument.getSnapshot(),
      colorProfile: this.currentProfileId,
      softProof: this.currentSoftProof,
      sessions: this.sessions?.map((session) => ({
        id: session.id,
        document: session.document,
        dirty:
          session.dirty ||
          (this.componentEdits.has(session) &&
            this.componentEdits.get(session)!.appliedRevision !==
              session.document.getSnapshot().revision),
      })),
      sessionId: this.activeSession?.id,
      savedRevision: this.activeSession?.savedRevision ?? 0,
      smartObjectEdit:
        this.activeSession && this.componentEdits?.has(this.activeSession)
          ? (() => {
              const edit = this.componentEdits.get(this.activeSession)!;
              return {
                componentId: edit.componentId,
                ownerName: edit.owner.document.name,
                ownerOpen: this.sessions.includes(edit.owner),
                changed:
                  edit.appliedRevision !==
                  this.activeDocument.getSnapshot().revision,
              };
            })()
          : undefined,
    };
  }
  private publish = () => {
    this.snapshot = this.makeSnapshot();
    this.listeners.forEach((listener) => listener());
    this.workspaceAutosave.schedule();
  };
  private observe() {
    this.unsubscribe();
    let canvasRevision = this.activeDocument.getSnapshot().canvasRevision;
    this.unsubscribe = this.activeDocument.subscribe(() => {
      const nextCanvasRevision =
        this.activeDocument.getSnapshot().canvasRevision;
      if (nextCanvasRevision !== canvasRevision) {
        canvasRevision = nextCanvasRevision;
        this.tools.reset();
      }
      this.publish();
    });
    this.publish();
  }

  private async prepareBoolean(document:Document,request:VectorBooleanRequest,control:VectorBooleanControl,check:()=>void):Promise<VectorBooleanResult>{
    const abort=new AbortController(),cancel=()=>abort.abort(control.signal?.reason);
    control.signal?.throwIfAborted();control.signal?.addEventListener('abort',cancel,{once:true});
    this.booleanControllers.add(abort);
    const verify=()=>{try{check();}catch(error){abort.abort(error);}};
    const stopDocument=document.subscribe(verify),stopSession=this.subscribe(verify),stopPermissions=this.plugins.subscribe(verify);
    try{return await prepareVectorBoolean(request,{...control,signal:abort.signal},()=>{verify();abort.signal.throwIfAborted();});}
    finally{stopDocument();stopSession();stopPermissions();this.booleanControllers.delete(abort);control.signal?.removeEventListener('abort',cancel);}
  }
  private createSession(document: Document, assets: AssetStore) {
    document._setDefaultHistoryOrigin({surface:'editor'});
    if (
      this.sessions.some(
        (session) => session.document === document || session.assets === assets,
      )
    )
      throw new Error(
        "Each document session must own an independent document and asset store.",
      );
    document._prepareRawDevelopment=async(layerId,settings,control)=>{
      control.signal?.throwIfAborted();
      for(const job of this.rawJobs)job.abort(new Error('RAW preparation was replaced.'));
      const generation=this.ioGeneration,revision=document.getSnapshot().revision,alive=assets.captureLifetime(),abort=new AbortController(),cancel=()=>abort.abort(control.signal?.reason);
      control.signal?.addEventListener('abort',cancel,{once:true});this.rawJobs.add(abort);
      const check=()=>{abort.signal.throwIfAborted();alive();if(this.retouchDisposed||this.ioGeneration!==generation||this.document!==document||this.assets!==assets||document.getSnapshot().revision!==revision||!this.sessions.some(session=>session.document===document))throw new Error('Document session changed during RAW development. Try again.');};
      const changed=()=>{try{check();}catch(error){abort.abort(error);}},stopDocument=document.subscribe(changed),stopEditor=this.subscribe(changed);
      try{return await developRawComponent(document,assets,layerId,{allowPrecisionLoss:control.allowPrecisionLoss??false,development:settings},{signal:abort.signal,onProgress:control.onProgress},check,()=>{stopDocument();stopEditor();});}
      finally{stopDocument();stopEditor();control.signal?.removeEventListener('abort',cancel);this.rawJobs.delete(abort);}
    };
    document._preflight=(settings,control)=>{
      const snapshot=document.getSnapshot(),generation=this.ioGeneration;
      return preparePreflight(snapshot.document,snapshot.revision,assets,settings,control,()=>{
        if(this.ioGeneration!==generation||this.document!==document||document.getSnapshot().revision!==snapshot.revision||!this.sessions.some(session=>session.document===document))throw new Error('Document session changed during design checks.');
      });
    };
    document._prepareChannelLoad=(settings,control)=>{
      const snapshot=document.getSnapshot(),channel=snapshot.document.alphaChannels?.find(entry=>entry.id===settings.id),alive=assets.captureLifetime();
      if(!channel)throw new Error('Alpha channel not found.');
      return prepareChannelSelection({operation:settings.operation,invert:settings.invert,selection:channel.selection,base:snapshot.document.selection??null,width:document.width,height:document.height},control,()=>{
        alive();if(this.document!==document||document.getSnapshot().revision!==snapshot.revision||!this.sessions.some(session=>session.document===document))throw new Error('The document changed while loading its alpha channel.');
      });
    };
    document._prepareSelectionModification = (options, control) => {
      const snapshot = document.getSnapshot(), alive = assets.captureLifetime();
      return prepareSelectionModification({ ...options, selection: snapshot.document.selection!, width:document.width, height:document.height }, control, () => {
        alive();
        if (this.document !== document || document.getSnapshot().revision !== snapshot.revision || !this.sessions.some(session => session.document === document))
          throw new Error("The document changed while modifying its selection. Try again.");
      });
    };
    document._prepareVectorBoolean=(selection,control)=>{
      const snapshot=document.getSnapshot(),request=captureVectorBoolean(snapshot.document,selection).request;
      return this.prepareBoolean(document,request,control,()=>{
        if(this.document!==document||document.getSnapshot().revision!==snapshot.revision||!this.sessions.some(session=>session.document===document))throw new Error('Document session changed during the Boolean operation.');
      });
    };
    document._prepareQuickSelection=(options,control)=>{
      const snapshot=document.getSnapshot(),alive=assets.captureLifetime();
      return prepareQuickSelection(snapshot.document,assets,options,control,()=>{
        alive();if(this.document!==document||document.getSnapshot().revision!==snapshot.revision||!this.sessions.some(session=>session.document===document))throw new Error('The document changed during Quick Selection.');
      });
    };
    document._prepareSubject=(options,control)=>{
      const snapshot=document.getSnapshot(),alive=assets.captureLifetime();
      return prepareSubject(snapshot.document,assets,options,control,()=>{
        alive();if(this.document!==document||document.getSnapshot().revision!==snapshot.revision||!this.sessions.some(session=>session.document===document))throw new Error('The document changed during Select Subject.');
      });
    };
    document._prepareMatting=(request,control)=>{
      const snapshot=document.getSnapshot(),alive=assets.captureLifetime();
      return prepareMatting(snapshot.document,assets,request,control,()=>{
        alive();if(this.document!==document||document.getSnapshot().revision!==snapshot.revision||!this.sessions.some(session=>session.document===document))throw new Error('The document changed during matting.');
      },()=>document.getSnapshot().revision!==snapshot.revision);
    };
    document._prepareColorRange=(options,control)=>{
      const snapshot=document.getSnapshot(),alive=assets.captureLifetime();
      return prepareColorRange(snapshot.document,assets,options,control,()=>{
        alive();
        if(this.document!==document||document.getSnapshot().revision!==snapshot.revision||!this.sessions.some(session=>session.document===document))
          throw new Error('The document changed while selecting a color range. Try again.');
      });
    };
    document._rasterizeSmartObject = (layerId) => {
      const layer = document.getLayer(layerId);
      if (!(layer instanceof SmartObjectLayer))
        return Promise.reject(new Error("Choose a smart object."));
      return this.rasterizeSmartObject(layer);
    };
    const session = new DocumentSession(document, assets, this.publish);
    this.sessions.push(session);
    return session;
  }

  activateDocument(document: Document) {
    const session = this.sessions.find((item) => item.document === document);
    if (!session) throw new Error("Document is not open in this workspace.");
    if (session === this.activeSession) return;
    for(const job of this.photoshopCommits)job.abort(new Error('Document session changed during Photoshop import. Try again.'));
    void this.recovery.flush();
    this.ioGeneration++;
    this.tools.reset();
    this.scripts.cancel();
    this.activeSession = session;
    this.activeDocument = session.document;
    this.assets = session.assets;
    this.currentProfileId = session.colorProfile;
    this.currentSoftProof = session.softProof;
    this.renderer.resetView();
    this.recipes?.pauseRecording();
    this.recipes?.hookDocument(document);
    this.observe();
  }

  replace(document: Document, assets: AssetStore) {
    const old = this.activeSession;
    this.createSession(document, assets);
    this.activateDocument(document);
    // Reuse only the untouched startup placeholder; never discard edited work.
    if (
      this.sessions.length === 2 &&
      old.document.getSnapshot().revision === 0 &&
      !old.document.layers.length
    ) {
      this.sessions = this.sessions.filter((session) => session !== old);
      old.dispose();
    }
    if (document.layers.length)
      this.recovery.schedule(this.recoverySessionId, document.getSnapshot().document, assets);
    this.publish();
  }

  async closeDocument(
    document: Document,
    options: { discardChanges?: boolean } = {},
  ): Promise<boolean> {
    const session = this.sessions.find((item) => item.document === document);
    if (!session) throw new Error("Document is not open in this workspace.");
    if (
      (session.dirty ||
        (this.componentEdits.has(session) &&
          this.componentEdits.get(session)!.appliedRevision !==
            document.getSnapshot().revision)) &&
      !options.discardChanges
    )
      return false;
    const revision = document.getSnapshot().revision;
    await session.recovery.flush();
    if (document.getSnapshot().revision !== revision)
      throw new Error("Document changed while closing. Review it again.");
    if (session === this.activeSession) {
      let next = this.sessions.find((item) => item !== session);
      if (!next) next = this.createSession(new Document(), new AssetStore());
      this.activateDocument(next.document);
    }
    this.sessions = this.sessions.filter((item) => item !== session);
    this.componentEdits.delete(session);
    session.dispose();
    this.publish();
    return true;
  }

  /** Trusted local file preflight. Scripts/plugins do not receive file access. */
  async inspectSvg(file:File,control:SvgImportControl={}):Promise<SvgImportReport>{
    return (await inspectSvgFile(file,control)).report;
  }

  /** Read-only font source preparation; no font is installed or embedded. */
  inspectFont(file:Blob,options:FontInspectOptions={},control:FontSourceControl={}):Promise<FontInspection>{
    return this.withFontSource(control,async checked=>(await import('./fonts/client')).inspectFontFile(file,options,checked));
  }
  prepareFontSource(file:Blob,options:FontPrepareOptions={},control:FontSourceControl={}):Promise<PreparedFontSource>{
    return this.withFontSource(control,async checked=>(await import('./fonts/client')).prepareFontFile(file,options,checked));
  }
  private async withFontSource<T>(control:FontSourceControl,action:(checked:FontSourceControl)=>Promise<T>):Promise<T>{
    if(this.retouchDisposed)throw new Error('The editor is disposed.');
    control.signal?.throwIfAborted();const abort=new AbortController(),cancel=()=>abort.abort(control.signal?.reason);
    this.fontJobs.add(abort);control.signal?.addEventListener('abort',cancel,{once:true});
    try{const result=await action({...control,signal:abort.signal});abort.signal.throwIfAborted();return result;}
    finally{this.fontJobs.delete(abort);control.signal?.removeEventListener('abort',cancel);}
  }

  async inspectTiff(file:File,control:TiffImportControl={}):Promise<TiffImportReport>{return inspectTiffFile(file,control);}

  /** Trusted local preflight; opening uses the separate guarded import transaction below. */
  async inspectAvif(file:File,control:AvifImportControl={}):Promise<AvifImportReport>{return inspectAvifFile(file,control);}

  /** Trusted, read-only sensor preflight. Application RAW installation is separate. */
  async inspectRaw(file:File,image=0,control:RawImportControl={}):Promise<RawImportReport>{return inspectRawFile(file,image,control);}

  async openRaw(file:File,options:RawDecodeOptions={},control:RawImportControl={}):Promise<Readonly<RawImportReport>>{
    control.signal?.throwIfAborted();
    for(const job of this.rawJobs)job.abort(new Error('RAW preparation was replaced.'));
    const generation=++this.ioGeneration,document=this.document,assets=this.assets,revision=document.getSnapshot().revision,alive=assets.captureLifetime();
    const abort=new AbortController(),cancel=()=>abort.abort(control.signal?.reason);control.signal?.addEventListener('abort',cancel,{once:true});this.rawJobs.add(abort);
    const check=()=>{abort.signal.throwIfAborted();alive();if(this.retouchDisposed||generation!==this.ioGeneration||this.document!==document||this.assets!==assets||document.getSnapshot().revision!==revision||!this.sessions.some(s=>s.document===document))throw new Error('Document session changed during RAW import. Try again.');};
    const changed=()=>{try{check();}catch(error){abort.abort(error);}},stopDocument=document.subscribe(changed),stopEditor=this.subscribe(changed);
    let prepared:Awaited<ReturnType<typeof prepareRawImport>>|undefined;
    try{
      check();prepared=await prepareRawImport(file,options,{signal:abort.signal,onProgress:control.onProgress},check);check();
      stopDocument();stopEditor();this.rawJobs.delete(abort);
      this.replace(prepared.document,prepared.assets);this.recentFiles?.remember(file,'raw');return prepared.report;
    }catch(error){prepared?.assets.dispose();throw error;}
    finally{stopDocument();stopEditor();control.signal?.removeEventListener('abort',cancel);this.rawJobs.delete(abort);}
  }

  async openAvif(file:File,options:AvifDecodeOptions={},control:AvifImportControl={}):Promise<Readonly<AvifImportReport>>{
    control.signal?.throwIfAborted();
    for(const job of this.avifJobs)job.abort(new Error('Document session changed during AVIF import. Try again.'));
    const generation=++this.ioGeneration,document=this.document,assets=this.assets,revision=document.getSnapshot().revision,alive=assets.captureLifetime();
    const abort=new AbortController(),cancel=()=>abort.abort(control.signal?.reason);control.signal?.addEventListener('abort',cancel,{once:true});this.avifJobs.add(abort);
    const check=()=>{abort.signal.throwIfAborted();alive();if(this.retouchDisposed||generation!==this.ioGeneration||this.document!==document||this.assets!==assets||document.getSnapshot().revision!==revision||!this.sessions.some(s=>s.document===document))throw new Error('Document session changed during AVIF import. Try again.');};
    const changed=()=>{try{check();}catch(error){abort.abort(error);}},unsubscribeDocument=document.subscribe(changed),unsubscribeEditor=this.subscribe(changed);
    let prepared:Awaited<ReturnType<typeof prepareAvifImport>>|undefined;
    try{
      check();prepared=await prepareAvifImport(file,options,{signal:abort.signal,onProgress:control.onProgress},check);check();
      unsubscribeDocument();unsubscribeEditor();this.avifJobs.delete(abort);
      this.replace(prepared.document,prepared.assets);this.recentFiles?.remember(file,'avif');return prepared.report;
    }catch(error){prepared?.assets.dispose();throw error;}
    finally{unsubscribeDocument();unsubscribeEditor();control.signal?.removeEventListener('abort',cancel);this.avifJobs.delete(abort);}
  }

  async openTiff(file:File,options:TiffDecodeOptions={},control:TiffImportControl={}):Promise<TiffImportReport>{
    const generation=++this.ioGeneration,document=this.document,assets=this.assets,revision=document.getSnapshot().revision,alive=assets.captureLifetime();
    const check=()=>{control.signal?.throwIfAborted();alive();if(generation!==this.ioGeneration||this.document!==document||this.assets!==assets||document.getSnapshot().revision!==revision||!this.sessions.some(s=>s.document===document))throw new Error('Document session changed during TIFF import. Try again.');};
    const prepared=await prepareTiffImport(file,options,control,check);try{check();this.replace(prepared.document,prepared.assets);this.recentFiles?.remember(file,'tiff');return prepared.report;}catch(error){prepared.assets.dispose();throw error;}
  }

  /** Open a complete imported document; preserve existing edited tabs. */
  async openSvg(file:File,options:SvgImportOptions={},control:SvgImportControl={}):Promise<SvgImportReport>{
    const generation=++this.ioGeneration,document=this.document,assets=this.assets,revision=document.getSnapshot().revision,alive=assets.captureLifetime();
    const check=()=>{control.signal?.throwIfAborted();alive();if(generation!==this.ioGeneration||this.document!==document||this.assets!==assets||document.getSnapshot().revision!==revision||!this.sessions.some(s=>s.document===document))throw new Error('Document session changed during SVG import. Try again.');};
    const prepared=await prepareSvgImport(file,options,control,check);
    try{check();this.replace(prepared.document,prepared.assets);this.recentFiles?.remember(file,'svg');return prepared.report;}
    catch(error){prepared.assets.dispose();throw error;}
  }

  async inspectPsd(source:PhotoshopInput,control:PhotoshopImportControl={}):Promise<PhotoshopInspection>{
    if(this.retouchDisposed)throw new Error('Editor disposed during Photoshop import.');
    const abort=new AbortController(),cancel=()=>abort.abort(control.signal?.reason);control.signal?.throwIfAborted();control.signal?.addEventListener('abort',cancel,{once:true});this.photoshopJobs.add(abort);
    try{return await inspectPhotoshop(source,{signal:abort.signal,onProgress:control.onProgress});}
    finally{control.signal?.removeEventListener('abort',cancel);this.photoshopJobs.delete(abort);}
  }

  async openPsd(
    buffer: PhotoshopInput,
    options: PsdImportOptions = {},
    control:PhotoshopImportControl={},
  ): Promise<PsdImportResult> {
    control.signal?.throwIfAborted();
    for(const job of this.photoshopCommits)job.abort(new Error('Document session changed during Photoshop import. Try again.'));
    const generation=++this.ioGeneration,owner=this.document,assets=this.assets,revision=owner.getSnapshot().revision,alive=assets.captureLifetime();
    const abort=new AbortController(),cancel=()=>abort.abort(control.signal?.reason);control.signal?.addEventListener('abort',cancel,{once:true});this.photoshopJobs.add(abort);this.photoshopCommits.add(abort);
    const current=()=>{abort.signal.throwIfAborted();alive();if(this.ioGeneration!==generation||this.document!==owner||this.assets!==assets||owner.getSnapshot().revision!==revision||!this.sessions.some(s=>s.document===owner))throw new Error('Document session changed during Photoshop import. Try again.');};
    const unsubscribe=owner.subscribe(()=>{if(owner.getSnapshot().revision!==revision)abort.abort(new Error('Document session changed during Photoshop import. Try again.'));});
    let newAssets:AssetStore|null=null;
    try{
      current();const decoded=await decodePhotoshop(buffer,options,{signal:abort.signal,onProgress:value=>{current();control.onProgress?.(value);current();}});current();
      newAssets=new AssetStore();const images=new Map<string,ImageData>();let index=0;
      for(const entry of decoded.entries){
        current();control.onProgress?.({phase:'installing',fraction:index/decoded.entries.length});current();
        const asset=await newAssets.add(entry.png,'Photoshop layer',entry.id,false,{signal:abort.signal});current();
        if(asset.width!==entry.width||asset.height!==entry.height)throw new Error('Decoded Photoshop layer dimensions changed during import.');
        images.set(entry.id,new ImageData(entry.pixels,entry.width,entry.height));index++;
      }
      current();control.onProgress?.({phase:'installing',fraction:1});current();
      const document=Document.fromJSON(decoded.document);this.photoshopCommits.delete(abort);this.replace(document,newAssets);
      if(typeof File!=='undefined'&&buffer instanceof File)this.recentFiles?.remember(buffer,'photoshop');
      return{document:decoded.document,report:decoded.report,assets:images};
    }catch(error){newAssets?.dispose();throw error;}
    finally{unsubscribe();control.signal?.removeEventListener('abort',cancel);this.photoshopJobs.delete(abort);this.photoshopCommits.delete(abort);}
  }

  newDocument(
    options: { name?: string; width?: number; height?: number } = {},
  ) {
    this.replace(new Document(options), new AssetStore());
    return this.document;
  }

  async openSample() {
    const sample = await createDemo();
    const document = Document.fromJSON(sample.document);
    document.selectedLayer = document.getLayer(sample.selectedId);
    this.replace(document, sample.assets);
  }

  /** Open an image independently; keep existing edited tabs and original pixels. */
  async openImage(file:File,control:{signal?:AbortSignal}={}):Promise<RasterLayer>{
    const generation=++this.ioGeneration,owner=this.document,assets=this.assets,revision=owner.getSnapshot().revision,alive=assets.captureLifetime(),staged=new AssetStore();
    const check=()=>{control.signal?.throwIfAborted();alive();if(this.retouchDisposed||generation!==this.ioGeneration||this.document!==owner||this.assets!==assets||owner.getSnapshot().revision!==revision||!this.sessions.some(session=>session.document===owner))throw new Error('Document session changed during image opening. Try again.');};
    try{
      check();const asset=await staged.add(file,file.name,undefined,false,{signal:control.signal});check();
      const name=file.name.replace(/\.[^.]+$/,'').slice(0,240)||'Untitled',root=new Document({name,width:asset.width,height:asset.height}),raster=new RasterLayer({name:file.name.slice(0,240),assetId:asset.id,width:asset.width,height:asset.height});
      const document=Document.fromJSON({...root.toJSON(),children:[raster.toJSON()]});document.selectedLayer=document.getLayer(raster.id);check();this.replace(document,staged);this.recentFiles?.remember(file,'image');return document.getLayer(raster.id) as RasterLayer;
    }catch(error){staged.dispose();throw error;}
  }

  async importImage(file: File): Promise<RasterLayer> {
    const documentAtStart = this.document;
    const assetsAtStart = this.assets;
    const asset = await assetsAtStart.add(file, file.name);
    if (this.document !== documentAtStart || this.assets !== assetsAtStart) {
      assetsAtStart.remove(asset.id);
      throw new Error("The document changed during import. Try again.");
    }
    const empty = this.document.layers.length === 0;
    const width = empty ? asset.width : this.document.width;
    const height = empty ? asset.height : this.document.height;
    const factor = Math.min(1, width / asset.width, height / asset.height);
    const layer = new RasterLayer({
      name: file.name.slice(0, 240),
      assetId: asset.id,
      width: asset.width * factor,
      height: asset.height * factor,
      x: (width - asset.width * factor) / 2,
      y: (height - asset.height * factor) / 2,
    });
    const selected = this.document.selectedLayer;
    try {
      this.document.transaction("Import image", () => {
        if (empty) {
          this.document.resize(width, height);
          this.document.name =
            file.name.replace(/\.[^.]+$/, "").slice(0, 240) || "Untitled";
        }
        (selected instanceof LayerGroup
          ? selected.layers
          : this.document.layers
        ).add(layer);
      });
    } catch (error) {
      assetsAtStart.remove(asset.id);
      throw error;
    }

    this.document.selectedLayer = layer;
    this.recentFiles?.remember(file,'image');
    return layer;
  }

  async applyGeneratedCandidate(
    candidateId: string,
    options: ApplyCandidateOptions = {},
  ): Promise<RasterLayer> {
    return this.ai.applyCandidate(candidateId, {
      ...options,
      document: this.activeDocument,
      assetStore: this.assets,
      expectedRevision:
        options.expectedRevision ?? this.activeDocument.getSnapshot().revision,
    });
  }

  async applyMaskedEditCandidate(
    candidateId: string,
    options: ApplyMaskedEditOptions = {},
  ): Promise<RasterLayer> {
    return this.ai.applyMaskedEdit(candidateId, {
      ...options,
      document: this.activeDocument,
      assetStore: this.assets,
      expectedRevision:
        options.expectedRevision ?? this.activeDocument.getSnapshot().revision,
    });
  }

  async saveProject(): Promise<Blob> {
    const session = this.activeSession;
    const state = session.document.getSnapshot(), revision = state.revision;
    const blob = await serializeProject(
      state.document,
      session.assets,
      captureProjectHistory(state),
    );
    if (this.sessions.includes(session)) {
      session.savedRevision = revision;
      this.publish();
    }
    return blob;
  }

  async openProject(file: File) {
    const generation = ++this.ioGeneration;
    const revision = this.document.getSnapshot().revision;
    const loaded = await loadProject(file, { prepareImmutable: true });
    if (
      generation !== this.ioGeneration ||
      revision !== this.document.getSnapshot().revision
    ) {
      loaded.assets.dispose();
      throw new Error(
        "The document changed while the project was opening. Try again.",
      );
    }
    let document:Document;
    try{document=Document._fromWorkspace(loaded.document,loaded.history);}
    catch(error){loaded.assets.dispose();throw error;}
    this.replace(document, loaded.assets);
    this.recentFiles?.remember(file,'project');
  }

  async exportPng(control?: ExportControl): Promise<Blob> {
    return (await this.export({ format: "png" }, control)).blob;
  }

  async export(options: ExportOptions, control?: ExportControl): Promise<ExportResult> {
    checkExport(control);
    const result = await exportDocument(
      // Native read-only exporters pin the immutable model before yielding instead
      // of cloning all paths and unrelated raster/effect data on the UI thread.
      ['png','svg','tiff','pdf','psd','psb','avif'].includes(options.format) ? this.document._read() : this.document.toJSON(),
      this.assets,
      this.renderer,
      options,
      control,
    );
    if (control?.signal) await new Promise<void>(resolve=>setTimeout(resolve,0));
    checkExport(control);
    return result;
  }

  private captureTiffPages(documents:readonly Document[],options:TiffPagesExportOptions) {
    if(!Array.isArray(documents)||!documents.length)throw new Error('Choose at least one open document as a TIFF page.');
    if(new Set(documents).size!==documents.length)throw new Error('Choose each open document once.');
    if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(key=>key!=='variant'))throw new Error('TIFF page export options accept only variant.');
    const variant=validateTiffVariant(options.variant);
    const pages=documents.map(document=>{
      const session=this.sessions.find(session=>session.document===document);
      if(!session)throw new Error('A TIFF page document is no longer open. Choose its pages again.');
      return{session,document:document._read(),assets:session.assets,renderer:this.renderer};
    });
    const check=()=>{for(const page of pages)if(this.retouchDisposed||!this.sessions.includes(page.session)||page.session.assets!==page.assets)throw new Error('A TIFF page document closed during export. Choose its pages again.');};
    check();return{pages,variant,check};
  }

  /** Trusted browser host; each open Document becomes one flattened native-size page. */
  async exportTiffPages(documents:readonly Document[],options:TiffPagesExportOptions={},control?:ExportControl):Promise<ExportResult> {
    checkExport(control);const{pages,variant,check}=this.captureTiffPages(documents,options);
    const report=getTiffPagesCapabilityReport(pages.map(page=>page.document),variant);
    const current=()=>{checkExport(control);check();};
    const blob=await encodeTiffPages(pages,variant,{signal:control?.signal,onProgress:progress=>{current();control?.onProgress?.(progress);current();}});
    if(control?.signal)await new Promise<void>(resolve=>setTimeout(resolve,0));current();
    return{blob,mimeType:'image/tiff',extension:'tif',report};
  }

  getTiffPagesCapabilityReport(documents:readonly Document[],options:TiffPagesExportOptions={}):ExportCapabilityReport {
    const{pages,variant}=this.captureTiffPages(documents,options);
    return getTiffPagesCapabilityReport(pages.map(page=>page.document),variant);
  }

  getExportCapabilityReport(options: ExportOptions): ExportCapabilityReport {
    return getExportCapabilityReport(
      ['png','svg','tiff','pdf','psd','psb','avif'].includes(options.format) ? this.document._read() : this.document.toJSON(), options,
    );
  }

  /** Trusted preference operation. Preparation never inserts an asset into a document. */
  async applyBrushPreset(preset:BrushPreset,options:{signal?:AbortSignal;selectTool?(tool:BrushTool):void}={}):Promise<BrushTool>{
    const owned=new BrushPreset(preset.toJSON(),preset.source),signal=options.signal,selectTool=options.selectTool;signal?.throwIfAborted();
    this.presetApplyAbort?.abort(new DOMException('Brush preset application was replaced.','AbortError'));
    const abort=new AbortController();this.presetApplyAbort=abort;
    const cancel=()=>abort.abort(signal?.reason);signal?.addEventListener('abort',cancel,{once:true});
    const document=this.document,revision=document.getSnapshot().revision,state=this.tools.getSnapshot(),source=this.brushTextureSource.source,generation=this.ioGeneration;
    const draft=new BrushTextureSourceOwner();
    const check=()=>{abort.signal.throwIfAborted();if(this.presetApplyAbort!==abort||this.ioGeneration!==generation||this.document!==document||document.getSnapshot().revision!==revision||this.tools.getSnapshot()!==state||this.brushTextureSource.source!==source)throw new Error('The document or brush changed while preparing this preset. Retry from the current tool.');};
    try{
      if(owned.source){
        const original=await verifyPresetSource(owned.source,abort.signal);check();
        const asset=await draft.import(original.blob,original.name,{signal:abort.signal,tiff:original.tiff,avif:original.avif,raw:original.raw});check();
        if(asset.width!==original.width||asset.height!==original.height)throw new Error('Brush source dimensions do not match its original pixels.');
      }
      check();selectTool?.(owned.tool);return this.tools.applyBrushPreset(owned,owned.source?draft:undefined);
    }finally{signal?.removeEventListener('abort',cancel);if(this.presetApplyAbort===abort)this.presetApplyAbort=null;draft.dispose();}
  }

  async runScript(code: string) {
    return this.executeScript(code, "Run script");
  }

  async runPlugin(pluginId: string, commandId: string): Promise<string[]> {
    const plugin = this.plugins.get(pluginId);
    const command = plugin?.commands.find(
      (command) => command.id === commandId,
    );
    if (!plugin || !command)
      throw new Error("Plugin command is not installed.");
    const granted = this.plugins.getGrantedPermissions(pluginId);
    if (!granted.includes("document:read")) {
      throw new Error("Plugin does not have granted document:read permission.");
    }
    const hasWritePermission = granted.includes("document:write");
    return this.executeScript(
      command.source,
      `${plugin.name}: ${command.title}`.slice(0, 240),
      !hasWritePermission,
      { permissions: granted, pluginId, commandId, version:plugin.version },
    );
  }

  private async executeScript(
    code: string,
    label: string,
    readOnly = false,
    pluginContext?: {
      permissions: readonly PluginPermission[];
      pluginId: string;
      commandId:string;version:string;
    },
  ) {
    const document = this.document;
    const revision = document.getSnapshot().revision;
    const historyOrigin:import('./core/history-provenance').HistoryOrigin=pluginContext?{surface:'plugin',executionId:crypto.randomUUID(),plugin:{id:pluginContext.pluginId,commandId:pluginContext.commandId,version:pluginContext.version}}:{surface:'script',executionId:crypto.randomUUID()};
    const selectedId = document.selectedLayer?.id ?? null;
    const selectedIds = document.selectedLayers.map((layer) => layer.id);
    const assets = this.assets,
      generation = this.ioGeneration,
      snapshot = document.toJSON();
    const rawOriginPins=new Map(assets.values().filter(asset=>asset.raw).map(asset=>[asset.id,captureAssetSource(assets,asset.id)]));
    const usedRawOrigins=new Set<string>();let rawReadUsed=false;
    const checkRawOrigin=(assetId:string)=>{
      usedRawOrigins.add(assetId);const pin=rawOriginPins.get(assetId);if(!pin)throw new Error('RAW source was not present in the script snapshot.');
      pin.check();
    };
    const checkRawOrigins=()=>{for(const key of usedRawOrigins){const pin=rawOriginPins.get(key);if(!pin)throw new Error('RAW source was not present in the script snapshot.');pin.check();}};
    let retouch: ScriptRetouch | undefined;
    const selectionAbort = new AbortController();
    const scriptCommitAbort = new AbortController(), scriptCommitDeadline = performance.now() + 5000;
    let unsubscribeScriptCancellation = () => {};
    let selectionBusy = false;
    let selectionCount = 0;
    let imageSelectionPrepared=false;
    const checkSelection = () => {
      selectionAbort.signal.throwIfAborted();
      if (this.ioGeneration !== generation || this.document !== document || this.assets !== assets || document.getSnapshot().revision !== revision)
        throw new Error("Document session changed during selection preparation.");
      if (pluginContext && !this.plugins.getGrantedPermissions(pluginContext.pluginId).includes("document:write"))
        throw new Error("Permission denied: document:write is required to modify the document.");
    };
    const checkRetouch = () => {
      if (
        this.ioGeneration !== generation ||
        this.document !== document ||
        this.assets !== assets ||
        !this.sessions.some((session) => session.document === document) ||
        document.getSnapshot().revision !== revision
      ) {
        throw new Error(
          "Document session changed during script repair preparation.",
        );
      }
      if (pluginContext) {
        const granted = this.plugins.getGrantedPermissions(
          pluginContext.pluginId,
        );
        for (const permission of [
          "document:read",
          "document:write",
          "assets:read",
          "assets:write",
        ] as const) {
          if (!granted.includes(permission))
            throw new Error(
              `Permission denied: ${permission} is required for script repairs.`,
            );
        }
      }
    };
    const hostBridge = new HostBridge({
      ai: this.ai,
      assets: this.assets,
      document,
      permissions: pluginContext?.permissions,
      pluginId: pluginContext?.pluginId,
      isTrustedScript: !pluginContext,
      historyOrigin,
      assertCanCommit:()=>{
        scriptCommitAbort.signal.throwIfAborted();
        if(performance.now()>scriptCommitDeadline)throw new Error('Script exceeded its 5-second time limit.');
        if(this.ioGeneration!==generation||this.document!==document||this.assets!==assets||document.getSnapshot().revision!==revision+hostBridge.inBandRevisions)throw new Error('Document changed before the script host commit.');
        if(pluginContext){const grants=this.plugins.getGrantedPermissions(pluginContext.pluginId);if(!grants.includes('document:read')||!grants.includes('document:write'))throw new Error('Plugin permissions changed before host commit.');}
      },
    });
    try {
      const pendingScript = this.scripts.run(document, code, {
        hostBridge: {
          dispatch: async (service, method, args) => {
            if(service==='raw'&&method==='settings'){
              selectionAbort.signal.throwIfAborted();
              if(this.ioGeneration!==generation||this.document!==document||this.assets!==assets||document.getSnapshot().revision!==revision)throw new Error('Document changed while reading RAW settings.');
              if(pluginContext){const grants=this.plugins.getGrantedPermissions(pluginContext.pluginId);if(!grants.includes('document:read')||!grants.includes('assets:read'))throw new Error('Permission denied: document:read and assets:read are required for RAW settings.');}
              rawReadUsed=true;
              const request=args[1] as {layerId?:unknown};if(!request||typeof request.layerId!=='string'||Object.keys(request).some(key=>key!=='layerId'))throw new Error('Invalid RAW settings request.');
              const data=execute(snapshot,{type:'transaction',label:'Read RAW settings',commands:parseCommands(args[0])});
              if(retouch)return retouch.rawSettings(data,request.layerId);
              const layer=findLayer(data,request.layerId);if(layer?.kind!=='smart-object')throw new Error('Choose an attached smart object.');
              const source=new ComponentRegistry(data.components).get(layer.componentId).source;if(source.kind!=='asset')return null;
              const asset=assets.get(source.assetId);if(rawOriginPins.has(source.assetId)||asset.raw)checkRawOrigin(source.assetId);
              return asset.raw?rawDevelopOptionsSchema.parse(asset.raw.settings.development):null;
            }
            if(service==='assets'&&pluginContext&&!this.plugins.getGrantedPermissions(pluginContext.pluginId).includes('assets:read'))throw new Error('Permission denied: assets:read is required to inspect asset metadata.');
            if(service==='selection'&&method==='subject'){
              checkSelection();if(selectionBusy)throw new Error('Await each selection preparation before starting another.');
              if(++selectionCount>32)throw new Error('A script can prepare at most 32 selections.');
              const settings=selectSubjectOptionsSchema.parse(args[1]);
              const checkSubject=()=>{checkSelection();if(pluginContext&&!this.plugins.getGrantedPermissions(pluginContext.pluginId).includes('assets:read'))throw new Error('Permission denied: assets:read is required for Select Subject.');};
              checkSubject();imageSelectionPrepared=true;
              const source=execute(snapshot,{type:'transaction',label:'Prepare Select Subject',commands:parseCommands(args[0])});
              selectionBusy=true;return prepareSubject(source,assets,settings,{signal:selectionAbort.signal},checkSubject).finally(()=>{selectionBusy=false;});
            }
            if(service==='selection'&&method==='quick'){
              checkSelection();if(selectionBusy)throw new Error('Await each selection preparation before starting another.');
              if(++selectionCount>32)throw new Error('A script can prepare at most 32 selections.');
              const settings=quickSelectionOptionsSchema.parse(args[1]);
              const checkQuick=()=>{checkSelection();if(pluginContext&&!this.plugins.getGrantedPermissions(pluginContext.pluginId).includes('assets:read'))throw new Error('Permission denied: assets:read is required for Quick Selection.');};
              checkQuick();imageSelectionPrepared=true;
              const source=execute(snapshot,{type:'transaction',label:'Prepare Quick Selection',commands:parseCommands(args[0])});
              selectionBusy=true;return prepareQuickSelection(source,assets,settings,{signal:selectionAbort.signal},checkQuick).finally(()=>{selectionBusy=false;});
            }
            if(service==='selection'&&method==='channel'){
              checkSelection();
              if(selectionBusy)throw new Error('Await each selection preparation before starting another.');
              if(++selectionCount>32)throw new Error('A script can prepare at most 32 selections.');
              const settings=channelLoadSchema.parse(args[1]);
              const source=execute(snapshot,{type:'transaction',label:'Prepare alpha channel',commands:parseCommands(args[0])});
              const channel=source.alphaChannels?.find(entry=>entry.id===settings.id);
              if(!channel)throw new Error('Alpha channel not found.');
              selectionBusy=true;
              return prepareChannelSelection({operation:settings.operation,invert:settings.invert,selection:channel.selection,base:source.selection??null,width:source.width,height:source.height},{signal:selectionAbort.signal},checkSelection).finally(()=>{selectionBusy=false;});
            }
            if(service==='selection'&&method==='color-range'){
              checkSelection();
              if(selectionBusy)throw new Error('Await each selection preparation before starting another.');
              if(++selectionCount>32)throw new Error('A script can prepare at most 32 selections.');
              const settings=colorRangeOptionsSchema.parse(args[1]);
              const checkColor=()=>{checkSelection();if(pluginContext&&!this.plugins.getGrantedPermissions(pluginContext.pluginId).includes('assets:read'))throw new Error('Permission denied: assets:read is required for Color Range sampling.');};
              checkColor();imageSelectionPrepared=true;
              const source=execute(snapshot,{type:'transaction',label:'Prepare color range',commands:parseCommands(args[0])});
              selectionBusy=true;
              return prepareColorRange(source,assets,settings,{signal:selectionAbort.signal},checkColor).finally(()=>{selectionBusy=false;});
            }
            if (service === "selection" && method === "modify") {
              checkSelection();
              if (selectionBusy) throw new Error("Await each selection modification before starting another.");
              if (++selectionCount > 32) throw new Error("A script can prepare at most 32 selections.");
              const settings = selectionModificationSchema.parse(args[1]);
              const source = execute(snapshot, {type:"transaction",label:"Prepare selection",commands:parseCommands(args[0])});
              if (!source.selection) throw new Error("Create a pixel selection first.");
              selectionBusy = true;
              return prepareSelectionModification({...settings,selection:source.selection,width:source.width,height:source.height}, {signal:selectionAbort.signal}, checkSelection)
                .finally(() => { selectionBusy = false; });
            }
            if(service==='typography'&&method==='measure'){
              const check=()=>{checkSelection();if(pluginContext&&!this.plugins.getGrantedPermissions(pluginContext.pluginId).includes('document:read'))throw new Error('Permission denied: document:read is required for typography preparation.');};
              check();if(selectionBusy)throw new Error('Await each native preparation before starting another.');
              if(++selectionCount>32)throw new Error('A script can prepare at most 32 native operations.');
              const request=z.object({layerId:z.string(),patch:z.object({text:z.string().max(10000),characterRanges:z.array(characterRangeSchema).max(10000).optional()}).strict()}).strict().parse(args[1]);
              const source=execute(snapshot,{type:'transaction',label:'Prepare typography',commands:parseCommands(args[0])});
              const candidate=execute(source,{type:'layer.update',id:request.layerId,patch:request.patch}),layer=findLayer(candidate,request.layerId);
              if(layer?.kind!=='text')throw new Error('Typography preparation requires an attached text layer.');
              selectionBusy=true;
              try{const prepared=await prepareCharacterTextMetrics(characterInputForLayer(layer),candidate,assets,{signal:selectionAbort.signal,isCancelled:()=>{check();return false;}});try{check();prepared.check();return prepared.bounds;}finally{prepared.release();}}finally{selectionBusy=false;}
            }
            if(service==='vector'&&method==='boolean'){
              checkSelection();
              if(pluginContext&&!this.plugins.getGrantedPermissions(pluginContext.pluginId).includes('document:read'))throw new Error('Permission denied: document:read is required for Boolean operations.');
              if(selectionBusy)throw new Error('Await each native preparation before starting another.');
              if(++selectionCount>32)throw new Error('A script can prepare at most 32 native operations.');
              const selection=vectorBooleanSelectionSchema.parse(args[1]),source=execute(snapshot,{type:'transaction',label:'Prepare Boolean operation',commands:parseCommands(args[0])}),request=captureVectorBoolean(source,selection).request;
              const check=()=>{checkSelection();if(pluginContext&&!this.plugins.getGrantedPermissions(pluginContext.pluginId).includes('document:read'))throw new Error('Permission denied: document:read is required for Boolean operations.');};
              selectionBusy=true;return this.prepareBoolean(document,request,{signal:selectionAbort.signal},check).finally(()=>{selectionBusy=false;});
            }
            if (service !== "retouch")
              return hostBridge.dispatch(service, method, args);
            checkRetouch();
            if (
              method !== "patch" &&
              method !== "heal" &&
              method !== "rasterize" && method!=='matting' && method!=='raw-develop'
            )
              return Promise.reject(new Error("Unknown retouch method."));
            retouch ??= new ScriptRetouch(
              snapshot,
              this.renderer,
              assets,
              checkRetouch,
              checkRawOrigin,
            );
            return retouch.prepare(args[0], args[1], method);
          },
        },
      });
      unsubscribeScriptCancellation = this.scripts.subscribeCancellation(() => scriptCommitAbort.abort(new Error('Script stopped. No script edits were applied.')));
      const result = await pendingScript;
      scriptCommitAbort.signal.throwIfAborted();
      if (
        this.document !== document ||
        document.getSnapshot().revision !==
          revision + hostBridge.inBandRevisions
      )
        throw new Error(
          "The document changed while the script ran. No script edits were applied.",
        );
      if (
        readOnly &&
        (result.commands.length > 0 ||
          result.selectedId !== selectedId ||
          JSON.stringify(result.selectedIds) !== JSON.stringify(selectedIds) ||
          hostBridge.inBandRevisions > 0)
      )
        throw new Error(
          "This plugin only has document:read permission. No edits were applied.",
        );
      // Permissions can change while the isolated worker is running. Recheck
      // before installing assets, dispatching staged commands or selecting layers.
      if (pluginContext) {
        const granted = this.plugins.getGrantedPermissions(pluginContext.pluginId);
        if(rawReadUsed&&!granted.includes('assets:read'))throw new Error('Plugin no longer has assets:read permission. No script edits were applied.');
        if(imageSelectionPrepared&&!granted.includes('assets:read'))throw new Error('Plugin no longer has assets:read permission. No script edits were applied.');
        if (!granted.includes("document:read"))
          throw new Error("Plugin is no longer installed. No script edits were applied.");
        if (!granted.includes("document:write") && (
          result.commands.length > 0 || result.selectedId !== selectedId ||
          JSON.stringify(result.selectedIds) !== JSON.stringify(selectedIds)
        )) throw new Error("Plugin no longer has document:write permission. No script edits were applied.");
      }
      const command = {
        type: "transaction" as const,
        label,
        commands: result.commands,
      };
      const next = execute(document.toJSON(), command);
      let installed: string[] = [];
      const installedRecords = new Map<string, ReturnType<AssetStore['get']>>();
      try {
        const sources = retouch ? retouch.validationSources(assets) : assets;
        const pinned = [...referencedAssets(next)].map(id => { const source = sources.get(id); return { id, source, bitmap: source.bitmap, blob: source.blob, width: source.width, height: source.height }; });
        const needsWrite = result.commands.length > 0 || result.selectedId !== selectedId || JSON.stringify(result.selectedIds) !== JSON.stringify(selectedIds) || hostBridge.inBandRevisions > 0;
        const checkWetCommit = () => {
          scriptCommitAbort.signal.throwIfAborted();checkRawOrigins();
          if (performance.now() > scriptCommitDeadline) throw new Error('Script exceeded its 5-second time limit. No script edits were applied.');
          if (this.ioGeneration !== generation || this.document !== document || this.assets !== assets || document.getSnapshot().revision !== revision + hostBridge.inBandRevisions) throw new Error('The document changed while the script ran. No script edits were applied.');
          if (pluginContext) {
            const grants = this.plugins.getGrantedPermissions(pluginContext.pluginId);
            if (!grants.includes('document:read') || (needsWrite && !grants.includes('document:write')) || ((imageSelectionPrepared||rawReadUsed) && !grants.includes('assets:read'))) throw new Error('Plugin permissions changed. No script edits were applied.');
          }
          for (const entry of pinned) { const source = sources.get(entry.id); if (source !== entry.source || source.bitmap !== entry.bitmap || source.blob !== entry.blob || source.width !== entry.width || source.height !== entry.height || source.bitmap.width !== entry.width || source.bitmap.height !== entry.height) throw new Error('Script source assets changed. No script edits were applied.'); }
        };
        await validateWetPaintAssets(next, wetBrowserAssets(sources, checkWetCommit));
        checkWetCommit();
        installed = retouch ? retouch.installReferenced(next, assets) : [];
        for (const id of installed) installedRecords.set(id, assets.get(id));
        document._withHistoryOrigin(historyOrigin,()=>document._dispatch(command));
      } catch (error) {
        const current = document.getSnapshot(), retained = new Set(retainedDocuments(current.document, captureRetainedHistory(current)).flatMap(state => [...referencedAssets(state)]));
        for (const assetId of installed) if (!retained.has(assetId) && assets.has(assetId) && assets.get(assetId) === installedRecords.get(assetId)) assets.remove(assetId);
        throw error;
      }
      document.selectLayers(
        result.selectedIds.map((id) => document.getLayer(id)!).filter(Boolean),
      );
      return result.logs;
    } finally {
      scriptCommitAbort.abort(new Error('Script execution finished. Pending host edits cannot commit.'));
      unsubscribeScriptCancellation();
      selectionAbort.abort();
      retouch?.dispose();
    }
  }

  dispose() {
    this.ioGeneration++;
    this.retouchDisposed = true;
    for(const job of this.fontJobs)job.abort(new Error('Editor disposed during font source preparation.'));this.fontJobs.clear();
    for(const job of this.photoshopJobs)job.abort(new Error('Editor disposed during Photoshop import.'));this.photoshopJobs.clear();this.photoshopCommits.clear();
    for(const job of this.rawJobs)job.abort(new Error('Editor disposed during RAW preparation.'));this.rawJobs.clear();
    for(const job of this.avifJobs)job.abort(new Error('Editor disposed during AVIF import.'));this.avifJobs.clear();
    for(const controller of this.booleanControllers)controller.abort(new Error('Editor disposed during the Boolean operation.'));
    this.booleanControllers.clear();
    this.retouchDisposed = true;
    this.idleRetouchProcessor?.dispose();
    this.idleRetouchProcessor = null;
    for (const processor of this.retouchProcessors) processor.dispose();
    this.retouchProcessors.clear();
    this.workspaceAutosave.dispose();
    this.projectEncoder.dispose();
    this.tools.cancel();
    this.presetApplyAbort?.abort(new DOMException('Editor disposed during preset preparation.','AbortError'));this.presetApplyAbort=null;
    this.recentFiles.dispose();
    this.artworkLibrary.dispose();
    this.palettes.dispose();
    this.historyPreviewClosed=true;for(const abort of this.historyPreviews)abort.abort(new DOMException("Editor closed.","AbortError"));this.historyPreviews.clear();
    this.lensProfiles.dispose();
    this.chatGpt.dispose();
    this.brushPresets.dispose();
    this.brushTextureSource.dispose();
    this.scripts.cancel();
    this.unsubscribe();
    this.renderer.dispose();
    this.sessions.forEach((session) => session.dispose());
    this.sessions = [];
    this.componentEdits.clear();
    this.ai.dispose();
    this.recipes.dispose();
    this.batch.dispose();
    this.listeners.clear();
  }
}
