import {ProjectedErasureCaptures,drawProjectedErasure} from './projected-erasure';
import {drawProjectedBitmap,bitmapProjectionRequiresPrecision} from './bitmap-projection';
import { AffineTransform } from '../core/affine';
import type { AssetStore } from '../core/assets';
import {captureAssetSource} from '../core/assets';
import { strokeBounds, type BrushStrokeData } from '../core/drawing';
import type { PaintLayerData, RasterLayerData } from '../core/model';
import { unionBounds } from '../core/spatial';
import type { BrushTextureSampler } from './brush-texture';
import { createCanvas, release, renderTransform, type RenderSpace } from './canvas';
import { drawPaint } from './drawing';
import type { PixelProcessor } from './processor';
import { checkRenderCurrent } from './render-control';
import { yieldTask } from './task-yield';
import type { ClonePreviewSource } from './clone-preview';
import {nativeRenderTiles} from './native-tiles';
import { isActiveWetPaint } from '../core/wet-operation';

export function needsNativeRasterContent(layer:PaintLayerData|RasterLayerData):boolean{return hasWetContent(layer)||layer.kind==='raster'&&!!layer.erasures?.some(entry=>entry.placement);}

export function hasWetContent(layer: PaintLayerData | RasterLayerData): boolean { return layer.kind === 'paint' ? layer.strokes.some(isActiveWetPaint) : !!layer.erasures?.some(entry => isActiveWetPaint(entry.stroke)); }

/** Resolve pixel replacements in native content coordinates, then sample the
 * result through the layer transform. Output-pixel partitions share native
 * interpolation halos and have integer clips, avoiding internal AA seams. */
export async function drawNativeWetContent(layer: PaintLayerData | RasterLayerData, assets: AssetStore, target: HTMLCanvasElement, space: RenderSpace, world: AffineTransform, processor: PixelProcessor, isCancelled?: () => boolean, textures?: BrushTextureSampler, preview?: { stroke: BrushStrokeData; cloneSource?: ClonePreviewSource;erasurePlacement?:import('../core/drawing').ErasurePlacementData },borrowed?:ProjectedErasureCaptures): Promise<void> {
  const pin=layer.kind==='raster'?captureAssetSource(assets,layer.assetId):undefined,source=pin?.asset;
  const check=()=>{checkRenderCurrent(isCancelled);pin?.check();};
  const nativeToLocal = source && layer.kind === 'raster' ? AffineTransform.scale(layer.width / source.width, layer.height / source.height) : new AffineTransform();
  const operations = layer.kind === 'paint' ? [...layer.strokes, ...(preview ? [preview.stroke] : [])].filter(stroke => stroke.kind !== 'wet' || isActiveWetPaint(stroke)) : [];
  const bounds = layer.kind === 'paint' ? unionBounds(operations.map(strokeBounds)) : unionBounds([
    { x: 0, y: 0, width: source!.width, height: source!.height },
    ...(layer.erasures ?? []).filter(entry => isActiveWetPaint(entry.stroke)).map(entry => AffineTransform.scale(source!.width / entry.width, source!.height / entry.height).bounds(strokeBounds(entry.stroke))),
  ]);
  if (!bounds) return;
  const margin = layer.kind === 'paint' ? 2 : 0;
  const leftBound = Math.floor(bounds.x) - margin, topBound = Math.floor(bounds.y) - margin, rightBound = Math.ceil(bounds.x + bounds.width) + margin, bottomBound = Math.ceil(bounds.y + bounds.height) + margin;
  if (![leftBound, topBound, rightBound, bottomBound].every(Number.isSafeInteger)) throw new Error('Native wet-paint content bounds exceed numeric precision.');
  const nativeWorld=world.multiply(nativeToLocal),placement = renderTransform(space,nativeWorld),context = target.getContext('2d')!;
  const captures=borrowed??new ProjectedErasureCaptures(assets,processor,{isCancelled},textures);
  try {
  let deadline = performance.now() + 4;
  for(const tile of nativeRenderTiles(space,nativeWorld)){
    check();const clip=tile.output,mapped=tile.native;
    const left=Math.max(leftBound,mapped.x),top=Math.max(topBound,mapped.y),right=Math.min(rightBound,mapped.x+mapped.width),bottom=Math.min(bottomBound,mapped.y+mapped.height);
    if (right <= left || bottom <= top) continue;
    const nativeWidth = right - left, nativeHeight = bottom - top;
    if (nativeWidth * nativeHeight > 4_000_000 || Math.max(nativeWidth, nativeHeight) > 4096) throw new Error('This view requires a wet-paint sampling footprint beyond the working-buffer budget. Increase zoom; original source geometry remains unchanged.');
    const canvas = createCanvas(nativeWidth, nativeHeight, true), nativeSpace: RenderSpace = { x: left, y: top, width: nativeWidth, height: nativeHeight, sx: 1, sy: 1 };
    try {
      if (source && layer.kind === 'raster') {
        const native = canvas.getContext('2d')!; native.setTransform(1, 0, 0, 1, -left, -top); native.drawImage(source.bitmap, 0, 0); native.resetTransform();
        for (const entry of layer.erasures ?? []) if(entry.placement)await drawProjectedErasure(captures.get(entry),canvas,nativeSpace,new AffineTransform(),source.width,source.height);else await drawPaint({ ...layer, kind: 'paint', strokes: [entry.stroke] }, assets, canvas, nativeSpace, AffineTransform.scale(source.width / entry.width, source.height / entry.height), processor, undefined, undefined, () => true, undefined, isCancelled, textures, true);
        if(preview?.erasurePlacement)await drawProjectedErasure(captures.get({width:layer.width,height:layer.height,stroke:preview.stroke,placement:preview.erasurePlacement},preview.stroke),canvas,nativeSpace,new AffineTransform(),source.width,source.height);
        else if (preview) await drawPaint({ ...layer, kind: 'paint', strokes: [preview.stroke] }, assets, canvas, nativeSpace, AffineTransform.scale(source.width / layer.width, source.height / layer.height), processor, undefined, undefined, () => true, preview.cloneSource, isCancelled, textures, true);
      } else if (layer.kind === 'paint') for (const stroke of operations) await drawPaint({ ...layer, strokes: [stroke] }, assets, canvas, nativeSpace, new AffineTransform(), processor, undefined, undefined, () => true, stroke.id === preview?.stroke.id ? preview.cloneSource : undefined, isCancelled, textures, true);
      check(); context.save();
      try { context.resetTransform(); context.beginPath(); context.rect(clip.x,clip.y,clip.width,clip.height); context.clip(); context.setTransform(placement.a, placement.b, placement.c, placement.d, placement.e, placement.f); if(bitmapProjectionRequiresPrecision(placement,canvas.width,canvas.height))await drawProjectedBitmap(context,canvas,placement.multiply(AffineTransform.translation(left,top)),{isCancelled});else context.drawImage(canvas, left, top); }
      finally { context.restore(); }
    } finally { release(canvas); }
    if (performance.now() >= deadline) { await yieldTask(); check(); deadline = performance.now() + 4; }
  }
  if (layer.kind === 'raster') {
    const effects = layer.effects.filter(effect => effect.enabled && (effect.exposure !== 0 || effect.contrast !== 0 || effect.saturation !== 0));
    if (effects.length) for (let y = 0; y < target.height; y += 1024) for (let x = 0; x < target.width; x += 1024) {
      check(); const width = Math.min(1024, target.width - x), height = Math.min(1024, target.height - y), image = context.getImageData(x, y, width, height), pixels = await processor.process(image.data, effects); check(); const adjusted=context.createImageData(width,height);adjusted.data.set(pixels);context.putImageData(adjusted, x, y);
    }
  }
  check();
  } finally {if(!borrowed)captures.dispose();}
}
