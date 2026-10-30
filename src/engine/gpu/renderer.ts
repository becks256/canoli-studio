import{isFloatDocument}from'../../core/float-document';
import {activePerspective} from '../../core/perspective';
import {hasMaskRefinements} from '../../core/masks';
import {symmetryMatrices} from '../../core/brush-symmetry';
import {paintStampSize,paintStampAlpha,paintStampGeometry,sameStrokePoint} from '../../core/paint-stamps';
import { lutValues, type CubeLutData } from "../../core/lut";
import { isImmutable } from "../../core/immutable";
import { whiteBalanceMatrix, WHITE_BALANCE_NEUTRAL } from "../../core/white-balance";
import { checkRenderCurrent } from "../render-control";
import { contentSignature } from "../content-signature";
import { findLayer } from "../../core/model";
import { AffineTransform } from "../../core/affine";
import { localTransform } from "../../core/spatial";
import { maskTransform, maskGeometry } from "../../core/masks";
import type { AssetStore } from "../../core/assets";
import { BLEND_MODES } from "../../core/model";
import type { DocumentData, LayerData, PaintLayerData } from "../../core/model";
import { defaultStyle, selectionRegionTransform } from "../../core/drawing";
import type {
  BrushStrokeData,
  SelectionData,
  StrokePoint,
} from "../../core/drawing";
import { release, renderTransform } from "../canvas";
import type { RenderSpace } from "../canvas";
import { visitStrokeStamps } from "../drawing";
import type { LayerMaskData } from "../../core/masks";
import { workingSize, previewMask } from "../renderer";
import type { CanvasRenderer, RenderOptions } from "../renderer";
import { processing, selection, stamps, gradientMap, lookup } from "./shaders";
import { packGradientStops } from "../../core/gradient-map";

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
  /** Diagnostic raw texture bytes: premultiplied, encoded-sRGB RGBA8. */
  readPixels?(): Promise<Uint8Array>;
}

/** GPU viewport only. Export retains the source-resolution Canvas/WASM path.
 * Source regions, never complete imported images, become GPU textures. */
export class WebGpuRenderer {
  readonly ready: Promise<boolean>;
  private device: GPUDevice | null = null;
  private pipeline!: GPURenderPipeline;
  private gradientMapPipeline!: GPURenderPipeline;
  private lookupPipeline!: GPURenderPipeline;
  private lookupBuffers = new Map<string, { buffer: GPUBuffer; bytes: number }>();
  private lookupBytes = 0;
  private lookupCompatibility = new WeakMap<CubeLutData, boolean>();
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
      retainedBytes: this.cacheBytes + (this.active?.surface.bytes ?? 0) + this.lookupBytes,
      allocatedBytes: this.bytes + this.lookupBytes,
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
      const gradientModule = device.createShaderModule({ code: gradientMap });
      this.gradientMapPipeline = await device.createRenderPipelineAsync({
        layout: "auto", vertex: { module: gradientModule, entryPoint: "vertex" },
        fragment: { module: gradientModule, entryPoint: "fragment", targets: [{ format: "rgba8unorm" }] },
      });
      const lookupModule = device.createShaderModule({ code: lookup });
      this.lookupPipeline = await device.createRenderPipelineAsync({
        layout: "auto", vertex: { module: lookupModule, entryPoint: "vertex" },
        fragment: { module: lookupModule, entryPoint: "fragment", targets: [{ format: "rgba8unorm" }] },
      });
      const stampModule = device.createShaderModule({ code: stamps });
      this.stampPipeline = await device.createRenderPipelineAsync({
        layout: "auto",
        vertex: {
          module: stampModule,
          entryPoint: "vertex",
          buffers: [
            {
              arrayStride: 36,
              stepMode: "instance",
              attributes: [
                { shaderLocation: 0, offset: 0, format: "float32x4" },
                { shaderLocation: 1, offset: 16, format: "float32" },
                { shaderLocation: 2, offset: 20, format: "float32x4" },
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
    table?: GPUBuffer,
  ): Surface | null {
    const device = this.device!;
    const result = target ? null : this.make(source.width, source.height);
    const params = new Float32Array(Math.max(20, values.length));
    params.set(values);
    const uniform = this.buffer(params);
    const bind = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: source.texture.createView() },
        { binding: 1, resource: backdrop.texture.createView() },
        { binding: 2, resource: { buffer: uniform } },
        ...(table ? [{ binding: 3, resource: { buffer: table } }] : []),
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
  private lookupSupported(lut: CubeLutData): boolean {
    const hit = this.lookupCompatibility.get(lut); if (hit !== undefined) return hit;
    const bytes = 12 * (lut.dimension === 1 ? lut.size : lut.size ** 3);
    const safe = bytes <= 32 * 1024 * 1024 && bytes <= (this.device?.limits.maxStorageBufferBindingSize ?? 0) &&
      lut.domainMin.every((value, c) => Math.fround(value) === value && Math.fround(lut.domainMax[c]) === lut.domainMax[c] &&
        Math.fround(lut.domainMax[c] - value) === lut.domainMax[c] - value && lut.domainMax[c] - value >= 1.1754943508222875e-38) &&
      lutValues(lut).every(value => Math.abs(value) <= 65504);
    if (isImmutable(lut)) this.lookupCompatibility.set(lut, safe);
    return safe;
  }
  private lookupBuffer(lut: CubeLutData): GPUBuffer {
    const hit = this.lookupBuffers.get(lut.data);
    if (hit) { this.lookupBuffers.delete(lut.data); this.lookupBuffers.set(lut.data, hit); return hit.buffer; }
    const values = lutValues(lut), bytes = values.byteLength;
    while (this.lookupBuffers.size && (this.lookupBuffers.size >= 4 || this.lookupBytes + bytes > 32 * 1024 * 1024)) {
      const key = this.lookupBuffers.keys().next().value!, entry = this.lookupBuffers.get(key)!;
      entry.buffer.destroy(); this.lookupBytes -= entry.bytes; this.lookupBuffers.delete(key);
    }
    const buffer = this.buffer(values, GPUBufferUsage.STORAGE);
    this.lookupBuffers.set(lut.data, { buffer, bytes }); this.lookupBytes += bytes; return buffer;
  }
  private signature(layer: LayerData) {
    const existing = this.signatures.get(layer);
    if (existing) return existing;
    const value = contentSignature(layer);
    if (Object.isFrozen(layer)) this.signatures.set(layer, value);
    return value;
  }
  private async layerMask(
    id: string,
    mask: LayerMaskData,
    space: RenderSpace,
    world: AffineTransform,
    assets?: AssetStore,
    isCancelled?:()=>boolean,
  ) {
    const { x, y } = world.point({ x: 0, y: 0 });
    const translationOnly =
      world.a === 1 && world.b === 0 && world.c === 0 && world.d === 1;
    if (
      translationOnly &&
      mask.kind === "selection" &&
      !mask.selection.regions.some(r => r.shape === "pixels") &&
      !mask.feather &&
      !hasMaskRefinements(mask)
    )
      return this.mask(mask.selection, space, x, y);
    const signature = JSON.stringify([
      maskGeometry(mask),
      mask.feather ?? 0,
      space,
      world,
    ]);
    const key = `layer-mask:${id}`;
    const cached = this.get(key, signature);
    if (cached) return cached;
    const canvas = await this.fallback.renderMaskCoverage(
      mask,
      space,
      x,
      y,
      `gpu:${this.namespace}:${id}`,
      true,
      world,
      assets,
      isCancelled,
    );
    try {
      const result = this.upload(canvas);
      this.retain(key, signature, result);
      return result;
    } finally {
      release(canvas);
    }
  }
  private mask(
    clip: SelectionData,
    space: RenderSpace,
    x: number,
    y: number,
    world = AffineTransform.translation(x, y),
  ) {
    const signature = JSON.stringify([clip, space, world]);
    const cached = this.get("selection", signature);
    if (cached) return cached;
    const values = new Float32Array(Math.max(16, clip.regions.length * 16));
    const matrix = renderTransform(space, world);
    clip.regions.forEach((r, i) => {
      const region = matrix
        .multiply(selectionRegionTransform(r))
        .multiply(AffineTransform.translation(r.x, r.y))
        .multiply(AffineTransform.scale(r.width, r.height));
      const bounds = region.bounds({ x: 0, y: 0, width: 1, height: 1 });
      const inverse = region.inverse();
      const params = [
        bounds.x,
        bounds.y,
        bounds.width,
        bounds.height,
        r.shape === "ellipse" ? 1 : 0,
        r.operation === "subtract" ? 1 : r.operation === "intersect" ? 2 : 0,
        0,
        0,
        inverse.a,
        inverse.b,
        inverse.c,
        inverse.d,
        inverse.e,
        inverse.f,
        0,
        0,
      ];
      if (params.some((n) => !Number.isFinite(n) || Math.abs(n) > 1e7))
        throw new Error("Selection requires double-precision fallback.");
      values.set(params, i * 16);
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
    world = AffineTransform.translation(x, y),
  ) {
    if(this.emptyStroke(stroke))return;
    const matrix = renderTransform(space, world);
    const linearInverse = new AffineTransform(
      matrix.a,
      matrix.b,
      matrix.c,
      matrix.d,
    ).inverse();
    for(const copy of symmetryMatrices(stroke.symmetry)){
      const combined=matrix.multiply(copy),m=Math.max(Math.abs(combined.a),Math.abs(combined.b),Math.abs(combined.c),Math.abs(combined.d));
      const aa=combined.a/m,bb=combined.b/m,cc=combined.c/m,dd=combined.d/m,hi=(Math.hypot(aa+dd,bb-cc)+Math.hypot(aa-dd,bb+cc))/2;
      const low=Math.abs(aa*dd-bb*cc)/hi*m;
      if(stroke.points.some(point=>{
        const geometry=stroke.tip?paintStampGeometry(stroke,point):null;
        const minimum=geometry?Math.min(geometry.rx,geometry.ry)*2:paintStampSize(stroke,point);
        const needsSampling=stroke.kind!=='pencil'||combined.b!==0||combined.c!==0||!!geometry?.sin;
        return !Number.isFinite(low)||needsSampling&&minimum*low<2;
      }))throw new Error('Transformed subpixel stroke requires reference coverage.');
    }
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
        matrix.a,
        matrix.b,
        matrix.c,
        matrix.d,
        linearInverse.a,
        linearInverse.b,
        linearInverse.c,
        linearInverse.d,
      ]),
    );
    try {
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
        pass.draw(6, values.length / 9);
        pass.end();
        device.queue.submit([encoder.finish()]);
        instances.destroy();
        this.counters.stamps += values.length / 9;
        values = [];
      };
      visitStrokeStamps(
        (p) => {
          let size =
              paintStampSize(stroke,p),
            cx = p.x,
            cy = p.y;
          if (stroke.kind === "pencil") {
            size = Math.max(1, Math.round(size));
            cx = Math.floor(cx - size / 2) + size / 2;
            cy = Math.floor(cy - size / 2) + size / 2;
          }
          const geometry=stroke.tip||p.copy?paintStampGeometry(stroke,p):null;
          if(geometry){const {a,b,c,d}=geometry;const entries=[a,b,c,d].map(Math.fround);if(!entries.every(Number.isFinite)||Math.fround(Math.fround(entries[0]*entries[3])-Math.fround(entries[1]*entries[2]))===0)throw new Error('Symmetry basis requires reference precision.');}
          const center = matrix.point(geometry?{x:geometry.cx,y:geometry.cy}:{ x: cx, y: cy });
          values.push(
            center.x,
            center.y,
            geometry?.rx??size / 2,
            geometry?.ry??size / 2,
            paintStampAlpha(stroke,p),
            geometry?.a??1,
            geometry?.b??0,
            geometry?.c??0,
            geometry?.d??1,
          );
          if (values.length >= 4096 * 9) flush();
        },
        stroke,
        matrix
          .inverse()
          .bounds({ x: 0, y: 0, width: space.width, height: space.height }),
        from,
      );
      flush();
    } finally {
      uniform.destroy();
    }
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
    world = AffineTransform.translation(x, y),
  ) {
    const { points, ...settings } = stroke;
    const signature = JSON.stringify([settings, space, world]);
    const previous = incremental ? this.active : null;
    const reuse =
      previous &&
      previous.signature === signature &&
      previous.points.length <= points.length &&
      previous.points.every(
        (p, i) =>
          sameStrokePoint(p,points[i]),
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
      world,
    );
    if (incremental && raw.bytes <= 16 * 1024 * 1024) {
      this.active = { signature, points, surface: raw };
      this.owned.delete(raw);
    }
    if (!stroke.clip) return raw;
    return this.pass(raw, this.mask(stroke.clip, space, x, y, world), [3])!;
  }
  private async paintLayer(
    layer: PaintLayerData,
    doc: DocumentData,
    assets: AssetStore,
    space: RenderSpace,
    x: number,
    y: number,
    world = AffineTransform.translation(x, y),
    isCancelled?: () => boolean,
  ) {
    let content = this.make(space.width, space.height);
    for (const stroke of layer.strokes) {
      checkRenderCurrent(isCancelled);
      if (stroke.kind === 'wet' && stroke.opacity === 0) continue;
      const previousOwned = new Set(this.owned);
      let source: Surface;
      if (
        stroke.kind === "brush" ||
        stroke.kind === "pencil" ||
        stroke.kind === "eraser"
      )
        source = this.stroke(stroke, space, x, y, false, world);
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
          world,
          isCancelled,
        );
      }
      const result = this.pass(source, content, [
        0,
        stroke.opacity,
        (stroke.kind === "fill" && stroke.erase) || stroke.kind === "eraser"
          ? 255
          : 0,
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
    world = AffineTransform.translation(x, y),
    isCancelled?: () => boolean,
  ) {
    const neutral = {
      ...layer,
      clipped: undefined,
      mask: null,
      // The supplied world matrix already includes the layer basis.
      transform: undefined,
      x: 0,
      y: 0,
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
        isCancelled,
        rootTransform: world,
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
  private emptyStroke(stroke:BrushStrokeData){
    return !!stroke.pressureCurve&&stroke.points.every(point=>paintStampSize(stroke,point)===0||paintStampAlpha(stroke,point)===0);
  }
  private preciseStroke(stroke: BrushStrokeData, scale: number) {
    if(this.emptyStroke(stroke))return true;
    if(stroke.symmetry)return symmetryMatrices(stroke.symmetry).every(copy=>{
      const m=Math.max(Math.abs(copy.a),Math.abs(copy.b),Math.abs(copy.c),Math.abs(copy.d)),a=copy.a/m,b=copy.b/m,c=copy.c/m,d=copy.d/m;
      const high=(Math.hypot(a+d,b-c)+Math.hypot(a-d,b+c))/2,low=Math.abs(a*d-b*c)/high*m;
      return stroke.points.every(point=>{const geometry=paintStampGeometry(stroke,point);return stroke.kind==='pencil'&&copy.b===0&&copy.c===0&&geometry.sin===0||Math.min(geometry.rx,geometry.ry)*2*scale*low>=2;});
    });
    if(stroke.tip)return stroke.points.every(point=>{
      const geometry=paintStampGeometry(stroke,point);
      return stroke.kind==='pencil'&&geometry.sin===0||Math.min(geometry.rx,geometry.ry)*2*scale>=2;
    });
    return (stroke.kind !== "brush" && stroke.kind !== "eraser") ||
      stroke.points.every(point=>paintStampSize(stroke,point)*scale>=2);
  }
  private supported(nodes: LayerData[], scale: number): boolean {
    if(nodes.some(node=>node.clipped||activePerspective(node.perspective)))return false;
    return nodes.every(
      (node) =>
        !node.visible ||
        node.opacity === 0 ||
        (node.kind !== "smart-object" && !(node.kind === 'group' && node.blendMode === 'pass-through') &&
          !(node.kind === "raster" && node.erasures?.some(entry => entry.stroke.kind !== 'wet' || entry.stroke.opacity !== 0)) &&
          !node.styles?.dropShadow.enabled &&
          (node.kind !== "adjustment" ||
            node.adjustment.kind === "hsl" ||
            (node.adjustment.kind === "gradient-map" && node.adjustment.stops.every((stop, i, stops) =>
              i === 0 || Math.fround(stop.position) > Math.fround(stops[i - 1].position))) ||
            (node.adjustment.kind === "lut" && this.lookupSupported(node.adjustment.lut)) ||
            node.adjustment.kind === "red-eye" ||
            node.adjustment.kind === "white-balance" ||
            node.adjustment.kind === "color-balance" ||
            node.adjustment.kind === "vibrance" ||
            node.adjustment.kind === "tone" ||
            (node.adjustment.kind === "levels" &&
              !node.adjustment.red &&
              !node.adjustment.green &&
              !node.adjustment.blue)) &&
          (node.kind !== "group" || this.supported(node.children, scale)) &&
          (node.kind !== "paint" ||
            node.strokes.every(
              (stroke) =>
                stroke.kind === 'wet' ? stroke.opacity === 0 : !stroke.clip?.regions.some(r => r.shape === "pixels") && (stroke.kind === "fill" || (!stroke.texture&&this.preciseStroke(stroke, scale))),
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
    checkRenderCurrent(options.isCancelled);
    if(isFloatDocument(document))return null;
    if (!(await this.ready) || !this.device || this.disposed) return null;
    checkRenderCurrent(options.isCancelled);
    if (this.namespace !== document.id || this.assets !== assets) {
      this.clearCache();
      this.namespace = document.id;
      this.assets = assets;
    }
    if (
      (!options.paintPreview || options.paintPreview.maskMode) &&
      this.active
    ) {
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
      options.outputSize?.width ?? region.width,
      options.outputSize?.height ?? region.height,
      options.outputSize ? 1 : options.scale,
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
      !!options.paintPreview?.filterMask ||
      !!options.paintPreview?.cloneSource ||
      !this.supported(document.children, scale) ||
      (!!options.paintPreview && !options.paintPreview.maskMode && (options.paintPreview.stroke.clip?.regions.some(r => r.shape === "pixels") || (options.paintPreview.stroke.kind === "eraser" && findLayer(document, options.paintPreview.layerId)?.kind === "raster"))) ||
      (options.paintPreview &&
        !options.paintPreview.maskMode &&
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
      checkRenderCurrent(options.isCancelled);
      if (epoch !== this.epoch || this.device !== device || this.disposed)
        throw new Error("Obsolete GPU frame.");
    };
    const compose = async (
      nodes: LayerData[],
      parent: AffineTransform,
    ): Promise<Surface> => {
      let target = this.make(size.width, size.height);
      for (const layer of nodes) {
        if (!layer.visible || layer.opacity === 0) continue;
        if(layer.blendMode==='pass-through')throw new Error('Pass-through groups require the reference compositor.');
        check();
        const world = parent.multiply(localTransform(layer));
        const { x, y } = world.point({ x: 0, y: 0 });
        const location = JSON.stringify([space, world]);
        let source: Surface;
        if (layer.kind === "group")
          source = await compose(layer.children, world);
        else if (layer.kind === "adjustment") {
          if (layer.adjustment.kind === "lut") {
            const effect = layer.adjustment, lut = effect.lut;
            source = this.pass(target, target, [lut.size, lut.dimension, effect.amount, Number(effect.interpolation === "tetrahedral"),
              ...lut.domainMin, 0, ...lut.domainMax.map((value, c) => value - lut.domainMin[c]), 0],
              undefined, this.lookupPipeline, this.lookupBuffer(lut))!;
          } else if (layer.adjustment.kind === "red-eye") {
            // Integer RGB8 excess: ceil before float32 packing preserves threshold classification.
            source = this.pass(target, target, [12, Math.ceil(layer.adjustment.threshold), layer.adjustment.strength])!;
          } else if (layer.adjustment.kind === "white-balance") {
            const effect = layer.adjustment, matrix = whiteBalanceMatrix(effect);
            source = this.pass(target, target, [11, Number(effect.temperature === WHITE_BALANCE_NEUTRAL && effect.tint === 0), 0, 0,
              ...matrix[0], 0, ...matrix[1], 0, ...matrix[2], 0])!;
          } else if (layer.adjustment.kind === "gradient-map") {
            const effect = layer.adjustment;
            const values = new Array<number>(132).fill(0);
            values.splice(0, 4 + effect.stops.length * 4, effect.stops.length, Number(effect.reverse), 0, 0, ...packGradientStops(effect.stops));
            source = this.pass(target, target, values, undefined, this.gradientMapPipeline)!;
          } else if (layer.adjustment.kind === "color-balance") {
            const effect=layer.adjustment;
            source=this.pass(target,target,[9,Number(effect.preserveLuminosity),0,0,
              effect.shadows.red,effect.shadows.green,effect.shadows.blue,0,
              effect.midtones.red,effect.midtones.green,effect.midtones.blue,0,
              effect.highlights.red,effect.highlights.green,effect.highlights.blue,0])!;
          } else if (layer.adjustment.kind === "vibrance") {
            source=this.pass(target,target,[10,layer.adjustment.vibrance,layer.adjustment.saturation])!;
          } else if (layer.adjustment.kind === "hsl") {
            const effect = layer.adjustment;
            source = this.pass(target, target, [
              8,
              effect.hue,
              effect.saturation,
              effect.lightness,
            ])!;
          } else if (layer.adjustment.kind === "tone") {
            const effect = layer.adjustment;
            source = this.pass(target, target, [
              1,
              2 ** effect.exposure,
              2 ** (effect.contrast / 100),
              1 + effect.saturation / 100,
            ])!;
          } else if (layer.adjustment.kind === "levels") {
            const rgb = layer.adjustment.rgb;
            source = this.pass(target, target, [
              6,
              rgb.inputBlack,
              rgb.inputWhite,
              rgb.gamma,
              rgb.outputBlack,
              rgb.outputWhite,
              0,
            ])!;
          } else {
            source = this.make(size.width, size.height);
          }
        } else {
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
                world,
                options.isCancelled,
              );
            else if (layer.kind === "paint")
              source = await this.paintLayer(
                layer,
                document,
                assets,
                space,
                x,
                y,
                world,
                options.isCancelled,
              );
            else
              source = await this.reference(
                layer,
                document,
                assets,
                space,
                x,
                y,
                world,
                options.isCancelled,
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
            !options.paintPreview?.maskMode &&
            layer.id === options.paintPreview?.layerId
          ) {
            const stroke = options.paintPreview.stroke;
            if (stroke.kind === "clone")
              throw new Error("Clone preview uses the reference renderer.");
            const overlay = this.stroke(stroke, space, x, y, true, world);
            const combined = this.pass(overlay, source, [
              0,
              stroke.opacity,
              stroke.kind === "eraser" ? 255 : 0,
            ])!;
            if (this.owned.has(source)) this.destroy(source);
            if (this.owned.has(overlay)) this.destroy(overlay);
            source = combined;
          }
        }
        check();
        const style = layer.styles ?? defaultStyle();
        const maskData = previewMask(layer, options.paintPreview);
        if (maskData?.enabled && maskData.density > 0) {
          const coverage = await this.layerMask(
            layer.id,
            maskData,
            space,
            maskTransform(maskData, world),
            assets,
            options.isCancelled,
          );
          check();
          const next = this.pass(source, coverage, [
            5,
            maskData.density,
            maskData.inverted ? 1 : 0,
          ])!;
          if (this.owned.has(source)) this.destroy(source);
          source = next;
        }
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
        if (layer.kind === "adjustment") {
          const result = this.pass(source, target, [
            7,
            layer.opacity,
            BLEND_MODES.indexOf(layer.blendMode),
            0,
            0,
            style.blendIf.enabled ? 1 : 0,
            ["red", "green", "blue"].indexOf(style.blendIf.channel),
            0,
            ...style.blendIf.source,
            ...style.blendIf.underlying,
          ])!;
          this.destroy(target);
          if (this.owned.has(source)) this.destroy(source);
          target = result;
          continue;
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
      output = await compose(document.children, new AffineTransform());
      check();
    } catch (error) {
      failed = true;
      if (!options.isCancelled?.()) this.reason = error instanceof Error ? error.message : String(error);
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
    for (const entry of this.lookupBuffers.values()) entry.buffer.destroy();
    this.lookupBuffers.clear(); this.lookupBytes = 0;
    this.lookupCompatibility = new WeakMap();
  }
  dispose() {
    this.disposed = true;
    this.clearCache();
    for (const surface of this.live) this.destroy(surface);
    this.device?.destroy();
    this.device = null;
  }
}
