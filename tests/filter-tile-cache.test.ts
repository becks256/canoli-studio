import { expect, it } from "vitest";
import { FilterTileCache } from "../src/engine/filter-tile-cache";
it("retains exact private snapshots and releases everything on clear", () => {
  const cache = new FilterTileCache(128),
    original = new Uint8ClampedArray([12, 34, 56, 0]),
    filtered = new Uint8ClampedArray([1, 2, 3, 4]);
  cache.write("a", "1", original, filtered);
  original.fill(0);
  filtered.fill(0);
  const read = cache.read("a", "1")!;
  expect([...read.original!]).toEqual([12, 34, 56, 0]);
  read.filtered.fill(0);
  expect([...cache.read("a", "1")!.filtered]).toEqual([1, 2, 3, 4]);
  expect(cache.read("a", "2")).toBeUndefined();
  cache.write("a", "1", new Uint8ClampedArray(200), new Uint8ClampedArray(200));
  expect(cache.read("a", "1")).toBeUndefined();
  cache.clear();
  expect(cache.byteLength).toBe(0);
});
it("drops source copies before filtered results, then evicts least recently used filtered entries", () => {
  const cache = new FilterTileCache(32),
    original = new Uint8ClampedArray(8).fill(42),
    filtered = new Uint8ClampedArray(8).fill(99);
  cache.write("a", "1", original, filtered);
  cache.write("b", "1", original, filtered);
  expect(cache.byteLength).toBe(32);
  expect(cache.read("a", "1")!.original).toBeUndefined();
  expect([...cache.read("a", "1")!.filtered]).toEqual([...filtered]);
  // Reading a makes it newer than b, so b is evicted only after source copies are exhausted.
  cache.write("c", "1", original, filtered);
  expect(cache.read("b", "1")).toBeUndefined();
  expect(cache.read("a", "1")).toBeDefined();
  expect(cache.read("c", "1")).toBeDefined();
  expect(cache.byteLength).toBeLessThanOrEqual(32);
});
it("retains a filtered tile when its paired originals exceed the entire budget", () => {
  const cache = new FilterTileCache(20),
    pixels = new Uint8ClampedArray(16).fill(7);
  cache.write("a", "1", pixels, pixels);
  expect(cache.byteLength).toBe(20);
  expect(cache.read("a", "1")!.original).toBeUndefined();
  expect(cache.read("a", "1")!.filtered).toEqual(pixels);
});

it("selective reads preserve private pixels, signatures and the retained byte budget", () => {
  const cache = new FilterTileCache(128);
  cache.write(
    "a",
    "1",
    new Uint8ClampedArray([12, 34, 56, 0]),
    new Uint8ClampedArray([8, 9, 10, 255]),
  );
  const bytes = cache.byteLength;
  const filtered = cache.read("a", "1", false)!;
  expect(filtered.original).toBeUndefined();
  expect([...filtered.filtered]).toEqual([8, 9, 10, 255]);
  filtered.filtered.fill(0);
  const original = cache.readOriginal("a", "1")!;
  expect([...original]).toEqual([12, 34, 56, 0]);
  original.fill(0);
  expect([...cache.readOriginal("a", "1")!]).toEqual([12, 34, 56, 0]);
  expect([...cache.read("a", "1", false)!.filtered]).toEqual([8, 9, 10, 255]);
  expect(cache.readOriginal("a", "stale")).toBeUndefined();
  expect(cache.byteLength).toBe(bytes);
});
