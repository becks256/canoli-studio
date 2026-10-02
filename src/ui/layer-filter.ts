import type { LayerData } from "../core/model";
export interface LayerFilter {
  query: string;
  kind: LayerData["kind"] | "all";
  visibility: "all" | "visible" | "hidden";
  lock: "all" | "locked" | "unlocked";
}
export const emptyLayerFilter: LayerFilter = {
  query: "",
  kind: "all",
  visibility: "all",
  lock: "all",
};
export function filterLayers(nodes: LayerData[], filter: LayerFilter) {
  const matches = new Set<string>(),
    included = new Set<string>();
  const words = filter.query
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  function visit(
    layer: LayerData,
    parentVisible: boolean,
    parentLocked: boolean,
  ): boolean {
    const visible = parentVisible && layer.visible;
    const locked = parentLocked || layer.locked;
    const name = layer.name.toLocaleLowerCase();
    const match =
      words.every((word) => name.includes(word)) &&
      (filter.kind === "all" || layer.kind === filter.kind) &&
      (filter.visibility === "all" ||
        visible === (filter.visibility === "visible")) &&
      (filter.lock === "all" || locked === (filter.lock === "locked"));
    if (match) matches.add(layer.id);
    const descendants =
      layer.kind === "group"
        ? layer.children
            .map((child) => visit(child, visible, locked))
            .some(Boolean)
        : false;
    if (match || descendants) included.add(layer.id);
    return match || descendants;
  }
  nodes.forEach((node) => visit(node, true, false));
  return {
    matches,
    included,
    active:
      !!words.length ||
      filter.kind !== "all" ||
      filter.visibility !== "all" ||
      filter.lock !== "all",
  };
}
