import { wetPaintLoadSchema, wetPaintMixSchema, type WetPaintLoadOptions, type WetPaintMixOptions, type WetPaintResult } from '../core/wet-paint';
import type { PixelKernel } from './wasm';

// A working allocation policy, independent of source/document/whole-stroke size.
const maxComponents = 4_000_000 * 4;

export function validateWetPixels(pixels: Uint8ClampedArray): void {
  if (!(pixels instanceof Uint8ClampedArray) || pixels.length % 4 || pixels.length > maxComponents)
    throw new Error('Wet paint requires complete RGBA working tiles of at most 4,000,000 pixels. Split larger regions without resizing their source.');
}

export function validateWetCarried(carried: Float32Array, length: number): void {
  if (!(carried instanceof Float32Array) || carried.length !== length)
    throw new Error('Wet paint requires a matching Float32 premultiplied RGBA reservoir.');
  for (let i = 0; i < length; i += 4) {
    const alpha = carried[i + 3];
    if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1)
      throw new Error('Wet paint reservoir alpha must be finite and normalized.');
    for (let c = 0; c < 3; c++) if (!Number.isFinite(carried[i + c]) || carried[i + c] < 0 || carried[i + c] > alpha)
      throw new Error('Wet paint reservoir colors must be finite premultiplied channels between zero and alpha.');
  }
}

export function validateWetCoverage(coverage: Uint8Array, length: number): void {
  if (!(coverage instanceof Uint8Array) || coverage.length !== length / 4)
    throw new Error('Wet paint requires one coverage byte per destination pixel.');
}

/** All inputs are validated before scratch memory changes; outputs own their bytes. */
export function loadWetPaint(kernel: PixelKernel, pixels: Uint8ClampedArray, options: WetPaintLoadOptions = {}): Float32Array {
  validateWetPixels(pixels);
  const { color, load } = wetPaintLoadSchema.parse(options);
  const offset = Math.ceil(kernel.bufferOffset() / 4) * 4;
  const carriedOffset = offset + pixels.byteLength;
  allocate(kernel, carriedOffset + pixels.length * 4);
  new Uint8ClampedArray(kernel.memory.buffer, offset, pixels.length).set(pixels);
  kernel.loadWetPaint(offset, carriedOffset, pixels.length, ...color, load);
  return new Float32Array(kernel.memory.buffer, carriedOffset, pixels.length).slice();
}

/** Dab flow/coverage applies now; captured selection and stroke opacity apply once
 * to the completed original/result pair, never by scaling pickup on every dab. */
export function mixWetPaint(kernel: PixelKernel, pixels: Uint8ClampedArray, carried: Float32Array, coverage: Uint8Array, options: WetPaintMixOptions = {}): WetPaintResult {
  validateWetPixels(pixels);
  validateWetCarried(carried, pixels.length);
  validateWetCoverage(coverage, pixels.length);
  const { flow, wetness, pickup } = wetPaintMixSchema.parse(options);
  const offset = Math.ceil(kernel.bufferOffset() / 4) * 4;
  const carriedOffset = offset + pixels.byteLength, coverageOffset = carriedOffset + carried.byteLength;
  allocate(kernel, coverageOffset + coverage.byteLength);
  new Uint8ClampedArray(kernel.memory.buffer, offset, pixels.length).set(pixels);
  new Float32Array(kernel.memory.buffer, carriedOffset, carried.length).set(carried);
  new Uint8Array(kernel.memory.buffer, coverageOffset, coverage.length).set(coverage);
  kernel.mixWetPaint(offset, carriedOffset, coverageOffset, pixels.length, flow, wetness, pickup);
  return {
    pixels: new Uint8ClampedArray(kernel.memory.buffer, offset, pixels.length).slice(),
    carried: new Float32Array(kernel.memory.buffer, carriedOffset, carried.length).slice(),
  };
}

function allocate(kernel: PixelKernel, required: number) {
  if (!Number.isSafeInteger(required) || required > 0x100000000) throw new Error('Wet paint working storage exceeds the WASM address space.');
  if (required > kernel.memory.buffer.byteLength) kernel.memory.grow(Math.ceil((required - kernel.memory.buffer.byteLength) / 65536));
}
