import {retainedDocuments,captureRetainedHistory} from '../core/history';
import { AffineTransform } from '../core/affine';
import { AssetStore } from '../core/assets';
import { execute, type EditorCommand } from '../core/commands';
import { transformSelection, type BrushStrokeData, type Rect, type StrokePoint } from '../core/drawing';
import { freeze } from '../core/immutable';
import { id, isLocked, referencedAssets, type DocumentData } from '../core/model';
import { visitBrushAssets } from '../core/asset-references';
import {maskStrokePointCount} from '../core/masks';
import {maskTransform} from '../core/masks';
import {maskCoverage} from './masks';
import {BrushTextureSampler} from './brush-texture';
import { layerTransform } from '../core/spatial';
import { wetPaintLoadSchema, wetPaintMixSchema, type WetPaintLoadOptions, type WetPaintMixOptions } from '../core/wet-paint';
import { validateWetPaintAssets } from '../core/wet-assets';
import type { WetPaintTileData } from '../core/wet-operation';
import { BrushStroke, PaintLayer, RasterLayer, SmartObjectLayer, WetPaintStroke } from '../dom';
import type { EditorApplication } from '../editor';
import { release } from './canvas';
import { encodeRgbaPng } from './png';
import { captureRasterExportSources } from './raster-export-source';
import { createWetStrokeSession, type WetStrokeSession } from './wet-session';
import type { WetStrokeResult, WetStrokeControl, WetTileRevision } from './wet-state';
import { wetBrowserAssets } from './wet-composite';
import { WetPaintPreview } from './wet-preview';

export interface ApplyWetPaintOptions {
  mode?: 'smudge' | 'mixer'; target?:'layer'|'mask'|'filter-mask'; targetId?: string; respectSelection?: boolean;
  load?: WetPaintLoadOptions; mix?: WetPaintMixOptions;
  signal?: AbortSignal; onProgress?: WetStrokeControl['onProgress'];
}
/** Internal tool builder captures original texture leases in the private view. */
export type WetBrushBuilder = BrushStroke | ((assets: AssetStore) => BrushStroke);
export interface PreparedWetPaintJob {
  isCurrent(): boolean;
  readonly stroke: BrushStrokeData;
  append(points: readonly StrokePoint[]): Promise<void>;
  /** Caller owns the returned prefix and must dispose its reference. */
  preview(): Promise<WetPaintPreview | null>;
  commit(): Promise<WetPaintStroke | null>;
  dispose(): Promise<void>;
}

/** Trusted preparation owns all transient pixels outside the host AssetStore.
 * The public one-shot method and actual pointer client share this publication
 * path: current source checks, native alpha validation and one OO transaction. */
export async function createPreparedWetPaintJob(editor: EditorApplication, input: WetBrushBuilder, options: ApplyWetPaintOptions, hostCheck: () => void): Promise<PreparedWetPaintJob> {
  if (!(input instanceof BrushStroke) && typeof input !== 'function') throw new Error('Use a BrushStroke or PencilStroke value.');
  if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => !['mode','target', 'targetId', 'respectSelection', 'load', 'mix', 'signal', 'onProgress'].includes(key))) throw new Error('Invalid wet-paint application options.');
  const targetKind=options.target===undefined?'layer':options.target;
  if(!['layer','mask','filter-mask'].includes(targetKind))throw new Error('Wet paint target must be layer, mask or filter-mask.');
  const mode = options.mode === undefined ? 'smudge' : options.mode, respectSelection = options.respectSelection === undefined ? true : options.respectSelection, requestedId = options.targetId, signal = options.signal, progress = options.onProgress;
  if ((mode !== 'smudge' && mode !== 'mixer') || typeof respectSelection !== 'boolean' || (requestedId !== undefined && (typeof requestedId !== 'string' || !requestedId || requestedId.length > 240)) || (progress !== undefined && typeof progress !== 'function')) throw new Error('Invalid wet-paint application controls.');
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw new Error('Wet paint requires an AbortSignal.');
  signal?.throwIfAborted(); hostCheck();
  const document = editor.document, assets = editor.assetStore, snapshot = document.getSnapshot(), selected = document.selectedLayer?.id ?? null;
  const target = requestedId ? document.getLayer(requestedId) : document.selectedLayer;
  if (targetKind==='layer' && target && !(target instanceof PaintLayer) && !(target instanceof RasterLayer)) throw new Error('Wet paint requires an image or paint layer.');
  if (requestedId && !target) throw new Error('Wet-paint target does not exist.');
  if (target && isLocked(snapshot.document, target.id)) throw new Error('The wet-paint target or an ancestor is locked.');
  const layer = target ?? new PaintLayer({ name: mode === 'mixer' ? 'Mixer paint' : 'Smudged paint' }), source = layer.toJSON();
  if (targetKind==='layer' && source.kind !== 'paint' && source.kind !== 'raster') throw new Error('Invalid wet-paint target.');
  const mask=targetKind==='layer'?null:targetKind==='filter-mask'?target instanceof SmartObjectLayer?target.filterMask:null:target?.mask;
  if(targetKind!=='layer'&&!mask)throw new Error(targetKind==='filter-mask'?'Choose a smart object with a filter mask.':'Choose a layer with a mask.');
  const maskData=mask?.toJSON();
  const maxPoints=maskData?Math.min(20000,200000-(maskData.strokes??[]).reduce((total,entry)=>total+maskStrokePointCount(entry),0)):20000;
  if(maskData&&((maskData.strokes?.length??0)>=2048||maxPoints<1))throw new Error('This mask has reached its stroke or point budget.');
  const base = new AssetStore(), baseAlive = base.captureLifetime(), alive = assets.captureLifetime(), abort = new AbortController();
  const pinned = new Map<string, { asset: ReturnType<AssetStore['get']>; bitmap: ImageBitmap; blob: Blob; width: number; height: number }>();
  const relay = () => abort.abort(signal?.reason); signal?.addEventListener('abort', relay, { once: true });
  const check = () => {
    abort.signal.throwIfAborted(); hostCheck(); alive(); baseAlive();
    if (editor.document !== document || editor.assetStore !== assets || document.getSnapshot().revision !== snapshot.revision || (document.selectedLayer?.id ?? null) !== selected) throw new Error('The wet-paint document, selection or revision changed. No stroke was applied.');
    for (const [key, item] of pinned) { const asset = assets.get(key); if (asset !== item.asset || asset.bitmap !== item.bitmap || asset.blob !== item.blob || asset.width !== item.width || asset.height !== item.height || asset.bitmap.width !== item.width || asset.bitmap.height !== item.height) throw new Error('Wet-paint source assets changed.'); }
  };
  const unsubscribe = document.subscribe(() => { if (document.getSnapshot().revision !== snapshot.revision || (document.selectedLayer?.id ?? null) !== selected) abort.abort(new Error('The wet-paint target changed.')); });
  type PreparedTile = { region: Readonly<Rect>; epoch?: string; tile: WetPaintTileData };
  const tileKey = (region: Readonly<Rect>) => `${region.x},${region.y}`;
  const prefixRecords = new WeakMap<WetPaintPreview, ReadonlyMap<string, PreparedTile>>();
  let cachedTiles: ReadonlyMap<string, PreparedTile> = new Map(), cachedAssets: AssetStore | undefined;
  let maskTextures:BrushTextureSampler|undefined;
  let session: WetStrokeSession | undefined, accepting = true, released = false, serial: Promise<unknown> = Promise.resolve(), cleanup: Promise<void> | undefined, disposal: Promise<void> | undefined, version = 0;
  let releaseSources=()=>{};
  const clean = () => cleanup ??= (async () => {
    try { await session?.dispose(); }
    finally {
      released = true;releaseSources(); unsubscribe(); signal?.removeEventListener('abort', relay);
      const retained = cachedAssets; cachedAssets = undefined; cachedTiles = new Map();
      try { maskTextures?.dispose(); }
      finally { try { retained?.dispose(); } finally { base.dispose(); } }
    }
  })();
  const guard = () => { if (!accepting) throw new Error('Wet-paint gesture is finishing or disposed.'); check(); };
  const enqueue = <T>(run: () => Promise<T>): Promise<T> => {
    const pending = serial.then(async () => { try { check(); return await run(); } catch (error) { accepting = false; abort.abort(error); try { await clean(); } catch (failure) { throw new AggregateError([error, failure], 'Wet-paint gesture and private cleanup failed.'); } throw error; } });
    serial = pending.then(() => {}, () => {}); return pending;
  };
  const retainOriginal = (key: string) => {
    if (base.has(key)) return;
    const asset = assets.get(key); assets.shareTo(base, key, key); pinned.set(key, { asset, bitmap: asset.bitmap, blob: asset.blob, width: asset.width, height: asset.height });
  };
  try {
    for (const key of referencedAssets(snapshot.document)) retainOriginal(key);
    const value = typeof input === 'function' ? input(base) : input;
    if (!(value instanceof BrushStroke)) throw new Error('Use a BrushStroke or PencilStroke value.');
    const data = value.toJSON();
    if ((data.kind !== 'brush' && data.kind !== 'pencil') || data.tiles.length) throw new Error('Wet paint requires a brush or pencil footprint without clone tiles.');
    visitBrushAssets(data, reference => { if (!base.has(reference.assetId)) retainOriginal(reference.assetId); });
    let world = target ? layerTransform(snapshot.document, target.id)! : new AffineTransform();
    if(targetKind==='filter-mask'&&target instanceof SmartObjectLayer){const master=document.getComponent(target.componentId);world=world.multiply(AffineTransform.scale(target.width/master.width,target.height/master.height));}
    if(maskData)world=maskTransform(maskData,world);
    if (!respectSelection) data.clip = null;
    else if (!data.clip && snapshot.document.selection) data.clip = transformSelection(snapshot.document.selection, world.inverse());
    if(data.points.length>maxPoints)throw new Error('This stroke exceeds the mask point budget.');
    let submittedPoints=data.points.length;
    const brush = freeze(data), foreground: [number, number, number, number] = maskData?[255,255,255,255]:[parseInt(brush.color.slice(1, 3), 16), parseInt(brush.color.slice(3, 5), 16), parseInt(brush.color.slice(5, 7), 16), 255];
    if (options.load !== undefined) wetPaintLoadSchema.parse(options.load);
    if (options.mix !== undefined) wetPaintMixSchema.parse(options.mix);
    const load = wetPaintLoadSchema.parse({ color: foreground, load: mode === 'mixer' ? 1 : 0, ...options.load }), mix = wetPaintMixSchema.parse({ wetness: mode === 'mixer' ? .25 : 0, ...options.mix });
    if(maskData)load.color=[255,255,255,load.color[3]];
    const native = !maskData&&source.kind === 'raster' ? base.get(source.assetId) : undefined, localToNative = native && source.kind === 'raster' ? AffineTransform.scale(native.width / source.width, native.height / source.height) : new AffineTransform();
    const neutralMask=maskData?{...maskData,x:0,y:0,placedX:0,placedY:0,basis:undefined,linked:true,enabled:true,inverted:false,density:1,feather:0}:undefined;
    const neutral = maskData?{...new PaintLayer().toJSON(),mask:neutralMask}:{ ...source, clipped:undefined, x: 0, y: 0, transform: undefined, visible: true, opacity: 1, fillOpacity: 1, mask: null, styles: undefined, blendMode: 'normal' as const, ...(source.kind === 'raster' ? { width: native!.width, height: native!.height, effects: [] } : {}) };
    const sourceDocument = freeze({ ...snapshot.document, children: [neutral], layerComps: undefined,...(maskData?{components:undefined}: {}) } as DocumentData), checkSources = captureRasterExportSources(sourceDocument, base, { signal: abort.signal }, 'wet-paint target preparation');
    releaseSources=()=>checkSources.release();
    if(maskData)maskTextures=new BrushTextureSampler(editor.renderer.processor);
    const current = () => { check(); checkSources(); session?.assertStorageCurrent(); };
    const read = async (region: Rect) => {
      current();let canvas:HTMLCanvasElement;
      if(neutralMask){
        canvas=await maskCoverage(neutralMask,{...region,sx:1,sy:1},0,0,editor.renderer.processor,undefined,new AffineTransform(),neutralMask.kind==='bitmap'?base.get(neutralMask.assetId).bitmap:undefined,base,maskTextures,()=>{current();return false;});
      }else{
        const frame: DocumentData = { ...sourceDocument, width: region.width, height: region.height, children: [{ ...neutral, x: -region.x, y: -region.y }] };
        canvas=await editor.renderer.render(frame, base, { region: { x: 0, y: 0, width: region.width, height: region.height }, outputSize: { width: region.width, height: region.height }, cache: false, readback: true, isCancelled: () => { current(); return false; } });
      }
      try { current(); if (canvas.width !== region.width || canvas.height !== region.height) throw new Error('Wet paint requires native target pixels.');const pixels=canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data;if(neutralMask)for(let p=0;p<pixels.length;p+=4)pixels[p]=pixels[p+1]=pixels[p+2]=pixels[p+3]?255:0;return pixels; }
      finally { release(canvas); }
    };
    session = await createWetStrokeSession(brush, read, editor.renderer.processor, { assets: base, load, mix, transform: localToNative, signal: abort.signal, check: current, onProgress: progress }); current();
    const commandFor = (operation: WetPaintStroke): EditorCommand => mask ? targetKind==='filter-mask'?{type:'smartObject.filterMask',id:layer.id,mask:mask.applyWetPaint(operation).toJSON()}:{type:'layer.update',id:layer.id,patch:{mask:mask.applyWetPaint(operation).toJSON()}} : !target ? { type: 'layer.add', layer: { ...source, strokes: [operation.toJSON()] } as ReturnType<PaintLayer['toJSON']> } : source.kind === 'raster'
      ? { type: 'layer.update', id: source.id, patch: { erasures: [...(source.erasures ?? []), { width: source.width, height: source.height, stroke: operation.toJSON() }] } }
      : { type: 'paint.add', id: source.id, stroke: operation.toJSON() };
    let owner!: PreparedWetPaintJob;
    const build = async (result: WetStrokeResult, reused: readonly WetTileRevision[]): Promise<WetPaintPreview | null> => {
      let view: AssetStore | undefined;
      try {
        const entries = new Map<string, PreparedTile>();
        const ensureView = () => {
          if (!view) { view = new AssetStore(); for (const asset of base.values()) base.shareTo(view, asset.id, asset.id); }
          return view;
        };
        const reuse = (region: Readonly<Rect>, epoch: string | undefined) => {
          current();
          const entry = cachedTiles.get(tileKey(region));
          if (!epoch || entry?.epoch !== epoch || entry.region.width !== region.width || entry.region.height !== region.height) return false;
          if (!cachedAssets) throw new Error('Wet prefix pixels are no longer owned.');
          const target = ensureView();
          cachedAssets.shareTo(target, entry.tile.assetId, entry.tile.assetId);
          cachedAssets.shareTo(target, entry.tile.coverage.assetId, entry.tile.coverage.assetId);
          entries.set(tileKey(region), entry);
          return true;
        };
        for (const entry of reused) if (!reuse(entry.region, entry.epoch)) throw new Error('Wet prefix revision no longer matches its retained pixels.');
        for await (const tile of result.tiles(undefined, reuse)) {
          current(); let left = tile.region.width, top = tile.region.height, right = 0, bottom = 0;
          for (let y = 0; y < tile.region.height; y++) for (let x = 0; x < tile.region.width; x++) if (tile.changed[y * tile.region.width + x]) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1); }
          if (right <= left || bottom <= top) continue;
          ensureView();
          const width = right - left, height = bottom - top, pixels = new Uint8Array(width * height * 4), coverage = new Uint8Array(pixels.length);
          for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const from = (top + y) * tile.region.width + left + x, to = (y * width + x) * 4; if (tile.changed[from]) { pixels.set(tile.pixels.subarray(from * 4, from * 4 + 4), to); coverage.set([255, 255, 255, 255], to); } }
          const outputId = id(), coverageId = id(), output = await encodeRgbaPng(pixels, width, height); current(); const support = await encodeRgbaPng(coverage, width, height); current();
          await view!.add(output, 'Wet-paint pixels', outputId, false); current(); await view!.add(support, 'Wet-paint coverage', coverageId, false); current();
          entries.set(tileKey(tile.region), { region: Object.freeze({ ...tile.region }), epoch: tile.epoch, tile: { x: tile.region.x + left, y: tile.region.y + top, width, height, assetId: outputId, coverage: { assetId: coverageId } } });
        }
        const tiles = [...entries.values()].sort((a, b) => a.region.y - b.region.y || a.region.x - b.region.x).map(entry => entry.tile);
        if (!view || !tiles.length) return null;
        const operation = new WetPaintStroke({ brush: session!.stroke, load, mix, nativeTransform: localToNative.inverse(), tiles }), command = commandFor(operation), candidate = execute(snapshot.document, command);
        await validateWetPaintAssets(candidate, wetBrowserAssets(view, current)); current();
        const frame = new WetPaintPreview(owner, assets, view, candidate, command, operation, ++version);
        prefixRecords.set(frame, entries);
        return frame;
      } catch (error) { view?.dispose(); throw error; }
    };
    const owned = async (result: WetStrokeResult, reused: readonly WetTileRevision[] = []) => {
      let frame: WetPaintPreview | null = null, failed = false, failure: unknown;
      try { frame = await build(result, reused); } catch (error) { failed = true; failure = error; }
      try { await result.dispose(); } catch (error) { failure = failed ? new AggregateError([failure, error], 'Wet-paint prefix and private storage cleanup failed.') : error; failed = true; }
      if (failed) { frame?.dispose(); throw failure; }
      // Hold only the current prepared output, sharing its immutable bitmap/Blob
      // leases with frames. Earlier frames never depend on this cache's lifetime.
      let next: AssetStore | undefined;
      const entries = frame ? prefixRecords.get(frame)! : new Map<string, PreparedTile>();
      try {
        current();
        if (frame) {
          next = new AssetStore();
          for (const { tile } of entries.values()) {
            frame.assets.shareTo(next, tile.assetId, tile.assetId);
            frame.assets.shareTo(next, tile.coverage.assetId, tile.coverage.assetId);
          }
        }
        current();
      } catch (error) { next?.dispose(); frame?.dispose(); throw error; }
      const previous = cachedAssets; cachedAssets = next; cachedTiles = entries;
      try { previous?.dispose(); } catch (error) { frame?.dispose(); throw error; }
      return frame;
    };
    owner = {
      isCurrent() { try { if (released) return false; current(); return true; } catch { return false; } },
      get stroke() { return session!.stroke; },
      async append(points) { guard(); const captured = structuredClone(points); if(!Array.isArray(captured)||submittedPoints+captured.length>maxPoints)throw new Error('This stroke exceeds the target point budget.');submittedPoints+=captured.length; return enqueue(async () => { await session!.append(captured); current(); }); },
      async preview() {
        guard();
        return enqueue(async () => {
          const previous = new Map([...cachedTiles].flatMap(([key, entry]) => entry.epoch ? [[key, entry.epoch] as const] : []));
          const projection = await session!.snapshotSince(previous);
          const frame = await owned(projection.result, projection.reused);
          try { current(); return frame; } catch (error) { frame?.dispose(); throw error; }
        });
      },
      async commit() {
        guard(); accepting = false;
        return enqueue(async () => {
          const frame = await owned(await session!.finish()); if (!frame) { current(); return null; }
          const installed = new Map<string, ReturnType<AssetStore['get']>>();
          try {
            current();
            for (const key of referencedAssets(frame.document)) {
              const asset = frame.assets.get(key);
              if (assets.has(key)) { const present = assets.get(key); if (present.bitmap !== asset.bitmap || present.blob !== asset.blob || present.width !== asset.width || present.height !== asset.height) throw new Error('A wet-paint source ID collided with another image.'); }
            }
            current();
            for (const key of referencedAssets(frame.document)) if (!assets.has(key)) { frame.assets.shareTo(assets, key, key); installed.set(key, assets.get(key)); }
            document.transaction((mode === 'mixer'?'Mixer':'Smudge')+(mask?targetKind==='filter-mask'?' filter mask stroke':' mask stroke':' stroke'), () => {
              if(mask){const next=mask.applyWetPaint(frame.operation);if(targetKind==='filter-mask')(target as SmartObjectLayer).filterMask=next;else target!.mask=next;return;}
              if (!target) { (layer as PaintLayer).strokes.add(frame.operation); document.layers.add(layer as PaintLayer); }
              else if (target instanceof RasterLayer) target.applyWetPaint(frame.operation);
              else (target as PaintLayer).strokes.add(frame.operation);
            });
            document.selectLayers([layer]); return frame.operation;
          } catch (error) {
            const state = document.getSnapshot(), retained = new Set(retainedDocuments(state.document,captureRetainedHistory(state)).flatMap(data => [...referencedAssets(data)]));
            for (const [key, asset] of installed) if (!retained.has(key) && assets.has(key) && assets.get(key) === asset) assets.remove(key);
            throw error;
          } finally { frame.dispose(); }
        });
      },
      dispose() { if (disposal) return disposal; accepting = false; abort.abort(new Error('Wet-paint gesture ended.')); return disposal = serial.then(() => clean()); },
    };
    return owner;
  } catch (error) {
    abort.abort(error); try { await clean(); } catch (failure) { throw new AggregateError([error, failure], 'Wet-paint preparation and private cleanup failed.'); } throw error;
  }
}

export async function applyPreparedWetPaint(editor: EditorApplication, input: BrushStroke, options: ApplyWetPaintOptions, hostCheck: () => void): Promise<WetPaintStroke | null> {
  const job = await createPreparedWetPaintJob(editor, input, options, hostCheck);
  try { return await job.commit(); } finally { await job.dispose(); }
}
