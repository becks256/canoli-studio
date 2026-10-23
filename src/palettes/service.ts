import {PaletteRepository} from './storage';
import {paletteRow, paletteSchema, readPalettePack, writePalettePack,
  type Palette, type PaletteEntry, type PaletteSummary} from './model';

export interface PaletteSnapshot {entries: readonly PaletteSummary[]; loading: boolean; error: string; available: boolean}
type Store = Pick<PaletteRepository, 'list' | 'epoch' | 'install' | 'update' | 'remove' | 'clear' | 'dispose'>;
function supported() {try {return typeof window !== 'undefined' && typeof indexedDB !== 'undefined';} catch {return false;}}
export class PaletteLibrary {
  private disposed = false;
  private controllers = new Set<AbortController>();
  private listeners = new Set<() => void>();
  private channel?: BroadcastChannel;
  private snapshot: PaletteSnapshot;
  constructor(private store: Store = new PaletteRepository(), available = supported()) {
    this.snapshot = {entries: [], loading: false, error: available ? '' : 'Local palette storage is unavailable.', available};
    try {if (available && typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel('canoli-color-palettes');
      this.channel.onmessage = event => {if (event.data?.type === 'changed' && event.data?.version === 1) void this.refresh().catch(() => {});};
    }} catch {/* Notifications are advisory. Durable revisions protect writes. */}
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {this.listeners.add(listener); return () => {this.listeners.delete(listener);};};
  private publish(patch: Partial<PaletteSnapshot>) {
    if (this.disposed) return;
    this.snapshot = {...this.snapshot, ...patch};
    for (const listener of this.listeners) try {listener();} catch {/* Observers cannot reverse committed data. */}
  }
  private async operation<T>(run: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.disposed || !this.snapshot.available) throw new Error(this.snapshot.error || 'Palette library is closed.');
    signal?.throwIfAborted();
    const controller = new AbortController(), abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, {once: true}); this.controllers.add(controller);
    this.publish({error: ''});
    try {return await run(controller.signal);} catch (cause) {
      if (!controller.signal.aborted) this.publish({error: cause instanceof Error && cause.name === 'QuotaExceededError'
        ? 'Browser storage is full. Export palettes, remove unneeded copies and retry.' : cause instanceof Error ? cause.message : String(cause)});
      throw cause;
    } finally {this.controllers.delete(controller); signal?.removeEventListener('abort', abort);}
  }
  private async list(signal?: AbortSignal) {
    const rows = await this.store.list(signal); signal?.throwIfAborted();
    const entries = rows.map(row => {try {return {key: row.key, entry: paletteRow(row), error: ''};}
      catch {return {key: row.key, entry: null, error: 'Unreadable palette. Recover its stored record before removing it.'};}});
    entries.sort((a, b) => (b.entry?.updatedAt ?? 0) - (a.entry?.updatedAt ?? 0));
    this.publish({entries});
  }
  private async committed() {
    try {await this.list();} catch {this.publish({error: 'Palette saved, but the list could not refresh. Reload the palette library.'});}
    try {this.channel?.postMessage({type: 'changed', version: 1});} catch {/* Write is already durable. */}
  }
  refresh(signal?: AbortSignal) {return this.operation(async current => {
    this.publish({loading: true}); try {await this.list(current);} finally {this.publish({loading: false});}
  }, signal);}
  save(input: Palette, previous: PaletteEntry | null = null, signal?: AbortSignal) {
    const palette = paletteSchema.parse(input);
    return this.operation(async current => {
      const entry = previous ? await this.store.update(previous, palette, current)
        : (await this.store.install([palette], await this.store.epoch(current), current)).entries[0];
      await this.committed(); return entry;
    }, signal);
  }
  importPack(blob: Blob, signal?: AbortSignal) {return this.operation(async current => {
    const epoch = await this.store.epoch(current), palettes = await readPalettePack(blob);
    current.throwIfAborted();
    const result = await this.store.install(palettes, epoch, current); await this.committed();
    return {added: result.added, reused: result.entries.length - result.added};
  }, signal);}
  exportPack(ids: readonly string[], signal?: AbortSignal) {return this.operation(async current => {
    const wanted = new Set(ids), rows = await this.store.list(current); current.throwIfAborted();
    const entries = rows.filter(row => wanted.has(String(row.key))).map(paletteRow);
    if (!wanted.size || entries.length !== wanted.size) throw new Error('Choose existing valid palettes to export. Reload and retry.');
    return writePalettePack(entries.map(entry => entry.palette));
  }, signal);}
  recover(key: IDBValidKey, signal?: AbortSignal) {return this.operation(async current => {
    const rows = await this.store.list(current); current.throwIfAborted();
    const row = rows.find(row => indexedDB.cmp(row.key, key) === 0);
    if (!row) throw new Error('Palette record is no longer available.');
    return new Blob([JSON.stringify({format: 'canoli-palette-recovery', version: 1, key: row.key, value: row.value}, null, 2)], {type: 'application/json'});
  }, signal);}
  remove(key: IDBValidKey, signal?: AbortSignal) {return this.operation(async current => {await this.store.remove(key, current); await this.committed();}, signal);}
  clear(signal?: AbortSignal) {return this.operation(async current => {await this.store.clear(current); await this.committed();}, signal);}
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const controller of this.controllers) controller.abort(new DOMException('Palette library closed.', 'AbortError'));
    this.store.dispose(); this.channel?.close(); this.listeners.clear();
  }
}
