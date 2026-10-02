import type { GuideData } from "./guides";
import type { DocumentData, LayerData } from "./model";
import { findParent } from "./model";
import { layerBounds } from "./spatial";
import type { AffineBounds } from "./affine";

/** Snap moving geometric edges/centers to canvas edges/centers within a canvas-space tolerance. */
export function snapToCanvas(
  bounds: AffineBounds,
  delta: { x: number; y: number },
  width: number,
  height: number,
  tolerance: number,
  artwork: AffineBounds[] = [],
  authoredGuides: GuideData[] = [],
) {
  const axis = (
    start: number,
    size: number,
    shift: number,
    targets: number[],
  ) => {
    let correction = 0,
      guide: number | undefined,
      distance = Infinity;
    for (const target of targets)
      for (const anchor of [start, start + size / 2, start + size]) {
        const difference = target - (anchor + shift);
        if (
          Math.abs(difference) <= tolerance &&
          Math.abs(difference) < distance
        ) {
          correction = difference;
          guide = target;
          distance = Math.abs(difference);
        }
      }
    return { shift: shift + correction, guide };
  };
  const x = axis(bounds.x, bounds.width, delta.x, [
    0,
    width / 2,
    width,
    ...authoredGuides
      .filter((g) => g.orientation === "vertical")
      .map((g) => g.position),
    ...artwork.flatMap((b) => [b.x, b.x + b.width / 2, b.x + b.width]),
  ]);
  const y = axis(bounds.y, bounds.height, delta.y, [
    0,
    height / 2,
    height,
    ...authoredGuides
      .filter((g) => g.orientation === "horizontal")
      .map((g) => g.position),
    ...artwork.flatMap((b) => [b.y, b.y + b.height / 2, b.y + b.height]),
  ]);
  return { x: x.shift, y: y.shift, guides: { x: x.guide, y: y.guide } };
}

/** Visible stationary targets; moving subtrees and their containing groups cannot attract themselves. */
export function artworkSnapBounds(
  document: DocumentData,
  movingIds: string[],
): AffineBounds[] {
  const moving = new Set(movingIds),
    ancestors = new Set<string>();
  for (const id of movingIds) {
    let parent = findParent(document.children, id);
    while (parent) {
      ancestors.add(parent);
      parent = findParent(document.children, parent);
    }
  }
  const result: AffineBounds[] = [];
  const visit = (nodes: LayerData[]) => {
    for (const node of nodes) {
      if (!node.visible || node.opacity === 0 || moving.has(node.id)) continue;
      if (!ancestors.has(node.id)) {
        const bounds = layerBounds(document, node.id);
        if (bounds) result.push(bounds);
      }
      if (node.kind === "group") visit(node.children);
    }
  };
  visit(document.children);
  return result;
}
