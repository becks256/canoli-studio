/** A private job-owned backing store. No document/library/recovery records live here. */
export type WetTile = Uint8ClampedArray | Float32Array;
export type WetTileChange = {type:'put';key:string;value:WetTile}|{type:'remove';key:string};
export interface WetTileStore {
  get(key: string): Promise<WetTile | undefined>;
  put(key: string, value: WetTile): Promise<void>;
  remove(key: string): Promise<void>;
  /** Optional atomic native write group; custom stores retain sequential fallback. */
  batch?(changes:readonly WetTileChange[]):Promise<void>;
  dispose(): Promise<void>;
}

const nativeStores=new WeakMap<WetTileStore,{methods:Pick<WetTileStore,'get'|'put'|'remove'|'batch'|'dispose'>;available():boolean;claimed:boolean;check():void}>();
const nativeMethods=['get','put','remove','batch','dispose'] as const;
/** Read-only lifetime check, including write-through native owners. */
export function assertWetTileStoreAlive(store: WetTileStore): void { nativeStores.get(store)?.check(); }
/** Only a fresh, unchanged native owner can keep unpublished working data in RAM. */
export function claimResidentWetStore(store:WetTileStore):boolean{
 const owner=nativeStores.get(store);
 if(!owner||owner.claimed||!owner.available()||!nativeMethods.every(key=>store[key]===owner.methods[key]))return false;
 owner.claimed=true;return true;
}
export function assertResidentWetStore(store:WetTileStore):void{
 const owner=nativeStores.get(store);if(!owner)throw new Error('Wet working cache requires a fresh native store.');owner.check();
 if(!nativeMethods.every(key=>store[key]===owner.methods[key]))throw new Error('Wet working storage changed during preparation.');
}

const jobName = /^canoli-wet-job-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const defaultLocks = () => typeof navigator === 'undefined' ? undefined : navigator.locks;
function removeDatabase(factory: IDBFactory, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const remove = factory.deleteDatabase(name);
    remove.onsuccess = () => resolve();
    remove.onerror = () => reject(remove.error ?? new Error('Could not remove wet-paint working storage.'));
    remove.onblocked = () => reject(new Error('Wet-paint working storage cleanup is blocked by another connection.'));
  });
}

/** Web Locks release with their owning context, allowing the next preparation
 * to reap crashed jobs without touching a live job in another tab/worker.
 * Browsers without locks/database enumeration retain the explicit dispose path. */
export async function cleanupWetTileStores(factory: IDBFactory, locks: LockManager | undefined = defaultLocks()): Promise<void> {
  if (!locks || typeof factory.databases !== 'function') return;
  const entries = await factory.databases();
  for (const { name } of entries) if (name && jobName.test(name)) await locks.request(name, { mode: 'exclusive', ifAvailable: true }, async lock => { if (lock) await removeDatabase(factory, name); });
}

async function holdJob(locks: LockManager | undefined, name: string): Promise<() => Promise<void>> {
  if (!locks) return async () => {};
  let release!: () => void;
  const finished = new Promise<void>(resolve => { release = resolve; });
  let ready!: () => void, fail!: (error: unknown) => void;
  const acquired = new Promise<void>((resolve, reject) => { ready = resolve; fail = reject; });
  const pending = locks.request(name, { mode: 'exclusive' }, async lock => { if (!lock) throw new Error('Could not own wet-paint working storage.'); ready(); await finished; });
  void pending.catch(fail);
  await acquired;
  return async () => { release(); await pending; };
}

/** IndexedDB supplies backing storage independently of the resident tile cache.
 * A unique database belongs to one preparation/result and is deleted on dispose.
 * Storage failures reject the job; they never resize or cap original artwork. */
export async function createWetTileStore(factory: IDBFactory | undefined = typeof indexedDB === 'undefined' ? undefined : indexedDB): Promise<WetTileStore> {
  if (!factory) throw new Error('Wet-paint preparation requires private IndexedDB working storage in this browser.');
  const name = `canoli-wet-job-${crypto.randomUUID()}`;
  const locks = defaultLocks();
  await cleanupWetTileStores(factory, locks);
  const release = await holdJob(locks, name);
  let database: IDBDatabase,created=false;
  try { database = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = factory.open(name, 1);
    open.onupgradeneeded = () => {created=true;open.result.createObjectStore('tiles');};
    open.onerror = () => reject(open.error ?? new Error('Could not open wet-paint working storage.'));
    open.onsuccess = () => resolve(open.result);
  }); } catch (error) {
    try { await removeDatabase(factory, name); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Wet-paint working storage could not be opened or cleaned.'); }
    finally { await release(); }
    throw error;
  }
  let closed = false, used = false, failure: Error | null = null, disposal: Promise<void> | undefined;
  database.onversionchange = () => { failure = new Error('Wet-paint working storage changed.'); database.close(); };
  const request = <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    used = true;
    if (closed || failure) return Promise.reject(failure ?? new Error('Wet-paint working storage is closed.'));
    return new Promise((resolve, reject) => {
      let transaction: IDBTransaction;
      try { transaction = database.transaction('tiles', mode); } catch (error) { reject(error); return; }
      let result: T;
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(transaction.error ?? new Error('Wet-paint working storage transaction aborted.'));
      transaction.onerror = () => { /* onabort reports the native storage error. */ };
      try {
        const operation = run(transaction.objectStore('tiles'));
        operation.onsuccess = () => { result = operation.result; };
      } catch (error) { transaction.abort(); reject(error); }
    });
  };
  const store:WetTileStore={
    get: key => request('readonly', store => store.get(key)),
    put: async (key, value) => { await request('readwrite', store => store.put(value, key)); },
    remove: async key => { await request('readwrite', store => store.delete(key)); },
    batch:async changes=>{
      if(!changes.length){if(closed||failure)throw failure??new Error('Wet-paint working storage is closed.');return;}
      await request('readwrite',store=>{let last!:IDBRequest;for(const change of changes)last=change.type==='put'?store.put(change.value,change.key):store.delete(change.key);return last;});
    },
    dispose() {
      if (disposal) return disposal;
      closed = true; database.close();
      return disposal = (async () => { try { await removeDatabase(factory, name); } finally { await release(); } })();
    },
  };
  if(created&&typeof indexedDB!=='undefined'&&factory===indexedDB)nativeStores.set(store,{methods:Object.fromEntries(nativeMethods.map(key=>[key,store[key]])) as Pick<WetTileStore,'get'|'put'|'remove'|'batch'|'dispose'>,available:()=>!closed&&!failure&&!used,claimed:false,check:()=>{if(closed||failure)throw failure??new Error('Wet-paint working storage is closed.');}});
  return store;
}
