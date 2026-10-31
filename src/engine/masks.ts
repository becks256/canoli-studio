import {hasWetMask,hasPlacedMask} from './wet-mask';
import { featherRegion } from "./feather-region";
import type {AssetStore} from '../core/assets';
import type {BrushTextureSampler} from './brush-texture';
import { AffineTransform } from "../core/affine";
import { maskGeometrySignature } from "./mask-signature";
import {hasMaskRefinements} from "../core/masks";
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
type ActiveMaskEntry={raster:ActiveStrokeRaster;bytes:number;busy:boolean;retired:boolean};

/** Shared final coverage settings, after raw feathering and before masking artwork. */
export function applyMaskSettings(canvas:HTMLCanvasElement,mask:LayerMaskData){
  const context=canvas.getContext('2d')!;context.save();
  try{
    context.fillStyle='#ffffff';
    if(mask.inverted){context.globalCompositeOperation='xor';context.fillRect(0,0,canvas.width,canvas.height);}
    context.globalCompositeOperation='destination-over';context.globalAlpha=1-mask.density;
    context.fillRect(0,0,canvas.width,canvas.height);
  }finally{context.restore();}
}

/** Finished coverage shares the viewport LRU; raw active stamps have a separate bounded LRU. */
export class PaintedMaskRaster {
  private active = new Map<
    string,
    ActiveMaskEntry
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
    for (const entry of this.active.values()) this.retire(entry);
    this.active.clear();
    this.bytes = 0;
  }
  private retire(entry:ActiveMaskEntry){entry.retired=true;if(!entry.busy)entry.raster.clear();}
  private surface(key: string, bytes: number) {
    const found = this.active.get(key);
    if (found) {
      // An independent reader must not supersede a yielded cache producer.
      // It can replay privately while that producer owns its active surface.
      if(found.busy)return undefined;
      this.active.delete(key);
      if(found.bytes===bytes&&bytes<=this.budget){
        this.active.set(key, found);
        return found;
      }
      this.retire(found);
      this.bytes-=found.bytes;
    }
    if (bytes > this.budget) return undefined;
    while (this.bytes + bytes > this.budget || this.active.size >= 64) {
      const oldest = this.active.keys().next().value!;
      const entry = this.active.get(oldest)!;
      this.retire(entry);
      this.active.delete(oldest);
      this.bytes -= entry.bytes;
    }
    const entry:ActiveMaskEntry={raster:new ActiveStrokeRaster(),bytes,busy:false,retired:false};
    this.active.set(key,entry);
    this.bytes += bytes;
    return entry;
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
    retainFull = true,
    readback = false,
    assets?:AssetStore,
    textures?:BrushTextureSampler,
    isCancelled?:()=>boolean,
  ) {
    if (hasWetMask(mask)||hasPlacedMask(mask) || !mask.strokes?.length || !canCache())
      return paintedMask(mask, space, x, y, processor, world, bitmap,assets,textures,isCancelled);
    const location = JSON.stringify([space, world]);
    const cacheKey = `painted:${key}:${location}`;
    const prefix = mask.strokes.slice(0, -1);
    const prefixSignature = maskGeometrySignature({ ...mask, strokes: prefix });
    let output = createCanvas(space.width, space.height, readback);
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
          assets,
          textures,
          isCancelled,
        );
        this.replays++;
      }
      if (!cachedPrefix && canCache())
        this.cache.write(cacheKey + ":prefix", prefixSignature, output);
      const last=mask.strokes.at(-1)!;
      const entry = canCache()&&last.stroke.kind!=='wet'
        ? this.surface(cacheKey,ActiveStrokeRaster.retainedBytes(last.stroke,space,world))
        : undefined;
      const active=entry?.raster;
      if(entry)entry.busy=true;
      const before = active?.appendedPoints ?? 0;
      try{await drawMaskStroke(
        last,
        output,
        space,
        x,
        y,
        processor,
        active,
        world,
        undefined,
        assets,
        textures,
        isCancelled,
      );}finally{if(entry){entry.busy=false;if(entry.retired)entry.raster.clear();}}
      if (active) this.appended += active.appendedPoints - before;
      if (canCache() && retainFull)
        this.cache.write(
          cacheKey + ":full",
          maskGeometrySignature(mask),
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
  retainFull?: boolean;
  readback?: boolean;
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
  assets?:AssetStore,
  textures?:BrushTextureSampler,
  isCancelled?:()=>boolean,
) =>
  mask.kind === "raster-erasures" || mask.kind === "paint" || hasMaskRefinements(mask)
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
          retention.retainFull,
          retention.readback,
          assets,
          textures,
          isCancelled,
        )
      : paintedMask(mask, space, x, y, processor, world, bitmap,assets,textures,isCancelled)
    : mask.kind === "selection"
      ? selectionMask(mask.selection, space, x, y, processor, world)
      : mask.kind === "vector"
        ? vectorMask(mask, space, x, y, world)
        : mask.kind === "bitmap" && bitmap
          ? bitmapMask(bitmap, space, x, y, world,isCancelled)
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
  assets?:AssetStore,
  textures?:BrushTextureSampler,
  isCancelled?:()=>boolean,
): Promise<HTMLCanvasElement> {
  const feather = mask.feather ?? 0;
  if (!feather)
    return rawCoverage(mask, space, x, y, processor, retention, world, bitmap,assets,textures,isCancelled);
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
        if (mask.kind === "selection" && !hasMaskRefinements(mask)) {
          const inverse = world.inverse();
          const origin = inverse.point({ x: padded.x, y: padded.y });
          const pixels = await processor.featheredSelection({
            selection: mask.selection, width: padded.width, height: padded.height,
            x: origin.x, y: origin.y,
            stepX: inverse.a / padded.sx, stepY: inverse.d / padded.sy,
            stepXY: inverse.c / padded.sy, stepYX: inverse.b / padded.sx,
          }, radiusX, radiusY);
          const image = context.createImageData(padded.width, padded.height);
          image.data.set(pixels);
          context.putImageData(image, left - haloX, top - haloY,
            haloX, haloY, width, height);
          continue;
        }
        const source = await rawCoverage(
          mask,
          padded,
          x,
          y,
          processor,
          retention,
          world,
          bitmap,
          assets,
          textures,
          isCancelled,
        );
        try {
          const c = source.getContext("2d")!;
          const region = featherRegion(
            c.getImageData(0, 0, padded.width, padded.height).data,
            { width: padded.width, height: padded.height, radiusX, radiusY },
          );
          if (region) {
            const softened = await processor.feather(region.pixels,
              { width: region.width, height: region.height, radiusX, radiusY });
            const image = c.createImageData(region.width, region.height);
            image.data.set(softened);
            c.putImageData(image, region.x, region.y);
          }
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
