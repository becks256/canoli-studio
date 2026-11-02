import { yieldTask } from "../core/task-yield";
import type { FloatGlyph } from "./float-glyph";
import type { StyledTextLine } from "./styled-text";
import type { NativeSvgGlyphCandidate } from "./native-svg-candidates";

export interface NativeSvgInlineCandidateAllocation {
  readonly factor: number;
  /** Rounding correction already included in the candidate, in source units. */
  readonly offset: number;
  readonly rotations: readonly number[];
  /** Signed original native advances in physical 1/64-pixel layout units. */
  readonly sizes: readonly Readonly<{
    start: number;
    end: number;
    advance: number;
  }>[];
  /** Original shaping fragments before layout-unit truncation. Paint projection
   * selection never grants these records independent matching authority. */
  readonly fragments?: readonly Readonly<{
    readonly glyphs: readonly Readonly<{ cluster: number; advance: number }>[];
    readonly spacings: readonly Readonly<{
      cluster: number;
      advance: number;
    }>[];
  }>[];
}

/** Resolve the complete original inline frame after all font items are present.
 * Character rectangles can enclose/clamp negative advances; sum original native
 * layout advances instead. No verification pixels determine an offset. Multiple
 * authored spans need their actual native inline parents and remain on existing
 * candidates until that allocation is represented. This grants no match status. */
export async function resolveNativeSvgInlineFrames(
  line: StyledTextLine,
  candidates: readonly Readonly<NativeSvgGlyphCandidate>[],
  check: () => void,
) {
  check();
  if (
    line.spans.length !== 1 ||
    !candidates.length ||
    candidates.some((c) => !c.inlineAllocation)
  )
    return;
  const factor = candidates[0].inlineAllocation!.factor,
    length = line.spans[0].text.length;
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
    throw new Error("Invalid native source inline allocation.");
  const sizes = candidates
    .flatMap((c) => c.inlineAllocation!.sizes)
    .sort((a, b) => a.start - b.start);
  let cursor = 0,
    total = 0,
    deadline = performance.now() + 2;
  const checkpoint = async () => {
    check();
    if (performance.now() >= deadline) {
      await yieldTask();
      check();
      deadline = performance.now() + 2;
    }
  };
  for (const size of sizes) {
    if (
      !Number.isSafeInteger(size.start) ||
      !Number.isSafeInteger(size.end) ||
      size.start < 0 ||
      size.end <= size.start ||
      size.end > length ||
      !Number.isSafeInteger(size.advance * 64)
    )
      throw new Error("Invalid native source inline size.");
    if (size.start !== cursor) return;
    cursor = size.end;
    total += size.advance;
    if (!Number.isSafeInteger(total * 64))
      throw new Error("Native inline allocation exceeds exact coordinates.");
    await checkpoint();
  }
  if (cursor !== length) return;
  const offset = line.direction === "rtl" ? Math.max(0, total) - total : 0;
  const frames = Object.freeze([
      Object.freeze({ start: 0, end: length, offset }),
    ]),
    glyphs: Readonly<FloatGlyph>[] = [];
  for (const candidate of candidates) {
    const allocation = candidate.inlineAllocation!,
      delta = (Math.floor(offset + 0.5) - offset) / factor - allocation.offset;
    for (let i = 0; i < candidate.glyphs.length; i++) {
      const glyph = candidate.glyphs[i],
        angle = (allocation.rotations[i] * Math.PI) / 180;
      if (!delta) {
        glyphs.push(glyph);
        await checkpoint();
        continue;
      }
      glyphs.push(
        Object.freeze({
          ...glyph,
          origin: Object.freeze({
            x: (glyph.origin?.x ?? 0) - Math.sin(angle) * delta,
            y: (glyph.origin?.y ?? 0) + Math.cos(angle) * delta,
          }),
        }),
      );
      await checkpoint();
    }
  }
  check();
  return Object.freeze({
    glyphs: Object.freeze(glyphs),
    frames,
    advance: total,
    factor,
  });
}
