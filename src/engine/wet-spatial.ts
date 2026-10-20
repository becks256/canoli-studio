import { AffineTransform } from '../core/affine';
import type { Rect } from '../core/drawing';
import { yieldTask } from './task-yield';
import { validateWetCarried } from './wet-paint';

export interface WetField { readonly bounds: Rect; readonly transform: AffineTransform; readonly tiles: ReadonlyMap<string, string>; }
export function wetTileKey(x: number, y: number): string { return `${x},${y}`; }
export function wetRegion(region: Rect): Rect {
  const owned = { ...region };
  if (![owned.x, owned.y, owned.width, owned.height, owned.x + owned.width, owned.y + owned.height].every(Number.isSafeInteger) || owned.width <= 0 || owned.height <= 0 ||
    owned.x + .5 - owned.x !== .5 || owned.y + .5 - owned.y !== .5 || owned.x + owned.width - .5 - (owned.x + owned.width - 1) !== .5 || owned.y + owned.height - .5 - (owned.y + owned.height - 1) !== .5)
    throw new Error('Wet-paint geometry exceeds the native pixel-center precision.');
  return owned;
}

/** Pull a spatial reservoir through the complete previous/current tip bases.
 * Gathering groups native bilinear neighbors by source tile, so an anisotropic
 * map never allocates its potentially huge source bounding rectangle. */
export async function sampleWetField(
  field: WetField, frame: AffineTransform, region: Rect, tileSize: number,
  read: (key: string) => Promise<Float32Array>, check: () => void,
): Promise<Float32Array> {
  region = wetRegion(region);
  if (!Number.isSafeInteger(tileSize) || tileSize < 1 || tileSize > 256 || region.width > tileSize || region.height > tileSize)
    throw new Error('Wet-paint sampling requires bounded native working tiles.');
  const sourceBounds = wetRegion(field.bounds);
  const inverse = frame.inverse();
  field.transform.inverse();
  const sameBasis = (['a', 'b', 'c', 'd', 'e', 'f'] as const).every(key => field.transform[key] === frame[key]);
  const transform = sameBasis ? new AffineTransform() : field.transform.multiply(inverse);
  // Separate neighbor slots give every pixel the same summation order even
  // when source tiles are visited in a different order or backing layout.
  const groups = new Map<string, number[]>(), result = new Float64Array(region.width * region.height * 16);
  let deadline = performance.now() + 4;
  for (let y = 0; y < region.height; y++) {
    for (let x = 0; x < region.width; x++) {
      const point = transform.point({ x: region.x + x + .5, y: region.y + y + .5 });
      const px = point.x - .5, py = point.y - .5, left = Math.floor(px), top = Math.floor(py), fx = px - left, fy = py - top;
      if (![left, top, left + 1, top + 1].every(Number.isSafeInteger)) throw new Error('Wet-paint reservoir sampling exceeds numeric precision.');
      const target = (y * region.width + x) * 16;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const sx = left + dx, sy = top + dy, weight = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
        if (!weight || sx < sourceBounds.x || sy < sourceBounds.y || sx >= sourceBounds.x + sourceBounds.width || sy >= sourceBounds.y + sourceBounds.height) continue;
        const tx = Math.floor(sx / tileSize) * tileSize, ty = Math.floor(sy / tileSize) * tileSize;
        const key = field.tiles.get(wetTileKey(tx, ty));
        if (!key) throw new Error('Wet-paint carried field is incomplete.');
        let entries = groups.get(key); if (!entries) groups.set(key, entries = []);
        entries.push(target + (dy * 2 + dx) * 4, ((sy - ty) * tileSize + sx - tx) * 4, weight);
      }
    }
    if (performance.now() >= deadline) { check(); await yieldTask(); check(); deadline = performance.now() + 4; }
  }
  for (const [key, entries] of groups) {
    check(); const source = await read(key); check(); validateWetCarried(source, tileSize * tileSize * 4);
    for (let i = 0; i < entries.length; i += 3) for (let c = 0; c < 4; c++) result[entries[i] + c] = source[entries[i + 1] + c] * entries[i + 2];
    if (performance.now() >= deadline) { await yieldTask(); check(); deadline = performance.now() + 4; }
  }
  const output = new Float32Array(region.width * region.height * 4);
  for (let i = 0; i < output.length; i += 4) {
    const base = i * 4, sum = (c: number) => (result[base + c] + result[base + 4 + c]) + (result[base + 8 + c] + result[base + 12 + c]);
    const alpha = Math.max(0, Math.min(1, sum(3))); output[i + 3] = alpha;
    for (let c = 0; c < 3; c++) output[i + c] = Math.max(0, Math.min(alpha, sum(c)));
  }
  check(); return output;
}
