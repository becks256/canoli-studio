import {
  verifyNativeSvgCandidates,
  type NativeSvgCandidates,
} from "./native-svg-candidates";
import { nativeSvgTextItems } from "./native-text-items";
import type { NativeSvgGlyphSource } from "./native-svg-source";
import { captureNativeSvgLineRoot } from "./native-svg-verify";
import { nativeVerticalSvgCandidates } from "./native-svg-vertical";
import { positionNativeSvgPathGlyphs } from "./native-svg-path";
import { AffineTransform } from "../core/affine";
import { fontFamilyNames } from "../core/font-families";
import { parseFontVariations } from "../core/font-variations";
import { verticalWriting } from "../core/text-writing";
import { applyTextStyle } from "../core/text-style";
import { yieldTask } from "../core/task-yield";
import { captureNativeFontVariations } from "../fonts/variations";
import { captureNativeFontInstance } from "./native-font-instance";
import { createCanvas, release } from "./canvas";
import type { StyledTextPlan } from "./styled-text";
import type {
  NativeGlyphFont,
  NativeGlyphFontControl,
} from "./native-glyph-font";
import type { OwnedFontRun } from "../fonts/shaping-types";
import type { FloatGlyph } from "./float-glyph";

export interface NativeSvgGlyphEvidence {
  readonly projection:
    | "matrix"
    | "origin"
    | "path"
    | "screen"
    | "screen-script-spacing"
    | "vertical"
    | "vertical-matrix"
    | "vertical-path"
    | "vertical-line-top"
    | "vertical-source-top"
    | "vertical-native-anchor-path"
    | "vertical-native-source-top"
    | "vertical-signed-native-path"
    | "vertical-native-inline-top"
    | "styled"
    | "tracking-path"
    | "source-advance-path"
    | "native-anchor-path"
    | "fallback";
  readonly paintOrder?: "native" | "source-items" | "reverse-source-items";
  readonly inlineFrames?: readonly Readonly<{
    start: number;
    end: number;
    offset: number;
  }>[];
  readonly inlineAdvance?: number;
  readonly fallbackItems?: readonly Readonly<{
    start: number;
    end: number;
    family: string;
    settings: string;
    projection: NativeSvgGlyphEvidence["projection"];
    nativeMetrics?: boolean;
    nativePositionRounding?: boolean;
  }>[];
  readonly paintOwnership?: Readonly<{
    pixels: number;
    error: number;
    colors: number;
  }>;
  readonly nativeMetrics?: boolean;
  readonly nativePositionRounding?: boolean;
  readonly nativeSharedOrigin?: boolean;
  readonly svgAdvance: number;
  readonly svgPixelsCompared: number;
  readonly svgMaxAlphaError: number;
  readonly hiddenGlyphs: number;
  readonly sourceGlyphs: number;
  readonly sourceClusters: number;
  readonly opacitySamples: readonly number[];
  readonly bounds: Readonly<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
}
export type NativeSvgGlyphMatch =
  | Readonly<{
      status: "matched";
      run: OwnedFontRun;
      runs?: readonly OwnedFontRun[];
      glyphs: readonly Readonly<FloatGlyph>[];
      evidence: Readonly<NativeSvgGlyphEvidence>;
    }>
  | Readonly<{
      status: "mismatch" | "unavailable";
      reason: string;
      evidence?: Readonly<NativeSvgGlyphEvidence>;
    }>;
const cursiveScripts = new Set([
  "Arab",
  "Rohg",
  "Mand",
  "Mong",
  "Nkoo",
  "Phag",
  "Syrc",
]);
const caps: Record<string, string[]> = {
  normal: [],
  "small-caps": ["smcp"],
  "all-small-caps": ["c2sc", "smcp"],
  "petite-caps": ["pcap"],
  "all-petite-caps": ["c2pc", "pcap"],
  unicase: ["unic"],
  "titling-caps": ["titl"],
};

/** Keep the whole captured native chunk. HarfBuzz supplies original glyph IDs
 * and within-cluster positioning; native SVG metadata supplies each cluster's
 * actual baseline/anchor. Addressable characters alone never identify a glyph.
 * A complete native SVG ink comparison guards every published placement. */
export async function matchNativeSvgGlyphLine(
  plan: StyledTextPlan,
  font: NativeGlyphFont,
  index: number,
  control: NativeGlyphFontControl = {},
  selection?: NativeSvgGlyphSource,
): Promise<NativeSvgGlyphMatch> {
  return verifyNativeSvgCandidates(
    plan,
    font,
    index,
    nativeSvgGlyphCandidates(plan, font, index, control, selection),
    control,
    selection?.root,
  );
}

export async function* nativeSvgGlyphCandidates(
  plan: StyledTextPlan,
  font: NativeGlyphFont,
  index: number,
  control: NativeGlyphFontControl = {},
  selection?: NativeSvgGlyphSource,
): NativeSvgCandidates {
  const options = {
      ...control,
      signal: AbortSignal.any([
        ...(control.signal ? [control.signal] : []),
        ...(font.signal ? [font.signal] : []),
      ]),
    },
    timeout = options.timeoutMs ?? 60000;
  if (!Number.isInteger(index) || index < 0 || index >= plan.scene.lines.length)
    throw new Error("Native SVG line index is outside its captured source.");
  if (!Number.isInteger(timeout) || timeout <= 0 || timeout > 0x7fffffff)
    throw new Error("Invalid native SVG matching time budget.");
  const started = performance.now(),
    check = () => {
      options.signal?.throwIfAborted();
      plan.check();
      font.check();
      options.check?.();
      options.signal?.throwIfAborted();
      plan.check();
      font.check();
      if (performance.now() - started >= timeout)
        throw new Error("Native SVG glyph matching exceeded its time budget.");
    },
    remaining = () =>
      Math.max(1, Math.ceil(timeout - (performance.now() - started)));
  check();
  const line = plan.scene.lines[index],
    characters = plan.paint?.characters[index];
  if ((!selection && line.spans.length !== 1) || !characters)
    return Object.freeze({
      status: "unavailable",
      reason:
        "This SVG line requires captured native paint geometry and uniform horizontal glyph decomposition.",
    });
  const span = selection ?? {
      text: line.spans[0].text,
      style: line.spans[0].style,
      start: 0,
      end: line.spans[0].text.length,
      color: () => plan.paint!.colors[index][0],
    },
    style = span.style,
    names = fontFamilyNames(style.fontFamily),
    ranges = new Map(font.axes.map((a) => [a.tag, a])),
    tuple = (s: string) =>
      JSON.stringify(
        parseFontVariations(s)
          .filter((a) => ranges.has(a.tag))
          .map((a) => [
            a.tag,
            Math.max(
              ranges.get(a.tag)!.min,
              Math.min(ranges.get(a.tag)!.max, a.value),
            ),
          ])
          .sort(([a], [b]) => String(a).localeCompare(String(b))),
      );
  if (
    !font.monochrome ||
    !font.svgFont ||
    names.length !== 1 ||
    names[0] !== font.sourceFamily.toLowerCase() ||
    tuple(style.fontVariationSettings ?? "normal") !== tuple(font.settings)
  )
    return Object.freeze({
      status: "unavailable",
      reason:
        "The glyph font differs from the captured monochrome SVG source instance.",
    });
  if (
    characters.length !== span.text.length ||
    (!line.path &&
      !verticalWriting(line.writing) &&
      characters.some((c) => c.rotation !== 0))
  )
    return Object.freeze({
      status: "unavailable",
      reason:
        "Native SVG character addressing requires additional source mapping.",
    });
  if (verticalWriting(line.writing))
    return yield* nativeVerticalSvgCandidates(
      plan,
      font,
      index,
      { ...options, timeoutMs: remaining(), check },
      selection,
    );
  const world = new AffineTransform(
      ...(plan.scene.transform as [
        number,
        number,
        number,
        number,
        number,
        number,
      ]),
    ),
    root = selection?.root ?? captureNativeSvgLineRoot(plan, index);
  const variation = captureNativeFontVariations([style]),
    measure = createCanvas(1, 1);
  try {
    const c = measure.getContext("2d")!;
    applyTextStyle(c, style);
    const css = captureNativeFontInstance(
        c,
        style.fontWeight,
        font.descriptors,
        style.fontSize,
      ),
      axes = font.axes
        .filter((a) => a.tag === "ital" || a.tag === "slnt")
        .map((a) => a.tag as "ital" | "slnt"),
      modes = axes.length
        ? [
            ...axes.map((styleAxis) => ({ ...css, styleAxis })),
            { ...css, styleAxis: "none" as const },
          ]
        : [css],
      kerns =
        style.fontKerning === "auto"
          ? [1, 0]
          : [style.fontKerning === "none" ? 0 : 1];
    for (const kern of kerns)
      for (const mode of modes) {
        check();
        variation.check();
        const features = [
            { tag: "kern", value: kern },
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
          items =
            selection?.items ??
            nativeSvgTextItems(
              span.text,
              plan.paint!.pathCharacters[index] ?? characters,
              line.direction,
              span.start,
              span.end,
              plan.paint!.visual?.[index],
            ),
          runs: OwnedFontRun[] = [],
          records: {
            run: OwnedFontRun;
            glyphs: readonly Readonly<FloatGlyph>[];
            order: number;
            paintSpacing: number;
          }[] = [];
        for (const item of items) {
          const run = await font.shapeRun(
            {
              text: span.text,
              itemOffset: item.start,
              itemLength: item.end - item.start,
              direction: item.direction,
              ...(item.script === "Zyyy" ? {} : { script: item.script }),
              features,
              css: mode,
            },
            { ...options, timeoutMs: remaining(), check },
          );
          check();
          runs.push(run);
          if (run.glyphs.some((g) => g.glyphId === 0))
            return Object.freeze({
              status: "unavailable",
              reason:
                "The SVG line requires missing-glyph or font-fallback painting.",
            });
          const paintSpacing = cursiveScripts.has(item.script)
              ? 0
              : style.letterSpacing,
            clusterAdvances = new Map<number, number>();
          for (const part of run.glyphs)
            clusterAdvances.set(
              part.cluster,
              (clusterAdvances.get(part.cluster) ?? 0) + part.xAdvance,
            );
          const glyphs: Readonly<FloatGlyph>[] = [],
            scale = style.fontSize / run.unitsPerEm,
            clusters = [...new Set(run.glyphs.map((g) => g.cluster))].sort(
              (a, b) => a - b,
            ),
            ends = new Map(
              clusters.map((c, i) => [
                c,
                clusters[i + 1] ??
                  run.request.itemOffset + run.request.itemLength,
              ]),
            );
          let penX = 0,
            penY = 0,
            cluster = -1,
            originX = 0,
            originY = 0,
            deadline = performance.now() + 2;
          for (const g of run.glyphs) {
            if (g.cluster !== cluster) {
              cluster = g.cluster;
              originX = penX;
              originY = penY;
            }
            const geometry = characters[g.cluster];
            if (
              line.path &&
              characters
                .slice(g.cluster, ends.get(g.cluster))
                .every(
                  (c) =>
                    c.start.x === 0 &&
                    c.start.y === 0 &&
                    c.end.x === 0 &&
                    c.end.y === 0 &&
                    c.extent.width === 0 &&
                    c.extent.height === 0,
                )
            ) {
              penX += g.xAdvance;
              penY += g.yAdvance;
              continue;
            }
            const angle = (geometry.rotation * Math.PI) / 180,
              cos = Math.cos(angle),
              sin = Math.sin(angle),
              negativeAdvance =
                (clusterAdvances.get(g.cluster) ?? 0) * scale + paintSpacing <
                0,
              anchor = negativeAdvance
                ? characters
                    .slice(g.cluster, ends.get(g.cluster))
                    .flatMap((c) => [c.start, c.end])
                    .reduce((a, b) =>
                      a.x * cos + a.y * sin >= b.x * cos + b.y * sin ? a : b,
                    )
                : run.request.direction === "rtl"
                  ? characters
                      .slice(g.cluster, ends.get(g.cluster))
                      .flatMap((c) => [c.start, c.end])
                      .reduce((a, b) =>
                        a.x * cos + a.y * sin <= b.x * cos + b.y * sin ? a : b,
                      )
                  : geometry.start,
              dx = (penX - originX + g.xOffset) * scale,
              dy = -(penY - originY + g.yOffset) * scale,
              x = anchor.x + cos * dx - sin * dy,
              y = anchor.y + sin * dx + cos * dy,
              transform = line.path
                ? world.multiply(AffineTransform.translation(line.x, line.y))
                : world;
            glyphs.push(
              Object.freeze({
                font,
                glyphId: g.glyphId,
                sourceCluster: g.cluster,
                style,
                surface: "svg",
                color: span.color(g.cluster),
                transform,
                origin: Object.freeze({ x, y }),
                ...(line.path ? { rotation: geometry.rotation } : {}),
              }),
            );
            penX += g.xAdvance;
            penY += g.yAdvance;
            if (performance.now() >= deadline) {
              await yieldTask();
              check();
              deadline = performance.now() + 2;
            }
          }
          const visual = plan.paint!.visual?.[index];
          let order = item.start;
          if (visual) {
            order = Infinity;
            for (let at = item.start; at < item.end; at++)
              order = Math.min(order, visual[at].order);
          }
          records.push({
            run,
            glyphs: Object.freeze(glyphs),
            order,
            paintSpacing,
          });
        }
        records.sort((a, b) => a.order - b.order);
        const glyphs = records.flatMap((record) => record.glyphs);
        for (const projection of [
          "matrix",
          "origin",
          "path",
          "tracking-path",
          "source-advance-path",
          "native-anchor-path",
          "screen",
          "screen-script-spacing",
        ] as const) {
          let paints: readonly Readonly<FloatGlyph>[] = glyphs;
          if (projection === "matrix")
            paints = glyphs.map((g) =>
              Object.freeze({
                ...g,
                origin: undefined,
                transform: g.transform.multiply(
                  AffineTransform.translation(g.origin!.x, g.origin!.y),
                ),
              }),
            );
          if (
            projection === "path" ||
            projection === "tracking-path" ||
            projection === "source-advance-path" ||
            projection === "native-anchor-path"
          ) {
            if (
              projection === "tracking-path" &&
              records.every((record) => !record.paintSpacing)
            )
              continue;
            const positioned: Readonly<FloatGlyph>[] = [];
            let valid = true;
            for (const { run, paintSpacing } of records) {
              const selected = {
                  ...span,
                  root,
                  start: run.request.itemOffset,
                  end: run.request.itemOffset + run.request.itemLength,
                },
                part = await positionNativeSvgPathGlyphs(
                  plan,
                  font,
                  index,
                  run,
                  mode,
                  { ...options, timeoutMs: remaining(), check },
                  selected,
                  projection !== "path" ? paintSpacing : 0,
                  projection === "source-advance-path" ||
                    projection === "native-anchor-path",
                  projection === "native-anchor-path",
                );
              if (!part) {
                valid = false;
                break;
              }
              positioned.push(...part);
            }
            if (!valid) continue;
            paints = positioned;
          }
          if (projection === "screen" || projection === "screen-script-spacing") {
            if (
              line.path ||
              !font.svgMetrics ||
              font.axes.some((a) => a.tag === "opsz")
            )
              continue;
            if (
              projection === "screen-script-spacing" &&
              records.every((record) => record.paintSpacing === style.letterSpacing)
            )
              continue;
            const factor = Math.fround(
              Math.sqrt(
                (world.a ** 2 + world.b ** 2 + world.c ** 2 + world.d ** 2) / 2,
              ),
            );
            if (!factor) continue;
            const positioned: Readonly<FloatGlyph>[] = [];
            for (const { run, glyphs, paintSpacing } of records) {
              if (!glyphs.length) continue;
              const clusters = [
                  ...new Set(run.glyphs.map((g) => g.cluster)),
                ].sort((a, b) => a - b),
                ends = new Map(
                  clusters.map((c, i) => [
                    c,
                    clusters[i + 1] ??
                      run.request.itemOffset + run.request.itemLength,
                  ]),
                ),
                computed = Math.fround(style.fontSize * factor),
                metrics = await font.svgMetrics(
                  [...new Set(run.glyphs.map((g) => g.glyphId))],
                  style,
                  mode,
                  computed,
                  { ...options, timeoutMs: remaining(), check },
                ),
                native = new Map(metrics.glyphs.map((g) => [g.id, g])),
                scale = metrics.em / run.unitsPerEm,
                inverse = Math.fround(1 / factor),
                capturedFirst = glyphs[0].origin!,
                first = (() => {
                  if (
                    projection !== "screen-script-spacing" ||
                    paintSpacing === style.letterSpacing
                  )
                    return capturedFirst;
                  const initial = run.glyphs[0],
                    end = ends.get(initial.cluster)!,
                    spaces = [...span.text.slice(initial.cluster, end)].filter(
                      (c) => c === " " || c === "\u00a0",
                    ).length;
                  if (!spaces) return capturedFirst;
                  let advance = 0;
                  for (const glyph of run.glyphs) {
                    if (glyph.cluster !== initial.cluster) continue;
                    const metric = native.get(glyph.glyphId)!;
                    advance = Math.fround(
                      advance +
                        Math.fround(
                          metric.advance +
                            (glyph.xAdvance - metric.nominal) * scale,
                        ),
                    );
                  }
                  advance = Math.fround(
                    advance +
                      Math.fround(
                        (style.letterSpacing +
                          spaces * (style.wordSpacing + line.wordSpacingDelta)) *
                          factor,
                      ),
                  );
                  if (advance >= 0) return capturedFirst;
                  // Spaces retain authored tracking in cursive runs. A negative
                  // first space uses the opposite caret edge from the original
                  // globally suppressed-spacing preparation. Keep its complete
                  // source addresses; never infer the displacement from pixels.
                  return Object.freeze({
                    x:
                      Math.max(
                        ...characters
                          .slice(initial.cluster, end)
                          .flatMap((character) => [character.start.x, character.end.x]),
                      ) +
                      (initial.xOffset * style.fontSize) / run.unitsPerEm,
                    y: capturedFirst.y,
                  });
                })(),
                baseX = Math.fround(first.x / inverse),
                baseY = Math.fround(first.y / inverse),
                parent = new AffineTransform(
                  world.a / factor,
                  world.b / factor,
                  world.c / factor,
                  world.d / factor,
                  world.e,
                  world.f,
                );
              let penX = 0,
                penY = 0;
              for (let i = 0; i < run.glyphs.length; i++) {
                const g = run.glyphs[i],
                  m = native.get(g.glyphId)!;
                positioned.push(
                  Object.freeze({
                    font,
                    glyphId: g.glyphId,
                    sourceCluster: g.cluster,
                    style,
                    color: span.color(g.cluster),
                    surface: "svg",
                    paintFontSize: computed,
                    transform: parent,
                    origin: Object.freeze({
                      x: Math.fround(
                        baseX + Math.fround(penX + g.xOffset * scale),
                      ),
                      y: Math.fround(
                        baseY - Math.fround(penY + g.yOffset * scale),
                      ),
                    }),
                  }),
                );
                penX = Math.fround(
                  penX +
                    Math.fround(m.advance + (g.xAdvance - m.nominal) * scale),
                );
                penY = Math.fround(penY + g.yAdvance * scale);
                if (run.glyphs[i + 1]?.cluster !== g.cluster) {
                  const source = span.text.slice(
                    g.cluster,
                    ends.get(g.cluster),
                  ),
                    spaces = [...source].filter(
                      (c) => c === " " || c === "\u00a0",
                    ).length,
                    letterSpacing =
                      projection === "screen-script-spacing" && !spaces
                        ? paintSpacing
                        : style.letterSpacing;
                  penX = Math.fround(
                    penX +
                      Math.fround(
                        (letterSpacing +
                          spaces *
                            (style.wordSpacing + line.wordSpacingDelta)) *
                          factor,
                      ),
                  );
                }
              }
            }
            paints = positioned;
          }
          check();
          yield Object.freeze({
            projection,
            hiddenGlyphs:
              runs.reduce((n, r) => n + r.glyphs.length, 0) - paints.length,
            runs: Object.freeze(runs),
            glyphs: Object.freeze([...paints]),
          });
        }
      }
    return undefined;
  } finally {
    release(measure);
    variation.release();
  }
}
