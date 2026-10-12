import type { LayerData } from "../core/model";
import { isImmutable } from "../core/immutable";
const ids = new WeakMap<object, number>();
let nextId = 0;
const compositing = new Set(["mask", "styles", "opacity", "fillOpacity", "blendMode", "visible", "name", "locked"]);

/** Raw pixels precede these compositing properties. Immutable content needs no JSON copy. */
export function contentSignature(layer: LayerData): string {
  return JSON.stringify(Object.entries(layer).filter(([key]) => !compositing.has(key)).map(([key, value]) => {
    // Small affine records are frequently recreated with identical values by
    // resize/transform commands. Identity would invalidate equivalent pixels.
    if (key === "transform" || !isImmutable(value)) return [key, "value", value];
    let id = ids.get(value);
    if (id === undefined) { id = ++nextId; ids.set(value, id); }
    return [key, "immutable", id];
  }));
}
