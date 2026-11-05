import { splitNativeAuthoredRanges } from "./native-svg-authored-ranges";
import { yieldTask } from "../core/task-yield";
import type { StyledTextPlan } from "./styled-text";
import type {
  NativeGlyphFont,
  NativeGlyphFontControl,
} from "./native-glyph-font";
import type { NativeSvgGlyphSource } from "./native-svg-source";
import type {
  NativeSvgUnavailable,
  NativeSvgCandidates,
} from "./native-svg-candidates";
import { nativeSvgGlyphCandidates } from "./native-svg-glyph";

/** Original DOM spans can select distinct native shaping items even when their
 * metric styles agree. Retain the entire text and original font assignment;
 * this only offers additional item selections, without adding any DOM nodes. */
export async function* nativeAuthoredSvgCandidates(
  plan: StyledTextPlan,
  font: NativeGlyphFont,
  index: number,
  control: NativeGlyphFontControl,
  source: NativeSvgGlyphSource,
): NativeSvgCandidates {
  const check = () => {
    control.signal?.throwIfAborted();
    plan.check();
    font.check();
    control.check?.();
    control.signal?.throwIfAborted();
  };
  const breaks: number[] = [];
  let position = 0,
    deadline = performance.now() + 2;
  for (const span of plan.scene.lines[index].spans) {
    position += span.text.length;
    if (position > source.start && position < source.end) {
      // A private selection must never split a Unicode scalar.
      const current = source.text.charCodeAt(position);
      const previous = source.text.charCodeAt(position - 1);
      if (
        current >= 0xdc00 &&
        current <= 0xdfff &&
        previous >= 0xd800 &&
        previous <= 0xdbff
      ) {
        yield* nativeSvgGlyphCandidates(plan, font, index, control, source);
        return;
      }
      if (breaks.at(-1) !== position) breaks.push(position);
    }
    check();
    if (performance.now() >= deadline) {
      await yieldTask();
      check();
      deadline = performance.now() + 2;
    }
  }
  if (!breaks.length) {
    yield* nativeSvgGlyphCandidates(plan, font, index, control, source);
    return;
  }
  const alternate = Object.freeze({
    ...source,
    authoredBreaks: Object.freeze(breaks),
    ...(source.items
      ? {
          items: splitNativeAuthoredRanges(source.items, breaks),
        }
      : {}),
  });
  const iterators = [
    nativeSvgGlyphCandidates(plan, font, index, control, source),
    nativeSvgGlyphCandidates(plan, font, index, control, alternate),
  ];
  const ended = [false, false];
  let unavailable: NativeSvgUnavailable | undefined;
  try {
    while (ended.some((value) => !value)) {
      for (let i = 0; i < iterators.length; i++) {
        if (ended[i]) continue;
        check();
        const result = await iterators[i].next();
        check();
        if (result.done) {
          ended[i] = true;
          if (result.value) unavailable = result.value;
        } else yield result.value;
      }
    }
    return unavailable;
  } finally {
    for (const iterator of iterators) await iterator.return(undefined);
  }
}
