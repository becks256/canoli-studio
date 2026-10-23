import {paletteRow, paletteSchema, paletteEntrySchema, paletteIdentity,
  type Palette, type PaletteRow, type PaletteEntry} from './model';

export const PALETTE_DATABASE = 'canoli-color-palettes';
/** Separate optional UI storage. Transactions never touch a document or its history. */
export class PaletteRepository {
  private disposed = false;
  private active = new Set<() => void>();
  private database(): Promise<IDBDatabase> {
    if (this.disposed) return Promise.reject(new Error('Palette library is closed.'));
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(PALETTE_DATABASE, 1);
      let settled = false;
      request.onupgradeneeded = () => {
        if (settled || this.disposed) {request.transaction?.abort(); return;}
        for (const name of ['entries', 'state'])
          if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
      };
      request.onerror = () => {settled = true; reject(request.error);};
      request.onblocked = () => {settled = true; reject(new Error('Palette storage is blocked by another tab. Close it and retry.'));};
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        if (settled || this.disposed) {db.close(); if (!settled) reject(new Error('Palette library is closed.'));}
        else {settled = true; resolve(db);}
      };
    });
  }
  private async transaction<T>(mode: IDBTransactionMode,
    body: (tx: IDBTransaction, result: (value: T) => void, fail: (cause: unknown) => void) => void,
    signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    const db = await this.database();
    try {return await new Promise<T>((resolve, reject) => {
      let tx: IDBTransaction, value: T, error: unknown;
      try {signal?.throwIfAborted(); if (this.disposed) throw new Error('Palette library is closed.');
        tx = db.transaction(['entries', 'state'], mode);
      } catch (cause) {reject(cause); return;}
      const cleanup = () => {this.active.delete(dispose); signal?.removeEventListener('abort', abort);};
      const fail = (cause: unknown) => {error = cause; try {tx.abort();} catch {cleanup(); reject(cause);}};
      const abort = () => fail(signal?.reason ?? new DOMException('Palette operation cancelled.', 'AbortError'));
      const dispose = () => fail(new Error('Palette library is closed.'));
      this.active.add(dispose);
      tx.oncomplete = () => {cleanup(); resolve(value);};
      tx.onabort = () => {cleanup(); reject(error ?? tx.error ?? new Error('Palette transaction failed.'));};
      signal?.addEventListener('abort', abort, {once: true});
      if (signal?.aborted) {abort(); return;}
      try {body(tx, result => {value = result;}, fail);} catch (cause) {fail(cause);}
    });} finally {db.close();}
  }
  private scan(tx: IDBTransaction, read: (rows: PaletteRow[]) => void, fail: (cause: unknown) => void) {
    const rows: PaletteRow[] = [], request = tx.objectStore('entries').openCursor();
    request.onsuccess = () => {try {
      const cursor = request.result;
      if (cursor) {rows.push({key: cursor.key, value: cursor.value}); cursor.continue();}
      else read(rows);
    } catch (cause) {fail(cause);}};
  }
  private epochIn(tx: IDBTransaction, read: (epoch: string) => void, fail: (cause: unknown) => void) {
    const request = tx.objectStore('state').get('epoch');
    request.onsuccess = () => {try {
      if (request.result !== undefined && typeof request.result !== 'string') throw new Error('Palette generation is unreadable. Clear the library to recover.');
      read(request.result ?? 'initial');
    } catch (cause) {fail(cause);}};
  }
  private advance(tx: IDBTransaction) {tx.objectStore('state').put(crypto.randomUUID(), 'epoch');}
  epoch(signal?: AbortSignal): Promise<string> {
    return this.transaction('readonly', (tx, result, fail) => this.epochIn(tx, result, fail), signal);
  }
  list(signal?: AbortSignal): Promise<PaletteRow[]> {
    return this.transaction('readonly', (tx, result, fail) => this.scan(tx, result, fail), signal);
  }
  install(input: Palette[], epoch: string, signal?: AbortSignal): Promise<{entries: PaletteEntry[]; added: number}> {
    const palettes = input.map(value => paletteSchema.parse(value));
    return this.transaction('readwrite', (tx, result, fail) => this.epochIn(tx, current => {
      if (current !== epoch) throw new Error('Palette library changed during preparation. Reload and retry.');
      this.scan(tx, rows => {
        let entries: PaletteEntry[];
        try {entries = rows.map(paletteRow);} catch {throw new Error('Recover or remove unreadable palettes before importing or saving.');}
        const identities = new Map(entries.map(entry => [paletteIdentity(entry.palette), entry]));
        let added = 0;
        const installed = palettes.map(palette => {
          const key = paletteIdentity(palette), found = identities.get(key);
          if (found) return found;
          const now = Date.now(), entry = paletteEntrySchema.parse({version: 1, id: crypto.randomUUID(),
            revision: crypto.randomUUID(), createdAt: now, updatedAt: now, palette});
          tx.objectStore('entries').put(entry, entry.id); identities.set(key, entry); added++;
          return entry;
        });
        if (added) this.advance(tx);
        result({entries: installed, added});
      }, fail);
    }, fail), signal);
  }
  update(previous: PaletteEntry, input: Palette, signal?: AbortSignal): Promise<PaletteEntry> {
    const palette = paletteSchema.parse(input);
    return this.transaction('readwrite', (tx, result, fail) => {
      const request = tx.objectStore('entries').get(previous.id);
      request.onsuccess = () => {try {
        const current = paletteRow({key: previous.id, value: request.result});
        if (current.revision !== previous.revision) throw new Error('This palette changed in another tab. Reload it before saving.');
        const entry = paletteEntrySchema.parse({...current, palette, revision: crypto.randomUUID(), updatedAt: Date.now()});
        tx.objectStore('entries').put(entry, entry.id); this.advance(tx); result(entry);
      } catch (cause) {fail(cause);}};
    }, signal);
  }
  remove(key: IDBValidKey, signal?: AbortSignal): Promise<void> {
    return this.transaction('readwrite', (tx, result) => {tx.objectStore('entries').delete(key); this.advance(tx); result();}, signal);
  }
  clear(signal?: AbortSignal): Promise<void> {
    return this.transaction('readwrite', (tx, result) => {
      tx.objectStore('entries').clear(); this.advance(tx); result();
    }, signal);
  }
  dispose() {if (this.disposed) return; this.disposed = true; for (const abort of [...this.active]) abort();}
}
