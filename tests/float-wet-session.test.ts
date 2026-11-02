import { beforeAll, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { AffineTransform, PencilStroke, MarqueeSelection } from "../src/dom";
import type { Rect } from "../src/core/drawing";
import { FloatPixelProcessor } from "../src/engine/float-pixels";
import { createFloatWetStrokeSession } from "../src/engine/wet-session";
import { prepareFloatWetStroke } from "../src/engine/wet-stroke";
import {
  sampleFloatWetField,
  wetTileKey,
  type WetFieldTile,
} from "../src/engine/wet-spatial";
import type {
  FloatWetProcessor,
  FloatWetStrokeOptions,
  WetStrokeResult,
} from "../src/engine/wet-state";
import type { WetTile, WetTileStore } from "../src/engine/wet-store";
import {
  instantiateKernel,
  renderSelection,
  prepareBrushTexture,
  type PixelKernel,
} from "../src/engine/wasm";

const directory = "tests/fixtures/float-wet-session/",
  manifest = JSON.parse(await readFile(directory + "manifest.json", "utf8"));
async function fixture(name: string) {
  return new Float32Array(
    new Uint8Array(gunzipSync(await readFile(directory + name + ".f32le.gz")))
      .buffer,
  );
}
function exact(a: Float32Array, b: Float32Array) {
  expect([...new Uint32Array(a.buffer, a.byteOffset, a.length)]).toEqual([
    ...new Uint32Array(b.buffer, b.byteOffset, b.length),
  ]);
}
class MemoryStore implements WetTileStore {
  data = new Map<string, WetTile>();
  closed = false;
  async get(key: string) {
    if (this.closed) throw new Error("closed");
    return this.data.get(key)?.slice();
  }
  async put(key: string, value: WetTile) {
    if (this.closed) throw new Error("closed");
    this.data.set(key, value.slice());
  }
  async remove(key: string) {
    if (this.closed) throw new Error("closed");
    this.data.delete(key);
  }
  async dispose() {
    this.closed = true;
    this.data.clear();
  }
}
function stores() {
  const values: MemoryStore[] = [];
  return {
    values,
    storage: async () => {
      const store = new MemoryStore();
      values.push(store);
      return store;
    },
  };
}
let kernel: PixelKernel, native: FloatPixelProcessor;
beforeAll(async () => {
  kernel = await instantiateKernel(
    new Uint8Array(await readFile("public/wasm/pixels.wasm")),
  );
  native = new FloatPixelProcessor(kernel);
});
const processor: FloatWetProcessor = {
  floatWetLoad: async (...args) => native.wetLoad(...args),
  floatWetMix: async (...args) => native.wetMix(...args),
  floatWetEnvelope: async (...args) => native.wetEnvelope(...args),
  selection: async (request) => renderSelection(kernel, request),
  brushTexture: async (...args) => prepareBrushTexture(kernel, ...args),
};
const source = async (region: Rect) => {
  const result = new Float32Array(region.width * region.height * 4);
  for (let y = 0; y < region.height; y++)
    for (let x = 0; x < region.width; x++) {
      const xx = region.x + x,
        yy = region.y + y,
        alpha = (xx + yy) % 13 === 0 ? 0 : 0.375 + ((xx * 3 + yy * 5) & 7) / 16;
      result.set(
        [2 + xx * 0.25, -3 + yy * 0.125, 8 + ((xx - yy) & 7) * 0.5, alpha],
        (y * region.width + x) * 4,
      );
    }
  return result;
};
const coverage: NonNullable<FloatWetStrokeOptions["coverage"]> = async (
  _stroke,
  frame,
  region,
) => {
  const inverse = frame.inverse(),
    mask = new Float32Array(region.width * region.height);
  for (let y = 0; y < region.height; y++)
    for (let x = 0; x < region.width; x++) {
      const point = inverse.point({
        x: region.x + x + 0.5,
        y: region.y + y + 0.5,
      });
      if (point.x >= -1 && point.x < 1 && point.y >= -1 && point.y < 1)
        mask[y * region.width + x] = [1 / 4096, 0.375, 1][
          (((region.x + x + 2 * (region.y + y)) % 3) + 3) % 3
        ];
    }
  return mask;
};
function stroke() {
  return new PencilStroke({
    size: 3,
    spacing: 0.25,
    pressureSize: false,
    pressureOpacity: false,
    opacity: manifest.opacity,
    flow: manifest.flow,
    clip: new MarqueeSelection({ shape: "rectangle", ...manifest.clip }),
    points: manifest.points.map(([x, y]: number[]) => ({ x, y, pressure: 1 })),
  }).toJSON();
}
async function read(
  result: WetStrokeResult<Float32Array>,
  region: Rect = manifest.region,
) {
  const value = await source(region);
  for await (const tile of result.tiles(region)) {
    expect(tile.pixels).toBeInstanceOf(Float32Array);
    expect(tile.before).toBeInstanceOf(Float32Array);
    for (let y = 0; y < tile.region.height; y++) {
      const at =
        ((tile.region.y + y - region.y) * region.width +
          tile.region.x -
          region.x) *
        4;
      value.set(
        tile.pixels.subarray(
          y * tile.region.width * 4,
          (y + 1) * tile.region.width * 4,
        ),
        at,
      );
    }
  }
  return value;
}
for (const tileSize of [4, 8, 16])
  it(
    "retained signed/HDR prefixes match every independent scalar word with tile size " +
      tileSize,
    async () => {
      const backing = stores(),
        input = stroke(),
        reads = new Map<string, number>();
      let loads = 0;
      const session = await createFloatWetStrokeSession(
        { ...input, points: input.points.slice(0, 2) },
        async (region) => {
          const key = wetTileKey(region.x, region.y);
          reads.set(key, (reads.get(key) ?? 0) + 1);
          return source(region);
        },
        {
          ...processor,
          floatWetLoad: async (...args) => {
            loads++;
            return processor.floatWetLoad(...args);
          },
        },
        {
          tileSize,
          cacheBytes: tileSize === 4 ? 0 : 1024,
          coverage,
          storage: backing.storage,
          load: manifest.load,
          mix: manifest.mix,
        },
      );
      const prefix = await session.snapshot(),
        loaded = loads,
        batch = [{ ...input.points[2] }],
        pending = session.append(batch);
      batch[0].x = 999;
      await pending;
      const middle = await session.snapshot();
      await session.append(input.points.slice(3));
      const final = await session.finish();
      await session.dispose();
      try {
        exact(await read(prefix), await fixture("prefix"));
        exact(await read(middle), await fixture("middle"));
        exact(await read(final), await fixture("final"));
        expect(final.precision).toBe("float32");
        expect(loads).toBe(loaded);
        expect(final.diagnostics.dabs).toBe(6);
        expect([...reads.values()].every((n) => n === 1)).toBe(true);
        expect(
          [...backing.values[0].data.keys()].every(
            (key) => key.startsWith("result/") || key.startsWith("original/"),
          ),
        ).toBe(true);
        const first = (await prefix.tiles().next()).value!,
          saved = first.pixels.slice();
        first.pixels.fill(123);
        exact((await prefix.tiles().next()).value!.pixels, saved);
      } finally {
        await prefix.dispose();
        await middle.dispose();
        await final.dispose();
      }
      expect(backing.values.every((store) => store.closed)).toBe(true);
    },
  );

for (let index = 0; index < 3; index++)
  it(
    "signed/HDR spatial transport matches independent bilinear words across compact and dense cells: " +
      index,
    async () => {
      const source = await fixture("field"),
        expected = await fixture("spatial-" + index),
        bounds = manifest.bounds,
        region = manifest.window;
      const affine = (values: number[]) =>
        new AffineTransform(
          ...(values as [number, number, number, number, number, number]),
        );
      for (const tileSize of [8, 16])
        for (const compact of [false, true]) {
          const tiles = new Map<string, WetFieldTile>(),
            data = new Map<string, Float32Array>();
          for (let y = -16; y < 16; y += tileSize)
            for (let x = -16; x < 16; x += tileSize) {
              const key = wetTileKey(x, y),
                pixels = new Float32Array(tileSize * tileSize * 4);
              for (let row = 0; row < tileSize; row++) {
                const at = ((y + row + 16) * 32 + x + 16) * 4;
                pixels.set(
                  source.subarray(at, at + tileSize * 4),
                  row * tileSize * 4,
                );
              }
              tiles.set(
                key,
                compact
                  ? { key, region: { x, y, width: tileSize, height: tileSize } }
                  : key,
              );
              data.set(key, pixels);
            }
          exact(
            await sampleFloatWetField(
              {
                bounds,
                tiles,
                transform: affine(manifest.frames[index].previous),
              },
              affine(manifest.frames[index].current),
              region,
              tileSize,
              async (key) => data.get(key)!,
              () => {},
            ),
            expected,
          );
        }
    },
  );

it("completed opacity and selection preserve hidden color and sub-byte alpha instead of remapping a tile rectangle", async () => {
  const backing = stores(),
    input = new PencilStroke({
      size: 1,
      pressureSize: false,
      opacity: 0.5,
      flow: 0.5,
      points: [
        { x: 2.5, y: 2.5 },
        { x: 2.5, y: 2.5 },
      ],
      clip: new MarqueeSelection({
        shape: "rectangle",
        x: 2,
        y: 2,
        width: 1,
        height: 1,
      }),
    }).toJSON();
  const hidden = async (region: Rect) => {
    const p = new Float32Array(region.width * region.height * 4);
    for (let at = 0; at < p.length; at += 4) p.set([-0, 7, -9, 0], at);
    return p;
  };
  const result = await prepareFloatWetStroke(input, hidden, processor, {
    tileSize: 8,
    storage: backing.storage,
    load: { color: [4, -2, 8, 0.375], load: 1 },
    mix: { pickup: 0 },
    coverage: async (_s, frame, region) => {
      const inverse = frame.inverse();
      return Float32Array.from(
        { length: region.width * region.height },
        (_, i) => {
          const p = inverse.point({
            x: region.x + (i % region.width) + 0.5,
            y: region.y + Math.floor(i / region.width) + 0.5,
          });
          return p.x >= -1 && p.x < 1 && p.y >= -1 && p.y < 1 ? 1 : 0;
        },
      );
    },
  });
  try {
    const tile = (await result.tiles().next()).value!,
      at = ((2 - tile.region.y) * tile.region.width + 2 - tile.region.x) * 4;
    exact(
      tile.pixels.subarray(at, at + 4),
      new Float32Array([4, -2, 8, 0.140625]),
    );
    exact(tile.pixels.subarray(0, 4), new Float32Array([-0, 7, -9, 0]));
    expect(
      tile.changed.reduce(
        (sum: number, value: number) => sum + Number(value > 0),
        0,
      ),
    ).toBe(1);
  } finally {
    await result.dispose();
  }
});

it("delta snapshots retain epochs and owned prefixes after abort or later quota failure", async () => {
  for (const reason of ["abort", "quota", "source"]) {
    const backing = stores(),
      abort = new AbortController();
    let alive = true;
    const storage = async () => {
      const store = await backing.storage();
      if (reason === "quota" && backing.values.length === 4)
        store.put = async () => {
          throw new Error("Quota exhausted");
        };
      return store;
    };
    const input = stroke(),
      session = await createFloatWetStrokeSession(
        { ...input, points: input.points.slice(0, 2) },
        source,
        processor,
        {
          tileSize: 8,
          coverage,
          storage,
          load: manifest.load,
          mix: manifest.mix,
          signal: abort.signal,
          check: () => {
            if (!alive) throw new Error("Source changed");
          },
        },
      );
    const prefix = await session.snapshot(),
      epochs = new Map<string, string>();
    for await (const tile of prefix.tiles())
      epochs.set(wetTileKey(tile.region.x, tile.region.y), tile.epoch!);
    const delta = await session.snapshotSince(epochs);
    expect(delta.reused.length).toBeGreaterThan(0);
    expect((await delta.result.tiles().next()).done).toBe(true);
    if (reason === "abort") abort.abort(new Error("Stop HDR stroke"));
    else if (reason === "source") {
      alive = false;
      await expect(session.append(input.points.slice(2))).rejects.toThrow(
        "Source changed",
      );
    } else {
      await session.append(input.points.slice(2));
      await expect(session.snapshot()).rejects.toThrow("Quota exhausted");
    }
    await session.dispose();
    exact(await read(prefix), await fixture("prefix"));
    expect(backing.values[0].closed).toBe(true);
    expect(backing.values[1].closed).toBe(false);
    await prefix.dispose();
    await delta.result.dispose();
  }
});

it("rejects malformed float source, pigment, coverage or outputs and cleans private storage before a healthy retry", async () => {
  for (const fault of ["byte", "nan", "coverage", "load", "mix", "envelope"]) {
    const backing = stores(),
      input = stroke(),
      p = { ...processor };
    if (fault === "load") p.floatWetLoad = async () => new Float32Array(4);
    if (fault === "mix")
      p.floatWetMix = async () => ({
        pixels: new Float32Array(4),
        carried: new Float32Array(4),
      });
    if (fault === "envelope")
      p.floatWetEnvelope = async () => new Float32Array(4);
    const readSource =
      fault === "byte"
        ? async (region: Rect) =>
            new Uint8ClampedArray(
              region.width * region.height * 4,
            ) as unknown as Float32Array
        : fault === "nan"
          ? async (region: Rect) => {
              const p = await source(region);
              p[0] = NaN;
              return p;
            }
          : source;
    await expect(
      prepareFloatWetStroke(input, readSource, p, {
        tileSize: 8,
        storage: backing.storage,
        load: manifest.load,
        mix: manifest.mix,
        coverage:
          fault === "coverage" ? async () => new Float32Array([NaN]) : coverage,
      }),
    ).rejects.toThrow();
    expect(backing.values.every((store) => store.closed)).toBe(true);
  }
  const result = await prepareFloatWetStroke(stroke(), source, processor, {
    tileSize: 8,
    coverage,
    storage: stores().storage,
    load: manifest.load,
    mix: manifest.mix,
  });
  try {
    exact(await read(result), await fixture("final"));
  } finally {
    await result.dispose();
  }
});

it("all independent compressed/raw fixture identities and generator source match", async () => {
  for (const [name, entry] of Object.entries(manifest.files) as [
    string,
    { sha256: string; rawSha256: string; bytes: number },
  ][]) {
    const bytes = await readFile(directory + name + ".f32le.gz");
    expect(bytes.length).toBe(entry.bytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(entry.sha256);
    expect(createHash("sha256").update(gunzipSync(bytes)).digest("hex")).toBe(
      entry.rawSha256,
    );
  }
  expect(
    createHash("sha256")
      .update(await readFile("scripts/generate-float-wet-session-fixtures.py"))
      .digest("hex"),
  ).toBe(manifest.generatorSha256);
});

it("captures nested float controls before storage readiness and releases sources once on initialization failure", async () => {
  const backing = stores(),
    input = stroke(),
    options = {
      color: [4.5, -2.25, 13.125, 0.375] as [number, number, number, number],
      load: 0.37,
    };
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const pending = createFloatWetStrokeSession(input, source, processor, {
    tileSize: 8,
    coverage,
    load: options,
    mix: manifest.mix,
    storage: async () => {
      await gate;
      return backing.storage();
    },
  });
  input.points[0].x = 999;
  options.color.fill(0);
  options.load = 0;
  release();
  const session = await pending,
    final = await session.finish();
  await session.dispose();
  try {
    exact(await read(final), await fixture("final"));
  } finally {
    await final.dispose();
  }
  for (const fault of ["capture", "storage", "source"]) {
    let released = 0;
    await expect(
      createFloatWetStrokeSession(
        stroke(),
        fault === "source"
          ? async () => {
              throw new Error("Source failed");
            }
          : source,
        processor,
        {
          tileSize: fault === "capture" ? 0 : 8,
          coverage,
          storage:
            fault === "storage"
              ? async () => {
                  throw new Error("Storage failed");
                }
              : stores().storage,
        },
        () => {
          released++;
        },
      ),
    ).rejects.toThrow();
    expect(released).toBe(1);
  }
});

it("compact HDR sampling captures metadata and canonicalizes pigment when interpolated alpha underflows", async () => {
  const region = { x: 1, y: 2, width: 2, height: 2 },
    reference = { key: "pigment", region: { ...region } },
    tiles = new Map<string, WetFieldTile>([["0,0", reference]]),
    values = new Float32Array(16);
  values.set([2, -4, 8, 2 ** -149]);
  let release!: (value: Float32Array) => void;
  const pending = sampleFloatWetField(
    { bounds: region, transform: new AffineTransform(), tiles },
    AffineTransform.translation(0.5, 0.5),
    { x: 2, y: 3, width: 1, height: 1 },
    8,
    () => new Promise((resolve) => (release = resolve)),
    () => {},
  );
  reference.region.x = 99;
  region.x = 99;
  tiles.clear();
  release(values);
  exact(await pending, new Float32Array(4));
  await expect(
    sampleFloatWetField(
      {
        bounds: { x: 1, y: 2, width: 2, height: 2 },
        transform: new AffineTransform(),
        tiles: new Map([
          [
            "0,0",
            { key: "pigment", region: { x: 1, y: 2, width: 1, height: 2 } },
          ],
        ]),
      },
      new AffineTransform(),
      { x: 1, y: 2, width: 1, height: 1 },
      8,
      async () => values,
      () => {},
    ),
  ).rejects.toThrow("complete native cell support");
});
