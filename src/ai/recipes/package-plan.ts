import type {Document} from '../../dom';
import {documentFontFiles} from '../../core/font-files';
import type {RawImportControl} from '../../core/interchange/raw/types';
import {readRecipePackage,recipeAssetIds} from './package';
import {compileEditPlan} from './executor';
import {withRecipeFonts} from './font-preparation';

/** Read-only trusted preflight: no source installation, commands or Undo. */
export async function compileRecipePackagePlan(file:Blob,document:Document,params:Record<string,unknown>={},control:RawImportControl={},assertTargetAvailable:()=>void=()=>{}){
  const snapshot=document.toJSON(),assets=document.assetStore,revision=document.getSnapshot().revision,selected=document.selectedLayer?.id??null,supplied=structuredClone(params),alive=assets?.captureLifetime();
  const current=()=>{assertTargetAvailable();control.signal?.throwIfAborted();alive?.();if(document.assetStore!==assets||document.getSnapshot().revision!==revision||(document.selectedLayer?.id??null)!==selected)throw new Error('Document or selection changed during package preflight. Review and retry.');};
  current();const contents=await readRecipePackage(file);current();
  return withRecipeFonts(contents.fonts,assets??undefined,documentFontFiles(snapshot),control,current,fonts=>compileEditPlan(contents.recipe,snapshot,selected,supplied,new Set([...(assets?.values().map(asset=>asset.id)??[]),...recipeAssetIds(contents.recipe)]),{
    fonts,get:id=>{if(assets?.has(id))return assets.get(id);const source=contents.assets.find(asset=>asset.id===id);if(!source)throw new Error('Recipe source metadata is unavailable.');return source;},
  }));
}
