import { beforeAll, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { wetPaintLoadSchema, wetPaintMixSchema, type WetPaintMixOptions } from '../src/core/wet-paint';
import { loadWetPaint, mixWetPaint, validateWetCarried } from '../src/engine/wet-paint';
import { instantiateKernel, mixFiltered, type PixelKernel } from '../src/engine/wasm';

let kernel: PixelKernel;
beforeAll(async () => { kernel = await instantiateKernel(new Uint8Array(await readFile('public/wasm/pixels.wasm'))); });
const rgba = (...values: number[]) => new Uint8ClampedArray(values);

it('initial pickup ignores hidden RGB; loaded color and source combine in premultiplied space', () => {
  const source = rgba(20, 240, 70, 0, 255, 0, 0, 128);
  expect([...loadWetPaint(kernel, source).slice(0, 4)]).toEqual([0, 0, 0, 0]);
  const loaded = loadWetPaint(kernel, source, { color: [0, 0, 255, 64], load: .5 });
  expect(loaded[0]).toBe(0);
  expect(loaded[2]).toBeCloseTo(32 / 255, 7);
  expect(loaded[3]).toBeCloseTo(32 / 255, 7);
  expect(loaded[4]).toBeCloseTo(64 / 255, 7);
  expect(loaded[6]).toBeCloseTo(32 / 255, 7);
  expect(loaded[7]).toBeCloseTo(96 / 255, 7);
  const full = loadWetPaint(kernel, source, { color: [0, 0, 255, 64], load: 1 });
  expect([...full.slice(0, 4)]).toEqual([...full.slice(4)]);
  expect([...source]).toEqual([20, 240, 70, 0, 255, 0, 0, 128]);
});

it('smudge deposits captured color and alpha into empty pixels and carries transparency back into paint', () => {
  const red = rgba(255, 0, 0, 255), clear = rgba(13, 117, 249, 0);
  const carried = loadWetPaint(kernel, red);
  const outward = mixWetPaint(kernel, clear, carried, new Uint8Array([255]), { pickup: 0 });
  expect([...outward.pixels]).toEqual([255, 0, 0, 255]);
  expect(outward.carried).toEqual(carried);
  const inward = mixWetPaint(kernel, red, loadWetPaint(kernel, clear), new Uint8Array([255]), { pickup: 0 });
  expect([...inward.pixels]).toEqual([0, 0, 0, 0]);
  const partial = mixWetPaint(kernel, clear, carried, new Uint8Array([128]), { pickup: 0 });
  expect([...partial.pixels]).toEqual([255, 0, 0, 128]);
});

it('mixer pigment comes from its finite carried load and acquires pre-deposit canvas color', () => {
  const blue = rgba(0, 0, 255, 255), clear = rgba(0, 0, 0, 0);
  const loaded = loadWetPaint(kernel, clear, { color: [255, 0, 0, 255], load: 1 });
  const first = mixWetPaint(kernel, blue, loaded, new Uint8Array([255]), { pickup: .5, wetness: .25 });
  expect([...first.pixels]).toEqual([191, 0, 64, 255]);
  expect([...first.carried]).toEqual([.5, 0, .5, 1]);
  const second = mixWetPaint(kernel, clear, first.carried, new Uint8Array([255]), { pickup: 1 });
  expect([...second.pixels]).toEqual([128, 0, 128, 255]);
  expect([...second.carried]).toEqual([0, 0, 0, 0]);
  const exhausted = mixWetPaint(kernel, clear, second.carried, new Uint8Array([255]));
  expect([...exhausted.pixels]).toEqual([0, 0, 0, 0]);
});

it('premultiplied interpolation avoids hidden-color halos at fractional alpha', () => {
  const empty = rgba(0, 0, 255, 0), red = loadWetPaint(kernel, rgba(255, 0, 0, 128));
  expect([...mixWetPaint(kernel, empty, red, new Uint8Array([255]), { flow: .5 }).pixels]).toEqual([255, 0, 0, 64]);
  const lifted = mixWetPaint(kernel, rgba(255, 0, 0, 128), new Float32Array(4), new Uint8Array([255]), { flow: .5 });
  expect([...lifted.pixels]).toEqual([255, 0, 0, 64]);
});

it('whole-stroke opacity and selection mix the accumulated result once instead of attenuating each dab', () => {
  const original = rgba(0, 0, 0, 0), loaded = loadWetPaint(kernel, original, { color: [255, 0, 0, 255], load: 1 });
  let pixels: Uint8ClampedArray = original;
  for (let dab = 0; dab < 2; dab++) pixels = mixWetPaint(kernel, pixels, loaded, new Uint8Array([255]), { flow: .5, pickup: 0 }).pixels;
  expect([...pixels]).toEqual([255, 0, 0, 192]);
  const opacity = mixFiltered(kernel, original, pixels, rgba(0, 0, 0, 128));
  expect([...opacity]).toEqual([255, 0, 0, 96]);
  const selected = mixFiltered(kernel, original, pixels, rgba(0, 0, 0, 64));
  expect([...selected]).toEqual([255, 0, 0, 48]);
});

it('zero flow/coverage is an exact no-op; full wetness picks up without changing destination bytes', () => {
  const source = rgba(7, 111, 249, 0, 255, 0, 0, 255), carried = loadWetPaint(kernel, rgba(0, 255, 0, 255, 0, 255, 0, 255));
  for (const [coverage, options] of [[new Uint8Array([0, 0]), {}], [new Uint8Array([255, 255]), { flow: 0 }]] as const) {
    const output = mixWetPaint(kernel, source, carried, coverage, options);
    expect(output.pixels).toEqual(source); expect(output.carried).toEqual(carried);
  }
  const wet = mixWetPaint(kernel, source, carried, new Uint8Array([255, 255]), { wetness: 1, pickup: 1 });
  expect(wet.pixels).toEqual(source);
  expect([...wet.carried]).toEqual([0, 0, 0, 0, 1, 0, 0, 1]);
});

it('sub-byte pickup survives many dabs instead of disappearing through 8-bit reservoir rounding', () => {
  const blue = rgba(0, 0, 255, 255);
  let carried: Float32Array = new Float32Array(4);
  for (let i = 0; i < 1000; i++) carried = mixWetPaint(kernel, blue, carried, new Uint8Array([1]), { flow: .01, wetness: 1, pickup: .25 }).carried;
  const expected = 1 - (1 - .01 / 255 * .25) ** 1000;
  expect(carried[3]).toBeCloseTo(expected, 7);
  expect(carried[2]).toBe(carried[3]);
  expect(carried[3]).toBeGreaterThan(.009);
});

it('actual WASM agrees with independent weighted RGBA equations across every source alpha and coverage', () => {
  const count = 256 * 256, pixels = new Uint8ClampedArray(count * 4), carried = new Float32Array(count * 4), mask = new Uint8Array(count);
  let seed = 71913;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let i = 0; i < count; i++) {
    pixels.set([Math.floor(random() * 256), Math.floor(random() * 256), Math.floor(random() * 256), i % 256], i * 4);
    carried[i * 4 + 3] = random();
    for (let c = 0; c < 3; c++) carried[i * 4 + c] = random() * carried[i * 4 + 3];
    mask[i] = Math.floor(i / 256);
  }
  for (const options of [{}, { flow: .17, wetness: .28, pickup: .63 }, { flow: 1, wetness: 1, pickup: 1 }, { flow: 0 }, { flow: .00001, pickup: .0001 }] satisfies WetPaintMixOptions[]) {
    const settings = wetPaintMixSchema.parse(options), actual = mixWetPaint(kernel, pixels, carried, mask, options);
    validateWetCarried(actual.carried, pixels.length);
    for (let i = 0; i < count; i++) {
      const p = i * 4, amount = settings.flow * mask[i] / 255;
      const sourceWeight = 1 - amount * (1 - settings.wetness), carryWeight = 1 - sourceWeight;
      const sourceAlpha = pixels[p + 3] / 255, resultAlpha = sourceAlpha * sourceWeight + carried[p + 3] * carryWeight;
      const expectedAlpha = Math.round(resultAlpha * 255), acquire = settings.pickup * amount;
      if (Math.abs(actual.pixels[p + 3] - expectedAlpha) > 1) throw new Error(`Alpha mismatch at ${i}`);
      for (let c = 0; c < 3; c++) {
        const source = pixels[p + c] / 255 * sourceAlpha;
        const expected = !amount || settings.wetness === 1 ? pixels[p + c] : !expectedAlpha ? 0 : Math.round((source * sourceWeight + carried[p + c] * carryWeight) / resultAlpha * 255);
        if (Math.abs(actual.pixels[p + c] - expected) > 1) throw new Error(`Color mismatch at ${i}, component ${c}`);
        const next = carried[p + c] * (1 - acquire) + source * acquire;
        if (Math.abs(actual.carried[p + c] - next) > 1e-7) throw new Error(`Pickup mismatch at ${i}, component ${c}`);
      }
      if (Math.abs(actual.carried[p + 3] - (carried[p + 3] * (1 - acquire) + sourceAlpha * acquire)) > 1e-7) throw new Error(`Carried alpha mismatch at ${i}`);
    }
  }
});

it('dab tile partitioning and processing order preserve exact native pixels and reservoir state', () => {
  const count = 1903, pixels = Uint8ClampedArray.from({ length: count * 4 }, (_, i) => i * 73 % 256), sample = Uint8ClampedArray.from(pixels, (_, i) => (i * 17 + 37) % 256);
  const carried = loadWetPaint(kernel, sample, { color: [87, 23, 179, 169], load: .39 }), mask = Uint8Array.from({ length: count }, (_, i) => i * 19 % 256);
  const options = { flow: .61, wetness: .2, pickup: .31 }, whole = mixWetPaint(kernel, pixels, carried, mask, options);
  const assembled = { pixels: new Uint8ClampedArray(count * 4), carried: new Float32Array(count * 4) };
  for (let end = count; end > 0;) {
    const start = Math.max(0, end - 71), result = mixWetPaint(kernel, pixels.subarray(start * 4, end * 4), carried.subarray(start * 4, end * 4), mask.subarray(start, end), options);
    assembled.pixels.set(result.pixels, start * 4); assembled.carried.set(result.carried, start * 4); end = start;
  }
  expect(assembled).toEqual(whole);
});

it('working memory growth and subsequent jobs cannot alter earlier results or caller subarrays', () => {
  const backing = rgba(99, 99, 99, 99, 255, 0, 0, 255, 88, 88, 88, 88), source = backing.subarray(4, 8);
  const carried = loadWetPaint(kernel, source), mask = new Uint8Array([128]);
  const first = mixWetPaint(kernel, rgba(0, 0, 0, 0), carried, mask), retained = first.carried.slice(), before = kernel.memory.buffer.byteLength;
  const large = new Uint8ClampedArray(1_048_576 * 4);
  const bigCarry = loadWetPaint(kernel, large, { color: [0, 255, 0, 255], load: 1 });
  const big = mixWetPaint(kernel, large, bigCarry, new Uint8Array(1_048_576).fill(255));
  expect(kernel.memory.buffer.byteLength).toBeGreaterThan(before);
  expect([...big.pixels.slice(-4)]).toEqual([0, 255, 0, 255]);
  expect(first.carried).toEqual(retained); expect([...first.pixels]).toEqual([255, 0, 0, 128]);
  expect([...backing]).toEqual([99, 99, 99, 99, 255, 0, 0, 255, 88, 88, 88, 88]);
  expect([...carried]).toEqual([1, 0, 0, 1]); expect([...mask]).toEqual([128]);
  expect(large.every(value => value === 0)).toBe(true);
});

it('invalid options, reservoir channels and extents reject before processing and later work still succeeds', () => {
  const pixels = rgba(255, 0, 0, 255), carried = new Float32Array([1, 0, 0, 1]), mask = new Uint8Array([255]);
  for (const options of [{ flow: -1 }, { wetness: NaN }, { pickup: Infinity }, { pickup: 2 }, { unknown: true }, null]) expect(() => mixWetPaint(kernel, pixels, carried, mask, options as never)).toThrow();
  for (const options of [{ load: 2 }, { color: [1, 2, 3] }, { color: [1.5, 2, 3, 4] }, { color: [1, 2, 3, 256] }, { unknown: true }]) expect(() => loadWetPaint(kernel, pixels, options as never)).toThrow();
  for (const reservoir of [[NaN, 0, 0, 1], [0, 0, 0, Infinity], [1, 0, 0, .5], [-.1, 0, 0, 1], [0, 0, 0, -1], [0, 0, 0, 1.1]]) expect(() => mixWetPaint(kernel, pixels, new Float32Array(reservoir), mask)).toThrow();
  expect(() => mixWetPaint(kernel, pixels, new Float32Array(8), mask)).toThrow(/matching/);
  expect(() => mixWetPaint(kernel, pixels, carried, new Uint8Array(2))).toThrow(/coverage/);
  expect(() => loadWetPaint(kernel, new Uint8ClampedArray(3))).toThrow(/RGBA/);
  expect(() => loadWetPaint(kernel, new Uint8ClampedArray(16_000_004))).toThrow(/working/);
  expect(() => loadWetPaint(kernel, new Uint8Array(4) as never)).toThrow(/RGBA/);
  expect(wetPaintLoadSchema.parse({})).toEqual({ color: [0, 0, 0, 255], load: 0 });
  expect(wetPaintMixSchema.parse({})).toEqual({ flow: 1, wetness: 0, pickup: .5 });
  expect([...mixWetPaint(kernel, pixels, carried, mask).pixels]).toEqual([...pixels]);
  expect(loadWetPaint(kernel, new Uint8ClampedArray())).toHaveLength(0);
  expect(mixWetPaint(kernel, new Uint8ClampedArray(), new Float32Array(), new Uint8Array()).pixels).toHaveLength(0);
});
