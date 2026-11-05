import { yieldTask } from "../core/task-yield";
import { verticalWriting } from "../core/text-writing";
import type { FloatGlyph } from "./float-glyph";
import type { StyledTextLine } from "./styled-text";
import type { NativeSvgGlyphCandidate } from "./native-svg-candidates";

/** A complete original-span allocation candidate for vertical ink.
 * Preserve Float32 native fragment advances until the original span is complete.
 * A one-cluster RTL span retains its unrounded parent preparation; multi-cluster
 * spans can use their own signed inline extent. These are candidate placements,
 * never inferred from comparison pixels; the original ink/ownership gates still
 * decide whether the complete assembly matches. Paths retain per-cluster native
 * sizes; RTL parent preparation also retains the source-coordinate layout grid.
 * Cross-span clusters keep the other preparations until their allocation is known. */
export async function resolveNativeSvgSpanFrames(
  line: StyledTextLine,
  candidates: readonly Readonly<NativeSvgGlyphCandidate>[],
  check: () => void,
) {
  check();
  if (
    line.spans.length < 2 ||
    !candidates.length ||
    candidates.some(
      (c) =>
        !c.inlineAllocation || (!line.path && !c.inlineAllocation.fragments),
    )
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
  const widths = line.spans.map(() => 0);
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
    if (line.path) {
      widths[span] += size.advance;
      if (!Number.isSafeInteger(widths[span] * 64))
        throw new Error("Native source span exceeds exact coordinates.");
    }
  }
  if (cursor !== length) return;
  if (!line.path) {
    const spaced = new Set<number>();
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
            widths[owner] +
              Math.fround(value.width + Math.fround(value.spacing)),
          );
          await checkpoint();
        }
      }
    if (spaced.size !== owners.size)
      throw new Error("Native span allocation is missing source spacing.");
  }
  const nativeWidths: number[] = [];
  const frames: { start: number; end: number; offset: number }[] = [];
  let start = 0,
    advance = 0;
  for (let i = 0; i < widths.length; i++) {
    const nativeWidth = Math.trunc(widths[i] * 64) / 64;
    nativeWidths.push(nativeWidth);
    let width = nativeWidth;
    if (line.path && line.direction === "rtl") {
      // Preserve both coordinate grids before rounding the RTL parent's line top.
      // This proposes a frame from native metrics; exact ink/ownership still decides
      // whether it can be published, without searching displacement from pixels.
      const sourceWidth = Math.trunc(Math.fround(width / factor) * 64) / 64;
      if (!Number.isSafeInteger(sourceWidth * 64))
        throw new Error("Native source span exceeds exact coordinates.");
      width = Math.trunc(Math.fround(sourceWidth * factor) * 64) / 64;
    }
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
    nativeWidths: Object.freeze(nativeWidths),
  });
}

/** A zero-advance attachment can retain its captured native pose while its
 * signed spacing allocates a negative cell. Offer that preparation separately
 * from the advancing original-span frame. Original glyphs, fonts, text and paint
 * remain intact; complete ink and ownership still decide acceptance. */
export async function resolveNativeSvgSignedAttachments(
  line: StyledTextLine,
  candidates: readonly Readonly<NativeSvgGlyphCandidate>[],
  allocation: NonNullable<Awaited<ReturnType<typeof resolveNativeSvgSpanFrames>>>,
  check: () => void,
): Promise<readonly Readonly<FloatGlyph>[] | undefined> {
  check();
  if (line.path || !verticalWriting(line.writing)) return;
  const glyphs: Readonly<FloatGlyph>[] = [];
  let at = 0,
    changed = false,
    deadline = performance.now() + 2;
  const checkpoint = async () => {
    check();
    if (performance.now() >= deadline) {
      await yieldTask();
      check();
      deadline = performance.now() + 2;
    }
  };
  for (const candidate of candidates) {
    const negative = new Set<number>(),
      attachments = new Set<string>();
    for (const size of candidate.inlineAllocation!.sizes) {
      if (size.advance < 0) negative.add(size.start);
      await checkpoint();
    }
    for (const run of candidate.runs)
      for (const glyph of run.glyphs) {
        if (!glyph.xAdvance && !glyph.yAdvance)
          attachments.add(`${glyph.cluster}:${glyph.glyphId}`);
        await checkpoint();
      }
    for (const original of candidate.glyphs) {
      const placed = allocation.glyphs[at++];
      if (!placed)
        throw new Error("Native signed attachment lost its span placement.");
      const glyph =
        negative.has(original.sourceCluster!) &&
        attachments.has(`${original.sourceCluster}:${original.glyphId}`)
          ? original
          : placed;
      changed ||= glyph !== placed;
      glyphs.push(glyph);
      await checkpoint();
    }
  }
  if (at !== allocation.glyphs.length)
    throw new Error("Native signed attachment lost a source glyph.");
  check();
  return changed ? Object.freeze(glyphs) : undefined;
}

/** An independent parent preparation in native visual span order. All source
 * text, clusters, fonts and glyph order remain; this has no matching authority. */
export async function resolveNativeSvgVisualSpanFrames(
  line: StyledTextLine,
  original: NonNullable<Awaited<ReturnType<typeof resolveNativeSvgSpanFrames>>>,
  candidates: readonly Readonly<NativeSvgGlyphCandidate>[],
  visual: readonly Readonly<{ order: number }>[] | null | undefined,
  check: () => void,
) {
  check();
  if (!visual || visual.length !== original.frames.at(-1)!.end) return;
  const { factor, nativeWidths } = original;
  const order: { index: number; min: number; max: number }[] = [];
  let scanDeadline = performance.now() + 2;
  for (let index = 0; index < original.frames.length; index++) {
    const frame = original.frames[index];
    let min = Infinity,
      max = -Infinity;
    for (let at = frame.start; at < frame.end; at++) {
      const value = visual[at].order;
      min = Math.min(min, value);
      max = Math.max(max, value);
      if (performance.now() >= scanDeadline) {
        await yieldTask();
        check();
        scanDeadline = performance.now() + 2;
      }
    }
    order.push({ index, min, max });
  }
  order.sort((a, b) => a.min - b.min);
  if (
    order.some(
      (value) => !Number.isFinite(value.min) || !Number.isFinite(value.max),
    )
  )
    throw new Error("Invalid native visual span allocation.");
  if (order.some((value, index) => index && value.min <= order[index - 1].max))
    return;
  const offsets: number[] = [],
    frames = original.frames.map((frame) => ({ ...frame }));
  let advance = 0;
  for (const value of order) {
    let offset = advance;
    if (line.path && line.direction === "rtl") {
      offset =
        Math.trunc(
          Math.fround(
            (Math.trunc(Math.fround(offset / factor) * 64) / 64) * factor,
          ) * 64,
        ) / 64;
    }
    offsets[value.index] = offset;
    frames[value.index].offset = offset;
    advance += nativeWidths[value.index];
    if (
      !Number.isSafeInteger(advance * 64) ||
      !Number.isSafeInteger(offset * 64)
    )
      throw new Error("Native visual spans exceed exact coordinates.");
  }
  let at = 0,
    deadline = performance.now() + 2;
  const glyphs: Readonly<FloatGlyph>[] = [];
  for (const candidate of candidates)
    for (let i = 0; i < candidate.glyphs.length; i++) {
      const glyph = original.glyphs[at++],
        cluster = glyph.sourceCluster!;
      let lo = 0,
        hi = original.frames.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (original.frames[mid].end <= cluster) lo = mid + 1;
        else hi = mid;
      }
      const owner =
        lo < original.frames.length && original.frames[lo].start <= cluster
          ? lo
          : -1;
      if (owner < 0) throw new Error("Native visual glyph has no source span.");
      const old = original.frames[owner].offset,
        next = offsets[owner],
        delta =
          (Math.floor(next + 0.5) - next - (Math.floor(old + 0.5) - old)) /
          factor,
        angle = (candidate.inlineAllocation!.rotations[i] * Math.PI) / 180;
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
      if (performance.now() >= deadline) {
        await yieldTask();
        check();
        deadline = performance.now() + 2;
      }
    }
  check();
  return Object.freeze({
    glyphs: Object.freeze(glyphs),
    frames: Object.freeze(frames.map((frame) => Object.freeze(frame))),
    advance,
    factor,
    nativeWidths,
  });
}
