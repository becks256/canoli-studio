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
    selection?: SelectionTile;
    feather?: FeatherTile;
    lut?: Uint8Array;
    adjustment?: {
      adjusted: Uint8ClampedArray;
      mask?: Uint8ClampedArray | null;
      opacity: number;
    };
    histogram?: boolean;
  }>,
) => {
  try {
    const data = event.data;
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
