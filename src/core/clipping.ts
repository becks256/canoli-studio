import type {LayerData} from './model';

export interface ClippingStack {
  base: LayerData;
  layers: LayerData[];
}

/** Sibling order is bottom to top. Hidden clipped layers retain membership;
 * an unclipped sibling always begins a new stack. Orphans have no coverage.
 * Adjustment layers can be clipped, but cannot supply intrinsic transparency.
 */
export function clippingStacks(nodes: readonly LayerData[]): ClippingStack[] {
  const stacks:ClippingStack[]=[];
  for(const node of nodes){
    if(!node.clipped)stacks.push({base:node,layers:[]});
    else if(stacks.length&&stacks[stacks.length-1].base.kind!=='adjustment')stacks[stacks.length-1].layers.push(node);
  }
  return stacks;
}

/** Candidate base for an existing or newly enabled clipped sibling. */
export function clippingBaseFor(nodes:readonly LayerData[],id:string):LayerData|undefined{
  let base:LayerData|undefined;
  for(const node of nodes){
    if(node.id===id)return base?.kind==='adjustment'?undefined:base;
    if(node.kind==='group'){const found=clippingBaseFor(node.children,id);if(found)return found;}
    if(!node.clipped)base=node;
  }
}
