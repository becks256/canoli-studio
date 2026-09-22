import { createCanvas, release } from "./canvas";

/** Retained working pixels only, never document/source resolution limits.
 * Reads and writes copy synchronously: async render jobs never borrow buffers
 * that another job (or session replacement) can evict underneath them. */
export class CanvasCache {
  private entries = new Map<string, { signature: string; canvas: HTMLCanvasElement; bytes: number }>();
  private bytes = 0;
  constructor(readonly budget = 64 * 1024 * 1024) {}
  get byteLength() { return this.bytes; }
  read(key: string, signature: string, target: HTMLCanvasElement) {
    const entry = this.entries.get(key);
    if (!entry || entry.signature !== signature) return false;
    this.entries.delete(key);
    this.entries.set(key, entry);
    target.getContext("2d")!.drawImage(entry.canvas, 0, 0);
    return true;
  }
  write(key: string, signature: string, source: HTMLCanvasElement) {
    this.remove(key);
    const bytes = source.width * source.height * 4 + signature.length * 2;
    if (bytes > this.budget) return;
    while (this.bytes + bytes > this.budget || this.entries.size >= 64)
      this.remove(this.entries.keys().next().value!);
    const canvas = createCanvas(source.width, source.height);
    canvas.getContext("2d")!.drawImage(source, 0, 0);
    this.entries.set(key, { signature, canvas, bytes });
    this.bytes += bytes;
  }
  private remove(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.bytes -= entry.bytes;
    release(entry.canvas);
    this.entries.delete(key);
  }
  clear() {
    for (const key of this.entries.keys()) this.remove(key);
  }
}
