import {characterFontFamilies} from './character-layout';
/** Visible text in groups and reachable embedded masters; unused masters do not affect export. */
export function exportFontFamilies(
  document: import("./model").DocumentData,
  includeHidden=false,
): string[] {
  const families = new Set<string>();
  const seen = new Set<
    import("./smart/types").SmartComponentDefinition
  >();
  const walk = (
    layers: import("./model").LayerData[],
    definitions: Map<
      string,
      import("./smart/types").SmartComponentDefinition
    >,
  ) => {
    for (const layer of layers) {
      if (!includeHidden && (!layer.visible || layer.opacity === 0)) continue;
      if (layer.kind === "text") for(const family of characterFontFamilies(layer))families.add(family);
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
