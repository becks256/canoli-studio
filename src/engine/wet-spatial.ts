import { AffineTransform } from '../core/affine';
import type { Rect } from '../core/drawing';
import { yieldTask } from './task-yield';
import { validateWetCarried } from './wet-paint';

/** Dense strings remain readable for internal callers. Native sessions retain
 * only the cell's complete intersection with the captured dab support. */
export type WetFieldTile = string | Readonly<{ key: string; region: Readonly<Rect> }>;
export interface WetField { readonly bounds: Rect; readonly transform: AffineTransform; readonly tiles: ReadonlyMap<string, WetFieldTile>; }
export const wetFieldStorageKey = (tile: WetFieldTile): string => typeof tile === 'string' ? tile : tile.key;
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
  // Own metadata before cooperative yields or asynchronous backing reads.
  // Carried samples still belong to the source owner's checked store.
  const tiles = new Map([...field.tiles].map(([cell, tile]) => [cell, typeof tile === 'string' ? tile : {key:tile.key,region:wetRegion(tile.region)}]));
  const inverse = frame.inverse();
  field.transform.inverse();
  const sameBasis = (['a', 'b', 'c', 'd', 'e', 'f'] as const).every(key => field.transform[key] === frame[key]);
  const transform = sameBasis ? new AffineTransform() : field.transform.multiply(inverse);
  // Separate neighbor slots give every pixel the same summation order even
  // when source tiles are visited in a different order or backing layout.
  const groups = new Map<string, { length:number; entries:number[] }>(), result = new Float64Array(region.width * region.height * 16);
  const captured = new Map<string, { key:string; region:Rect }>();
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
        const cell=wetTileKey(tx,ty);
        let tile=captured.get(cell);
        if(!tile){
          const reference=tiles.get(cell);
          if(!reference)throw new Error('Wet-paint carried field is incomplete.');
          const box=typeof reference==='string'?{x:tx,y:ty,width:tileSize,height:tileSize}:reference.region;
          if(typeof reference!=='string'){
            const left=Math.max(tx,sourceBounds.x),top=Math.max(ty,sourceBounds.y),right=Math.min(tx+tileSize,sourceBounds.x+sourceBounds.width),bottom=Math.min(ty+tileSize,sourceBounds.y+sourceBounds.height);
            if(box.x!==left||box.y!==top||box.width!==right-left||box.height!==bottom-top)throw new Error('Wet-paint compact reservoir must retain the complete native cell support.');
          }
          const key=wetFieldStorageKey(reference);if(typeof key!=='string'||!key)throw new Error('Wet-paint carried field is incomplete.');
          tile={key,region:box};captured.set(cell,tile);
        }
        const length=tile.region.width*tile.region.height*4;
        let group=groups.get(tile.key);if(!group)groups.set(tile.key,group={length,entries:[]});
        if(group.length!==length)throw new Error('Wet-paint carried field has inconsistent native extents.');
        group.entries.push(target + (dy * 2 + dx) * 4, ((sy-tile.region.y)*tile.region.width+sx-tile.region.x)*4, weight);
      }
    }
    if (performance.now() >= deadline) { check(); await yieldTask(); check(); deadline = performance.now() + 4; }
  }
  for (const [key, {length,entries}] of groups) {
    check(); const source = await read(key); check(); validateWetCarried(source, length);
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
