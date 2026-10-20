import { beforeAll, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { AffineTransform, BrushStroke, BrushSymmetry, MarqueeSelection, PencilStroke } from '../src/dom';
import type { BrushStrokeData, Rect } from '../src/core/drawing';
import { createWetStrokeSession } from '../src/engine/wet-session';
import { prepareWetStroke, type WetStrokeResult } from '../src/engine/wet-stroke';
import type { WetTile, WetTileStore } from '../src/engine/wet-store';
import { instantiateKernel, mixFiltered, prepareBrushTexture, renderSelection, type PixelKernel } from '../src/engine/wasm';
import { loadWetPaint, mixWetPaint } from '../src/engine/wet-paint';

let kernel: PixelKernel;
beforeAll(async () => { kernel = await instantiateKernel(new Uint8Array(await readFile('public/wasm/pixels.wasm'))); });
class MemoryStore implements WetTileStore {
  data = new Map<string, WetTile>(); closed = false;
  async get(key: string) { if (this.closed) throw new Error('closed'); return this.data.get(key)?.slice(); }
  async put(key: string, value: WetTile) { if (this.closed) throw new Error('closed'); this.data.set(key, value.slice()); }
  async remove(key: string) { if (this.closed) throw new Error('closed'); this.data.delete(key); }
  async dispose() { this.closed = true; this.data.clear(); }
}
function stores() { const values: MemoryStore[] = []; return { values, storage: async () => { const store = new MemoryStore(); values.push(store); return store; } }; }
const processor = {
  loadWetPaint: async (...args: Parameters<typeof loadWetPaint> extends [PixelKernel, ...infer P] ? P : never) => loadWetPaint(kernel, ...args),
  mixWetPaint: async (...args: Parameters<typeof mixWetPaint> extends [PixelKernel, ...infer P] ? P : never) => mixWetPaint(kernel, ...args),
  mixFiltered: async (...args: Parameters<typeof mixFiltered> extends [PixelKernel, ...infer P] ? P : never) => mixFiltered(kernel, ...args),
  selection: async (tile: Parameters<typeof renderSelection>[1]) => renderSelection(kernel, tile),
  brushTexture: async (...args: Parameters<typeof prepareBrushTexture> extends [PixelKernel, ...infer P] ? P : never) => prepareBrushTexture(kernel, ...args),
};
const coverage = async (stroke: BrushStrokeData, frame: AffineTransform, region: Rect) => {
  const inverse = frame.inverse(), values = new Uint8Array(region.width * region.height);
  for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width; x++) { const p = inverse.point({ x: region.x + x + .5, y: region.y + y + .5 }); if (stroke.kind === 'pencil' ? p.x >= -1 && p.x < 1 && p.y >= -1 && p.y < 1 : p.x * p.x + p.y * p.y < 1) values[y * region.width + x] = 255; }
  return values;
};
const source = async (region: Rect) => { const values = new Uint8ClampedArray(region.width * region.height * 4); for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width; x++) { const xx = region.x + x, yy = region.y + y; if (yy >= 3 && yy <= 5 && xx >= 2 && xx <= 4) values.set([[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]][xx - 2], (y * region.width + x) * 4); } return values; };
async function pixels(result: WetStrokeResult) { const values: Record<string, number[]> = {}; for await (const tile of result.tiles()) for (let y = 0; y < tile.region.height; y++) for (let x = 0; x < tile.region.width; x++) if (tile.changed[y * tile.region.width + x]) values[`${tile.region.x + x},${tile.region.y + y}`] = [...tile.pixels.slice((y * tile.region.width + x) * 4, (y * tile.region.width + x + 1) * 4)]; return values; }
const initial = () => new PencilStroke({ size: 3, pressureSize: false, points: [{ x: 3.5, y: 4.5 }, { x: 4.5, y: 4.5 }] }).toJSON();

it('appends only new dabs, reads each original region once and keeps prior snapshots immutable', async () => {
  const backing = stores(), reads = new Map<string, number>(); let loads = 0, mixes = 0;
  const session = await createWetStrokeSession(initial(), async region => { const key = `${region.x},${region.y}`; reads.set(key, (reads.get(key) ?? 0) + 1); return source(region); }, { ...processor, loadWetPaint: async (...args) => { loads++; return processor.loadWetPaint(...args); }, mixWetPaint: async (...args) => { mixes++; return processor.mixWetPaint(...args); } }, { tileSize: 8, cacheBytes: 0, coverage, storage: backing.storage, mix: { pickup: 0 } });
  const prefix = await session.snapshot(), before = await pixels(prefix), capturedLoads = loads, firstMixes = mixes;
  expect(before['5,4']).toEqual([0, 0, 255, 255]);
  const batch = [{ x: 6.5, y: 4.5, pressure: 1 }], pending = session.append(batch); batch[0].x = 999; await pending;
  const final = await session.finish(); await session.dispose();
  try {
    const values = await pixels(final); expect(values['5,4']).toEqual([255, 0, 0, 255]); expect(values['6,4']).toEqual([0, 255, 0, 255]); expect(values['7,4']).toEqual([0, 0, 255, 255]); expect(await pixels(prefix)).toEqual(before);
    expect(final.diagnostics.dabs).toBe(4); expect(session.diagnostics.completedPoints).toBe(3); expect(loads).toBe(capturedLoads); expect(mixes).toBeGreaterThan(firstMixes); expect([...reads.values()].every(count => count === 1)).toBe(true);
    expect(session.stroke.points.at(-1)!.x).toBe(6.5); expect(backing.values.every(store => !store.closed)).toBe(true);
    expect([...backing.values[0].data.keys()].every(key => key.startsWith('original/') || key.startsWith('result/'))).toBe(true);
  } finally { await prefix.dispose(); await final.dispose(); }
  expect(backing.values.every(store => store.closed && store.data.size === 0)).toBe(true);
});

it('queued appends and snapshots preserve prefix order without reapplying whole-stroke opacity or selection', async () => {
  const data = new PencilStroke({ size: 1, pressureSize: false, opacity: .5, clip: new MarqueeSelection({ shape: 'rectangle', x: 4, y: 4, width: 4, height: 1 }), points: [{ x: 3.5, y: 4.5 }] }).toJSON(), backing = stores();
  const session = await createWetStrokeSession(data, source, processor, { tileSize: 8, coverage, storage: backing.storage, mix: { pickup: 0 } });
  const a = session.append([{ x: 4.5, y: 4.5, pressure: 1 }]), first = session.snapshot(), b = session.append([{ x: 6.5, y: 4.5, pressure: 1 }]), second = session.snapshot(); await Promise.all([a, b]);
  const prefix = await first, later = await second, final = await session.finish(); await session.dispose();
  const reference = await prepareWetStroke({ ...data, points: [...data.points, { x: 4.5, y: 4.5, pressure: 1 }, { x: 6.5, y: 4.5, pressure: 1 }] }, source, processor, { tileSize: 8, coverage, storage: stores().storage, mix: { pickup: 0 } });
  try { expect(prefix.diagnostics.dabs).toBe(2); expect(later.diagnostics.dabs).toBe(4); expect(await pixels(later)).toEqual(await pixels(reference)); expect(await pixels(final)).toEqual(await pixels(reference)); expect(final.diagnostics.dabs).toBe(4); }
  finally { await prefix.dispose(); await later.dispose(); await final.dispose(); await reference.dispose(); }
});

it('append batching and cache/tile partitions preserve tilted pressure/affine overlapping symmetry', async () => {
  const data = new BrushStroke({ size: 5, spacing: .3, opacity: .7, flow: .6, pressureOpacity: true, pressureSize: true, tip: { roundness: .5, angle: 23, tiltAngle: true }, symmetry: new BrushSymmetry({ copies: [new AffineTransform(-1, .2, .1, 1, 8, 0).toJSON()] }), points: [{ x: 1, y: 2, pressure: .4, tilt: { altitude: .4, azimuth: .2 } }, { x: 7, y: 4, pressure: 1, tilt: { altitude: .8, azimuth: 1 } }, { x: 4, y: 8, pressure: .6, tilt: { altitude: .5, azimuth: 2 } }] }).toJSON();
  const transform = new AffineTransform(1.1, .2, .1, .9, -.5, 1.5), reference = await prepareWetStroke(data, source, processor, { transform, tileSize: 16, coverage, storage: stores().storage });
  const session = await createWetStrokeSession({ ...data, points: data.points.slice(0, 1) }, source, processor, { transform, tileSize: 8, cacheBytes: 0, coverage, storage: stores().storage });
  await session.append(data.points.slice(1, 2)); const middle = await session.snapshot(); await session.append(data.points.slice(2)); const final = await session.finish(); await session.dispose();
  try { expect(await pixels(final)).toEqual(await pixels(reference)); expect(final.diagnostics.dabs).toBe(reference.diagnostics.dabs); expect(final.diagnostics.peakCacheBytes).toBe(0); expect(middle.diagnostics.dabs).toBeLessThan(final.diagnostics.dabs); }
  finally { await middle.dispose(); await final.dispose(); await reference.dispose(); }
});

it('idle abort disposes the workspace but preserves independently owned completed snapshots', async () => {
  const backing = stores(), abort = new AbortController(), session = await createWetStrokeSession(initial(), source, processor, { tileSize: 8, coverage, storage: backing.storage, signal: abort.signal });
  const snapshot = await session.snapshot(), before = await pixels(snapshot); abort.abort(new Error('Stop retained stroke')); await session.dispose();
  expect(backing.values[0].closed).toBe(true); expect(backing.values[1].closed).toBe(false); expect(await pixels(snapshot)).toEqual(before); await expect(session.append([{ x: 5, y: 4, pressure: 1 }])).rejects.toThrow('Stop retained stroke'); await snapshot.dispose();
});

it('quota failure during snapshot closes only new private work and leaves earlier snapshots readable', async () => {
  const backing = stores(), storage = async () => { const store = await backing.storage(); if (backing.values.length === 3) store.put = async () => { throw new Error('Quota exhausted'); }; return store; };
  const session = await createWetStrokeSession(initial(), source, processor, { tileSize: 8, coverage, storage }); const snapshot = await session.snapshot(), before = await pixels(snapshot);
  await session.append([{ x: 6.5, y: 4.5, pressure: 1 }]); await expect(session.snapshot()).rejects.toThrow('Quota exhausted'); await session.dispose();
  expect(backing.values.map(store => store.closed)).toEqual([true, false, true]); expect(await pixels(snapshot)).toEqual(before); await snapshot.dispose();
});

it('invalid batches do not mutate the workspace and finishing rejects late work without closing its result', async () => {
  const backing = stores(), session = await createWetStrokeSession(initial(), source, processor, { tileSize: 8, coverage, storage: backing.storage }); const before = session.stroke;
  await expect(session.append([{ x: NaN, y: 4, pressure: 1 }])).rejects.toThrow(); expect(session.stroke).toEqual(before);
  const final = await session.finish(); await expect(session.append([{ x: 5, y: 4, pressure: 1 }])).rejects.toThrow(/finishing|disposed/); await expect(session.snapshot()).rejects.toThrow(); await expect(session.finish()).rejects.toThrow(); await session.dispose(); expect(backing.values[0].closed).toBe(false); await expect(pixels(final)).resolves.toBeDefined(); await final.dispose();
});

it('reuses unchanged projections and cropped snapshots do not crop spatial transport or final output', async () => {
  const backing = stores(); let projections = 0;
  const session = await createWetStrokeSession(initial(), source, { ...processor, mixFiltered: async (...args) => { projections++; return processor.mixFiltered(...args); } }, { tileSize: 8, cacheBytes: 0, coverage, storage: backing.storage, mix: { pickup: 0 } });
  const first = await session.snapshot({ x: 5, y: 4, width: 1, height: 1 }), count = projections, second = await session.snapshot({ x: 5, y: 4, width: 1, height: 1 });
  expect(projections).toBe(count); expect(await pixels(first)).toEqual({ '5,4': [0, 0, 255, 255] }); expect(await pixels(second)).toEqual(await pixels(first)); expect((await first.tiles({ x: 20, y: 20, width: 1, height: 1 }).next()).done).toBe(true);
  await session.append([{ x: 6.5, y: 4.5, pressure: 1 }]); const outside = await session.snapshot({ x: 40, y: 40, width: 2, height: 2 }); expect(await pixels(outside)).toEqual({}); const final = await session.finish(); await session.dispose();
  try { const output = await pixels(final); expect(output['5,4']).toEqual([255, 0, 0, 255]); expect(output['7,4']).toEqual([0, 0, 255, 255]); expect(await pixels(first)).toEqual({ '5,4': [0, 0, 255, 255] }); }
  finally { await first.dispose(); await second.dispose(); await outside.dispose(); await final.dispose(); }
});

it('rejects a reused snapshot store without closing the previously owned snapshot', async () => {
  const backing = stores(); let calls = 0;
  const session = await createWetStrokeSession(initial(), source, processor, { tileSize: 8, coverage, storage: async () => ++calls <= 2 ? backing.storage() : backing.values[1] });
  const snapshot = await session.snapshot(), before = await pixels(snapshot); await expect(session.snapshot()).rejects.toThrow(/fresh private/); await session.dispose(); expect(backing.values.map(store => store.closed)).toEqual([true, false]); expect(await pixels(snapshot)).toEqual(before); await snapshot.dispose();
});

it('reserves the existing recorded-point budget across queued batches without reading inert source pixels', async () => {
  const backing = stores(), session = await createWetStrokeSession({ ...initial(), flow: 0 }, async () => { throw new Error('Inert flow must not read the source'); }, processor, { tileSize: 8, coverage, storage: backing.storage });
  const pending = session.append(Array.from({ length: 19998 }, () => ({ x: 4.5, y: 4.5, pressure: 1 }))); await expect(session.append([{ x: 5, y: 4, pressure: 1 }])).rejects.toThrow(/20000/); await pending;
  expect(session.stroke.points).toHaveLength(20000); const final = await session.finish(); await session.dispose(); expect(await pixels(final)).toEqual({}); expect(final.diagnostics.dabs).toBe(0); await final.dispose();
});

it('a stale captured source invalidates pending work while keeping an owned earlier prefix', async () => {
  const backing = stores(); let alive = true;
  const session = await createWetStrokeSession(initial(), source, processor, { tileSize: 8, coverage, storage: backing.storage, check: () => { if (!alive) throw new Error('Source changed'); } });
  const snapshot = await session.snapshot(), before = await pixels(snapshot); alive = false; await expect(session.append([{ x: 5, y: 4, pressure: 1 }])).rejects.toThrow('Source changed'); await session.dispose(); expect(await pixels(snapshot)).toEqual(before); expect(backing.values.map(store => store.closed)).toEqual([true, false]); await snapshot.dispose();
});

it('delta projections capture reuse epochs and preserve complete independently owned snapshots', async () => {
  const backing = stores(), brush = new PencilStroke({ size: 1, pressureSize: false, points: [{ x: 4.5, y: 4.5 }], color: '#ff0000' }).toJSON();
  const session = await createWetStrokeSession(brush, async region => new Uint8ClampedArray(region.width * region.height * 4), processor, { tileSize: 8, coverage, storage: backing.storage, load: { color: [255, 0, 0, 255], load: 1 }, mix: { pickup: 0 } });
  const first = await session.snapshot(), epochs = new Map<string, string>();
  for await (const tile of first.tiles()) { expect(tile.epoch).toBeTruthy(); epochs.set(`${tile.region.x},${tile.region.y}`, tile.epoch!); }
  const pending = session.snapshotSince(epochs); epochs.clear();
  const delta = await pending, complete = await session.snapshot(), final = await session.finish(); await session.dispose();
  try {
    expect(delta.reused).toHaveLength(1); expect(Object.isFrozen(delta.reused)).toBe(true); expect(Object.isFrozen(delta.reused[0].region)).toBe(true);
    expect(await pixels(delta.result)).toEqual({}); expect(delta.result.diagnostics.resultTiles).toBe(0);
    expect(await pixels(complete)).toEqual(await pixels(first)); expect(await pixels(final)).toEqual(await pixels(first));
    expect(Object.keys(await pixels(final))).toHaveLength(1);
  } finally { await first.dispose(); await delta.result.dispose(); await complete.dispose(); await final.dispose(); }
  expect(backing.values.every(store => store.closed)).toBe(true);
});

it('delta projections omit reverted tiles instead of retaining stale prepared ink', async () => {
  const backing = stores(); let clear = false;
  const session = await createWetStrokeSession(new PencilStroke({ size: 1, pressureSize: false, points: [{ x: 4.5, y: 4.5 }] }).toJSON(), async region => new Uint8ClampedArray(region.width * region.height * 4), {
    ...processor, mixWetPaint: async (...args) => { const result = await processor.mixWetPaint(...args); return clear ? { pixels: new Uint8ClampedArray(result.pixels.length), carried: result.carried } : result; },
  }, { tileSize: 8, coverage, storage: backing.storage, load: { color: [255, 0, 0, 255], load: 1 }, mix: { pickup: 0 } });
  const first = await session.snapshot(), epochs = new Map<string, string>();
  for await (const tile of first.tiles()) epochs.set(`${tile.region.x},${tile.region.y}`, tile.epoch!);
  clear = true; await session.append([{ x: 5.5, y: 4.5, pressure: 1 }]);
  const delta = await session.snapshotSince(epochs), final = await session.finish(); await session.dispose();
  try {
    expect(Object.keys(await pixels(first))).toHaveLength(1);
    expect(delta.reused).toEqual([]); expect(await pixels(delta.result)).toEqual({}); expect(await pixels(final)).toEqual({});
  } finally { await first.dispose(); await delta.result.dispose(); await final.dispose(); }
  expect(backing.values.every(store => store.closed)).toBe(true);
});
