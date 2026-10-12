import type { SmartFilterData } from "../core/smart/filters";
import { smartFilterHalo } from "../core/smart/filters";
import type { RenderRegion } from "./renderer";
import type { PixelProcessor } from "./processor";
import { createCanvas, release } from "./canvas";
import type { CanvasCache } from "./cache";
import type { FilterTileCache } from "./filter-tile-cache";

interface CompletedFilterTile {
  cache: CanvasCache;
  key: string;
  signature(region: RenderRegion): string;
}
function filteredTileRegion(
  region: RenderRegion,
  filters: readonly SmartFilterData[],
) {
  const halo = smartFilterHalo(filters);
  const padded = {
    x: region.x - halo,
    y: region.y - halo,
    width: region.width + halo * 2,
    height: region.height + halo * 2,
  };
  // Bound transient surfaces before asking the compositor/browser to allocate them.
  // This is a working-tile budget, independent of master/document dimensions.
  if (
    ![
      padded.x,
      padded.y,
      padded.width,
      padded.height,
      padded.x + padded.width,
      padded.y + padded.height,
    ].every(Number.isSafeInteger) ||
    padded.width <= 0 ||
    padded.height <= 0 ||
    padded.width > 8192 ||
    padded.height > 8192 ||
    padded.width * padded.height > 4_000_000
  ) {
    throw new Error(
      "Smart-filter sampling region and cumulative halo exceed the working-tile budget. Reduce the filter radius/stack or use a closer view.",
    );
  }
  return padded;
}

/** Draw retained pixels synchronously under the caller's transform/clip. */
export function drawCompletedFilterTile(
  completed: CompletedFilterTile | undefined,
  region: RenderRegion,
  filters: readonly SmartFilterData[],
  context: CanvasRenderingContext2D,
): boolean {
  if (!completed) return false;
  const padded = filteredTileRegion(region, filters);
  return completed.cache.draw(
    `${completed.key}:${JSON.stringify(padded)}`,
    completed.signature(padded),
    context,
    padded.x,
    padded.y,
  );
}

/** Native master pixels, before instance resampling. Caller owns the returned canvas. */
export async function filteredMasterTile(
  render: (region: RenderRegion) => Promise<HTMLCanvasElement>,
  processor: PixelProcessor,
  region: RenderRegion,
  filters: readonly SmartFilterData[],
  masterWidth: number,
  masterHeight: number,
  mask?: {
    density: number;
    inverted: boolean;
    constant?: (region: RenderRegion) => 0 | 1 | undefined;
    render: (region: RenderRegion) => Promise<HTMLCanvasElement>;
  },
  retention?: {
    cache: FilterTileCache;
    key: string;
    signature: string;
    canCache(): boolean;
    completed?: CompletedFilterTile;
  },
): Promise<{ canvas: HTMLCanvasElement; x: number; y: number }> {
  const padded = filteredTileRegion(region, filters);
  const completed = retention?.completed;
  const completedKey = completed
    ? `${completed.key}:${JSON.stringify(padded)}`
    : "";
  const completedSignature = completed?.signature(padded);
  // A changed mask commonly misses this cache. Do not allocate/readback-probe
  // a surface merely to discover that the retained tile does not exist.
  if (completed?.cache.hasCanvas(completedKey, completedSignature!)) {
    const hit = createCanvas(padded.width, padded.height, true);
    if (completed.cache.read(completedKey, completedSignature!, hit))
      return { canvas: hit, x: padded.x, y: padded.y };
    release(hit);
  }
  const constant = mask?.constant?.(padded);
  const activeMask = constant === undefined ? mask : undefined;
  const key = retention ? `${retention.key}:${JSON.stringify(padded)}` : "";
  const retainedOriginal =
    constant === 0
      ? retention?.cache.readOriginal(key, retention.signature)
      : undefined;
  const retained =
    constant === 0
      ? undefined
      : retention?.cache.read(key, retention.signature, !!activeMask);
  const needsSource =
    constant === 0
      ? !retainedOriginal
      : !retained || (!!activeMask && !retained.original);
  const canvas = needsSource
    ? await render(padded)
    : createCanvas(padded.width, padded.height, true);
  try {
    const context = canvas.getContext("2d")!;
    let original: Uint8ClampedArray | undefined =
      retainedOriginal ?? retained?.original;
    let pixels: Uint8ClampedArray;
    let sourcePixels: Uint8ClampedArray | undefined;
    if (needsSource) {
      // Master artboards clip input before filtering; blur may extend beyond them afterward.
      context.clearRect(0, 0, Math.max(0, -padded.x), padded.height);
      context.clearRect(0, 0, padded.width, Math.max(0, -padded.y));
      context.clearRect(
        Math.max(0, masterWidth - padded.x),
        0,
        padded.width,
        padded.height,
      );
      context.clearRect(
        0,
        Math.max(0, masterHeight - padded.y),
        padded.width,
        padded.height,
      );
      sourcePixels = context.getImageData(
        0,
        0,
        padded.width,
        padded.height,
      ).data;
      original = sourcePixels.slice();
    }
    if (constant === 0) pixels = original!;
    else if (retained) pixels = retained.filtered;
    else {
      pixels = sourcePixels!;
      for (const filter of filters) {
        if (!filter.enabled) continue;
        pixels =
          filter.kind === "tone"
            ? await processor.process(pixels, [filter])
            : await processor.spatialFilter(
                pixels,
                padded.width,
                padded.height,
                filter.kind === "gaussian-blur"
                  ? { kind: filter.kind, sigmaX: filter.sigma }
                  : {
                      kind: filter.kind,
                      sigmaX: filter.sigma,
                      amount: filter.amount,
                      threshold: filter.threshold,
                    },
              );
      }
      if (retention?.canCache())
        retention.cache.write(key, retention.signature, original!, pixels);
    }
    if (activeMask && original) {
      const coverage = await activeMask.render(padded);
      try {
        const alpha = coverage
          .getContext("2d")!
          .getImageData(0, 0, padded.width, padded.height).data;
        // Cache reads and native readback own fresh buffers; cache writes above copy.
        pixels = await processor.mixFilteredOwned(
          original,
          pixels,
          alpha,
          activeMask.density,
          activeMask.inverted,
        );
      } finally {
        release(coverage);
      }
    }
    // These are private ArrayBuffer-backed cache/readback/worker results.
    // ImageData can wrap them directly; putImageData copies into the canvas.
    const image = new ImageData(pixels as Uint8ClampedArray<ArrayBuffer>, padded.width, padded.height);
    context.putImageData(image, 0, 0);
    if (completed && retention?.canCache())
      completed.cache.write(completedKey, completedSignature!, canvas);
    return { canvas, x: padded.x, y: padded.y };
  } catch (error) {
    release(canvas);
    throw error;
  }
}
