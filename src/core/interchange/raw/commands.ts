import {z} from 'zod';
import {findLayer,type DocumentData} from '../../model';
import {execute} from '../../commands';
import {ComponentRegistry,componentDefinitionSchema} from '../../smart/manager';
import type {ImageAsset} from '../../assets';
import {rawDecodeOptionsSchema,rawImportReportSchema} from './types';

export const rawDevelopmentRequestSchema=z.object({layerId:z.string().min(1).max(240),options:rawDecodeOptionsSchema}).strict();
export const rawDevelopmentPlanSchema=z.object({definition:componentDefinitionSchema,report:rawImportReportSchema}).strict();
export function rawComponentSource(document:DocumentData,layerId:string,assets:Pick<import('../../assets').AssetStore,'get'>){
  const layer=findLayer(document,layerId);if(layer?.kind!=='smart-object')throw new Error('Choose an attached RAW smart object.');
  const definition=new ComponentRegistry(document.components).get(layer.componentId),source=definition.source;
  if(source.kind!=='asset')throw new Error('This smart object has no retained RAW original.');
  const asset=assets.get(source.assetId);if(!asset.raw)throw new Error('This smart object has no retained RAW original.');
  return{layer,definition,source,asset,raw:asset.raw};
}
export function rawComponentCommand(document:DocumentData,layerId:string,asset:Pick<ImageAsset,'id'|'width'|'height'>){
  const layer=findLayer(document,layerId);if(layer?.kind!=='smart-object')throw new Error('Choose an attached RAW smart object.');
  const definition=new ComponentRegistry(document.components).get(layer.componentId);
  const command={type:'transaction' as const,label:'Develop RAW',commands:[{type:'component.set' as const,definition:{...definition,source:{kind:'asset' as const,assetId:asset.id,width:asset.width,height:asset.height}}}]};
  execute(document,command);return command;
}
