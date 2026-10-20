import { z } from 'zod';
import type {DocumentData,GroupLayerData,LayerData} from './model';
export const frequencySeparationOptionsSchema=z.object({
  sigma:z.number().finite().min(0).max(4096/3).default(4),
  name:z.string().min(1).max(240).default('Frequency separation'),
}).strict();
export interface FrequencySeparationOptions { sigma?:number; name?:string }

/** Nearest explicit controller in this document plane; component masters have their own scope. */
export function frequencyRadiusOwner(document: Pick<DocumentData,'children'>, layerId: string): GroupLayerData | null {
  function walk(nodes: readonly LayerData[], inherited: GroupLayerData | null): GroupLayerData | null | undefined {
    for (const layer of nodes) {
      const owner=layer.kind==='group'&&layer.frequencyRadius!=null?layer:inherited;
      if(layer.id===layerId)return owner;
      if(layer.kind==='group'){
        const found=walk(layer.children,owner);
        if(found!==undefined)return found;
      }
    }
    return undefined;
  }
  return walk(document.children,null)??null;
}

/** Capture inherited radius when isolating artwork or crossing into a new component/document plane. */
export function captureFrequencyRadius(document: Pick<DocumentData,'children'>, layer: LayerData): LayerData {
  const radius=frequencyRadiusOwner(document,layer.id)?.frequencyRadius;
  if(radius==null)return layer;
  if(layer.kind==='group')return layer.frequencyRadius==null?{...layer,frequencyRadius:radius}:layer;
  if(layer.kind==='smart-object'&&layer.smartFilters?.some(filter=>filter.kind==='frequency-band'&&filter.sigma!==radius))
    return{...layer,smartFilters:layer.smartFilters.map(filter=>filter.kind==='frequency-band'?{...filter,sigma:radius}:filter)};
  return layer;
}
