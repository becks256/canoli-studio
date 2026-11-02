import { unicodeTextProperties } from "../fonts/unicode-text-data";
import type {
  StyledTextCharacterGeometry,
  NativeTextVisualPosition,
} from "./styled-text";

export interface NativeTextItem {
  readonly start: number;
  readonly end: number;
  readonly script: string;
  readonly direction: "ltr" | "rtl";
}
const weak = (script: string) =>
  script === "Zyyy" || script === "Zinh" || script === "Zzzz";
const normalize = (script: string) =>
  script === "Kana" || script === "Hrkt" ? "Hira" : script;
interface Token {
  start: number;
  end: number;
  choices: string[];
  primary?: string;
  direction?: "ltr" | "rtl";
  bracket?: Readonly<{ pair: number; open: boolean }>;
  point: number;
}

/** Reuse whole-source script/bracket/direction resolution. Binary search avoids
 * rescanning earlier text for each original style or fallback source range. */
export function sliceNativeTextItems(
  items: readonly Readonly<NativeTextItem>[],
  start: number,
  end: number,
): readonly Readonly<NativeTextItem>[] {
  const result: Readonly<NativeTextItem>[] = [];
  let lo = 0,
    hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (items[mid].end <= start) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo; i < items.length && items[i].start < end; i++) {
    const item = items[i],
      a = Math.max(start, item.start),
      b = Math.min(end, item.end);
    if (a < b)
      result.push(
        a === item.start && b === item.end
          ? item
          : Object.freeze({ ...item, start: a, end: b }),
      );
  }
  return Object.freeze(result);
}

/** Original graphemes and UCD script sets select shaping ranges. Native carets
 * supply resolved direction; neither metadata surface supplies glyph IDs. */
export function nativeSvgTextItems(
  text: string,
  characters: readonly StyledTextCharacterGeometry[],
  fallback: "ltr" | "rtl",
  start = 0,
  end = text.length,
  visual?: readonly NativeTextVisualPosition[] | null,
): readonly Readonly<NativeTextItem>[] {
  if (
    characters.length !== text.length ||
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    end > text.length
  )
    throw new Error("Native text item source geometry differs from its text.");
  const boundary = (index: number) =>
    index === 0 ||
    index === text.length ||
    !(
      text.charCodeAt(index) >= 0xdc00 &&
      text.charCodeAt(index) <= 0xdfff &&
      text.charCodeAt(index - 1) >= 0xd800 &&
      text.charCodeAt(index - 1) <= 0xdbff
    );
  if (!boundary(start) || !boundary(end))
    throw new Error(
      "Native text item boundaries must retain complete Unicode scalars.",
    );
  if (
    visual &&
    (visual.length !== text.length ||
      visual.some(
        (value) =>
          !Number.isFinite(value.order) ||
          !["ltr", "rtl", null].includes(value.direction),
      ))
  )
    throw new Error("Native text visual ordering is invalid.");
  const tokens: Token[] = [];
  for (const part of new Intl.Segmenter("und", {
    granularity: "grapheme",
  }).segment(text)) {
    let offset = part.index,
      choices: string[] = [],
      primary: string | undefined,
      direction: "ltr" | "rtl" | undefined,
      strong: "ltr" | "rtl" | undefined;
    for (const character of part.segment) {
      const point = character.codePointAt(0)!;
      if (point >= 0xd800 && point <= 0xdfff)
        throw new Error(
          "Native text item source contains an unpaired surrogate.",
        );
      const properties = unicodeTextProperties(point),
        c = characters[offset];
      if (
        ![c.start.x, c.start.y, c.end.x, c.end.y, c.rotation].every(
          Number.isFinite,
        )
      )
        throw new Error("Native text item geometry is invalid.");
      const angle = (c.rotation * Math.PI) / 180,
        advance =
          (c.end.x - c.start.x) * Math.cos(angle) +
          (c.end.y - c.start.y) * Math.sin(angle);
      if (direction === undefined)
        direction =
          visual?.[offset].direction ??
          (advance ? (advance < 0 ? "rtl" : "ltr") : undefined);
      if (strong === undefined) {
        if (properties.bidi === "R" || properties.bidi === "AL") strong = "rtl";
        else if (
          properties.bidi === "L" ||
          properties.bidi === "EN" ||
          properties.bidi === "AN"
        )
          strong = "ltr";
      }
      const values = [
        ...new Set(
          properties.extensions.filter((value) => !weak(value)).map(normalize),
        ),
      ];
      if (!weak(properties.script) && primary === undefined)
        primary = normalize(properties.script);
      if (values.length) {
        if (!choices.length) choices = values;
        else {
          const shared = choices.filter((value) => values.includes(value));
          if (shared.length) choices = shared;
        }
      }
      offset += character.length;
    }
    if (primary && !choices.includes(primary)) choices = [primary];
    const point = part.segment.codePointAt(0)!,
      bracket = unicodeTextProperties(point).bracket;
    tokens.push({
      start: part.index,
      end: part.index + part.segment.length,
      choices,
      primary,
      direction: direction ?? strong,
      bracket,
      point,
    });
  }
  // Zero-width neutral clusters retain their native neighbors' resolved range.
  let next: "ltr" | "rtl" | undefined;
  const following = tokens.map(() => next);
  for (let i = tokens.length - 1; i >= 0; i--) {
    following[i] = next;
    if (tokens[i].direction) next = tokens[i].direction;
  }
  for (let i = 0; i < tokens.length; i++)
    if (!tokens[i].direction)
      tokens[i].direction =
        tokens[i - 1]?.direction ?? following[i] ?? fallback;
  interface Bracket {
    pair: number;
    script?: string;
    start: number;
    previous?: Bracket;
  }
  const scriptRuns: { start: number; end: number; script: string }[] = [],
    stack: Bracket[] = [],
    open = new Map<number, Bracket>(),
    pending = new Set<Bracket>();
  let first = 0,
    choices: string[] = [],
    preferred: string | undefined;
  const finish = (limit: number) => {
    if (first === limit) return;
    const script =
      preferred && choices.includes(preferred)
        ? preferred
        : (choices[0] ?? "Zyyy");
    scriptRuns.push({ start: first, end: limit, script });
    for (const entry of pending)
      if (entry.start < limit) {
        entry.script = script;
        pending.delete(entry);
      }
    first = limit;
    choices = [];
    preferred = undefined;
  };
  for (const token of tokens) {
    let values = token.choices;
    if (token.bracket && !token.bracket.open) {
      const match = open.get(token.point);
      if (match) {
        if (match.script) values = [match.script];
        while (stack.length) {
          const entry = stack.pop()!;
          pending.delete(entry);
          if (entry.previous) open.set(entry.pair, entry.previous);
          else open.delete(entry.pair);
          if (entry === match) break;
        }
      }
    }
    if (values.length) {
      const shared = choices.filter((value) => values.includes(value));
      if (choices.length && !shared.length) finish(token.start);
      choices = choices.length ? shared : values;
      if (token.primary && choices.includes(token.primary))
        preferred = token.primary;
    }
    if (token.bracket?.open) {
      const entry = {
        pair: token.bracket.pair,
        start: token.start,
        script: preferred ?? (choices.length === 1 ? choices[0] : undefined),
        previous: open.get(token.bracket.pair),
      };
      stack.push(entry);
      open.set(entry.pair, entry);
      if (!entry.script) pending.add(entry);
    }
  }
  finish(text.length);
  const result: NativeTextItem[] = [];
  let cursor = 0;
  for (const token of tokens) {
    while (cursor < scriptRuns.length && scriptRuns[cursor].end <= token.start)
      cursor++;
    const run = scriptRuns[cursor];
    if (!run) break;
    const a = Math.max(start, run.start, token.start),
      b = Math.min(end, run.end, token.end);
    if (a >= b) continue;
    const last = result.at(-1),
      direction = token.direction!;
    if (
      last &&
      last.end === a &&
      last.script === run.script &&
      last.direction === direction
    )
      result[result.length - 1] = { ...last, end: b };
    else result.push({ start: a, end: b, script: run.script, direction });
  }
  return Object.freeze(result.map((item) => Object.freeze(item)));
}
