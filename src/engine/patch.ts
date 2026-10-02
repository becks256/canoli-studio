import type { AssetStore } from "../core/assets";
import {
  selectionRegionTransform,
  selectionSchema,
  translateSelection,
} from "../core/drawing";
import type { SelectionData, Point } from "../core/drawing";
import type { DocumentData } from "../core/model";
import type {
  PatchOptions,
  PoissonBlendOptions,
  RetouchSamplingOptions,
} from "../core/retouch/types";
import type { DocumentRenderer, RenderRegion } from "./renderer";
import type { PixelProcessor } from "./processor";
import {
  extractRetouchRegion,
  type RetouchPixelWindow,
  retouchSampleDocument,
  sampleRetouchRegion,
} from "./retouch-sampling";

export interface PreparedPatch {
  bounds: RenderRegion;
  pixels: Uint8ClampedArray;
  correctedPixels: Uint8ClampedArray;
  coverage: Uint8Array;
  iterations: number;
  residual: number;
}

/** Prepare a patch privately; only a converged result may reach a future host commit. */
export async function prepareRetouchPatch(
  document: DocumentData,
  assets: AssetStore,
  renderer: DocumentRenderer,
  processor: PixelProcessor,
  selection: SelectionData,
  sourceOffset: Point,
  sampling: RetouchSamplingOptions,
  options: PatchOptions = {},
  signal?: AbortSignal,
): Promise<PreparedPatch> {
  const snapshot = retouchSampleDocument(document, sampling);
  let capturedSelection = selectionSchema.parse(selection);
  const offset = { ...sourceOffset };
  const { direction = "source", ...solveOptions } = options;
  if (direction !== "source" && direction !== "destination")
    throw new Error("Unknown patch direction.");
  if (![offset.x, offset.y].every(Number.isSafeInteger))
    throw new Error("Patch source offset must use safe integer pixels.");
  if (direction === "destination") {
    capturedSelection = selectionSchema.parse(
      translateSelection(capturedSelection, offset.x, offset.y),
    );
    offset.x = -offset.x;
    offset.y = -offset.y;
  }
  const additions = capturedSelection.regions
    .filter((region) => region.operation === "add")
    .map((region) => selectionRegionTransform(region).bounds(region));
  if (!additions.length) throw new Error("Patch selection is empty.");
  const left = Math.max(0, Math.floor(Math.min(...additions.map((r) => r.x))));
  const top = Math.max(0, Math.floor(Math.min(...additions.map((r) => r.y))));
  const right = Math.min(
    snapshot.width,
    Math.ceil(Math.max(...additions.map((r) => r.x + r.width))),
  );
  const bottom = Math.min(
    snapshot.height,
    Math.ceil(Math.max(...additions.map((r) => r.y + r.height))),
  );
  if (right <= left || bottom <= top)
    throw new Error("Patch selection does not intersect the canvas.");
  const bounds = {
    x: left - 1,
    y: top - 1,
    width: right - left + 2,
    height: bottom - top + 2,
  };
  signal?.throwIfAborted();
  const mask = await processor.selection({
    selection: capturedSelection,
    ...bounds,
    stepX: 1,
    stepY: 1,
  });
  signal?.throwIfAborted();
  const coverage = new Uint8Array(bounds.width * bounds.height);
  let selected = 0;
  for (let y = 1; y < bounds.height - 1; y++)
    for (let x = 1; x < bounds.width - 1; x++) {
      const p = y * bounds.width + x;
      coverage[p] = mask[p * 4 + 3];
      if (!coverage[p]) continue;
      const sx = bounds.x + x + offset.x,
        sy = bounds.y + y + offset.y;
      if (
        sx < 0 ||
        sy < 0 ||
        sx >= snapshot.width ||
        sy >= snapshot.height ||
        !Number.isSafeInteger(sx) ||
        !Number.isSafeInteger(sy)
      ) {
        throw new Error("Patch donor pixels fall outside the canvas.");
      }
      selected++;
    }
  if (!selected) throw new Error("Patch selection is empty.");
  return solveRetouchRegion(
    snapshot,
    assets,
    renderer,
    processor,
    bounds,
    coverage,
    offset,
    solveOptions,
    signal,
  );
}

export async function solveRetouchRegion(
  snapshot: DocumentData,
  assets: AssetStore,
  renderer: DocumentRenderer,
  processor: PixelProcessor,
  bounds: RenderRegion,
  coverage: Uint8Array,
  offset: Point,
  solveOptions: PoissonBlendOptions,
  signal?: AbortSignal,
  captured?: RetouchPixelWindow,
): Promise<PreparedPatch> {
  signal?.throwIfAborted();
  const donorBounds = {
    ...bounds,
    x: bounds.x + offset.x,
    y: bounds.y + offset.y,
  };
  const target =
    (captured && extractRetouchRegion(captured, bounds)) ??
    (await sampleRetouchRegion(snapshot, assets, renderer, bounds, signal));
  const donor =
    (captured && extractRetouchRegion(captured, donorBounds)) ??
    (await sampleRetouchRegion(
      snapshot,
      assets,
      renderer,
      donorBounds,
      signal,
    ));
  const solved = await processor.poissonBlend(
    target,
    donor,
    bounds.width,
    bounds.height,
    coverage.map((value) => (value ? 255 : 0)),
    solveOptions,
  );
  signal?.throwIfAborted();
  if (!solved.converged)
    throw new Error(
      `Patch solver did not converge (residual ${solved.residual}). No patch was committed.`,
    );
  const pixels = solved.pixels.slice();
  for (let p = 0; p < coverage.length; p++)
    for (let c = 0; c < 3; c++) {
      const i = p * 4 + c;
      pixels[i] = Math.round(
        target[i] + (coverage[p] / 255) * (pixels[i] - target[i]),
      );
    }
  return {
    bounds,
    pixels,
    correctedPixels: solved.pixels,
    coverage,
    iterations: solved.iterations,
    residual: solved.residual,
  };
}
