import { featherRegion } from "./feather-region";
import { encodeCapturedPng } from "./png";
import { prepareClipboard, type ClipboardRequest } from "./clipboard";
import { encodeCoverage, wandCoverage, type CoverageRequest } from "../core/pixel-selection";
import { applyHsl } from "./wasm";
import type { HslAdjustmentData } from "../core/adjustments";
import type { SpatialFilterOptions } from "../core/smart/spatial-filter";
import {
  findRetouchDonor,
  type DonorSearchOptions,
} from "../core/retouch/donor";
import { applyDodgeBurn } from "../core/retouch/dodgeBurn";
import { poissonBlend } from "../core/retouch/poisson";
import type { PoissonBlendOptions } from "../core/retouch/types";
import type { DodgeBurnOptions } from "../core/retouch/types";
import {
  applySpatialFilter,
  featherAlpha,
  applyBlendIf,
  applyTone,
  applyLut,
  blendAdjustment,
  mixFiltered,
  computeWasmHistogram,
  instantiateKernel,
  wasmPoissonSolver,
  wasmDonorValidity,
  renderSelection,
} from "./wasm";
import type { SelectionTile, FeatherTile } from "./wasm";
import type { BlendIfData } from "../core/drawing";
import type { ToneEffectData } from "../core/model";

const kernel = fetch(`${import.meta.env.BASE_URL}wasm/pixels.wasm`)
  .then((response) => {
    if (!response.ok)
      throw new Error(
        "Could not load the WASM module. Run npm run build:wasm.",
      );
    return response.arrayBuffer();
  })
  .then(instantiateKernel);

kernel
  .then(() => self.postMessage({ type: "ready" }))
  .catch((error: Error) =>
    self.postMessage({ type: "fatal", error: error.message }),
  );

self.onmessage = async (
  event: MessageEvent<{
    id: number;
    pixels: Uint8ClampedArray;
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
  }>,
) => {
  try {
    const data = event.data;
    if (data.png) {
      const { width, height } = data.png;
      const png = await encodeCapturedPng(data.pixels, width, height);
      self.postMessage({ id: data.id, png });
      return;
    }
    if (data.clipboard) {
      const clipboard = await prepareClipboard(await kernel, data.pixels, data.clipboard);
      self.postMessage({ id: data.id, clipboard });
      return;
    }
    if (data.coverage) {
      const { width, height, wand } = data.coverage;
      if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || data.pixels.length !== width * height * 4)
        throw new Error("Pixel coverage requires matching RGBA dimensions.");
      let alpha: Uint8Array;
      if (wand) alpha = wandCoverage(data.pixels, width, height, wand.x, wand.y, wand.tolerance, wand.contiguous);
      else {
        alpha = new Uint8Array(width * height);
        for (let i = 0; i < alpha.length; i++) alpha[i] = data.pixels[i * 4 + 3];
      }
      self.postMessage({ id: data.id, coverage: encodeCoverage(alpha, width, height) });
      return;
    }
    if (data.hsl) {
      const pixels = applyHsl(await kernel, data.pixels, data.hsl);
      self.postMessage({ id: data.id, pixels }, { transfer: [pixels.buffer] });
      return;
    }
    if (data.filteredMix) {
      const { filtered, mask, density, inverted } = data.filteredMix;
      const pixels = mixFiltered(
        await kernel,
        data.pixels,
        filtered,
        mask,
        density,
        inverted,
      );
      self.postMessage({ id: data.id, pixels }, { transfer: [pixels.buffer] });
      return;
    }
    if (data.spatialFilter) {
      const { width, height, options } = data.spatialFilter;
      const pixels = applySpatialFilter(
        await kernel,
        data.pixels,
        width,
        height,
        options,
      );
      self.postMessage({ id: data.id, pixels }, { transfer: [pixels.buffer] });
      return;
    }
    if (data.donorSearch) {
      const { width, height, coverage, options } = data.donorSearch;
      self.postMessage({
        id: data.id,
        donorResult: findRetouchDonor(
          data.pixels,
          width,
          height,
          coverage,
          options,
          wasmDonorValidity(await kernel),
        ),
      });
      return;
    }
    if (data.poisson) {
      const { donor, width, height, coverage, options } = data.poisson;
      const poissonResult = poissonBlend(
        data.pixels,
        donor,
        width,
        height,
        coverage,
        options,
        wasmPoissonSolver(await kernel),
      );
      self.postMessage(
        { id: data.id, poissonResult },
        { transfer: [poissonResult.pixels.buffer] },
      );
      return;
    }
    if (data.dodgeBurn) {
      const { width, height, options, coverage } = data.dodgeBurn;
      const pixels = applyDodgeBurn(
        data.pixels,
        width,
        height,
        options,
        coverage,
      );
      self.postMessage({ id: data.id, pixels }, { transfer: [pixels.buffer] });
      return;
    }
    if (data.histogram) {
      const hist = computeWasmHistogram(await kernel, data.pixels);
      self.postMessage({ id: data.id, histogram: hist });
      return;
    }
    if (data.featheredSelection) {
      const { tile, radiusX, radiusY } = data.featheredSelection;
      const pixels = renderSelection(await kernel, tile);
      const region = featherRegion(pixels, { ...tile, radiusX, radiusY });
      if (region) {
        const softened = featherAlpha(await kernel, region.pixels,
          { width: region.width, height: region.height, radiusX, radiusY });
        for (let y = 0; y < region.height; y++) pixels.set(
          softened.subarray(y * region.width * 4, (y + 1) * region.width * 4),
          ((y + region.y) * tile.width + region.x) * 4);
      }
      self.postMessage({ id: data.id, pixels }, { transfer: [pixels.buffer] });
      return;
    }
    const result = data.lut
      ? applyLut(await kernel, data.pixels, data.lut)
      : data.adjustment
        ? blendAdjustment(
            await kernel,
            data.pixels,
            data.adjustment.adjusted,
            data.adjustment.mask ?? null,
            data.adjustment.opacity,
          )
        : data.feather
          ? featherAlpha(await kernel, data.pixels, data.feather)
          : data.selection
            ? renderSelection(await kernel, data.selection)
            : data.blend && data.underlying
              ? applyBlendIf(
                  await kernel,
                  data.pixels,
                  data.underlying,
                  data.blend,
                )
              : applyTone(await kernel, data.pixels, data.effects ?? []);
    self.postMessage(
      { id: event.data.id, pixels: result },
      { transfer: [result.buffer] },
    );
  } catch (error) {
    self.postMessage({
      id: event.data.id,
      error:
        error instanceof Error ? error.message : "Image processing failed.",
    });
  }
};
