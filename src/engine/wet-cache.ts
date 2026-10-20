import { WetTileCache } from './wet-state';
import {
  assertResidentWetStore, claimResidentWetStore,
  type WetTile, type WetTileChange, type WetTileStore,
} from './wet-store';

/** A fresh native job owns unpublished working data until finish. Snapshots
 * have separate stores; finish flushes referenced pixels before ownership moves
 * to its result. Custom/previously used stores keep write-through semantics. */
class ResidentWetTileCache extends WetTileCache {
  private readonly dirty = new Set<string>();
  private readonly backed = new Set<string>();

  constructor(store: WetTileStore, budget: number, private readonly check: () => void) {
    super(store, budget);
  }

  private current() {
    this.check();
    assertResidentWetStore(this.store);
  }

  override assertStorageCurrent() { assertResidentWetStore(this.store); }

  private async write(changes: readonly WetTileChange[]) {
    this.current();
    if (!changes.length) return;
    await this.store.batch!(changes);
    for (const change of changes) {
      if (change.type === 'put') this.backed.add(change.key);
      else this.backed.delete(change.key);
    }
    this.current();
  }

  private forgetWorking(key: string) {
    this.forget(key);
    this.dirty.delete(key);
  }

  /** Plan touched cells and LRU evictions before I/O. Failed native writes
   * cannot advance resident state. Planning never clones the complete LRU. */
  private async update(changes: readonly WetTileChange[], clean?: string) {
    this.current();
    const final = new Map<string, WetTileChange>();
    for (const change of changes) {
      if (change.type === 'put' && !(change.value instanceof Uint8ClampedArray) && !(change.value instanceof Float32Array))
        throw new Error('Wet working cache requires native tile arrays.');
      final.delete(change.key);
      final.set(change.key, change);
    }

    const retained: { key: string; value: WetTile }[] = [];
    let incoming = 0;
    for (const change of final.values()) {
      if (change.type !== 'put' || change.value.byteLength > this.budget) continue;
      retained.push(change);
      incoming += change.value.byteLength;
      while (incoming > this.budget) incoming -= retained.shift()!.value.byteLength;
    }

    const resident = new Set(retained.map(value => value.key));
    const evictions: string[] = [];
    let surviving = this.bytes;
    for (const key of final.keys()) surviving -= this.values.get(key)?.byteLength ?? 0;
    for (const [key, value] of this.values) {
      if (surviving + incoming <= this.budget) break;
      if (!final.has(key)) {
        evictions.push(key);
        surviving -= value.byteLength;
      }
    }

    const writes: WetTileChange[] = [];
    for (const key of evictions) {
      if (this.dirty.has(key)) writes.push({ type: 'put', key, value: this.values.get(key)! });
    }
    for (const change of final.values()) {
      if (change.type === 'put') {
        if (!resident.has(change.key) && change.key !== clean) writes.push(change);
      } else if (this.backed.has(change.key)) writes.push(change);
    }
    await this.write(writes);

    for (const key of evictions) this.forgetWorking(key);
    for (const key of final.keys()) this.forgetWorking(key);
    for (const value of retained) {
      this.values.set(value.key, value.value);
      this.bytes += value.value.byteLength;
      if (value.key !== clean) this.dirty.add(value.key);
    }
    this.peak = Math.max(this.peak, this.bytes);
  }

  override async get(key: string): Promise<WetTile | undefined> {
    this.current();
    const cached = this.values.get(key);
    if (cached) {
      this.values.delete(key);
      this.values.set(key, cached);
      return cached;
    }
    const value = await this.store.get(key);
    this.current();
    if (value && !(value instanceof Uint8ClampedArray) && !(value instanceof Float32Array))
      throw new Error('Wet-paint backing storage returned an invalid tile.');
    if (value) {
      this.backed.add(key);
      await this.update([{ type: 'put', key, value }], key);
    }
    return value;
  }

  override async put(key: string, value: WetTile) {
    await this.batch([{ type: 'put', key, value }]);
  }

  override async remove(key: string) {
    await this.update([{ type: 'remove', key }]);
  }

  override async batch(changes: readonly WetTileChange[]) {
    // Own caller arrays before an eviction awaits native I/O. Worker/custom
    // processor buffers must not become aliases of retained working epochs.
    const owned = changes.map(change => change.type === 'put'
      ? { ...change, value: change.value.slice() } : { ...change });
    await this.update(owned);
  }

  override async flush(keys: readonly string[], check: () => void = () => {}) {
    this.current();
    let group: WetTileChange[] = [];
    let bytes = 0;
    const commit = async () => {
      if (!group.length) return;
      check();
      await this.write(group);
      for (const change of group) this.dirty.delete(change.key);
      group = [];
      bytes = 0;
      check();
    };
    for (const key of new Set(keys)) {
      this.current();
      if (!this.dirty.has(key)) {
        if (!this.backed.has(key)) throw new Error('Wet result tile has no retained backing data.');
        continue;
      }
      const value = this.values.get(key);
      if (!value) throw new Error('Wet working tile was discarded before publication.');
      if (group.length && (group.length >= 64 || bytes + value.byteLength > 4 * 1024 * 1024)) await commit();
      group.push({ type: 'put', key, value });
      bytes += value.byteLength;
    }
    await commit();
  }

  override clear() {
    if (this.dirty.size) throw new Error('Flush or discard unpublished wet working data before clearing its cache.');
    super.clear();
  }

  override discard() {
    super.clear();
    this.dirty.clear();
    this.backed.clear();
  }
}

export function createWetWorkingCache(store: WetTileStore, budget: number, check: () => void): WetTileCache {
  return budget > 0 && claimResidentWetStore(store)
    ? new ResidentWetTileCache(store, budget, check)
    : new WetTileCache(store, budget);
}
