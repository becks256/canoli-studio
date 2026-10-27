import type {PsdParsedLayer} from './types';
import {psdLayerTree,type PsdLayerNode} from './groups';

/** Native clipping has one grouped base blend and intrinsic pixel coverage.
 * Photoshop's advanced switches and group clipping need separate fidelity gates. */
export function psdClippingIssue(layers:readonly PsdParsedLayer[]):string|undefined{
 if(layers.some(layer=>![0,1].includes(layer.clipping)))return 'Unknown Photoshop clipping value';
 let tree:PsdLayerNode[];try{tree=psdLayerTree(layers);}catch{return;}
 const checkedCoverage=new Set<PsdParsedLayer>();
 const visit=(nodes:PsdLayerNode[]):string|undefined=>{
  let base:PsdParsedLayer|undefined;
  for(const {layer,children}of nodes){
   if(layer.clipping===0)base=layer;
   else{
    if(layer.clipping!==1)return 'Unknown Photoshop clipping value';
    if(!base)return 'Orphan Photoshop clipping layer';
    if(base.isGroup||layer.isGroup)return 'Photoshop clipping involving a group';
    if(!base.imageData||!layer.imageData)return 'Photoshop clipping without decoded pixel coverage';
    if(!checkedCoverage.has(base)){
     for(let p=3;p<base.imageData.data.length;p+=4){const alpha=base.imageData.data[p];if(alpha!==0&&alpha!==255)return 'Photoshop clipping with soft intrinsic base transparency';}
     checkedCoverage.add(base);
    }
    if((base.fillOpacity??255)!==255)return 'Photoshop clipping base with separate Fill';
    if(base.blendClippedElements===false)return 'Photoshop ungrouped clipping blend';
   }
   const issue=visit(children);if(issue)return issue;
  }
 };
 return visit(tree);
}
