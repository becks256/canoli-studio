import type { OwnedFontRun } from "../fonts/shaping-types";

export interface NativeFontRange {
  readonly start: number;
  readonly end: number;
}
/** A missing glyph invalidates its complete shaped cluster, including marks.
 * This describes source coverage only; it never publishes glyph paint. */
export function supportedNativeFontRanges(
  run: OwnedFontRun,
): readonly Readonly<NativeFontRange>[] {
  const states = new Map<number, boolean>();
  for (const glyph of run.glyphs)
    states.set(
      glyph.cluster,
      (states.get(glyph.cluster) ?? true) && glyph.glyphId !== 0,
    );
  const starts = [...states.keys()].sort((a, b) => a - b),
    ranges: NativeFontRange[] = [];
  for (let i = 0; i < starts.length; i++)
    if (states.get(starts[i])) {
      const start = starts[i],
        end = starts[i + 1] ?? run.request.itemOffset + run.request.itemLength,
        last = ranges.at(-1);
      if (last?.end === start)
        ranges[ranges.length - 1] = { start: last.start, end };
      else ranges.push({ start, end });
    }
  return Object.freeze(ranges.map((range) => Object.freeze(range)));
}

/** Intersect still-unowned source ranges with a font's complete coverage.
 * Both lists are disjoint and sorted. Original text is never rewritten. */
export function assignNativeFontRanges(
  pending: readonly NativeFontRange[],
  supported: readonly NativeFontRange[],
) {
  const selected: NativeFontRange[] = [],
    remaining: NativeFontRange[] = [];
  let cursor = 0;
  for (const range of pending) {
    let at = range.start;
    while (cursor < supported.length && supported[cursor].end <= at) cursor++;
    let i = cursor;
    while (i < supported.length && supported[i].start < range.end) {
      const next = supported[i++],
        start = Math.max(at, next.start),
        end = Math.min(range.end, next.end);
      if (start >= end) continue;
      if (at < start) remaining.push({ start: at, end: start });
      selected.push({ start, end });
      at = end;
    }
    if (at < range.end) remaining.push({ start: at, end: range.end });
  }
  return Object.freeze({
    selected: Object.freeze(selected.map((range) => Object.freeze(range))),
    remaining: Object.freeze(remaining.map((range) => Object.freeze(range))),
  });
}
