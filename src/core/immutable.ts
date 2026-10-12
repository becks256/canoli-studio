import { yieldTask } from "./task-yield";
/** Only objects recursively frozen by these internal helpers qualify for sharing. */
const immutable = new WeakSet<object>();
export function isImmutable(value: unknown): value is object {
  return typeof value === "object" && value !== null && immutable.has(value);
}
export function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !immutable.has(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
    immutable.add(value);
  }
  return value;
}
/** Reuse immutable subtrees after a general command; retain independent changed data. */
export function shareUnchanged<T>(previous: T, next: T): T {
  if (Object.is(previous, next)) return previous;
  if (isImmutable(next)) return next;
  if (!isImmutable(previous) || !next || typeof next !== "object" || Array.isArray(previous) !== Array.isArray(next)) return next;
  const before = previous as Record<string, unknown>, after = next as Record<string, unknown>;
  const keys = Object.keys(after);
  let same = Object.keys(before).length === keys.length;
  for (const key of keys) {
    const value = shareUnchanged(before[key], after[key]);
    if (value !== after[key]) after[key] = value;
    if (!Object.hasOwn(before, key) || !Object.is(value, before[key])) same = false;
  }
  return same ? previous : next;
}

/** Cooperatively freeze exclusively owned plain data before publishing it.
 * Parents enter the immutable registry only after every child is proven frozen.
 */
export async function freezeOwnedData<T>(value: T): Promise<T> {
  const pending = new WeakSet<object>();
  const stack: { value: object; children: Iterator<unknown> }[] = [];
  const enter = (item: unknown) => {
    if (!item || typeof item !== "object" || isImmutable(item)) return;
    if (pending.has(item)) throw new TypeError("Owned model data must not contain cycles.");
    const prototype = Object.getPrototypeOf(item);
    if (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null)
      throw new TypeError("Owned model data must contain only plain objects and arrays.");
    Object.freeze(item);
    pending.add(item);
    stack.push({ value: item, children: (Array.isArray(item) ? item : Object.values(item))[Symbol.iterator]() });
  };
  enter(value);
  let deadline = performance.now() + 2, work = 0;
  while (stack.length) {
    const frame = stack[stack.length - 1];
    const child = frame.children.next();
    if (child.done) {
      immutable.add(frame.value);
      pending.delete(frame.value);
      stack.pop();
    } else enter(child.value);
    if (++work % 256 === 0 && performance.now() >= deadline) {
      await yieldTask();
      deadline = performance.now() + 2;
    }
  }
  return value;
}
