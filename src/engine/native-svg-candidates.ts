import {
  resolveNativeSvgSpanFrames,
  resolveNativeSvgSignedAttachments,
} from "./native-svg-span-frames";
import { resolveNativeSvgInlineFrames } from "./native-svg-inline-frames";
import type { FloatGlyph } from "./float-glyph";
import type { OwnedFontRun } from "../fonts/shaping-types";
import type {
  NativeGlyphFont,
  NativeGlyphFontControl,
} from "./native-glyph-font";
import type { StyledTextPlan } from "./styled-text";
import type {
  NativeSvgGlyphMatch,
  NativeSvgGlyphEvidence,
} from "./native-svg-glyph";
import {
  captureNativeSvgLineRoot,
  compareNativeSvgGlyphPaint,
} from "./native-svg-verify";

/** Internal preparations have no matched status or publication authority. */
export interface NativeSvgGlyphCandidate {
  readonly inlineAllocation?: Readonly<
    import("./native-svg-inline-frames").NativeSvgInlineCandidateAllocation
  >;
  readonly projection: NativeSvgGlyphEvidence["projection"];
  readonly nativeMetrics?: boolean;
  readonly nativePositionRounding?: boolean;
  readonly glyphs: readonly Readonly<FloatGlyph>[];
  readonly runs: readonly OwnedFontRun[];
  readonly hiddenGlyphs: number;
}
export type NativeSvgUnavailable = Readonly<{
  status: "unavailable";
  reason: string;
}>;
export type NativeSvgCandidates = AsyncGenerator<
  Readonly<NativeSvgGlyphCandidate>,
  NativeSvgUnavailable | undefined,
  void
>;

/** The ordinary single-source entry point keeps its original exact ink gate.
 * Closing an iterator also retires suspended metric/font probes on success. */
export async function verifyNativeSvgCandidates(
  plan: StyledTextPlan,
  font: NativeGlyphFont,
  index: number,
  candidates: NativeSvgCandidates,
  control: NativeGlyphFontControl = {},
  source?: Element,
): Promise<NativeSvgGlyphMatch> {
  const started = performance.now(),
    timeout = control.timeoutMs ?? 60000,
    check = () => {
      control.signal?.throwIfAborted();
      plan.check();
      font.check();
      control.check?.();
      control.signal?.throwIfAborted();
      if (performance.now() - started >= timeout)
        throw new Error("Native SVG glyph matching exceeded its time budget.");
    },
    budget = () =>
      Math.max(1, Math.ceil(timeout - (performance.now() - started)));
  let last: NativeSvgGlyphMatch | undefined;
  try {
    for (;;) {
      check();
      const next = await candidates.next();
      check();
      if (next.done)
        return (
          last ??
          next.value ??
          Object.freeze({
            status: "unavailable",
            reason: "The native source has no paint candidates.",
          })
        );
      const value = next.value;
      source ??= captureNativeSvgLineRoot(plan, index);
      const resolved = await resolveNativeSvgInlineFrames(
          plan.scene.lines[index],
          [value],
          check,
        ),
        spanResolved = await resolveNativeSvgSpanFrames(
          plan.scene.lines[index],
          [value],
          check,
        );
      const attached = spanResolved
        ? await resolveNativeSvgSignedAttachments(
            plan.scene.lines[index],
            [value],
            spanResolved,
            check,
          )
        : undefined;
      const variants = spanResolved
        ? [
            ...(attached ? [{ glyphs: attached, allocation: spanResolved }] : []),
            { glyphs: spanResolved.glyphs, allocation: spanResolved },
            { glyphs: value.glyphs, allocation: undefined },
          ]
        : resolved
          ? [
              { glyphs: resolved.glyphs, allocation: resolved },
              ...(resolved.glyphs.some((g, i) => g !== value.glyphs[i])
                ? [{ glyphs: value.glyphs, allocation: undefined }]
                : []),
            ]
          : [{ glyphs: value.glyphs, allocation: undefined }];
      for (const { glyphs, allocation } of variants) {
        const paint = await compareNativeSvgGlyphPaint(
            plan,
            index,
            source,
            glyphs,
            { ...control, check },
            budget,
          ),
          evidence = Object.freeze({
            projection: value.projection,
            ...(allocation
              ? {
                  inlineFrames: allocation.frames,
                  inlineAdvance: allocation.advance,
                }
              : {}),
            ...(value.nativeMetrics === undefined
              ? {}
              : { nativeMetrics: value.nativeMetrics }),
            ...(value.nativePositionRounding
              ? { nativePositionRounding: true }
              : {}),
            hiddenGlyphs: value.hiddenGlyphs,
            svgAdvance: plan.metrics[index].advance,
            svgPixelsCompared: paint.pixels,
            svgMaxAlphaError: paint.error,
            sourceGlyphs: value.runs.reduce((n, r) => n + r.glyphs.length, 0),
            sourceClusters: value.runs.reduce(
              (n, r) => n + new Set(r.glyphs.map((g) => g.cluster)).size,
              0,
            ),
            opacitySamples: Object.freeze([1, 0.5]),
            bounds: paint.bounds,
          });
        if (paint.error) {
          last = Object.freeze({
            status: "mismatch",
            reason: value.projection.startsWith("vertical")
              ? "The complete native vertical SVG ink differs from source-font glyph paint."
              : "The complete captured SVG ink differs from source-font glyph paint.",
            evidence,
          });
          continue;
        }
        check();
        return Object.freeze({
          status: "matched",
          run: value.runs[0],
          runs: value.runs,
          glyphs,
          evidence,
        });
      }
    }
  } finally {
    await candidates.return(undefined);
  }
}
