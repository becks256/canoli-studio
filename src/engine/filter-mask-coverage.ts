import type { LayerMaskData } from "../core/masks";
import { strokeBounds } from "../core/drawing";
import type { AffineTransform } from "../core/affine";
import type { Rect } from "../core/drawing";

/** Conservative endpoint detection. Unknown/fractional coverage uses normal rasterization. */
export function uniformFilterMaskCoverage(
  mask: LayerMaskData,
  region: Rect,
  basis: AffineTransform,
): 0 | 1 | undefined {
  if (!mask.enabled || mask.density === 0) return 1;
  if (mask.kind !== "paint" || (mask.base !== 0 && mask.base !== 1))
    return undefined;
  // Native mask feather uses finite support of 3 * ceil(feather / 3).
  const halo = 3 * Math.ceil((mask.feather ?? 0) / 3);
  for (const entry of mask.strokes) {
    const bounds = basis.bounds(strokeBounds(entry.stroke));
    if (
      bounds.x + bounds.width >= region.x - halo &&
      bounds.x <= region.x + region.width + halo &&
      bounds.y + bounds.height >= region.y - halo &&
      bounds.y <= region.y + region.height + halo
    )
      return undefined;
  }
  const base = mask.inverted ? 1 - mask.base : mask.base;
  if (base === 1) return 1;
  return mask.density === 1 ? 0 : undefined;
}

/** Only paint strokes whose conservative support can influence this native region. */
export function regionalFilterMask(
  mask: LayerMaskData,
  region: Rect,
  basis: AffineTransform,
): LayerMaskData {
  if (mask.kind !== "paint") return mask;
  const halo = 3 * Math.ceil((mask.feather ?? 0) / 3);
  return {
    ...mask,
    strokes: mask.strokes.filter((entry) => {
      const bounds = basis.bounds(strokeBounds(entry.stroke));
      return (
        bounds.x + bounds.width >= region.x - halo &&
        bounds.x <= region.x + region.width + halo &&
        bounds.y + bounds.height >= region.y - halo &&
        bounds.y <= region.y + region.height + halo
      );
    }),
  };
}
