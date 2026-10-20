import { z } from "zod";
import {visitLayerTemplateAssets,visitLayerPatchAssets} from '../../core/asset-references';
import {tiffDecodeOptionsSchema,type TiffDecodeSettings} from "../../core/interchange/tiff/types";
import type { Recipe } from "./types";
import { recipeSchema } from "./schema";

export interface RecipeAsset {
  id: string;
  name: string;
  width: number;
  height: number;
  blob: Blob;
  tiff?:TiffDecodeSettings;
}
const magic = new Uint8Array([76, 85, 77, 65, 82, 49, 13, 10]); // LUMAR1\r\n
const safeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const assetSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    width: safeInteger.positive(),
    height: safeInteger.positive(),
    type: z.enum(["image/png", "image/jpeg", "image/webp", "image/tiff"]),
    tiff:tiffDecodeOptionsSchema.optional(),
    offset: safeInteger,
    size: safeInteger,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const manifestSchema = z
  .object({
    format: z.literal("luma-recipe"),
    version: z.literal(1),
    recipe: recipeSchema,
    assets: z.array(assetSchema),
  })
  .strict();
const hash = async (blob: Blob) =>
  new Uint8Array(
    await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
  );
const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

/** Only source references in supported artwork-bearing recipe fields are bundled. */
export function recipeAssetIds(recipe: Recipe): Set<string> {
  const result = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value !== "string" || !value || value.includes("${"))
      throw new Error("Portable recipes require concrete source asset IDs.");
    result.add(value);
  };
  const layer = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    visitLayerTemplateAssets(value,reference=>add(reference.assetId));
    if (node.kind === "group" && Array.isArray(node.children))
      node.children.forEach(layer);
  };
  for (const step of recipe.steps) {
    if (step.action.type === "layer.add") layer(step.action.layerTemplate);
    if (step.action.type === "layer.update") {
      visitLayerPatchAssets(step.action.patch,reference=>add(reference.assetId));
    }
  }
  return result;
}

export async function serializeRecipePackage(
  input: Recipe,
  source: { get(id: string): RecipeAsset },
): Promise<Blob> {
  const recipe = recipeSchema.parse(input) as Recipe;
  const assets: z.infer<typeof assetSchema>[] = [];
  const blobs: Blob[] = [];
  let offset = 0;
  for (const id of recipeAssetIds(recipe)) {
    const asset = source.get(id);
    if (asset.id !== id)
      throw new Error("Recipe source asset identity mismatch.");
    assets.push(
      assetSchema.parse({
        id,
        name: asset.name,
        width: asset.width,
        height: asset.height,
        type: asset.blob.type,
        ...(asset.tiff?{tiff:asset.tiff}:{}),
        offset,
        size: asset.blob.size,
        sha256: hex(await hash(asset.blob)),
      }),
    );
    blobs.push(asset.blob);
    offset += asset.blob.size;
    if (!Number.isSafeInteger(offset))
      throw new Error("Recipe package offsets exceed safe integer bounds.");
  }
  const manifest = new Blob([
    JSON.stringify({ format: "luma-recipe", version: 1, recipe, assets }),
  ]);
  const header = new Uint8Array(48);
  header.set(magic);
  new DataView(header.buffer).setBigUint64(8, BigInt(manifest.size), true);
  header.set(await hash(manifest), 16);
  return new Blob([header, manifest, ...blobs], {
    type: "application/x-luma-recipe",
  });
}

/** Validates bytes and references; image decoding and installation belong to the importing host. */
export async function readRecipePackage(
  file: Blob,
): Promise<{ recipe: Recipe; assets: RecipeAsset[] }> {
  const header = new Uint8Array(await file.slice(0, 48).arrayBuffer());
  if (
    header.length !== 48 ||
    !magic.every((byte, index) => header[index] === byte)
  )
    throw new Error("Invalid recipe package header.");
  const length = Number(new DataView(header.buffer).getBigUint64(8, true));
  const start = 48 + length;
  if (!Number.isSafeInteger(start) || start > file.size)
    throw new Error("Invalid recipe manifest length.");
  const manifestBlob = file.slice(48, start);
  if (hex(await hash(manifestBlob)) !== hex(header.slice(16)))
    throw new Error("Recipe manifest checksum mismatch.");
  const manifest = manifestSchema.parse(JSON.parse(await manifestBlob.text()));
  const required = recipeAssetIds(manifest.recipe as Recipe);
  const seen = new Set<string>();
  const assets: RecipeAsset[] = [];
  let offset = 0;
  for (const entry of manifest.assets) {
    if (seen.has(entry.id) || !required.has(entry.id))
      throw new Error("Duplicate or unreferenced recipe asset.");
    seen.add(entry.id);
    const end = start + offset + entry.size;
    if (
      entry.offset !== offset ||
      !Number.isSafeInteger(end) ||
      end > file.size
    )
      throw new Error("Invalid recipe asset ranges.");
    if(entry.tiff!==undefined&&entry.type!=='image/tiff')throw new Error('TIFF settings on a non-TIFF recipe asset.');
    const blob = file.slice(start + offset, end, entry.type);
    if (hex(await hash(blob)) !== entry.sha256)
      throw new Error(`Recipe asset checksum mismatch: ${entry.id}`);
    assets.push({
      id: entry.id,
      name: entry.name,
      width: entry.width,
      height: entry.height,
      blob,
      ...(entry.tiff?{tiff:entry.tiff}:{}),    });
    offset += entry.size;
  }
  if (seen.size !== required.size) throw new Error("Missing recipe assets.");
  if (start + offset !== file.size)
    throw new Error("Unexpected trailing recipe package bytes.");
  return { recipe: manifest.recipe as Recipe, assets };
}
