import type { NativeSvgGlyphSource } from "./native-svg-source";
import { AffineTransform } from "../core/affine";
import { textPathData } from "../core/text-path";
import { yieldTask } from "../core/task-yield";
import type { FontRunCss } from "../fonts/css-instance";
import type { OwnedFontRun } from "../fonts/shaping-types";
import type { FloatGlyph } from "./float-glyph";
import type {
  NativeGlyphFont,
  NativeGlyphFontControl,
} from "./native-glyph-font";
import type { StyledTextPlan } from "./styled-text";
import {
  captureSvgGlyphDocument,
  measureSvgGlyphAdvances,
} from "./svg-glyph-paint";

const nativeInlineRanges = new WeakMap<
  readonly import("./styled-text").StyledTextCharacterGeometry[],
  Readonly<Record<"x" | "y", Readonly<{ min: number; max: number }>>>
>();
export function nativeInlineRange(
  flat: readonly import("./styled-text").StyledTextCharacterGeometry[],
  axis: "x" | "y" = "x",
) {
  const cached = nativeInlineRanges.get(flat);
  if (cached) return cached[axis];
  const ranges = {
    x: { min: Infinity, max: -Infinity },
    y: { min: Infinity, max: -Infinity },
  };
  for (const character of flat)
    for (const key of ["x", "y"] as const) {
      ranges[key].min = Math.min(
        ranges[key].min,
        character.start[key],
        character.end[key],
      );
      ranges[key].max = Math.max(
        ranges[key].max,
        character.start[key],
        character.end[key],
      );
    }
  if (
    !Object.values(ranges).every(
      (range) => Number.isFinite(range.min) && Number.isFinite(range.max),
    )
  )
    throw new Error("Native baseline inline range is invalid.");
  const value = Object.freeze({
    x: Object.freeze(ranges.x),
    y: Object.freeze(ranges.y),
  });
  if (Object.isFrozen(flat)) nativeInlineRanges.set(flat, value);
  return value[axis];
}

/** Replay the original baseline with the original native typographic items.
 * The straight textPath probe preserves native path itemization. Its positions
 * and independently measured candidate advances recover native inline units;
 * reference pixels never supply coordinates or a fitting objective. A caller
 * must verify complete original/candidate ink before publishing these poses. */
export async function positionNativeSvgPathGlyphs(
  plan: StyledTextPlan,
  font: NativeGlyphFont,
  index: number,
  run: OwnedFontRun,
  css: FontRunCss,
  control: NativeGlyphFontControl,
  selection?: NativeSvgGlyphSource,
  paintSpacing = 0,
  sourceAdvances = false,
  nativeAnchor = false,
): Promise<readonly Readonly<FloatGlyph>[] | undefined> {
  if (!Number.isFinite(paintSpacing))
    throw new Error("Invalid native baseline glyph spacing.");
  const line = plan.scene.lines[index],
    flat = plan.paint?.pathCharacters[index];
  if (!line.path || !font.svgMetrics || !flat) return;
  const options = { ...control },
    mode = { ...css },
    check = () => {
      options.signal?.throwIfAborted();
      plan.check();
      font.check();
      options.check?.();
      options.signal?.throwIfAborted();
      plan.check();
      font.check();
    };
  check();
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
    factor = Math.fround(
      Math.sqrt(
        (world.a ** 2 + world.b ** 2 + world.c ** 2 + world.d ** 2) / 2,
      ),
    );
  if (!factor) return;
  const style = selection?.style ?? line.spans[0].style,
    colorAt = selection?.color ?? (() => plan.paint!.colors[index][0]),
    color = colorAt(run.request.itemOffset),
    ids = [...new Set(run.glyphs.map((g) => g.glyphId))],
    computed = Math.fround(style.fontSize * factor),
    metrics = await font.svgMetrics(ids, style, mode, computed, {
      ...options,
      check,
    });
  check();
  const nominals = new Map(
      metrics.glyphs.map((glyph) => [glyph.id, glyph.nominal]),
    ),
    spacingFor = (glyph: OwnedFontRun["glyphs"][number]) =>
      paintSpacing +
      (sourceAdvances
        ? ((glyph.xAdvance - nominals.get(glyph.glyphId)!) * metrics.em) /
          (run.unitsPerEm * factor)
        : 0),
    key = (id: number, spacing: number) => JSON.stringify([id, spacing]),
    unique = new Map<string, { id: number; spacing: number }>();
  for (const glyph of run.glyphs) {
    const spacing = spacingFor(glyph);
    unique.set(key(glyph.glyphId, spacing), { id: glyph.glyphId, spacing });
  }
  const probes = [...unique.values()];
  const measure = await captureSvgGlyphDocument(
      probes.map(({ id, spacing }) => ({
        font,
        glyphId: id,
        style,
        surface: "svg",
        color,
        transform: world,
        ...(spacing ? { paintLetterSpacing: spacing } : {}),
      })),
      { ...options, check },
    ),
    advances = await measureSvgGlyphAdvances(measure, check);
  check();
  if (advances.length !== probes.length)
    throw new Error("Native baseline glyph advances are incomplete.");
  // The native anchor uses positional extent. Summed measured advances can
  // differ when original negative fragments overlap or collapse.
  const ownWidths = new Map(
      probes.map((probe, i) => [
        key(probe.id, probe.spacing),
        Math.round(advances[i] * factor * 64) / 64,
      ]),
    ),
    scale = metrics.em / run.unitsPerEm,
    data = textPathData(line.path),
    transform = world.multiply(AffineTransform.translation(line.x, line.y)),
    sorted = [...new Set(run.glyphs.map((g) => g.cluster))].sort(
      (a, b) => a - b,
    ),
    layout = new Map<
      number,
      { left: number; width: number; angle: number; hidden: boolean }
    >(),
    characters = plan.paint!.characters[index],
    fraction = line.align === "left" ? 0 : line.align === "center" ? 0.5 : 1,
    range = nativeAnchor ? nativeInlineRange(flat) : undefined,
    align = range
      ? Math.round(
          (range.min + (range.max - range.min) * fraction) * factor * 64,
        ) / 64
      : (fraction * Math.round(plan.metrics[index].advance * factor * 64)) / 64;
  let deadline = performance.now() + 2;
  for (let i = 0; i < sorted.length; i++) {
    const cluster = sorted[i],
      end = sorted[i + 1] ?? selection?.end ?? line.spans[0].text.length;
    let left = Infinity,
      right = -Infinity,
      hidden = true;
    for (let j = cluster; j < end; j++) {
      const c = flat[j],
        original = characters[j];
      left = Math.min(left, c.start.x, c.end.x);
      right = Math.max(right, c.start.x, c.end.x);
      hidden &&=
        original.start.x === 0 &&
        original.start.y === 0 &&
        original.end.x === 0 &&
        original.end.y === 0 &&
        original.extent.width === 0 &&
        original.extent.height === 0;
    }
    left = Math.round(left * factor * 64) / 64 - align;
    right = Math.round(right * factor * 64) / 64 - align;
    layout.set(cluster, {
      left,
      width: right - left,
      angle: (characters[cluster].rotation * Math.PI) / 180,
      hidden,
    });
    if (performance.now() >= deadline) {
      await yieldTask();
      check();
      deadline = performance.now() + 2;
    }
  }
  const positioned: Readonly<FloatGlyph>[] = [];
  let penX = 0,
    penY = 0,
    cluster = -1;
  for (const g of run.glyphs) {
    if (g.cluster !== cluster) {
      cluster = g.cluster;
      penX = penY = 0;
    }
    const item = layout.get(cluster)!,
      spacing = spacingFor(g),
      own = ownWidths.get(key(g.glyphId, spacing))!;
    if (!item.hidden) {
      const mid = Math.fround(
          Math.fround(Math.fround(item.left + item.width / 2) / factor) +
            Math.fround(line.path.startOffset),
        ),
        offset = Math.fround(mid - Math.fround(own / 2 / factor)),
        dx = (own - item.width) / 2 + penX + g.xOffset * scale,
        dy = -(penY + g.yOffset * scale),
        cos = Math.cos(item.angle),
        sin = Math.sin(item.angle),
        origin = Object.freeze({
          x: (cos * dx - sin * dy) / factor,
          y: (sin * dx + cos * dy) / factor,
        });
      positioned.push(
        Object.freeze({
          font,
          glyphId: g.glyphId,
          sourceCluster: g.cluster,
          style,
          surface: "svg",
          color: colorAt(g.cluster),
          transform,
          origin,
          ...(spacing ? { paintLetterSpacing: spacing } : {}),
          path: Object.freeze({
            data,
            startOffset: offset,
            baselineOffset: line.path.baselineOffset,
          }),
        }),
      );
    }
    penX += g.xAdvance * scale;
    penY += g.yAdvance * scale;
    if (performance.now() >= deadline) {
      await yieldTask();
      check();
      deadline = performance.now() + 2;
    }
  }
  check();
  return Object.freeze(positioned);
}
