import { ToolController } from "./tools";
import { AssetStore } from "./core/assets";
import { loadProject, serializeProject } from "./core/project";
import { Document, LayerGroup, RasterLayer } from "./dom";
import { createDemo } from "./demo";
import { AdaptiveRenderer } from "./engine/adaptive";
import { exportPng } from "./engine/png";
import { ScriptRunner } from "./scripting/runner";
import { execute } from "./core/commands";
import { referencedAssets } from "./core/model";
import { PluginRegistry, browserPluginStorage } from "./plugins";

/** Application services own assets and I/O; the DOM itself is browser-independent. */
export class EditorApplication {
  readonly renderer = new AdaptiveRenderer();
  readonly scripts = new ScriptRunner();
  readonly tools = new ToolController(this);
  readonly plugins = new PluginRegistry(browserPluginStorage());
  private activeDocument = new Document();
  private assets = new AssetStore();
  private listeners = new Set<() => void>();
  private unsubscribe = () => {};
  private snapshot = this.makeSnapshot();

  constructor() {
    this.observe();
  }
  get document() {
    return this.activeDocument;
  }
  get assetStore() {
    return this.assets;
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
    };
  }
  private publish = () => {
    this.snapshot = this.makeSnapshot();
    this.listeners.forEach((listener) => listener());
  };
  private observe() {
    this.unsubscribe();
    this.unsubscribe = this.activeDocument.subscribe(this.publish);
    this.publish();
  }

  private replace(document: Document, assets: AssetStore) {
    this.tools.reset();
    const previous = this.assets;
    this.activeDocument = document;
    this.assets = assets;
    this.renderer.clearCache();
    this.observe();
    if (previous !== assets) previous.dispose();
  }

  newDocument(
    options: { name?: string; width?: number; height?: number } = {},
  ) {
    this.replace(new Document(options), new AssetStore());
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
    if (this.document !== documentAtStart || this.assets !== assetsAtStart)
      throw new Error("The document changed during import. Try again.");
    if (this.document.layers.length === 0) {
      this.replace(
        new Document({
          name: file.name.replace(/\.[^.]+$/, "").slice(0, 240) || "Untitled",
          width: asset.width,
          height: asset.height,
        }),
        this.assets,
      );
    }
    const factor = Math.min(
      1,
      this.document.width / asset.width,
      this.document.height / asset.height,
    );
    const layer = new RasterLayer({
      name: file.name.slice(0, 240),
      assetId: asset.id,
      width: asset.width * factor,
      height: asset.height * factor,
      x: (this.document.width - asset.width * factor) / 2,
      y: (this.document.height - asset.height * factor) / 2,
    });
    const selected = this.document.selectedLayer;
    (selected instanceof LayerGroup
      ? selected.layers
      : this.document.layers
    ).add(layer);
    this.document.selectedLayer = layer;
    return layer;
  }

  saveProject(): Blob {
    return new Blob([serializeProject(this.document.toJSON(), this.assets)], {
      type: "application/json",
    });
  }

  async openProject(file: File) {
    const loaded = await loadProject(await file.text());
    this.replace(Document.fromJSON(loaded.document), loaded.assets);
  }

  async exportPng(): Promise<Blob> {
    return exportPng(this.document.toJSON(), this.assets, this.renderer);
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
    return this.executeScript(
      command.source,
      `${plugin.name}: ${command.title}`.slice(0, 240),
      !plugin.permissions.includes("document:write"),
    );
  }

  private async executeScript(code: string, label: string, readOnly = false) {
    const document = this.document;
    const revision = document.getSnapshot().revision;
    const selectedId = document.selectedLayer?.id ?? null;
    const result = await this.scripts.run(document, code);
    if (
      this.document !== document ||
      document.getSnapshot().revision !== revision
    )
      throw new Error(
        "The document changed while the script ran. No script edits were applied.",
      );
    if (
      readOnly &&
      (result.commands.length > 0 || result.selectedId !== selectedId)
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
    for (const assetId of referencedAssets(next)) this.assets.get(assetId);
    document._dispatch(command);
    document.selectedLayer = document.getLayer(result.selectedId);
    return result.logs;
  }

  dispose() {
    this.tools.cancel();
    this.scripts.cancel();
    this.unsubscribe();
    this.renderer.dispose();
    this.assets.dispose();
    this.listeners.clear();
  }
}
