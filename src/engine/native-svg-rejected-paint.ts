import { yieldTask } from "../core/task-yield";
import type { FloatGlyph } from "./float-glyph";
import type { NativeGlyphFont } from "./native-glyph-font";

const MAX_BYTES = 1024 * 1024;

/** Rejections belong to one immutable source-line matching operation. Exact
 * ordered primitive values and font-owner identity avoid hash collisions.
 * A hit only skips a known rejection; it never publishes paint. The caller's
 * check validates every captured owner even on hits. The byte budget bounds
 * working storage independently of source geometry or candidate count. */
export class NativeSvgRejectedPaints {
  private fonts = new WeakMap<NativeGlyphFont, number>();
  private serial = 0;
  private readonly rejected = new Map<string, number>();
  private bytes = 0;

  constructor(private readonly check: () => void) {}

  async key(glyphs: readonly Readonly<FloatGlyph>[]): Promise<string | undefined> {
    this.check();
    const parts: string[] = [];
    let bytes = 4,
      deadline = performance.now() + 2;
    for (const glyph of glyphs) {
      this.check();
      let owner = this.fonts.get(glyph.font);
      if (owner === undefined) {
        owner = this.serial++;
        this.fonts.set(glyph.font, owner);
      }
      const part = JSON.stringify({ ...glyph, font: owner });
      bytes += part.length * 2 + (parts.length ? 2 : 0);
      if (bytes > MAX_BYTES) {
        this.check();
        return;
      }
      parts.push(part);
      if (performance.now() >= deadline) {
        await yieldTask();
        this.check();
        deadline = performance.now() + 2;
      }
    }
    this.check();
    return "[" + parts.join(",") + "]";
  }

  has(key: string | undefined): boolean {
    this.check();
    const bytes = key === undefined ? undefined : this.rejected.get(key);
    if (key === undefined || bytes === undefined) return false;
    this.rejected.delete(key);
    this.rejected.set(key, bytes);
    this.check();
    return true;
  }

  remember(key: string | undefined): void {
    this.check();
    if (key === undefined || this.rejected.has(key)) return;
    const bytes = key.length * 2;
    if (bytes > MAX_BYTES) return;
    while (this.bytes + bytes > MAX_BYTES) {
      const first = this.rejected.keys().next().value!;
      this.bytes -= this.rejected.get(first)!;
      this.rejected.delete(first);
    }
    this.rejected.set(key, bytes);
    this.bytes += bytes;
    this.check();
  }

  clear(): void {
    this.rejected.clear();
    this.fonts = new WeakMap();
    this.serial = this.bytes = 0;
  }
}
