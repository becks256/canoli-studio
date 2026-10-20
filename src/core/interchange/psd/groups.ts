import { MAX_LAYERS } from '../../model';
import type { PsdParsedLayer } from './types';

export interface PsdLayerNode { layer:PsdParsedLayer; children:PsdLayerNode[] }

/** PSD/PSB records are bottom-to-top; a bounding divider precedes its children. */
export function psdLayerTree(layers:readonly PsdParsedLayer[]):PsdLayerNode[]{
 const stack:PsdLayerNode[][]=[[]];let count=0;
 for(const layer of layers){
  if(layer.isGroupEnd){stack.push([]);continue;}
  const children=layer.isGroup?stack.pop():[];
  if(!children||!stack.length)throw new Error('Malformed Photoshop group boundaries.');
  if(++count>MAX_LAYERS)throw new Error(`Editable import exceeds the native ${MAX_LAYERS}-layer budget; use the merged composite.`);
  stack[stack.length-1].push({layer,children});
 }
 if(stack.length!==1)throw new Error('Unclosed Photoshop group boundaries.');
 const visit=(nodes:PsdLayerNode[],depth:number)=>{if(depth>8)throw new Error('Editable Photoshop hierarchy exceeds native nesting depth 8; use the merged composite.');for(const node of nodes)if(node.layer.isGroup)visit(node.children,depth+1);};
 visit(stack[0],0);return stack[0];
}

export function psdHierarchyIssue(layers:readonly PsdParsedLayer[]):string|undefined{
 try{psdLayerTree(layers);}catch(error){return error instanceof Error?error.message:String(error);}
}
