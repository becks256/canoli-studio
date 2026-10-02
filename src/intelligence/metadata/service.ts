import type { MetadataInput, MetadataState } from "./model";

/** One worker at a time; replaced/disposed stores cannot publish stale analysis. */
export class MetadataService {
  private states = new Map<string, MetadataState>();
  private queue: { id: string; input: MetadataInput }[] = [];
  private active:
    | { id: string; worker: Worker; timer: ReturnType<typeof setTimeout> }
    | undefined;
  private disposed = false;
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  get(id: string) {
    return this.states.get(id);
  }
  private publish() {
    this.listeners.forEach((listener) => listener());
  }
  analyze(id: string, input: MetadataInput) {
    if (this.disposed || this.states.has(id)) return;
    this.states.set(id, { status: "pending" });
    this.queue.push({ id, input });
    this.publish();
    this.drain();
  }
  private drain() {
    if (this.disposed || this.active) return;
    const next = this.queue.shift();
    if (!next) return;
    let worker: Worker;
    const finish = (state: MetadataState) => {
      if (this.disposed || this.active?.worker !== worker) return;
      clearTimeout(this.active.timer);
      this.active.worker.terminate();
      this.active = undefined;
      this.states.set(next.id, state);
      this.publish();
      queueMicrotask(() => this.drain());
    };
    try {
      worker = new Worker(new URL("./metadata.worker.ts", import.meta.url), {
        type: "module",
      });
      const timer = setTimeout(
        () =>
          finish({
            status: "error",
            message: "Metadata analysis timed out. Editing remains available.",
          }),
        8000,
      );
      this.active = { id: next.id, worker, timer };
      worker.onmessage = (event) =>
        finish(
          event.data.result
            ? { status: "ready", result: event.data.result }
            : { status: "error", message: event.data.error },
        );
      worker.onerror = (event) => {
        event.preventDefault();
        finish({
          status: "error",
          message: "Metadata worker failed. Editing remains available.",
        });
      };
      worker.onmessageerror = () =>
        finish({
          status: "error",
          message:
            "Metadata result could not be read. Editing remains available.",
        });
      worker.postMessage(next.input);
    } catch {
      if (this.active)
        finish({
          status: "error",
          message: "Metadata analysis is unavailable in this browser.",
        });
      else {
        this.states.set(next.id, {
          status: "error",
          message: "Metadata workers are unavailable.",
        });
        this.publish();
        queueMicrotask(() => this.drain());
      }
    }
  }
  remove(id: string) {
    this.queue = this.queue.filter((entry) => entry.id !== id);
    this.states.delete(id);
    if (this.active?.id === id) {
      clearTimeout(this.active.timer);
      this.active.worker.terminate();
      this.active = undefined;
    }
    this.publish();
    this.drain();
  }
  dispose() {
    this.disposed = true;
    if (this.active) {
      clearTimeout(this.active.timer);
      this.active.worker.terminate();
    }
    this.active = undefined;
    this.queue = [];
    this.states.clear();
    this.listeners.clear();
  }
}
