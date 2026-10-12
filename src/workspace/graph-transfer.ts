import { yieldTask } from "../core/task-yield";

type Reference = { ref: number; length?: number };
type Value = null | undefined | string | number | boolean | Reference;
export type GraphChunk = { target: Reference; entries: [string, Value][] }[];

/** Internal plain-data transport. Keep shared history subtrees shared, including across chunks. */
export async function sendGraph(root: object, send: (chunk: GraphChunk) => void): Promise<void> {
  const ids = new WeakMap<object, Reference>();
  const queue: object[] = [];
  const reference = (value: object): Reference => {
    const known = ids.get(value);
    if (known) return known;
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
      throw new TypeError("Workspace transport requires plain data.");
    const ref = { ref: queue.length, ...(Array.isArray(value) ? { length: value.length } : {}) };
    ids.set(value, ref); queue.push(value);
    return ref;
  };
  reference(root);
  let chunk: GraphChunk = [], count = 0, deadline = performance.now() + 2;
  const flush = async () => {
    send(chunk); chunk = []; count = 0;
    await yieldTask();
    deadline = performance.now() + 2;
  };
  for (let index = 0; index < queue.length; index++) {
    const object = queue[index];
    let record = { target: reference(object), entries: [] as [string, Value][] };
    chunk.push(record);
    const keys = Array.isArray(object)
      ? (function* () { for (let i = 0; i < object.length; i++) if (Object.hasOwn(object, i)) yield String(i); })()
      : (function* () { for (const key in object) if (Object.hasOwn(object, key)) yield key; })();
    for (const key of keys) {
      const value = (object as Record<string, unknown>)[key];
      if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint")
        throw new TypeError("Workspace transport requires plain data.");
      record.entries.push([key, value !== null && typeof value === "object" ? reference(value) : value as Value]);
      if (++count >= 2048 || (count % 128 === 0 && performance.now() >= deadline)) {
        await flush();
        record = { target: reference(object), entries: [] };
        chunk.push(record);
      }
    }
  }
  if (chunk.length) send(chunk);
}

/** Worker-side reconstruction, with safe own-property writes. Validation still follows reconstruction. */
export class GraphReceiver {
  private objects = new Map<number, object>();
  private resolve(ref: Reference): object {
    let value = this.objects.get(ref.ref);
    if (!value) {
      value = ref.length === undefined ? {} : new Array(ref.length);
      this.objects.set(ref.ref, value);
    }
    return value;
  }
  add(chunk: GraphChunk) {
    for (const record of chunk) {
      const target = this.resolve(record.target);
      for (const [key, value] of record.entries)
        Object.defineProperty(target, key, { value: value !== null && typeof value === "object" ? this.resolve(value) : value, enumerable: true, configurable: true, writable: true });
    }
  }
  finish<T>(): T {
    const root = this.objects.get(0);
    if (!root) throw new Error("Workspace transport is incomplete.");
    this.objects.clear();
    return root as T;
  }
}
