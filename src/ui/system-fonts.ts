/** Browser-session metadata only: no font bytes, uploads or project mutations. */
let families: readonly string[] = [];
const listeners = new Set<() => void>();
export const getSystemFonts = () => families;
export function subscribeSystemFonts(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Call directly from a user gesture: the browser owns permission prompting. */
export async function systemFonts(): Promise<readonly string[]> {
  const host = window as unknown as {
    queryLocalFonts(): Promise<Array<{ family: string }>>;
  };
  const fonts = await host.queryLocalFonts();
  families = [...new Set(fonts.map(font => font.family).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  for (const listener of listeners) listener();
  return families;
}
