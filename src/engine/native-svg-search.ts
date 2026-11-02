import { yieldTask } from "../core/task-yield";

/** Finite vectors ordered by total rank; no beam or source-count cutoff. */
function* combinations(count: number, rank: number): Generator<number[]> {
  if (!rank) {
    yield Array(count).fill(0);
    return;
  }
  const positions = Array(rank).fill(0);
  for (;;) {
    const values = Array(count).fill(0);
    for (const position of positions) values[position]++;
    yield values;
    let i = rank - 1;
    while (i >= 0 && positions[i] === count - 1) i--;
    if (i < 0) return;
    const next = positions[i] + 1;
    for (let j = i; j < rank; j++) positions[j] = next;
  }
}

/** Prefer coherent choices for matching source instances, then explore every
 * independent item choice. Original native items may round differently even
 * when they share a source font. The caller discovers each finite maximum
 * lazily; this generator observes it on resumption. Working state is O(n+rank). */
export async function* nativeSvgCandidateChoices(
  cohorts: readonly number[],
  maximums: readonly (number | undefined)[],
  check: () => void,
): AsyncGenerator<readonly number[]> {
  if (!cohorts.length) return;
  const count = cohorts.reduce((n, value) => Math.max(n, value + 1), 0);
  let deadline = performance.now() + 2;
  const bounds = () =>
      maximums.every((value) => value === undefined || value >= 0),
    valid = (values: readonly number[]) =>
      values.every(
        (value, i) => maximums[i] === undefined || value <= maximums[i]!,
      );
  const checkpoint = async () => {
    check();
    if (performance.now() >= deadline) {
      await yieldTask();
      check();
      deadline = performance.now() + 2;
    }
  };
  for (
    let rank = 0;
    bounds() &&
    (maximums.some((value) => value === undefined) ||
      rank <= maximums.reduce<number>((n, value) => n + (value ?? 0), 0));
    rank++
  ) {
    for (const values of combinations(count, rank)) {
      await checkpoint();
      if (!bounds()) return;
      const vector = cohorts.map((cohort) => values[cohort]);
      if (valid(vector)) yield vector;
    }
    if (count === cohorts.length) continue;
    for (const values of combinations(cohorts.length, rank)) {
      await checkpoint();
      if (!bounds()) return;
      if (!valid(values)) continue;
      const seen = new Map<number, number>();
      let coherent = true;
      for (let i = 0; i < values.length; i++) {
        const prior = seen.get(cohorts[i]);
        if (prior !== undefined && prior !== values[i]) {
          coherent = false;
          break;
        }
        seen.set(cohorts[i], values[i]);
      }
      if (!coherent) yield values;
    }
  }
}
