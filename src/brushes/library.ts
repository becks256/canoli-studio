import { z } from 'zod';
import { BrushPreset, brushPresetSchema, exportBrushPresets, parseBrushPresets } from './presets';
import { storageErrorMessage } from '../core/storage-errors';
import { serializeBrushRecovery, parseBrushRecovery } from './recovery';
import {prepareBrushRecovery,parseBrushRecoveryFile} from './recovery';
import {presetSourceSchema,verifyPresetSource} from './sources';
import {exportBrushPack,parseBrushPack} from './portable';

const recordSchema = z.object({id: z.string(), revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER), preset: brushPresetSchema,source:presetSourceSchema.optional()}).strict()
  .refine(record => record.id === record.preset.id, 'The brush record ID does not match its preset.')
  .refine(record => !record.id.startsWith('canoli.'), 'Built-in preset IDs cannot be stored as custom presets.')
  .refine(record=>!!record.preset.texture===!!record.source&&(!record.preset.texture||record.preset.texture.sourceId===record.source?.id),'The brush record requires its matching original texture source.');
type StoredRecord = z.infer<typeof recordSchema>;
export interface SavedBrushPreset { readonly preset: BrushPreset; readonly revision: number; }
export interface BrushLibrarySnapshot { presets: readonly SavedBrushPreset[]; loaded: boolean; error: string | null; }
const DATABASE = 'canoli-brush-presets';

/** Local preferences. IndexedDB read/write transactions serialize mutations across tabs. */
export class BrushPresetLibrary {
  private database: Promise<IDBDatabase> | null = null;
  private connection: IDBDatabase | null = null;
  private disposed = false;
  private transactions = new Set<IDBTransaction>();
  private channel: BroadcastChannel | null = null;
  private listeners = new Set<() => void>();
  private generation = 0;
  private state: BrushLibrarySnapshot = Object.freeze({presets: Object.freeze([]), loaded: false, error: null});
  private refresh = () => { if (this.database && !this.disposed) void this.reload(); };
  constructor() { if (typeof window !== 'undefined') window.addEventListener('focus', this.refresh); }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(records: StoredRecord[], error: string | null = null) {
    this.state = {loaded: true, error, presets: records.map(record => Object.freeze({preset: new BrushPreset(record.preset,record.source), revision: record.revision}))};
    Object.freeze(this.state.presets); Object.freeze(this.state);
    this.listeners.forEach(listener => listener());
  }
  private fail(error: unknown) {
    if (this.disposed) return;
    this.state = Object.freeze({...this.state, loaded: true, error: error instanceof z.ZodError ? 'Saved brush data is invalid. Existing records were preserved; download a recovery backup before resetting.' : storageErrorMessage(error)});
    this.listeners.forEach(listener => listener());
  }
  private open(): Promise<IDBDatabase> {
    if (this.disposed) return Promise.reject(new Error('The brush library is closed.'));
    if (this.database) return this.database;
    const pending = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('Browser storage is unavailable. Download your current brush to keep it.')); return; }
      const request = indexedDB.open(DATABASE, 1); let rejected = false;
      request.onupgradeneeded = () => request.result.createObjectStore('presets', {keyPath: 'id'});
      request.onerror = () => { rejected = true; reject(request.error ?? new Error('Brush storage could not be opened.')); };
      request.onblocked = () => { rejected = true; reject(new Error('Brush storage is waiting for another tab. Close older Canoli tabs and retry.')); };
      request.onsuccess = () => {
        const database = request.result;
        if (rejected) { database.close(); return; }
        if (this.disposed) { database.close(); reject(new Error('The brush library is closed.')); return; }
        this.connection = database;
        database.onversionchange = () => { database.close(); this.connection = null; this.database = null; this.fail(new Error('Brush storage changed in another tab. Retry loading the library.')); };
        if (!this.channel && typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
          try {
            this.channel = new BroadcastChannel(DATABASE);
            this.channel.onmessage = () => { void this.reload(); };
          } catch { /* Preferences still persist; focusing the tab refreshes them. */ }
        }
        resolve(database);
      };
    });
    this.database = pending;
    void pending.catch(() => { if (this.database === pending) this.database = null; });
    return pending;
  }
  private async runTransaction<T>(mode: IDBTransactionMode,
    operation: (raw: unknown[], store: IDBObjectStore) => T, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    const database = await this.open(); signal?.throwIfAborted();
    if (this.disposed) throw new Error('The brush library is closed.');
    return new Promise((resolve, reject) => {
      const tx = database.transaction('presets', mode), store = tx.objectStore('presets');
      this.transactions.add(tx); let failure: unknown, result: T;
      const abort = () => { failure = signal?.reason ?? new DOMException('Cancelled', 'AbortError'); try { tx.abort(); } catch { /* Already finished. */ } };
      signal?.addEventListener('abort', abort, {once:true});
      const cleanup = () => { this.transactions.delete(tx); signal?.removeEventListener('abort', abort); };
      tx.onabort = () => { cleanup(); reject(failure ?? tx.error ?? new Error('Brush storage transaction failed. Saved presets were preserved.')); };
      tx.onerror = () => { failure ??= tx.error; };
      tx.oncomplete = () => { cleanup(); resolve(result); };
      const request = store.getAll();
      request.onsuccess = () => {
        try { signal?.throwIfAborted(); result = operation(request.result, store); }
        catch (error) { failure ??= error; try { tx.abort(); } catch { /* A cancellation may already have aborted it. */ } }
      };
    });
  }
  /** Keep the native write lock while binary verification awaits; queue writes only in an active request callback. */
  private async preparedTransaction<T>(prepare:(raw:unknown[],signal:AbortSignal)=>Promise<{result:T;commit(store:IDBObjectStore):void}>,signal?:AbortSignal):Promise<T>{
    signal?.throwIfAborted();const database=await this.open();signal?.throwIfAborted();if(this.disposed)throw new Error('The brush library is closed.');
    return new Promise((resolve,reject)=>{
      const tx=database.transaction('presets','readwrite'),store=tx.objectStore('presets'),abort=new AbortController();this.transactions.add(tx);
      let failure:unknown,result:T,ready:{ok:true;value:{result:T;commit(store:IDBObjectStore):void}}|{ok:false;error:unknown}|null=null;
      const stop=(cause:unknown)=>{failure=cause;abort.abort(cause);try{tx.abort();}catch{/* Already terminal. */}};
      const cancel=()=>stop(signal?.reason??new DOMException('Cancelled','AbortError'));
      const cleanup=()=>{this.transactions.delete(tx);signal?.removeEventListener('abort',cancel);};
      signal?.addEventListener('abort',cancel,{once:true});
      tx.onabort=()=>{cleanup();abort.abort(failure??tx.error);reject(failure??tx.error??new Error('Brush storage transaction failed. Saved data was preserved.'));};
      tx.onerror=()=>{failure??=tx.error;};tx.oncomplete=()=>{cleanup();resolve(result);};
      const pump=()=>{
        try{const tick=store.count();tick.onsuccess=()=>{
          try{abort.signal.throwIfAborted();if(ready){if(!ready.ok)throw ready.error;result=ready.value.result;ready.value.commit(store);}else pump();}
          catch(cause){stop(cause);}
        };}catch(cause){stop(cause);}
      };
      const request=store.getAll();request.onsuccess=()=>{
        try{abort.signal.throwIfAborted();void prepare(request.result,abort.signal).then(value=>ready={ok:true,value},error=>ready={ok:false,error});pump();}
        catch(cause){stop(cause);}
      };
    });
  }
  private async checkedRecords(raw:unknown[],signal?:AbortSignal){
      const records = new Map<string, StoredRecord>();
      for (const value of raw) { signal?.throwIfAborted();const record = recordSchema.parse(value);if(record.source)record.source=await verifyPresetSource(record.source,signal);records.set(record.id, record); }
      return records;
  }
  private async transaction<T>(mode: IDBTransactionMode, operation: (records: Map<string, StoredRecord>) => T,
    signal?: AbortSignal): Promise<{records: StoredRecord[]; result: T}> {
    if(mode==='readonly'){
      const raw=await this.runTransaction('readonly',values=>values,signal),records=await this.checkedRecords(raw,signal);
      return {records:[...records.values()],result:operation(records)};
    }
    return this.preparedTransaction(async(raw,activeSignal)=>{
      const records=await this.checkedRecords(raw,activeSignal);
      const previous=new Map(records);
      const result = operation(records);
      return {result:{records:[...records.values()],result},commit(store){
        for(const id of previous.keys())if(!records.has(id)){activeSignal.throwIfAborted();store.delete(id);}
        for(const [id,record] of records)if(previous.get(id)!==record){activeSignal.throwIfAborted();if(previous.has(id))store.put(record);else store.add(record);}
      }};
    }, signal);
  }
  async reload(): Promise<void> {
    const generation = ++this.generation;
    try { const {records} = await this.transaction('readonly', () => undefined); if (generation === this.generation && !this.disposed) this.publish(records); }
    catch (error) { if (generation === this.generation) this.fail(error instanceof z.ZodError ? error : new Error(`Brush library could not be read. Saved data was preserved. ${storageErrorMessage(error)}`)); }
  }
  private async mutate<T>(operation: (records: Map<string, StoredRecord>) => T, signal?: AbortSignal): Promise<T> {
    ++this.generation;
    try {
      const {records, result} = await this.transaction('readwrite', operation, signal);
      if (!this.disposed) { this.publish(records); try { this.channel?.postMessage('changed'); } catch { /* The committed save remains valid; focus refresh handles missed hints. */ } }
      return result;
    } catch (error) {
      // A conflict/failed write never replaces cached successful values or persisted bytes.
      if (!signal?.aborted) { this.fail(error); if (error instanceof z.ZodError) throw new Error(this.state.error ?? 'Saved brush data is invalid.'); } throw error;
    }
  }
  async save(preset: BrushPreset, expectedRevision = 0, signal?: AbortSignal): Promise<SavedBrushPreset> {
    const owned = new BrushPreset(preset.toJSON(),preset.source);
    if (owned.id.startsWith('canoli.')) throw new Error('Duplicate a built-in preset before saving it to your library.');
    if(owned.source)await verifyPresetSource(owned.source,signal);
    return this.mutate(records => {
      const current = records.get(owned.id);
      if ((current?.revision ?? 0) !== expectedRevision) throw new Error('This preset changed in another tab. Reload it before updating.');
      const revision = (current?.revision ?? 0) + 1;
      const record = recordSchema.parse({id: owned.id, revision, preset: owned.toJSON(),...(owned.source?{source:owned.source}:{})}); records.set(record.id, record);
      return Object.freeze({preset: owned, revision});
    }, signal);
  }
  async remove(id: string, expectedRevision: number, signal?: AbortSignal): Promise<void> {
    await this.mutate(records => {
      const current = records.get(id);
      if (!current || current.revision !== expectedRevision) throw new Error('This preset changed in another tab. Reload it before deleting.');
      records.delete(id);
    }, signal);
  }
  async importJson(text: string, signal?: AbortSignal): Promise<readonly SavedBrushPreset[]> {
    const imported = parseBrushPresets(text).map(preset => preset.duplicate(preset.name));
    return this.importValues(imported,signal);
  }
  async importFile(file:Blob,signal?:AbortSignal):Promise<readonly SavedBrushPreset[]>{
    const imported=(await parseBrushPack(file,signal)).map(preset=>preset.duplicate(preset.name));signal?.throwIfAborted();return this.importValues(imported,signal);
  }
  private async importValues(imported:BrushPreset[],signal?:AbortSignal){
    return this.mutate(records => {
      const added = imported.map(preset => {
        if (records.has(preset.id)) throw new Error('A preset ID collision prevented the import. Retry.');
        const record = {id:preset.id, revision:1, preset:preset.toJSON(),...(preset.source?{source:preset.source}:{})}; records.set(record.id, record);
        return Object.freeze({preset, revision:1});
      });
      return Object.freeze(added);
    }, signal);
  }
  /** Raw backup is data only, including invalid records; it never installs a preset. */
  exportRecoveryJson(signal?: AbortSignal): Promise<string> {
    return this.runTransaction('readonly', records => serializeBrushRecovery(records), signal);
  }
  async exportRecoveryFile(signal?:AbortSignal):Promise<Blob>{
    const raw=await this.runTransaction('readonly',values=>values,signal);return (await prepareBrushRecovery(raw,signal)).blob;
  }
  async resetFromRecoveryFile(file:Blob,signal?:AbortSignal):Promise<void>{
    const expected=(await prepareBrushRecovery(await parseBrushRecoveryFile(file,signal),signal)).fingerprint;++this.generation;
    try{
      await this.preparedTransaction(async(raw,activeSignal)=>{
        const actual=(await prepareBrushRecovery(raw,activeSignal)).fingerprint;
        if(actual!==expected)throw new Error('The library changed after this backup. Download a fresh recovery backup before resetting.');
        return {result:undefined,commit:store=>{activeSignal.throwIfAborted();store.clear();}};
      },signal);
      if(!this.disposed){this.publish([]);try{this.channel?.postMessage('changed');}catch{/* Focus refresh remains available. */}}
    }catch(error){if(!signal?.aborted)this.fail(error);throw error;}
  }
  /** Explicit recovery action; refuses to erase records changed after the backup. */
  async resetFromBackup(backup: string, signal?: AbortSignal): Promise<void> {
    const expected = serializeBrushRecovery(parseBrushRecovery(backup));
    ++this.generation;
    try {
      await this.runTransaction('readwrite', (records, store) => {
        if (serializeBrushRecovery(records) !== expected) throw new Error('The library changed after this backup. Download a fresh recovery backup before resetting.');
        store.clear();
      }, signal);
      if (!this.disposed) { this.publish([]); try { this.channel?.postMessage('changed'); } catch { /* Focus refresh remains available. */ } }
    } catch (error) { if (!signal?.aborted) { this.fail(error); if (error instanceof z.ZodError) throw new Error(this.state.error ?? 'Saved brush data is invalid.'); } throw error; }
  }
  exportJson(ids?: readonly string[]): string {
    const requested = ids ? new Set(ids) : null;
    const values = this.state.presets.filter(value => !requested || requested.has(value.preset.id));
    if (requested && values.length !== requested.size) throw new Error('A requested brush preset is unavailable. Reload the library.');
    return exportBrushPresets(values.map(value => value.preset));
  }
  async exportFile(ids?:readonly string[],signal?:AbortSignal):Promise<Blob>{
    const requested=ids?new Set(ids):null,values=this.state.presets.filter(value=>!requested||requested.has(value.preset.id));
    if(requested&&values.length!==requested.size)throw new Error('A requested brush preset is unavailable. Reload the library.');
    return exportBrushPack(values.map(value=>value.preset),signal);
  }
  dispose() {
    this.disposed = true; ++this.generation;
    for (const tx of this.transactions) { try { tx.abort(); } catch { /* Already finished. */ } }
    this.transactions.clear(); this.connection?.close(); this.channel?.close(); this.listeners.clear();
    if (typeof window !== 'undefined') window.removeEventListener('focus', this.refresh);
  }
}
