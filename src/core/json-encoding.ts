import { yieldTask } from "./task-yield";

const omitted = (value: unknown) =>
  value === undefined || typeof value === "function" || typeof value === "symbol";

// Bound native serialization batches by both record width and string length.
const simple = (value: unknown): boolean => value === null ||
  (typeof value !== "object" && (typeof value !== "string" || value.length <= 1024));
const shallow = (value: unknown): boolean => {
  if (simple(value)) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  if (typeof (value as { toJSON?: unknown }).toJSON === "function") return false;
  const keys = Object.keys(value);
  return keys.length <= 8 && keys.every(key => simple((value as Record<string, unknown>)[key]));
};

/** Plain serialized model data only; retain JSON.stringify ordering and escaping. */
function* tokens(value: unknown, ancestors = new Set<object>()): Generator<string> {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new TypeError("JSON root has no representation.");
    yield encoded;
    return;
  }
  if (ancestors.has(value)) throw new TypeError("Cannot encode cyclic JSON data.");
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    throw new TypeError("Expected plain JSON model data.");
  if (typeof (value as { toJSON?: unknown }).toJSON === "function")
    throw new TypeError("Expected data without custom JSON serialization.");
  if (!Array.isArray(value) && shallow(value)) {
    yield JSON.stringify(value);
    return;
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    yield "[";
    for (let i = 0; i < value.length; i += 64) {
      if (i) yield ",";
      const batch = value.slice(i, i + 64);
      if (batch.every(shallow)) yield JSON.stringify(batch).slice(1, -1);
      else for (let j = 0; j < batch.length; j++) {
        if (j) yield ",";
        yield* tokens(omitted(batch[j]) ? null : batch[j], ancestors);
      }
    }
    yield "]";
  } else {
    yield "{";
    let first = true;
    for (const key of Object.keys(value)) {
      const child = (value as Record<string, unknown>)[key];
      if (omitted(child)) continue;
      if (!first) yield ",";
      first = false;
      yield JSON.stringify(key);
      yield ":";
      yield* tokens(child, ancestors);
    }
    yield "}";
  }
  ancestors.delete(value);
}

/**
 * Encode an owned, stable JSON snapshot without one document-sized stringify task.
 * Yield between token batches; native string encoding and final buffer allocation
 * remain synchronous. Callers must not mutate data while this promise is pending.
 */
export async function encodeJsonData(value: unknown): Promise<Uint8Array<ArrayBuffer>> {
  const encoder = new TextEncoder(), chunks: Uint8Array<ArrayBuffer>[] = [];
  let parts: string[] = [], characters = 0, bytes = 0, count = 0;
  let deadline = performance.now() + 2;
  const flush = () => {
    if (!parts.length) return;
    const chunk = encoder.encode(parts.join(""));
    chunks.push(chunk); bytes += chunk.byteLength;
    parts = []; characters = 0;
  };
  for (const token of tokens(value)) {
    parts.push(token); characters += token.length;
    if (characters >= 65536) flush();
    if ((++count % 32 === 0 || token.length >= 1024) && performance.now() >= deadline) {
      await yieldTask();
      deadline = performance.now() + 2;
    }
  }
  flush();
  const output = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset); offset += chunk.byteLength;
    if (performance.now() >= deadline) {
      await yieldTask();
      deadline = performance.now() + 2;
    }
  }
  return output;
}
