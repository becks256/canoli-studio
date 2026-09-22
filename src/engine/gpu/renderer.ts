import type { AssetStore } from "../../core/assets";
import { BLEND_MODES } from "../../core/model";
import type { DocumentData, LayerData, PaintLayerData } from "../../core/model";
import { defaultStyle } from "../../core/drawing";
import type {
  BrushStrokeData,
  SelectionData,
  StrokePoint,
} from "../../core/drawing";
import { release } from "../canvas";
import type { RenderSpace } from "../canvas";
import { visitStrokeStamps } from "../drawing";
import { workingSize } from "../renderer";
import type { CanvasRenderer, RenderOptions } from "../renderer";
import { processing, selection, stamps } from "./shaders";

interface Surface {
  texture: GPUTexture;
  width: number;
  height: number;
  bytes: number;
}
interface Cached {
  signature: string;
  surface: Surface;
}
export interface ViewportFrame {
  readonly backend: "webgpu" | "canvas2d";
  readonly width: number;
  readonly height: number;
  /** Called only after the UI has checked the document/view generation. */
  present(canvas: HTMLCanvasElement): void;
  dispose(): void;
  /** Explicit diagnostic readback, never used by viewport presentation. Premultiplied RGBA8. */
  readPixels?(): Promise<Uint8Array>;
}

/** GPU viewport only. Export retains the source-resolution Canvas/WASM path.
 * Source regions, never complete imported images, become GPU textures. */
export class WebGpuRenderer {
  readonly ready: Promise<boolean>;
  private device: GPUDevice | null = null;
  private pipeline!: GPURenderPipeline;
  private stampPipeline!: GPURenderPipeline;
  private maskPipeline!: GPURenderPipeline;
  private presentation = new Map<GPUTextureFormat, GPURenderPipeline>();
  private contexts = new WeakSet<GPUCanvasContext>();
  private cache = new Map<string, Cached>();
  private cacheBytes = 0;
  private live = new Set<Surface>();
  private bytes = 0;
  private owned = new Set<Surface>();
  private pinned = new Set<Surface>();
  private epoch = 0;
  private rendering = false;
  private disposed = false;
  private serial: Promise<unknown> = Promise.resolve();
  private namespace: DocumentData["id"] | null = null;
  private assets: AssetStore | null = null;
  private signatures = new WeakMap<LayerData, string>();
  private active: {
    signature: string;
    points: StrokePoint[];
    surface: Surface;
  } | null = null;
  private state = "initializing";
  private reason = "";
  private counters = {
    uploads: 0,
    stamps: 0,
    cacheHits: 0,
    frames: 0,
    readbacks: 0,
  };
  onUnavailable = () => {};
  // Allocation budgets, NOT document dimension or import limits.
  private readonly cacheBudget = 64 * 1024 * 1024;
  private readonly workingBudget = 192 * 1024 * 1024;
  constructor(
    private fallback: CanvasRenderer,
    options: { allowSoftwareAdapter?: boolean } = {},
  ) {
    this.ready = this.initialize(options.allowSoftwareAdapter ?? false).then(
      (ready) => {
        this.onUnavailable();
        return ready;
      },
    );
  }
  get diagnostics() {
    return {
      state: this.state,
      reason: this.reason,
      ...this.counters,
      retainedBytes: this.cacheBytes + (this.active?.surface.bytes ?? 0),
      allocatedBytes: this.bytes,
    };
  }
  private async initialize(allowSoftware: boolean) {
    try {
      if (!navigator.gpu) {
        this.state = "unavailable";
        return false;
      }
      const adapter = await navigator.gpu.requestAdapter({
        powerPreference: "high-performance",
      });
      if (!adapter) {
        this.state = "unavailable";
        return false;
      }
      if (adapter.info.isFallbackAdapter && !allowSoftware) {
        this.state = "software-adapter";
        return false;
      }
      const device = await adapter.requestDevice();
      if (this.disposed) {
        device.destroy();
        return false;
      }
      this.device = device;
      device.lost.then(() => {
        if (this.device === device) {
          this.state = "device-lost";
          this.device = null;
          this.clearCache();
          this.onUnavailable();
        }
      });
      device.addEventListener("uncapturederror", () => {
        this.state = "gpu-error";
        this.device = null;
        this.clearCache();
        device.destroy();
        this.onUnavailable();
      });
      device.pushErrorScope("validation");
      const module = device.createShaderModule({ code: processing });
      this.pipeline = await device.createRenderPipelineAsync({
        layout: "auto",
        vertex: { module, entryPoint: "vertex" },
        fragment: {
          module,
          entryPoint: "fragment",
          targets: [{ format: "rgba8unorm" }],
        },
      });
      const stampModule = device.createShaderModule({ code: stamps });
      this.stampPipeline = await device.createRenderPipelineAsync({
        layout: "auto",
        vertex: {
          module: stampModule,
          entryPoint: "vertex",
          buffers: [
            {
              arrayStride: 16,
              stepMode: "instance",
              attributes: [
                { shaderLocation: 0, offset: 0, format: "float32x4" },
              ],
            },
          ],
        },
        fragment: {
          module: stampModule,
          entryPoint: "fragment",
          targets: [
            {
              format: "rgba8unorm",
              blend: {
                color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
                alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
              },
            },
          ],
        },
      });
      const maskModule = device.createShaderModule({ code: selection });
      this.maskPipeline = await device.createRenderPipelineAsync({
        layout: "auto",
        vertex: { module: maskModule, entryPoint: "vertex" },
        fragment: {
          module: maskModule,
          entryPoint: "fragment",
          targets: [{ format: "rgba8unorm" }],
        },
      });
      const error = await device.popErrorScope();
      if (error) throw new Error(error.message);
      if (this.device !== device || this.disposed) return false;
      this.state = "ready";
      return true;
    } catch (error) {
      this.reason = error instanceof Error ? error.message : String(error);
      this.state = "initialization-failed";
      this.device?.destroy();
      this.device = null;
      return false;
    }
  }
  private make(width: number, height: number): Surface {
    const device = this.device!;
    const bytes = width * height * 4;
    if (
      width > device.limits.maxTextureDimension2D ||
      height > device.limits.maxTextureDimension2D ||
      this.bytes + bytes > this.workingBudget
    )
      throw new Error("GPU working-buffer budget exceeded.");
    const surface = {
      width,
      height,
      bytes,
      texture: device.createTexture({
        size: [width, height],
        format: "rgba8unorm",
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.RENDER_ATTACHMENT |
          GPUTextureUsage.COPY_SRC |
          GPUTextureUsage.COPY_DST,
      }),
    };
    this.live.add(surface);
    this.owned.add(surface);
    this.bytes += bytes;
    return surface;
  }
  private destroy(surface: Surface) {
    if (!this.live.delete(surface)) return;
    surface.texture.destroy();
    this.bytes -= surface.bytes;
    this.owned.delete(surface);
  }
  private get(key: string, signature: string): Surface | null {
    const entry = this.cache.get(key);
    if (!entry || entry.signature !== signature) return null;
    this.cache.delete(key);
    this.cache.set(key, entry);
    this.pinned.add(entry.surface);
    this.counters.cacheHits++;
    return entry.surface;
  }
  private retain(key: string, signature: string, surface: Surface) {
    const old = this.cache.get(key);
    if (old) {
      this.cache.delete(key);
      this.cacheBytes -= old.surface.bytes;
      if (this.pinned.has(old.surface)) this.owned.add(old.surface);
      else this.destroy(old.surface);
    }
    for (const [id, entry] of this.cache) {
      if (
        this.cacheBytes + surface.bytes <= this.cacheBudget &&
        this.cache.size < 64
      )
        break;
      if (this.pinned.has(entry.surface)) continue;
      this.cache.delete(id);
      this.cacheBytes -= entry.surface.bytes;
      this.destroy(entry.surface);
    }
    if (
      this.cacheBytes + surface.bytes > this.cacheBudget ||
      this.cache.size >= 64
    )
      return;
    this.cache.set(key, { signature, surface });
    this.cacheBytes += surface.bytes;
    this.owned.delete(surface);
    this.pinned.add(surface);
  }
  private upload(canvas: HTMLCanvasElement): Surface {
    const result = this.make(canvas.width, canvas.height);
    this.device!.queue.copyExternalImageToTexture(
      { source: canvas },
      { texture: result.texture, premultipliedAlpha: true, colorSpace: "srgb" },
      [canvas.width, canvas.height],
    );
    this.counters.uploads++;
    return result;
  }
  private buffer(
    data: Float32Array | Uint32Array,
    usage: number = GPUBufferUsage.UNIFORM,
  ): GPUBuffer {
    const result = this.device!.createBuffer({
      size: Math.max(32, data.byteLength),
      usage: usage | GPUBufferUsage.COPY_DST,
    });
    this.device!.queue.writeBuffer(
      result,
      0,
      data as Float32Array<ArrayBuffer>,
    );
    return result;
  }
  private pass(
    source: Surface,
    backdrop: Surface,
    values: number[],
    target?: GPUTexture,
    pipeline = this.pipeline,
  ): Surface | null {
    const device = this.device!;
    const result = target ? null : this.make(source.width, source.height);
    const params = new Float32Array(20);
    params.set(values);
    const uniform = this.buffer(params);
    const bind = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: source.texture.createView() },
        { binding: 1, resource: backdrop.texture.createView() },
        { binding: 2, resource: { buffer: uniform } },
      ],
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: (target ?? result!.texture).createView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: [0, 0, 0, 0],
        },
      ],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bind);
    pass.draw(3);
    pass.end();
    device.queue.submit([encoder.finish()]);
    uniform.destroy();
    return result;
  }
  private signature(layer: LayerData) {
    const existing = this.signatures.get(layer);
    if (existing) return existing;
    const value = JSON.stringify(layer);
    if (Object.isFrozen(layer)) this.signatures.set(layer, value);
    return value;
  }
  private mask(clip: SelectionData, space: RenderSpace, x: number, y: number) {
    const signature = JSON.stringify([clip, space, x, y]);
    const cached = this.get("selection", signature);
    if (cached) return cached;
    const values = new Float32Array(Math.max(8, clip.regions.length * 8));
    clip.regions.forEach((r, i) => {
      const rect = [
        (r.x + x - space.x) * space.sx,
        (r.y + y - space.y) * space.sy,
        r.width * space.sx,
        r.height * space.sy,
      ];
      if (rect.some((n) => Math.abs(n) > 1e7))
        throw new Error("Selection requires double-precision fallback.");
      values.set(
        [
          ...rect,
          r.shape === "ellipse" ? 1 : 0,
          r.operation === "subtract" ? 1 : r.operation === "intersect" ? 2 : 0,
          0,
          0,
        ],
        i * 8,
      );
    });
    const storage = this.buffer(values, GPUBufferUsage.STORAGE),
      uniform = this.buffer(
        new Uint32Array([clip.regions.length, 0, 0, 0, 0, 0, 0, 0]),
      );
    const result = this.make(space.width, space.height),
      device = this.device!;
    const group = device.createBindGroup({
      layout: this.maskPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: storage } },
        { binding: 1, resource: { buffer: uniform } },
      ],
    });
    const encoder = device.createCommandEncoder(),
      pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: result.texture.createView(),
            loadOp: "clear",
            storeOp: "store",
            clearValue: [0, 0, 0, 0],
          },
        ],
      });
    pass.setPipeline(this.maskPipeline);
    pass.setBindGroup(0, group);
    pass.draw(3);
    pass.end();
    device.queue.submit([encoder.finish()]);
    storage.destroy();
    uniform.destroy();
    this.retain("selection", signature, result);
    return result;
  }
  private drawStamps(
    stroke: BrushStrokeData,
    surface: Surface,
    space: RenderSpace,
    x: number,
    y: number,
    from: number,
  ) {
    const device = this.device!,
      color = this.color(stroke.color);
    const uniform = this.buffer(
      new Float32Array([
        space.width,
        space.height,
        stroke.hardness,
        stroke.kind === "pencil" ? 1 : 0,
        ...color,
        1,
      ]),
    );
    const group = device.createBindGroup({
      layout: this.stampPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: uniform } }],
    });
    let values: number[] = [];
    const flush = () => {
      if (!values.length) return;
      const instances = this.buffer(
        new Float32Array(values),
        GPUBufferUsage.VERTEX,
      );
      const encoder = device.createCommandEncoder(),
        pass = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: surface.texture.createView(),
              loadOp: "load",
              storeOp: "store",
            },
          ],
        });
      pass.setPipeline(this.stampPipeline);
      pass.setBindGroup(0, group);
      pass.setVertexBuffer(0, instances);
      pass.draw(6, values.length / 4);
      pass.end();
      device.queue.submit([encoder.finish()]);
      instances.destroy();
      this.counters.stamps += values.length / 4;
      values = [];
    };
    visitStrokeStamps(
      (p) => {
        let size = stroke.size * Math.max(0.05, p.pressure),
          cx = p.x,
          cy = p.y;
        if (stroke.kind === "pencil") {
          size = Math.max(1, Math.round(size));
          cx = Math.floor(cx - size / 2) + size / 2;
          cy = Math.floor(cy - size / 2) + size / 2;
        }
        values.push(
          (cx + x - space.x) * space.sx,
          (cy + y - space.y) * space.sy,
          (size * space.sx) / 2,
          (size * space.sy) / 2,
        );
        if (values.length >= 4096 * 4) flush();
      },
      stroke,
      {
        x: space.x - x,
        y: space.y - y,
        width: space.width / space.sx,
        height: space.height / space.sy,
      },
      from,
    );
    flush();
    uniform.destroy();
  }
  private color(value: string) {
    return [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  }
  private stroke(
    stroke: BrushStrokeData,
    space: RenderSpace,
    x: number,
    y: number,
    incremental: boolean,
  ) {
    const { points, ...settings } = stroke;
    const signature = JSON.stringify([settings, space, x, y]);
    const previous = incremental ? this.active : null;
    const reuse =
      previous &&
      previous.signature === signature &&
      previous.points.length <= points.length &&
      previous.points.every(
        (p, i) =>
          p === points[i] ||
          (p.x === points[i].x &&
            p.y === points[i].y &&
            p.pressure === points[i].pressure),
      );
    if (incremental && !reuse && this.active) {
      this.destroy(this.active.surface);
      this.active = null;
    }
    const raw = reuse ? previous.surface : this.make(space.width, space.height);
    this.drawStamps(
      stroke,
      raw,
      space,
      x,
      y,
      reuse ? previous.points.length : 0,
    );
    if (incremental && raw.bytes <= 16 * 1024 * 1024) {
      this.active = { signature, points, surface: raw };
      this.owned.delete(raw);
    }
    if (!stroke.clip) return raw;
    return this.pass(raw, this.mask(stroke.clip, space, x, y), [3])!;
  }
  private async paintLayer(
    layer: PaintLayerData,
    doc: DocumentData,
    assets: AssetStore,
    space: RenderSpace,
    x: number,
    y: number,
  ) {
    let content = this.make(space.width, space.height);
    for (const stroke of layer.strokes) {
      const previousOwned = new Set(this.owned);
      let source: Surface;
      if (stroke.kind === "brush" || stroke.kind === "pencil")
        source = this.stroke(stroke, space, x, y, false);
      else {
        // Clone/fill retain the reference rasterization, uploaded once per change.
        source = await this.reference(
          {
            ...layer,
            strokes: [
              stroke.kind === "fill"
                ? { ...stroke, opacity: 1, erase: false }
                : { ...stroke, opacity: 1 },
            ],
          },
          doc,
          assets,
          space,
          x,
          y,
        );
      }
      const result = this.pass(source, content, [
        0,
        stroke.opacity,
        stroke.kind === "fill" && stroke.erase ? 16 : 0,
      ])!;
      this.destroy(content);
      content = result;
      if (this.owned.has(source)) this.destroy(source);
      // Release scratch masks/stroke surfaces not retained for later frames.
      for (const surface of this.owned)
        if (surface !== content && !previousOwned.has(surface))
          this.destroy(surface);
    }
    return content;
  }
  private async reference(
    layer: LayerData,
    doc: DocumentData,
    assets: AssetStore,
    space: RenderSpace,
    x: number,
    y: number,
  ) {
    const neutral = {
      ...layer,
      x,
      y,
      opacity: 1,
      fillOpacity: 1,
      styles: defaultStyle(),
      blendMode: "normal" as const,
      visible: true,
    };
    // Working dimensions were already floored independently. Leave rounding
    // headroom in the allocation hints so the reference pass does not rescale
    // them a second time (e.g. 135x97 at 75% zoom becoming 134x97).
    const canvas = await this.fallback.render(
      { ...doc, children: [neutral] },
      assets,
      {
        cache: false,
        region: {
          x: space.x,
          y: space.y,
          width: space.width / space.sx,
          height: space.height / space.sy,
        },
        maxPixels: (space.width + 1) * (space.height + 1),
        maxDimension: Math.max(space.width, space.height) + 1,
        scale: Math.max(space.sx, space.sy),
      },
    );
    try {
      if (canvas.width !== space.width || canvas.height !== space.height)
        throw new Error("Reference grid requires Canvas fallback.");
      return this.upload(canvas);
    } finally {
      release(canvas);
    }
  }
  private preciseStroke(stroke: BrushStrokeData, scale: number) {
    // A fixed sampling grid must not silently drop subpixel brush marks.
    // Pixel-aligned pencil coverage is analytic and does not need this fallback.
    return (
      stroke.kind !== "brush" ||
      stroke.points.every(
        (point) => stroke.size * Math.max(0.05, point.pressure) * scale >= 2,
      )
    );
  }
  private supported(nodes: LayerData[], scale: number): boolean {
    return nodes.every(
      (node) =>
        !node.visible ||
        node.opacity === 0 ||
        (!node.styles?.dropShadow.enabled &&
          (node.kind !== "group" || this.supported(node.children, scale)) &&
          (node.kind !== "paint" ||
            node.strokes.every(
              (stroke) =>
                stroke.kind === "fill" || this.preciseStroke(stroke, scale),
            ))),
    );
  }
  prepare(
    document: DocumentData,
    assets: AssetStore,
    options: RenderOptions = {},
  ): Promise<ViewportFrame | null> {
    const task = this.serial.then(() =>
      this.prepareSerial(document, assets, options),
    );
    this.serial = task.catch(() => {});
    return task;
  }
  private async prepareSerial(
    document: DocumentData,
    assets: AssetStore,
    options: RenderOptions,
  ): Promise<ViewportFrame | null> {
    if (!(await this.ready) || !this.device || this.disposed) return null;
    if (this.namespace !== document.id || this.assets !== assets) {
      this.clearCache();
      this.namespace = document.id;
      this.assets = assets;
    }
    if (!options.paintPreview && this.active) {
      this.destroy(this.active.surface);
      this.active = null;
    }
    const region = options.region ?? {
      x: 0,
      y: 0,
      width: document.width,
      height: document.height,
    };
    const size = workingSize(
      region.width,
      region.height,
      options.scale,
      options.maxPixels,
      options.maxDimension,
    );
    const space: RenderSpace = {
      x: region.x,
      y: region.y,
      ...size,
      sx: size.width / region.width,
      sy: size.height / region.height,
    };
    const scale = Math.min(space.sx, space.sy);
    if (
      !this.supported(document.children, scale) ||
      (options.paintPreview &&
        !this.preciseStroke(options.paintPreview.stroke, scale))
    )
      return null;
    const epoch = this.epoch,
      device = this.device;
    this.rendering = true;
    this.owned = new Set();
    this.pinned.clear();
    device.pushErrorScope("out-of-memory");
    device.pushErrorScope("validation");
    const check = () => {
      if (epoch !== this.epoch || this.device !== device || this.disposed)
        throw new Error("Obsolete GPU frame.");
    };
    const compose = async (
      nodes: LayerData[],
      ox: number,
      oy: number,
    ): Promise<Surface> => {
      let target = this.make(size.width, size.height);
      for (const layer of nodes) {
        if (!layer.visible || layer.opacity === 0) continue;
        check();
        const x = ox + layer.x,
          y = oy + layer.y;
        const location = JSON.stringify([space, x, y]);
        let source: Surface;
        if (layer.kind === "group")
          source = await compose(layer.children, x, y);
        else {
          const signature =
            layer.kind === "raster"
              ? JSON.stringify([
                  layer.assetId,
                  layer.width,
                  layer.height,
                  location,
                ])
              : this.signature(layer) + location;
          source = this.get(layer.id, signature)!;
          if (!source) {
            if (layer.kind === "raster")
              source = await this.reference(
                { ...layer, effects: [] },
                document,
                assets,
                space,
                x,
                y,
              );
            else if (layer.kind === "paint")
              source = await this.paintLayer(
                layer,
                document,
                assets,
                space,
                x,
                y,
              );
            else
              source = await this.reference(
                layer,
                document,
                assets,
                space,
                x,
                y,
              );
            check();
            this.retain(layer.id, signature, source);
          }
          if (layer.kind === "raster") {
            for (const effect of layer.effects) {
              if (
                !effect.enabled ||
                (!effect.exposure && !effect.contrast && !effect.saturation)
              )
                continue;
              const next = this.pass(source, source, [
                1,
                2 ** effect.exposure,
                2 ** (effect.contrast / 100),
                1 + effect.saturation / 100,
              ])!;
              if (this.owned.has(source)) this.destroy(source);
              source = next;
            }
          }
          if (
            layer.kind === "paint" &&
            layer.id === options.paintPreview?.layerId
          ) {
            const stroke = options.paintPreview.stroke;
            if (stroke.kind === "clone")
              throw new Error("Clone preview uses the reference renderer.");
            const overlay = this.stroke(stroke, space, x, y, true);
            const combined = this.pass(overlay, source, [
              0,
              stroke.opacity,
              0,
            ])!;
            if (this.owned.has(source)) this.destroy(source);
            if (this.owned.has(overlay)) this.destroy(overlay);
            source = combined;
          }
        }
        check();
        const style = layer.styles ?? defaultStyle();
        if ((layer.fillOpacity ?? 1) !== 1 || style.colorOverlay.enabled) {
          const next = this.pass(source, source, [
            2,
            layer.fillOpacity ?? 1,
            style.colorOverlay.enabled ? style.colorOverlay.opacity : 0,
            0,
            ...this.color(style.colorOverlay.color),
            0,
          ])!;
          if (this.owned.has(source)) this.destroy(source);
          source = next;
        }
        const blend = style.blendIf;
        const result = this.pass(source, target, [
          0,
          layer.opacity,
          BLEND_MODES.indexOf(layer.blendMode),
          0,
          0,
          blend.enabled ? 1 : 0,
          ["red", "green", "blue"].indexOf(blend.channel),
          0,
          ...blend.source,
          ...blend.underlying,
        ])!;
        this.destroy(target);
        if (this.owned.has(source)) this.destroy(source);
        target = result;
      }
      return target;
    };
    let output: Surface | null = null,
      failed = false;
    try {
      output = await compose(document.children, 0, 0);
      check();
    } catch (error) {
      failed = true;
      this.reason = error instanceof Error ? error.message : String(error);
    }
    let validation: GPUError | null = null;
    try {
      validation = await device.popErrorScope();
      const memory = await device.popErrorScope();
      if (validation || memory) {
        failed = true;
        this.reason = (validation ?? memory)!.message;
      }
    } catch (error) {
      failed = true;
      this.reason = error instanceof Error ? error.message : String(error);
    }
    this.rendering = false;
    this.pinned.clear();
    if (failed || epoch !== this.epoch || this.device !== device) {
      for (const surface of this.owned) this.destroy(surface);
      this.clearNow();
      if (validation) {
        this.state = "gpu-error";
        this.device = null;
        device.destroy();
        this.onUnavailable();
      }
      return null;
    }
    const final = output!;
    this.owned.delete(final);
    for (const surface of this.owned) this.destroy(surface);
    this.counters.frames++;
    let disposed = false;
    return {
      backend: "webgpu",
      width: size.width,
      height: size.height,
      present: (canvas) => {
        if (disposed || this.device !== device || epoch !== this.epoch)
          throw new Error("Obsolete GPU frame.");
        const context = canvas.getContext("webgpu");
        if (!context) throw new Error("WebGPU canvas unavailable.");
        if (canvas.width !== size.width || canvas.height !== size.height) {
          canvas.width = size.width;
          canvas.height = size.height;
        }
        const format = navigator.gpu.getPreferredCanvasFormat();
        if (!this.contexts.has(context)) {
          context.configure({
            device,
            format,
            alphaMode: "premultiplied",
            colorSpace: "srgb",
          });
          this.contexts.add(context);
        }
        let pipeline = this.presentation.get(format);
        if (!pipeline) {
          const module = device.createShaderModule({ code: processing });
          pipeline = device.createRenderPipeline({
            layout: "auto",
            vertex: { module, entryPoint: "vertex" },
            fragment: { module, entryPoint: "fragment", targets: [{ format }] },
          });
          this.presentation.set(format, pipeline);
        }
        this.pass(final, final, [4], context.getCurrentTexture(), pipeline);
      },
      dispose: () => {
        if (!disposed) {
          disposed = true;
          this.destroy(final);
        }
      },
      readPixels: async () => {
        if (disposed || this.device !== device)
          throw new Error("GPU frame unavailable.");
        const stride = Math.ceil((size.width * 4) / 256) * 256;
        const buffer = device.createBuffer({
          size: stride * size.height,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        try {
          const encoder = device.createCommandEncoder();
          encoder.copyTextureToBuffer(
            { texture: final.texture },
            { buffer, bytesPerRow: stride },
            [size.width, size.height],
          );
          device.queue.submit([encoder.finish()]);
          this.counters.readbacks++;
          await buffer.mapAsync(GPUMapMode.READ);
          const data = new Uint8Array(buffer.getMappedRange()),
            result = new Uint8Array(size.width * size.height * 4);
          for (let row = 0; row < size.height; row++)
            result.set(
              data.subarray(row * stride, row * stride + size.width * 4),
              row * size.width * 4,
            );
          return result;
        } finally {
          buffer.destroy();
        }
      },
    };
  }
  clearCache() {
    this.epoch++;
    if (this.rendering) return;
    this.clearNow();
  }
  private clearNow() {
    for (const entry of this.cache.values()) this.destroy(entry.surface);
    this.cache.clear();
    this.cacheBytes = 0;
    if (this.active) this.destroy(this.active.surface);
    this.active = null;
    this.signatures = new WeakMap();
  }
  dispose() {
    this.disposed = true;
    this.clearCache();
    for (const surface of this.live) this.destroy(surface);
    this.device?.destroy();
    this.device = null;
  }
}
