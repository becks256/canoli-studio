import { createCanvas, release } from "./canvas";

interface Entry { key: string; signature: string; canvas?: HTMLCanvasElement; pixels?: Uint8ClampedArray; bytes: number; x?: number; y?: number }

/** Up to 256 entries share the byte budget; small layers can retain history states.
 * Retained working pixels only, never document/source resolution limits.
 * Synchronous reads/copies keep cache-owned buffers out of async callers. */
export class CanvasCache {
  private entries = new Map<symbol, Entry>();
  private variants = new Map<string, Map<string, symbol>>();
  private bytes = 0;
  constructor(readonly budget = 64 * 1024 * 1024) {}
  get byteLength() { return this.bytes; }
  hasCanvas(key: string, signature: string): boolean {
    const id = this.variants.get(key)?.get(signature);
    return !!(id && this.entries.get(id)?.canvas);
  }
  /** Copy of retained pixel geometry; no cache-owned canvas escapes. */
  bounds(key: string, signature: string) {
    const id = this.variants.get(key)?.get(signature);
    const entry = id ? this.entries.get(id) : undefined;
    if (!entry?.canvas) return undefined;
    return { x: entry.x ?? 0, y: entry.y ?? 0,
      width: entry.canvas.width, height: entry.canvas.height };
  }
  read(key: string, signature: string, target: HTMLCanvasElement) {
    return this.draw(key, signature, target.getContext("2d")!);
  }
  /** Synchronous presentation only: retained surfaces never escape cache ownership. */
  draw(key: string, signature: string, context: CanvasRenderingContext2D, x = 0, y = 0) {
    const group = this.variants.get(key), id = group?.get(signature);
    const entry = id ? this.entries.get(id) : undefined;
    if (!entry?.canvas || !id) return false;
    this.entries.delete(id); this.entries.set(id, entry);
    group!.delete(signature); group!.set(signature, id);
    context.drawImage(entry.canvas, x + (entry.x ?? 0), y + (entry.y ?? 0));
    return true;
  }
  /** Retained versions always share the same global byte and surface budgets. */
  write(key: string, signature: string, source: HTMLCanvasElement, retainedVersions = 1, region?: { x: number; y: number; width: number; height: number }) {
    const existing = this.variants.get(key);
    if (existing) {
      const same = existing.get(signature);
      if (same) this.remove(same);
      if (retainedVersions <= 1) for (const id of [...(this.variants.get(key)?.values() ?? [])]) this.remove(id);
      else {
        const versions = this.variants.get(key);
        while (versions && versions.size >= Math.min(64, Math.max(1, retainedVersions))) this.remove(versions.values().next().value!);
      }
    }
    const x = region ? Math.max(0, Math.min(source.width, Math.floor(region.x))) : 0;
    const y = region ? Math.max(0, Math.min(source.height, Math.floor(region.y))) : 0;
    const width = region ? Math.max(0, Math.min(source.width, Math.ceil(region.x + region.width)) - x) : source.width;
    const height = region ? Math.max(0, Math.min(source.height, Math.ceil(region.y + region.height)) - y) : source.height;
    const bytes = Math.max(1, width) * Math.max(1, height) * 4 + signature.length * 2;
    if (bytes > this.budget) return;
    while (this.bytes + bytes > this.budget || this.entries.size >= 256)
      this.remove(this.entries.keys().next().value!);
    const canvas = createCanvas(Math.max(1, width), Math.max(1, height));
    try {
      if (width && height) canvas.getContext("2d")!.drawImage(source, x, y, width, height, 0, 0, width, height);
    } catch (error) {
      release(canvas);
      throw error;
    }
    const id = Symbol();
    this.entries.set(id, { key, signature, canvas, bytes, x, y });
    let group = this.variants.get(key);
    if (!group) this.variants.set(key, group = new Map());
    group.set(signature, id);
    this.bytes += bytes;
  }
  /** Exact straight RGBA for numerical prefixes; shared budget with surfaces. */
  readPixels(key: string, signature: string): Uint8ClampedArray | undefined {
    const id = this.variants.get(key)?.get(signature);
    const entry = id ? this.entries.get(id) : undefined;
    if (!entry?.pixels || !id) return;
    this.entries.delete(id); this.entries.set(id, entry);
    return entry.pixels.slice();
  }
  writePixels(key: string, signature: string, pixels: Uint8ClampedArray) {
    for (const id of [...(this.variants.get(key)?.values() ?? [])]) this.remove(id);
    const bytes = pixels.byteLength + signature.length * 2;
    if (bytes > this.budget) return;
    while (this.bytes + bytes > this.budget || this.entries.size >= 256)
      this.remove(this.entries.keys().next().value!);
    const id = Symbol();
    this.entries.set(id, { key, signature, pixels: pixels.slice(), bytes });
    this.variants.set(key, new Map([[signature, id]]));
    this.bytes += bytes;
  }
  private remove(id: symbol) {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.bytes -= entry.bytes;
    if (entry.canvas) release(entry.canvas);
    this.entries.delete(id);
    const group = this.variants.get(entry.key)!;
    group.delete(entry.signature);
    if (!group.size) this.variants.delete(entry.key);
  }
  clear() { for (const id of this.entries.keys()) this.remove(id); }
}
