import type { LinearTextColor } from "./float-text-color";
/** Preserve source color distinctions in the verification paints using G/B,
 * while R supplies a canonical scalar
 * ownership weight. These labels never become authored or working colors. */
export function nativeVerificationPalette(colors: readonly LinearTextColor[]) {
  const keys = [...new Set(colors.map((color) => JSON.stringify(color)))],
    ids = new Map(keys.map((key, i) => [key, i + 1]));
  if (keys.length > 65535)
    throw new Error(
      "Native paint labels exceed their verification representation.",
    );
  return Object.freeze({
    fill(color: readonly number[], selected?: string) {
      const key = JSON.stringify(color),
        id = ids.get(key);
      if (id === undefined)
        throw new Error("Glyph color differs from its captured native paint.");
      return `rgb(${selected === undefined || key === selected ? 255 : 0} ${id & 255} ${id >>> 8})`;
    },
  });
}
