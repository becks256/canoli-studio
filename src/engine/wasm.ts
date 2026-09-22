import type { ToneEffectData } from "../core/model";
import type { SelectionData } from "../core/drawing";

export interface SelectionTile {
  selection: SelectionData;
  width: number;
  height: number;
  x: number;
  y: number;
  stepX: number;
  stepY: number;
}

export interface PixelKernel {
  memory: WebAssembly.Memory;
  bufferOffset(): number;
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
}

export async function instantiateKernel(
  bytes: BufferSource,
): Promise<PixelKernel> {
  const { instance } = await WebAssembly.instantiate(bytes, {
    env: {
      abort: () => {
        throw new Error("Image processing failed inside WASM.");
      },
    },
  });
  return instance.exports as unknown as PixelKernel;
}

export function renderSelection(
  kernel: PixelKernel,
  tile: SelectionTile,
): Uint8ClampedArray {
  const offset = kernel.bufferOffset(),
    length = tile.width * tile.height * 4;
  const regionsOffset = Math.ceil((offset + length) / 8) * 8;
  const values = new Float64Array(
    tile.selection.regions.flatMap((r) => [
      ["add", "subtract", "intersect"].indexOf(r.operation),
      r.shape === "ellipse" ? 1 : 0,
      r.x,
      r.y,
      r.width,
      r.height,
    ]),
  );
  const required = regionsOffset + values.byteLength;
  if (required > kernel.memory.buffer.byteLength)
    kernel.memory.grow(
      Math.ceil((required - kernel.memory.buffer.byteLength) / 65536),
    );
  new Float64Array(kernel.memory.buffer, regionsOffset, values.length).set(
    values,
  );
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
