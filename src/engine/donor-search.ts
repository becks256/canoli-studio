import type { AssetStore } from "../core/assets";
import {
  selectionRegionTransform,
  selectionSchema,
  type SelectionData,
} from "../core/drawing";
import type { DocumentData } from "../core/model";
import type { RetouchSamplingOptions } from "../core/retouch/types";
import type {
  DonorSearchOptions,
  DonorSearchResult,
} from "../core/retouch/donor";
import type { DocumentRenderer } from "./renderer";
import type { PixelProcessor } from "./processor";
import { retouchSampleDocument, sampleRetouchRegion } from "./retouch-sampling";

/** Read-only donor proposal in document pixels; the caller decides whether to apply it. */
export async function suggestRetouchDonor(
  document: DocumentData,
  assets: AssetStore,
  renderer: DocumentRenderer,
  processor: PixelProcessor,
  selection: SelectionData,
  sampling: RetouchSamplingOptions,
  options: DonorSearchOptions = {},
  signal?: AbortSignal,
): Promise<DonorSearchResult> {
  const snapshot = retouchSampleDocument(document, sampling),
    captured = selectionSchema.parse(selection);
  const radius = options.radius ?? 64;
  if (!Number.isSafeInteger(radius) || radius < 1)
    throw new Error("Donor search radius must be a positive safe integer.");
  const bounds = captured.regions
    .filter((region) => region.operation === "add")
    .map((region) => selectionRegionTransform(region).bounds(region));
  if (!bounds.length) throw new Error("Donor search selection is empty.");
  const left = Math.max(
    0,
    Math.floor(Math.min(...bounds.map((r) => r.x))) - radius - 1,
  );
  const top = Math.max(
    0,
    Math.floor(Math.min(...bounds.map((r) => r.y))) - radius - 1,
  );
  const right = Math.min(
    snapshot.width,
    Math.ceil(Math.max(...bounds.map((r) => r.x + r.width))) + radius + 1,
  );
  const bottom = Math.min(
    snapshot.height,
    Math.ceil(Math.max(...bounds.map((r) => r.y + r.height))) + radius + 1,
  );
  if (right <= left || bottom <= top)
    throw new Error("Donor search selection does not intersect the canvas.");
  const region = { x: left, y: top, width: right - left, height: bottom - top };
  signal?.throwIfAborted();
  const pixels = await sampleRetouchRegion(
    snapshot,
    assets,
    renderer,
    region,
    signal,
  );
  const mask = await processor.selection({
    selection: captured,
    ...region,
    stepX: 1,
    stepY: 1,
  });
  signal?.throwIfAborted();
  const coverage = new Uint8Array(region.width * region.height);
  for (let p = 0; p < coverage.length; p++) coverage[p] = mask[p * 4 + 3];
  const proposal = await processor.findDonor(
    pixels,
    region.width,
    region.height,
    coverage,
    { radius },
  );
  signal?.throwIfAborted();
  return proposal;
}
