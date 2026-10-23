import {it, expect, vi} from 'vitest';
import {PaletteLibrary} from '../src/palettes/service';
import {paletteEntrySchema, type Palette, type PaletteEntry, writePalettePack} from '../src/palettes/model';
const palette: Palette = {name: 'Print', description: '', tags: [], swatches: [{name: 'Leaf', color: '#315b2a'}]};
function fixture() {
  const entries = new Map<string, PaletteEntry>(); let generation = 'initial';
  const store = {
    list: vi.fn(async () => [...entries].map(([key, value]) => ({key, value}))),
    epoch: vi.fn(async () => generation),
    install: vi.fn(async (values: Palette[], epoch: string) => {
      if (epoch !== generation) throw new Error('Library changed');
      const added = values.map(value => paletteEntrySchema.parse({version: 1, id: crypto.randomUUID(), revision: crypto.randomUUID(), createdAt: 1, updatedAt: 1, palette: value}));
      added.forEach(entry => entries.set(entry.id, entry)); generation = crypto.randomUUID(); return {entries: added, added: added.length};
    }),
    update: vi.fn(async (previous: PaletteEntry, value: Palette) => {
      if (entries.get(previous.id)?.revision !== previous.revision) throw new Error('Stale revision');
      const entry = {...previous, palette: value, revision: crypto.randomUUID()}; entries.set(entry.id, entry); return entry;
    }),
    remove: vi.fn(async (key: IDBValidKey) => {entries.delete(String(key)); generation = crypto.randomUUID();}),
    clear: vi.fn(async () => {entries.clear(); generation = crypto.randomUUID();}), dispose: vi.fn(),
  };
  return {store, entries};
}
it('does no startup storage I/O and contains unavailable optional storage', async () => {
  const {store} = fixture(), library = new PaletteLibrary(store, false);
  try {expect(store.list).not.toHaveBeenCalled(); await expect(library.refresh()).rejects.toThrow(/unavailable/);}
  finally {library.dispose();} expect(store.dispose).toHaveBeenCalledOnce();
});
it('retains acknowledged saves if list refresh fails, and lets the user retry refresh', async () => {
  const {store, entries} = fixture(), library = new PaletteLibrary(store, true);
  try {
    store.list.mockRejectedValueOnce(new Error('Transient list failure'));
    const entry = await library.save(palette); expect(entries.has(entry.id)).toBe(true);
    expect(library.getSnapshot().error).toMatch(/saved.*Reload/);
    await library.refresh(); expect(library.getSnapshot().entries[0].entry?.id).toBe(entry.id);
  } finally {library.dispose();}
});
it('keeps accepted data when a subscriber throws', async () => {
  const {store} = fixture(), library = new PaletteLibrary(store, true);
  library.subscribe(() => {throw new Error('Listener');});
  try {const entry = await library.save(palette); expect(library.getSnapshot().entries[0].entry?.id).toBe(entry.id);}
  finally {library.dispose();}
});
it('rejects a held import after durable clearing without relying on notifications', async () => {
  const {store, entries} = fixture(), library = new PaletteLibrary(store, true);
  let resume!: (value: ArrayBuffer) => void, entered!: () => void;
  const ready = new Promise<void>(resolve => {entered = resolve;}), bytes = await writePalettePack([palette]).arrayBuffer();
  const blob = new Blob(['pending']); blob.arrayBuffer = () => {entered(); return new Promise(resolve => {resume = resolve;});};
  try {
    const installing = library.importPack(blob), rejected = expect(installing).rejects.toThrow(/changed/);
    await ready; await library.clear(); resume(bytes); await rejected; expect(entries.size).toBe(0);
  } finally {library.dispose();}
});
it('cancellation and disposal prevent a held import from committing', async () => {
  for (const dispose of [false, true]) {
    const {store, entries} = fixture(), library = new PaletteLibrary(store, true), abort = new AbortController();
    let resume!: (value: ArrayBuffer) => void, entered!: () => void;
    const ready = new Promise<void>(resolve => {entered = resolve;}), bytes = await writePalettePack([palette]).arrayBuffer();
    const blob = new Blob(['pending']); blob.arrayBuffer = () => {entered(); return new Promise(resolve => {resume = resolve;});};
    const installing = library.importPack(blob, abort.signal), rejected = expect(installing).rejects.toThrow();
    await ready; if (dispose) library.dispose(); else abort.abort(); resume(bytes); await rejected;
    expect(entries.size).toBe(0); library.dispose();
  }
});
it('quota failures retain previous data and return actionable recovery', async () => {
  const {store, entries} = fixture(), library = new PaletteLibrary(store, true);
  try {
    await library.save(palette); store.install.mockRejectedValueOnce(new DOMException('Full', 'QuotaExceededError'));
    await expect(library.save({...palette, name: 'Second'})).rejects.toThrow(); expect(entries.size).toBe(1);
    expect(library.getSnapshot().error).toMatch(/storage is full/);
  } finally {library.dispose();}
});
