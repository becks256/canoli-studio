import { storageErrorMessage } from "../core/storage-errors";
import type { SavedWorkspace, WorkspaceRepository } from "./repository";

type State = {
  status: "idle" | "pending" | "saving" | "saved" | "error";
  savedAt: number | null;
  message: string;
};
/** One writer per browser-tab identity; manual checkpoints remain independent. */
export class WorkspaceAutosave {
  private state: State = {
    status: "idle",
    savedAt: null,
    message: "Workspace autosave starting",
  };
  private listeners = new Set<() => void>();
  private id?: string;
  private release?: () => void;
  private enabled = false;
  private disposed = false;
  private dirty = false;
  private timer?: ReturnType<typeof setTimeout>;
  private writing?: Promise<void>;
  constructor(
    private readonly repository: WorkspaceRepository,
    private readonly capture: () => Promise<SavedWorkspace>,
  ) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(state: State) {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }
  reportError(error: unknown) {
    this.publish({
      ...this.state,
      status: "error",
      message: `Workspace autosave unavailable: ${storageErrorMessage(error)}`,
    });
  }
  async acquire(): Promise<void> {
    if (this.id) return;
    if (!navigator.locks)
      throw new Error("Workspace autosave requires browser Web Locks.");
    let id = sessionStorage.getItem("luma-workspace-tab");
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) id = crypto.randomUUID();
    while (!this.disposed) {
      const candidate = id;
      const acquired = await new Promise<boolean>((resolve, reject) => {
        void navigator.locks
          .request(
            `luma-workspace:${candidate}`,
            { ifAvailable: true },
            async (lock) => {
              if (!lock) {
                resolve(false);
                return;
              }
              await new Promise<void>((release) => {
                this.release = release;
                if (this.disposed) {
                  release();
                  resolve(false);
                  return;
                }
                this.id = candidate;
                resolve(true);
              });
            },
          )
          .catch(reject);
      });
      if (acquired) {
        try {
          sessionStorage.setItem("luma-workspace-tab", candidate);
        } catch (error) {
          this.release?.();
          this.id = undefined;
          throw error;
        }
        return;
      }
      id = crypto.randomUUID();
    }
    throw new Error("Workspace autosave was disposed.");
  }
  start() {
    if (!this.id || this.disposed)
      throw new Error("Workspace autosave is not initialized.");
    this.enabled = true;
    this.publish({
      ...this.state,
      status: "idle",
      message: "Workspace autosave ready",
    });
  }
  async load(): Promise<SavedWorkspace | null> {
    if (!this.id) throw new Error("Workspace autosave is not initialized.");
    return this.repository.loadAutomatic(this.id);
  }
  schedule() {
    if (!this.enabled || this.disposed) return;
    this.dirty = true;
    this.publish({
      ...this.state,
      status: "pending",
      message: "Workspace changes pending",
    });
    if (!this.timer)
      this.timer = setTimeout(() => {
        this.timer = undefined;
        void this.flush().catch(() => {});
      }, 2000);
  }
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.enabled || this.disposed) return;
    if (this.writing) {
      await this.writing;
      if (this.dirty) await this.flush();
      return;
    }
    if (!this.dirty) return;
    this.dirty = false;
    this.publish({
      ...this.state,
      status: "saving",
      message: "Saving workspace locally…",
    });
    this.writing = (async () => {
      const workspace = await this.capture();
      if (this.disposed) return;
      await this.repository.saveAutomatic(this.id!, workspace);
      if (!this.disposed && !this.dirty)
        this.publish({
          status: "saved",
          savedAt: workspace.savedAt,
          message: "Workspace saved locally",
        });
    })();
    try {
      await this.writing;
    } catch (error) {
      this.dirty = true;
      this.reportError(error);
      throw error;
    } finally {
      this.writing = undefined;
    }
    if (this.dirty) await this.flush();
  }
  dispose() {
    this.disposed = true;
    this.enabled = false;
    clearTimeout(this.timer);
    // Keep ownership through any already-started IDB transaction.
    void (this.writing ?? Promise.resolve())
      .catch(() => {})
      .finally(() => this.release?.());
    this.listeners.clear();
  }
}
