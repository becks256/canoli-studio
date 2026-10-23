import {retainedDocuments,captureRetainedHistory} from '../../core/history';
import {AssetStore,captureAssetSource} from '../../core/assets';
import {execute,type EditorCommand} from '../../core/commands';
import {referencedAssets} from '../../core/model';
import {verifyRawSource} from '../../core/interchange/raw/source';
import type {RawImportControl} from '../../core/interchange/raw/types';
import type {Document} from '../../dom';
import {prepareRawAsset} from '../../engine/raw-import';
import type {Recipe} from './types';
import {compileEditPlan,commitRecipePlan,type ExecuteRecipeResult} from './executor';

/** Native recipe work owns private assets; the attached document receives one synchronous command. */
export async function executeRecipeAsync(
  recipe:Recipe,document:Document,params:Record<string,unknown>={},control:RawImportControl={},
  assertTargetAvailable:()=>void=()=>{},
):Promise<ExecuteRecipeResult>{
  const captured=structuredClone(recipe),supplied=structuredClone(params),assets=document.assetStore;
  const revision=document.getSnapshot().revision,selectedId=document.selectedLayer?.id??null;
  const plan=compileEditPlan(captured,document.toJSON(),selectedId,supplied,
    assets?new Set(assets.values().map(asset=>asset.id)):undefined,assets??undefined);
  if(!plan.valid)return {success:false,plan,error:`Recipe '${captured.name}' validation failed: ${plan.errors.join('; ')}`};
  const alive=assets?.captureLifetime(),pins=new Map<string,ReturnType<typeof captureAssetSource>>();
  const current=()=>{
    assertTargetAvailable();control.signal?.throwIfAborted();alive?.();
    if(document.assetStore!==assets||document.getSnapshot().revision!==revision)throw new Error('Document changed during recipe preparation. Review the target and retry.');
    if((document.selectedLayer?.id??null)!==selectedId)throw new Error('Layer selection changed during recipe preparation. Review the target and retry.');
    for(const pin of pins.values())pin.check();
  };
  const staging=new AssetStore(),promoted:string[]=[];
  try{
    current();
    if(assets){
      const outputs=new Set(plan.rawDevelopments?.map(value=>value.assetId)??[]);
      const sources=new Set([...referencedAssets(document.toJSON()),...(plan.rawDevelopments??[]).map(value=>value.sourceAssetId).filter(value=>!outputs.has(value))]);
      for(const assetId of sources)pins.set(assetId,captureAssetSource(assets,assetId));
    }
    for(const request of plan.rawDevelopments??[]){
      if(!assets)throw new Error('RAW recipes require the target document asset store.');
      if(!staging.has(request.sourceAssetId)&&!pins.has(request.sourceAssetId))pins.set(request.sourceAssetId,captureAssetSource(assets,request.sourceAssetId));
      const source=staging.has(request.sourceAssetId)?staging.get(request.sourceAssetId):pins.get(request.sourceAssetId)!.asset;
      if(!source.raw)throw new Error('RAW recipe source has no retained original.');
      current();await verifyRawSource(source.raw,source.blob,source.width,source.height,current);
      await prepareRawAsset(staging,source.raw.originalBlob,source.raw.original.name,request.options,control,current,request.assetId);
    }
    // Actual native geometry replaces planning estimates before ordinary command validation.
    const repair=(command:EditorCommand):EditorCommand=>{
      if(command.type==='transaction')return {...command,commands:command.commands.map(repair)};
      if(command.type==='component.set'&&command.definition.source.kind==='asset'&&staging.has(command.definition.source.assetId)){
        const asset=staging.get(command.definition.source.assetId);
        return {...command,definition:{...command.definition,source:{...command.definition.source,width:asset.width,height:asset.height}}};
      }
      return command;
    };
    plan.resolvedCommands=plan.resolvedCommands.map(repair);
    plan.steps=plan.steps.map(step=>step.resolvedCommand?{...step,resolvedCommand:repair(step.resolvedCommand)}:step);
    let final=document.toJSON();for(const command of plan.resolvedCommands)final=execute(final,command);
    for(const assetId of referencedAssets(final))if(!assets?.has(assetId)&&!staging.has(assetId))throw new Error(`Recipe source asset is unavailable: ${assetId}`);
    current();
    for(const asset of staging.values()){staging.shareTo(assets!,asset.id,asset.id);promoted.push(asset.id);}
    return commitRecipePlan(captured,document,plan);
  }catch(error){return {success:false,plan,error:error instanceof Error?error.message:String(error)};}
  finally{
    // Observers can throw after acceptance. Keep every asset the model/history actually owns.
    const state=document.getSnapshot(),retained=new Set(retainedDocuments(state.document,captureRetainedHistory(state)).flatMap(value=>[...referencedAssets(value)]));
    for(const assetId of promoted)if(!retained.has(assetId))assets!.remove(assetId);
    staging.dispose();
  }
}
