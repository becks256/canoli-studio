import {drawProjectedBitmap,bitmapProjectionRequiresPrecision} from './bitmap-projection';
import { AffineTransform } from '../core/affine';
import type { AssetStore } from '../core/assets';
import type { WetPaintStrokeData } from '../core/wet-operation';
import { validateWetPaintTile, type WetAssetProvider, type WetImageSource } from '../core/wet-assets';
import { createCanvas, release, renderTransform, type RenderSpace } from './canvas';
import type { PixelProcessor } from './processor';
import { checkRenderCurrent } from './render-control';
import { yieldTask } from './task-yield';

export function wetBrowserAssets(assets: Pick<AssetStore, 'get' | 'captureLifetime'>, check: () => void = () => {}): WetAssetProvider {
  const lifetime = assets.captureLifetime();
  return {
    get(id) { const asset = assets.get(id); if (asset.width !== asset.bitmap.width || asset.height !== asset.bitmap.height) throw new Error('Wet-paint decoded source dimensions changed.'); return { blob: asset.blob, width: asset.width, height: asset.height, identity: asset, pixels: asset.bitmap }; },
    check() { lifetime(); check(); },
    async *alpha(source: WetImageSource) {
      const asset = source.identity as ReturnType<AssetStore['get']>;
      // Whole-width strip assembly is unnecessary; chunks form native row order.
      const chunk = 1024, rows = source.width <= chunk ? 64 : 1; let deadline = performance.now() + 4;
      for (let y = 0; y < source.height; y += rows) for (let x = 0; x < source.width; x += chunk) {
        check(); lifetime(); const width = Math.min(chunk, source.width - x), height = Math.min(rows, source.height - y), canvas = createCanvas(width, height, true);
        try { const context = canvas.getContext('2d')!; context.drawImage(asset.bitmap, x, y, width, height, 0, 0, width, height); const rgba = context.getImageData(0, 0, width, height).data, alpha = new Uint8Array(width * height); for (let p = 0; p < alpha.length; p++) alpha[p] = rgba[p * 4 + 3]; yield alpha; }
        finally { release(canvas); }
        if (performance.now() >= deadline) { await yieldTask(); check(); lifetime(); deadline = performance.now() + 4; }
      }
    },
  };
}

/** Target is a native content-plane tile, before layer appearance/transform.
 * Coverage and pre-masked output project separately; output is never masked a
 * second time after interpolation. Envelope opacity blends the full result once. */
export async function compositeWetPaint(stroke: WetPaintStrokeData, assets: AssetStore, target: HTMLCanvasElement, space: RenderSpace, world: AffineTransform, processor: PixelProcessor, isCancelled?: () => boolean): Promise<void> {
  if (stroke.opacity === 0) return;
  const check = () => checkRenderCurrent(isCancelled), placement = renderTransform(space, world.multiply(AffineTransform.fromJSON(stroke.nativeTransform)));
  const before = target.getContext('2d')!.getImageData(0, 0, target.width, target.height).data;
  const raw = createCanvas(target.width, target.height, true), coverage = createCanvas(target.width, target.height);
  try {
    const context = raw.getContext('2d')!; context.drawImage(target, 0, 0);
    const provider = wetBrowserAssets(assets, check);
    for (const tile of stroke.tiles) {
      check(); const bounds = placement.bounds(tile);
      if (bounds.x + bounds.width < 0 || bounds.y + bounds.height < 0 || bounds.x > target.width || bounds.y > target.height) continue;
      await validateWetPaintTile(tile, provider); check();
      const mask = coverage.getContext('2d')!; mask.resetTransform(); mask.clearRect(0, 0, coverage.width, coverage.height); mask.setTransform(placement.a, placement.b, placement.c, placement.d, placement.e, placement.f); const coverageBitmap=assets.get(tile.coverage.assetId).bitmap;if(bitmapProjectionRequiresPrecision(placement,coverageBitmap.width,coverageBitmap.height))await drawProjectedBitmap(mask,coverageBitmap,placement.multiply(AffineTransform.translation(tile.x,tile.y)),{isCancelled});else mask.drawImage(coverageBitmap,tile.x,tile.y);
      context.resetTransform(); context.globalCompositeOperation = 'destination-out'; context.drawImage(coverage, 0, 0);
      context.globalCompositeOperation = 'lighter'; context.setTransform(placement.a, placement.b, placement.c, placement.d, placement.e, placement.f); const outputBitmap=assets.get(tile.assetId).bitmap;if(bitmapProjectionRequiresPrecision(placement,outputBitmap.width,outputBitmap.height))await drawProjectedBitmap(context,outputBitmap,placement.multiply(AffineTransform.translation(tile.x,tile.y)),{isCancelled});else context.drawImage(outputBitmap,tile.x,tile.y);
    }
    check(); const after = context.getImageData(0, 0, raw.width, raw.height).data;
    if (stroke.opacity === 1) { const result = target.getContext('2d')!; result.save(); try { result.resetTransform(); result.globalCompositeOperation = 'copy'; result.globalAlpha = 1; result.drawImage(raw, 0, 0); } finally { result.restore(); } return; }
    const mask = new Uint8ClampedArray(after.length);
    for (let p = 0; p < after.length; p += 4) if (before[p] !== after[p] || before[p + 1] !== after[p + 1] || before[p + 2] !== after[p + 2] || before[p + 3] !== after[p + 3]) mask[p + 3] = Math.round(stroke.opacity * 255);
    const pixels = await processor.mixFiltered(before, after, mask); check(); const result = target.getContext('2d')!, image = result.createImageData(target.width, target.height); image.data.set(pixels); result.putImageData(image, 0, 0);
  } finally { release(raw); release(coverage); }
}
