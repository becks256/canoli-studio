import type { Rect } from '../core/drawing';
import { createCanvas, release } from './canvas';

/** Gesture-owned native source tiles. No PNG encoding or document assets. */
export class ClonePreviewSource {
  private tiles = new Map<string, HTMLCanvasElement>();
  private disposed = false;
  private active: Promise<void> = Promise.resolve();
  get isDisposed() { return this.disposed; }
  constructor(private sample: (region: Rect) => Promise<HTMLCanvasElement>, private cleanup: () => void = () => {}) {}

  draw(context: CanvasRenderingContext2D, bounds: Rect, visible: Rect, intersects: (region: Rect) => boolean = () => true) {
    // Reference renders may overlap the viewport job. Serialize ownership of
    // cached canvases so eviction cannot release a tile another job is using.
    const pending = this.active.then(() => this.drawTiles(context, bounds, visible, intersects));
    this.active = pending.catch(() => {});
    return pending;
  }

  private async tile(x: number, y: number) {
    if (this.disposed) throw new Error('Clone preview ended.');
    const key = `${x}:${y}`;
    let image = this.tiles.get(key);
    if (!image) {
      image = await this.sample({ x, y, width: 256, height: 256 });
      if (this.disposed) { release(image); throw new Error('Clone preview ended.'); }
      while (this.tiles.size >= 60) {
        const first = this.tiles.keys().next().value!;
        release(this.tiles.get(first)!); this.tiles.delete(first);
      }
    } else this.tiles.delete(key);
    this.tiles.set(key, image);
    return image;
  }

  private async drawTiles(context: CanvasRenderingContext2D, bounds: Rect, visible: Rect, intersects: (region: Rect) => boolean) {
    const left = Math.floor(bounds.x), top = Math.floor(bounds.y);
    const right = Math.ceil(bounds.x + bounds.width), bottom = Math.ceil(bounds.y + bounds.height);
    const startX = left + Math.max(0, Math.floor((visible.x - left) / 1024)) * 1024;
    const startY = top + Math.max(0, Math.floor((visible.y - top) / 1024)) * 1024;
    for (let y = startY; y < Math.min(bottom, visible.y + visible.height); y += 1024)
      for (let x = startX; x < Math.min(right, visible.x + visible.width); x += 1024) {
        // Assemble exactly the native rectangles used by the committed stroke.
        // Transforming cache tiles separately introduces antialiased seams.
        const width = Math.min(1024, right - x), height = Math.min(1024, bottom - y);
        if (!intersects({ x, y, width, height })) continue;
        const image = createCanvas(width, height), c = image.getContext('2d')!;
        try {
          for (let ty = Math.floor(y / 256) * 256; ty < y + height; ty += 256)
            for (let tx = Math.floor(x / 256) * 256; tx < x + width; tx += 256)
              if (intersects({ x: tx, y: ty, width: 256, height: 256 }))
                c.drawImage(await this.tile(tx, ty), tx - x, ty - y);
          context.drawImage(image, x, y);
        } finally { release(image); }
      }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const image of this.tiles.values()) release(image);
    this.tiles.clear(); this.cleanup();
  }
}
