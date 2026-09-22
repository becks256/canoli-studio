import type { DocumentData, LayerData } from "./model";
import { pathBounds, strokeBounds } from "./drawing";
import type { Point } from "./drawing";
export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export function unionBounds(rects: Bounds[]): Bounds | undefined {
  if (!rects.length) return undefined;
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const b of rects) {
    left = Math.min(left, b.x);
    top = Math.min(top, b.y);
    right = Math.max(right, b.x + b.width);
    bottom = Math.max(bottom, b.y + b.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}
export function localBounds(node: LayerData): Bounds | undefined {
  if (node.kind === "raster" || node.kind === "text")
    return { x: 0, y: 0, width: node.width, height: node.height };
  if (node.kind === "paint") return unionBounds(node.strokes.map(strokeBounds));
  if (node.kind === "vector") return unionBounds(node.paths.map(pathBounds));
  return unionBounds(
    node.children.flatMap((child) => {
      const b = localBounds(child);
      return b ? [{ ...b, x: b.x + child.x, y: b.y + child.y }] : [];
    }),
  );
}
export function layerOrigin(
  document: DocumentData,
  targetId: string,
): Point | undefined {
  const walk = (
    nodes: LayerData[],
    x: number,
    y: number,
  ): Point | undefined => {
    for (const node of nodes) {
      const origin = { x: x + node.x, y: y + node.y };
      if (node.id === targetId) return origin;
      if (node.kind === "group") {
        const result = walk(node.children, origin.x, origin.y);
        if (result) return result;
      }
    }
  };
  return walk(document.children, 0, 0);
}
export function layerBounds(
  document: DocumentData,
  targetId: string,
): Bounds | undefined {
  const walk = (nodes: LayerData[]): LayerData | undefined => {
    for (const node of nodes) {
      if (node.id === targetId) return node;
      if (node.kind === "group") {
        const result = walk(node.children);
        if (result) return result;
      }
    }
  };
  const node = walk(document.children);
  if (!node) return;
  const b = localBounds(node),
    origin = layerOrigin(document, targetId)!;
  return b ? { ...b, x: b.x + origin.x, y: b.y + origin.y } : undefined;
}
export function parentId(
  document: DocumentData,
  targetId: string,
): string | null {
  const walk = (
    nodes: LayerData[],
    parent: string | null,
  ): string | null | undefined => {
    for (const node of nodes) {
      if (node.id === targetId) return parent;
      if (node.kind === "group") {
        const found = walk(node.children, node.id);
        if (found !== undefined) return found;
      }
    }
  };
  return walk(document.children, null) ?? null;
}
export function hitTest(
  document: DocumentData,
  x: number,
  y: number,
): string | null {
  const walk = (nodes: LayerData[], ox: number, oy: number): string | null => {
    for (const node of [...nodes].reverse()) {
      if (!node.visible || node.opacity === 0) continue;
      const nx = ox + node.x,
        ny = oy + node.y;
      if (node.kind === "group") {
        const hit = walk(node.children, nx, ny);
        if (hit) return hit;
      } else {
        const b = localBounds(node);
        if (
          b &&
          x >= nx + b.x &&
          y >= ny + b.y &&
          x <= nx + b.x + b.width &&
          y <= ny + b.y + b.height
        )
          return node.id;
      }
    }
    return null;
  };
  return walk(document.children, 0, 0);
}
