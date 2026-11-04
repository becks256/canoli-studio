import { matchNativeFallbackSvgLine } from "./native-svg-fallback";
import { characterFormatSchema } from "../core/character-format";
import { fontFamilyNames } from "../core/font-families";
import { verticalWriting } from "../core/text-writing";
import type { FontFileData } from "../core/font-files";
import { yieldTask } from "../core/task-yield";
import { nativeSvgPaintOrder } from "./native-paint-order";
import type { FloatGlyph } from "./float-glyph";
import type { OwnedFontRun } from "../fonts/shaping-types";
import type {
  NativeGlyphFont,
  NativeGlyphFontControl,
} from "./native-glyph-font";
import {
  matchNativeSvgGlyphLine,
  type NativeSvgGlyphMatch,
} from "./native-svg-glyph";
import { captureNativeSvgGlyphSource } from "./native-svg-source";
import {
  captureNativeSvgLineRoot,
  compareNativeSvgGlyphPaint,
  compareNativeSvgPaintOwnership,
} from "./native-svg-verify";
import type { StyledTextPlan } from "./styled-text";

/** Style boundaries select original shaping items, never new DOM text chunks.
 * Color-only boundaries retain ligatures and original cluster paint ownership. */
export async function matchNativeStyledSvgLine(
  plan: StyledTextPlan,
  index: number,
  files: readonly FontFileData[],
  control: NativeGlyphFontControl = {},
): Promise<NativeSvgGlyphMatch> {
  const owners = new Map<string, NativeGlyphFont>();
  let matching = true;
  const options = { ...control },
    started = performance.now(),
    timeout = options.timeoutMs ?? 60000;
  if (!Number.isInteger(timeout) || timeout <= 0 || timeout > 0x7fffffff)
    throw new Error("Invalid native styled matching time budget.");
  const baseCheck = () => {
      options.signal?.throwIfAborted();
      plan.check();
      options.check?.();
      options.signal?.throwIfAborted();
      plan.check();
      if (matching && performance.now() - started >= timeout)
        throw new Error(
          "Native styled glyph matching exceeded its time budget.",
        );
    },
    check = () => {
      baseCheck();
      for (const font of owners.values()) font.check();
    },
    budget = () =>
      Math.max(1, Math.ceil(timeout - (performance.now() - started)));
  check();
  try {
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= plan.scene.lines.length
    )
      throw new Error(
        "Native styled line index is outside its captured source.",
      );
    const line = plan.scene.lines[index];
    if (!plan.paint || !line.spans.length)
      return Object.freeze({
        status: "unavailable",
        reason:
          "Styled glyph matching requires captured native paint geometry.",
      });
    const jointPath =
      !!line.path &&
      line.spans.length > 1 &&
      verticalWriting(line.writing) &&
      line.spans.some(
        (span) =>
          span.style.letterSpacing < 0 ||
          span.style.wordSpacing + line.wordSpacingDelta < 0,
      );
    if (
      jointPath ||
      line.spans.some(
        (span) => fontFamilyNames(span.style.fontFamily).length > 1,
      )
    )
      return await matchNativeFallbackSvgLine(plan, index, files, {
        ...options,
        timeoutMs: budget(),
        check,
      });
    const fields = Object.keys(characterFormatSchema.shape).filter(
        (key) => key !== "color",
      ) as (keyof (typeof line.spans)[number]["style"])[],
      groups: { first: number; last: number }[] = [];
    for (let i = 0; i < line.spans.length; i++) {
      const last = groups.at(-1);
      if (
        last &&
        fields.every(
          (key) =>
            line.spans[last.first].style[key] === line.spans[i].style[key],
        )
      )
        last.last = i + 1;
      else groups.push({ first: i, last: i + 1 });
    }
    const glyphs: Readonly<FloatGlyph>[] = [],
      runs: OwnedFontRun[] = [];
    let hidden = 0;
    for (const group of groups) {
      let first = group.first;
      while (first < group.last) {
        let accepted = false,
          last: NativeSvgGlyphMatch | undefined;
        for (let end = first + 1; end <= group.last; end++) {
          check();
          const source = captureNativeSvgGlyphSource(plan, index, first, end),
            families = fontFamilyNames(source.style.fontFamily),
            file =
              families.length === 1
                ? files.find(
                    (file) =>
                      file.resource.report.faces[0].cssFamily.toLowerCase() ===
                      families[0],
                  )
                : undefined;
          if (!file)
            return Object.freeze({
              status: "unavailable",
              reason:
                "The styled line requires an owned native font or additional fallback itemization.",
            });
          const settings = source.style.fontVariationSettings ?? "normal",
            key = JSON.stringify([file.id, settings]);
          let font = owners.get(key);
          if (!font) {
            font = await plan.captureGlyphFont(file.id, settings, {
              ...options,
              timeoutMs: budget(),
              check: baseCheck,
            });
            check();
            owners.set(key, font);
          }
          const match = await matchNativeSvgGlyphLine(
            plan,
            font,
            index,
            { ...options, timeoutMs: budget(), check },
            source,
          );
          check();
          last = match;
          if (match.status !== "matched") continue;
          glyphs.push(...match.glyphs);
          runs.push(...(match.runs ?? [match.run]));
          hidden += match.evidence.hiddenGlyphs;
          first = end;
          accepted = true;
          break;
        }
        if (!accepted) return last!;
        await yieldTask();
        check();
      }
    }

    const visual = plan.paint.visual?.[index],
      ordered = visual
        ? nativeSvgPaintOrder(glyphs, visual)
        : Object.freeze(glyphs);
    const paint = await compareNativeSvgGlyphPaint(
        plan,
        index,
        captureNativeSvgLineRoot(plan, index),
        ordered,
        { ...options, check },
        budget,
      ),
      ownership = paint.error
        ? undefined
        : await compareNativeSvgPaintOwnership(
            plan,
            index,
            ordered,
            paint.bounds,
            { ...options, check },
            budget,
          ),
      evidence = Object.freeze({
        projection: "styled" as const,
        hiddenGlyphs: hidden,
        svgAdvance: plan.metrics[index].advance,
        svgPixelsCompared: paint.pixels,
        svgMaxAlphaError: paint.error,
        sourceGlyphs: runs.reduce((n, r) => n + r.glyphs.length, 0),
        sourceClusters: runs.reduce(
          (n, r) => n + new Set(r.glyphs.map((g) => g.cluster)).size,
          0,
        ),
        opacitySamples: Object.freeze([1, 0.5]),
        bounds: paint.bounds,
        paintOwnership: ownership,
      });
    if (paint.error || ownership?.error)
      return Object.freeze({
        status: "mismatch",
        reason:
          "The complete native styled ink or paint ownership differs from source-font glyph paint.",
        evidence,
      });
    check();
    return Object.freeze({
      status: "matched",
      run: runs[0],
      runs: Object.freeze(runs),
      glyphs: ordered,
      evidence,
    });
  } finally {
    matching = false;
  }
}
