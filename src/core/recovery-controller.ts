import { storageErrorMessage } from "./storage-errors";
import type { AssetStore } from "./assets";
import { referencedAssets } from "./model";
import type { DocumentData } from "./model";
import type { ProjectAssetSource } from "./project";
import { RecoveryRepository } from "./recovery";

export interface RecoveryState {
  status: "idle" | "pending" | "saving" | "saved" | "error";
  savedAt: number | null;
  message: string;
}

/** Coalesces committed snapshots; acknowledgement is published only after IDB commit. */
export class RecoveryController {
  readonly repository = new RecoveryRepository();
  private state: RecoveryState = {
    status: "idle",
    savedAt: null,
    message: "Recovery ready",
  };
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending = new Map<
    string,
    { id: string; document: DocumentData; assets: ProjectAssetSource }
  >();
  private failed = new Map<
    string,
    { id: string; document: DocumentData; assets: ProjectAssetSource }
  >();
  private inFlight: Promise<void> | undefined;
  private currentId = "";
  private disposed = false;
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(state: RecoveryState) {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }
  schedule(id: string, document: DocumentData, assets: AssetStore) {
    if (this.disposed) return;
    this.currentId = id;
    let captured;
    try {
      captured = new Map(
        [...referencedAssets(document)].map((key) => [key, assets.get(key)]),
      );
    } catch {
      this.publish({
        ...this.state,
        status: "error",
        message:
          "Recovery unavailable: missing source asset. Save a project backup.",
      });
      return;
    }
    this.failed.delete(id);
    this.pending.set(id, {
      id,
      document,
      assets: { get: (key) => captured.get(key)! },
    });
    this.publish({
      ...this.state,
      status: "pending",
      message: "Recovery pending",
    });
    if (this.timer === undefined)
      this.timer = setTimeout(() => {
        this.timer = undefined;
        void this.flush();
      }, 600);
  }
  reset() {
    this.currentId = "";
    this.publish({ status: "idle", savedAt: null, message: "Recovery ready" });
  }
  async flush(): Promise<void> {
    if (this.disposed) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    // Failed captures are retried once on a subsequent flush, never in a tight loop.
    for (const [id, capture] of this.failed)
      if (!this.pending.has(id)) this.pending.set(id, capture);
    this.failed.clear();
    await this.drain();
  }
  private async drain(): Promise<void> {
    if (this.disposed) return;
    if (this.inFlight) {
      await this.inFlight;
      if (this.pending.size) await this.drain();
      return;
    }
    const next = this.pending.values().next().value;
    if (!next) return;
    this.pending.delete(next.id);
    if (this.currentId === next.id)
      this.publish({
        ...this.state,
        status: "saving",
        message: "Saving recovery…",
      });
    this.inFlight = (async () => {
      try {
        const savedAt = await this.repository.save(
          next.id,
          next.document,
          next.assets,
        );
        if (
          !this.disposed &&
          this.currentId === next.id &&
          !this.pending.has(next.id)
        )
          this.publish({
            status: "saved",
            savedAt,
            message: "Recovery saved locally",
          });
      } catch (error) {
        if (this.disposed) return;
        if (!this.disposed && !this.pending.has(next.id))
          this.failed.set(next.id, next);
        if (this.currentId === next.id)
          this.publish({
            ...this.state,
            status: "error",
            message: `Recovery unavailable: ${storageErrorMessage(error)}. Save a project backup.`,
          });
      }
    })();
    await this.inFlight;
    this.inFlight = undefined;
    if (this.pending.size) await this.drain();
  }
  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
    this.pending.clear();
    this.failed.clear();
    this.reset();
    this.listeners.clear();
  }
}
