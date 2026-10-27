import { checkRenderCurrent } from "./render-control";
import type { AssetStore } from "../core/assets";
import type { DocumentData } from "../core/model";
import { CanvasRenderer } from "./renderer";
import type { RenderOptions } from "./renderer";
import { release } from "./canvas";
import { WebGpuRenderer } from "./gpu/renderer";
import type { ViewportFrame } from "./gpu/renderer";

/** CPU export/reference API stays stable; viewport frames select GPU capability. */
import {IccProofProcessor} from './icc-proof';

export class AdaptiveRenderer extends CanvasRenderer {
  private readonly proof = new IccProofProcessor();
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
    checkRenderCurrent(options.isCancelled);
    if(options.colorProof)return this.prepareFallback(document,assets,options);
    this.proof.reset();
    try {
      const gpu = await this.gpu.prepare(document, assets, options);
      if (options.isCancelled?.()) {
        gpu?.dispose();
        checkRenderCurrent(options.isCancelled);
      }
      if (gpu) return gpu;
    } catch {
      checkRenderCurrent(options.isCancelled);
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
    try{if(options.colorProof)await this.proof.apply(result,options.colorProof,options.isCancelled);checkRenderCurrent(options.isCancelled);}
    catch(error){release(result);throw error;}
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
  override resetView() {
    this.proof.reset();
    super.resetView();
    this.gpu.clearCache();
  }
  override dispose() {
    this.proof.reset();
    this.gpu.dispose();
    super.dispose();
  }
}
