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
  if (roots.some((layer) => isLocked(document, layer.id)))
    throw new Error("Selection contains a locked layer.");
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
