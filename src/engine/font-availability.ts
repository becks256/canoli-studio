export type FontAvailability = "available" | "unavailable" | "unknown";
const genericFamilies = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "system-ui",
  "cursive",
  "fantasy",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "math",
  "fangsong",
]);

/** No network or font enumeration: probe only the family's local source. */
export async function fontAvailability(
  family: string,
): Promise<FontAvailability> {
  const name = family.trim().replace(/^(['"])(.*)\1$/, "$2");
  if (genericFamilies.has(name.toLowerCase())) return "available";
  if (
    !name ||
    name.includes(",") ||
    typeof document === "undefined" ||
    typeof FontFace === "undefined"
  )
    return "unknown";
  for (const face of document.fonts) {
    const candidate = face.family.replace(/^(['"])(.*)\1$/, "$2");
    if (
      candidate.toLowerCase() === name.toLowerCase() &&
      face.status === "loaded"
    )
      return "available";
  }
  const escaped = name
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[\n\r\f]/g, " ");
  try {
    await new FontFace(
      "luma-local-availability-probe",
      `local("${escaped}")`,
    ).load();
    return "available";
  } catch {
    return "unavailable";
  }
}
