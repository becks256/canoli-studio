import { beforeAll, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { textureMaskOptionsSchema, brushTextureSourceSchema, textureSample } from '../src/core/brush-texture';
import { instantiateKernel, prepareBrushTexture, type PixelKernel } from '../src/engine/wasm';

let kernel: PixelKernel;
beforeAll(async () => { kernel = await instantiateKernel(new Uint8Array(await readFile('public/wasm/pixels.wasm'))); });

it('actual WASM matches an independent luminance/alpha reference over all alpha values, colors and inversion', () => {
  const source = new Uint8ClampedArray(65536 * 4);
  let seed = 81171;
  for (let i = 0; i < source.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    source[i] = i % 4 === 3 ? (i >>> 2) % 256 : seed >>> 24;
  }
  const original = source.slice();
  for (const channel of ['alpha', 'luminance'] as const) for (const invert of [false, true]) {
    const actual = prepareBrushTexture(kernel, source, { channel, invert });
    for (let i = 0; i < source.length; i += 4) {
      const brightness = (source[i] * .2126 + source[i + 1] * .7152 + source[i + 2] * .0722) / 255;
      const coverage = channel === 'alpha' ? (invert ? 255 - source[i + 3] : source[i + 3]) :
        Math.round(source[i + 3] * (invert ? brightness : 1 - brightness));
      // Use exact integer arithmetic to resolve only the floating-point half ties.
      const integer = source[i] * 2126 + source[i + 1] * 7152 + source[i + 2] * 722;
      const exact = channel === 'alpha' ? coverage : Math.floor((source[i + 3] * (invert ? integer : 2550000 - integer) + 1275000) / 2550000);
      expect(Math.abs(exact - coverage)).toBeLessThanOrEqual(1);
      if (actual[i] !== 255 || actual[i + 1] !== 255 || actual[i + 2] !== 255 || actual[i + 3] !== exact)
        throw new Error(`Texture mismatch at ${i / 4}: ${channel}, invert=${invert}, ${actual.slice(i, i + 4)} expected alpha ${exact}`);
    }
    expect(source).toEqual(original);
    actual.fill(0);
  }
});

it('black/white/color coverage and transparent luminance have explicit endpoint behavior', () => {
  const source = new Uint8ClampedArray([0,0,0,255, 255,255,255,255, 255,0,0,128, 0,0,0,0, 255,255,255,0]);
  const alpha = (settings = {}) => [...prepareBrushTexture(kernel, source, settings)].filter((_, i) => i % 4 === 3);
  expect(alpha()).toEqual([255, 0, 101, 0, 0]);
  expect(alpha({ invert: true })).toEqual([0, 255, 27, 0, 0]);
  expect(alpha({ channel: 'alpha' })).toEqual([255, 255, 128, 0, 0]);
  expect(alpha({ channel: 'alpha', invert: true })).toEqual([0, 0, 127, 255, 255]);
});

it('growing actual WASM memory rebinds views and returned tiles do not alias later conversions', () => {
  const small = prepareBrushTexture(kernel, new Uint8ClampedArray([0,0,0,128]));
  const before = kernel.memory.buffer.byteLength;
  const source = new Uint8ClampedArray(4_000_000);
  for (let i = 3; i < source.length; i += 4) source[i] = 53;
  const result = prepareBrushTexture(kernel, source, { channel: 'alpha' });
  expect(kernel.memory.buffer.byteLength).toBeGreaterThan(before);
  expect(result.length).toBe(source.length);
  expect([...result.slice(-4)]).toEqual([255,255,255,53]);
  expect([...small]).toEqual([255,255,255,128]);
  expect([...source.slice(-4)]).toEqual([0,0,0,53]);
});

it('texture conversion rejects malformed/options/oversized working tiles and recovers', () => {
  for (const pixels of [new Uint8ClampedArray(3), new Uint8ClampedArray(16_000_004)])
    expect(() => prepareBrushTexture(kernel, pixels)).toThrow(/RGBA/);
  for (const options of [{ channel: 'rgb' }, { invert: 1 }, { extra: true }, null])
    expect(() => prepareBrushTexture(kernel, new Uint8ClampedArray(4), options as never)).toThrow();
  expect(prepareBrushTexture(kernel, new Uint8ClampedArray())).toHaveLength(0);
  expect([...prepareBrushTexture(kernel, new Uint8ClampedArray([0,0,0,255]))]).toEqual([255,255,255,255]);
});

it('actual WASM inverts alpha within projected image support without creating opaque-edge halos or mutating inputs',()=>{
  const input=new Uint8ClampedArray([20,40,60,0,20,40,60,64,20,40,60,128,20,40,60,200]);
  const support=new Uint8ClampedArray([0,0,0,0,0,0,0,64,0,0,0,200,0,0,0,128]);
  const before=input.slice(),supportBefore=support.slice();
  expect([...prepareBrushTexture(kernel,input,{channel:'alpha',invert:true},support)].filter((_,i)=>i%4===3)).toEqual([0,0,72,0]);
  expect(input).toEqual(before);expect(support).toEqual(supportBefore);
  expect(()=>prepareBrushTexture(kernel,input,{channel:'alpha',invert:true},new Uint8ClampedArray(4))).toThrow(/support/);
});

it('source and sampling validation own inputs without limiting source geometry or bytes', () => {
  expect(textureMaskOptionsSchema.parse({})).toEqual({ channel: 'luminance', invert: false });
  expect(brushTextureSourceSchema.parse({ assetId: 'original' })).toEqual({ assetId: 'original', channel: 'luminance', invert: false });
  const input = { width: 64, height: 32, sourceRect: { x: 99990, y: 1, width: 10, height: 2 } };
  const checked = textureSample({ width: 100000, height: 50000 }, input);
  input.sourceRect.x = 0;
  expect(checked.sourceRect.x).toBe(99990);
  expect(textureSample({ width: Number.MAX_SAFE_INTEGER, height: 50_000 }, { width: 2, height: 2 }).sourceRect.width).toBe(Number.MAX_SAFE_INTEGER);
  expect(textureSample({ width: 10000, height: 5000 }, { width: 2000, height: 1000 }).sourceRect).toEqual({ x: 0, y: 0, width: 10000, height: 5000 });
});

it('invalid native crop geometry and working allocations reject before sampling', () => {
  const source = { width: 10000, height: 5000 };
  for (const input of [
    { width: 4096, height: 4096 }, { width: 4097, height: 1 }, { width: 1.5, height: 1 },
    { width: 1, height: 0 }, { width: Infinity, height: 1 }, { width: 1, height: 1, extra: true },
    ...[{x:-1,y:0,width:1,height:1}, {x:0,y:0,width:0,height:1}, {x:9999,y:0,width:2,height:1},
      {x:0,y:4999,width:1,height:2}, {x:0,y:0,width:NaN,height:1}, {x:0,y:0,width:1,height:1,extra:true}]
      .map(sourceRect => ({ width: 1, height: 1, sourceRect })),
  ]) expect(() => textureSample(source, input)).toThrow();
  expect(() => textureSample({ width: Number.MAX_SAFE_INTEGER, height: 1 }, {
    width:1,height:1,sourceRect:{x:Number.MAX_SAFE_INTEGER-1,y:0,width:.1,height:1},
  })).toThrow(/representable/);
  expect(() => textureSample({ width: NaN, height: 1 }, { width:1,height:1 })).toThrow(/source dimensions/);
});
