import {
  hslAdjustmentSchema,
  type HslAdjustmentData,
} from "../core/adjustments";
import type { SpatialFilterOptions } from "../core/smart/spatial-filter";
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
import type { SelectionTile, FeatherTile } from "./wasm";

export class PixelProcessor {
  private worker = new Worker(new URL("./pixels.worker.ts", import.meta.url), {
    type: "module",
  });
  private sequence = 0;
  private pending = new Map<
    number,
    { resolve(value: any): void; reject(error: Error): void }
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
        this.pending.delete(event.data.id);
        if (event.data.error) request.reject(new Error(event.data.error));
        else if (event.data.histogram) request.resolve(event.data.histogram);
        else if (event.data.donorResult)
          request.resolve(event.data.donorResult);
        else if (event.data.poissonResult)
          request.resolve(event.data.poissonResult);
        else request.resolve(event.data.pixels);
      };
    });
    // Readiness remains rejectable for callers, even if shutdown precedes first use.
    void this.ready.catch(() => {});
  }

  /** Snapshot inputs before worker readiness; callers keep their source buffers. */
  spatialFilter(
    pixels: Uint8ClampedArray,
    width: number,
    height: number,
    options: SpatialFilterOptions,
  ): Promise<Uint8ClampedArray> {
    return this.request(pixels.slice(), {
      spatialFilter: { width, height, options: { ...options } },
    });
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
    // Snapshot all arrays before awaiting worker readiness; retain caller ownership.
    return this.request(original.slice(), {
      filteredMix: {
        filtered: filtered.slice(),
        mask: mask.slice(),
        density,
        inverted,
      },
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
  selection(tile: SelectionTile): Promise<Uint8ClampedArray> {
    return this.request(new Uint8ClampedArray(0), { selection: tile });
  }
  feather(pixels: Uint8ClampedArray, tile: FeatherTile) {
    return this.request(pixels, { feather: tile });
  }
  private async request(
    pixels: Uint8ClampedArray,
    payload: {
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
    },
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
    if (payload.filteredMix) {
      // mixFiltered snapshots both inputs before awaiting readiness. Transfer those
      // private copies rather than structured-cloning a second time on dispatch.
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
      this.pending.set(id, { resolve, reject });
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
