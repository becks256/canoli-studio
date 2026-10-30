import{compileFloatColor,parseFloatColor,type FloatColorAdjustment}from'../core/float-color';
import {compileProjectiveSample,type ProjectiveSampleOptions} from '../core/projective-sampling';
import {floatTonalOptionsSchema, type FloatTonalOptions} from '../core/float-tonal';
import{parseFloatTransfer,type FloatTransferAdjustment}from'../core/float-transfer';
import{floatCompositeOptionsSchema,floatToneOptionsSchema,validateFloatWorkerWindow,validateFloatStyleResult,type FloatStyleResult,type FloatCompositeOptions,type FloatToneOptions}from'./float-pixels';
import{floatConvolutionSchema,floatConvolutionLength,validateFloatAlpha,type FloatConvolutionOptions}from'../core/float-shadow';
import{compileFloatStyle}from'../core/float-style';
import type{LayerStyleData}from'../core/drawing';
import { redEyeAdjustmentSchema, type RedEyeAdjustmentData } from "../core/red-eye";
import { medianRadiusSchema } from '../core/smart/median-filter';
import {bilateralOptionsSchema,type BilateralFilterOptions} from '../core/smart/bilateral-filter';
import { colorRangeOptionsSchema, type ColorRangeOptions, type ColorRangeSettings } from "../core/color-range";
import { textureMaskOptionsSchema, type TextureMaskOptions, type TextureMaskSettings } from '../core/brush-texture';
import { wetPaintLoadSchema, wetPaintMixSchema, type WetPaintLoadOptions, type WetPaintLoadSettings, type WetPaintMixOptions, type WetPaintMixSettings, type WetPaintResult } from '../core/wet-paint';
import { validateWetPixels, validateWetCarried, validateWetCoverage } from './wet-paint';
import { captureLutHeader, lutAdjustmentSchema, type LutAdjustmentData } from "../core/lut";
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
export interface FloatLookupLease{apply(pixels:Float32Array):Promise<Float32Array>;dispose():void}
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
        else if (event.data.floatLookupHandle!==undefined)request.resolve(event.data.floatLookupHandle);
        else if (event.data.donorResult)
          request.resolve(event.data.donorResult);
        else if (event.data.floatStyle) request.resolve(event.data.floatStyle);
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

  /** Internal precision windows; complete original geometry is independent. */
  async floatTonal(pixels:Float32Array,coverage:Float32Array,input:FloatTonalOptions):Promise<Float32Array>{
    const options=floatTonalOptionsSchema.parse(input);validateFloatWorkerWindow(pixels);validateFloatAlpha(coverage,pixels.length/4);
    const captured={pixels:pixels.slice(),coverage:coverage.slice(),options},length=pixels.length,alpha=new Uint32Array(length/4),words=new Uint32Array(pixels.buffer,pixels.byteOffset,length);
    for(let i=0;i<alpha.length;i++)alpha[i]=words[i*4+3];
    const result=await this.request(new Uint8ClampedArray(0),{floatTonal:captured});validateFloatWorkerWindow(result);if(result.length!==length)throw new Error('Float tonal worker result geometry differs.');
    const output=new Uint32Array(result.buffer,result.byteOffset,result.length);for(let i=0;i<alpha.length;i++)if(output[i*4+3]!==alpha[i])throw new Error('Float tonal worker changed backdrop alpha.');
    return result;
  }
  async floatConvolveAlpha(alpha:Float32Array,input:FloatConvolutionOptions):Promise<Float32Array>{
    const settings=floatConvolutionSchema.parse(input);validateFloatAlpha(alpha,settings.width*settings.height);const captured={alpha:alpha.slice(),settings},length=floatConvolutionLength(settings);
    const result=await this.request(new Uint8ClampedArray(0),{floatConvolveAlpha:captured});validateFloatAlpha(result,length);return result;
  }
  async floatStyle(source:Float32Array,backdrop:Float32Array,input:LayerStyleData):Promise<FloatStyleResult>{
    const {style}=compileFloatStyle(input);validateFloatWorkerWindow(source);validateFloatWorkerWindow(backdrop);if(source.length!==backdrop.length)throw new Error('Float style source and backdrop geometry differ.');
    const captured={source:source.slice(),backdrop:backdrop.slice(),style},length=source.length,alpha=new Uint32Array(length/4),words=new Uint32Array(source.buffer,source.byteOffset,source.length);
    for(let i=0;i<alpha.length;i++)alpha[i]=words[i*4+3];
    const result=await this.request(new Uint8ClampedArray(0),{floatStyle:captured});validateFloatStyleResult(result,length,alpha);return result;
  }
  async floatGradient(pixels:Float32Array,input:GradientMapAdjustmentData):Promise<Float32Array>{
    const adjustment=gradientMapAdjustmentSchema.parse(input);validateFloatWorkerWindow(pixels);const length=pixels.length,result=await this.request(new Uint8ClampedArray(0),{floatGradient:{pixels:pixels.slice(),adjustment}});validateFloatWorkerWindow(result);if(result.length!==length)throw new Error('Float worker result geometry differs.');for(let i=0;i<result.length;i++)if(i%4!==3&&(result[i]<0||result[i]>1))throw new Error('Float gradient worker output must stay within normalized linear RGB.');return result;
  }
  async prepareFloatLookup(input:LutAdjustmentData):Promise<FloatLookupLease>{
    const adjustment=captureLutHeader(input),handle=await this.request(new Uint8ClampedArray(0),{floatLookupPrepare:adjustment});if(!Number.isSafeInteger(handle)||handle<=0)throw new Error('Float lookup worker returned an invalid captured handle.');let disposed=false;
    return{apply:async pixels=>{if(disposed)throw new Error('Captured float lookup is disposed.');validateFloatWorkerWindow(pixels);const length=pixels.length,result=await this.request(new Uint8ClampedArray(0),{floatLookupApply:{handle,pixels:pixels.slice()}});if(disposed)throw new Error('Captured float lookup is disposed.');validateFloatWorkerWindow(result);if(result.length!==length)throw new Error('Float worker result geometry differs.');return result;},dispose:()=>{if(disposed)return;disposed=true;void this.request(new Uint8ClampedArray(0),{floatLookupRelease:handle}).catch(()=>{});}};
  }
  async floatComposite(source:Float32Array,backdrop:Float32Array,options:FloatCompositeOptions={}):Promise<Float32Array>{
    const settings=floatCompositeOptionsSchema.parse(options);validateFloatWorkerWindow(source);validateFloatWorkerWindow(backdrop);if(source.length!==backdrop.length)throw new Error('Float source and backdrop geometry differ.');
    if(settings.mask&&(settings.mask.length!==source.length/4||!(settings.mask.buffer instanceof ArrayBuffer)))throw new Error('Float coverage geometry differs.');
    const captured={source:source.slice(),backdrop:backdrop.slice(),options:{...settings,...(settings.mask?{mask:settings.mask.slice()}:{})}},length=source.length;
    const result=await this.request(new Uint8ClampedArray(0),{floatComposite:captured});validateFloatWorkerWindow(result);if(result.length!==length)throw new Error('Float worker result geometry differs.');return result;
  }
  async floatColor(pixels:Float32Array,input:FloatColorAdjustment):Promise<Float32Array>{
    const adjustment=parseFloatColor(input),neutral=compileFloatColor(adjustment).neutral;validateFloatWorkerWindow(pixels);const captured={pixels:pixels.slice(),adjustment},length=pixels.length;
    const result=await this.request(new Uint8ClampedArray(0),{floatColor:captured});validateFloatWorkerWindow(result);if(result.length!==length)throw new Error('Float worker result geometry differs.');
    if(!neutral)for(let i=0;i<result.length;i++)if(i%4!==3&&(result[i]<0||result[i]>1))throw new Error('Float color worker output must stay within normalized linear RGB.');return result;
  }
  async floatTransfer(pixels:Float32Array,input:FloatTransferAdjustment):Promise<Float32Array>{
    const adjustment=parseFloatTransfer(input);validateFloatWorkerWindow(pixels);const captured={pixels:pixels.slice(),adjustment},length=pixels.length;
    const result=await this.request(new Uint8ClampedArray(0),{floatTransfer:captured});validateFloatWorkerWindow(result);if(result.length!==length)throw new Error('Float worker result geometry differs.');return result;
  }
  async floatTone(pixels:Float32Array,options:FloatToneOptions={}):Promise<Float32Array>{
    const settings=floatToneOptionsSchema.parse(options);validateFloatWorkerWindow(pixels);const captured={pixels:pixels.slice(),options:settings},length=pixels.length;
    const result=await this.request(new Uint8ClampedArray(0),{floatTone:captured});validateFloatWorkerWindow(result);if(result.length!==length)throw new Error('Float worker result geometry differs.');return result;
  }
  async floatAffine(pixels:Float32Array,matrix:readonly number[]):Promise<Float32Array>{
    validateFloatWorkerWindow(pixels);if(!Array.isArray(matrix)||matrix.length!==12||![...matrix].every(Number.isFinite))throw new Error('Use twelve finite RGB affine coefficients.');const captured={pixels:pixels.slice(),matrix:[...matrix]},length=pixels.length;
    const result=await this.request(new Uint8ClampedArray(0),{floatAffine:captured});validateFloatWorkerWindow(result);if(result.length!==length)throw new Error('Float worker result geometry differs.');return result;
  }
  async floatProjective(pixels:Float32Array,input:ProjectiveSampleOptions):Promise<Float32Array>{
    validateFloatWorkerWindow(pixels);const {options}=compileProjectiveSample(input),captured=pixels.slice(),length=options.output.width*options.output.height*4;
    if(captured.length!==options.source.width*options.source.height*4)throw new Error('Projective source pixels differ from captured window geometry.');
    const result=await this.request(new Uint8ClampedArray(0),{floatProjective:{pixels:captured,options}});
    validateFloatWorkerWindow(result);if(result.length!==length||result.byteOffset!==0||result.byteLength!==result.buffer.byteLength)throw new Error('Projective worker result differs from captured output geometry.');return result;
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
      floatConvolveAlpha?:{alpha:Float32Array;settings:FloatConvolutionOptions};
      floatStyle?:{source:Float32Array;backdrop:Float32Array;style:LayerStyleData};
      floatComposite?:{source:Float32Array;backdrop:Float32Array;options:FloatCompositeOptions};
      floatAffine?:{pixels:Float32Array;matrix:number[]};
      floatProjective?:{pixels:Float32Array;options:ProjectiveSampleOptions};
      floatTone?:{pixels:Float32Array;options:FloatToneOptions};
      floatTonal?:{pixels:Float32Array;coverage:Float32Array;options:FloatTonalOptions};
      floatTransfer?:{pixels:Float32Array;adjustment:FloatTransferAdjustment};
      floatColor?:{pixels:Float32Array;adjustment:FloatColorAdjustment};
      floatGradient?:{pixels:Float32Array;adjustment:GradientMapAdjustmentData};
      floatLookupPrepare?:LutAdjustmentData;
      floatLookupApply?:{handle:number;pixels:Float32Array};
      floatLookupRelease?:number;
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
    if(payload.floatConvolveAlpha)tryTransfer(payload.floatConvolveAlpha.alpha.buffer);
    if(payload.floatStyle){tryTransfer(payload.floatStyle.source.buffer);tryTransfer(payload.floatStyle.backdrop.buffer);}
    if(payload.floatComposite){tryTransfer(payload.floatComposite.source.buffer);tryTransfer(payload.floatComposite.backdrop.buffer);tryTransfer(payload.floatComposite.options.mask?.buffer);}
    if(payload.floatAffine)tryTransfer(payload.floatAffine.pixels.buffer);
    if(payload.floatProjective)tryTransfer(payload.floatProjective.pixels.buffer);
    if(payload.floatTone)tryTransfer(payload.floatTone.pixels.buffer);
    if(payload.floatTonal){tryTransfer(payload.floatTonal.pixels.buffer);tryTransfer(payload.floatTonal.coverage.buffer);}
    if(payload.floatTransfer)tryTransfer(payload.floatTransfer.pixels.buffer);
    if(payload.floatColor)tryTransfer(payload.floatColor.pixels.buffer);
    if(payload.floatGradient)tryTransfer(payload.floatGradient.pixels.buffer);
    if(payload.floatLookupApply)tryTransfer(payload.floatLookupApply.pixels.buffer);
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
