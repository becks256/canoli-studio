import { test, expect } from "vitest";
import { nativeSvgCandidateChoices } from "../src/engine/native-svg-search";

test("same-source items can choose different projections and every finite combination is visited exactly once", async () => {
  for (const cohorts of [
    [0, 0, 1],
    [0, 1, 0],
    [0, 1, 2],
    [0, 0, 0],
  ]) {
    const maximums: (number | undefined)[] = [undefined, undefined, undefined],
      actual = [1, 2, 1],
      seen = new Set<string>();
    for await (const values of nativeSvgCandidateChoices(
      cohorts,
      maximums,
      () => {},
    )) {
      let valid = true;
      for (let i = 0; i < values.length; i++)
        if (values[i] > actual[i]) {
          maximums[i] = actual[i];
          valid = false;
          break;
        }
      if (valid) {
        const key = values.join(",");
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
    expect(seen.size).toBe(12);
    expect(seen.has("0,2,1")).toBe(true);
    expect(seen.has("1,0,1")).toBe(true);
  }
});

test("a source item with no candidates terminates the whole search and cancellation stops enumeration", async () => {
  const maximums: (number | undefined)[] = [undefined, undefined];
  let visited = 0;
  for await (const _ of nativeSvgCandidateChoices([0, 0], maximums, () => {})) {
    visited++;
    maximums[0] = -1;
  }
  expect(visited).toBe(1);
  let checks = 0;
  await expect(async () => {
    for await (const _ of nativeSvgCandidateChoices(
      [0, 0],
      [undefined, undefined],
      () => {
        if (++checks === 5) throw new Error("Retired search");
      },
    )) {
      /* no finite bound yet */
    }
  }).rejects.toThrow("Retired search");
});
