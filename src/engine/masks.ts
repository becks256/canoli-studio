import { AffineTransform } from "../core/affine";
import { maskGeometry } from "../core/masks";
import type { LayerMaskData } from "../core/masks";
import type { PixelProcessor } from "./processor";
import type { RenderSpace } from "./canvas";
import { createCanvas, release } from "./canvas";
import {
  ActiveStrokeRaster,
  drawMaskStroke,
  selectionMask,
  vectorMask,
  paintedMask,
  bitmapMask,
} from "./drawing";

import { CanvasCache } from "./cache";

/** Finished coverage shares the viewport LRU; raw active stamps have a separate bounded LRU. */
export class PaintedMaskRaster {
  private active = new Map<
    string,
    { raster: ActiveStrokeRaster; bytes: number }
  >();
  private bytes = 0;
  private hits = 0;
  private replays = 0;
  private appended = 0;
  constructor(
    private cache: CanvasCache,
    readonly budget = 16 * 1024 * 1024,
  ) {}
  get diagnostics() {
    return {
      prefixHits: this.hits,
      prefixReplays: this.replays,
      appendedPoints: this.appended,
      activeBytes: this.bytes,
    };
  }
  clear() {
    for (const entry of this.active.values()) entry.raster.clear();
    this.active.clear();
    this.bytes = 0;
  }
  private surface(key: string, bytes: number) {
    if (bytes > this.budget) return undefined;
    const found = this.active.get(key);
    if (found) {
      this.active.delete(key);
      this.active.set(key, found);
      return found.raster;
    }
    while (this.bytes + bytes > this.budget || this.active.size >= 64) {
      const oldest = this.active.keys().next().value!;
      const entry = this.active.get(oldest)!;
      entry.raster.clear();
      this.active.delete(oldest);
      this.bytes -= entry.bytes;
    }
    const raster = new ActiveStrokeRaster();
    this.active.set(key, { raster, bytes });
    this.bytes += bytes;
    return raster;
  }
  async render(
    mask: LayerMaskData,
    space: RenderSpace,
    x: number,
    y: number,
    processor: PixelProcessor,
    key: string,
    canCache: () => boolean,
    world = AffineTransform.translation(x, y),
    bitmap?: ImageBitmap | HTMLCanvasElement,
  ) {
    if (!mask.strokes?.length || !canCache())
      return paintedMask(mask, space, x, y, processor, world, bitmap);
    const location = JSON.stringify([space, world]);
    const cacheKey = `painted:${key}:${location}`;
    const prefix = mask.strokes.slice(0, -1);
    const prefixSignature = JSON.stringify(
      maskGeometry({ ...mask, strokes: prefix }),
    );
    let output = createCanvas(space.width, space.height);
    try {
      const cachedPrefix = this.cache.read(
        cacheKey + ":prefix",
        prefixSignature,
        output,
      );
      if (
        cachedPrefix ||
        this.cache.read(cacheKey + ":full", prefixSignature, output)
      )
        this.hits++;
      else {
        release(output);
        output = await paintedMask(
          { ...mask, strokes: prefix },
          space,
          x,
          y,
          processor,
          world,
          bitmap,
        );
        this.replays++;
      }
      if (!cachedPrefix && canCache())
        this.cache.write(cacheKey + ":prefix", prefixSignature, output);
      const active = canCache()
        ? this.surface(cacheKey, space.width * space.height * 4)
        : undefined;
      const before = active?.appendedPoints ?? 0;
      await drawMaskStroke(
        mask.strokes.at(-1)!,
        output,
        space,
        x,
        y,
        processor,
        active,
        world,
      );
      if (active) this.appended += active.appendedPoints - before;
      if (canCache())
        this.cache.write(
          cacheKey + ":full",
          JSON.stringify(maskGeometry(mask)),
          output,
        );
      return output;
    } catch (error) {
      release(output);
      throw error;
    }
  }
}
interface MaskRetention {
  paint: PaintedMaskRaster;
  key: string;
  canCache(): boolean;
}
const rawCoverage = (
  mask: LayerMaskData,
  space: RenderSpace,
  x: number,
  y: number,
  processor: PixelProcessor,
  retention: MaskRetention | undefined,
  world: AffineTransform,
  bitmap?: ImageBitmap | HTMLCanvasElement,
) =>
  mask.kind === "paint" || mask.strokes?.length
    ? retention
      ? retention.paint.render(
          mask,
          space,
          x,
          y,
          processor,
          retention.key,
          retention.canCache,
          world,
          bitmap,
        )
      : paintedMask(mask, space, x, y, processor, world, bitmap)
    : mask.kind === "selection"
      ? selectionMask(mask.selection, space, x, y, processor, world)
      : mask.kind === "vector"
        ? vectorMask(mask, space, x, y, world)
        : mask.kind === "bitmap" && bitmap
          ? bitmapMask(bitmap, space, x, y, world)
          : createCanvas(space.width, space.height);

/** Feather raw coverage before inversion/density; finite support preserves tile parity. */
export async function maskCoverage(
  mask: LayerMaskData,
  space: RenderSpace,
  x: number,
  y: number,
  processor: PixelProcessor,
  retention?: MaskRetention,
  world = AffineTransform.translation(x, y),
  bitmap?: ImageBitmap | HTMLCanvasElement,
): Promise<HTMLCanvasElement> {
  const feather = mask.feather ?? 0;
  if (!feather)
    return rawCoverage(mask, space, x, y, processor, retention, world, bitmap);
  const radiusX = (feather * space.sx) / 3,
    radiusY = (feather * space.sy) / 3;
  const haloX = 3 * Math.ceil(radiusX),
    haloY = 3 * Math.ceil(radiusY);
  // Native filter tiles include a halo and commonly exceed 512 by a few pixels.
  // Avoid four coverage/feather jobs when the complete region fits the same budget.
  const fitsWhole =
    space.width <= 1024 &&
    space.height <= 1024 &&
    (space.width + haloX * 2) * (space.height + haloY * 2) <= 4_000_000;
  const tileSize = fitsWhole ? Math.max(1, space.width, space.height) : 512;
  if (
    (Math.min(tileSize, space.width) + haloX * 2) *
      (Math.min(tileSize, space.height) + haloY * 2) >
      4_000_000 ||
    radiusX > 4096 ||
    radiusY > 4096
  ) {
    throw new Error(
      "Mask feather exceeds the working buffer budget at this zoom. Reduce zoom or feather radius.",
    );
  }
  const output = createCanvas(space.width, space.height);
  try {
    const context = output.getContext("2d")!;
    for (let top = 0; top < space.height; top += tileSize) {
      for (let left = 0; left < space.width; left += tileSize) {
        const width = Math.min(tileSize, space.width - left),
          height = Math.min(tileSize, space.height - top);
        const padded = {
          ...space,
          x: space.x + (left - haloX) / space.sx,
          y: space.y + (top - haloY) / space.sy,
          width: width + haloX * 2,
          height: height + haloY * 2,
        };
        const source = await rawCoverage(
          mask,
          padded,
          x,
          y,
          processor,
          retention,
          world,
          bitmap,
        );
        try {
          const c = source.getContext("2d")!;
          const softened = await processor.feather(
            c.getImageData(0, 0, padded.width, padded.height).data,
            { width: padded.width, height: padded.height, radiusX, radiusY },
          );
          const image = c.createImageData(padded.width, padded.height);
          image.data.set(softened);
          c.putImageData(image, 0, 0);
          context.drawImage(
            source,
            haloX,
            haloY,
            width,
            height,
            left,
            top,
            width,
            height,
          );
        } finally {
          release(source);
        }
      }
    }
    return output;
  } catch (error) {
    release(output);
    throw error;
  }
}
