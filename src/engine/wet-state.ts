import type { AffineTransform } from '../core/affine';
import type { AssetStore } from '../core/assets';
import type { Rect } from '../core/drawing';
import type { WetPaintLoadOptions, WetPaintMixOptions } from '../core/wet-paint';
import type { PixelProcessor } from './processor';
import type { WetTile, WetTileStore, WetTileChange } from './wet-store';
import { assertWetTileStoreAlive } from './wet-store';
import type { wetDabCoverage } from './wet-coverage';
import { wetRegion } from './wet-spatial';

export interface WetStrokeTile { readonly region: Rect; readonly before: Uint8ClampedArray; readonly pixels: Uint8ClampedArray; readonly changed: Uint8Array; readonly epoch?: string; }
export interface WetTileRevision { readonly region: Readonly<Rect>; readonly epoch: string; }
/** Internal delta handoff: reused pixels must already be owned by its caller.
 * Ordinary snapshot()/finish() still return independently complete results. */
export interface WetStrokeProjection { readonly result: WetStrokeResult; readonly reused: readonly WetTileRevision[]; }
export interface WetStrokeControl {
  signal?: AbortSignal;
  check?(): void;
  onProgress?(progress: Readonly<{ dabs: number; workingTiles: number }>): void;
}
export interface WetStrokeOptions extends WetStrokeControl {
  load?: WetPaintLoadOptions;
  mix?: WetPaintMixOptions;
  /** Stroke-plane coordinates to the native simulation plane. */
  transform?: AffineTransform;
  assets?: AssetStore;
  /** Internal backing/working policies; changing them must not change pixels. */
  tileSize?: number;
  cacheBytes?: number;
  storage?(): Promise<WetTileStore>;
  coverage?: typeof wetDabCoverage;
}
export type WetProcessor = Pick<PixelProcessor, 'loadWetPaint' | 'mixWetPaint' | 'mixFiltered' | 'selection' | 'brushTexture'>;

export class WetTileCache {
  protected values = new Map<string, WetTile>();
  bytes = 0;
  peak = 0;
  constructor(protected store: WetTileStore, readonly budget: number) {}
  assertStorageCurrent() { assertWetTileStoreAlive(this.store); }
  async get(key: string): Promise<WetTile | undefined> {
    const cached = this.values.get(key);
    if (cached) { this.values.delete(key); this.values.set(key, cached); return cached; }
    const value = await this.store.get(key);
    if (value && !(value instanceof Uint8ClampedArray) && !(value instanceof Float32Array)) throw new Error('Wet-paint backing storage returned an invalid tile.');
    if (value) this.retain(key, value);
    return value;
  }
  async put(key: string, value: WetTile) { await this.store.put(key, value); this.retain(key, value); }
  async remove(key: string) { this.forget(key); await this.store.remove(key); }
  async batch(changes:readonly WetTileChange[]){
    if(!changes.length)return;
    if(this.store.batch)await this.store.batch(changes);
    else for(const change of changes){if(change.type==='put')await this.store.put(change.key,change.value);else await this.store.remove(change.key);}
    for(const change of changes){if(change.type==='put')this.retain(change.key,change.value);else this.forget(change.key);}
  }
  protected forget(key: string) { const value = this.values.get(key); if (value) this.bytes -= value.byteLength; this.values.delete(key); }
  private retain(key: string, value: WetTile) {
    this.forget(key); if (value.byteLength > this.budget) return;
    while (this.bytes + value.byteLength > this.budget) this.forget(this.values.keys().next().value!);
    this.values.set(key, value); this.bytes += value.byteLength; this.peak = Math.max(this.peak, this.bytes);
  }
  clear() { this.values.clear(); this.bytes = 0; }
  async flush(_keys:readonly string[],check:()=>void=()=>{}){check();}
  discard(){this.clear();}
}

/** Complete privately prepared native output; result tiles never resimulate a
 * viewport crop. Its job-owned backing database remains alive until dispose. */
export class WetStrokeResult {
  private closed = false;
  constructor(private readonly store: WetTileStore, private readonly records: readonly { region: Rect; original: string; result: string; epoch?: string }[], readonly diagnostics: Readonly<{ dabs: number; workingTiles: number; resultTiles: number; peakCacheBytes: number }>, private readonly scope?: Rect) {}
  async *tiles(crop?: Rect, reuse?: (region: Readonly<Rect>, epoch: string | undefined) => boolean): AsyncGenerator<WetStrokeTile> {
    if (this.closed) throw new Error('Wet-paint result is disposed.');
    let clip = crop ? wetRegion(crop) : this.scope;
    if (crop && this.scope) {
      const left = Math.max(clip!.x, this.scope.x), top = Math.max(clip!.y, this.scope.y), right = Math.min(clip!.x + clip!.width, this.scope.x + this.scope.width), bottom = Math.min(clip!.y + clip!.height, this.scope.y + this.scope.height);
      if (right <= left || bottom <= top) return;
      clip = { x: left, y: top, width: right - left, height: bottom - top };
    }
    for (const record of this.records) {
      if (this.closed) throw new Error('Wet-paint result is disposed.');
      const box = record.region, left = clip ? Math.max(box.x, clip.x) : box.x, top = clip ? Math.max(box.y, clip.y) : box.y;
      const right = clip ? Math.min(box.x + box.width, clip.x + clip.width) : box.x + box.width, bottom = clip ? Math.min(box.y + box.height, clip.y + clip.height) : box.y + box.height;
      if (right <= left || bottom <= top) continue;
      if (reuse?.(Object.freeze({ x: left, y: top, width: right - left, height: bottom - top }), record.epoch)) continue;
      const original = await this.store.get(record.original), result = await this.store.get(record.result);
      if (this.closed) throw new Error('Wet-paint result is disposed.');
      const length = box.width * box.height * 4;
      if (!(original instanceof Uint8ClampedArray) || !(result instanceof Uint8ClampedArray) || original.length !== length || result.length !== length) throw new Error('Wet-paint result storage is incomplete.');
      const region = { x: left, y: top, width: right - left, height: bottom - top }, before = new Uint8ClampedArray(region.width * region.height * 4), pixels = new Uint8ClampedArray(before.length), changed = new Uint8Array(before.length / 4);
      let any = false;
      for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width; x++) {
        const source = ((top - box.y + y) * box.width + left - box.x + x) * 4, target = (y * region.width + x) * 4;
        for (let c = 0; c < 4; c++) { before[target + c] = original[source + c]; pixels[target + c] = result[source + c]; if (before[target + c] !== pixels[target + c]) changed[target / 4] = 255; }
        if (changed[target / 4]) any = true;
      }
      if (any) yield { region, before, pixels, changed, epoch: record.epoch };
    }
  }
  async dispose(): Promise<void> { this.closed = true; await this.store.dispose(); }
}
