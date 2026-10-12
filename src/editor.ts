import { encodeRgbaPng } from "./engine/png";
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
import { AssetStore } from "./core/assets";
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
import { exportDocument, getExportCapabilityReport } from "./engine/export";
import type {
  ExportOptions,
  ExportResult,
  ExportCapabilityReport,
} from "./engine/export";
import { execute } from "./core/commands";
import { referencedAssets, allLayers, id } from "./core/model";
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
  psdToDocument,
  type PsdImportOptions,
  type PsdImportResult,
} from "./core/interchange/psd";
import type { StandardRgbSpaceId, SoftProofOptions } from "./core/color/types";
import { createCanvas, release } from "./engine/canvas";

/** Application services own assets and I/O; the DOM itself is browser-independent. */
export class EditorApplication {
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
  private idleRetouchProcessor: PixelProcessor | null = null;
  private retouchProcessors = new Set<PixelProcessor>();
  private retouchDisposed = false;
  readonly renderer = new AdaptiveRenderer();
  readonly scripts = new ScriptRunner();
  readonly tools = new ToolController(this);
  readonly plugins = new PluginRegistry(browserPluginStorage());
  readonly ai: GenerationJobService;
  readonly recipes: RecipeService;
  readonly batch: BatchRunnerService;
  private activeDocument = new Document();
  private assets = new AssetStore();
  private currentProfileId: StandardRgbSpaceId = "srgb";
  private currentSoftProof: SoftProofOptions | null = null;
  private listeners = new Set<() => void>();
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
      cached.state.future === state.future
    )
      return cached.project;
    const entry = {
      state,
      project: this.projectEncoder.encode(state.document, session.assets, {
        version: 1,
        past: state.past,
        future: state.future,
      }),
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
            (await computeSha256(await previous.blob.arrayBuffer())) !==
              (await computeSha256(await asset.blob.arrayBuffer()))
          )
            throw new Error(
              "An image asset ID conflicts with the source document. Import it with a new identity before applying.",
            );
        } else await staged.add(asset.blob, asset.name, asset.id, false);
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

  async copySelectedLayersTo(target: Document) {
    const source = this.activeDocument;
    const destination = this.sessions.find(
      (session) => session.document === target,
    );
    if (!destination || source === target)
      throw new Error("Choose another open document as the copy destination.");
    const roots = source.layerSelection.rootLayers;
    if (!roots.length) throw new Error("Select artwork to copy first.");
    const snapshot = source.toJSON();
    const copies = roots.map((layer) => {
      const copy = structuredClone(layer.toJSON());
      const world = layerTransform(snapshot, layer.id)!.toJSON();
      copy.x = world.e;
      copy.y = world.f;
      copy.transform = { ...world, e: 0, f: 0 };
      return copy;
    });
    const registry = new ComponentRegistry(snapshot.components);
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
    const assetIds = referencedAssets({
      ...snapshot,
      children: copies,
      components: [...reachable].map((key) => registry.get(key)),
    });
    // Capture immutable original blobs before yielding; closing the source cannot revoke this snapshot.
    const originals = [...assetIds].map((key) => this.assets.get(key));
    const replacements = new Map(originals.map((asset) => [asset.id, id()]));
    const revision = target.getSnapshot().revision;
    const assertLifetime = destination.assets.captureLifetime();
    const assertTarget = () => {
      assertLifetime();
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
        const previousId = node.id;
        node.id = id();
        layerIds.set(previousId, node.id);
        if (node.kind === "smart-object" && remapComponents)
          node.componentId = componentIds[node.componentId];
        if (node.kind === "raster") {
          node.assetId = replacements.get(node.assetId)!;
          for (const effect of node.effects) effect.id = id();
        }
        if (node.kind === "smart-object") {
          if (node.filterMask?.kind === "bitmap")
            node.filterMask.assetId = replacements.get(
              node.filterMask.assetId,
            )!;
          for (const entry of node.filterMask?.strokes ?? [])
            entry.stroke.id = id();
        }
        if (node.mask?.kind === "bitmap")
          node.mask.assetId = replacements.get(node.mask.assetId)!;
        if (node.kind === "adjustment" && node.adjustment.kind === "patch")
          node.adjustment.assetId = replacements.get(node.adjustment.assetId)!;
        for (const entry of node.mask?.strokes ?? []) entry.stroke.id = id();
        if (node.kind === "paint")
          for (const stroke of node.strokes) {
            stroke.id = id();
            if (stroke.kind === "clone")
              for (const tile of stroke.tiles)
                tile.assetId = replacements.get(tile.assetId)!;
          }
        if (node.kind === "vector")
          for (const path of node.paths) path.id = id();
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
      label: "Copy artwork from document",
      commands,
    };
    execute(target.toJSON(), command); // Validate the entire target before decoding or publishing images.
    const staging = new AssetStore(),
      installed = new Set<string>();
    let committed = false;
    try {
      for (const asset of originals) {
        const copy = await staging.add(
          asset.blob,
          asset.name,
          replacements.get(asset.id)!,
          false,
        );
        if (copy.width !== asset.width || copy.height !== asset.height)
          throw new Error(
            "Copied image dimensions do not match the captured source.",
          );
        assertTarget();
      }
      assertTarget();
      for (const asset of staging.values()) {
        destination.assets.install(asset, false);
        installed.add(asset.id);
      }
      target._dispatch(command);
      committed = true;
      const layers = copies.map((copy) => target.getLayer(copy.id)!);
      target.selectLayers(layers);
      return layers;
    } finally {
      if (!committed)
        for (const key of installed) destination.assets.remove(key);
      for (const asset of staging.values())
        if (!installed.has(asset.id)) asset.bitmap.close();
      staging.metadata.dispose();
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

  async selectSubject(options?: SelectSubjectOptions): Promise<SelectionData> {
    return this.activeDocument.selectSubject(options);
  }

  async removeBackground(
    targetLayer?: RasterLayer,
    options?: RefineEdgeOptions,
  ): Promise<RasterLayer> {
    return this.activeDocument.removeBackground(targetLayer, options);
  }

  async refineEdge(options: RefineEdgeOptions = {}): Promise<LayerMask> {
    const layer = this.activeDocument.selectedLayer;
    if (!(layer instanceof RasterLayer)) {
      throw new Error("Select a raster layer to refine its edge.");
    }
    return layer.refineEdge(options);
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

  private createSession(document: Document, assets: AssetStore) {
    if (
      this.sessions.some(
        (session) => session.document === document || session.assets === assets,
      )
    )
      throw new Error(
        "Each document session must own an independent document and asset store.",
      );
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

  async openPsd(
    buffer: ArrayBuffer | Uint8Array,
    options: PsdImportOptions = {},
  ): Promise<PsdImportResult> {
    const result = psdToDocument(buffer, options);
    const newAssets = new AssetStore();

    for (const [assetId, imgData] of result.assets) {
      const canvas = createCanvas(imgData.width, imgData.height);
      try {
        const ctx = canvas.getContext("2d")!;
        ctx.putImageData(imgData, 0, 0);
        const blob = await new Promise<Blob>((resolve, reject) => {
          if (typeof canvas.toBlob === "function") {
            canvas.toBlob((b) =>
              b ? resolve(b) : reject(new Error("Failed to create blob")),
            );
          } else {
            resolve(new Blob([imgData.data.buffer], { type: "image/png" }));
          }
        });
        const bitmap =
          typeof createImageBitmap === "function"
            ? await createImageBitmap(blob)
            : (canvas as unknown as ImageBitmap);
        newAssets.install(
          {
            id: assetId,
            name: "PSD Asset",
            width: imgData.width,
            height: imgData.height,
            blob,
            bitmap,
            thumbnail: "",
          },
          false,
        );
      } finally {
        if (typeof createImageBitmap === "function") {
          release(canvas);
        }
      }
    }

    this.replace(Document.fromJSON(result.document), newAssets);
    return result;
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
    const revision = session.document.getSnapshot().revision;
    const blob = await serializeProject(
      session.document.toJSON(),
      session.assets,
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
    this.replace(Document.fromJSON(loaded.document), loaded.assets);
  }

  async exportPng(control?: ExportControl): Promise<Blob> {
    return (await this.export({ format: "png" }, control)).blob;
  }

  async export(options: ExportOptions, control?: ExportControl): Promise<ExportResult> {
    checkExport(control);
    const result = await exportDocument(
      this.document.toJSON(),
      this.assets,
      this.renderer,
      options,
      control,
    );
    if (control?.signal) await new Promise<void>(resolve=>setTimeout(resolve,0));
    checkExport(control);
    return result;
  }

  getExportCapabilityReport(options: ExportOptions): ExportCapabilityReport {
    return getExportCapabilityReport(this.document.toJSON(), options);
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
      { permissions: granted, pluginId },
    );
  }

  private async executeScript(
    code: string,
    label: string,
    readOnly = false,
    pluginContext?: {
      permissions: readonly PluginPermission[];
      pluginId: string;
    },
  ) {
    const document = this.document;
    const revision = document.getSnapshot().revision;
    const selectedId = document.selectedLayer?.id ?? null;
    const selectedIds = document.selectedLayers.map((layer) => layer.id);
    const assets = this.assets,
      generation = this.ioGeneration,
      snapshot = document.toJSON();
    let retouch: ScriptRetouch | undefined;
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
    });
    try {
      const result = await this.scripts.run(document, code, {
        hostBridge: {
          dispatch: (service, method, args) => {
            if (service !== "retouch")
              return hostBridge.dispatch(service, method, args);
            checkRetouch();
            if (
              method !== "patch" &&
              method !== "heal" &&
              method !== "rasterize"
            )
              return Promise.reject(new Error("Unknown retouch method."));
            retouch ??= new ScriptRetouch(
              snapshot,
              this.renderer,
              assets,
              checkRetouch,
            );
            return retouch.prepare(args[0], args[1], method);
          },
        },
      });
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
      const command = {
        type: "transaction" as const,
        label,
        commands: result.commands,
      };
      const next = execute(document.toJSON(), command);
      const installed = retouch ? retouch.installReferenced(next, assets) : [];
      try {
        for (const assetId of referencedAssets(next)) assets.get(assetId);
        document._dispatch(command);
      } catch (error) {
        for (const assetId of installed) assets.remove(assetId);
        throw error;
      }
      document.selectLayers(
        result.selectedIds.map((id) => document.getLayer(id)!).filter(Boolean),
      );
      return result.logs;
    } finally {
      retouch?.dispose();
    }
  }

  dispose() {
    this.retouchDisposed = true;
    this.idleRetouchProcessor?.dispose();
    this.idleRetouchProcessor = null;
    for (const processor of this.retouchProcessors) processor.dispose();
    this.retouchProcessors.clear();
    this.workspaceAutosave.dispose();
    this.projectEncoder.dispose();
    this.tools.cancel();
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
