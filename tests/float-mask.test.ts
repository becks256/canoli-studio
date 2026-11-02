import { it, expect } from "vitest";
import { FloatMaskRaster } from "../src/engine/float-mask";
import { freeze } from "../src/core/immutable";
import { LayerMask, MarqueeSelection, AffineTransform } from "../src/dom";
const mask = () =>
    new LayerMask({
      selection: new MarqueeSelection({
        shape: "rectangle",
        x: 1,
        y: 2,
        width: 40,
        height: 30,
      }),
      feather: 2,
    }).toJSON(),
  world = new AffineTransform(),
  area = { x: 250, y: -3, width: 15, height: 9 };
it("canonical float mask reads have exact region partitions, owned output, immutable reuse and pose invalidation", async () => {
  const cache = new FloatMaskRaster(),
    value = freeze(mask()),
    calls: unknown[] = [];
  const read = async (b: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => {
    calls.push(b);
    return Float32Array.from(
      { length: b.width * b.height },
      (_, i) =>
        (((b.x + (i % b.width) + 10000) *
          (b.y + Math.floor(i / b.width) + 10000)) %
          256) /
        255,
    );
  };
  const all = await cache.read(value, area, world, read, () => {}),
    part = new Float32Array(all.length);
  for (let y = 0; y < area.height; y++) {
    const row = await cache.read(
      value,
      { ...area, y: area.y + y, height: 1 },
      world,
      read,
      () => {},
    );
    part.set(row, y * area.width);
  }
  expect(part).toEqual(all);
  expect(calls).toHaveLength(4);
  all.fill(0);
  expect(
    (await cache.read(value, area, world, read, () => {})).some((v) => v !== 0),
  ).toBe(true);
  expect(calls).toHaveLength(4);
  await cache.read(
    value,
    area,
    AffineTransform.translation(1, 2),
    read,
    () => {},
  );
  expect(calls).toHaveLength(8);
  cache.clear();
  await cache.read(value, area, world, read, () => {});
  expect(calls).toHaveLength(12);
});
it("mutable masks never retain stale coverage and eviction bounds the capture-local cache", async () => {
  const cache = new FloatMaskRaster(1),
    value = mask(),
    tiny = { x: 0, y: 0, width: 1, height: 1 };
  let count = 0;
  const read = async () => new Float32Array(65536).fill(++count / 10);
  await cache.read(value, tiny, world, read, () => {});
  expect((await cache.read(value, tiny, world, read, () => {}))[0]).toBe(
    Math.fround(0.2),
  );
  const frozen = freeze(mask());
  await cache.read(frozen, tiny, world, read, () => {});
  await cache.read(frozen, { ...tiny, x: 256 }, world, read, () => {});
  await cache.read(frozen, tiny, world, read, () => {});
  expect(count).toBe(5);
});
it("invalid asynchronous mask planes and cancellation reject even after an otherwise reusable hit", async () => {
  const cache = new FloatMaskRaster(),
    value = freeze(mask()),
    tiny = { x: 0, y: 0, width: 1, height: 1 };
  for (const invalid of [
    new Float32Array(1),
    new Float32Array(65536).fill(NaN),
    new Float32Array(65536).fill(2),
  ])
    await expect(
      cache.read(
        value,
        tiny,
        world,
        async () => invalid,
        () => {},
      ),
    ).rejects.toThrow();
  let cancelled = false;
  await expect(
    cache.read(
      value,
      tiny,
      world,
      async () => {
        cancelled = true;
        return new Float32Array(65536);
      },
      () => {
        if (cancelled) throw new Error("Cancelled mask");
      },
    ),
  ).rejects.toThrow("Cancelled mask");
  await cache.read(
    value,
    tiny,
    world,
    async () => new Float32Array(65536),
    () => {},
  );
  await expect(
    cache.read(
      value,
      tiny,
      world,
      async () => {
        throw new Error("Cached source must not reread");
      },
      () => {
        throw new Error("Cancelled cached mask");
      },
    ),
  ).rejects.toThrow("Cancelled cached mask");
});
