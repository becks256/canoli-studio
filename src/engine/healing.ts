import type { AssetStore } from "../core/assets";
import { strokeBounds, type BrushStrokeData } from "../core/drawing";
import { maskStrokeSchema } from "../core/masks";
import type { DocumentData } from "../core/model";
import type {
  RetouchSamplingOptions,
  PoissonBlendOptions,
} from "../core/retouch/types";
import type { DocumentRenderer } from "./renderer";
import type { PixelProcessor } from "./processor";
import { retouchSampleDocument, sampleRetouchRegion } from "./retouch-sampling";
import { renderRetouchCoverage } from "./retouch";
import { solveRetouchRegion } from "./patch";

export async function prepareHealingStroke(
  document: DocumentData,
  assets: AssetStore,
  renderer: DocumentRenderer,
  processor: PixelProcessor,
  brush: BrushStrokeData,
  sampling: RetouchSamplingOptions,
  options: PoissonBlendOptions = {},
  radius = 64,
  signal?: AbortSignal,
) {
  if (!Number.isSafeInteger(radius) || radius < 1)
    throw new Error("Healing search radius must be a positive safe integer.");
  const captured = maskStrokeSchema.parse({
    mode: "reveal",
    stroke: brush,
  }).stroke;
  const snapshot = retouchSampleDocument(document, sampling),
    solveOptions = { ...options };
  const area = strokeBounds(captured);
  const left = Math.max(0, Math.floor(area.x)),
    top = Math.max(0, Math.floor(area.y));
  const right = Math.min(snapshot.width, Math.ceil(area.x + area.width)),
    bottom = Math.min(snapshot.height, Math.ceil(area.y + area.height));
  if (right <= left || bottom <= top)
    throw new Error("Healing stroke does not intersect the canvas.");
  const bounds = {
    x: left - 1,
    y: top - 1,
    width: right - left + 2,
    height: bottom - top + 2,
  };
  const x = Math.max(0, left - radius - 1),
    y = Math.max(0, top - radius - 1);
  const window = {
    x,
    y,
    width: Math.min(snapshot.width, right + radius + 1) - x,
    height: Math.min(snapshot.height, bottom + radius + 1) - y,
  };
  signal?.throwIfAborted();
  const coverage = await renderRetouchCoverage(
    captured,
    { ...window, sx: 1, sy: 1 },
    processor,
    undefined,
    assets,
    undefined,
    ()=>signal?.aborted??false,
  );
  signal?.throwIfAborted();
  const pixels = await sampleRetouchRegion(
    snapshot,
    assets,
    renderer,
    window,
    signal,
  );
  const donor = await processor.findDonor(
    pixels,
    window.width,
    window.height,
    coverage,
    { radius },
  );
  signal?.throwIfAborted();
  const patchCoverage = new Uint8Array(bounds.width * bounds.height);
  for (let row = 1; row < bounds.height - 1; row++)
    for (let col = 1; col < bounds.width - 1; col++) {
      patchCoverage[row * bounds.width + col] =
        coverage[(bounds.y + row - y) * window.width + bounds.x + col - x];
    }
  return solveRetouchRegion(
    snapshot,
    assets,
    renderer,
    processor,
    bounds,
    patchCoverage,
    donor,
    solveOptions,
    signal,
    { region: window, pixels },
  );
}
