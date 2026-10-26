import { AffineTransform } from "./affine";
import { allLayers, findParent, isLocked } from "./model";
import type { DocumentData } from "./model";
import {
  layerBounds,
  parentSpaceDelta,
  layerTransform,
  unionBounds,
} from "./spatial";
import type { EditorCommand } from "./commands";
import {z} from 'zod';

import {layerAlignmentSchema,alignmentTargetSchema,type LayerAlignment,type AlignmentTarget} from './layer-alignment-schema';
export {layerAlignmentSchema,alignmentTargetSchema,type LayerAlignment,type AlignmentTarget} from './layer-alignment-schema';
export interface AlignmentMovement {type:'layer.update';id:string;patch:{x:number;y:number}}

/** Plan every movement from one canvas-space snapshot before publishing any edit. */
export function alignmentCommands(document:DocumentData,ids:string[],alignment:LayerAlignment,target:AlignmentTarget={type:'selection'}):AlignmentMovement[]{
  alignment=layerAlignmentSchema.parse(alignment);target=alignmentTargetSchema.parse(target);
  z.array(z.string().min(1).max(240)).parse(ids);
  const roots=independentLayoutRoots(document,ids);
  if(!roots.length)return [];
  const keyId=target.type==='layer'?target.id:undefined;
  const key=keyId?allLayers(document.children).find(layer=>layer.id===keyId):undefined;
  if(target.type==='layer'&&!key)throw new Error('The alignment key layer does not exist.');
  const moving=roots.filter(layer=>layer.id!==key?.id);
  if(moving.some(layer=>isLocked(document,layer.id)))throw new Error('Selection contains a locked layer.');
  const contains=(ancestor:string,child:string)=>{let id=findParent(document.children,child);while(id){if(id===ancestor)return true;id=findParent(document.children,id);}return false;};
  if(key&&moving.some(layer=>contains(layer.id,key.id)||contains(key.id,layer.id)))throw new Error('The alignment key layer must be independent of every moving layer.');
  const items=moving.map(layer=>({layer,bounds:layerBounds(document,layer.id)}));
  if(items.some(item=>!item.bounds))throw new Error('Every aligned layer must have geometric bounds.');
  const bounds=target.type==='canvas'?{x:0,y:0,width:document.width,height:document.height}:key?layerBounds(document,key.id):unionBounds(items.map(item=>item.bounds!));
  if(!bounds)throw new Error('The alignment reference must have geometric bounds.');
  const changes:AlignmentMovement[]=[];
  for(const{layer,bounds:b}of items){
    const dx=alignment==='left'?bounds.x-b!.x:alignment==='right'?bounds.x+bounds.width-b!.x-b!.width:alignment==='center'?bounds.x+bounds.width/2-b!.x-b!.width/2:0;
    const dy=alignment==='top'?bounds.y-b!.y:alignment==='bottom'?bounds.y+bounds.height-b!.y-b!.height:alignment==='middle'?bounds.y+bounds.height/2-b!.y-b!.height/2:0;
    if(!Number.isFinite(dx)||!Number.isFinite(dy))throw new Error('Alignment exceeds representable coordinates.');
    if(dx===0&&dy===0)continue;
    const delta=parentSpaceDelta(document,layer.id,{x:dx,y:dy}),x=layer.x+delta.x,y=layer.y+delta.y;
    if(!Number.isFinite(x)||!Number.isFinite(y))throw new Error('Alignment exceeds representable coordinates.');
    changes.push({type:'layer.update',id:layer.id,patch:{x,y}});
  }
  return changes;
}

export type DistributionAxis = "horizontal" | "vertical";
export type DistributionMode = "gaps" | "centers";
/** Preserve outer anchors and stack order; express canvas movement in each parent basis. */
export function distributionCommands(
  document: DocumentData,
  ids: string[],
  axis: DistributionAxis,
  mode: DistributionMode,
): EditorCommand[] {
  if (
    !["horizontal", "vertical"].includes(axis) ||
    !["gaps", "centers"].includes(mode)
  )
    throw new Error("Unknown distribution mode or axis.");
  const roots = editableLayoutRoots(document, ids);
  if (roots.length < 3)
    throw new Error("Select at least three independent layers to distribute.");
  const items = roots
    .map((layer) => {
      const bounds = layerBounds(document, layer.id);
      if (!bounds)
        throw new Error("Every distributed layer must have geometric bounds.");
      const start = axis === "horizontal" ? bounds.x : bounds.y;
      const size = axis === "horizontal" ? bounds.width : bounds.height;
      return { layer, start, size, center: start + size / 2 };
    })
    .sort((a, b) =>
      mode === "centers" ? a.center - b.center : a.start - b.start,
    );
  const first = items[0],
    last = items.at(-1)!;
  const gap =
    mode === "centers"
      ? (last.center - first.center) / (items.length - 1)
      : (last.start +
          last.size -
          first.start -
          items.reduce((sum, item) => sum + item.size, 0)) /
        (items.length - 1);
  if (!Number.isFinite(gap))
    throw new Error("Distribution exceeds representable coordinates.");
  let cursor = first.start + first.size + gap;
  const commands: EditorCommand[] = [];
  for (let index = 1; index < items.length - 1; index++) {
    const item = items[index];
    const destination =
      mode === "centers" ? first.center + gap * index - item.size / 2 : cursor;
    const movement = destination - item.start;
    if (movement !== 0) {
      const delta = parentSpaceDelta(
        document,
        item.layer.id,
        axis === "horizontal" ? { x: movement, y: 0 } : { x: 0, y: movement },
      );
      commands.push({
        type: "layer.update",
        id: item.layer.id,
        patch: { x: item.layer.x + delta.x, y: item.layer.y + delta.y },
      });
    }
    cursor = destination + item.size + gap;
  }
  return commands;
}

function editableLayoutRoots(document: DocumentData, ids: string[]) {
  const roots=independentLayoutRoots(document,ids);
  if (roots.some((layer) => isLocked(document, layer.id)))
    throw new Error("Selection contains a locked layer.");
  return roots;
}
function independentLayoutRoots(document: DocumentData, ids: string[]) {
  const selected = new Set(ids);
  const layers = allLayers(document.children);
  if (
    selected.size !== ids.length ||
    ids.some((id) => !layers.some((layer) => layer.id === id))
  )
    throw new Error("Selection requires distinct existing layers.");
  const roots = layers.filter((layer) => {
    if (!selected.has(layer.id)) return false;
    let parent = findParent(document.children, layer.id);
    while (parent) {
      if (selected.has(parent)) return false;
      parent = findParent(document.children, parent);
    }
    return true;
  });
  return roots;
}

export function flipCommands(
  document: DocumentData,
  ids: string[],
  axis: DistributionAxis,
): EditorCommand[] {
  if (!["horizontal", "vertical"].includes(axis))
    throw new Error("Unknown flip axis.");
  const roots = editableLayoutRoots(document, ids);
  if (!roots.length) throw new Error("Select at least one layer to flip.");
  const bounds = roots.map((layer) => layerBounds(document, layer.id));
  if (bounds.some((value) => !value))
    throw new Error("Every flipped layer must have geometric bounds.");
  const center = unionBounds(bounds.map((value) => value!))!;
  const reflection = AffineTransform.scale(
    axis === "horizontal" ? -1 : 1,
    axis === "vertical" ? -1 : 1,
  ).around({ x: center.x + center.width / 2, y: center.y + center.height / 2 });
  return roots.map((layer) => {
    const parent = findParent(document.children, layer.id);
    const world = reflection.multiply(layerTransform(document, layer.id)!);
    const local = parent
      ? layerTransform(document, parent)!.inverse().multiply(world)
      : world;
    const matrix = local.toJSON();
    return {
      type: "layer.update",
      id: layer.id,
      patch: { x: matrix.e, y: matrix.f, transform: { ...matrix, e: 0, f: 0 } },
    };
  });
}
