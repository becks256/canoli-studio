import type {EditorCommand} from './commands';
import type {LayerMaskData} from './masks';
import type { DocumentData, LayerData } from './model';
import type { WetPaintStrokeData, WetPaintTileData } from './wet-operation';

export interface WetImageSource { blob: Blob; width: number; height: number; identity?: object; pixels?: object; }
export interface WetAssetProvider {
  get(id: string): WetImageSource;
  /** Complete native alpha in row order; independently sized bounded chunks. */
  alpha(source: WetImageSource): AsyncIterable<Uint8Array>;
  check?(): void;
}
const proofs = new WeakMap<object, WeakMap<object, { output: Blob; coverage: Blob }>>();
const headers = new WeakMap<Blob, Promise<{ width: number; height: number }>>();
function* maskOperations(mask:LayerMaskData|null|undefined):Generator<WetPaintStrokeData>{for(const entry of mask?.strokes??[])if(entry.mode==='wet')yield entry.stroke;}
export function* wetLayerOperations(layer:LayerData):Generator<WetPaintStrokeData>{
  yield* maskOperations(layer.mask);
  if(layer.kind==='smart-object')yield* maskOperations(layer.filterMask);
  if(layer.kind==='paint'){for(const stroke of layer.strokes)if(stroke.kind==='wet')yield stroke;}
  else if(layer.kind==='raster'){for(const entry of layer.erasures??[])if(entry.stroke.kind==='wet')yield entry.stroke;}
  else if(layer.kind==='group')for(const child of layer.children)yield* wetLayerOperations(child);
}
export function* wetDocumentOperations(document: DocumentData, visited = new Set<DocumentData>()): Generator<WetPaintStrokeData> {
  if(visited.has(document))return;visited.add(document);
  for(const layer of document.children)yield* wetLayerOperations(layer);
  for(const component of document.components??[])if(component.source.kind==='document')yield* wetDocumentOperations(component.source.document,visited);
}
/** Shared command discovery keeps asynchronous host validation aligned with every
 * location that can introduce prepared native output, including hidden/inert masks. */
export function commandHasWetPaint(command:EditorCommand):boolean{
  switch(command.type){
    case 'transaction':return command.commands.some(commandHasWetPaint);
    case 'paint.add':return command.stroke.kind==='wet';
    case 'layer.add':case 'smartObject.convertToRaster':return !wetLayerOperations(command.layer).next().done;
    case 'layer.update':return !maskOperations(command.patch.mask).next().done||!!command.patch.erasures?.some(entry=>entry.stroke.kind==='wet');
    case 'smartObject.filterMask':return !maskOperations(command.mask).next().done;
    case 'component.set':return command.definition.source.kind==='document'&&!wetDocumentOperations(command.definition.source.document).next().done;
    case 'component.replaceAll':return command.definitions.some(definition=>definition.source.kind==='document'&&!wetDocumentOperations(definition.source.document).next().done);
    default:return false;
  }
}
async function header(source: WetImageSource, tile: WetPaintTileData) {
  if (source.width !== tile.width || source.height !== tile.height) throw new Error('Wet-paint image and coverage dimensions must match the native tile.');
  let parsed = headers.get(source.blob);
  if (!parsed) { parsed = (async () => {
  const bytes = new Uint8Array(await source.blob.slice(0, 29).arrayBuffer());
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length !== 29 || signature.some((value, i) => bytes[i] !== value) || String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR' || bytes[24] !== 8 || (bytes[25] !== 6 && bytes[25] !== 2) || bytes[26] !== 0 || bytes[27] !== 0 || bytes[28] !== 0)
    throw new Error('Prepared wet-paint tiles require noninterlaced RGB8/RGBA8 PNG images and coverage.');
  const view = new DataView(bytes.buffer);
  return { width: view.getUint32(16), height: view.getUint32(20) };
  })(); headers.set(source.blob, parsed); }
  const dimensions = await parsed;
  if (dimensions.width !== tile.width || dimensions.height !== tile.height) throw new Error('Wet-paint PNG dimensions disagree with its native tile.');
}

/** Same content invariant for browser/script and independent headless hosts.
 * Output is already masked in native pixels, avoiding a second resampled mask.
 * PNG alpha must not exceed coverage alpha, including outside changed support. */
export async function validateWetPaintTile(tile: WetPaintTileData, provider: WetAssetProvider): Promise<void> {
  const output = provider.get(tile.assetId), coverage = provider.get(tile.coverage.assetId);
  const check = () => {
    provider.check?.();
    for (const [id, captured] of [[tile.assetId, output], [tile.coverage.assetId, coverage]] as const) {
      const current = provider.get(id);
      if (current.blob !== captured.blob || current.width !== captured.width || current.height !== captured.height || current.identity !== captured.identity || current.pixels !== captured.pixels) throw new Error('A prepared wet-paint asset changed during validation.');
    }
  };
  check(); await header(output, tile); check(); await header(coverage, tile); check();
  const outputIdentity = output.pixels ?? output.blob, coverageIdentity = coverage.pixels ?? coverage.blob;
  const proof = proofs.get(outputIdentity)?.get(coverageIdentity);
  if (proof?.output === output.blob && proof.coverage === coverage.blob) return;
  const left = provider.alpha(output)[Symbol.asyncIterator](), right = provider.alpha(coverage)[Symbol.asyncIterator]();
  let a: Uint8Array = new Uint8Array(), b: Uint8Array = new Uint8Array(), ai = 0, bi = 0, doneA = false, doneB = false, count = 0;
  try {
    while (true) {
      if (ai === a.length && !doneA) { const item = await left.next(); check(); doneA = !!item.done; if (!doneA) { if (!(item.value instanceof Uint8Array) || !item.value.length) throw new Error('Invalid wet-paint alpha stream.'); a = item.value; ai = 0; } }
      if (bi === b.length && !doneB) { const item = await right.next(); check(); doneB = !!item.done; if (!doneB) { if (!(item.value instanceof Uint8Array) || !item.value.length) throw new Error('Invalid wet-paint coverage stream.'); b = item.value; bi = 0; } }
      if (doneA || doneB) { if (doneA && doneB && count === tile.width * tile.height) break; throw new Error('Wet-paint alpha streams have invalid extents.'); }
      const length = Math.min(a.length - ai, b.length - bi);
      if (count + length > tile.width * tile.height) throw new Error('Wet-paint alpha stream exceeds the native tile.');
      for (let i = 0; i < length; i++) if (a[ai + i] > b[bi + i]) throw new Error('Wet-paint output must already be masked by its native coverage.');
      ai += length; bi += length; count += length;
    }
    check(); let proven = proofs.get(outputIdentity); if (!proven) proofs.set(outputIdentity, proven = new WeakMap()); proven.set(coverageIdentity, { output: output.blob, coverage: coverage.blob });
  } finally { try { await left.return?.(undefined); } finally { await right.return?.(undefined); } }
}
export async function validateWetPaintAssets(document: DocumentData, provider: WetAssetProvider): Promise<void> {
  for (const stroke of wetDocumentOperations(document)) for (const tile of stroke.tiles) await validateWetPaintTile(tile, provider);
}
