import { nativeAuthoredSvgCandidates } from "./native-svg-authored";
import { resolveNativeSvgVerticalParent } from "./native-svg-vertical-parent";
import { renderSvgCellAlpha } from "./svg-glyph-paint";
import { prepareNativeSvgParent } from "./native-svg-parent";
import {
  resolveNativeSvgSpanFrames,
  resolveNativeSvgSignedAttachments,
  resolveNativeSvgVisualSpanFrames,
} from "./native-svg-span-frames";
import { resolveNativeSvgInlineFrames } from "./native-svg-inline-frames";
import { shareNativeSvgSourceOrigin } from "./native-svg-source-origin";
import { NativeSvgRejectedPaints } from "./native-svg-rejected-paint";
import {
  characterFormatSchema,
  type CharacterFormat,
} from "../core/character-format";
import type { FontFileData } from "../core/font-files";
import { fontFamilyNames } from "../core/font-families";
import { verticalWriting } from "../core/text-writing";
import { applyTextStyle } from "../core/text-style";
import { yieldTask } from "../core/task-yield";
import type {
  NativeGlyphFont,
  NativeGlyphFontControl,
} from "./native-glyph-font";
import type { StyledTextPlan } from "./styled-text";
import type {
  NativeSvgGlyphMatch,
  NativeSvgGlyphEvidence,
} from "./native-svg-glyph";
import type {
  NativeSvgCandidates,
  NativeSvgGlyphCandidate,
} from "./native-svg-candidates";
import {
  captureNativeSvgGlyphSource,
  type NativeSvgGlyphSource,
} from "./native-svg-source";
import {
  captureNativeSvgLineRoot,
  compareNativeSvgGlyphPaint,
  compareNativeSvgPaintOwnership,
} from "./native-svg-verify";
import { nativeSvgTextItems, sliceNativeTextItems } from "./native-text-items";
import { nativeVerticalTextItems } from "./native-svg-vertical";
import { nativeSvgPaintOrder } from "./native-paint-order";
import { captureNativeFontInstance } from "./native-font-instance";
import { captureNativeFontVariations } from "../fonts/variations";
import {
  assignNativeFontRanges,
  supportedNativeFontRanges,
  type NativeFontRange,
} from "./native-font-fallback";
import { createCanvas, release } from "./canvas";
import { nativeSvgCandidateChoices } from "./native-svg-search";

const caps: Record<string, string[]> = {
  normal: [],
  "small-caps": ["smcp"],
  "all-small-caps": ["c2sc", "smcp"],
  "petite-caps": ["pcap"],
  "all-petite-caps": ["c2pc", "pcap"],
  unicase: ["unic"],
  "titling-caps": ["titl"],
};
const metricFields = Object.keys(characterFormatSchema.shape).filter(
  (key) => key !== "color",
) as (keyof CharacterFormat)[];

/** Build original font slots without new DOM spans. Only the final complete
 * original line ink and ownership checks can return a matched result. */
export async function matchNativeFallbackSvgLine(
  plan: StyledTextPlan,
  index: number,
  files: readonly FontFileData[],
  control: NativeGlyphFontControl = {},
): Promise<NativeSvgGlyphMatch> {
  const options = { ...control },
    started = performance.now(),
    timeout = options.timeoutMs ?? 60000,
    owners = new Map<string, NativeGlyphFont>(),
    iterators: NativeSvgCandidates[] = [],
    sourcePlanes = new Map<string, Uint8ClampedArray>();
  let matching = true;
  if (!Number.isInteger(timeout) || timeout <= 0 || timeout > 0x7fffffff)
    throw new Error("Invalid native fallback matching time budget.");
  const base = () => {
      options.signal?.throwIfAborted();
      plan.check();
      options.check?.();
      options.signal?.throwIfAborted();
      if (matching && performance.now() - started >= timeout)
        throw new Error(
          "Native fallback glyph matching exceeded its time budget.",
        );
    },
    check = () => {
      base();
      for (const font of owners.values()) font.check();
    },
    budget = () =>
      Math.max(1, Math.ceil(timeout - (performance.now() - started)));
  check();
  const rejectedPaints = new NativeSvgRejectedPaints(check);
  const line = plan.scene.lines[index],
    paint = plan.paint;
  if (!line || !paint || !line.spans.length)
    return Object.freeze({
      status: "unavailable",
      reason: "Fallback requires complete original native text metadata.",
    });
  const text = line.spans.map((span) => span.text).join(""),
    horizontalItems = verticalWriting(line.writing)
      ? undefined
      : nativeSvgTextItems(
          text,
          paint.pathCharacters[index] ?? paint.characters[index],
          line.direction,
          0,
          text.length,
          paint.visual?.[index],
        );
  const unavailable = (reason: string) =>
      Object.freeze({ status: "unavailable" as const, reason }),
    groups: { first: number; last: number }[] = [];
  for (let i = 0; i < line.spans.length; i++) {
    const last = groups.at(-1);
    if (
      last &&
      metricFields.every(
        (key) => line.spans[last.first].style[key] === line.spans[i].style[key],
      )
    )
      last.last = i + 1;
    else groups.push({ first: i, last: i + 1 });
  }
  const slots: {
      font: NativeGlyphFont;
      source: NativeSvgGlyphSource;
      variants: Readonly<NativeSvgGlyphCandidate>[];
      iterator: NativeSvgCandidates;
      ended: boolean;
      cohort: number;
      signatures: Set<string>;
    }[] = [],
    cohortIds = new Map<string, number>();
  let rejection = "No owned native source covers the complete original text.";
  try {
    for (const group of groups) {
      const source = captureNativeSvgGlyphSource(
          plan,
          index,
          group.first,
          group.last,
        ),
        families = fontFamilyNames(source.style.fontFamily),
        items = horizontalItems
          ? sliceNativeTextItems(horizontalItems, source.start, source.end)
          : nativeVerticalTextItems(plan, index, source);
      if (!items)
        return unavailable(
          "The native fallback orientation requires additional source mapping.",
        );
      let pending: {
        item: (typeof items)[number];
        ranges: readonly NativeFontRange[];
      }[] = items.map((item) => ({
        item,
        ranges: [{ start: item.start, end: item.end }],
      }));
      for (const family of families) {
        if (!pending.length) break;
        check();
        const file = files.find(
          (file) =>
            file.resource.report.faces[0].cssFamily.toLowerCase() === family,
        );
        if (!file)
          return unavailable(
            "An unowned font precedes a usable source in the original fallback stack.",
          );
        const settings = source.style.fontVariationSettings ?? "normal",
          ownerKey = JSON.stringify([file.id, settings]);
        let font = owners.get(ownerKey);
        if (!font) {
          font = await plan.captureGlyphFont(file.id, settings, {
            ...options,
            timeoutMs: budget(),
            check: base,
          });
          owners.set(ownerKey, font);
          check();
        }
        if (!font.monochrome)
          return unavailable(
            "The original fallback requires intrinsic color glyph integration.",
          );
        const style = Object.freeze({
            ...source.style,
            fontFamily: font.sourceFamily,
            fontVariationSettings: font.settings,
          }),
          variation = captureNativeFontVariations([style]),
          canvas = createCanvas(1, 1),
          next: typeof pending = [];
        try {
          const context = canvas.getContext("2d")!;
          applyTextStyle(context, style);
          const css = captureNativeFontInstance(
            context,
            style.fontWeight,
            font.descriptors,
            style.fontSize,
          );
          for (const entry of pending) {
            check();
            variation.check();
            const item = entry.item,
              features = [
                { tag: "kern", value: style.fontKerning === "none" ? 0 : 1 },
                ...(caps[style.fontVariantCaps ?? "normal"] ?? []).map(
                  (tag) => ({ tag, value: 1 }),
                ),
                ...(style.letterSpacing || ("upright" in item && item.upright)
                  ? [
                      { tag: "liga", value: 0 },
                      { tag: "clig", value: 0 },
                    ]
                  : []),
              ],
              run = await font.shapeRun(
                {
                  text: source.text,
                  itemOffset: item.start,
                  itemLength: item.end - item.start,
                  direction: item.direction,
                  ...("script" in item && item.script !== "Zyyy"
                    ? { script: item.script }
                    : {}),
                  features,
                  css,
                },
                { ...options, timeoutMs: budget(), check },
              ),
              assigned = assignNativeFontRanges(
                entry.ranges,
                supportedNativeFontRanges(run),
              );
            check();
            for (const range of assigned.selected) {
              const selected = Object.freeze({
                  ...source,
                  ...range,
                  style,
                  ...(horizontalItems
                    ? {
                        items: sliceNativeTextItems(
                          horizontalItems,
                          range.start,
                          range.end,
                        ),
                      }
                    : {}),
                }),
                iterator = nativeAuthoredSvgCandidates(
                  plan,
                  font,
                  index,
                  { ...options, timeoutMs: budget(), check },
                  selected,
                ),
                key = JSON.stringify([
                  ownerKey,
                  metricFields.map((field) => style[field]),
                ]);
              let cohort = cohortIds.get(key);
              if (cohort === undefined) {
                cohort = cohortIds.size;
                cohortIds.set(key, cohort);
              }
              iterators.push(iterator);
              slots.push({
                font,
                source: selected,
                variants: [],
                iterator,
                ended: false,
                cohort,
                signatures: new Set(),
              });
            }
            if (assigned.remaining.length)
              next.push({ item, ranges: assigned.remaining });
          }
        } finally {
          release(canvas);
          variation.release();
        }
        pending = next;
        await yieldTask();
        check();
      }
      if (pending.length) return unavailable(rejection);
    }
    slots.sort((a, b) => a.source.start - b.source.start);
    const parent = await prepareNativeSvgParent(plan, index, slots, {
      ...options,
      timeoutMs: budget(),
      check,
    });
    if (parent)
      for (let i = 0; i < slots.length; i++) {
        slots[i].variants.push(parent[i]);
        slots[i].signatures.add(
          JSON.stringify({
            glyphs: parent[i].glyphs.map(({ font: _, ...glyph }) => glyph),
            inlineAllocation: parent[i].inlineAllocation,
          }),
        );
      }
    const maximums: (number | undefined)[] = Array(slots.length).fill(
      undefined,
    );
    const reference = captureNativeSvgLineRoot(plan, index);
    // Reference tiles belong only to this operation. The bounded LRU avoids
    // repeated font/image work; every candidate, sample, work cell and exact
    // pixel comparison still participates in verification.
    const sourceAlpha = async (
      x: number,
      y: number,
      cell: number,
      gutter: number,
      alpha: number,
    ) => {
      check();
      const key = JSON.stringify([x, y, cell, gutter, alpha]);
      const existing = sourcePlanes.get(key);
      if (existing) {
        sourcePlanes.delete(key);
        sourcePlanes.set(key, existing);
        check();
        return existing;
      }
      const plane = await renderSvgCellAlpha(
        reference,
        x,
        y,
        cell,
        gutter,
        alpha,
        { ...options, timeoutMs: budget(), check },
      );
      check();
      sourcePlanes.set(key, plane);
      if (sourcePlanes.size > 16)
        sourcePlanes.delete(sourcePlanes.keys().next().value!);
      return plane;
    };
    let last: NativeSvgGlyphMatch | undefined;
    for await (const values of nativeSvgCandidateChoices(
      slots.map((slot) => slot.cohort),
      maximums,
      check,
    )) {
      check();
      const selected: Readonly<NativeSvgGlyphCandidate>[] = [];
      let valid = true;
      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i],
          wanted = values[i];
        while (slot.variants.length <= wanted && !slot.ended) {
          const next = await slot.iterator.next();
          check();
          if (next.done) {
            slot.ended = true;
            maximums[i] = slot.variants.length - 1;
            if (next.value) rejection = next.value.reason;
          } else {
            const signature = JSON.stringify({
              glyphs: next.value.glyphs.map(({ font: _, ...glyph }) => glyph),
              inlineAllocation: next.value.inlineAllocation,
            });
            if (!slot.signatures.has(signature)) {
              slot.signatures.add(signature);
              slot.variants.push(next.value);
            }
          }
        }
        const candidate = slot.variants[wanted];
        if (!candidate) {
          valid = false;
          break;
        }
        selected.push(candidate);
      }
      if (!valid) continue;
      const original = selected.flatMap((value) => value.glyphs),
        resolved = await resolveNativeSvgInlineFrames(line, selected, check),
        spanResolved = await resolveNativeSvgSpanFrames(line, selected, check);
      const prepareOrders = (
        glyphs: readonly Readonly<import("./float-glyph").FloatGlyph>[],
        allocation: typeof resolved | typeof spanResolved,
        sharedOrigin = false,
      ) => {
        let at = 0;
        const parts = selected.map((value) => {
          const part = glyphs.slice(at, at + value.glyphs.length);
          at += value.glyphs.length;
          return part;
        });
        return [
          {
            name: "native" as const,
            sharedOrigin,
            glyphs: paint.visual?.[index]
              ? nativeSvgPaintOrder(glyphs, paint.visual[index]!)
              : Object.freeze(glyphs),
            allocation,
          },
          {
            name: "source-items" as const,
            sharedOrigin,
            glyphs: Object.freeze(glyphs),
            allocation,
          },
          ...(line.direction === "rtl"
            ? [
                {
                  name: "reverse-source-items" as const,
                  sharedOrigin,
                  glyphs: Object.freeze(parts.reverse().flat()),
                  allocation,
                },
              ]
            : []),
        ];
      };
      const visualResolved = spanResolved
        ? await resolveNativeSvgVisualSpanFrames(
            line,
            spanResolved,
            selected,
            paint.visual?.[index],
            check,
          )
        : undefined;
      const parentResolved = await resolveNativeSvgVerticalParent(
        line,
        selected,
        paint.characters[index],
        check,
      );
      const attached = spanResolved
        ? await resolveNativeSvgSignedAttachments(
            line,
            selected,
            spanResolved,
            check,
          )
        : undefined;
      const visualAttached =
        visualResolved &&
        visualResolved.glyphs.some(
          (glyph, i) => glyph !== spanResolved!.glyphs[i],
        )
          ? await resolveNativeSvgSignedAttachments(
              line,
              selected,
              visualResolved,
              check,
            )
          : undefined;
      const sharedOrigin = spanResolved
        ? await shareNativeSvgSourceOrigin(spanResolved.glyphs, check)
        : undefined;
      const existingOrders = spanResolved
        ? [
            ...(visualResolved
              ? prepareOrders(visualResolved.glyphs, visualResolved)
              : []),
            ...prepareOrders(spanResolved.glyphs, spanResolved),
            ...(sharedOrigin
              ? prepareOrders(sharedOrigin, spanResolved, true)
              : []),
            ...(resolved ? prepareOrders(resolved.glyphs, resolved) : []),
            ...prepareOrders(original, undefined),
          ]
        : resolved
          ? [
              ...prepareOrders(resolved.glyphs, resolved),
              ...(resolved.glyphs.some((g, i) => g !== original[i])
                ? prepareOrders(original, undefined)
                : []),
            ]
          : prepareOrders(original, undefined);
      const orders = [
        ...(parentResolved ? prepareOrders(parentResolved, undefined) : []),
        ...(visualAttached ? prepareOrders(visualAttached, visualResolved) : []),
        ...(attached ? prepareOrders(attached, spanResolved) : []),
        ...existingOrders,
      ];
      if (!verticalWriting(line.writing)) {
        const horizontalShared = await shareNativeSvgSourceOrigin(
          original,
          check,
          paint.visual?.[index]
            ? nativeSvgPaintOrder(original, paint.visual[index]!)[0]
            : undefined,
        );
        if (horizontalShared)
          orders.push(...prepareOrders(horizontalShared, undefined, true));
      }
      for (let i = 0; i < orders.length; i++) {
        const order = orders[i],
          ordered = order.glyphs;
        if (
          orders
            .slice(0, i)
            .some((prior) =>
              prior.glyphs.every((glyph, j) => glyph === ordered[j]),
            )
        )
          continue;
        const paintKey = await rejectedPaints.key(ordered);
        if (rejectedPaints.has(paintKey)) continue;
        const runs = Object.freeze(selected.flatMap((value) => value.runs)),
          comparison = await compareNativeSvgGlyphPaint(
            plan,
            index,
            reference,
            ordered,
            { ...options, check },
            budget,
            sourceAlpha,
          ),
          ownership = comparison.error
            ? undefined
            : await compareNativeSvgPaintOwnership(
                plan,
                index,
                ordered,
                comparison.bounds,
                { ...options, check },
                budget,
              ),
          evidence: Readonly<NativeSvgGlyphEvidence> = Object.freeze({
            projection: "fallback",
            ...(order.sharedOrigin ? { nativeSharedOrigin: true } : {}),
            ...(order.allocation
              ? {
                  inlineFrames: order.allocation.frames,
                  inlineAdvance: order.allocation.advance,
                }
              : {}),
            paintOrder: order.name,
            fallbackItems: Object.freeze(
              selected.map((value, i) =>
                Object.freeze({
                  start: slots[i].source.start,
                  end: slots[i].source.end,
                  family: slots[i].font.sourceFamily,
                  settings: slots[i].font.settings,
                  projection: value.projection,
                  nativeMetrics: value.nativeMetrics,
                  ...(value.nativePositionRounding
                    ? { nativePositionRounding: true }
                    : {}),
                }),
              ),
            ),
            hiddenGlyphs: selected.reduce(
              (n, value) => n + value.hiddenGlyphs,
              0,
            ),
            svgAdvance: plan.metrics[index].advance,
            svgPixelsCompared: comparison.pixels,
            svgMaxAlphaError: comparison.error,
            sourceGlyphs: runs.reduce((n, run) => n + run.glyphs.length, 0),
            sourceClusters: runs.reduce(
              (n, run) => n + new Set(run.glyphs.map((g) => g.cluster)).size,
              0,
            ),
            opacitySamples: Object.freeze([1, 0.5]),
            bounds: comparison.bounds,
            paintOwnership: ownership,
          });
        if (comparison.error || ownership?.error) {
          rejectedPaints.remember(paintKey);
          if (
            !last ||
            comparison.error < (last.evidence?.svgMaxAlphaError ?? Infinity)
          )
            last = Object.freeze({
              status: "mismatch",
              reason:
                "The complete original fallback ink or color ownership differs from source-font paint.",
              evidence,
            });
          continue;
        }
        check();
        return Object.freeze({
          status: "matched",
          run: runs[0],
          runs,
          glyphs: ordered,
          evidence,
        });
      }
    }
    return last ?? unavailable(rejection);
  } finally {
    try {
      for (const iterator of iterators) await iterator.return(undefined);
    } finally {
      sourcePlanes.clear();
      rejectedPaints.clear();
      matching = false;
    }
  }
}
