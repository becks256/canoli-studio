import {AssetStore} from '../core/assets';
import {AffineTransform} from '../core/affine';
import {id,type DocumentData} from '../core/model';
import {refineEdgeOptionsSchema,type MattingRequest,type RefineEdgeControl,type PreparedMatting,type MattingPlan} from '../core/matting';
import {MattingSource} from './matting-source';
import {runMattingJob} from './matting-workflow';
import {LayerMask} from '../dom/masks';

/** Prepare private PNG assets; transfer ownership only around the validated command commit. */
export async function prepareMatting(document:DocumentData,assets:AssetStore,request:MattingRequest,control:RefineEdgeControl={},assertCurrent:()=>void=()=>{},didCommit:()=>boolean=()=>false):Promise<PreparedMatting>{
  const settings=refineEdgeOptionsSchema.parse(request.options),alive=assets.captureLifetime(),sourceAssetIds=new Map<string,unknown>();
  const check=()=>{control.signal?.throwIfAborted();alive();assertCurrent();for(const [key,asset] of sourceAssetIds)if(assets.get(key)!==asset)throw new Error('Matting source asset changed.');};
  const source=new MattingSource(document,assets,{layerId:request.layerId,options:settings},check),staged=new AssetStore(),owned=new Set<string>();
  const cancel=()=>source.dispose();control.signal?.addEventListener('abort',cancel,{once:true});
  let plan:MattingPlan;
  const dispose=()=>{for(const key of owned)staged.remove(key);owned.clear();staged.metadata.dispose();};
  try{
    sourceAssetIds.set(source.asset.id,source.asset);if(source.layer.mask?.kind==='bitmap')sourceAssetIds.set(source.layer.mask.assetId,assets.get(source.layer.mask.assetId));if(settings.trimapAssetId)sourceAssetIds.set(settings.trimapAssetId,assets.get(settings.trimapAssetId));
    check();await source.initialize(control.signal);check();
    const output=await runMattingJob(source.asset.width,source.asset.height,settings,region=>source.captureTile(region),{
      begin:(width,height)=>source.processor.beginMatting(width,height),accumulate:(pixels,request)=>source.processor.accumulateMatting(pixels,request),
      solve:progress=>source.processor.solveMatting(progress),tile:(pixels,request)=>source.processor.mattingTile(pixels,request),
    },control,check);check();
    const maskAsset=await staged.add(output.maskBlob,`${source.layer.name} — matte`,id(),false);owned.add(maskAsset.id);check();
    if(maskAsset.width!==source.asset.width||maskAsset.height!==source.asset.height)throw new Error('Matting output dimensions do not match the source.');
    let foregroundId=source.asset.id;
    if(output.foregroundBlob){const foreground=await staged.add(output.foregroundBlob,`${source.layer.name} — corrected colors`,id(),false);owned.add(foreground.id);check();if(foreground.width!==source.asset.width||foreground.height!==source.asset.height)throw new Error('Corrected foreground dimensions do not match the source.');foregroundId=foreground.id;}
    const linked=source.layer.mask?.linked!==false,basis=linked?AffineTransform.scale(source.layer.width/source.asset.width,source.layer.height/source.asset.height):source.placement;
    const mask=LayerMask.fromBitmap(maskAsset.id,{linked,x:basis.e,y:basis.f,basis:new AffineTransform(basis.a,basis.b,basis.c,basis.d,0,0)}).toJSON();
    plan={sourceId:source.layer.id,mask,unresolvedPixels:output.unresolvedPixels};
    if(settings.outputTo==='new-layer')plan.layer={...structuredClone(source.layer),id:id(),name:`${source.layer.name.slice(0,228)} — refined`,assetId:foregroundId,mask,visible:true,locked:false};
  }catch(error){dispose();check();throw error;}
  finally{control.signal?.removeEventListener('abort',cancel);source.dispose();}
  return{plan,dispose,commit(apply){
    check();const installed:string[]=[];
    try{for(const key of owned){assets.install(staged.get(key),false);installed.push(key);}check();apply();owned.clear();}
    catch(error){if(didCommit())owned.clear();else for(const key of installed){assets.remove(key);owned.delete(key);}throw error;}
  }};
}
