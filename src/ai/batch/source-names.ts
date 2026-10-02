/** Shared item naming for preflight and persisted runs. */
export function batchItemNames(sources: readonly { name: string }[]): string[] {
  const counts = new Map<string, number>();
  return sources.map((source) => {
    const base = source.name.replace(/\.[a-zA-Z0-9]+$/, "");
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    return count > 0 ? `${base}_${count + 1}` : base;
  });
}
