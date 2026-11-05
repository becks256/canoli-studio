/** Split only private source selections; original DOM/text stays intact. Both
 * inputs are in source order. A single cursor avoids a span/item cross product. */
export function splitNativeAuthoredRanges<
  T extends { start: number; end: number },
>(items: readonly T[], breaks: readonly number[]): readonly Readonly<T>[] {
  let previous = -1;
  for (const value of breaks) {
    if (!Number.isSafeInteger(value) || value <= previous)
      throw new Error("Invalid authored native item boundary.");
    previous = value;
  }
  const result: Readonly<T>[] = [];
  let cursor = 0;
  for (const item of items) {
    while (cursor < breaks.length && breaks[cursor] <= item.start) cursor++;
    let start = item.start;
    while (cursor < breaks.length && breaks[cursor] < item.end) {
      const end = breaks[cursor++];
      result.push(Object.freeze({ ...item, start, end }));
      start = end;
    }
    result.push(
      start === item.start ? item : Object.freeze({ ...item, start }),
    );
  }
  return Object.freeze(result);
}
