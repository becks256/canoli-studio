import type { LayerMaskData } from "../core/masks";
import type { AffineTransform } from "../core/affine";
import {
  validateWindow,
  type FloatSourceWindow,
} from "../core/float-source/types";
import { validateFloatAlpha } from "../core/float-shadow";
import { isImmutable } from "../core/immutable";

/** Capture-local canonical mask cells, including native feather and final
 * density/inversion. ROI origins must not change floating coverage geometry. */
export class FloatMaskRaster {
  private identities = new WeakMap<object, number>();
  private serial = 0;
  private cells = new Map<string, Float32Array>();
  constructor(private readonly capacity = 16) {}
  clear() {
    this.cells.clear();
  }
  async read(
    mask: LayerMaskData,
    area: FloatSourceWindow,
    world: AffineTransform,
    readCell: (area: FloatSourceWindow) => Promise<Float32Array>,
    check: () => void,
  ): Promise<Float32Array> {
    check();
    area = validateWindow(area);
    const reusable = isImmutable(mask);
    let identity = reusable ? this.identities.get(mask) : undefined;
    if (identity === undefined) {
      identity = ++this.serial;
      if (reusable) this.identities.set(mask, identity);
    }
    const output = new Float32Array(area.width * area.height),
      size = 256,
      pose = JSON.stringify(world.toJSON());
    for (
      let y = Math.floor(area.y / size) * size;
      y < area.y + area.height;
      y += size
    )
      for (
        let x = Math.floor(area.x / size) * size;
        x < area.x + area.width;
        x += size
      ) {
        check();
        const key = JSON.stringify([identity, pose, x, y]);
        let cell = this.cells.get(key);
        if (cell) {
          this.cells.delete(key);
          this.cells.set(key, cell);
        } else {
          const sampled = await readCell({ x, y, width: size, height: size });
          check();
          validateFloatAlpha(sampled, size * size);
          cell = sampled.slice();
          this.cells.set(key, cell);
          while (this.cells.size > this.capacity)
            this.cells.delete(this.cells.keys().next().value!);
        }
        const left = Math.max(x, area.x),
          top = Math.max(y, area.y),
          right = Math.min(x + size, area.x + area.width),
          bottom = Math.min(y + size, area.y + area.height);
        for (let row = top; row < bottom; row++)
          output.set(
            cell.subarray(
              (row - y) * size + left - x,
              (row - y) * size + right - x,
            ),
            (row - area.y) * area.width + left - area.x,
          );
      }
    check();
    return output;
  }
}
