import {batchPreparationSchema} from './schema';
import type {BatchPreparation} from './types';
import {rawBlobHash} from '../../core/interchange/raw/source';
import { z } from "zod";
/**
 * Persistent Storage for Batch Runs, Checkpoints, and Deliverable Blobs.
 *
 * Backed by IndexedDB in the browser with automatic in-memory fallback
 * for headless/Node test environments.
 */

import type {
  BatchItemReviewState,
  BatchRun,
  DeliveryDeliverable,
} from "./types";

const req = <T>(r: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error("IndexedDB request failed"));
  });

const txComplete = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
    tx.onerror = () => reject(tx.error ?? new Error("Transaction error"));
  });

// Validate reference-bearing fields before deciding that any blob is unused.
const referenceSchema = z.object({
  id: z.string().min(1),
  config: z.object({ variants: z.array(z.object({ id: z.string().min(1) })) }),
  items: z.array(
    z.object({
      id: z.string().min(1),
      deliverables: z.array(z.object({ id: z.string().min(1) })),
      preparation:batchPreparationSchema.optional(),
    }),
  ),
});
function referencedBlobKeys(runs: unknown[]): Set<string> {
  const keys = new Set<string>();
  for (const value of runs) {
    const run = referenceSchema.parse(value);
    for (const item of run.items) {
      keys.add(`src-${item.id}`);
      if(item.preparation)keys.add(`prepared-${item.id}`);
      item.deliverables.forEach((delivery) => keys.add(delivery.id));
      // Retain legacy outputs written before their per-variant checkpoint.
      run.config.variants.forEach((variant) =>
        keys.add(`${item.id}:${variant.id}`),
      );
    }
  }
  return keys;
}

export class BatchStorage {
  private memRuns = new Map<string, BatchRun>();
  private memBlobs = new Map<string, Blob>();
  private dbPromise?: Promise<IDBDatabase | null>;

  private async getDb(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === "undefined") {
      if (typeof window !== "undefined")
        throw new Error("Batch storage is unavailable in this browser.");
      return null; // Explicit headless-only memory backend.
    }
    if (!this.dbPromise) {
      this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("luma-batch-storage", 2);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("runs"))
            db.createObjectStore("runs", { keyPath: "id" });
          if (!db.objectStoreNames.contains("blobs"))
            db.createObjectStore("blobs");
        };
        let blocked=false;
        request.onblocked=()=>{blocked=true;reject(new Error('Close older Canoli Studio batch tabs before upgrading batch storage.'));};
        request.onsuccess = () => {
          if(blocked){request.result.close();return;}
          request.result.onversionchange=()=>{request.result.close();this.dbPromise=undefined;};
          resolve(request.result);
        };
        request.onerror = () =>
          reject(request.error ?? new Error("Unable to open batch storage."));
      }).catch((error) => {
        this.dbPromise = undefined;
        throw error;
      });
    }
    return this.dbPromise;
  }

  private async write(
    store: string,
    value: unknown,
    key?: string,
    remove = false,
  ): Promise<void> {
    const db = await this.getDb();
    if (!db) return;
    const tx = db.transaction(store, "readwrite");
    const done = txComplete(tx);
    try {
      const objectStore = tx.objectStore(store);
      if (remove) objectStore.delete(key!);
      else if (key === undefined) objectStore.put(value);
      else objectStore.put(value, key);
    } catch (error) {
      tx.abort();
      await done.catch(() => {});
      throw error;
    }
    await done;
  }

  /** Publish a new run and its source bytes together; never overwrite an existing run. */
  async createRun(run: BatchRun): Promise<void> {
    const clone = structuredClone(run);
    const sources = clone.items.flatMap((item) =>
      item.source.blob
        ? [{ key: `src-${item.id}`, blob: item.source.blob }]
        : [],
    );
    for (const item of clone.items) {
      delete item.source.blob;
      for (const delivery of item.deliverables) delete delivery.blob;
    }
    const db = await this.getDb();
    if (!db) {
      if (this.memRuns.has(clone.id))
        throw new Error("Batch run already exists.");
      for (const source of sources) this.memBlobs.set(source.key, source.blob);
      this.memRuns.set(clone.id, clone);
      return;
    }
    const tx = db.transaction(["runs", "blobs"], "readwrite", {
      durability: "strict",
    });
    const done = txComplete(tx);
    try {
      for (const source of sources)
        tx.objectStore("blobs").add(source.blob, source.key);
      tx.objectStore("runs").add(clone);
    } catch (error) {
      tx.abort();
      await done.catch(() => {});
      throw error;
    }
    await done;
  }

  async saveRun(run: BatchRun): Promise<void> {
    const clone = structuredClone(run);
    for (const item of clone.items) {
      delete item.source.blob;
      for (const delivery of item.deliverables) delete delivery.blob;
    }
    await this.write("runs", clone);
    this.memRuns.set(run.id, clone);
  }

  async getRun(id: string): Promise<BatchRun | null> {
    const db = await this.getDb();
    if (!db) return structuredClone(this.memRuns.get(id) ?? null);
    const tx = db.transaction("runs", "readonly");
    return (await req(tx.objectStore("runs").get(id))) ?? null;
  }

  async listRuns(): Promise<BatchRun[]> {
    const db = await this.getDb();
    if (!db) return structuredClone([...this.memRuns.values()]);
    const tx = db.transaction("runs", "readonly");
    return await req(tx.objectStore("runs").getAll());
  }

  /** Explicit reclamation, serialized with run creation, deletion and output publication. */
  async reclaimUnusedBlobs(): Promise<{
    removedCount: number;
    removedBytes: number;
  }> {
    const db = await this.getDb();
    const result = { removedCount: 0, removedBytes: 0 };
    if (!db) {
      const retained = referencedBlobKeys([...this.memRuns.values()]);
      for (const [key, blob] of this.memBlobs)
        if (!retained.has(key)) {
          result.removedCount++;
          result.removedBytes += blob.size;
          this.memBlobs.delete(key);
        }
      return result;
    }
    const tx = db.transaction(["runs", "blobs"], "readwrite", {
      durability: "strict",
    });
    const done = txComplete(tx);
    let failure: unknown;
    const runs = tx.objectStore("runs").getAll();
    runs.onsuccess = () => {
      try {
        const retained = referencedBlobKeys(runs.result);
        const request = tx.objectStore("blobs").openCursor();
        request.onsuccess = () => {
          try {
            const cursor = request.result;
            if (!cursor) return;
            if (
              !(cursor.value instanceof Blob) ||
              typeof cursor.key !== "string"
            )
              throw new Error("Invalid batch blob record; cleanup cancelled.");
            if (!retained.has(cursor.key)) {
              result.removedCount++;
              result.removedBytes += cursor.value.size;
              cursor.delete();
            }
            cursor.continue();
          } catch (error) {
            failure = error;
            tx.abort();
          }
        };
      } catch (error) {
        failure = error;
        tx.abort();
      }
    };
    try {
      await done;
    } catch (error) {
      throw failure ?? error;
    }
    this.memBlobs.clear();
    return result;
  }

  async deleteRun(id: string): Promise<void> {
    const db = await this.getDb();
    const keys = (run: BatchRun): string[] =>
      run.items.flatMap((item) => [
        `src-${item.id}`,
        `prepared-${item.id}`,
        ...item.deliverables.map((delivery) => delivery.id),
        ...run.config.variants.map((variant) => `${item.id}:${variant.id}`),
      ]);
    if (!db) {
      const run = this.memRuns.get(id);
      if (run) for (const key of keys(run)) this.memBlobs.delete(key);
      this.memRuns.delete(id);
      return;
    }
    const tx = db.transaction(["runs", "blobs"], "readwrite");
    const done = txComplete(tx);
    const request = tx.objectStore("runs").get(id);
    request.onsuccess = () => {
      if (request.result) {
        for (const key of keys(request.result))
          tx.objectStore("blobs").delete(key);
        tx.objectStore("runs").delete(id);
      }
    };
    await done;
    this.memRuns.delete(id);
    // Browser operations read IndexedDB; do not retain deleted source/output bytes.
    this.memBlobs.clear();
  }

  /** Publish a verified scene and its pointer atomically before any variant is delivered. */
  async commitPreparation(runId:string,itemId:string,blob:Blob,metadata:BatchPreparation):Promise<void>{
    const preparation=batchPreparationSchema.parse(metadata);
    if(blob.size!==preparation.byteLength||await rawBlobHash(blob)!==preparation.sha256)throw new Error('Prepared project integrity verification failed.');
    const attach=(run:BatchRun|undefined)=>{
      const item=run?.items.find(value=>value.id===itemId);
      if(!run||!item||run.status==='cancelled'||item.status!=='running')throw new Error('Batch item is no longer accepting preparation.');
      if(item.preparation)throw new Error('Batch item already has an accepted prepared scene.');
      item.preparation=preparation;run.updatedAt=new Date().toISOString();
    };
    const db=await this.getDb(),key=`prepared-${itemId}`;
    if(!db){const run=structuredClone(this.memRuns.get(runId));attach(run);this.memRuns.set(runId,run!);this.memBlobs.set(key,blob);return;}
    const tx=db.transaction(['runs','blobs'],'readwrite',{durability:'strict'}),done=txComplete(tx);let failure:unknown;
    const request=tx.objectStore('runs').get(runId);
    request.onsuccess=()=>{try{attach(request.result);tx.objectStore('blobs').add(blob,key);tx.objectStore('runs').put(request.result);}catch(error){failure=error;tx.abort();}};
    try{await done;}catch(error){throw failure??error;}
  }

  async commitDeliverable(
    runId: string,
    itemId: string,
    delivery: DeliveryDeliverable,
  ): Promise<void> {
    if (!delivery.blob) throw new Error("Deliverable has no encoded bytes.");
    const blob = delivery.blob;
    const metadata = { ...delivery };
    delete metadata.blob;
    const attach = (run: BatchRun | undefined) => {
      const item = run?.items.find((candidate) => candidate.id === itemId);
      if (
        !run ||
        !item ||
        run.status === "cancelled" ||
        item.status !== "running"
      ) {
        throw new Error("Batch item is no longer accepting outputs.");
      }
      item.deliverables = [
        ...item.deliverables.filter(
          (entry) => entry.variantId !== metadata.variantId,
        ),
        metadata,
      ];
      run.updatedAt = new Date().toISOString();
    };
    const db = await this.getDb();
    if (!db) {
      const run = structuredClone(this.memRuns.get(runId));
      attach(run);
      this.memRuns.set(runId, run!);
      this.memBlobs.set(delivery.id, blob);
      return;
    }
    const tx = db.transaction(["runs", "blobs"], "readwrite");
    const done = txComplete(tx);
    let failure: unknown;
    const request = tx.objectStore("runs").get(runId);
    request.onsuccess = () => {
      try {
        attach(request.result);
        tx.objectStore("blobs").put(blob, delivery.id);
        tx.objectStore("runs").put(request.result);
      } catch (error) {
        failure = error;
        tx.abort();
      }
    };
    try {
      await done;
    } catch (error) {
      throw failure ?? error;
    }
  }

  async saveDeliverableBlob(id: string, blob: Blob): Promise<void> {
    await this.write("blobs", blob, id);
    this.memBlobs.set(id, blob);
  }

  async getDeliverableBlob(id: string): Promise<Blob | null> {
    const db = await this.getDb();
    if (!db) return this.memBlobs.get(id) ?? null;
    const tx = db.transaction("blobs", "readonly");
    return (await req(tx.objectStore("blobs").get(id))) ?? null;
  }

  async deleteDeliverableBlob(id: string): Promise<void> {
    await this.write("blobs", undefined, id, true);
    this.memBlobs.delete(id);
  }

  /** The callback must be synchronous so the read/write transaction stays active. */
  async updateRun(
    runId: string,
    update: (run: BatchRun) => void,
  ): Promise<BatchRun> {
    const db = await this.getDb();
    if (!db) {
      const run = structuredClone(this.memRuns.get(runId));
      if (!run) throw new Error(`Batch run '${runId}' not found.`);
      update(run);
      this.memRuns.set(runId, structuredClone(run));
      return run;
    }
    const tx = db.transaction("runs", "readwrite");
    const done = txComplete(tx);
    let updated: BatchRun | undefined;
    let failure: unknown;
    const request = tx.objectStore("runs").get(runId);
    request.onsuccess = () => {
      try {
        if (!request.result) throw new Error(`Batch run '${runId}' not found.`);
        updated = request.result as BatchRun;
        update(updated);
        tx.objectStore("runs").put(updated);
      } catch (error) {
        failure = error;
        tx.abort();
      }
    };
    try {
      await done;
    } catch (error) {
      throw failure ?? error;
    }
    return updated!;
  }

  async updateItemReviewState(
    runId: string,
    itemId: string,
    reviewState: BatchItemReviewState,
    reviewNotes?: string,
  ): Promise<void> {
    await this.updateRun(runId, (run) => {
      const item = run.items.find((i) => i.id === itemId);
      if (!item)
        throw new Error(`Item '${itemId}' not found in batch run '${runId}'.`);

      item.reviewState = reviewState;
      if (reviewNotes !== undefined) {
        item.reviewNotes = reviewNotes;
      }

      // Recompute summary review counts
      let approved = 0;
      let rejected = 0;
      let flagged = 0;
      for (const it of run.items) {
        if (it.reviewState === "approved") approved++;
        else if (it.reviewState === "rejected") rejected++;
        else if (it.reviewState === "flagged") flagged++;
      }
      run.summary.approvedCount = approved;
      run.summary.rejectedCount = rejected;
      run.summary.flaggedCount = flagged;
      run.updatedAt = new Date().toISOString();

      run.deliveryManifest = undefined;
    });
  }
}
