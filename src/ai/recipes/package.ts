import {readDeliveryPreset} from '../batch/delivery-preset';
import {rawSourceMetadataSchema,rawSourceMetadata,ownRawSource,verifyRawSource,type RawImageSource} from "../../core/interchange/raw/source";
import { z } from "zod";
import {visitLayerTemplateAssets,visitLayerPatchAssets} from '../../core/asset-references';
import {avifDecodeOptionsSchema,type AvifDecodeSettings} from "../../core/interchange/avif/types";
import {tiffDecodeOptionsSchema,type TiffDecodeSettings} from "../../core/interchange/tiff/types";
import type { Recipe } from "./types";
import { recipeSchema } from "./schema";
import {captureFontFileSources,encodeProjectFonts,decodeFontFileSources,projectFontsSchema,type ProjectFontSource} from '../../core/font-project';

export interface RecipeAsset {
  id: string;
  name: string;
  width: number;
  height: number;
  blob: Blob;
  tiff?:TiffDecodeSettings;
  avif?:AvifDecodeSettings;
  raw?:RawImageSource;
}
const magic = new Uint8Array([76, 85, 77, 65, 82, 49, 13, 10]); // LUMAR1\r\n
const safeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const assetSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    width: safeInteger.positive(),
    height: safeInteger.positive(),
    type: z.enum(["image/png", "image/jpeg", "image/webp", "image/tiff", "image/avif"]),
    tiff:tiffDecodeOptionsSchema.optional(),
    avif:avifDecodeOptionsSchema.optional(),
    raw:rawSourceMetadataSchema.safeExtend({originalOffset:safeInteger}).optional(),
    offset: safeInteger,
    size: safeInteger,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict().refine(value=>value.type==='image/avif'?value.avif!==undefined:value.avif===undefined,'AVIF sources require saved precision/color settings; other sources cannot carry them.');
const manifestSchema = z
  .object({
    format: z.literal("luma-recipe"),
    version: z.union([z.literal(1),z.literal(2),z.literal(3),z.literal(4)]),
    delivery:z.object({offset:safeInteger,size:safeInteger.positive(),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict().optional(),
    fonts:projectFontsSchema.optional(),
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
  source: { get(id: string): RecipeAsset;fonts?:ProjectFontSource;deliveryPreset?:Blob },
): Promise<Blob> {
  const recipe = recipeSchema.parse(input) as Recipe;
  const captured=new Map([...recipeAssetIds(recipe)].map(id=>{const asset=source.get(id);return[id,{...asset}]as const;}));
  const deliveryPreset=source.deliveryPreset?new Blob([source.deliveryPreset],{type:'application/x-canoli-delivery'}):undefined;
  const fontSources=captureFontFileSources(recipe.fontFiles??[],source.fonts);
  const assets: z.infer<typeof assetSchema>[] = [];
  const blobs: Blob[] = [];
  let offset = 0;
  const originals=new Map<string,{blob:Blob;entries:z.infer<typeof assetSchema>[]}>();
  for (const id of recipeAssetIds(recipe)) {
    const asset = captured.get(id)!;
    if (asset.id !== id)
      throw new Error("Recipe source asset identity mismatch.");
    const checked=assetSchema.parse({
        id,
        name: asset.name,
        width: asset.width,
        height: asset.height,
        type: asset.blob.type,
        ...(asset.tiff?{tiff:asset.tiff}:{}),
        ...(asset.avif?{avif:asset.avif}:{}),
        ...(asset.raw?{raw:{...rawSourceMetadata(await verifyRawSource(asset.raw,asset.blob,asset.width,asset.height)),originalOffset:0}}:{}),
        offset,
        size: asset.blob.size,
        sha256: hex(await hash(asset.blob)),
      });
    assets.push(checked);
    if(asset.raw){const key=JSON.stringify([asset.raw.original.sha256,asset.raw.original.type]);let original=originals.get(key);if(!original){original={blob:asset.raw.originalBlob,entries:[]};originals.set(key,original);}original.entries.push(checked);}
    blobs.push(asset.blob);
    offset += asset.blob.size;
    if (!Number.isSafeInteger(offset))
      throw new Error("Recipe package offsets exceed safe integer bounds.");
  }
  for(const original of originals.values()){for(const entry of original.entries)entry.raw!.originalOffset=offset;blobs.push(original.blob);offset+=original.blob.size;if(!Number.isSafeInteger(offset))throw new Error('Recipe size exceeds numeric addressing precision.');}
  const fonts=await encodeProjectFonts(fontSources,offset);
  let delivery:z.infer<typeof manifestSchema>['delivery'];
  if(recipe.delivery){
    const file=deliveryPreset;if(!file||file.size!==recipe.delivery.byteLength||hex(await hash(file))!==recipe.delivery.sha256)throw new Error('Recipe delivery preset is missing or corrupt. Keep the complete package.');
    const preset=await readDeliveryPreset(file);if(preset.name!==recipe.delivery.name)throw new Error('Recipe delivery preset identity mismatch.');
    delivery={offset:fonts.endOffset,size:file.size,sha256:recipe.delivery.sha256};
  }else if(deliveryPreset)throw new Error('Unreferenced recipe delivery preset.');
  const version=delivery?4:fonts.manifest?3:originals.size?2:1;
  const manifest = new Blob([
    JSON.stringify({ format: "luma-recipe", version, recipe, assets,...(fonts.manifest?{fonts:fonts.manifest}:{}),...(delivery?{delivery}:{}) }),
  ]);
  const header = new Uint8Array(48);
  header.set(magic);header[5]=48+version;
  new DataView(header.buffer).setBigUint64(8, BigInt(manifest.size), true);
  header.set(await hash(manifest), 16);
  return new Blob([header, manifest, ...blobs,...fonts.blobs,...(delivery?[deliveryPreset!]:[])], {
    type: "application/x-luma-recipe",
  });
}

/** Validates bytes and references; image decoding and installation belong to the importing host. */
export async function readRecipePackage(
  file: Blob,
): Promise<{ recipe: Recipe; assets: RecipeAsset[];fonts:import('../../fonts/resources').FontResourceInput[];deliveryPreset?:Blob }> {
  const header = new Uint8Array(await file.slice(0, 48).arrayBuffer());
  if (
    header.length !== 48 ||
    !magic.every((byte, index) => index===5?(header[index]>=49&&header[index]<=52):header[index] === byte)
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
  if(manifest.version!==header[5]-48||manifest.version===1&&manifest.assets.some(entry=>entry.raw))throw new Error('RAW sources require recipe package version 2.');
  if(manifest.version===3?manifest.fonts===undefined||manifest.recipe.schemaVersion!==2:manifest.version!==4&&(manifest.fonts!==undefined||manifest.recipe.fontFiles!==undefined))throw new Error('Font sources require compatible recipe package version 3/4 and recipe version 2/3.');
  const originalRanges=new Map<number,{blob:Blob;size:number;key:string}>();
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
    let raw:RawImageSource|undefined;
    if(entry.raw){
      const {originalOffset,...metadata}=entry.raw,originalEnd=start+originalOffset+metadata.original.byteLength,key=JSON.stringify([metadata.original.sha256,metadata.original.type,metadata.original.byteLength]);
      if(!Number.isSafeInteger(originalEnd)||originalEnd>file.size)throw new Error('Truncated recipe RAW original.');
      let retained=originalRanges.get(originalOffset);
      if(retained&&retained.key!==key)throw new Error('Conflicting recipe RAW original descriptors.');
      if(!retained){retained={blob:file.slice(start+originalOffset,originalEnd,metadata.original.type),size:metadata.original.byteLength,key};originalRanges.set(originalOffset,retained);}
      raw=ownRawSource({...metadata,originalBlob:retained.blob});
      await verifyRawSource(raw,blob,entry.width,entry.height);
    }
    assets.push({
      id: entry.id,
      name: entry.name,
      width: entry.width,
      height: entry.height,
      blob,
      ...(entry.tiff?{tiff:entry.tiff}:{}),...(entry.avif?{avif:entry.avif}:{}),...(raw?{raw}:{}),    });
    offset += entry.size;
  }
  if (seen.size !== required.size) throw new Error("Missing recipe assets.");
  for(const [originalOffset,original] of [...originalRanges].sort((a,b)=>a[0]-b[0])){if(originalOffset!==offset)throw new Error('Invalid recipe RAW original ranges.');offset+=original.size;}
  const fonts=await decodeFontFileSources(manifest.fonts,manifest.recipe.fontFiles??[],file,start,offset);offset=fonts.endOffset;
  let deliveryPreset:Blob|undefined;
  if(manifest.version===4){
    const entry=manifest.delivery,descriptor=manifest.recipe.delivery;
    if(!entry||!descriptor||manifest.recipe.schemaVersion!==3||entry.offset!==offset||entry.size!==descriptor.byteLength||entry.sha256!==descriptor.sha256||!Number.isSafeInteger(start+offset+entry.size)||start+offset+entry.size>file.size)throw new Error('Invalid recipe delivery dependency.');
    deliveryPreset=file.slice(start+offset,start+offset+entry.size,'application/x-canoli-delivery');
    if(hex(await hash(deliveryPreset))!==entry.sha256)throw new Error('Recipe delivery checksum mismatch.');
    const preset=await readDeliveryPreset(deliveryPreset);if(preset.name!==descriptor.name)throw new Error('Recipe delivery identity mismatch.');offset+=entry.size;
  }else if(manifest.delivery||manifest.recipe.delivery)throw new Error('Delivery dependencies require recipe package version 4.');
  if (start + offset !== file.size)
    throw new Error("Unexpected trailing recipe package bytes.");
  return { recipe: manifest.recipe as Recipe, assets,fonts:fonts.fonts,...(deliveryPreset?{deliveryPreset}:{}) };
}
