import type {RawImportReport} from '../raw/types';
import type {CatalogCamera,CatalogLens,LensCatalog} from './catalog';

export const lensIdentity=(value:string)=>value.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
export interface CameraMatch {id:string;catalog:LensCatalog;camera:CatalogCamera}
export interface LensSuggestion {id:string;catalog:LensCatalog;lens:CatalogLens;exact:boolean;score:number;cropCompatible:boolean|null;mountCompatible:boolean|null;focalCompatible:boolean|null}
export const catalogRecordId=(catalog:LensCatalog,index:number)=>`${catalog.source.sha256}:${index}`;
const identities=(primary:string,aliases:string[])=>[primary,...aliases].map(lensIdentity).filter(Boolean);
export function matchingCameras(catalogs:readonly LensCatalog[],report:Pick<RawImportReport,'make'|'model'>):CameraMatch[]{
  const maker=lensIdentity(report.make),model=lensIdentity(report.model);if(!maker||!model)return[];
  return catalogs.flatMap(catalog=>catalog.cameras.filter(camera=>!camera.issues.length&&camera.cropFactor!==null&&identities(camera.maker,camera.makerAliases).includes(maker)&&identities(camera.model,camera.modelAliases).includes(model)).map(camera=>({id:catalogRecordId(catalog,camera.index),catalog,camera})));
}
/** These are review suggestions, never a profile choice or a camera-crop inference. */
export function suggestedLenses(catalogs:readonly LensCatalog[],report:RawImportReport,camera?:CameraMatch):LensSuggestion[]{
  const recorded=report.shooting,model=lensIdentity(recorded?.lensModel??''),maker=lensIdentity(recorded?.lensMake??'');if(!model)return[];
  const words=(value:string)=>new Set(lensIdentity(value).match(/[\p{L}]+|[\p{N}]+/gu)?.filter(word=>word!=='f')??[]),requested=words(model);
  const mounts=new Set(camera?[lensIdentity(camera.camera.mount)]:[]);
  if(camera)for(const catalog of catalogs)for(const mount of catalog.mounts)if(!mount.issues.length&&identities(mount.name,mount.aliases).includes(lensIdentity(camera.camera.mount)))for(const compatible of mount.compatible)mounts.add(lensIdentity(compatible));
  const suggestions:LensSuggestion[]=[];
  for(const catalog of catalogs)for(const lens of catalog.lenses){
    if(!lens.definition||lens.issues.length||maker&&!identities(lens.maker,lens.makerAliases).includes(maker))continue;
    let score=0,exact=false;
    for(const candidate of identities(lens.model,lens.modelAliases)){
      if(candidate===model){exact=true;score=100;break;}
      const actual=words(candidate);let overlap=0;for(const word of requested)if(actual.has(word))overlap++;
      if(overlap&&requested.size)score=Math.max(score,Math.floor(60*overlap/requested.size));
    }
    if(!score)continue;
    const focal=recorded?.focalLength??null,range=lens.definition.focalRange,crop=camera?.camera.cropFactor??null;
    const focalCompatible=focal===null||!range.min&&!range.max?null:(!range.min||focal>=range.min)&&(!range.max||focal<=range.max);
    const cropCompatible=crop===null?null:lens.definition.calibrations.some(frame=>Math.fround(Math.fround(crop)/Math.fround(frame.cropFactor))>=Math.fround(.96));
    const mountCompatible=camera?lens.mounts.some(mount=>mounts.has(lensIdentity(mount))):null;
    suggestions.push({id:catalogRecordId(catalog,lens.index),catalog,lens,exact,score,cropCompatible,mountCompatible,focalCompatible});
  }
  return suggestions.sort((a,b)=>b.score-a.score||Number(b.mountCompatible)-Number(a.mountCompatible)||Number(b.cropCompatible)-Number(a.cropCompatible)||a.lens.model.localeCompare(b.lens.model)||a.id.localeCompare(b.id));
}
