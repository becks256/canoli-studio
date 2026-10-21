import type { SmartFilterData } from "../core/smart/filters";
import { smartFilterHalo, isActiveSmartFilter } from "../core/smart/filters";
import type { RenderRegion } from "./renderer";
import type { PixelProcessor } from "./processor";
import { createCanvas, release } from "./canvas";
import type { CanvasCache } from "./cache";
import type { FilterTileCache } from "./filter-tile-cache";

export interface FrequencyTileSharing {
  cache:FilterTileCache;
  key:string;
  signature:string;
  canCache():boolean;
}

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
    sourceSignature?: string;
    canCache(): boolean;
    completed?: CompletedFilterTile;
  },
  sharing?:FrequencyTileSharing,
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
  const common=retention?{cache:retention.cache,key:retention.key,signature:retention.sourceSignature??retention.signature,canCache:retention.canCache}:sharing;
  const lowKey=(index:number,sigma:number)=>common?`${common.key}:frequency-low:${JSON.stringify([padded,sigma,filters.slice(0,index).map(({id:_id,...value})=>value)])}`:'';
  const solo=filters.length===1&&filters[0].kind==='frequency-band'&&filters[0].enabled?filters[0]:undefined;
  const needsRaw =
    constant === 0
      ? !retainedOriginal
      : !retained || (!!activeMask && !retained.original);
  const shared=needsRaw&&solo&&common?common.cache.read(lowKey(0,solo.sigma),common.signature,true):undefined;
  const needsSource=needsRaw&&!shared?.original;
  const canvas = needsSource
    ? await render(padded)
    : createCanvas(padded.width, padded.height, true);
  try {
    const context = canvas.getContext("2d")!;
    let original: Uint8ClampedArray | undefined =
      retainedOriginal ?? retained?.original ?? shared?.original?.slice();
    let pixels: Uint8ClampedArray;
    let sourcePixels: Uint8ClampedArray | undefined=shared?.original;
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
      for (const [index,filter] of filters.entries()) {
        if (!isActiveSmartFilter(filter) || filter.kind === "native-composition" || filter.kind === "document-tone") continue;
        if(filter.kind==='bilateral-denoise'){
          pixels=await processor.bilateralFilter(pixels,padded.width,padded.height,{radius:filter.radius,colorSigma:filter.colorSigma,amount:filter.amount});continue;
        }
        if (filter.kind === 'median') {
          pixels=await processor.medianFilter(pixels,padded.width,padded.height,filter.radius);
          continue;
        }
        if(filter.kind==='frequency-band'){
          const key=lowKey(index,filter.sigma);
          let low:Uint8ClampedArray|undefined=(solo&&index===0?shared?.filtered:undefined)??common?.cache.read(key,common.signature,false)?.filtered;
          if(!low){low=await processor.spatialFilter(pixels,padded.width,padded.height,{kind:'frequency-band',band:'low',sigmaX:filter.sigma});
            if(common?.canCache())common.cache.write(key,common.signature,pixels,low);}
          pixels=filter.band==='low'?low:await processor.encodeFrequencyBand(pixels,low,filter.band);continue;
        }
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
