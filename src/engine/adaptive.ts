import type { AssetStore } from "../core/assets";
import type { DocumentData } from "../core/model";
import { CanvasRenderer } from "./renderer";
import type { RenderOptions } from "./renderer";
import { release } from "./canvas";
import { WebGpuRenderer } from "./gpu/renderer";
import type { ViewportFrame } from "./gpu/renderer";

/** CPU export/reference API stays stable; viewport frames select GPU capability. */
export class AdaptiveRenderer extends CanvasRenderer {
  readonly gpu: WebGpuRenderer;
  private listeners = new Set<() => void>();
  subscribeBackend = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getBackendSnapshot = () => this.gpu.diagnostics.state;
  constructor(options: { allowSoftwareAdapter?: boolean } = {}) {
    super();
    this.gpu = new WebGpuRenderer(this, options);
    this.gpu.onUnavailable = () =>
      this.listeners.forEach((listener) => listener());
  }
  async prepareViewport(
    document: DocumentData,
    assets: AssetStore,
    options: RenderOptions = {},
  ): Promise<ViewportFrame> {
    try {
      const gpu = await this.gpu.prepare(document, assets, options);
      if (gpu) return gpu;
    } catch {
      // Device loss, failed context creation and driver errors are recoverable.
      this.gpu.clearCache();
    }
    return this.prepareFallback(document, assets, options);
  }
  async prepareFallback(
    document: DocumentData,
    assets: AssetStore,
    options: RenderOptions = {},
  ): Promise<ViewportFrame> {
    const result = await this.render(document, assets, options);
    return {
      backend: "canvas2d",
      width: result.width,
      height: result.height,
      present(canvas) {
        canvas.width = result.width;
        canvas.height = result.height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas drawing context unavailable.");
        context.drawImage(result, 0, 0);
      },
      dispose() {
        release(result);
      },
    };
  }
  override clearCache() {
    super.clearCache();
    this.gpu.clearCache();
  }
  override dispose() {
    this.gpu.dispose();
    super.dispose();
  }
}
