import { isImmutable } from "../core/immutable";
import { maskGeometry, type LayerMaskData } from "../core/masks";
const ids = new WeakMap<object, number>();
let nextId = 0;

// Tagged alternatives prevent value-shaped data from colliding with identity keys.
function strokeKey(entry: NonNullable<LayerMaskData["strokes"]>[number]) {
  if (!isImmutable(entry)) return ["value", entry];
  let id = ids.get(entry);
  if (id === undefined) { id = ++nextId; ids.set(entry, id); }
  return ["immutable", id];
}
/** Only registry-proven immutable stroke records may avoid value serialization. */
export function maskSignature(mask: LayerMaskData): string {
  return JSON.stringify({ ...mask, strokes: mask.strokes?.map(strokeKey) });
}
/** Raw coverage excludes density/inversion and placement, as maskGeometry does. */
export function maskGeometrySignature(mask: LayerMaskData): string {
  const geometry: unknown[] = maskGeometry(mask);
  geometry[geometry.length - 1] = (mask.strokes ?? []).map(strokeKey);
  return JSON.stringify(geometry);
}
