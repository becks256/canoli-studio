import type { BlendMode, DocumentData, LayerData } from "../../model";

export type PsdExportMode = "layers" | "flatten";
export interface PsdRenderedLayer {
  name: string;
  visible: boolean;
  opacity: number;
  blendMode: BlendMode;
  left: number;
  top: number;
  width: number;
  height: number;
  document: DocumentData;
  merged: boolean;
}
export interface PsdExportPlan {
  layers: PsdRenderedLayer[];
  mergedThrough: number;
  reuseComposite: boolean;
}

/** PSD v1's file-format boundary, independent of editor/import geometry. */
export function validatePsdDimensions(width: number, height: number): void {
  if (![width, height].every(value => Number.isSafeInteger(value) && value >= 1 && value <= 30000))
    throw new Error("PSD supports dimensions from 1 to 30,000 pixels. Save a Canoli Studio project or choose PNG for this document; PSB export is not implemented.");
}

/** Native pixel records cannot express a backdrop-dependent adjustment/Blend If.
 * Merge only the prefix needed by the last such layer; keep later layers separate.
 * Groups are isolated by the editor compositor, so their children bake together.
 */
export function planPsdExport(document: DocumentData, mode: PsdExportMode = "layers"): PsdExportPlan {
  if (mode !== "layers" && mode !== "flatten") throw new Error("Choose layers or flatten for PSD export.");
  const canvas = { left: 0, top: 0, width: document.width, height: document.height };
  const merged = (nodes: LayerData[], name: string): PsdRenderedLayer => ({
    ...canvas, name, visible: true, opacity: 1, blendMode: "normal", document: { ...document, children: nodes }, merged: true,
  });
  if (mode === "flatten" || document.children.length === 0)
    return { layers: [merged(document.children, document.name)], mergedThrough: document.children.length - 1, reuseComposite: true };
  let mergedThrough = -1;
  document.children.forEach((node, index) => {
    if (node.kind === "adjustment" || node.styles?.blendIf.enabled) mergedThrough = index;
  });
  const layers: PsdRenderedLayer[] = [];
  if (mergedThrough >= 0) layers.push(merged(document.children.slice(0, mergedThrough + 1), `Merged through ${document.children[mergedThrough].name}`));
  for (const layer of document.children.slice(mergedThrough + 1)) {
    // Keep ordinary placed-raster coordinates and off-canvas pixels. More complex
    // geometry/effects rasterize in the document plane, clipped to its canvas.
    const native = layer.kind === "raster" && !layer.transform && !layer.styles?.dropShadow.enabled &&
      [layer.x, layer.y, layer.width, layer.height].every(Number.isSafeInteger) &&
      layer.width <= 30000 && layer.height <= 30000 &&
      Math.min(layer.x, layer.y) >= -0x80000000 && Math.max(layer.x + layer.width, layer.y + layer.height) <= 0x7fffffff;
    const rect = native ? { left: layer.x, top: layer.y, width: layer.width, height: layer.height } : canvas;
    layers.push({
      ...rect, name: layer.name, visible: layer.visible, opacity: layer.opacity, blendMode: layer.blendMode,
      document: { ...document, children: [{ ...layer, visible: true, opacity: 1, blendMode: "normal" }] }, merged: false,
    });
  }
  return { layers, mergedThrough, reuseComposite: mergedThrough === document.children.length - 1 };
}
