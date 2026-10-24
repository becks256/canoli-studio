import {retainedDocuments,captureRetainedHistory} from '../../core/history';
import { AssetStore } from "../../core/assets";
import {visitLayerTemplateAssets,visitLayerPatchAssets} from '../../core/asset-references';
import { id,referencedAssets } from "../../core/model";
import {Document} from "../../dom";
import {captureAssetSource} from "../../core/assets";
import type {RawImportControl} from "../../core/interchange/raw/types";
import {commitRecipePlan} from "./executor";
import type { Recipe } from "./types";
import { readRecipePackage } from "./package";
import {executeRecipeAsync} from './async-executor';
import {documentFontFiles} from '../../core/font-files';
import {recipeFontIds} from './fonts';
import type {FontSourceLease} from '../../fonts/store';

/** Remap only the artwork references represented in the package contract. */
function remapSources(recipe: Recipe, ids: Map<string, string>): void {
  const remap = (node: {assetId:string}) => {
    const replacement = ids.get(String(node.assetId));
    if (!replacement)
      throw new Error("Recipe package source mapping is incomplete.");
    node.assetId = replacement;
  };
  const layer = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    visitLayerTemplateAssets(value,remap);
    if (node.kind === "group" && Array.isArray(node.children))
      node.children.forEach(layer);
  };
  for (const step of recipe.steps) {
    if (step.action.type === "layer.add") layer(step.action.layerTemplate);
    if (step.action.type === "layer.update") {
      visitLayerPatchAssets(step.action.patch,remap);
    }
  }
}

/** Decode privately, then execute against one captured document revision. No library writes. */
export async function executeRecipePackage(
  file: Blob,
  document: Document,
  params: Record<string, unknown> = {},
  assertTargetAvailable: () => void = () => {},
  control:RawImportControl={},
) {
  assertTargetAvailable();
  const origin=document._getHistoryOrigin();
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
  const fontPins:FontSourceLease[]=[],fontPromotions:FontSourceLease[]=[];
  const lifetime=assets.captureLifetime(),pins=[...referencedAssets(document.toJSON())].map(id=>captureAssetSource(assets,id));
  const current=()=>{
    assertTargetAvailable();control.signal?.throwIfAborted();lifetime();
    if(document.assetStore!==assets||document.getSnapshot().revision!==revision)throw new Error('Document changed while preparing the recipe package. Review the target and retry.');
    if((document.selectedLayer?.id??null)!==selectedId)throw new Error('Layer selection changed while preparing the recipe package. Review the target and retry.');
    for(const pin of pins)pin.check();
    for(const pin of fontPins)pin.check();
  };
  try {
    for(const file of documentFontFiles(document.toJSON())){fontPins.push(assets.fonts.retain(file.id));assets.fonts.shareTo(staging.fonts,file.id);}
    const contents = await readRecipePackage(file);
    current();
    for(let index=0;index<contents.fonts.length;index++){
      control.onProgress?.({phase:'inspecting',fraction:index/contents.fonts.length});current();
      await staging.fonts.restore(contents.fonts[index],{signal:control.signal});current();
    }
    const ids = new Map<string, string>();
    for (const entry of contents.assets) {
      const asset = await staging.add(entry.blob, entry.name, id(), false,{tiff:entry.tiff,avif:entry.avif,raw:entry.raw,signal:control.signal});
      current();
      if (asset.width !== entry.width || asset.height !== entry.height)
        throw new Error(
          `Recipe image dimensions do not match the manifest: ${entry.id}`,
        );
      ids.set(entry.id, asset.id);
    }
    remapSources(contents.recipe, ids);
    current();
    // Borrow owner sources into a detached document. Package/native pixels stay private until commit.
    for(const pin of pins)assets.shareTo(staging,pin.asset.id,pin.asset.id);
    const detached=Document.fromJSON(document.toJSON());detached.assetStore=staging;
    detached.selectedLayer=selectedId?detached.getLayer(selectedId):null;
    const result=await executeRecipeAsync(contents.recipe,detached,supplied,control,current);
    if(!result.success)throw new Error(result.error??'Recipe package execution failed.');
    current();
    for(const assetId of referencedAssets(detached.toJSON()))if(!assets.has(assetId)){
      staging.shareTo(assets,assetId,assetId);promoted.push(assetId);
    }
    for(const fontId of new Set([...recipeFontIds(result.plan.resolvedCommands),...documentFontFiles(detached.toJSON()).map(file=>file.id)]))fontPromotions.push(staging.fonts.stageTo(assets.fonts,fontId));
    current();for(const pin of fontPromotions)pin.check();
    const accepted=commitRecipePlan(contents.recipe,document,result.plan,origin);
    if(!accepted.success)throw new Error(accepted.error??'Recipe package commit failed.');
    return accepted;
  } finally {
    const state=document.getSnapshot(),retained=new Set(retainedDocuments(state.document,captureRetainedHistory(state)).flatMap(value=>[...referencedAssets(value)]));
    promoted.forEach(assetId=>{if(!retained.has(assetId))assets.remove(assetId);});
    for(const pin of fontPromotions)pin.release();for(const pin of fontPins)pin.release();
    staging.dispose();
  }
}
