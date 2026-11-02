import { beforeAll, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import {
  instantiateKernel,
  applyTone,
  type PixelKernel,
} from "../src/engine/wasm";
import { FloatPixelProcessor } from "../src/engine/float-pixels";
import { validateFloatWetResult } from "../src/core/float-wet";

const base = "tests/fixtures/float-wet/",
  manifest = JSON.parse(await readFile(base + "manifest.json", "utf8"));
async function data(name: string) {
  return new Float32Array(
    new Uint8Array(gunzipSync(await readFile(base + name + ".f32le.gz")))
      .buffer,
  );
}
function exact(actual: Float32Array, expected: Float32Array) {
  expect(actual.length).toBe(expected.length);
  const a = new Uint32Array(actual.buffer, actual.byteOffset, actual.length),
    b = new Uint32Array(expected.buffer, expected.byteOffset, expected.length);
  const at = a.findIndex((v, i) => v !== b[i]);
  expect(
    at < 0
      ? null
      : {
          at,
          actual: actual[at],
          expected: expected[at],
          actualWord: a[at],
          expectedWord: b[at],
        },
  ).toBeNull();
}
let kernel: PixelKernel,
  engine: FloatPixelProcessor,
  source: Float32Array,
  carried: Float32Array,
  coverage: Float32Array,
  pigment: Float32Array;
beforeAll(async () => {
  kernel = await instantiateKernel(
    new Uint8Array(await readFile("public/wasm/pixels.wasm")),
  );
  engine = new FloatPixelProcessor(kernel);
  [source, carried, coverage, pigment] = await Promise.all(
    ["source", "carried", "coverage", "pigment"].map(data),
  );
});
for (const entry of manifest.loads)
  it(
    "native linear wet load matches every independent word: " + entry.name,
    async () => {
      exact(
        engine.wetLoad(source, entry.options),
        await data("load-" + entry.name),
      );
    },
  );
for (const entry of manifest.mixes)
  it(
    "native linear wet deposit and pickup match every independent word: " +
      entry.name,
    async () => {
      const before = source.slice(),
        reservoir = carried.slice(),
        result = engine.wetMix(source, carried, coverage, entry.options);
      exact(result.pixels, await data("mix-" + entry.name));
      exact(result.carried, await data("carry-" + entry.name));
      exact(source, before);
      exact(carried, reservoir);
      expect(result.pixels.buffer).not.toBe(result.carried.buffer);
    },
  );
for (const entry of manifest.envelopes)
  it(
    "native completed wet envelope matches every independent word: " +
      entry.name,
    async () => {
      exact(
        engine.wetEnvelope(source, pigment, coverage, entry.opacity),
        await data("envelope-" + entry.name),
      );
    },
  );
it("signed HDR pigment, sub-byte alpha, transparent clearing and pre-deposit pickup retain their numeric meaning", () => {
  const s = new Float32Array([12, -4, 2, 0.375]),
    p = new Float32Array([0.25, -0.5, 1, 0.125]),
    mask = new Float32Array([1]);
  const result = engine.wetMix(s, p, mask, { pickup: 1 });
  exact(result.pixels, new Float32Array([2, -4, 8, 0.125]));
  exact(result.carried, new Float32Array([4.5, -1.5, 0.75, 0.375]));
  const clear = engine.wetMix(s, new Float32Array(4), mask, { pickup: 0 });
  exact(clear.pixels, new Float32Array(4));
  const lifted = engine.wetEnvelope(
    s,
    clear.pixels,
    new Float32Array([1 / 4096]),
    0.625,
  );
  expect(lifted[3]).toBe(Math.fround(0.375 * (1 - 0.625 / 4096)));
  expect(lifted[0]).toBe(12);
  expect(lifted[1]).toBe(-4);
});
it("inert coverage, wetness and endpoint envelopes preserve every hidden color and signed-zero word", () => {
  const s = new Float32Array([-0, 1e30, -7, 0, 8, -0, 2, 0.375]),
    p = engine.wetLoad(s),
    one = new Float32Array([1, 1]);
  exact(engine.wetMix(s, p, new Float32Array(2)).pixels, s);
  exact(engine.wetMix(s, p, one, { wetness: 1 }).pixels, s);
  exact(engine.wetEnvelope(s, new Float32Array(8), one, 0), s);
  exact(engine.wetEnvelope(new Float32Array(8), s, one, 1), s);
  const unchanged = engine.wetMix(s, p, one, { pickup: 0 });
  exact(unchanged.carried, p);
});
it("native scratch windows and arbitrary caller partitions retain exact deposit, pickup and envelope words", () => {
  const n = 65539,
    s = new Float32Array(n * 4),
    p = new Float32Array(n * 4),
    m = new Float32Array(n);
  for (let i = 0; i < s.length; i++) {
    s[i] = source[i % source.length];
    p[i] = carried[i % carried.length];
  }
  for (let i = 0; i < n; i++) m[i] = coverage[i % coverage.length];
  const all = engine.wetMix(s, p, m, {
      flow: 0.625,
      wetness: 0.2,
      pickup: 0.7,
    }),
    output = new Float32Array(s.length),
    next = new Float32Array(s.length),
    envelope = new Float32Array(s.length);
  for (let at = 0; at < n; at += 127) {
    const end = Math.min(n, at + 127),
      result = engine.wetMix(
        s.subarray(at * 4, end * 4),
        p.subarray(at * 4, end * 4),
        m.subarray(at, end),
        { flow: 0.625, wetness: 0.2, pickup: 0.7 },
      );
    output.set(result.pixels, at * 4);
    next.set(result.carried, at * 4);
    envelope.set(
      engine.wetEnvelope(
        s.subarray(at * 4, end * 4),
        result.pixels,
        m.subarray(at, end),
        0.375,
      ),
      at * 4,
    );
  }
  exact(output, all.pixels);
  exact(next, all.carried);
  exact(envelope, engine.wetEnvelope(s, all.pixels, m, 0.375));
});
it("overflow rejects without changing callers or disabling a private owner, including byte-kernel work between calls", () => {
  const s = new Float32Array([1, 2, 3, 1]),
    p = new Float32Array([1e38, 0, 0, 1e-30]),
    mask = new Float32Array([1]),
    before = s.slice(),
    reservoir = p.slice();
  expect(() => engine.wetMix(s, p, mask)).toThrow("float32");
  exact(s, before);
  exact(p, reservoir);
  applyTone(kernel, new Uint8ClampedArray([30, 80, 150, 255]), []);
  exact(engine.wetMix(s, engine.wetLoad(s), mask).pixels, s);
  const other = new FloatPixelProcessor(kernel);
  other.dispose();
  expect(() => other.wetLoad(s)).toThrow("disposed");
  expect(engine.wetLoad(s)).toHaveLength(4);
});
it("rejects malformed/aliased worker results and invalid request domains before publishing output", () => {
  const s = new Float32Array([1, 2, 3, 1]),
    p = engine.wetLoad(s),
    mask = new Float32Array([1]);
  for (const options of [
    null,
    { load: 2 },
    { color: [1, 2, 3] },
    { color: [1e99, 0, 0, 1] },
    { color: [0, 0, 0, 2] },
    { unknown: true },
  ])
    expect(() => engine.wetLoad(s, options as never)).toThrow();
  for (const options of [
    null,
    { flow: -1 },
    { pickup: NaN },
    { wetness: 2 },
    { unknown: true },
  ])
    expect(() => engine.wetMix(s, p, mask, options as never)).toThrow();
  for (const bad of [
    new Float32Array([1, 0, 0, 0]),
    new Float32Array([NaN, 0, 0, 1]),
    new Float32Array(8),
  ])
    expect(() => engine.wetMix(s, bad, mask)).toThrow();
  expect(() => engine.wetMix(s, p, new Float32Array([-1]))).toThrow();
  expect(() => engine.wetEnvelope(s, s, mask, Infinity)).toThrow();
  expect(() =>
    engine.wetLoad(new Float32Array(new SharedArrayBuffer(16))),
  ).toThrow();
  const ResizableBuffer = ArrayBuffer as unknown as new (
    length: number,
    options: { maxByteLength: number },
  ) => ArrayBuffer;
  expect(() =>
    engine.wetLoad(
      new Float32Array(new ResizableBuffer(16, { maxByteLength: 32 })),
    ),
  ).toThrow();
  const detached = new Float32Array(4);
  structuredClone(detached, { transfer: [detached.buffer] });
  expect(() => engine.wetLoad(detached)).toThrow();
  expect(() => validateFloatWetResult({ pixels: s, carried: s }, 4)).toThrow(
    "independent",
  );
  expect(() =>
    validateFloatWetResult({ pixels: s, carried: p, extra: true }, 4),
  ).toThrow();
  expect(() =>
    validateFloatWetResult(
      { pixels: new Float32Array(8).subarray(0, 4), carried: p },
      4,
    ),
  ).toThrow("complete");
  exact(engine.wetLoad(new Float32Array()), new Float32Array());
});
it("all independent fixture, raw and generator identities are verified", async () => {
  for (const [name, entry] of Object.entries(manifest.files) as [
    string,
    { bytes: number; sha256: string; rawSha256: string },
  ][]) {
    const bytes = await readFile(base + name + ".f32le.gz");
    expect(bytes.length).toBe(entry.bytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(entry.sha256);
    expect(createHash("sha256").update(gunzipSync(bytes)).digest("hex")).toBe(
      entry.rawSha256,
    );
  }
  expect(
    createHash("sha256")
      .update(await readFile("scripts/generate-float-wet-fixtures.py"))
      .digest("hex"),
  ).toBe(manifest.generatorSha256);
});
