import { AffineTransform } from '../core/affine';
import { brushStrokeSchema, paintOperationSchema, strokeBounds, type BrushStrokeData, type Rect, type StrokePoint } from '../core/drawing';
import { freeze } from '../core/immutable';
import { paintStampAlpha, paintStampGeometry, paintStampSize, strokeStamps } from '../core/paint-stamps';
import { wetPaintLoadSchema, wetPaintMixSchema } from '../core/wet-paint';
import { BrushTextureSampler } from './brush-texture';
import { yieldTask } from './task-yield';
import { wetDabCoverage } from './wet-coverage';
import { validateWetCarried, validateWetCoverage, validateWetPixels } from './wet-paint';
import { sampleWetField, wetRegion, wetTileKey, type WetField } from './wet-spatial';
import { createWetTileStore, type WetTileStore, type WetTileChange } from './wet-store';
import { WetStrokeResult, WetTileCache, type WetProcessor, type WetStrokeOptions, type WetStrokeProjection, type WetTileRevision } from './wet-state';
import {createWetWorkingCache} from './wet-cache';

const appendedPoints = brushStrokeSchema.shape.points.element.array().max(20000);
type RecordTile = { region: Rect; original: string; result: string; epoch: string };
type Configuration = ReturnType<typeof capture>;

/** Internal retained workspace. Appends own only new samples; completed native
 * dabs and separate spatial reservoirs are never replayed for a later prefix.
 * Snapshots own separate storage and outlive subsequent appends/disposal. */
export interface WetStrokeSession {
  readonly stroke: BrushStrokeData;
  readonly diagnostics: Readonly<{ dabs: number; workingTiles: number; completedPoints: number; peakCacheBytes: number }>;
  assertStorageCurrent(): void;
  append(points: readonly StrokePoint[]): Promise<void>;
  snapshot(crop?: Rect): Promise<WetStrokeResult>;
  /** Partial projection plus proofs for tiles already owned by the host adapter. */
  snapshotSince(previous: ReadonlyMap<string, string>): Promise<WetStrokeProjection>;
  finish(): Promise<WetStrokeResult>;
  dispose(): Promise<void>;
}

function capture(input: BrushStrokeData, readSource: (region: Rect) => Promise<Uint8ClampedArray>, processor: WetProcessor, options: WetStrokeOptions) {
  const stroke = freeze(paintOperationSchema.parse(input));
  if (stroke.kind !== 'brush' && stroke.kind !== 'pencil') throw new Error('Wet-paint preparation requires a brush or pencil footprint.');
  const load = wetPaintLoadSchema.parse(options.load === undefined ? { color: [parseInt(stroke.color.slice(1, 3), 16), parseInt(stroke.color.slice(3, 5), 16), parseInt(stroke.color.slice(5, 7), 16), 255] } : options.load);
  const mix = wetPaintMixSchema.parse(options.mix === undefined ? {} : options.mix);
  const world = options.transform === undefined ? new AffineTransform() : AffineTransform.fromJSON(options.transform.toJSON()), inverse = world.inverse();
  const tileSize = options.tileSize ?? 128, cacheBudget = options.cacheBytes ?? 32 * 1024 * 1024;
  if (!Number.isSafeInteger(tileSize) || tileSize < 1 || tileSize > 256 || !Number.isSafeInteger(cacheBudget) || cacheBudget < 0) throw new Error('Wet-paint working tile/cache policies are invalid.');
  const signal = options.signal, externalCheck = options.check, onProgress = options.onProgress, coverage = options.coverage ?? wetDabCoverage, storage = options.storage ?? createWetTileStore, assets = options.assets;
  const lifetime = assets?.captureLifetime(), texture = stroke.texture && assets ? assets.get(stroke.texture.assetId) : undefined, bitmap = texture?.bitmap, blob = texture?.blob;
  const check = () => { signal?.throwIfAborted(); externalCheck?.(); lifetime?.(); if (stroke.texture && (!assets || !texture || !bitmap || !assets.has(texture.id) || assets.get(texture.id) !== texture || texture.bitmap !== bitmap || texture.blob !== blob || bitmap.width !== texture.width || bitmap.height !== texture.height)) throw new Error('Wet-paint texture source changed.'); };
  check();
  return { stroke, readSource, processor, load, mix, world, inverse, tileSize, cacheBudget, signal, onProgress, coverage, storage, assets, check };
}

class RetainedWetStrokeSession implements WetStrokeSession {
  private config?: Configuration;
  private strokeData: BrushStrokeData;
  private readonly cache: WetTileCache;
  private readonly current = new Map<string, string>();
  private readonly originals = new Set<string>();
  private readonly fields = new Map<string, WetField>();
  private readonly projected = new Map<string, { raw: string; pixels?: string }>();
  private readonly issued = new WeakSet<WetTileStore>();
  private textures?: BrushTextureSampler;
  private serial: Promise<unknown> = Promise.resolve();
  private cleanupPromise?: Promise<void>;
  private disposal?: Promise<void>;
  private accepting = true;
  private cancelled = false;
  private failed = false;
  private failure: unknown;
  private transferred = false;
  private reservedPoints: number;
  private completedPoints = 0;
  private dabs = 0;
  private workingTiles = 0;
  private readonly abort = () => {
    this.failed = true; this.failure = this.config?.signal?.reason ?? new DOMException('Wet-paint session aborted.', 'AbortError');
    void this.dispose().catch(() => { /* Explicit disposal retains the cleanup rejection for its caller. */ });
  };
  constructor(config: Configuration, private readonly store: WetTileStore, private releaseSources?: () => void) {
    this.config = config; this.strokeData = config.stroke; this.reservedPoints = config.stroke.points.length;
    this.cache = createWetWorkingCache(store, config.cacheBudget,this.check); this.issued.add(store);
    this.textures = config.stroke.texture ? new BrushTextureSampler(config.processor) : undefined;
    config.signal?.addEventListener('abort', this.abort, { once: true });
  }
  get stroke(): BrushStrokeData { return structuredClone(this.strokeData); }
  get diagnostics() { return Object.freeze({ dabs: this.dabs, workingTiles: this.workingTiles, completedPoints: this.completedPoints, peakCacheBytes: this.cache.peak }); }
  private check = () => {
    if (this.failed) throw this.failure;
    if (this.cancelled || !this.config) throw new Error('Wet-paint session is disposed.');
    this.config.check(); this.cache?.assertStorageCurrent();
  };
  assertStorageCurrent() {
    // finish() moves storage ownership to its result. The host subsequently
    // validates/owns decoded output and may dispose that result before commit.
    if (this.transferred) return;
    if (this.failed) throw this.failure;
    if (this.cancelled || !this.config) throw new Error('Wet-paint session is disposed.');
    this.cache.assertStorageCurrent();
  }
  private requireOpen() { if (!this.accepting) { if (this.failed) throw this.failure; throw new Error('Wet-paint session is finishing or disposed.'); } }
  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const result = this.serial.then(async () => { try { this.check(); return await run(); } catch (error) { throw await this.fail(error); } });
    this.serial = result.then(() => {}, () => {}); return result;
  }
  initialize() { return this.enqueue(() => this.process(this.strokeData, 0)); }
  async append(points: readonly StrokePoint[]): Promise<void> {
    this.requireOpen(); const owned = freeze(appendedPoints.parse(points));
    if (this.reservedPoints + owned.length > 20000) throw new Error('A recorded wet stroke supports at most 20000 points.');
    this.reservedPoints += owned.length;
    return this.enqueue(async () => {
      if (!owned.length) return;
      const from = this.strokeData.points.length, next = freeze({ ...this.strokeData, points: [...this.strokeData.points, ...owned] });
      await this.process(next, from);
    });
  }
  private originalKey(key: string) { return `original/${key}`; }
  private async original(region: Rect) {
    const config = this.config!, key = wetTileKey(region.x, region.y), storageKey = this.originalKey(key); this.check();
    if (!this.originals.has(key)) {
      const source = await config.readSource({ ...region }); this.check(); validateWetPixels(source);
      if (source.length !== config.tileSize * config.tileSize * 4) throw new Error('Wet-paint source returned the wrong native tile extent.');
      await this.cache.put(storageKey, source.slice()); this.check(); this.originals.add(key);
    }
    const value = await this.cache.get(storageKey); this.check();
    if (!(value instanceof Uint8ClampedArray) || value.length !== config.tileSize * config.tileSize * 4) throw new Error('Wet-paint original tile is missing.');
    return value;
  }
  private carried = async (key: string) => { const value = await this.cache.get(key); this.check(); if (!(value instanceof Float32Array)) throw new Error('Wet-paint carried tile is missing.'); return value; };
  private async process(stroke: BrushStrokeData, from: number) {
    const { processor, load, mix, world, tileSize, coverage, assets, onProgress } = this.config!;
    const { cache, current, fields, textures } = this, check = this.check, original = (region: Rect) => this.original(region), carried = this.carried;
    let { dabs, workingTiles } = this, deadline = performance.now() + 4;
    for (const point of strokeStamps(stroke, strokeBounds({ ...stroke, points: stroke.points.slice(Math.max(0, from - 1)) }), from)) {
      check(); if (paintStampSize(stroke, point) <= 0) continue;
      const flow = (stroke.flow === 0 ? 0 : paintStampAlpha(stroke, point)) * mix.flow;
      if (flow <= 0 || stroke.opacity <= 0) continue;
      const geometry = paintStampGeometry(stroke, point, true);
      const frame = world.multiply(new AffineTransform(geometry.a * geometry.rx, geometry.b * geometry.rx, geometry.c * geometry.ry, geometry.d * geometry.ry, geometry.cx, geometry.cy));
      frame.inverse();
      const support = frame.bounds({ x: -1, y: -1, width: 2, height: 2 }), left = Math.floor(support.x - 2), top = Math.floor(support.y - 2), right = Math.ceil(support.x + support.width + 2), bottom = Math.ceil(support.y + support.height + 2);
      const bounds = wetRegion({ x: left, y: top, width: right - left, height: bottom - top });
      const copy = point.copy ? JSON.stringify(point.copy.toJSON()) : 'original', previous = fields.get(copy), next = new Map<string, string>(), updates = new Map<string, string>();
      dabs++;
      for (let y = Math.floor(top / tileSize) * tileSize; y < bottom; y += tileSize) for (let x = Math.floor(left / tileSize) * tileSize; x < right; x += tileSize) {
        check(); const region = wetRegion({ x, y, width: tileSize, height: tileSize }), key = wetTileKey(x, y), before = await original(region);
        const oldKey = current.get(key), pixels = oldKey ? await cache.get(oldKey) : before; check();
        if (!(pixels instanceof Uint8ClampedArray) || pixels.length !== before.length) throw new Error('Wet-paint destination tile is missing.');
        // Backing cells retain the complete captured source. Numerical sampling,
        // native coverage and worker transfers need only the dab's support/halo
        // within this cell. Preserve the original global pixel-center grid.
        const wx=Math.max(x,left),wy=Math.max(y,top),working=wetRegion({x:wx,y:wy,width:Math.min(x+tileSize,right)-wx,height:Math.min(y+tileSize,bottom)-wy});
        const rowLength=working.width*4,workingPixels=new Uint8ClampedArray(rowLength*working.height),offsetX=working.x-x,offsetY=working.y-y;
        for(let row=0;row<working.height;row++){const start=((offsetY+row)*tileSize+offsetX)*4;workingPixels.set(pixels.subarray(start,start+rowLength),row*rowLength);}
        const pigment = previous ? await sampleWetField(previous, frame, working, tileSize, carried, check) : await processor.loadWetPaint(workingPixels, load);
        check(); validateWetCarried(pigment, workingPixels.length);
        const mask = await coverage(stroke, frame, working, check, assets, textures); check(); validateWetCoverage(mask, workingPixels.length);
        const output = await processor.mixWetPaint(workingPixels, pigment, mask, { ...mix, flow }); check();
        validateWetPixels(output.pixels); validateWetCarried(output.carried, workingPixels.length);
        if (output.pixels.length !== workingPixels.length) throw new Error('Wet-paint processor returned a wrong destination extent.');
        // Outside support, retain every original destination byte (including
        // hidden RGB) and the same zero carrier used by full-cell simulation.
        const nextPixels=pixels.slice(),nextCarried=new Float32Array(pixels.length);
        for(let row=0;row<working.height;row++){const start=((offsetY+row)*tileSize+offsetX)*4;nextPixels.set(output.pixels.subarray(row*rowLength,(row+1)*rowLength),start);nextCarried.set(output.carried.subarray(row*rowLength,(row+1)*rowLength),start);}
        const resultKey = `canvas/${dabs}/${key}`, pigmentKey = `carried/${dabs}/${key}`;
        const writes:WetTileChange[]=[{type:'put',key:resultKey,value:nextPixels},{type:'put',key:pigmentKey,value:nextCarried}];
        const stale=current.get(key),projected=this.projected.get(key);
        if(stale)writes.push({type:'remove',key:stale});if(projected?.pixels)writes.push({type:'remove',key:projected.pixels});
        // One bounded cell's two new planes and superseded destination share a
        // native transaction. Old reservoirs remain readable for other cells.
        await cache.batch(writes);check();
        updates.set(key, resultKey); next.set(key, pigmentKey); workingTiles++;
        if (performance.now() >= deadline) { await yieldTask(); check(); deadline = performance.now() + 4; }
      }
      // Advance only after the entire dab succeeds. All reads above see the
      // same prior canvas epoch and prior spatial reservoir for this copy.
      for (const [key, value] of updates) {
        current.set(key, value);
        this.projected.delete(key); check();
      }
      fields.set(copy, { bounds, transform: frame, tiles: next });
      if(previous){
        // Bound each cleanup transaction, so a very large footprint retains
        // cancellation checks without restricting source or stroke geometry.
        let removals:WetTileChange[]=[];
        for(const key of previous.tiles.values()){
          removals.push({type:'remove',key});
          if(removals.length===64){await cache.batch(removals);check();removals=[];}
        }
        if(removals.length){await cache.batch(removals);check();}
      }
      this.dabs = dabs; this.workingTiles = workingTiles;
      onProgress?.(Object.freeze({ dabs, workingTiles })); check();
    }

    this.check(); this.strokeData = stroke; this.completedPoints = stroke.points.length;
  }
  private async materialize(destination: WetTileStore, crop?: Rect, previous?: ReadonlyMap<string, string>) {
    const { processor, inverse, tileSize } = this.config!, stroke = this.strokeData, records: RecordTile[] = [];
    const reused: WetTileRevision[] = [];
    const writePair = async (original: string, before: Uint8ClampedArray, output: string, result: Uint8ClampedArray) => {
      this.check();
      if (destination.batch) await destination.batch([{ type: 'put', key: original, value: before }, { type: 'put', key: output, value: result }]);
      else { await destination.put(original, before); this.check(); await destination.put(output, result); }
      this.check();
    };
    for (const [key, rawKey] of this.current) {
      this.check(); const [x, y] = key.split(',').map(Number), region = { x, y, width: tileSize, height: tileSize };
      if (crop && (x >= crop.x + crop.width || y >= crop.y + crop.height || x + tileSize <= crop.x || y + tileSize <= crop.y)) continue;
      const prior = this.projected.get(key);
      if (prior) {
        if (prior.raw !== rawKey) throw new Error('Wet-paint projection no longer matches its native prefix.');
        if (!prior.pixels) continue;
        if (previous?.get(key) === rawKey) { reused.push(Object.freeze({ region: Object.freeze({ ...region }), epoch: rawKey })); continue; }
        const before = await this.original(region), result = await this.cache.get(prior.pixels); this.check();
        if (!(result instanceof Uint8ClampedArray) || result.length !== before.length) throw new Error('Wet-paint projected tile is incomplete.');
        if (destination !== this.store) await writePair(this.originalKey(key), before, `result/${key}`, result);
        else await this.cache.put(`result/${key}`, result);
        this.check(); records.push({ region, original: this.originalKey(key), result: `result/${key}`, epoch: rawKey }); continue;
      }
      const before = await this.original(region), raw = await this.cache.get(rawKey); this.check();
      if (!(raw instanceof Uint8ClampedArray) || raw.length !== before.length) throw new Error('Wet-paint final tile is missing.');
      let mask: Uint8ClampedArray;
      if (stroke.clip) {
        const origin = inverse.point(region);
        mask = await processor.selection({ selection: stroke.clip, ...region, x: origin.x, y: origin.y, stepX: inverse.a, stepY: inverse.d, stepXY: inverse.c, stepYX: inverse.b }); this.check();
        if (!(mask instanceof Uint8ClampedArray) || mask.length !== raw.length) throw new Error('Wet-paint selection returned invalid native coverage.');
        for (let p = 3; p < mask.length; p += 4) mask[p] = Math.round(mask[p] * stroke.opacity);
      } else { mask = new Uint8ClampedArray(raw.length); for (let p = 3; p < mask.length; p += 4) mask[p] = Math.round(255 * stroke.opacity); }
      for (let p = 0; p < raw.length; p += 4) if (raw[p] === before[p] && raw[p + 1] === before[p + 1] && raw[p + 2] === before[p + 2] && raw[p + 3] === before[p + 3]) mask[p + 3] = 0;
      const result = await processor.mixFiltered(before, raw, mask); this.check(); validateWetPixels(result);
      if (result.length !== raw.length) throw new Error('Wet-paint final mixing returned the wrong native extent.');
      if (result.some((value, index) => value !== before[index])) {
        const original = this.originalKey(key), output = `result/${key}`;
        const projected = `projected/${key}`; await this.cache.put(projected, result); this.check(); this.projected.set(key, { raw: rawKey, pixels: projected });
        if (destination !== this.store) await writePair(original, before, output, result);
        else await this.cache.put(output, result);
        this.check(); records.push({ region, original, result: output, epoch: rawKey });
      } else this.projected.set(key, { raw: rawKey });
    }
    records.sort((a, b) => a.region.y - b.region.y || a.region.x - b.region.x);
    return { records, reused: Object.freeze(reused), diagnostics: Object.freeze({ dabs: this.dabs, workingTiles: this.workingTiles, resultTiles: records.length, peakCacheBytes: this.cache.peak }) };
  }
  async snapshot(crop?: Rect): Promise<WetStrokeResult> {
    this.requireOpen(); const scope = crop === undefined ? undefined : wetRegion(crop);
    return (await this.snapshotProjection(scope)).result;
  }
  async snapshotSince(previous: ReadonlyMap<string, string>): Promise<WetStrokeProjection> {
    this.requireOpen();
    // Capture before queueing, just like newly appended pointer samples.
    return this.snapshotProjection(undefined, new Map(previous));
  }
  private snapshotProjection(scope?: Rect, previous?: ReadonlyMap<string, string>): Promise<WetStrokeProjection> {
    return this.enqueue(async () => {
      let output: WetTileStore | undefined;
      try {
        output = await this.config!.storage();
        if (this.issued.has(output)) { output = undefined; throw new Error('Wet-paint snapshots require a fresh private tile store.'); }
        this.issued.add(output); this.check(); const prepared = await this.materialize(output, scope, previous); this.check();
        return { result: new WetStrokeResult(output, prepared.records, prepared.diagnostics, scope), reused: prepared.reused };
      } catch (error) {
        try { await output?.dispose(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Wet-paint snapshot and private storage cleanup failed.'); }
        throw error;
      }
    });
  }
  async finish(): Promise<WetStrokeResult> {
    this.requireOpen(); this.accepting = false;
    return this.enqueue(async () => {
      const prepared = await this.materialize(this.store);
      await this.cache.flush(prepared.records.flatMap(record=>[record.original,record.result]),this.check);
      for (const key of this.current.values()) { await this.cache.remove(key); this.check(); }
      for (const field of this.fields.values()) for (const key of field.tiles.values()) { await this.cache.remove(key); this.check(); }
      for (const entry of this.projected.values()) if (entry.pixels) { await this.cache.remove(entry.pixels); this.check(); }
      const retained = new Set(prepared.records.map(record => record.original));
      for (const key of this.originals) if (!retained.has(this.originalKey(key))) { await this.cache.remove(this.originalKey(key)); this.check(); }
      this.check(); this.releaseProcessing(); this.transferred = true;
      return new WetStrokeResult(this.store, prepared.records, prepared.diagnostics);
    });
  }
  private releaseProcessing() {
    this.config?.signal?.removeEventListener('abort', this.abort);
    try { this.textures?.dispose(); } finally {
      this.textures = undefined; this.cache.discard(); this.current.clear(); this.originals.clear(); this.fields.clear(); this.projected.clear(); this.config = undefined;
      const release = this.releaseSources; this.releaseSources = undefined; release?.();
    }
  }
  private cleanup(): Promise<void> {
    return this.cleanupPromise ??= (async () => { try { this.releaseProcessing(); } finally { if (!this.transferred) await this.store.dispose(); } })();
  }
  private async fail(error: unknown) {
    if (!this.failed) { this.failed = true; this.failure = error; this.accepting = false; }
    try { await this.cleanup(); } catch (cleanup) { this.failure = new AggregateError([this.failure, cleanup], 'Wet-paint session failed and private working storage could not be removed.'); }
    return this.failure;
  }
  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.cancelled = true; this.accepting = false;
    return this.disposal = this.serial.then(() => this.cleanup());
  }
}

/** The internal source owner releases at processing completion, failure or
 * disposal; immutable output tiles no longer depend on the captured source. */
export async function createWetStrokeSession(input: BrushStrokeData, readSource: (region: Rect) => Promise<Uint8ClampedArray>, processor: WetProcessor, options: WetStrokeOptions = {}, releaseSources?: () => void): Promise<WetStrokeSession> {
  const config = capture(input, readSource, processor, options), store = await config.storage();
  let session: RetainedWetStrokeSession | undefined;
  try { config.check(); session = new RetainedWetStrokeSession(config, store, releaseSources); await session.initialize(); return session; }
  catch (error) {
    if (!session) { try { await store.dispose(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Wet-paint initialization and private storage cleanup failed.'); } }
    throw error;
  }
}
