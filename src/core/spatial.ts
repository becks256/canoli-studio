import type { DocumentData, LayerData } from "./model";
import { AffineTransform } from "./affine";
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
  if (
    node.kind === "raster" ||
    node.kind === "text" ||
    node.kind === "smart-object"
  )
    return { x: 0, y: 0, width: node.width, height: node.height };
  if (node.kind === "paint") return unionBounds(node.strokes.map(strokeBounds));
  if (node.kind === "vector") return unionBounds(node.paths.map(pathBounds));
  if (node.kind === "group") {
    return unionBounds(
      node.children.flatMap((child) => {
        const b = localBounds(child);
        return b ? [localTransform(child).bounds(b)] : [];
      }),
    );
  }
  return undefined;
}
/** x/y remain translation aliases; schema 6 adds an optional invertible linear basis. */
export function localTransform(node: LayerData): AffineTransform {
  return AffineTransform.translation(node.x, node.y).multiply(
    node.transform
      ? AffineTransform.fromJSON(node.transform)
      : new AffineTransform(),
  );
}
export function layerTransform(
  document: DocumentData,
  targetId: string,
): AffineTransform | undefined {
  const walk = (
    nodes: LayerData[],
    parent: AffineTransform,
  ): AffineTransform | undefined => {
    for (const node of nodes) {
      const transform = parent.multiply(localTransform(node));
      if (node.id === targetId) return transform;
      if (node.kind === "group") {
        const result = walk(node.children, transform);
        if (result) return result;
      }
    }
  };
  return walk(document.children, new AffineTransform());
}
export function layerOrigin(
  document: DocumentData,
  targetId: string,
): Point | undefined {
  return layerTransform(document, targetId)?.point({ x: 0, y: 0 });
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
    transform = layerTransform(document, targetId)!;
  return b ? transform.bounds(b) : undefined;
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
  const walk = (nodes: LayerData[], parent: AffineTransform): string | null => {
    for (const node of [...nodes].reverse()) {
      if (!node.visible || node.opacity === 0) continue;
      const transform = parent.multiply(localTransform(node));
      if (node.kind === "group") {
        const hit = walk(node.children, transform);
        if (hit) return hit;
      } else {
        const b = localBounds(node);
        const point = transform.inverse().point({ x, y });
        if (
          b &&
          point.x >= b.x &&
          point.y >= b.y &&
          point.x <= b.x + b.width &&
          point.y <= b.y + b.height
        )
          return node.id;
      }
    }
    return null;
  };
  return walk(document.children, new AffineTransform());
}

/** Convert a canvas-space displacement to a layer's parent-coordinate displacement. */
export function parentSpaceDelta(
  document: DocumentData,
  layerId: string,
  delta: Point,
): Point {
  const parent = parentId(document, layerId);
  const inverse = parent
    ? layerTransform(document, parent)!.inverse()
    : new AffineTransform();
  return {
    x: inverse.a * delta.x + inverse.c * delta.y,
    y: inverse.b * delta.x + inverse.d * delta.y,
  };
}
