import { persistRecovery, listRecoverySummaries, restoreRecovery } from "./recovery-persistence";
import { encodeJsonData } from "./json-encoding";
import { isImmutable } from "./immutable";
import type { ProjectAssetSource } from "./project";
import { referencedAssets, validateDocument } from "./model";
import type { DocumentData } from "./model";
import { serializeProject } from "./project";
import {avifDecodeOptionsSchema,type AvifDecodeSettings} from "./interchange/avif/types";
import { tiffDecodeOptionsSchema, type TiffDecodeSettings } from "./interchange/tiff/types";

export interface RecoveryEntry {
  version?: 2;
  id: string;
  document: DocumentData;
  savedAt: number;
  assetKeys: string[];
  checksum?: string;
  previous?: RecoveryEntry[];
}
export interface RecoveryRestoration { blob: Blob; savedAt: number; skipped: number }

export interface RecoverySummary {
  id: string;
  savedAt: number;
  document: Pick<DocumentData, "name" | "width" | "height">;
}
export interface RecoveryAsset {
  id: string;
  name: string;
  width: number;
  height: number;
  blob: Blob;
  tiff?: TiffDecodeSettings;
  avif?: AvifDecodeSettings;
  checksum?: string;
}
const digest = async (bytes: BufferSource) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
const checkpointBytes = (entry: RecoveryEntry) =>
  encodeJsonData({
    id: entry.id,
    document: entry.document,
    savedAt: entry.savedAt,
    assetKeys: entry.assetKeys,
  });
const checkpointDigest = async (entry: RecoveryEntry) => digest(await checkpointBytes(entry));
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
        ...(asset.tiff ? { tiff: asset.tiff } : {}),
        ...(asset.avif ? { avif: asset.avif } : {}),
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
const complete = (transaction: IDBTransaction, cause?: () => unknown) =>
  new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(
        cause?.() ?? transaction.error ?? new Error("Recovery checkpoint was interrupted."),
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
            "Recovery storage is blocked by another tab. Close older Canoli Studio tabs and retry.",
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

  /** Lightweight display data; full documents stay off the UI thread. */
  summaries(): Promise<RecoverySummary[]> {
    return typeof Worker !== "undefined" ? listRecoverySummaries() : this.readSummaries();
  }

  /** @internal Cursor bounds retained memory to one checkpoint plus display records. */
  async readSummaries(): Promise<RecoverySummary[]> {
    const db = await this.open();
    const tx = db.transaction("checkpoints", "readonly");
    const done = complete(tx);
    const summaries: RecoverySummary[] = [];
    const cursor = tx.objectStore("checkpoints").openCursor();
    cursor.onsuccess = () => {
      const row = cursor.result;
      if (!row) return;
      const entry = row.value as RecoveryEntry;
      summaries.push({ id: entry.id, savedAt: entry.savedAt, document: {
        name: entry.document.name, width: entry.document.width, height: entry.document.height,
      } });
      row.continue();
    };
    await done;
    return summaries.sort((a, b) => b.savedAt - a.savedAt);
  }

  async save(
    id: string,
    document: DocumentData,
    assets: ProjectAssetSource,
  ): Promise<number> {
    validateDocument(document);
    // Store-owned revisions already remain stable across awaits and later edits.
    // External callers still require an owned snapshot, even if shallow-frozen.
    if (!isImmutable(document)) document = structuredClone(document);
    // Capture original blobs before yielding: switching documents can dispose the live store.
    const originals = [...referencedAssets(document)].map((assetId) => {
      const asset = assets.get(assetId);
      if(asset.blob.type==="image/avif"&&!asset.avif)throw new Error("AVIF recovery requires saved precision and color settings.");
      if (asset.blob.type === "image/tiff" && !asset.tiff)
        throw new Error("TIFF recovery requires saved page and precision settings.");
      return {
        id: asset.id,
        name: asset.name,
        width: asset.width,
        height: asset.height,
        blob: asset.blob,
        ...(asset.tiff ? { tiff: tiffDecodeOptionsSchema.parse(asset.tiff) } : {}),
        ...(asset.avif ? { avif: avifDecodeOptionsSchema.parse(asset.avif) } : {}),
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
    const bytes = await checkpointBytes(entry);
    entry.checksum = await digest(bytes);
    // Transfer the existing encoding, never clone the large document graph on the UI thread.
    if (bytes.byteLength >= 256 * 1024 && typeof Worker !== "undefined")
      return persistRecovery(bytes, entry.checksum, checked);
    return this.persist(entry, checked);
  }

  /** @internal Shared atomic storage path for the UI and persistence worker. */
  async persist(entry: RecoveryEntry, checked: RecoveryAsset[]): Promise<number> {
    const { id, assetKeys, savedAt } = entry;
    const db = await this.open();
    const tx = db.transaction(["checkpoints", "assets"], "readwrite", {
      durability: "strict",
    });
    let failure: unknown;
    const done = complete(tx, () => failure);
    const fail = (error: unknown) => {
      failure ??= error;
      try { tx.abort(); } catch { /* An existing abort still reports the original cause. */ }
    };
    const guard = (run: () => void) => () => { try { run(); } catch (error) { fail(error); } };
    try {
      const store = tx.objectStore("assets");
      const old = tx.objectStore("checkpoints").get(id);
      old.onsuccess = guard(() => {
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
      });
      checked.forEach((asset, index) => {
        const key = assetKeys[index];
        const existing = store.getKey(key);
        existing.onsuccess = guard(() => {
          if (existing.result === undefined) store.put(asset, key);
        });
      });
    } catch (error) { fail(error); }
    await done;
    return savedAt;
  }

  async project(id: string): Promise<Blob> {
    return (await this.restore(id)).blob;
  }

  restore(id: string): Promise<RecoveryRestoration> {
    return typeof Worker !== "undefined" ? restoreRecovery(id) : this.readRestoration(id);
  }

  /** @internal Integrity checks and project encoding execute within the recovery worker. */
  async readRestoration(id: string): Promise<RecoveryRestoration> {
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
    let missingTiffSettings = false,missingAvifSettings=false;
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
          if(asset.blob.type==="image/avif"&&!asset.avif){missingAvifSettings=true;throw new Error("Missing AVIF recovery settings.");}
          if (asset.blob.type === "image/tiff" && !asset.tiff) {
            missingTiffSettings = true;
            throw new Error("Missing TIFF recovery settings.");
          }
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
      "No intact recovery checkpoint remains. The current document is unchanged." +
      (missingTiffSettings ? " A TIFF source is missing its saved page and precision settings." : "")+
      (missingAvifSettings ? " An AVIF source is missing its saved precision and color settings." : ""),
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
