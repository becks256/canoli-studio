import type { ProjectAssetSource } from "./project";
import { referencedAssets, validateDocument } from "./model";
import type { DocumentData } from "./model";
import { serializeProject } from "./project";

export interface RecoveryEntry {
  version?: 2;
  id: string;
  document: DocumentData;
  savedAt: number;
  assetKeys: string[];
  checksum?: string;
  previous?: RecoveryEntry[];
}
interface RecoveryAsset {
  id: string;
  name: string;
  width: number;
  height: number;
  blob: Blob;
  checksum?: string;
}
const digest = async (bytes: BufferSource) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
const checkpointDigest = (entry: RecoveryEntry) =>
  digest(
    new TextEncoder().encode(
      JSON.stringify({
        id: entry.id,
        document: entry.document,
        savedAt: entry.savedAt,
        assetKeys: entry.assetKeys,
      }),
    ),
  );
const blobHashes = new WeakMap<Blob, Promise<string>>();
function blobDigest(blob: Blob): Promise<string> {
  let hash = blobHashes.get(blob);
  if (!hash) {
    hash = blob.arrayBuffer().then(digest);
    blobHashes.set(blob, hash);
  }
  return hash;
}
async function assetDigest(asset: RecoveryAsset): Promise<string> {
  return digest(
    new TextEncoder().encode(
      JSON.stringify({
        id: asset.id,
        name: asset.name,
        width: asset.width,
        height: asset.height,
        type: asset.blob.type,
        bytes: await blobDigest(asset.blob),
      }),
    ),
  );
}
const checkpoints = (entry: RecoveryEntry) => [
  entry,
  ...(entry.previous ?? []),
];

const request = <T>(value: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () =>
      reject(value.error ?? new Error("Recovery storage request failed."));
  });
const complete = (transaction: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(
        transaction.error ?? new Error("Recovery checkpoint was interrupted."),
      );
    transaction.onerror = () => {}; // Abort reports the final failure; never acknowledge a partial write.
  });

/** Per-session checkpoints: independent tabs never overwrite each other's document. */
export class RecoveryRepository {
  private database?: Promise<IDBDatabase>;
  private open() {
    return (this.database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open("luma-recovery", 2);
      opening.onupgradeneeded = () => {
        const db = opening.result;
        if (!db.objectStoreNames.contains("checkpoints"))
          db.createObjectStore("checkpoints", { keyPath: "id" });
        if (!db.objectStoreNames.contains("assets"))
          db.createObjectStore("assets");
      };
      opening.onsuccess = () => {
        const db = opening.result;
        db.onversionchange = () => {
          db.close();
          this.database = undefined;
        };
        resolve(db);
      };
      opening.onerror = () => {
        this.database = undefined;
        reject(opening.error);
      };
      opening.onblocked = () => {
        this.database = undefined;
        reject(
          new Error(
            "Recovery storage is blocked by another tab. Close older Luma tabs and retry.",
          ),
        );
      };
    }));
  }

  async list(): Promise<RecoveryEntry[]> {
    const db = await this.open();
    const tx = db.transaction("checkpoints", "readonly");
    return (
      (await request(tx.objectStore("checkpoints").getAll())) as RecoveryEntry[]
    ).sort((a, b) => b.savedAt - a.savedAt);
  }

  async save(
    id: string,
    document: DocumentData,
    assets: ProjectAssetSource,
  ): Promise<number> {
    validateDocument(document);
    document = structuredClone(document);
    // Capture original blobs before yielding: switching documents can dispose the live store.
    const originals = [...referencedAssets(document)].map((assetId) => {
      const asset = assets.get(assetId);
      return {
        id: asset.id,
        name: asset.name,
        width: asset.width,
        height: asset.height,
        blob: asset.blob,
      };
    });
    const checked: RecoveryAsset[] = [];
    // Hash sequentially; do not materialize all compressed assets at once.
    for (const asset of originals)
      checked.push({ ...asset, checksum: await assetDigest(asset) });
    const assetKeys = checked.map(
      (asset) => `${id}:${asset.id}:${asset.checksum}`,
    );
    const savedAt = Date.now();
    const entry: RecoveryEntry = {
      version: 2,
      id,
      document,
      assetKeys,
      savedAt,
    };
    entry.checksum = await checkpointDigest(entry);
    const db = await this.open();
    const tx = db.transaction(["checkpoints", "assets"], "readwrite", {
      durability: "strict",
    });
    const done = complete(tx);
    const store = tx.objectStore("assets");
    const old = tx.objectStore("checkpoints").get(id);
    old.onsuccess = () => {
      const previous = old.result as RecoveryEntry | undefined;
      entry.previous = previous
        ? checkpoints(previous)
            .slice(0, 2)
            .map(({ previous: _history, ...snapshot }) => snapshot)
        : [];
      const retained = new Set(
        checkpoints(entry).flatMap((item) => item.assetKeys),
      );
      for (const key of previous
        ? checkpoints(previous).flatMap((item) => item.assetKeys)
        : [])
        if (!retained.has(key)) store.delete(key);
      tx.objectStore("checkpoints").put(entry);
    };
    checked.forEach((asset, index) => {
      const key = assetKeys[index];
      const existing = store.getKey(key);
      existing.onsuccess = () => {
        if (existing.result === undefined) store.put(asset, key);
      };
    });
    await done;
    return savedAt;
  }

  async project(id: string): Promise<Blob> {
    return (await this.restore(id)).blob;
  }

  async restore(
    id: string,
  ): Promise<{ blob: Blob; savedAt: number; skipped: number }> {
    const db = await this.open();
    const tx = db.transaction(["checkpoints", "assets"], "readonly");
    const done = complete(tx);
    const snapshotRequest = new Promise<{
      entry: RecoveryEntry;
      assets: RecoveryAsset[];
    }>((resolve, reject) => {
      const checkpoint = tx.objectStore("checkpoints").get(id);
      checkpoint.onerror = () => reject(checkpoint.error);
      checkpoint.onsuccess = () => {
        const entry = checkpoint.result as RecoveryEntry | undefined;
        if (!entry) {
          reject(new Error("Recovery checkpoint no longer exists."));
          return;
        }
        // Queue all reads within the request callback so they share one consistent transaction.
        Promise.all(
          [
            ...new Set(checkpoints(entry).flatMap((item) => item.assetKeys)),
          ].map((key) => request(tx.objectStore("assets").get(key))),
        ).then((assets) => resolve({ entry, assets }), reject);
      };
    });
    const [snapshot] = await Promise.all([snapshotRequest, done]);
    const keys = [
      ...new Set(checkpoints(snapshot.entry).flatMap((item) => item.assetKeys)),
    ];
    const byKey = new Map(
      keys.map((key, index) => [key, snapshot.assets[index]]),
    );
    const history = checkpoints(snapshot.entry);
    for (let skipped = 0; skipped < history.length; skipped++) {
      const entry = history[skipped];
      try {
        validateDocument(entry.document);
        if (
          (entry.version === 2 || entry.checksum) &&
          (await checkpointDigest(entry)) !== entry.checksum
        )
          throw new Error("Checkpoint checksum mismatch.");
        const recovered = new Map<string, RecoveryAsset>();
        for (const key of entry.assetKeys) {
          const asset = byKey.get(key);
          if (!asset || !(asset.blob instanceof Blob))
            throw new Error("Missing recovery image.");
          if (
            (entry.version === 2 || asset.checksum) &&
            (await assetDigest(asset)) !== asset.checksum
          )
            throw new Error("Image checksum mismatch.");
          recovered.set(asset.id, asset);
        }
        for (const assetId of referencedAssets(entry.document))
          if (!recovered.has(assetId))
            throw new Error("Missing recovery image reference.");
        const blob = await serializeProject(entry.document, {
          get: (key) => recovered.get(key)!,
        });
        return { blob, savedAt: entry.savedAt, skipped };
      } catch {
        // Try the preceding independently validated checkpoint.
      }
    }
    throw new Error(
      "No intact recovery checkpoint remains. The current document is unchanged.",
    );
  }

  async remove(id: string) {
    const db = await this.open();
    const tx = db.transaction(["checkpoints", "assets"], "readwrite");
    const done = complete(tx);
    const checkpoint = tx.objectStore("checkpoints").get(id);
    checkpoint.onsuccess = () => {
      const entry = checkpoint.result as RecoveryEntry | undefined;
      for (const key of entry
        ? checkpoints(entry).flatMap((item) => item.assetKeys)
        : [])
        tx.objectStore("assets").delete(key);
      tx.objectStore("checkpoints").delete(id);
    };
    await done;
  }
}
