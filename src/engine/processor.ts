import { redEyeAdjustmentSchema, type RedEyeAdjustmentData } from "../core/red-eye";
import { medianRadiusSchema } from '../core/smart/median-filter';
import {bilateralOptionsSchema,type BilateralFilterOptions} from '../core/smart/bilateral-filter';
import { colorRangeOptionsSchema, type ColorRangeOptions, type ColorRangeSettings } from "../core/color-range";
import { textureMaskOptionsSchema, type TextureMaskOptions, type TextureMaskSettings } from '../core/brush-texture';
import { wetPaintLoadSchema, wetPaintMixSchema, type WetPaintLoadOptions, type WetPaintLoadSettings, type WetPaintMixOptions, type WetPaintMixSettings, type WetPaintResult } from '../core/wet-paint';
import { validateWetPixels, validateWetCarried, validateWetCoverage } from './wet-paint';
import { lutAdjustmentSchema, type LutAdjustmentData } from "../core/lut";
import { whiteBalanceAdjustmentSchema, type WhiteBalanceAdjustmentData } from "../core/white-balance";
import { gradientMapAdjustmentSchema, type GradientMapAdjustmentData } from "../core/gradient-map";
import type { ClipboardRequest, ClipboardResult } from "./clipboard";
import type { SelectionModificationRequest, SelectionModificationProgress } from "../core/selection-modification";
import type { ChannelCoverageRequest } from '../core/alpha-channels';
import type { QuickSelectionRequest } from '../core/quick-selection';
import type { SubjectRequest } from '../core/subject-selection';
import type {MattingTileRequest,MattingTileResult} from './matting-tile';
import type {ClosedFormDiagnostics} from '../intelligence/matting/closed-form';
import type { SelectionData } from "../core/drawing";
import type { CoverageRequest, PixelCoverage } from "../core/pixel-selection";
import {
  hslAdjustmentSchema,
  type HslAdjustmentData,
  chromaticAdjustmentSchema,
  type ChromaticAdjustmentData,
} from "../core/adjustments";
import { spatialFilterSupport, type SpatialFilterOptions } from "../core/smart/spatial-filter";
import type {
  DonorSearchOptions,
  DonorSearchResult,
} from "../core/retouch/donor";
import type { DodgeBurnOptions } from "../core/retouch/types";
import type {
  PoissonBlendOptions,
  PoissonBlendResult,
} from "../core/retouch/types";
import type { BlendIfData } from "../core/drawing";
import type { ToneEffectData } from "../core/model";
import type { HistogramData } from "../core/histogram";
import type { SelectionTile, FeatherTile } from "./wasm";

export class PixelProcessor {
  private worker = new Worker(new URL("./pixels.worker.ts", import.meta.url), {
    type: "module",
  });
  private sequence = 0;
  private pending = new Map<
    number,
    { resolve(value: any): void; reject(error: Error): void; onProgress?(value: SelectionModificationProgress): void }
  >();
  readonly ready: Promise<void>;
  private failure: Error | null = null;
  private disposed = false;
  private rejectReady!: (error: Error) => void;

  constructor() {
    this.ready = new Promise((resolve, reject) => {
      this.rejectReady = reject;
      const fail = (error: Error) => {
        this.failure = error;
        reject(error);
        this.pending.forEach((request) => request.reject(error));
        this.pending.clear();
      };
      this.worker.onerror = () =>
        fail(new Error("Image worker failed. Reload to restart it."));
      this.worker.onmessage = (event) => {
        if (this.failure) return;
        if (event.data.type === "ready") {
          resolve();
          return;
        }
        if (event.data.type === "fatal") {
          fail(new Error(event.data.error));
          return;
        }
        const request = this.pending.get(event.data.id);
        if (!request) return;
        if (event.data.type === "progress") {
          try { request.onProgress?.(event.data.progress); }
          catch (error) { this.pending.delete(event.data.id); request.reject(error instanceof Error ? error : new Error(String(error))); }
          return;
        }
        this.pending.delete(event.data.id);
        if (event.data.error) request.reject(new Error(event.data.error));
        else if (event.data.png) request.resolve(event.data.png);
        else if (event.data.clipboard) request.resolve(event.data.clipboard);
        else if (event.data.coverage) request.resolve(event.data.coverage);
        else if (event.data.selectionResult) request.resolve(event.data.selectionResult);
        else if (event.data.mattingTile) request.resolve(event.data.mattingTile);
        else if (event.data.mattingDiagnostics) request.resolve(event.data.mattingDiagnostics);
        else if (event.data.colorRangeCoverage) request.resolve(event.data.colorRangeCoverage);
        else if (event.data.histogram) request.resolve(event.data.histogram);
        else if (event.data.donorResult)
          request.resolve(event.data.donorResult);
        else if (event.data.poissonResult)
          request.resolve(event.data.poissonResult);
        else if (event.data.wetPaint) request.resolve(event.data.wetPaint);
        else if (event.data.wetPaintCarried) request.resolve(event.data.wetPaintCarried);
        else request.resolve(event.data.pixels);
      };
    });
    // Readiness remains rejectable for callers, even if shutdown precedes first use.
    void this.ready.catch(() => {});
  }

  async bilateralFilter(pixels:Uint8ClampedArray,width:number,height:number,options:BilateralFilterOptions):Promise<Uint8ClampedArray> {
    const settings=bilateralOptionsSchema.parse(options);
    if(!(pixels instanceof Uint8ClampedArray)||![width,height,width*height].every(v=>Number.isSafeInteger(v)&&v>0)||width>8192||height>8192||width*height>4_000_000||pixels.length!==width*height*4)
      throw new Error('Invalid bilateral-filter tile geometry.');
    const length=pixels.length,result=await this.request(pixels.slice(),{bilateralFilter:{width,height,options:settings}});
    if(!(result instanceof Uint8ClampedArray)||result.length!==length)throw new Error('Invalid bilateral-filter worker result.');
    return result;
  }

  /** Capture before readiness/transfer; the caller keeps its original pixels. */
  async medianFilter(pixels:Uint8ClampedArray,width:number,height:number,radius:number):Promise<Uint8ClampedArray> {
    medianRadiusSchema.parse(radius);
    if (!(pixels instanceof Uint8ClampedArray) || ![width,height,width*height].every(v=>Number.isSafeInteger(v)&&v>0) || width>8192 || height>8192 || width*height>4_000_000 || pixels.length!==width*height*4)
      throw new Error('Invalid median-filter tile geometry.');
    const length=pixels.length, result=await this.request(pixels.slice(),{medianFilter:{width,height,radius}});
    if (!(result instanceof Uint8ClampedArray) || result.length!==length)
      throw new Error('Invalid median-filter worker result.');
    return result;
  }

  /** Snapshot inputs before worker readiness; callers keep their source buffers. */
  async spatialFilter(
    pixels: Uint8ClampedArray,
    width: number,
    height: number,
    options: SpatialFilterOptions,
  ): Promise<Uint8ClampedArray> {
    spatialFilterSupport(options);
    if (!(pixels instanceof Uint8ClampedArray) || ![width,height,width*height].every(v=>Number.isSafeInteger(v)&&v>0) || pixels.length!==width*height*4)
      throw new Error("Invalid spatial-filter tile geometry.");
    const length=pixels.length,result=await this.request(pixels.slice(), {
      spatialFilter: { width, height, options: { ...options } },
    });
    if (!(result instanceof Uint8ClampedArray) || result.length!==length)throw new Error("Invalid spatial-filter worker result.");
    return result;
  }
  process(
    pixels: Uint8ClampedArray,
    effects: ToneEffectData[],
  ): Promise<Uint8ClampedArray> {
    return this.request(pixels, { effects });
  }
  /** Retouch source/coverage are retained by the caller; only private copies transfer. */
  dodgeBurn(
    pixels: Uint8ClampedArray,
    width: number,
    height: number,
    options: DodgeBurnOptions,
    coverage?: Uint8Array | Uint8ClampedArray,
  ): Promise<Uint8ClampedArray> {
    return this.request(pixels.slice(), {
      dodgeBurn: {
        width,
        height,
        options: { ...options },
        coverage: coverage?.slice(),
      },
    });
  }
  /** Retain caller pixels and settings while worker readiness is pending. */
  hsl(
    pixels: Uint8ClampedArray,
    adjustment: HslAdjustmentData,
  ): Promise<Uint8ClampedArray> {
    if (pixels.length % 4 !== 0)
      return Promise.reject(new Error("HSL requires complete RGBA pixels."));
    const settings = hslAdjustmentSchema.parse(adjustment);
    return this.request(pixels.slice(), { hsl: settings });
  }
  chromatic(pixels: Uint8ClampedArray, adjustment: ChromaticAdjustmentData): Promise<Uint8ClampedArray> {
    if (pixels.length%4) return Promise.reject(new Error("Chromatic adjustments require complete RGBA pixels."));
    return this.request(pixels.slice(), { chromatic: chromaticAdjustmentSchema.parse(adjustment) });
  }
  async encodeFrequencyBand(pixels:Uint8ClampedArray,low:Uint8ClampedArray,band:'high'|'correction'):Promise<Uint8ClampedArray>{
    if(!(pixels instanceof Uint8ClampedArray)||!(low instanceof Uint8ClampedArray)||pixels.length%4||pixels.length!==low.length||!['high','correction'].includes(band))throw new Error('Invalid frequency encoding planes.');
    const length=pixels.length,result=await this.request(pixels.slice(),{frequencyEncoding:{low:low.slice(),band}});
    if(!(result instanceof Uint8ClampedArray)||result.length!==length)throw new Error('Invalid frequency encoding worker result.');return result;
  }
  async linearBlend(pixels: Uint8ClampedArray, backdrop: Uint8ClampedArray, opacity = 1, mode: "linear-light" | "linear-burn" = "linear-light"): Promise<Uint8ClampedArray> {
    if (!(pixels instanceof Uint8ClampedArray) || !(backdrop instanceof Uint8ClampedArray) || pixels.length % 4 || pixels.length !== backdrop.length || !Number.isFinite(opacity) || opacity < 0 || opacity > 1 || !["linear-light","linear-burn"].includes(mode)) throw new Error("Invalid linear-blend tile.");
    const length=pixels.length,result=await this.request(pixels.slice(), { linearBlend: {backdrop:backdrop.slice(),opacity,mode} });
    if (!(result instanceof Uint8ClampedArray) || result.length !== length) throw new Error("Invalid Linear Light worker result.");
    return result;
  }
  async redEye(pixels: Uint8ClampedArray, adjustment: RedEyeAdjustmentData): Promise<Uint8ClampedArray> {
    if (!(pixels instanceof Uint8ClampedArray) || pixels.length % 4 || pixels.length > 0x7fffffff)
      throw new Error("Red-eye correction requires complete RGBA pixels within the kernel tile range.");
    const settings = redEyeAdjustmentSchema.parse(adjustment), length = pixels.length;
    const result = await this.request(pixels.slice(), { redEye: settings });
    if (!(result instanceof Uint8ClampedArray) || result.length !== length)
      throw new Error("Invalid red-eye worker result.");
    return result;
  }
  gradientMap(pixels: Uint8ClampedArray, adjustment: GradientMapAdjustmentData): Promise<Uint8ClampedArray> {
    if (pixels.length % 4) return Promise.reject(new Error("Gradient maps require complete RGBA pixels."));
    return this.request(pixels.slice(), { gradientMap: gradientMapAdjustmentSchema.parse(adjustment) });
  }
  whiteBalance(pixels: Uint8ClampedArray, adjustment: WhiteBalanceAdjustmentData): Promise<Uint8ClampedArray> {
    if (pixels.length % 4) return Promise.reject(new Error("White balance requires complete RGBA pixels."));
    return this.request(pixels.slice(), { whiteBalance: whiteBalanceAdjustmentSchema.parse(adjustment) });
  }
  lookup(pixels: Uint8ClampedArray, adjustment: LutAdjustmentData): Promise<Uint8ClampedArray> {
    return this.request(pixels.slice(), { lookup: lutAdjustmentSchema.parse(adjustment) });
  }
  colorRange(pixels:Uint8ClampedArray,options:ColorRangeOptions):Promise<Uint8Array> {
    return this.request(pixels.slice(),{colorRange:colorRangeOptionsSchema.parse(options)});
  }
  /** Snapshot before readiness; neither source bytes nor caller buffers transfer. */
  async brushTexture(pixels: Uint8ClampedArray, options: TextureMaskOptions = {},support?:Uint8ClampedArray): Promise<Uint8ClampedArray> {
    if (!(pixels instanceof Uint8ClampedArray) || pixels.length % 4 || pixels.length > 16_000_000)
      throw new Error('Texture conversion requires complete RGBA pixels in a working tile of at most 4,000,000 pixels.');
    if(support!==undefined&&(!(support instanceof Uint8ClampedArray)||support.length!==pixels.length))throw new Error('Texture support must match its RGBA working tile.');
    const settings = textureMaskOptionsSchema.parse(options), length = pixels.length;
    const result = await this.request(pixels.slice(), { brushTexture: settings,brushTextureSupport:support?.slice() });
    if (!(result instanceof Uint8ClampedArray) || result.length !== length)
      throw new Error('The texture worker returned invalid coverage pixels.');
    return result;
  }
  /** Prepare carried pigment in the worker without losing sub-byte alpha. */
  async loadWetPaint(pixels: Uint8ClampedArray, options: WetPaintLoadOptions = {}): Promise<Float32Array> {
    validateWetPixels(pixels);
    const settings = wetPaintLoadSchema.parse(options), length = pixels.length;
    const result = await this.request(pixels.slice(), { wetPaintLoad: settings });
    validateWetCarried(result, length);
    return result;
  }
  /** Capture every input before worker readiness; callers retain all buffers. */
  async mixWetPaint(pixels: Uint8ClampedArray, carried: Float32Array, coverage: Uint8Array, options: WetPaintMixOptions = {}): Promise<WetPaintResult> {
    validateWetPixels(pixels);
    validateWetCarried(carried, pixels.length);
    validateWetCoverage(coverage, pixels.length);
    const settings = wetPaintMixSchema.parse(options), length = pixels.length;
    const result = await this.request(pixels.slice(), { wetPaintMix: { carried: carried.slice(), coverage: coverage.slice(), settings } });
    if (!result || !(result.pixels instanceof Uint8ClampedArray) || result.pixels.length !== length)
      throw new Error('The wet paint worker returned invalid destination pixels.');
    validateWetCarried(result.carried, length);
    return result;
  }
  applyLut(
    pixels: Uint8ClampedArray,
    lut: Uint8Array,
  ): Promise<Uint8ClampedArray> {
    return this.request(pixels, { lut });
  }
  /** Immutable caller inputs; numerical convergence is reported explicitly. */
  poissonBlend(
    target: Uint8ClampedArray,
    donor: Uint8ClampedArray,
    width: number,
    height: number,
    coverage: Uint8Array | Uint8ClampedArray,
    options: PoissonBlendOptions = {},
  ): Promise<PoissonBlendResult> {
    return this.request(target.slice(), {
      poisson: {
        donor: donor.slice(),
        width,
        height,
        coverage: coverage.slice(),
        options: { ...options },
      },
    });
  }
  findDonor(
    pixels: Uint8ClampedArray,
    width: number,
    height: number,
    coverage: Uint8Array | Uint8ClampedArray,
    options: DonorSearchOptions = {},
  ): Promise<DonorSearchResult> {
    return this.request(pixels.slice(), {
      donorSearch: {
        width,
        height,
        coverage: coverage.slice(),
        options: { ...options },
      },
    });
  }
  mixFiltered(
    original: Uint8ClampedArray,
    filtered: Uint8ClampedArray,
    mask: Uint8ClampedArray,
    density = 1,
    inverted = false,
  ): Promise<Uint8ClampedArray> {
    // Public helper retains caller ownership and captures values before readiness.
    return this.mixFilteredOwned(original.slice(), filtered.slice(), mask.slice(), density, inverted);
  }
  /** Internal: consumes exclusively owned arrays; never pass retained cache/caller buffers. */
  mixFilteredOwned(
    original: Uint8ClampedArray,
    filtered: Uint8ClampedArray,
    mask: Uint8ClampedArray,
    density = 1,
    inverted = false,
  ): Promise<Uint8ClampedArray> {
    return this.request(original, {
      filteredMix: { filtered, mask, density, inverted },
    });
  }
  blendAdjustment(
    target: Uint8ClampedArray,
    adjusted: Uint8ClampedArray,
    mask: Uint8ClampedArray | null,
    opacity: number,
  ): Promise<Uint8ClampedArray> {
    return this.request(target, {
      adjustment: { adjusted, mask, opacity },
    });
  }
  histogram(pixels: Uint8ClampedArray): Promise<HistogramData> {
    return this.request(pixels, { histogram: true });
  }
  blendIf(
    pixels: Uint8ClampedArray,
    underlying: Uint8ClampedArray,
    blend: BlendIfData,
  ): Promise<Uint8ClampedArray> {
    return this.request(pixels, { underlying, blend });
  }
  featheredSelection(tile: SelectionTile, radiusX: number, radiusY: number): Promise<Uint8ClampedArray> {
    return this.request(new Uint8ClampedArray(0), { featheredSelection: { tile, radiusX, radiusY } });
  }
  selection(tile: SelectionTile): Promise<Uint8ClampedArray> {
    return this.request(new Uint8ClampedArray(0), { selection: tile });
  }
  modifySelection(input: SelectionModificationRequest, onProgress?: (value: SelectionModificationProgress) => void): Promise<SelectionData> {
    return this.request(new Uint8ClampedArray(0), { selectionModification: structuredClone(input) }, onProgress);
  }
  channelSelection(input:ChannelCoverageRequest,onProgress?:(value:SelectionModificationProgress)=>void):Promise<SelectionData>{
    return this.request(new Uint8ClampedArray(0),{channelSelection:structuredClone(input)},onProgress);
  }
  /** Consumes a private native capture; original image assets never transfer. */
  quickSelection(pixels:Uint8ClampedArray,request:QuickSelectionRequest,onProgress?:(value:SelectionModificationProgress)=>void):Promise<SelectionData>{
    return this.request(pixels,{quickSelection:structuredClone(request)},onProgress);
  }
  /** Consumes only a private source capture, never asset-owned bytes. */
  selectSubject(pixels:Uint8ClampedArray,request:SubjectRequest,onProgress?:(value:SelectionModificationProgress)=>void):Promise<SelectionData>{
    return this.request(pixels,{subject:structuredClone(request)},onProgress);
  }
  /** Consumes a private padded source tile; results remain outside script globals. */
  mattingTile(pixels:Uint8ClampedArray,request:MattingTileRequest):Promise<MattingTileResult>{
    return this.request(pixels,{matting:structuredClone(request)});
  }
  async beginMatting(width:number,height:number):Promise<void>{await this.request(new Uint8ClampedArray(0),{mattingBegin:{width,height}});}
  async accumulateMatting(pixels:Uint8ClampedArray,request:MattingTileRequest):Promise<void>{await this.request(pixels,{mattingAccumulate:structuredClone(request)});}
  solveMatting(onIteration?:(iteration:number,residual:number)=>void):Promise<ClosedFormDiagnostics>{return this.request(new Uint8ClampedArray(0),{mattingSolve:true},value=>{const residual=(value as typeof value&{relativeResidual:number}).relativeResidual;if(!Number.isFinite(residual)||residual<0)throw new Error('Invalid matting solver progress.');onIteration?.(value.completed,residual);});}
  /** Consumes a private captured pixel buffer; original image assets never transfer. */
  selectionCoverage(pixels: Uint8ClampedArray, options: CoverageRequest): Promise<PixelCoverage> {
    return this.request(pixels, { coverage: { ...options, wand: options.wand ? { ...options.wand } : undefined } });
  }
  /** Consumes captured pixels; masking, crop and PNG encoding stay in the worker. */
  clipboardPixels(pixels: Uint8ClampedArray, options: ClipboardRequest): Promise<ClipboardResult> {
    return this.request(pixels, { clipboard: { ...options } });
  }
  /** Consumes a private RGBA capture and encodes off the UI thread. */
  encodePng(pixels: Uint8ClampedArray, width: number, height: number): Promise<Blob> {
    return this.request(pixels, { png: { width, height } });
  }
  feather(pixels: Uint8ClampedArray, tile: FeatherTile) {
    return this.request(pixels, { feather: tile });
  }
  private async request(
    pixels: Uint8ClampedArray,
    payload: {
      filteredMix?: {
        filtered: Uint8ClampedArray;
        mask: Uint8ClampedArray;
        density: number;
        inverted: boolean;
      };
      spatialFilter?: {
        width: number;
        height: number;
        options: SpatialFilterOptions;
      };
      medianFilter?: {width:number;height:number;radius:number};
      bilateralFilter?: {width:number;height:number;options:BilateralFilterOptions};
      donorSearch?: {
        width: number;
        height: number;
        coverage: Uint8Array | Uint8ClampedArray;
        options: DonorSearchOptions;
      };
      poisson?: {
        donor: Uint8ClampedArray;
        width: number;
        height: number;
        coverage: Uint8Array | Uint8ClampedArray;
        options: PoissonBlendOptions;
      };
      dodgeBurn?: {
        width: number;
        height: number;
        options: DodgeBurnOptions;
        coverage?: Uint8Array | Uint8ClampedArray;
      };
      hsl?: HslAdjustmentData;
      chromatic?: ChromaticAdjustmentData;
      frequencyEncoding?: {low:Uint8ClampedArray;band:"high"|"correction"};
      linearBlend?: { backdrop: Uint8ClampedArray; opacity: number; mode: "linear-light" | "linear-burn" };
      redEye?: RedEyeAdjustmentData;
      gradientMap?: GradientMapAdjustmentData;
      whiteBalance?: WhiteBalanceAdjustmentData;
      lookup?: LutAdjustmentData;
      colorRange?:ColorRangeSettings;
      brushTexture?: TextureMaskSettings;
      brushTextureSupport?:Uint8ClampedArray;
      wetPaintLoad?:WetPaintLoadSettings;
      wetPaintMix?:{carried:Float32Array;coverage:Uint8Array;settings:WetPaintMixSettings};
      effects?: ToneEffectData[];
      underlying?: Uint8ClampedArray;
      blend?: BlendIfData;
      featheredSelection?: { tile: SelectionTile; radiusX: number; radiusY: number };
      selection?: SelectionTile;
      feather?: FeatherTile;
      lut?: Uint8Array;
      adjustment?: {
        adjusted: Uint8ClampedArray;
        mask?: Uint8ClampedArray | null;
        opacity: number;
      };
      histogram?: boolean;
      coverage?: CoverageRequest;
      png?: { width: number; height: number };
      clipboard?: ClipboardRequest;
      selectionModification?: SelectionModificationRequest;
      channelSelection?: ChannelCoverageRequest;
      quickSelection?: QuickSelectionRequest;
      subject?: SubjectRequest;
      matting?: MattingTileRequest;
      mattingBegin?:{width:number;height:number};
      mattingAccumulate?:MattingTileRequest;
      mattingSolve?:boolean;
    },
    onProgress?: (value: SelectionModificationProgress) => void,
  ): Promise<any> {
    await this.ready;
    if (this.failure) throw this.failure;
    const id = ++this.sequence;
    const transfer: Transferable[] = [];
    const seen = new Set<ArrayBuffer>();
    const tryTransfer = (buf?: ArrayBufferLike | null) => {
      if (
        !buf ||
        !(buf instanceof ArrayBuffer) ||
        buf.byteLength === 0 ||
        seen.has(buf)
      ) {
        return;
      }
      if ("detached" in buf && (buf as any).detached) return;
      seen.add(buf);
      transfer.push(buf);
    };

    if (pixels.byteLength > 0) tryTransfer(pixels.buffer);
    if(payload.brushTextureSupport)tryTransfer(payload.brushTextureSupport.buffer);
    if(payload.frequencyEncoding)tryTransfer(payload.frequencyEncoding.low.buffer);
    if(payload.linearBlend)tryTransfer(payload.linearBlend.backdrop.buffer);
    if(payload.wetPaintMix){tryTransfer(payload.wetPaintMix.carried.buffer);tryTransfer(payload.wetPaintMix.coverage.buffer);}
    if (payload.filteredMix) {
      // Both mixing entry points supply exclusively owned buffers here.
      tryTransfer(payload.filteredMix.filtered.buffer);
      tryTransfer(payload.filteredMix.mask.buffer);
    }
    if (payload.donorSearch) tryTransfer(payload.donorSearch.coverage.buffer);
    if (payload.poisson) {
      // poissonBlend captured these private buffers synchronously; no caller data detaches.
      tryTransfer(payload.poisson.donor.buffer);
      tryTransfer(payload.poisson.coverage.buffer);
    }
    // Note: payload.underlying is a read-only backdrop reference for blendIf; transferring it
    // detaches the caller's backdrop buffer. Structured clone preserves caller access safely.
    // Note: payload.lut (768 bytes) is a reusable lookup table across tiles/frames;
    // transferring it would detach the buffer and cause subsequent tiles/calls to fail.
    // Structured clone copies the small 768-byte buffer without detaching the caller buffer.
    if (payload.adjustment) {
      if (payload.adjustment.adjusted.byteLength > 0) {
        tryTransfer(payload.adjustment.adjusted.buffer);
      }
      if (payload.adjustment.mask && payload.adjustment.mask.byteLength > 0) {
        tryTransfer(payload.adjustment.mask.buffer);
      }
    }
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      try {
        this.worker.postMessage({ id, pixels, ...payload }, transfer);
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.failure ??= new Error("Image worker closed.");
    this.rejectReady(this.failure);
    this.worker.terminate();
    this.pending.forEach((request) => request.reject(this.failure!));
    this.pending.clear();
  }
}
