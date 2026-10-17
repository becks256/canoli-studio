import { AssetStore } from "../../core/assets";
import { id } from "../../core/model";
import type { Document } from "../../dom";
import type { Recipe } from "./types";
import { readRecipePackage } from "./package";
import { executeRecipe } from "./executor";

/** Remap only the artwork references represented in the package contract. */
function remapSources(recipe: Recipe, ids: Map<string, string>): void {
  const remap = (node: Record<string, unknown>) => {
    const replacement = ids.get(String(node.assetId));
    if (!replacement)
      throw new Error("Recipe package source mapping is incomplete.");
    node.assetId = replacement;
  };
  const mask = (value: unknown) => {
    if (
      value &&
      typeof value === "object" &&
      (value as { kind?: string }).kind === "bitmap"
    )
      remap(value as Record<string, unknown>);
  };
  const adjustment = (value: unknown) => {
    if (
      value &&
      typeof value === "object" &&
      (value as { kind?: string }).kind === "patch"
    )
      remap(value as Record<string, unknown>);
  };
  const layer = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    if (node.kind === "raster") remap(node);
    mask(node.mask);
    if (node.kind === "adjustment") adjustment(node.adjustment);
    if (node.kind === "group" && Array.isArray(node.children))
      node.children.forEach(layer);
    if (node.kind === "paint" && Array.isArray(node.strokes))
      for (const stroke of node.strokes) {
        if (stroke?.kind === "clone" && Array.isArray(stroke.tiles))
          stroke.tiles.forEach(remap);
      }
  };
  for (const step of recipe.steps) {
    if (step.action.type === "layer.add") layer(step.action.layerTemplate);
    if (step.action.type === "layer.update") {
      mask(step.action.patch.mask);
      adjustment(step.action.patch.adjustment);
    }
  }
}

/** Decode privately, then execute against one captured document revision. No library writes. */
export async function executeRecipePackage(
  file: Blob,
  document: Document,
  params: Record<string, unknown> = {},
  assertTargetAvailable: () => void = () => {},
) {
  assertTargetAvailable();
  const assets = document.assetStore;
  if (!assets)
    throw new Error(
      "Recipe package execution requires a document asset store.",
    );
  if (typeof createImageBitmap !== "function")
    throw new Error(
      "Recipe package execution requires image decoding support.",
    );
  const revision = document.getSnapshot().revision;
  const selectedId = document.selectedLayer?.id ?? null;
  const supplied = structuredClone(params);
  const staging = new AssetStore();
  const promoted: string[] = [];
  const transferred = new Set<string>();
  let committed = false;
  try {
    const contents = await readRecipePackage(file);
    assertTargetAvailable();
    const ids = new Map<string, string>();
    for (const entry of contents.assets) {
      const asset = await staging.add(entry.blob, entry.name, id(), false,{tiff:entry.tiff});
      assertTargetAvailable();
      if (asset.width !== entry.width || asset.height !== entry.height)
        throw new Error(
          `Recipe image dimensions do not match the manifest: ${entry.id}`,
        );
      ids.set(entry.id, asset.id);
    }
    remapSources(contents.recipe, ids);
    assertTargetAvailable();
    if (
      document.assetStore !== assets ||
      document.getSnapshot().revision !== revision
    ) {
      throw new Error(
        "Document changed while preparing the recipe package. Retry after reviewing the document.",
      );
    }
    if ((document.selectedLayer?.id ?? null) !== selectedId) {
      throw new Error(
        "Layer selection changed while preparing the recipe package. Review the target and retry.",
      );
    }
    // Synchronous installation and command execution prevent intervening document edits.
    for (const asset of staging.values()) {
      assets.install(asset, false);
      promoted.push(asset.id);
      transferred.add(asset.id);
    }
    const result = executeRecipe(contents.recipe, document, supplied);
    if (!result.success)
      throw new Error(result.error ?? "Recipe package execution failed.");
    committed = true;
    return result;
  } finally {
    if (!committed) promoted.forEach((assetId) => assets.remove(assetId));
    // Transferred bitmaps are owned by the document (or were closed by rollback).
    // Dispose only untransferred bitmaps; dispose the staging services separately.
    for (const asset of staging.values())
      if (!transferred.has(asset.id)) asset.bitmap.close();
    staging.metadata.dispose();
  }
}
