import type { OwnedFontRun } from "../fonts/shaping-types";
import { yieldTask } from "../core/task-yield";
import type { NativeSvgMetrics } from "./native-svg-metrics";

/** Additional native preparation for hosts that round HB buffer positions.
 * Round shaped and nominal positions together in screen pixels, then restore
 * source units. No artwork pixels supply offsets or choose a rounding rule.
 * The caller keeps the original run as provenance and verifies complete ink. */
export async function roundNativeSvgPositions(
  source: OwnedFontRun,
  metrics: NativeSvgMetrics,
  check: () => void,
): Promise<Readonly<{ run: OwnedFontRun; metrics: NativeSvgMetrics }>> {
  check();
  if (!metrics.nativeMetrics)
    throw new Error("Native position rounding requires captured native metrics.");
  const units = source.unitsPerEm,
    em = metrics.em;
  if (![units, em].every((n) => Number.isFinite(n) && n > 0))
    throw new Error("Invalid native position rounding scale.");
  const round = (value: number) => {
    const pixels = Math.fround((value * em) / units);
    if (!Number.isFinite(pixels))
      throw new Error("Invalid native position rounding value.");
    // C++ round uses ties away from zero, including negative half pixels.
    return (Math.sign(pixels) * Math.floor(Math.abs(pixels) + 0.5) * units) / em;
  };
  let deadline = performance.now() + 2;
  const pause = async () => {
    if (performance.now() >= deadline) {
      await yieldTask();
      check();
      deadline = performance.now() + 2;
    }
  };
  const glyphs: OwnedFontRun["glyphs"][number][] = [];
  for (const g of source.glyphs) {
    glyphs.push(Object.freeze({
      ...g,
      xOffset: round(g.xOffset),
      yOffset: round(g.yOffset),
      xAdvance: round(g.xAdvance),
      yAdvance: round(g.yAdvance),
    }));
    if (performance.now() >= deadline) await pause();
  }
  const nominals: NativeSvgMetrics["glyphs"][number][] = [];
  for (const g of metrics.glyphs) {
    nominals.push(Object.freeze({
      ...g,
      nominal: round(g.nominal),
      xOffset: round(g.xOffset),
      yOffset: round(g.yOffset),
      yAdvance: round(g.yAdvance),
    }));
    if (performance.now() >= deadline) await pause();
  }
  check();
  return Object.freeze({
    run: Object.freeze({ ...source, glyphs: Object.freeze(glyphs) }),
    metrics: Object.freeze({ ...metrics, glyphs: Object.freeze(nominals) }),
  });
}
