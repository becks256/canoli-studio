import { AffineTransform } from "../affine";
import { cropDocument } from "../crop";
import { rebaseUnlinkedMask } from "../masks";
import {
  allLayers,
  base,
  createDocument,
  findContainer,
  findLayer,
  isLocked,
  type DocumentData,
} from "../model";
import { layerTransform, localBounds, parentId, unionBounds } from "../spatial";
import { ComponentRegistry } from "./manager";
import {captureFrequencyRadius} from '../frequency-separation';

/** Move a contiguous sibling selection into an editable embedded document. */
export function convertLayers(
  document: DocumentData,
  ids: string[],
  componentId: string,
  instanceId: string,
): void {
  if (!ids.length || new Set(ids).size !== ids.length)
    throw new Error("Select distinct layers to convert.");
  const layers = ids.map((id) => {
    const layer = findLayer(document, id);
    if (!layer) throw new Error("Layer not found.");
    return layer;
  });
  const siblings = findContainer(document.children, ids[0])!;
  if (layers.some((layer) => !siblings.includes(layer)))
    throw new Error("Conversion requires sibling layers in one parent.");
  if (layers.some((layer) => isLocked(document, layer.id)))
    throw new Error("Unlock selected layers and their parent first.");
  const indexes = layers
    .map((layer) => siblings.indexOf(layer))
    .sort((a, b) => a - b);
  if (indexes.at(-1)! - indexes[0] + 1 !== indexes.length)
    throw new Error("Conversion requires contiguous sibling layers.");
  if (document.components?.some((value) => value.id === componentId))
    throw new Error("Component ID already exists.");
  if (allLayers(document.children).some((value) => value.id === instanceId))
    throw new Error("Instance ID already exists.");
  const selected = siblings.slice(indexes[0], indexes[0] + indexes.length);
  const parent = parentId(document, ids[0]);
  const parentWorld = parent
    ? layerTransform(document, parent)!
    : new AffineTransform();
  // Include the original artboard, off-canvas content and conservative style halos.
  const rectangles = [
    parentWorld
      .inverse()
      .bounds({ x: 0, y: 0, width: document.width, height: document.height }),
  ];
  let totalPadX = 0,
    totalPadY = 0;
  for (const node of allLayers(selected)) {
    const bounds = localBounds(node);
    if (!bounds) continue;
    const world = layerTransform(document, node.id)!;
    const region = parentWorld.inverse().multiply(world).bounds(bounds);
    const shadow = node.styles?.dropShadow;
    const padX = shadow?.enabled ? shadow.blur * 3 + Math.abs(shadow.x) + 2 : 2;
    const padY = shadow?.enabled ? shadow.blur * 3 + Math.abs(shadow.y) + 2 : 2;
    // Styles are evaluated in document pixels, then rebased into the parent plane.
    const halo = parentWorld.inverse();
    const x = Math.abs(halo.a) * padX + Math.abs(halo.c) * padY;
    const y = Math.abs(halo.b) * padX + Math.abs(halo.d) * padY;
    totalPadX += x;
    totalPadY += y;
    rectangles.push(region);
  }
  const extent = unionBounds(rectangles)!;
  const bounds = {
    x: extent.x - totalPadX,
    y: extent.y - totalPadY,
    width: extent.width + 2 * totalPadX,
    height: extent.height + 2 * totalPadY,
  };
  const x = Math.floor(bounds.x),
    y = Math.floor(bounds.y);
  const width = Math.ceil(bounds.x + bounds.width) - x,
    height = Math.ceil(bounds.y + bounds.height) - y;
  const master = createDocument(
    selected.length === 1 ? selected[0].name : "Smart object",
    width,
    height,
  );
  master.id = componentId;
  if(document.paragraphStyles)master.paragraphStyles=structuredClone(document.paragraphStyles);
  master.children = structuredClone(selected.map(layer=>captureFrequencyRadius(document,layer)));
  const registry = new ComponentRegistry(document.components);
  const toParent=parentWorld.inverse();
  for (const node of allLayers(master.children)) {
    if (node.mask?.linked === false) {
      node.mask = rebaseUnlinkedMask(node.mask,toParent);
    }
    if (node.kind === "smart-object" && node.filterMask?.linked === false) {
      node.filterMask = rebaseUnlinkedMask(node.filterMask,toParent);
    }
  }
  cropDocument(master, { x, y, width, height });
  document.components = registry
    .withDefinitions([
      {
        id: componentId,
        name: master.name,
        source: { kind: "document", document: master },
      },
    ])
    .registry.values();
  siblings.splice(indexes[0], selected.length, {
    ...base(master.name),
    id: instanceId,
    kind: "smart-object",
    componentId,
    x,
    y,
    width,
    height,
  });
}
