import { RecipePackageStorage } from "./package-storage";
import { executeRecipePackage } from "./package-executor";
import {
  recipeAssetIds,
  serializeRecipePackage,
  type RecipeAsset,
} from "./package";
import type { Document } from "../../dom";
import type { EditorApplication } from "../../editor";
import type { EditPlan, Recipe } from "./types";
import { BUILTIN_PRESETS } from "./presets";
import { RecipeStorage } from "./storage";
import { RecipeRecorder, type RecorderOptions } from "./recorder";
import {
  compileEditPlan,
  executeRecipe,
  type ExecuteRecipeResult,
} from "./executor";

export class RecipeService {
  readonly storage = new RecipeStorage();
  readonly packages = new RecipePackageStorage();
  readonly recorder = new RecipeRecorder();
  private unsavedRecording?: Recipe;
  private recordingSources = new Map<string, RecipeAsset>();
  lastSavedRecordingFormat: "json" | "package" = "json";

  get pendingRecordingHasAssets(): boolean {
    return (
      !!this.unsavedRecording && recipeAssetIds(this.unsavedRecording).size > 0
    );
  }

  private captureRecordingSources(document: Document): void {
    for (const asset of document.assetStore?.values() ?? []) {
      this.recordingSources.set(asset.id, {
        id: asset.id,
        name: asset.name,
        width: asset.width,
        height: asset.height,
        blob: asset.blob,
      });
    }
  }

  exportPendingRecordingPackage(): Promise<Blob> {
    if (!this.unsavedRecording)
      throw new Error("No unsaved recording is available.");
    return serializeRecipePackage(this.unsavedRecording, {
      get: (id) => {
        const asset = this.recordingSources.get(id);
        if (!asset)
          throw new Error(`Recorded source asset is unavailable: ${id}`);
        return asset;
      },
    });
  }

  get pendingRecording(): Recipe | undefined {
    return this.unsavedRecording
      ? structuredClone(this.unsavedRecording)
      : undefined;
  }

  async savePendingRecording(): Promise<Recipe> {
    if (!this.unsavedRecording)
      throw new Error("No unsaved recording is available.");
    const recipe = this.unsavedRecording;
    if (this.pendingRecordingHasAssets) {
      await this.packages.save(await this.exportPendingRecordingPackage());
      this.lastSavedRecordingFormat = "package";
    } else {
      await this.storage.save(recipe);
      this.lastSavedRecordingFormat = "json";
    }
    this.recordingSources.clear();
    this.unsavedRecording = undefined;
    return recipe;
  }
  private unhookRecorder: (() => void) | null = null;
  private editor: EditorApplication;
  private targetGeneration = 0;
  private disposed = false;

  private captureTargetGuard(document: Document): () => void {
    const generation = this.targetGeneration;
    const assertAvailable = () => {
      if (
        this.disposed ||
        this.targetGeneration !== generation ||
        this.editor.document !== document
      ) {
        throw new Error(
          "Document session changed while preparing the recipe package. Review the target and retry.",
        );
      }
    };
    assertAvailable();
    return assertAvailable;
  }

  constructor(editor: EditorApplication) {
    this.editor = editor;
    this.hookDocument(editor.document);
  }

  /**
   * Re-binds recorder listener when active document changes in EditorApplication.
   */
  hookDocument(doc: Document): void {
    this.targetGeneration++;
    if (this.unhookRecorder) {
      this.recorder.invalidateHistory(
        "Document changed during recording; start a new recording.",
      );
      this.unhookRecorder();
      this.unhookRecorder = null;
    }
    let unhookCommands: (() => void) | null = null;
    const syncRecordingSubscription = () => {
      const observing = this.recorder.isRecording() || this.recorder.isPaused();
      if (!observing) { unhookCommands?.(); unhookCommands = null; return; }
      if (unhookCommands) return;
      unhookCommands = doc.onCommand((command, before, after) => {
        if (
          (this.recorder.isRecording() || this.recorder.isPaused()) &&
          JSON.stringify(before) === JSON.stringify(after)
        )
          return;
        this.recorder.setSelectedId(doc.selectedLayer?.id ?? null);
        if (this.recorder.isRecording()) this.captureRecordingSources(doc);
        this.recorder.recordCommand(command, before, after);
      });
    };
    const unhookState = this.recorder.subscribe(syncRecordingSubscription);
    syncRecordingSubscription();
    const unhookHistory = doc.onHistoryNavigation((direction) =>
      this.recorder.navigateHistory(direction),
    );
    this.unhookRecorder = () => {
      unhookState();
      unhookCommands?.();
      unhookHistory();
    };
  }

  getPresets(): Recipe[] {
    return structuredClone(BUILTIN_PRESETS);
  }

  getCustomRecipes(): Recipe[] {
    return this.storage.list();
  }

  getAllRecipes(): Recipe[] {
    return [...this.getPresets(), ...this.getCustomRecipes()];
  }

  getRecipe(id: string): Recipe | undefined {
    return this.getAllRecipes().find((r) => r.id === id);
  }

  async saveRecipe(recipe: Recipe): Promise<void> {
    await this.storage.save(recipe);
  }

  async deleteRecipe(id: string): Promise<boolean> {
    return this.storage.delete(id);
  }

  async executeSavedPackage(
    id: string,
    params: Record<string, unknown> = {},
  ): Promise<ExecuteRecipeResult> {
    const document = this.editor.document;
    const assertTargetAvailable = this.captureTargetGuard(document);
    const revision = document.getSnapshot().revision;
    const selectedId = document.selectedLayer?.id ?? null;
    const supplied = structuredClone(params);
    const file = await this.packages.get(id);
    assertTargetAvailable();
    if (!file) throw new Error("Recipe package not found.");
    if (
      this.editor.document !== document ||
      document.getSnapshot().revision !== revision
    ) {
      throw new Error(
        "Document changed while loading the saved recipe package.",
      );
    }
    if ((document.selectedLayer?.id ?? null) !== selectedId) {
      throw new Error(
        "Layer selection changed while loading the saved recipe package. Review the target and retry.",
      );
    }
    return executeRecipePackage(
      file,
      document,
      supplied,
      assertTargetAvailable,
    );
  }

  exportRecipePackage(recipe: Recipe): Promise<Blob> {
    return serializeRecipePackage(recipe, this.editor.assetStore);
  }

  executeRecipePackage(
    file: Blob,
    params: Record<string, unknown> = {},
  ): Promise<ExecuteRecipeResult> {
    const document = this.editor.document;
    return executeRecipePackage(
      file,
      document,
      params,
      this.captureTargetGuard(document),
    );
  }

  exportRecipeJson(recipe: Recipe): string {
    return this.storage.exportJson(recipe);
  }

  async importRecipeJson(jsonStr: string): Promise<Recipe> {
    return this.storage.importJson(jsonStr);
  }

  compilePlan(recipe: Recipe, params: Record<string, unknown> = {}): EditPlan {
    const doc = this.editor.document;
    return compileEditPlan(
      recipe,
      doc.toJSON(),
      doc.selectedLayer?.id ?? null,
      params,
      new Set(this.editor.assetStore.values().map((asset) => asset.id)),
    );
  }

  execute(
    recipe: Recipe,
    params: Record<string, unknown> = {},
  ): ExecuteRecipeResult {
    return executeRecipe(recipe, this.editor.document, params);
  }

  startRecording(): void {
    if (this.unsavedRecording)
      throw new Error(
        "Save the pending recording before starting another recording.",
      );
    this.recordingSources.clear();
    this.captureRecordingSources(this.editor.document);
    this.recorder.start(this.editor.document.selectedLayer?.id ?? null);
  }

  pauseRecording(): void {
    this.recorder.pause();
  }

  resumeRecording(): void {
    this.recorder.resume();
  }

  async stopRecording(options: RecorderOptions = {}): Promise<Recipe> {
    this.unsavedRecording = this.recorder.stop(options);
    return this.savePendingRecording();
  }

  dispose(): void {
    this.disposed = true;
    this.targetGeneration++;
    this.recordingSources.clear();
    if (this.unhookRecorder) {
      this.unhookRecorder();
      this.unhookRecorder = null;
    }
  }
}
