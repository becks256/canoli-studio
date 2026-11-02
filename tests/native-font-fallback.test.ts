import { beforeAll, test, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { shapeFontRun } from "../src/fonts/shaping";
import {
  normalizeFontRun,
  validateFontRun,
  type FontRunInput,
} from "../src/fonts/shaping-types";
import {
  supportedNativeFontRanges,
  assignNativeFontRanges,
  type NativeFontRange,
} from "../src/engine/native-font-fallback";
let primary: Uint8Array, full: Uint8Array;
beforeAll(async () => {
  [primary, full] = await Promise.all(
    ["native-fallback/Latin-no-mark.ttf", "shaping-font/Shaping.ttf"].map(
      async (file) => new Uint8Array(await readFile("tests/fixtures/" + file)),
    ),
  );
});
function shape(bytes: Uint8Array, input: FontRunInput) {
  const request = normalizeFontRun(input),
    result = shapeFontRun(bytes, request);
  return validateFontRun(result, request, "normal", result);
}

test("a missing combining mark moves the entire original cluster to the next font, retaining ligatures and primary priority", () => {
  const text = "AV fi a\u0301",
    before = primary.slice(),
    first = shape(primary, { text }),
    next = shape(full, { text }),
    supported = supportedNativeFontRanges(first),
    assigned = assignNativeFontRanges(
      [{ start: 0, end: text.length }],
      supported,
    );
  expect(
    first.glyphs.filter((g) => g.cluster === 6).map((g) => g.glyphId),
  ).toEqual([7, 0]);
  expect(first.glyphs.some((g) => g.glyphId === 6 && g.cluster === 3)).toBe(
    true,
  );
  expect(supported).toEqual([{ start: 0, end: 6 }]);
  expect(assigned).toEqual({
    selected: [{ start: 0, end: 6 }],
    remaining: [{ start: 6, end: 8 }],
  });
  expect(
    assignNativeFontRanges(assigned.remaining, supportedNativeFontRanges(next)),
  ).toEqual({ selected: [{ start: 6, end: 8 }], remaining: [] });
  expect(
    next.glyphs.filter((g) => g.cluster === 6).map((g) => g.glyphId),
  ).toEqual([7, 8]);
  expect(primary).toEqual(before);
  expect(
    Object.isFrozen(supported) &&
      supported.every(Object.isFrozen) &&
      Object.isFrozen(assigned.remaining[0]),
  ).toBe(true);
});

test("RTL/BTT output is assigned by original UTF16 clusters while Arabic joining and contextual substitutions remain intact", () => {
  const text = "ببلا AV";
  for (const direction of ["rtl", "btt"] as const) {
    const a = shape(primary, { text, direction }),
      b = shape(full, { text, direction }),
      first = assignNativeFontRanges(
        [{ start: 0, end: text.length }],
        supportedNativeFontRanges(a),
      );
    expect(first).toEqual({
      selected: [{ start: 4, end: 7 }],
      remaining: [{ start: 0, end: 4 }],
    });
    expect(
      assignNativeFontRanges(first.remaining, supportedNativeFontRanges(b)),
    ).toEqual({ selected: [{ start: 0, end: 4 }], remaining: [] });
    expect(b.glyphs.map((g) => g.cluster)).toEqual(
      [...b.glyphs.map((g) => g.cluster)].sort((a, b) => b - a),
    );
  }
  const joined = shape(full, { text, direction: "rtl" });
  expect(
    joined.glyphs.filter((g) => g.cluster < 4).map((g) => g.glyphId),
  ).toEqual([11, 14, 13]);
  const context = shape(full, {
    text: "ببب AV",
    direction: "rtl",
    itemOffset: 1,
    itemLength: 1,
  });
  expect(context.glyphs.map((g) => [g.cluster, g.glyphId])).toEqual([[1, 14]]);
});

test("supplementary missing characters and empty source do not gain false source coverage", () => {
  const text = "A😀V",
    first = assignNativeFontRanges(
      [{ start: 0, end: text.length }],
      supportedNativeFontRanges(shape(primary, { text })),
    );
  expect(first).toEqual({
    selected: [
      { start: 0, end: 1 },
      { start: 3, end: 4 },
    ],
    remaining: [{ start: 1, end: 3 }],
  });
  expect(supportedNativeFontRanges(shape(primary, { text: "" }))).toEqual([]);
});

test("successive font coverage partitions the pending source exactly and never replaces an earlier font owner", () => {
  const ranges = (bits: boolean[]): NativeFontRange[] => {
    const out: NativeFontRange[] = [];
    for (let i = 0; i < bits.length;) {
      if (!bits[i]) {
        i++;
        continue;
      }
      const start = i;
      while (bits[i]) i++;
      out.push({ start, end: i });
    }
    return out;
  };
  const expand = (rows: readonly NativeFontRange[]) =>
    rows.flatMap((row) =>
      Array.from({ length: row.end - row.start }, (_, i) => row.start + i),
    );
  let seed = 17;
  for (let trial = 0; trial < 120; trial++) {
    const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return (seed & 8) !== 0;
      },
      pending = Array.from({ length: 80 }, random),
      font = Array.from({ length: 80 }, random),
      next = Array.from({ length: 80 }, random),
      first = assignNativeFontRanges(ranges(pending), ranges(font)),
      second = assignNativeFontRanges(first.remaining, ranges(next));
    expect(expand(first.selected)).toEqual(
      pending.flatMap((value, i) => (value && font[i] ? [i] : [])),
    );
    expect(expand(second.selected)).toEqual(
      pending.flatMap((value, i) => (value && !font[i] && next[i] ? [i] : [])),
    );
    expect(expand(second.remaining)).toEqual(
      pending.flatMap((value, i) => (value && !font[i] && !next[i] ? [i] : [])),
    );
    expect(
      [
        ...expand(first.selected),
        ...expand(second.selected),
        ...expand(second.remaining),
      ].sort((a, b) => a - b),
    ).toEqual(expand(ranges(pending)));
  }
});
