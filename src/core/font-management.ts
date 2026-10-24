import {z} from 'zod';
import {allLayers,isLocked,type DocumentData,type TextLayerData} from './model';
import {resolveParagraphStyleLibrary} from './paragraph-styles';
import type {SmartComponentDefinition} from './smart/types';
import {ComponentRegistry} from './smart/manager';

export const fontFamilyRequestSchema=z.string().min(1).max(240);
export interface DocumentFontUsage {
  family:string;
  textLayers:number;
  paragraphStyles:number;
  overrides:number;
  embeddedScopes:number;
  lockedTextLayers:number;
}

/** Scope paths distinguish colliding layer/style IDs in independent embedded documents. */
export function visitFontScopes(document:DocumentData,visit:(scope:DocumentData,path:readonly string[])=>void):void{
  const walk=(scope:DocumentData,path:string[])=>{
    visit(scope,path);
    for(const definition of scope.components??[])if(definition.source.kind==='document')walk(definition.source.document,[...path,definition.id]);
  };
  walk(document,[]);
}

/** Exact authored requests, including fallback lists; every stored scope is included. */
export function documentFontUsage(document:DocumentData):DocumentFontUsage[]{
  const values=new Map<string,DocumentFontUsage>();
  visitFontScopes(document,(scope,path)=>{
    const families=new Set<string>();
    const entry=(family:string)=>{
      families.add(family);
      let value=values.get(family);
      if(!value){value={family,textLayers:0,paragraphStyles:0,overrides:0,embeddedScopes:0,lockedTextLayers:0};values.set(family,value);}
      return value;
    };
    for(const layer of allLayers(scope.children))if(layer.kind==='text'){
      const value=entry(layer.fontFamily);value.textLayers++;
      if(isLocked(scope,layer.id))value.lockedTextLayers++;
      if(layer.paragraphStyle?.overrides.fontFamily!==undefined)entry(layer.paragraphStyle.overrides.fontFamily).overrides++;
    }
    for(const style of scope.paragraphStyles??[]){
      entry(style.format.fontFamily).paragraphStyles++;
      if(style.basedOn?.overrides.fontFamily!==undefined)entry(style.basedOn.overrides.fontFamily).overrides++;
    }
    if(path.length)for(const family of families)values.get(family)!.embeddedScopes++;
  });
  return [...values.values()].sort((a,b)=>a.family.localeCompare(b.family));
}

/** Called only on a command's private draft. Component publication uses existing locks. */
export function replaceDocumentFont(
  document:DocumentData,from:string,to:string,
  reflow:(layer:TextLayerData)=>void,
  replaceComponents:(scope:DocumentData,definitions:SmartComponentDefinition[])=>void,
  forceReflow=false,
):void{
  fontFamilyRequestSchema.parse(from);fontFamilyRequestSchema.parse(to);
  if(from===to&&!forceReflow)return;
  const visit=(scope:DocumentData):boolean=>{
    let touched=false;
    let changedStyles=false;
    const definitions=(scope.paragraphStyles??[]).map(style=>{
      const value=structuredClone(style);
      if(from!==to&&value.format.fontFamily===from){value.format.fontFamily=to;changedStyles=true;}
      if(from!==to&&value.basedOn?.overrides.fontFamily===from){value.basedOn.overrides.fontFamily=to;changedStyles=true;}
      return value;
    });
    const styles=changedStyles?resolveParagraphStyleLibrary(definitions):scope.paragraphStyles??[];
    const byId=new Map(styles.map(style=>[style.id,style]));
    for(const layer of allLayers(scope.children))if(layer.kind==='text'){
      let family=layer.fontFamily;
      if(layer.paragraphStyle){
        const style=byId.get(layer.paragraphStyle.id);
        if(!style)throw new Error('Paragraph style not found.');
        if(layer.paragraphStyle.overrides.fontFamily===from)layer.paragraphStyle.overrides.fontFamily=to;
        family=layer.paragraphStyle.overrides.fontFamily??style.format.fontFamily;
      }else if(family===from)family=to;
      if(family!==layer.fontFamily||forceReflow&&family===from){
        if(isLocked(scope,layer.id))throw new Error('Unlock affected text and its parent groups before replacing a font.');
        layer.fontFamily=family;reflow(layer);touched=true;
      }
    }
    if(changedStyles)scope.paragraphStyles=styles;
    if(scope.components?.length){
      const next=structuredClone(scope.components);
      const rebound=new Set<string>();
      for(const definition of next)if(definition.source.kind==='document'&&visit(definition.source.document))rebound.add(definition.id);
      const changed=next.filter((definition,index)=>JSON.stringify(definition)!==JSON.stringify(scope.components![index]));
      if(changed.length||forceReflow&&rebound.size){
        const registry=new ComponentRegistry(scope.components),affected=new Set<string>();
        for(const definition of changed)for(const id of registry.affectedBy(definition.id))affected.add(id);
        if(forceReflow)for(const definitionId of rebound)for(const id of registry.affectedBy(definitionId))affected.add(id);
        // Definitions use the owning registry. Check dependent instances in every
        // master too, including unchanged parents that reference an edited leaf.
        visitFontScopes({...scope,components:next},(owned,path)=>{
          for(const layer of allLayers(owned.children))if(layer.kind==='smart-object'&&affected.has(layer.componentId)&&isLocked(owned,layer.id)){
            const name=path.length?registry.get(path[0]).name:owned.name;
            throw new Error(`A locked instance "${layer.name}" in "${name}" prevents replacing this font.`);
          }
        });
        if(changed.length)replaceComponents(scope,next);
      }
      touched||=rebound.size>0;
    }
    return touched;
  };
  visit(document);
}
