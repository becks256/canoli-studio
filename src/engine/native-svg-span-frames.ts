import { yieldTask } from "../core/task-yield";
import type { FloatGlyph } from "./float-glyph";
import type { StyledTextLine } from "./styled-text";
import type { NativeSvgGlyphCandidate } from "./native-svg-candidates";

/** A complete original-span allocation candidate for straight vertical ink.
 * Preserve Float32 native fragment advances until the original span is complete.
 * A one-cluster RTL span retains its unrounded parent preparation; multi-cluster
 * spans can use their own signed inline extent. These are candidate placements,
 * never inferred from comparison pixels; the original ink/ownership gates still
 * decide whether the complete assembly matches. Cross-span clusters and paths
 * retain the other preparations until their native parent allocation is known. */
export async function resolveNativeSvgSpanFrames(
  line: StyledTextLine,
  candidates: readonly Readonly<NativeSvgGlyphCandidate>[],
  check: () => void,
) {
  check();
  if (
    line.path ||
    line.spans.length < 2 ||
    !candidates.length ||
    candidates.some((c) => !c.inlineAllocation?.fragments)
  )
    return;
  const factor = candidates[0].inlineAllocation!.factor,
    length = line.spans.reduce((n, span) => n + span.text.length, 0);
  if (
    !Number.isFinite(factor) ||
    factor <= 0 ||
    candidates.some(
      (c) =>
        c.inlineAllocation!.factor !== factor ||
        !Number.isFinite(c.inlineAllocation!.offset) ||
        c.inlineAllocation!.rotations.length !== c.glyphs.length ||
        c.inlineAllocation!.rotations.some((n) => !Number.isFinite(n)),
    )
  )
    throw new Error("Invalid native source span allocation.");
  let deadline = performance.now() + 2;
  const checkpoint = async () => {
    check();
    if (performance.now() >= deadline) {
      await yieldTask();
      check();
      deadline = performance.now() + 2;
    }
  };
  const sizes = candidates
      .flatMap((c) => c.inlineAllocation!.sizes)
      .sort((a, b) => a.start - b.start),
    owners = new Map<number, number>(),
    counts = line.spans.map(() => 0),
    ends: number[] = [];
  let total = 0;
  for (const span of line.spans) {
    total += span.text.length;
    ends.push(total);
  }
  let cursor = 0,
    span = 0;
  for (const size of sizes) {
    if (
      !Number.isSafeInteger(size.start) ||
      !Number.isSafeInteger(size.end) ||
      size.start < 0 ||
      size.end <= size.start ||
      size.end > length ||
      !Number.isSafeInteger(size.advance * 64)
    )
      throw new Error("Invalid native source span size.");
    if (size.start !== cursor) return;
    while (span < ends.length && size.start >= ends[span]) span++;
    if (span === ends.length || size.end > ends[span]) return;
    owners.set(size.start, span);
    counts[span]++;
    cursor = size.end;
    await checkpoint();
  }
  if (cursor !== length) return;
  const widths = line.spans.map(() => 0),
    spaced = new Set<number>();
  for (const candidate of candidates)
    for (const fragment of candidate.inlineAllocation!.fragments!) {
      const parts = new Map<number, { width: number; spacing: number }>();
      const part = (cluster: number) => {
        const owner = owners.get(cluster);
        if (owner === undefined)
          throw new Error("Native fragment has no original span.");
        let value = parts.get(owner);
        if (!value) {
          value = { width: 0, spacing: 0 };
          parts.set(owner, value);
        }
        return value;
      };
      for (const glyph of fragment.glyphs) {
        if (!Number.isFinite(glyph.advance))
          throw new Error("Invalid native fragment advance.");
        const value = part(glyph.cluster);
        value.width = Math.fround(value.width + glyph.advance);
        await checkpoint();
      }
      for (const spacing of fragment.spacings) {
        if (!Number.isFinite(spacing.advance) || spaced.has(spacing.cluster))
          throw new Error("Invalid native fragment spacing.");
        spaced.add(spacing.cluster);
        part(spacing.cluster).spacing += spacing.advance;
        await checkpoint();
      }
      for (const [owner, value] of parts) {
        widths[owner] = Math.fround(
          widths[owner] + Math.fround(value.width + Math.fround(value.spacing)),
        );
        await checkpoint();
      }
    }
  if (spaced.size !== owners.size)
    throw new Error("Native span allocation is missing source spacing.");
  const frames: { start: number; end: number; offset: number }[] = [];
  let start = 0,
    advance = 0;
  for (let i = 0; i < widths.length; i++) {
    const width = Math.trunc(widths[i] * 64) / 64;
    if (!Number.isSafeInteger(width * 64))
      throw new Error("Native source span exceeds exact coordinates.");
    const offset =
      line.direction === "rtl" ? (counts[i] === 1 ? 0 : -width) : advance;
    frames.push(Object.freeze({ start, end: ends[i], offset }));
    start = ends[i];
    advance += width;
    if (!Number.isSafeInteger(advance * 64))
      throw new Error("Native source spans exceed exact coordinates.");
    await checkpoint();
  }
  const glyphs: Readonly<FloatGlyph>[] = [];
  for (const candidate of candidates) {
    const allocation = candidate.inlineAllocation!;
    for (let i = 0; i < candidate.glyphs.length; i++) {
      const glyph = candidate.glyphs[i],
        owner = owners.get(glyph.sourceCluster!);
      if (owner === undefined)
        throw new Error("Native glyph has no original source span.");
      const offset = frames[owner].offset,
        delta =
          (Math.floor(offset + 0.5) - offset) / factor - allocation.offset,
        angle = (allocation.rotations[i] * Math.PI) / 180;
      glyphs.push(
        delta
          ? Object.freeze({
              ...glyph,
              origin: Object.freeze({
                x: (glyph.origin?.x ?? 0) - Math.sin(angle) * delta,
                y: (glyph.origin?.y ?? 0) + Math.cos(angle) * delta,
              }),
            })
          : glyph,
      );
      await checkpoint();
    }
  }
  check();
  return Object.freeze({
    glyphs: Object.freeze(glyphs),
    frames: Object.freeze(frames),
    advance,
    factor,
  });
}
