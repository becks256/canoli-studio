import { expect, it } from 'vitest';
import { AffineTransform, BrushStroke, BrushTexture, Document, EraserStroke, LayerGroup, PaintLayer, RasterLayer, WetPaintStroke } from '../src/dom';
import { paintOperationSchema, rasterErasureSchema, strokeBounds } from '../src/core/drawing';
import { allLayers, referencedAssets } from '../src/core/model';
import { remapLayerAssets } from '../src/core/asset-references';
import { parseCommands } from '../src/core/validation';
import { validateWetPaintTile, type WetAssetProvider, type WetImageSource } from '../src/core/wet-assets';
import { planSvgComposition } from '../src/core/svg-composition';
import { getExportCapabilityReport } from '../src/engine/export';
import { planPsdExport } from '../src/core/interchange/psd/export-plan';
import { computeResizePatch } from '../src/ui/utils';
import { hasWetContent } from '../src/engine/wet-native';
import { localBounds } from '../src/core/spatial';
import { planSvgImages } from '../src/core/svg-images';
import { svgDocumentChunks } from '../src/core/svg-export';

const brush = () => new BrushStroke({ points: [{ x: 2, y: 3 }], texture: new BrushTexture({ assetId: 'tip' }) });
const tile = () => ({ x: -2, y: 3, width: 2, height: 2, assetId: 'result', coverage: { assetId: 'coverage' } });
const wet = () => new WetPaintStroke({ brush: brush(), tiles: [tile()] });

it('owns prepared pixels metadata, defaults and affine native bounds', () => {
  const input = tile(), stroke = new WetPaintStroke({ brush: brush(), tiles: [input], nativeTransform: AffineTransform.scale(2, 3) });
  input.coverage.assetId = 'foreign'; const dto = stroke.toJSON(); dto.tiles[0].assetId = 'foreign'; dto.brush.points[0].x = 999;
  expect(stroke.tiles[0]).toEqual(tile()); expect(stroke.brush.points[0].x).toBe(2);
  expect(stroke.load).toEqual({ color: [0, 0, 0, 255], load: 0 }); expect(stroke.mix).toEqual({ flow: 1, wetness: 0, pickup: .5 });
  expect(strokeBounds(stroke.toJSON())).toEqual({ x: -4, y: 9, width: 4, height: 6 });
  expect(paintOperationSchema.parse(stroke.toJSON())).toEqual(stroke.toJSON());
});

it('rejects malformed prepared records without weakening ordinary erasure validation', () => {
  const value = wet().toJSON();
  for (const patch of [{ tiles: [] }, { clip: { regions: [] } }, { opacity: 2 }, { mix: { flow: NaN } }, { nativeTransform: { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 } }, { brush: new EraserStroke({ points: [{ x: 1, y: 1 }] }).toJSON() }, { tiles: [{ ...tile(), x: .5 }] }, { tiles: [{ ...tile(), width: Number.MAX_SAFE_INTEGER }] }]) {
    expect(() => paintOperationSchema.parse({ ...value, ...patch })).toThrow();
  }
  expect(() => rasterErasureSchema.parse({ width: 10, height: 10, stroke: brush().toJSON() })).toThrow();
  expect(rasterErasureSchema.parse({ width: 10, height: 10, stroke: value }).stroke.kind).toBe('wet');
});

it('rejects explicit null constructor controls while retaining omitted defaults', () => {
  for (const patch of [{ opacity: null }, { nativeTransform: null }, { load: null }, { mix: null }]) expect(() => new WetPaintStroke({ brush: brush(), tiles: [tile()], ...patch } as never)).toThrow();
  expect(new WetPaintStroke({ brush: brush(), tiles: [tile()] }).opacity).toBe(1);
});

it('retains inert wet metadata without changing native routing, visual bounds or SVG prefixes', () => {
  const document = new Document(), paint = document.layers.add(new PaintLayer()); paint.strokes.add(new BrushStroke({ points: [{ x: 3, y: 4 }], size: 2 }));
  const before = [...svgDocumentChunks(document.toJSON())].join(''), bounds = localBounds(paint.toJSON());
  const inert = new WetPaintStroke({ brush: new BrushStroke({ points: [{ x: 1000, y: 1000 }] }), tiles: [{ ...tile(), x: 1000 }], opacity: 0 }); paint.strokes.add(inert);
  const data = paint.toJSON(); if (data.kind !== 'paint') throw new Error('Missing paint');
  expect(data.strokes.at(-1)).toEqual(inert.toJSON()); expect(referencedAssets(document.toJSON())).toEqual(new Set(['result', 'coverage'])); expect(hasWetContent(data)).toBe(false); expect(localBounds(data)).toEqual(bounds);
  expect(planSvgComposition(document.toJSON())).toMatchObject({ prefixes: 0, wetPaint: 0 }); expect([...svgDocumentChunks(document.toJSON())].join('')).toBe(before);
  const raster = document.layers.add(new RasterLayer({ assetId: 'original', width: 12, height: 8 })); raster.applyWetPaint(inert); const image = raster.toJSON(); if (image.kind !== 'raster') throw new Error('Missing image');
  expect(hasWetContent(image)).toBe(false); expect(localBounds(image)).toEqual({ x: 0, y: 0, width: 12, height: 8 }); expect(planSvgImages(document.toJSON()).find(plan => plan.layer.id === raster.id)!.rendered).toBe(false);
});

for (const context of ['paint', 'raster', 'embedded-master'] as const) it(`retains ${context} wet data and rejects false schema ages`, () => {
  const document = new Document();
  if (context === 'paint') document.layers.add(new PaintLayer()).strokes.add(wet());
  else if (context === 'raster') document.layers.add(new RasterLayer({ assetId: 'original', width: 12, height: 8 })).applyWetPaint(wet());
  else { const master = new Document(); master.layers.add(new PaintLayer()).strokes.add(wet()); document.placeSmartObject(document.defineComponent(master)); }
  const saved = document.toJSON(); expect(saved.schemaVersion).toBe(43); expect(Document.fromJSON(saved).toJSON()).toEqual(saved);
  expect(referencedAssets(saved)).toEqual(new Set(context === 'raster' ? ['original', 'tip', 'result', 'coverage'] : ['tip', 'result', 'coverage']));
  const old = structuredClone(saved); old.schemaVersion = 32;
  if (context === 'embedded-master') for (const definition of old.components ?? []) if (definition.source.kind === 'document') definition.source.document.schemaVersion = 32;
  expect(() => Document.fromJSON(old)).toThrow(/schema version 33/);
});

it('keeps ordered raster replacements, captured dimensions, locks and transactions in shared history', () => {
  const document = new Document(), group = document.layers.add(new LayerGroup()), raster = group.layers.add(new RasterLayer({ assetId: 'original', width: 12, height: 8 }));
  raster.erase(new EraserStroke({ points: [{ x: 3, y: 3 }] })); const before = document.toJSON();
  document.transaction('Wet replacement', () => { raster.applyWetPaint(wet()); raster.width = 24; });
  const after = document.toJSON(), data = raster.toJSON(); if (data.kind !== 'raster') throw new Error('Missing image');
  expect(data.erasures!.map(entry => entry.stroke.kind)).toEqual(['eraser', 'wet']); expect(data.erasures![1]).toMatchObject({ width: 12, height: 8 });
  document.undo(); expect(document.toJSON()).toEqual(before); document.redo(); expect(document.toJSON()).toEqual(after);
  expect(() => document.transaction('Bad replacement', () => { raster.applyWetPaint(wet()); raster.opacity = 2; })).toThrow(); expect(document.toJSON()).toEqual(after);
  group.locked = true; const locked = document.toJSON(); expect(() => raster.applyWetPaint(wet())).toThrow(); expect(document.toJSON()).toEqual(locked);
});

it('retains redo-only wet sources, remaps both tile roles and validates commands before commit', () => {
  const document = new Document(), layer = document.layers.add(new PaintLayer()), before = document.toJSON(); layer.strokes.add(wet()); const after = document.toJSON(); document.undo();
  const state = document.getSnapshot(), history = { version: 1, past: state.past, future: state.future }, restored = Document._fromWorkspace({ ...state.document, schemaVersion: 32 }, history);
  restored.redo(); expect(restored.toJSON()).toEqual(after);
  const invalid = structuredClone(history); invalid.future[0].document.schemaVersion = 32; expect(() => Document._fromWorkspace(before, invalid)).toThrow(/schema version 33/);
  const mapped = structuredClone(after); for (const item of allLayers(mapped.children)) remapLayerAssets(item, new Map([['tip', 'new-tip'], ['result', 'new-result'], ['coverage', 'new-coverage']]));
  expect(referencedAssets(mapped)).toEqual(new Set(['new-tip', 'new-result', 'new-coverage']));
  expect(parseCommands([{ type: 'paint.add', id: layer.id, stroke: wet().toJSON() }])).toHaveLength(1);
  expect(() => parseCommands([{ type: 'paint.add', id: layer.id, stroke: { ...wet().toJSON(), extra: true } }])).toThrow();
});

it('plans wet paint in its native SVG prefix and retains later editable artwork', () => {
  const document = new Document(), earlier = document.layers.add(new PaintLayer()), layer = document.layers.add(new PaintLayer()), later = document.layers.add(new PaintLayer()); earlier.strokes.add(brush()); layer.strokes.add(wet()); later.strokes.add(brush());
  const saved = document.toJSON(), plan = planSvgComposition(saved);
  expect(plan.wetPaint).toBe(1); expect(plan.prefixes).toBe(1); expect(plan.nativeAssets).toEqual(new Set(['tip', 'result', 'coverage'])); expect(plan.document.children.map(child => child.id)).toEqual([layer.id, later.id]); expect(document.toJSON()).toEqual(saved);
  const report = getExportCapabilityReport(saved, { format: 'svg' }); expect(report.featuresDegradedOrOmitted.join(' ')).toContain('Editable wet-paint operations'); expect(report.warnings.join(' ')).toContain('native replacement');
});

it('retains expanded native raster support in Photoshop records and anchors resize handles to ink bounds', () => {
  const document = new Document(), layer = document.layers.add(new RasterLayer({ assetId: 'original', width: 12, height: 8, x: 20, y: 10 })); layer.applyWetPaint(wet());
  const plan = planPsdExport(document.toJSON()); expect(plan.layers[0]).toMatchObject({ left: 18, top: 10, width: 14, height: 8 });
  const base = { layerKind: 'raster' as const, layerX: 20, layerY: 10, layerWidth: 12, layerHeight: 8, layerContentBounds: { x: -2, y: 0, width: 14, height: 8 } };
  const right = computeResizePatch({ ...base, handle: 'se' }, 14, 8, false); expect(right).toEqual({ x: 22, y: 10, width: 24, height: 16 }); expect(right.x! - 2 * right.width! / 12).toBe(18);
  const left = computeResizePatch({ ...base, handle: 'nw' }, -14, -8, false); expect(left).toEqual({ x: 8, y: 2, width: 24, height: 16 }); expect(left.x! + 12 * left.width! / 12).toBe(32);
});

function image(width = 2, height = 2): WetImageSource {
  const bytes = new Uint8Array(29); bytes.set([137, 80, 78, 71, 13, 10, 26, 10]); bytes.set(new TextEncoder().encode('IHDR'), 12); const view = new DataView(bytes.buffer); view.setUint32(16, width); view.setUint32(20, height); bytes[24] = 8; bytes[25] = 6;
  return { blob: new Blob([bytes]), width, height, identity: {} };
}
function provider(output: number[][], coverage: number[][], mutate?: () => void) {
  const sources = new Map([['result', image()], ['coverage', image()]]), closed: string[] = [];
  const value: WetAssetProvider = { get: key => sources.get(key)!, async *alpha(source) { const key = source === sources.get('result') ? 'result' : 'coverage'; try { for (const bytes of key === 'result' ? output : coverage) { yield Uint8Array.from(bytes); mutate?.(); } } finally { closed.push(key); } } };
  return { value, sources, closed };
}
it('validates premasked native alpha across unequal stream chunks and closes both readers', async () => {
  const fixture = provider([[0, 64, 128], [255]], [[0], [128, 128, 255]]); await validateWetPaintTile(tile(), fixture.value); expect(fixture.closed.sort()).toEqual(['coverage', 'result']);
  for (const [out, mask] of [[[[1, 0, 0, 0]], [[0, 255, 255, 255]]], [[[0, 0, 0]], [[255, 255, 255, 255]]], [[[0, 0, 0, 0, 0]], [[255, 255, 255, 255, 255]]]]) {
    const bad = provider(out, mask); await expect(validateWetPaintTile(tile(), bad.value)).rejects.toThrow(/masked|extent|exceeds/); expect(bad.closed.sort()).toEqual(['coverage', 'result']);
  }
});
it('rejects source replacement, dimensions and cancellation during native alpha validation', async () => {
  const fixture = provider([[0], [0, 0, 0]], [[255], [255, 255, 255]], () => fixture.sources.set('result', image()));
  await expect(validateWetPaintTile(tile(), fixture.value)).rejects.toThrow(/changed/); expect(fixture.closed.sort()).toEqual(['coverage', 'result']);
  const wrong = provider([[0, 0, 0, 0]], [[255, 255, 255, 255]]); wrong.sources.set('result', image(1, 4)); await expect(validateWetPaintTile(tile(), wrong.value)).rejects.toThrow(/dimensions/);
  const abort = provider([[0, 0, 0, 0]], [[255, 255, 255, 255]]); abort.value.check = () => { throw new Error('Stopped'); }; await expect(validateWetPaintTile(tile(), abort.value)).rejects.toThrow('Stopped');
});
