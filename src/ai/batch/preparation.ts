import {rawBlobHash} from '../../core/interchange/raw/source';
import {loadProject} from '../../core/project';
import {batchPreparationSchema} from './schema';
import type {BatchConfig,BatchItem} from './types';
import type {BatchStorage} from './storage';

function canonical(value:unknown):unknown{
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical((value as Record<string,unknown>)[key])]));
  return value;
}
/** Output variants are independent of the accepted editable scene. Decoder upgrades do not re-develop it. */
export async function preparationInputs(config:BatchConfig,item:BatchItem):Promise<string>{
  const packageSha=config.recipePackageSnapshot?await rawBlobHash(config.recipePackageSnapshot):null;
  const input={version:1,name:item.name,source:{sha256:item.source.sha256,raw:item.source.raw??null},recipe:config.recipeSnapshot??null,packageSha,params:{...config.recipeParams,...item.parameters}};
  return rawBlobHash(new Blob([JSON.stringify(canonical(input))]));
}
export async function readBatchPreparation(storage:BatchStorage,config:BatchConfig,item:BatchItem,signal?:AbortSignal){
  if(!item.preparation)throw new Error('RAW item has no accepted prepared scene.');
  const metadata=batchPreparationSchema.parse(item.preparation),blob=await storage.getDeliverableBlob(`prepared-${item.id}`);signal?.throwIfAborted();
  if(!blob||blob.size!==metadata.byteLength||await rawBlobHash(blob)!==metadata.sha256)throw new Error('Prepared RAW project is missing or corrupt. Restore it or create a new batch; accepted outputs are not silently redeveloped.');
  if(await preparationInputs(config,item)!==metadata.inputsSha256)throw new Error('RAW source, recipe or parameters differ from the accepted prepared scene. Create a new batch.');
  const prepared=await loadProject(blob);try{
    signal?.throwIfAborted();
    if(!prepared.assets.values().some(asset=>asset.raw?.original.sha256===item.source.sha256))throw new Error('Prepared project does not retain this RAW original.');
    return {...prepared,blob};
  }catch(error){prepared.assets.dispose();throw error;}
}
