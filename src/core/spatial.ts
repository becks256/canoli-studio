import { isActiveWetPaint } from './wet-operation';
import { isImmutable } from './immutable';
import type { DocumentData, LayerData, RasterLayerData, TextLayerData, PaintLayerData, VectorLayerData } from "./model";
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
/** Read-only authored geometry shared by the editor and compact inspection workers. */
export type LayerGeometry =
  Pick<RasterLayerData,'kind'|'width'|'height'|'erasures'>|
  Pick<TextLayerData,'kind'|'width'|'height'|'textPathOrigin'|'textFrameOrigin'>|
  Pick<PaintLayerData,'kind'|'strokes'>|
  Pick<VectorLayerData,'kind'|'paths'>|
  {kind:'smart-object';width:number;height:number}|
  {kind:'adjustment'}|
  {kind:'group';children:readonly (LayerGeometry&Pick<LayerData,'x'|'y'|'transform'>)[]};
export function groupLocalBounds<T extends Pick<LayerData,'x'|'y'|'transform'>>(children:readonly T[],measure:(child:T)=>Bounds|undefined):Bounds|undefined{
  return unionBounds(children.flatMap(child=>{const bounds=measure(child);return bounds?[localTransform(child).bounds(bounds)]:[];}));
}
export function localBounds(node: LayerGeometry): Bounds | undefined {
  if(node.kind==='text'&&(node.textPathOrigin||node.textFrameOrigin)){const origin=node.textPathOrigin??node.textFrameOrigin!;return{x:origin.x,y:origin.y,width:node.width,height:node.height};}
  if (node.kind === 'raster' && node.erasures?.some(entry => isActiveWetPaint(entry.stroke))) return unionBounds([{ x: 0, y: 0, width: node.width, height: node.height }, ...node.erasures.filter(entry => isActiveWetPaint(entry.stroke)).map(entry => AffineTransform.scale(node.width / entry.width, node.height / entry.height).bounds(strokeBounds(entry.stroke)))]);
  if (
    node.kind === "raster" ||
    node.kind === "text" ||
    node.kind === "smart-object"
  )
    return { x: 0, y: 0, width: node.width, height: node.height };
  if (node.kind === "paint") return unionBounds(node.strokes.filter(stroke => stroke.kind !== 'wet' || isActiveWetPaint(stroke)).map(strokeBounds));
  if (node.kind === "vector") return unionBounds(node.paths.map(pathBounds));
  if (node.kind === "group") {
    return groupLocalBounds(node.children,localBounds);
  }
  return undefined;
}
/** x/y remain translation aliases; schema 6 adds an optional invertible linear basis. */
export function localTransform(node: Pick<LayerData,'x'|'y'|'transform'>): AffineTransform {
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
// Cache only complete roots proven immutable by the model registry. Geometry
// depends on ancestry, so shared child identity or persisted IDs are not keys.
const immutableLayerBounds = new WeakMap<object, Map<string, Readonly<Bounds>>>();
export function layerBounds(
  document: DocumentData,
  targetId: string,
): Bounds | undefined {
  if (!isImmutable(document)) return computeLayerBounds(document, targetId);
  let cache = immutableLayerBounds.get(document);
  if (!cache) { cache = new Map(); immutableLayerBounds.set(document, cache); }
  const saved = cache.get(targetId);
  if (saved) return {...saved};
  const result = computeLayerBounds(document, targetId);
  // Missing IDs/empty geometry do not add arbitrary keys to a retained root.
  if (result) cache.set(targetId, Object.freeze({...result}));
  return result;
}
function computeLayerBounds(
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
