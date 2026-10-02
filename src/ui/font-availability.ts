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

/** Visible text in groups and reachable embedded masters; unused masters do not affect export. */
export function exportFontFamilies(
  document: import("../core/model").DocumentData,
): string[] {
  const families = new Set<string>();
  const seen = new Set<
    import("../core/smart/types").SmartComponentDefinition
  >();
  const walk = (
    layers: import("../core/model").LayerData[],
    definitions: Map<
      string,
      import("../core/smart/types").SmartComponentDefinition
    >,
  ) => {
    for (const layer of layers) {
      if (!layer.visible || layer.opacity === 0) continue;
      if (layer.kind === "text") families.add(layer.fontFamily);
      else if (layer.kind === "group") walk(layer.children, definitions);
      else if (layer.kind === "smart-object") {
        const definition = definitions.get(layer.componentId);
        if (!definition || seen.has(definition)) continue;
        seen.add(definition);
        if (definition.source.kind === "document") {
          const master = definition.source.document;
          walk(
            master.children,
            new Map([
              ...definitions,
              ...(master.components ?? []).map(
                (value) => [value.id, value] as const,
              ),
            ]),
          );
        }
      }
    }
  };
  walk(
    document.children,
    new Map((document.components ?? []).map((value) => [value.id, value])),
  );
  return [...families].sort();
}
