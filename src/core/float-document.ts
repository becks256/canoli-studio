import type {DocumentData,LayerData} from './model';
import type{AssetStore}from'./assets';
import{visitLayerAssets}from'./asset-references';
export function isFloatDocument(document:{colorSpace:string;precision?:string}):boolean{return document.colorSpace==='linear-srgb'&&document.precision==='float32';}

/** Initial connected float scene support. This is a validation gate, not an
 * instruction to bake unsupported operations through the byte compositor. */
export function floatSceneIssue(document:DocumentData):string|null {
  const visit=(layers:LayerData[]):string|null=>{
    for(const layer of layers){
      if(layer.clipped)return 'Clipping stacks are not yet supported in float documents.';
      if(layer.blendMode!=='normal'&&!(layer.kind==='group'&&layer.blendMode==='pass-through'))return 'Float documents currently support Normal and pass-through groups. Other blend modes require their float integration.';
      const style=layer.styles;
      if(style&&(style.dropShadow.enabled||style.colorOverlay.enabled||style.blendIf.enabled))return 'Layer styles require their float document integration.';
      if(layer.kind==='group'){
        if(layer.blendMode==='pass-through'&&(layer.fillOpacity??1)!==1)return 'Float pass-through groups currently require full fill opacity.';
        if(layer.frequencyRadius!=null)return 'Frequency separation requires its float document integration.';
        const issue=visit(layer.children);if(issue)return issue;
      }else if(layer.kind==='raster'){
        if(layer.erasures?.length)return 'Raster erasures require their float document integration.';
      }else if(layer.kind==='adjustment'){
        if(layer.adjustment.kind!=='tone')return 'Float adjustment layers currently support tone adjustments only.';
      }else return 'This float document mode currently supports original high-precision TIFF raster layers, groups, masks and tone adjustments. Other layer types require their float integration.';
    }
    return null;
  };
  return visit(document.children);
}
export function assertFloatSources(document:DocumentData,assets:Pick<AssetStore,'get'>):void{
 const float=isFloatDocument(document);
 const checkByteRole=(id:string)=>{if(assets.get(id).tiff?.editingPrecision==='float32')throw new Error('This operation requires native byte pixels. A float source thumbnail is display-only; use the float document renderer.');};
 const visit=(layers:LayerData[])=>{for(const layer of layers){
  if(layer.kind==='raster'&&float){const asset=assets.get(layer.assetId);if(!asset.tiff||!asset.tiffColor)throw new Error('Float documents require retained original high-precision TIFF raster sources.');}
  visitLayerAssets(layer,reference=>{if(!(float&&layer.kind==='raster'&&reference===layer))checkByteRole(reference.assetId);});
  if(layer.kind==='group')visit(layer.children);
 }};
 visit(document.children);
 for(const definition of document.components??[])if(definition.source.kind==='asset')checkByteRole(definition.source.assetId);else visit(definition.source.document.children);
}
