import { AffineTransform } from "../core/affine";
import { characterFormatSchema } from "../core/character-format";
import { verticalWriting } from "../core/text-writing";
import { applyTextStyle } from "../core/text-style";
import { yieldTask } from "../core/task-yield";
import { unicodeTextProperties } from "../fonts/unicode-text-data";
import { captureNativeFontVariations } from "../fonts/variations";
import type { OwnedFontRun } from "../fonts/shaping-types";
import { captureNativeFontInstance } from "./native-font-instance";
import { createCanvas, release } from "./canvas";
import type { StyledTextPlan } from "./styled-text";
import type {
  NativeGlyphFont,
  NativeGlyphFontControl,
} from "./native-glyph-font";
import type { NativeSvgGlyphSource } from "./native-svg-source";
import type { NativeSvgGlyphCandidate } from "./native-svg-candidates";
import type { FloatGlyph } from "./float-glyph";

const caps: Record<string, string[]> = {
  normal: [],
  "small-caps": ["smcp"],
  "all-small-caps": ["c2sc", "smcp"],
  "petite-caps": ["pcap"],
  "all-petite-caps": ["c2pc", "pcap"],
  unicase: ["unic"],
  "titling-caps": ["titl"],
};
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

/** A complete source-derived stream, never a matched result. Original per-font
 * advances establish parent allocation when character addresses after a styled
 * mark are unreliable. The ordinary complete ink/color gate remains mandatory.
 * Mixed bidi, paths and vertical source retain their existing preparations. */
export async function prepareNativeSvgParent(
  plan: StyledTextPlan,
  index: number,
  slots: readonly Readonly<{
    font: NativeGlyphFont;
    source: NativeSvgGlyphSource;
  }>[],
  control: NativeGlyphFontControl,
): Promise<readonly Readonly<NativeSvgGlyphCandidate>[] | undefined> {
  const line = plan.scene.lines[index];
  if (
    line.path ||
    verticalWriting(line.writing) ||
    line.spans.length < 2 ||
    !slots.length ||
    !plan.paint
  )
    return;
  const fields = Object.keys(characterFormatSchema.shape).filter(
    (key) => key !== "color",
  ) as (keyof (typeof line.spans)[number]["style"])[];
  if (
    line.spans.some((span) =>
      fields.some((key) => span.style[key] !== line.spans[0].style[key]),
    )
  )
    return;
  const text = line.spans.map((span) => span.text).join("");
  const check = () => {
    control.signal?.throwIfAborted();
    plan.check();
    for (const slot of slots) slot.font.check();
    control.check?.();
    control.signal?.throwIfAborted();
  };
  let deadline = performance.now() + 2;
  const checkpoint = async () => {
    check();
    if (performance.now() >= deadline) {
      await yieldTask();
      check();
      deadline = performance.now() + 2;
    }
  };
  let strong = false;
  for (const character of text) {
    const bidi = unicodeTextProperties(character.codePointAt(0)!).bidi;
    if (controls.has(bidi)) return;
    if (bidi === "L") strong = true;
    await checkpoint();
  }
  if (!strong) return;
  const world = new AffineTransform(
    ...(plan.scene.transform as [
      number,
      number,
      number,
      number,
      number,
      number,
    ]),
  );
  const first = plan.paint.characters[index][0];
  if (!first || first.rotation !== 0) return;
  const result: Readonly<NativeSvgGlyphCandidate>[] = [];
  let cursor = 0,
    penX = 0,
    penY = 0,
    anchor: number | undefined;
  const layout = (value: number) => {
    const units = Math.trunc(value * 64);
    if (!Number.isSafeInteger(units))
      throw new Error("Native parent allocation exceeds exact coordinates.");
    return units / 64;
  };
  for (const slot of slots) {
    const { source, font } = slot,
      style = source.style;
    if (
      source.text !== text ||
      source.start !== cursor ||
      !source.items?.length ||
      !font.svgFont
    )
      return;
    const canvas = createCanvas(1, 1),
      variation = captureNativeFontVariations([style]);
    const runs: OwnedFontRun[] = [],
      glyphs: Readonly<FloatGlyph>[] = [];
    try {
      const context = canvas.getContext("2d")!;
      applyTextStyle(context, style);
      const css = captureNativeFontInstance(
        context,
        style.fontWeight,
        font.descriptors,
        style.fontSize,
      );
      const items: { start: number; end: number; script: string }[] = [];
      for (const item of source.items) {
        const last = items.at(-1);
        if (last && last.end === item.start && last.script === item.script)
          last.end = item.end;
        else
          items.push({ start: item.start, end: item.end, script: item.script });
      }
      for (const item of items) {
        if (item.start !== cursor || item.end > source.end) return;
        variation.check();
        const run = await font.shapeRun(
          {
            text,
            itemOffset: item.start,
            itemLength: item.end - item.start,
            direction: "ltr",
            ...(item.script === "Zyyy" ? {} : { script: item.script }),
            css,
            features: [
              { tag: "kern", value: style.fontKerning === "none" ? 0 : 1 },
              ...(caps[style.fontVariantCaps ?? "normal"] ?? []).map((tag) => ({
                tag,
                value: 1,
              })),
              ...(style.letterSpacing
                ? [
                    { tag: "liga", value: 0 },
                    { tag: "clig", value: 0 },
                  ]
                : []),
            ],
          },
          { ...control, check },
        );
        await checkpoint();
        if (!run.glyphs.length || run.glyphs.some((g) => g.glyphId === 0))
          return;
        runs.push(run);
        const scale = style.fontSize / run.unitsPerEm;
        const starts = [...new Set(run.glyphs.map((g) => g.cluster))].sort(
          (a, b) => a - b,
        );
        const ends = new Map(
          starts.map((start, i) => [start, starts[i + 1] ?? item.end]),
        );
        if (anchor === undefined) {
          const cluster = run.glyphs[0].cluster;
          const advance =
            run.glyphs
              .filter((g) => g.cluster === cluster)
              .reduce((value, g) => value + g.xAdvance * scale, 0) +
            style.letterSpacing;
          anchor =
            advance < 0 ? Math.max(first.start.x, first.end.x) : first.start.x;
        }
        for (let i = 0; i < run.glyphs.length; i++) {
          const glyph = run.glyphs[i];
          const origin = {
            x: anchor + layout(penX) + glyph.xOffset * scale,
            y: first.start.y - layout(penY) - glyph.yOffset * scale,
          };
          glyphs.push(
            Object.freeze({
              font,
              glyphId: glyph.glyphId,
              sourceCluster: glyph.cluster,
              style,
              color: source.color(glyph.cluster),
              surface: "svg",
              paintFontSize: style.fontSize,
              transform: world.multiply(
                AffineTransform.translation(origin.x, origin.y),
              ),
            }),
          );
          penX += glyph.xAdvance * scale;
          penY += glyph.yAdvance * scale;
          if (run.glyphs[i + 1]?.cluster !== glyph.cluster) {
            const fragment = text.slice(glyph.cluster, ends.get(glyph.cluster));
            penX +=
              style.letterSpacing +
              [...fragment].filter((c) => c === " " || c === "\u00a0").length *
                (style.wordSpacing + line.wordSpacingDelta);
          }
          await checkpoint();
        }
        cursor = item.end;
      }
      if (cursor !== source.end) return;
      result.push(
        Object.freeze({
          projection: "matrix",
          hiddenGlyphs: 0,
          runs: Object.freeze(runs),
          glyphs: Object.freeze(glyphs),
        }),
      );
    } finally {
      release(canvas);
      variation.release();
    }
  }
  check();
  if (cursor !== text.length) return;
  return Object.freeze(result);
}
