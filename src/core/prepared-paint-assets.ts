import type {DocumentData,LayerData} from './model';
import type {EditorCommand} from './commands';
import {validateWetPaintAssets,validateHdrWetPaintAssets,commandHasWetPaint,wetDocumentOperations,type WetAssetProvider} from './wet-assets';
import {validateFloatCloneAssets,floatCloneDocumentOperations,floatCloneLayerOperations} from './float-clone-assets';
import {validateFloatPatchAssets,floatPatchDocumentOperations,floatPatchLayerOperations} from './float-patch-assets';

export function hasPreparedPaint(document:DocumentData):boolean{return !wetDocumentOperations(document).next().done||!floatCloneDocumentOperations(document).next().done||!floatPatchDocumentOperations(document).next().done;}
function hasFloatClone(layer:LayerData):boolean{return !floatCloneLayerOperations(layer).next().done||!floatPatchLayerOperations(layer).next().done;}
export function commandHasPreparedPaint(command:EditorCommand):boolean{
 if(commandHasWetPaint(command))return true;
 switch(command.type){
  case 'transaction':return command.commands.some(commandHasPreparedPaint);
  case 'paint.add':return command.stroke.kind==='clone'&&command.stroke.precision==='float32';
  case 'layer.update':return command.patch.adjustment?.kind==='patch'&&command.patch.adjustment.precision==='float32';
  case 'layer.add':case 'smartObject.convertToRaster':return hasFloatClone(command.layer);
  case 'component.set':return command.definition.source.kind==='document'&&hasPreparedPaint(command.definition.source.document);
  case 'component.replaceAll':return command.definitions.some(definition=>definition.source.kind==='document'&&hasPreparedPaint(definition.source.document));
  default:return false;
 }
}
/** Start both native captures before yielding, and drain all validation work
 * before callers retire staging views or publish a host transaction. */
async function complete(tasks:Promise<void>[]):Promise<void>{const results=await Promise.allSettled(tasks);for(const result of results)if(result.status==='rejected')throw result.reason;}
export async function validatePreparedPaintAssets(document:DocumentData,provider:WetAssetProvider):Promise<void>{await complete([validateWetPaintAssets(document,provider),validateFloatCloneAssets(document,provider),validateFloatPatchAssets(document,provider)]);}
export async function validateNativePaintAssets(document:DocumentData,provider:Pick<WetAssetProvider,'get'|'check'>):Promise<void>{await complete([validateHdrWetPaintAssets(document,provider),validateFloatCloneAssets(document,provider),validateFloatPatchAssets(document,provider)]);}
