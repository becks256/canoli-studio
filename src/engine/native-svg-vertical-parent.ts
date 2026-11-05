import { AffineTransform } from "../core/affine";
import { characterFormatSchema } from "../core/character-format";
import { yieldTask } from "../core/task-yield";
import { unicodeTextProperties } from "../fonts/unicode-text-data";
import type { FloatGlyph } from "./float-glyph";
import type { NativeSvgGlyphCandidate } from "./native-svg-candidates";
import type {
  StyledTextLine,
  StyledTextCharacterGeometry,
} from "./styled-text";

const metricFields = Object.keys(characterFormatSchema.shape).filter(
  (key) => key !== "color",
) as (keyof StyledTextLine["spans"][number]["style"])[];
const controls = new Set([
  "R",
  "AL",
  "RLE",
  "RLO",
  "LRE",
  "LRO",
  "PDF",
  "LRI",
  "RLI",
  "FSI",
  "PDI",
  "BN",
]);

/** Original SVG character addresses after a cross-span mark can describe later
 * cells rather than their source characters. Offer a parent stream from original
 * per-font advances and the first native anchor. No reference pixels fit poses;
 * the caller still verifies complete original ink and per-color ownership. */
export async function resolveNativeSvgVerticalParent(
  line: StyledTextLine,
  candidates: readonly Readonly<NativeSvgGlyphCandidate>[],
  characters: readonly StyledTextCharacterGeometry[],
  check: () => void,
): Promise<readonly Readonly<FloatGlyph>[] | undefined> {
  check();
  if (
    line.path ||
    line.writing?.orientation !== "upright" ||
    line.spans.length < 2 ||
    line.spans.some((span) =>
      metricFields.some((key) => span.style[key] !== line.spans[0].style[key]),
    ) ||
    candidates.some(
      (candidate) =>
        !candidate.inlineAllocation?.fragments ||
        candidate.hiddenGlyphs ||
        candidate.runs.some(
          (run) =>
            run.request.direction !== "ttb" || run.request.script !== "Latn",
        ),
    )
  )
    return;
  const text = line.spans.map((span) => span.text).join("");
  if (characters.length !== text.length || !characters.length) return;
  const breaks = new Set<number>();
  let offset = 0;
  for (const span of line.spans) {
    offset += span.text.length;
    const previous = text.charCodeAt(offset - 1),
      next = text.charCodeAt(offset);
    if (
      previous >= 0xd800 &&
      previous <= 0xdbff &&
      next >= 0xdc00 &&
      next <= 0xdfff
    )
      return;
    breaks.add(offset);
  }
  let crossesCluster = false;
  for (const part of new Intl.Segmenter("und", {
    granularity: "grapheme",
  }).segment(text))
    for (let at = part.index + 1; at < part.index + part.segment.length; at++)
      if (breaks.has(at)) crossesCluster = true;
  if (!crossesCluster) return;
  let deadline = performance.now() + 2;
  const checkpoint = async () => {
    check();
    if (performance.now() >= deadline) {
      await yieldTask();
      check();
      deadline = performance.now() + 2;
    }
  };
  for (const character of text) {
    if (controls.has(unicodeTextProperties(character.codePointAt(0)!).bidi))
      return;
    await checkpoint();
  }
  const factor = candidates[0]?.inlineAllocation?.factor;
  if (factor === undefined || factor <= 0 || !Number.isFinite(factor))
    throw new Error("Invalid native vertical parent scale.");
  const advances = new Map<number, number>(),
    spacings = new Map<number, number>(),
    ends = new Map<number, number>();
  for (const candidate of candidates) {
    const allocation = candidate.inlineAllocation!;
    if (allocation.factor !== factor) return;
    for (const fragment of allocation.fragments!) {
      for (const glyph of fragment.glyphs) {
        if (!Number.isFinite(glyph.advance))
          throw new Error("Invalid native vertical parent advance.");
        advances.set(
          glyph.cluster,
          (advances.get(glyph.cluster) ?? 0) + glyph.advance,
        );
        await checkpoint();
      }
      for (const spacing of fragment.spacings) {
        if (!Number.isFinite(spacing.advance))
          throw new Error("Invalid native vertical parent spacing.");
        if (spacings.has(spacing.cluster)) return;
        spacings.set(spacing.cluster, spacing.advance);
        await checkpoint();
      }
    }
    for (const run of candidate.runs) {
      if (run.request.text !== text)
        throw new Error("Native vertical parent lost its original context.");
      const clusters = [
        ...new Set(run.glyphs.map((glyph) => glyph.cluster)),
      ].sort((a, b) => a - b);
      for (let i = 0; i < clusters.length; i++) {
        const end =
          clusters[i + 1] ?? run.request.itemOffset + run.request.itemLength;
        if (ends.has(clusters[i])) return;
        ends.set(clusters[i], end);
        await checkpoint();
      }
    }
  }
  const clusters = [...advances.keys()].sort((a, b) => a - b),
    positions = new Map<number, number>(),
    anchors = new Map<number, number>();
  if (clusters[0] !== 0) return;
  const anchor = Math.min(characters[0].start.y, characters[0].end.y);
  let pen = 0;
  for (let i = 0; i < clusters.length; i++) {
    const cluster = clusters[i],
      end = ends.get(cluster),
      units = Math.trunc(pen * 64);
    if (end !== (clusters[i + 1] ?? text.length)) return;
    if (!Number.isSafeInteger(units))
      throw new Error("Native vertical parent exceeds exact coordinates.");
    positions.set(cluster, anchor + units / 64 / factor);
    let old = Infinity;
    for (let at = cluster; at < end; at++) {
      old = Math.min(old, characters[at].start.y, characters[at].end.y);
      await checkpoint();
    }
    anchors.set(cluster, old);
    const advance = advances.get(cluster)! + (spacings.get(cluster) ?? 0);
    if (!Number.isFinite(advance))
      throw new Error("Invalid native vertical parent allocation.");
    if (advance < 0) return;
    pen += advance;
    await checkpoint();
  }
  const glyphs: Readonly<FloatGlyph>[] = [];
  let changed = false;
  for (const candidate of candidates)
    for (const glyph of candidate.glyphs) {
      const cluster = glyph.sourceCluster,
        end = cluster === undefined ? undefined : ends.get(cluster);
      if (cluster === undefined || end === undefined || !positions.has(cluster))
        throw new Error("Native vertical parent lost a source glyph.");
      const delta = positions.get(cluster)! - anchors.get(cluster)!;
      if (!Number.isFinite(delta))
        throw new Error("Invalid native vertical parent displacement.");
      changed ||= delta !== 0;
      glyphs.push(
        delta
          ? Object.freeze({
              ...glyph,
              ...(glyph.origin
                ? {
                    origin: Object.freeze({
                      x: glyph.origin.x,
                      y: glyph.origin.y + delta,
                    }),
                  }
                : {
                    transform: glyph.transform.multiply(
                      AffineTransform.translation(0, delta),
                    ),
                  }),
            })
          : glyph,
      );
      await checkpoint();
    }
  check();
  return changed ? Object.freeze(glyphs) : undefined;
}
