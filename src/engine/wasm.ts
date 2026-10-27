import { redEyeAdjustmentSchema, type RedEyeAdjustmentData } from "../core/red-eye";
import { medianRadiusSchema } from '../core/smart/median-filter';
import {bilateralOptionsSchema,bilateralWeights,type BilateralFilterOptions} from '../core/smart/bilateral-filter';
import { colorRangeOptionsSchema, colorRangeSamples, type ColorRangeOptions } from "../core/color-range";
import { textureMaskOptionsSchema, type TextureMaskOptions } from '../core/brush-texture';
import { BRADFORD_D65_TO_D50, SRGB_TO_XYZ_D65, WHITE_POINT_D50, multiplyMatrix3x3 } from "../core/color/spaces";
import { lutAdjustmentSchema, lutValues, type LutAdjustmentData } from "../core/lut";
import { whiteBalanceAdjustmentSchema, whiteBalanceMatrix, WHITE_BALANCE_NEUTRAL, type WhiteBalanceAdjustmentData } from "../core/white-balance";
import { srgbToLinear } from "../core/color/spaces";
import {
  hslAdjustmentSchema,
  type HslAdjustmentData,
  chromaticAdjustmentSchema,
  type ChromaticAdjustmentData,
} from "../core/adjustments";
import { gradientMapAdjustmentSchema, packGradientStops, type GradientMapAdjustmentData } from "../core/gradient-map";
import {
  gaussianWeights,
  spatialFilterSupport,
  type SpatialFilterOptions,
} from "../core/smart/spatial-filter";
import type { DonorValidity } from "../core/retouch/donor";
import { selectionRegionTransform } from "../core/drawing";
import type { PoissonLinearSolver } from "../core/retouch/poisson-solver";
import type { ToneEffectData } from "../core/model";
import type { SelectionData } from "../core/drawing";
import type { HistogramData } from "../core/histogram";

export interface SelectionTile {
  selection: SelectionData;
  width: number;
  height: number;
  x: number;
  y: number;
  stepX: number;
  stepY: number;
  /** Change in local X per output row, and local Y per output column. */
  stepXY?: number;
  stepYX?: number;
}
interface QuickSelectionKernel {
  quickSelectionInit(pixels:number,state:number,count:number,spans:number,spanCount:number,values:number,tolerance:number):void;
  quickSelectionSpan(pixels:number,state:number,count:number,width:number,start:number,end:number,dy:number,values:number,output:number,capacity:number,force:boolean):void;
  quickSelectionAlpha(pixels:number,state:number,start:number,count:number,output:number):void;
}

export interface PixelKernel extends QuickSelectionKernel {
  transferFloat(source:number,output:number,tables:number,pixels:number):number;
  compositeFloat(source:number,backdrop:number,output:number,mask:number,scratch:number,pixels:number,opacity:number,mode:number):number;
  affineFloat(source:number,output:number,matrix:number,pixels:number):number;
  toneFloat(source:number,output:number,pixels:number,exposure:number,contrast:number,saturation:number):number;
  bilateralFilter(input:number,output:number,spatial:number,range:number,width:number,height:number,radius:number,amount:number):void;
  medianFilter(input:number,output:number,scratch:number,width:number,height:number,radius:number):void;
  encodeFrequencyBand(source:number,low:number,length:number,correction:boolean):void;
  compositeLinearBlend(source: number, backdrop: number, length: number, opacity: number, mode: number): void;
  loadWetPaint(pixels:number,carried:number,length:number,red:number,green:number,blue:number,alpha:number,amount:number):void;
  mixWetPaint(pixels:number,carried:number,coverage:number,length:number,flow:number,wetness:number,pickup:number):void;
  brushTextureMask(ptr: number, length: number, luminance: boolean, invert: boolean,support:number): void;
  mattingMultiply(graph:number,chunkSize:number,rowStride:number,chunkBytes:number,count:number,input:number,output:number):void;
  mattingCondition(graph:number,chunkSize:number,rowStride:number,chunkBytes:number,count:number,input:number,output:number,diagonal:number,hasFactor:boolean):void;
  subjectModel(pixels:number,width:number,height:number,values:number):void;
  subjectMaximum(pixels:number,width:number,height:number,start:number,count:number,values:number):void;
  subjectAlpha(pixels:number,width:number,height:number,start:number,count:number,values:number,threshold:number,output:number):void;
  adjustWhiteBalance(ptr: number, length: number, values: number, neutral: boolean): void;
  adjustLookup(ptr: number, length: number, table: number, params: number, size: number, dimension: number, tetrahedral: boolean): void;
  selectColorRange(ptr:number,length:number,values:number,includes:number,excludes:number,fuzziness:number,invert:boolean):void;
  adjustRedEye(ptr: number, length: number, threshold: number, strength: number): void;
  adjustGradientMap(ptr: number, length: number, stops: number, count: number, reverse: boolean): void;
  adjustChromatic(ptr: number, length: number, values: number, vibrance: boolean): void;
  adjustHsl(
    ptr: number,
    length: number,
    hue: number,
    saturation: number,
    lightness: number,
  ): void;
  spatialFilter(
    ptr: number,
    scratch: number,
    weightsX: number,
    weightsY: number,
    width: number,
    height: number,
    radiusX: number,
    radiusY: number,
    unsharp: boolean,
    amount: number,
    threshold: number,
    band?: number,
  ): void;
  poissonSolve(
    matrix: number,
    diagonal: number,
    x: number,
    b: number,
    scratch: number,
    report: number,
    n: number,
    tolerance: number,
    limit: number,
  ): void;
  memory: WebAssembly.Memory;
  donorValidity(
    blocked: number,
    support: number,
    count: number,
    stride: number,
    minX: number,
    maxX: number,
    minY: number,
    maxY: number,
    output: number,
  ): void;
  bufferOffset(): number;
  featherAlpha(
    ptr: number,
    scratchA: number,
    scratchB: number,
    width: number,
    height: number,
    radiusX: number,
    radiusY: number,
  ): void;
  selectionMask(
    ptr: number,
    regions: number,
    count: number,
    width: number,
    height: number,
    x: number,
    y: number,
    stepX: number,
    stepY: number,
    stepXY: number,
    stepYX: number,
  ): void;
  blendIf(
    ptr: number,
    backdrop: number,
    length: number,
    component: number,
    s0: number,
    s1: number,
    s2: number,
    s3: number,
    b0: number,
    b1: number,
    b2: number,
    b3: number,
  ): void;
  adjust(
    ptr: number,
    length: number,
    exposure: number,
    contrast: number,
    saturation: number,
  ): void;
  applyLut(ptr: number, length: number, lutPtr: number): void;
  blendAdjustment(
    targetPtr: number,
    adjustedPtr: number,
    maskPtr: number,
    length: number,
    hasMask: boolean,
    opacity: number,
  ): void;
  mixFiltered(
    originalPtr: number,
    filteredPtr: number,
    maskPtr: number,
    length: number,
    density: number,
    inverted: boolean,
  ): void;
  histogram(ptr: number, length: number, outPtr: number): void;
}

/** Reuses the worker's linear memory; no per-iteration allocation or host calls. */
export function wasmPoissonSolver(kernel: PixelKernel): PoissonLinearSolver {
  return (neighbors, diagonal, x, b, tolerance, limit) => {
    const n = x.length;
    const matrixPtr = Math.ceil(kernel.bufferOffset() / 8) * 8;
    const diagonalPtr = matrixPtr + n * 16,
      xPtr = diagonalPtr + n * 8,
      bPtr = xPtr + n * 8;
    const scratchPtr = bPtr + n * 8,
      reportPtr = scratchPtr + n * 32,
      required = reportPtr + 16;
    if (
      !Number.isSafeInteger(required) ||
      required > 0x100000000 ||
      limit > 0x7fffffff ||
      neighbors.length !== n * 4 ||
      diagonal.length !== n ||
      b.length !== n
    ) {
      throw new Error(
        "Poisson working buffers or iteration budget exceed the WASM addressable range.",
      );
    }
    if (required > kernel.memory.buffer.byteLength)
      kernel.memory.grow(
        Math.ceil((required - kernel.memory.buffer.byteLength) / 65536),
      );
    new Int32Array(kernel.memory.buffer, matrixPtr, n * 4).set(neighbors);
    new Float64Array(kernel.memory.buffer, diagonalPtr, n).set(diagonal);
    new Float64Array(kernel.memory.buffer, xPtr, n).set(x);
    new Float64Array(kernel.memory.buffer, bPtr, n).set(b);
    kernel.poissonSolve(
      matrixPtr,
      diagonalPtr,
      xPtr,
      bPtr,
      scratchPtr,
      reportPtr,
      n,
      tolerance,
      limit,
    );
    x.set(new Float64Array(kernel.memory.buffer, xPtr, n));
    return {
      residual: new Float64Array(kernel.memory.buffer, reportPtr, 1)[0],
      iterations: new Int32Array(kernel.memory.buffer, reportPtr + 8, 1)[0],
    };
  };
}

const compiledKernels=new WeakMap<PixelKernel,WebAssembly.Module>();
/** Private memory for long-lived graph work; unrelated pixel requests cannot overwrite it. */
export function forkPixelKernel(kernel:PixelKernel):PixelKernel {
  const module=compiledKernels.get(kernel);
  if(!module)throw new Error('Missing compiled image kernel.');
  return instantiateCompiledKernel(module);
}
function instantiateCompiledKernel(module:WebAssembly.Module):PixelKernel {
  const instance=new WebAssembly.Instance(module,{env:{abort:()=>{throw new Error('Image processing failed inside WASM.');}}});
  const kernel=instance.exports as unknown as PixelKernel;compiledKernels.set(kernel,module);return kernel;
}
export async function instantiateKernel(
  bytes: BufferSource,
): Promise<PixelKernel> {
  return instantiateCompiledKernel(await WebAssembly.compile(bytes));
}

/** Encoded-channel luminance coverage; no main-thread pixel loop or source mutation. */
export function prepareBrushTexture(kernel: PixelKernel, pixels: Uint8ClampedArray, options: TextureMaskOptions = {},support?:Uint8ClampedArray): Uint8ClampedArray {
  const settings = textureMaskOptionsSchema.parse(options);
  if (!(pixels instanceof Uint8ClampedArray) || pixels.length % 4 || pixels.length > 16_000_000)
    throw new Error('Texture conversion requires complete RGBA pixels in a working tile of at most 4,000,000 pixels.');
  if(support!==undefined&&(!(support instanceof Uint8ClampedArray)||support.length!==pixels.length))throw new Error('Texture support must match its RGBA working tile.');
  const input = pixels.slice();
  const capturedSupport=support?.slice();
  const offset = kernel.bufferOffset(),supportOffset=capturedSupport?offset+input.byteLength:0,required = offset + input.byteLength+(capturedSupport?.byteLength??0);
  if (required > kernel.memory.buffer.byteLength)
    kernel.memory.grow(Math.ceil((required - kernel.memory.buffer.byteLength) / 65536));
  new Uint8ClampedArray(kernel.memory.buffer, offset, input.byteLength).set(input);
  if(capturedSupport)new Uint8ClampedArray(kernel.memory.buffer,supportOffset,capturedSupport.byteLength).set(capturedSupport);
  kernel.brushTextureMask(offset, input.byteLength, settings.channel === 'luminance', settings.invert,supportOffset);
  return new Uint8ClampedArray(kernel.memory.buffer, offset, input.byteLength).slice();
}

export function renderSelection(
  kernel: PixelKernel,
  tile: SelectionTile,
): Uint8ClampedArray {
  const offset = kernel.bufferOffset(),
    length = tile.width * tile.height * 4;
  const regionsOffset = Math.ceil((offset + length) / 8) * 8;
  let coverageOffset = regionsOffset + tile.selection.regions.length * 128;
  const coverageArrays: { offset: number; values: Float64Array }[] = [];
  const values = new Float64Array(
    tile.selection.regions.flatMap((r) => {
      const pointer = coverageOffset;
      if (r.coverage) { const values = new Float64Array(r.coverage.runs); coverageArrays.push({ offset: pointer, values }); coverageOffset += values.byteLength; }
      const inverse = selectionRegionTransform(r).inverse();
      return [
        ["add", "subtract", "intersect"].indexOf(r.operation),
        r.shape === "pixels" ? 2 : r.shape === "ellipse" ? 1 : 0,
        r.x,
        r.y,
        r.width,
        r.height,
        inverse.a,
        inverse.b,
        inverse.c,
        inverse.d,
        inverse.e,
        inverse.f,
        r.coverage?.width ?? 0, r.coverage?.height ?? 0, pointer, (r.coverage?.runs.length ?? 0) / 2,
      ];
    }),
  );
  const required = coverageOffset;
  if (required > kernel.memory.buffer.byteLength)
    kernel.memory.grow(
      Math.ceil((required - kernel.memory.buffer.byteLength) / 65536),
    );
  new Float64Array(kernel.memory.buffer, regionsOffset, values.length).set(
    values,
  );
  for (const entry of coverageArrays) new Float64Array(kernel.memory.buffer, entry.offset, entry.values.length).set(entry.values);
  kernel.selectionMask(
    offset,
    regionsOffset,
    tile.selection.regions.length,
    tile.width,
    tile.height,
    tile.x,
    tile.y,
    tile.stepX,
    tile.stepY,
    tile.stepXY ?? 0,
    tile.stepYX ?? 0,
  );
  return new Uint8ClampedArray(kernel.memory.buffer, offset, length).slice();
}

export function applyTone(
  kernel: PixelKernel,
  pixels: Uint8ClampedArray,
  effects: ToneEffectData[],
): Uint8ClampedArray {
  if (pixels.byteLength % 4 !== 0) throw new Error("Expected RGBA pixels.");
  const offset = kernel.bufferOffset();
  const required = offset + pixels.byteLength;
  if (required > kernel.memory.buffer.byteLength)
    kernel.memory.grow(
      Math.ceil((required - kernel.memory.buffer.byteLength) / 65536),
    );
  new Uint8ClampedArray(kernel.memory.buffer, offset, pixels.byteLength).set(
    pixels,
  );
  for (const effect of effects) {
    if (effect.enabled)
      kernel.adjust(
        offset,
        pixels.byteLength,
        effect.exposure,
        effect.contrast,
        effect.saturation,
      );
  }
  return new Uint8ClampedArray(
    kernel.memory.buffer,
    offset,
    pixels.byteLength,
  ).slice();
}

export function applyBlendIf(
  kernel: PixelKernel,
  pixels: Uint8ClampedArray,
  underlying: Uint8ClampedArray,
  options: import("../core/drawing").BlendIfData,
): Uint8ClampedArray {
  if (pixels.byteLength !== underlying.byteLength || pixels.byteLength % 4)
    throw new Error("Blend If requires matching RGBA buffers.");
  if (!options.enabled) return pixels.slice();
  const offset = kernel.bufferOffset(),
    backdrop = offset + pixels.byteLength;
  const required = backdrop + underlying.byteLength;
  if (required > kernel.memory.buffer.byteLength)
    kernel.memory.grow(
      Math.ceil((required - kernel.memory.buffer.byteLength) / 65536),
    );
  new Uint8ClampedArray(kernel.memory.buffer, offset, pixels.byteLength).set(
    pixels,
  );
  new Uint8ClampedArray(
    kernel.memory.buffer,
    backdrop,
    underlying.byteLength,
  ).set(underlying);
  const component = ["red", "green", "blue"].indexOf(options.channel);
  kernel.blendIf(
    offset,
    backdrop,
    pixels.byteLength,
    component,
    ...options.source,
    ...options.underlying,
  );
  return new Uint8ClampedArray(
    kernel.memory.buffer,
    offset,
    pixels.byteLength,
  ).slice();
}

export interface FeatherTile {
  width: number;
  height: number;
  radiusX: number;
  radiusY: number;
}
export function featherAlpha(
  kernel: PixelKernel,
  pixels: Uint8ClampedArray,
  tile: FeatherTile,
): Uint8ClampedArray {
  const { width, height, radiusX, radiusY } = tile;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > 4_000_000 ||
    pixels.length !== width * height * 4 ||
    !Number.isFinite(radiusX) ||
    !Number.isFinite(radiusY) ||
    radiusX < 0 ||
    radiusY < 0 ||
    radiusX > 4096 ||
    radiusY > 4096
  ) {
    throw new Error("Invalid mask feather working tile.");
  }
  const offset = Math.ceil(kernel.bufferOffset() / 4) * 4;
  const required = offset + pixels.byteLength * 3;
  if (required > kernel.memory.buffer.byteLength)
    kernel.memory.grow(
      Math.ceil((required - kernel.memory.buffer.byteLength) / 65536),
    );
  new Uint8ClampedArray(kernel.memory.buffer, offset, pixels.length).set(
    pixels,
  );
  kernel.featherAlpha(
    offset,
    offset + pixels.byteLength,
    offset + pixels.byteLength * 2,
    width,
    height,
    radiusX,
    radiusY,
  );
  return new Uint8ClampedArray(
    kernel.memory.buffer,
    offset,
    pixels.length,
  ).slice();
}

export function applyLut(
  kernel: PixelKernel,
  pixels: Uint8ClampedArray,
  luts: Uint8Array, // 768 bytes
): Uint8ClampedArray {
  if (luts.byteLength !== 768) {
    throw new Error("applyLut expects 768-byte combined RGB LUTs.");
  }
  const offset = Math.ceil(kernel.bufferOffset() / 4) * 4;
  const lutOffset = Math.ceil((offset + pixels.byteLength) / 4) * 4;
  const required = lutOffset + 768;
  if (required > kernel.memory.buffer.byteLength) {
    kernel.memory.grow(
      Math.ceil((required - kernel.memory.buffer.byteLength) / 65536),
    );
  }
  new Uint8ClampedArray(kernel.memory.buffer, offset, pixels.byteLength).set(
    pixels,
  );
  new Uint8Array(kernel.memory.buffer, lutOffset, 768).set(luts);
  kernel.applyLut(offset, pixels.byteLength, lutOffset);
  return new Uint8ClampedArray(
    kernel.memory.buffer,
    offset,
    pixels.byteLength,
  ).slice();
}

export function blendAdjustment(
  kernel: PixelKernel,
  target: Uint8ClampedArray,
  adjusted: Uint8ClampedArray,
  mask: Uint8ClampedArray | null,
  opacity: number,
): Uint8ClampedArray {
  if (target.byteLength !== adjusted.byteLength || target.byteLength % 4) {
    throw new Error("blendAdjustment requires matching RGBA buffers.");
  }
  if (mask && mask.byteLength !== target.byteLength) {
    throw new Error("Mask buffer size must match target buffer size.");
  }
  const offset = Math.ceil(kernel.bufferOffset() / 4) * 4;
  const adjustedOffset = offset + target.byteLength;
  const maskOffset = adjustedOffset + adjusted.byteLength;
  const totalLength = maskOffset + (mask ? mask.byteLength : 0);
  if (totalLength > kernel.memory.buffer.byteLength) {
    kernel.memory.grow(
      Math.ceil((totalLength - kernel.memory.buffer.byteLength) / 65536),
    );
  }
  new Uint8ClampedArray(kernel.memory.buffer, offset, target.byteLength).set(
    target,
  );
  new Uint8ClampedArray(
    kernel.memory.buffer,
    adjustedOffset,
    adjusted.byteLength,
  ).set(adjusted);
  if (mask) {
    new Uint8ClampedArray(
      kernel.memory.buffer,
      maskOffset,
      mask.byteLength,
    ).set(mask);
  }
  kernel.blendAdjustment(
    offset,
    adjustedOffset,
    maskOffset,
    target.byteLength,
    !!mask,
    opacity,
  );
  return new Uint8ClampedArray(
    kernel.memory.buffer,
    offset,
    target.byteLength,
  ).slice();
}

export function computeWasmHistogram(
  kernel: PixelKernel,
  pixels: Uint8ClampedArray,
): HistogramData {
  const offset = Math.ceil(kernel.bufferOffset() / 4) * 4;
  const outOffset = Math.ceil((offset + pixels.byteLength) / 4) * 4;
  const required = outOffset + 4096; // 1024 u32s
  if (required > kernel.memory.buffer.byteLength) {
    kernel.memory.grow(
      Math.ceil((required - kernel.memory.buffer.byteLength) / 65536),
    );
  }
  new Uint8ClampedArray(kernel.memory.buffer, offset, pixels.byteLength).set(
    pixels,
  );
  kernel.histogram(offset, pixels.byteLength, outOffset);

  const u32s = new Uint32Array(kernel.memory.buffer, outOffset, 1024);
  const red = new Uint32Array(u32s.subarray(0, 256));
  const green = new Uint32Array(u32s.subarray(256, 512));
  const blue = new Uint32Array(u32s.subarray(512, 768));
  const luminance = new Uint32Array(u32s.subarray(768, 1024));

  let totalPixels = 0;
  let maxCount = 0;
  let sumLuminance = 0;
  let minLum = 255;
  let maxLum = 0;

  for (let i = 0; i < 256; i++) {
    if (red[i] > maxCount) maxCount = red[i];
    if (green[i] > maxCount) maxCount = green[i];
    if (blue[i] > maxCount) maxCount = blue[i];
    if (luminance[i] > maxCount) maxCount = luminance[i];

    const count = luminance[i];
    totalPixels += count;
    sumLuminance += i * count;
    if (count > 0) {
      if (i < minLum) minLum = i;
      if (i > maxLum) maxLum = i;
    }
  }

  if (totalPixels === 0) {
    return {
      red,
      green,
      blue,
      luminance,
      totalPixels: 0,
      maxCount: 0,
      mean: 0,
      median: 0,
      stdDev: 0,
      min: 0,
      max: 0,
    };
  }

  const mean = sumLuminance / totalPixels;
  let varianceSum = 0;
  for (let val = 0; val < 256; val++) {
    const count = luminance[val];
    if (count > 0) {
      const diff = val - mean;
      varianceSum += diff * diff * count;
    }
  }
  const stdDev = Math.sqrt(varianceSum / totalPixels);

  const half = Math.floor(totalPixels / 2);
  let accumulated = 0;
  let median = 0;
  for (let val = 0; val < 256; val++) {
    accumulated += luminance[val];
    if (accumulated >= half) {
      median = val;
      break;
    }
  }

  return {
    red,
    green,
    blue,
    luminance,
    totalPixels,
    maxCount,
    mean: Math.round(mean * 100) / 100,
    median,
    stdDev: Math.round(stdDev * 100) / 100,
    min: minLum,
    max: maxLum,
  };
}

/** Internal validated packed-mask ABI; numerical scoring remains in the host. */
export function wasmDonorValidity(kernel: PixelKernel): DonorValidity {
  return ({ blocked, support, stride, minX, maxX, minY, maxY }) => {
    const columns = maxX - minX + 1,
      rows = maxY - minY + 1;
    const count = columns * rows;
    if (
      ![stride, minX, maxX, minY, maxY, columns, rows, count].every(
        Number.isSafeInteger,
      ) ||
      stride <= 0 ||
      columns <= 0 ||
      rows <= 0 ||
      blocked.length % stride ||
      [
        stride,
        Math.abs(minX),
        Math.abs(maxX),
        Math.abs(minY),
        Math.abs(maxY),
        support.length,
      ].some((value) => value > 0x7fffffff)
    )
      throw new Error("Invalid donor validity geometry.");
    const height = blocked.length / stride;
    const packed = new Uint32Array(support.length * 3);
    support.forEach((word, i) => {
      if (
        ![word.row, word.column, word.bits].every(Number.isSafeInteger) ||
        word.column < 0 ||
        word.column > 0x7fffffff ||
        word.row + minY < 0 ||
        word.row + maxY >= height ||
        word.bits < 0 ||
        word.bits > 0xffffffff
      )
        throw new Error("Invalid donor support coordinates.");
      packed.set([word.row, word.column, word.bits], i * 3);
    });
    const base = Math.ceil(kernel.bufferOffset() / 4) * 4;
    const supportPtr = base + blocked.byteLength,
      output = supportPtr + packed.byteLength,
      required = output + count;
    if (!Number.isSafeInteger(required) || required > 0xffffffff)
      throw new Error("Donor working buffers exceed WASM address space.");
    const pages = Math.ceil(required / 65536);
    if (pages > kernel.memory.buffer.byteLength / 65536)
      kernel.memory.grow(pages - kernel.memory.buffer.byteLength / 65536);
    new Uint32Array(kernel.memory.buffer, base, blocked.length).set(blocked);
    new Uint32Array(kernel.memory.buffer, supportPtr, packed.length).set(
      packed,
    );
    kernel.donorValidity(
      base,
      supportPtr,
      support.length,
      stride,
      minX,
      maxX,
      minY,
      maxY,
      output,
    );
    return new Uint8Array(kernel.memory.buffer, output, count).slice();
  };
}

/** Full 2D worker kernel; source ownership and center alpha remain unchanged. */
export function applyBilateralFilter(kernel:PixelKernel,pixels:Uint8ClampedArray,
  width:number,height:number,options:BilateralFilterOptions):Uint8ClampedArray {
  const settings=bilateralOptionsSchema.parse(options);
  if(!(pixels instanceof Uint8ClampedArray)||![width,height,width*height].every(v=>Number.isSafeInteger(v)&&v>0)||
    width>8192||height>8192||width*height>4_000_000||pixels.length!==width*height*4)
    throw new Error('Invalid bilateral-filter tile geometry.');
  if(settings.radius===0||settings.colorSigma===0||settings.amount===0)return pixels.slice();
  const length=pixels.length,input=pixels.buffer===kernel.memory.buffer?pixels.slice():pixels;
  const weights=bilateralWeights(settings.radius,settings.colorSigma),ptr=Math.ceil(kernel.bufferOffset()/8)*8,output=ptr+length;
  const spatial=Math.ceil((output+length)/8)*8,range=spatial+weights.spatial.byteLength,required=range+weights.range.byteLength;
  if(!Number.isSafeInteger(required)||required>0x7fffffff)throw new Error('Bilateral-filter working buffers exceed the WASM addressable range.');
  if(required>kernel.memory.buffer.byteLength)kernel.memory.grow(Math.ceil((required-kernel.memory.buffer.byteLength)/65536));
  new Uint8ClampedArray(kernel.memory.buffer,ptr,length).set(input);
  new Float64Array(kernel.memory.buffer,spatial,weights.spatial.length).set(weights.spatial);
  new Float64Array(kernel.memory.buffer,range,weights.range.length).set(weights.range);
  kernel.bilateralFilter(ptr,output,spatial,range,width,height,settings.radius,settings.amount);
  return new Uint8ClampedArray(kernel.memory.buffer,output,length).slice();
}

/** Private output and a fixed 3096-byte histogram workspace; original RGBA stays untouched. */
export function applyMedianFilter(kernel: PixelKernel, pixels: Uint8ClampedArray,
  width: number, height: number, radius: number): Uint8ClampedArray {
  medianRadiusSchema.parse(radius);
  const length=pixels.length;
  if (!(pixels instanceof Uint8ClampedArray) ||
    ![width,height,width*height].every(v=>Number.isSafeInteger(v)&&v>0) ||
    width > 8192 || height > 8192 || width*height > 4_000_000 || length !== width*height*4)
    throw new Error('Invalid median-filter tile geometry.');
  if (radius === 0) return pixels.slice();
  // Capture a possible WASM view before growing memory.
  const input = pixels.buffer === kernel.memory.buffer ? pixels.slice() : pixels;
  const ptr = Math.ceil(kernel.bufferOffset()/4)*4, output = ptr + length;
  const scratch = output + length, required = scratch + 3096;
  if (!Number.isSafeInteger(required) || required > 0x7fffffff)
    throw new Error('Median-filter working buffers exceed the WASM addressable range.');
  if (required > kernel.memory.buffer.byteLength)
    kernel.memory.grow(Math.ceil((required-kernel.memory.buffer.byteLength)/65536));
  new Uint8ClampedArray(kernel.memory.buffer,ptr,length).set(input);
  kernel.medianFilter(ptr,output,scratch,width,height,radius);
  return new Uint8ClampedArray(kernel.memory.buffer,output,length).slice();
}

/** Internal spatial-filter worker ABI. Input ownership and hidden source pixels remain untouched. */
export function applySpatialFilter(
  kernel: PixelKernel,
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  options: SpatialFilterOptions,
): Uint8ClampedArray {
  const support = spatialFilterSupport(options);
  const count = width * height;
  if (
    ![width, height, count].every(
      (value) => Number.isSafeInteger(value) && value > 0,
    ) ||
    width > 0x7fffffff ||
    height > 0x7fffffff ||
    count * 4 !== pixels.length
  )
    throw new Error("Invalid spatial-filter tile geometry.");
  if (
    (!support.x && !support.y && options.kind !== "frequency-band") ||
    (options.kind === "unsharp-mask" && options.amount === 0)
  )
    return pixels.slice();
  const input = pixels.buffer === kernel.memory.buffer ? pixels.slice() : pixels;
  const wx = gaussianWeights(options.sigmaX),
    wy = gaussianWeights(options.sigmaY ?? options.sigmaX);
  const ptr = Math.ceil(kernel.bufferOffset() / 8) * 8;
  const scratch = Math.ceil((ptr + pixels.length) / 8) * 8;
  const weightsX = scratch + count * 32,
    weightsY = weightsX + wx.byteLength,
    required = weightsY + wy.byteLength;
  if (!Number.isSafeInteger(required) || required > 0x7fffffff)
    throw new Error(
      "Spatial-filter working buffers exceed the WASM addressable range.",
    );
  if (required > kernel.memory.buffer.byteLength)
    kernel.memory.grow(
      Math.ceil((required - kernel.memory.buffer.byteLength) / 65536),
    );
  new Uint8Array(kernel.memory.buffer, ptr, pixels.length).set(input);
  new Float64Array(kernel.memory.buffer, weightsX, wx.length).set(wx);
  new Float64Array(kernel.memory.buffer, weightsY, wy.length).set(wy);
  kernel.spatialFilter(
    ptr,
    scratch,
    weightsX,
    weightsY,
    width,
    height,
    support.x,
    support.y,
    options.kind === "unsharp-mask",
    options.kind === "unsharp-mask" ? options.amount : 0,
    options.kind === "unsharp-mask" ? (options.threshold ?? 0) : 0,
    options.kind === "frequency-band" ? (options.band === "low" ? 1 : options.band === "high" ? 2 : 3) : 0,
  );
  return new Uint8ClampedArray(
    kernel.memory.buffer,
    ptr,
    pixels.length,
  ).slice();
}

/** Encoded-sRGB premultiplied interpolation; mask alpha is filter coverage. */
export function mixFiltered(
  kernel: PixelKernel,
  original: Uint8ClampedArray,
  filtered: Uint8ClampedArray,
  mask: Uint8ClampedArray,
  density = 1,
  inverted = false,
): Uint8ClampedArray {
  const length = original.byteLength;
  if (
    length % 4 ||
    length !== filtered.byteLength ||
    length !== mask.byteLength ||
    length > 0x7ffffffc
  )
    throw new Error(
      "Filtered mixing requires matching RGBA buffers within the WASM ABI range.",
    );
  if (
    !Number.isFinite(density) ||
    density < 0 ||
    density > 1 ||
    typeof inverted !== "boolean"
  )
    throw new Error(
      "Filtered mixing requires density between zero and one and a boolean inversion flag.",
    );
  const offset = Math.ceil(kernel.bufferOffset() / 4) * 4;
  const filteredOffset = offset + length,
    maskOffset = filteredOffset + length;
  const required = maskOffset + length;
  if (required > 0x100000000)
    throw new Error("Filtered mixing exceeds WASM address space.");
  if (required > kernel.memory.buffer.byteLength)
    kernel.memory.grow(
      Math.ceil((required - kernel.memory.buffer.byteLength) / 65536),
    );
  new Uint8ClampedArray(kernel.memory.buffer, offset, length).set(original);
  new Uint8ClampedArray(kernel.memory.buffer, filteredOffset, length).set(
    filtered,
  );
  new Uint8ClampedArray(kernel.memory.buffer, maskOffset, length).set(mask);
  kernel.mixFiltered(
    offset,
    filteredOffset,
    maskOffset,
    length,
    density,
    inverted,
  );
  return new Uint8ClampedArray(kernel.memory.buffer, offset, length).slice();
}

/** Private snapshots remain valid when growing WASM memory or reusing its scratch region. */
export function applyHsl(
  kernel: PixelKernel,
  pixels: Uint8ClampedArray,
  adjustment: HslAdjustmentData,
): Uint8ClampedArray {
  const settings = hslAdjustmentSchema.parse(adjustment);
  if (pixels.length % 4 || pixels.length > 0x7fffffff)
    throw new Error(
      "HSL requires complete RGBA pixels within the kernel tile range.",
    );
  const input = pixels.slice();
  const offset = Math.ceil(kernel.bufferOffset() / 4) * 4,
    required = offset + input.byteLength;
  if (required > kernel.memory.buffer.byteLength)
    kernel.memory.grow(
      Math.ceil((required - kernel.memory.buffer.byteLength) / 65536),
    );
  new Uint8ClampedArray(kernel.memory.buffer, offset, input.byteLength).set(
    input,
  );
  kernel.adjustHsl(
    offset,
    input.byteLength,
    settings.hue,
    settings.saturation,
    settings.lightness,
  );
  return new Uint8ClampedArray(
    kernel.memory.buffer,
    offset,
    input.byteLength,
  ).slice();
}

/** Worker/reference ABI; snapshots caller data and reacquires views after memory growth. */
export function applyChromatic(kernel: PixelKernel,pixels: Uint8ClampedArray,adjustment: ChromaticAdjustmentData):Uint8ClampedArray {
  const settings=chromaticAdjustmentSchema.parse(adjustment);
  if(pixels.length%4||pixels.length>0x7fffffff)throw new Error('Chromatic adjustments require complete RGBA pixels within the kernel tile range.');
  const input=pixels.slice(),offset=Math.ceil(kernel.bufferOffset()/8)*8;
  const valuesOffset=Math.ceil((offset+input.byteLength)/8)*8;
  const values=settings.kind==='vibrance'?[settings.vibrance,settings.saturation]:[
    settings.shadows.red,settings.shadows.green,settings.shadows.blue,
    settings.midtones.red,settings.midtones.green,settings.midtones.blue,
    settings.highlights.red,settings.highlights.green,settings.highlights.blue,
    Number(settings.preserveLuminosity),
  ];
  const required=valuesOffset+values.length*8;
  if(required>kernel.memory.buffer.byteLength)kernel.memory.grow(Math.ceil((required-kernel.memory.buffer.byteLength)/65536));
  new Uint8ClampedArray(kernel.memory.buffer,offset,input.byteLength).set(input);
  new Float64Array(kernel.memory.buffer,valuesOffset,values.length).set(values);
  kernel.adjustChromatic(offset,input.byteLength,valuesOffset,settings.kind==='vibrance');
  return new Uint8ClampedArray(kernel.memory.buffer,offset,input.byteLength).slice();
}

/** Snapshot settings and pixels before growing WASM memory; never detach caller data. */
export function applyGradientMap(kernel: PixelKernel, pixels: Uint8ClampedArray, adjustment: GradientMapAdjustmentData): Uint8ClampedArray {
  const settings = gradientMapAdjustmentSchema.parse(adjustment);
  if (pixels.length % 4 || pixels.length > 0x7fffffff)
    throw new Error("Gradient maps require complete RGBA pixels within the kernel tile range.");
  const input = pixels.slice(), offset = Math.ceil(kernel.bufferOffset() / 8) * 8;
  const values = packGradientStops(settings.stops), stops = Math.ceil((offset + input.byteLength) / 8) * 8;
  const required = stops + values.length * 8;
  if (required > kernel.memory.buffer.byteLength)
    kernel.memory.grow(Math.ceil((required - kernel.memory.buffer.byteLength) / 65536));
  new Uint8ClampedArray(kernel.memory.buffer, offset, input.byteLength).set(input);
  new Float64Array(kernel.memory.buffer, stops, values.length).set(values);
  kernel.adjustGradientMap(offset, input.byteLength, stops, settings.stops.length, settings.reverse);
  return new Uint8ClampedArray(kernel.memory.buffer, offset, input.byteLength).slice();
}


const whiteBalanceDecode = Float64Array.from({length: 256}, (_, value) => srgbToLinear(value / 255));
export function applyColorRange(kernel:PixelKernel,pixels:Uint8ClampedArray,options:ColorRangeOptions):Uint8Array {
  const settings=colorRangeOptionsSchema.parse(options);
  if(pixels.length%4||pixels.length>0x7fffffff)throw new Error('Color Range requires complete RGBA pixels within the kernel tile range.');
  const matrix=multiplyMatrix3x3(BRADFORD_D65_TO_D50,SRGB_TO_XYZ_D65);
  const whites=[WHITE_POINT_D50.X,WHITE_POINT_D50.Y,WHITE_POINT_D50.Z];
  const samples=[...colorRangeSamples(settings.colors),...colorRangeSamples(settings.exclude)].flat();
  const values=[...matrix.flatMap((row,i)=>row.map(value=>value/whites[i])),...whiteBalanceDecode,...samples];
  const offset=Math.ceil(kernel.bufferOffset()/8)*8,params=Math.ceil((offset+pixels.byteLength)/8)*8,required=params+values.length*8;
  if(required>kernel.memory.buffer.byteLength)kernel.memory.grow(Math.ceil((required-kernel.memory.buffer.byteLength)/65536));
  new Uint8ClampedArray(kernel.memory.buffer,offset,pixels.length).set(pixels);
  new Float64Array(kernel.memory.buffer,params,values.length).set(values);
  kernel.selectColorRange(offset,pixels.length,params,settings.colors.length,settings.exclude.length,settings.fuzziness,settings.invert);
  const rgba=new Uint8Array(kernel.memory.buffer,offset,pixels.length),coverage=new Uint8Array(pixels.length/4);
  for(let i=0;i<coverage.length;i++)coverage[i]=rgba[i*4+3];
  return coverage;
}
/** Float32 portable table, float64 domain/amount and owned RGBA output. */
export function applyLookup(kernel: PixelKernel, pixels: Uint8ClampedArray, adjustment: LutAdjustmentData): Uint8ClampedArray {
  const settings = lutAdjustmentSchema.parse(adjustment), { lut } = settings;
  if (pixels.length % 4 || pixels.length > 0x7fffffff) throw new Error("LUT processing requires complete RGBA pixels within the kernel tile range.");
  const input = pixels.slice(), table = lutValues(lut);
  const offset = Math.ceil(kernel.bufferOffset() / 8) * 8, params = Math.ceil((offset + input.byteLength) / 8) * 8;
  const tableOffset = params + 56, required = tableOffset + table.byteLength;
  if (required > kernel.memory.buffer.byteLength) kernel.memory.grow(Math.ceil((required - kernel.memory.buffer.byteLength) / 65536));
  new Uint8ClampedArray(kernel.memory.buffer, offset, input.byteLength).set(input);
  new Float64Array(kernel.memory.buffer, params, 7).set([...lut.domainMin, ...lut.domainMax.map((value, i) => value - lut.domainMin[i]), settings.amount]);
  new Float32Array(kernel.memory.buffer, tableOffset, table.length).set(table);
  kernel.adjustLookup(offset, input.byteLength, tableOffset, params, lut.size, lut.dimension, settings.interpolation === "tetrahedral");
  return new Uint8ClampedArray(kernel.memory.buffer, offset, input.byteLength).slice();
}
/** Owned input/output and aligned parameters; every view is acquired after memory growth. */
export function applyWhiteBalance(kernel: PixelKernel, pixels: Uint8ClampedArray, adjustment: WhiteBalanceAdjustmentData): Uint8ClampedArray {
  const settings = whiteBalanceAdjustmentSchema.parse(adjustment);
  if (pixels.length % 4 || pixels.length > 0x7fffffff)
    throw new Error("White balance requires complete RGBA pixels within the kernel tile range.");
  const input = pixels.slice(), values = whiteBalanceMatrix(settings).flat();
  const offset = Math.ceil(kernel.bufferOffset() / 8) * 8, valuesOffset = Math.ceil((offset + input.byteLength) / 8) * 8;
  const required = valuesOffset + (9 + 256) * 8;
  if (required > kernel.memory.buffer.byteLength)
    kernel.memory.grow(Math.ceil((required - kernel.memory.buffer.byteLength) / 65536));
  new Uint8ClampedArray(kernel.memory.buffer, offset, input.byteLength).set(input);
  new Float64Array(kernel.memory.buffer, valuesOffset, 9).set(values);
  new Float64Array(kernel.memory.buffer, valuesOffset + 72, 256).set(whiteBalanceDecode);
  kernel.adjustWhiteBalance(offset, input.byteLength, valuesOffset, settings.temperature === WHITE_BALANCE_NEUTRAL && settings.tint === 0);
  return new Uint8ClampedArray(kernel.memory.buffer, offset, input.byteLength).slice();
}

/** Copy before memory growth, return owned pixels, leave source and alpha untouched. */
export function applyRedEye(kernel: PixelKernel, pixels: Uint8ClampedArray, adjustment: RedEyeAdjustmentData): Uint8ClampedArray {
  const settings = redEyeAdjustmentSchema.parse(adjustment);
  if (!(pixels instanceof Uint8ClampedArray) || pixels.length % 4 || pixels.length > 0x7fffffff)
    throw new Error("Red-eye correction requires complete RGBA pixels within the kernel tile range.");
  const input = pixels.slice(), offset = Math.ceil(kernel.bufferOffset() / 8) * 8;
  const required = offset + input.byteLength;
  if (required > kernel.memory.buffer.byteLength)
    kernel.memory.grow(Math.ceil((required - kernel.memory.buffer.byteLength) / 65536));
  new Uint8ClampedArray(kernel.memory.buffer, offset, input.length).set(input);
  kernel.adjustRedEye(offset, input.length, settings.threshold, settings.strength);
  return new Uint8ClampedArray(kernel.memory.buffer, offset, input.length).slice();
}

export function applyLinearBlend(kernel: PixelKernel, source: Uint8ClampedArray, backdrop: Uint8ClampedArray, opacity = 1, mode: "linear-light" | "linear-burn" = "linear-light"): Uint8ClampedArray {
  if (!(source instanceof Uint8ClampedArray) || !(backdrop instanceof Uint8ClampedArray) || source.length !== backdrop.length || source.length % 4 || !Number.isFinite(opacity) || opacity < 0 || opacity > 1 || source.length > 0x3fffffff || !["linear-light","linear-burn"].includes(mode))
    throw new Error("Invalid Linear Light RGBA tile or opacity.");
  const input=source.buffer===kernel.memory.buffer?source.slice():source,under=backdrop.buffer===kernel.memory.buffer?backdrop.slice():backdrop,offset=Math.ceil(kernel.bufferOffset()/8)*8,back=offset+input.length,required=back+under.length;
  if(required>kernel.memory.buffer.byteLength)kernel.memory.grow(Math.ceil((required-kernel.memory.buffer.byteLength)/65536));
  new Uint8ClampedArray(kernel.memory.buffer,offset,input.length).set(input);new Uint8ClampedArray(kernel.memory.buffer,back,under.length).set(under);
  kernel.compositeLinearBlend(offset,back,input.length,opacity,Number(mode==="linear-burn"));
  return new Uint8ClampedArray(kernel.memory.buffer,offset,input.length).slice();
}

export function applyEncodedFrequencyBand(kernel:PixelKernel,pixels:Uint8ClampedArray,low:Uint8ClampedArray,band:'high'|'correction'):Uint8ClampedArray {
  if(!(pixels instanceof Uint8ClampedArray)||!(low instanceof Uint8ClampedArray)||pixels.length!==low.length||pixels.length%4||pixels.length>0x3fffffff||!['high','correction'].includes(band))throw new Error('Invalid frequency encoding RGBA planes.');
  const input=pixels.buffer===kernel.memory.buffer?pixels.slice():pixels,base=low.buffer===kernel.memory.buffer?low.slice():low,offset=Math.ceil(kernel.bufferOffset()/8)*8,lowOffset=offset+input.length,required=lowOffset+base.length;
  if(required>kernel.memory.buffer.byteLength)kernel.memory.grow(Math.ceil((required-kernel.memory.buffer.byteLength)/65536));
  new Uint8ClampedArray(kernel.memory.buffer,offset,input.length).set(input);new Uint8ClampedArray(kernel.memory.buffer,lowOffset,base.length).set(base);
  kernel.encodeFrequencyBand(offset,lowOffset,input.length,band==='correction');return new Uint8ClampedArray(kernel.memory.buffer,offset,input.length).slice();
}
