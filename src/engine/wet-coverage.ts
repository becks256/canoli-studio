import { AffineTransform } from '../core/affine';
import type { AssetStore } from '../core/assets';
import type { BrushStrokeData, Rect } from '../core/drawing';
import type { BrushTextureSampler } from './brush-texture';
import { createCanvas, release } from './canvas';

/** Per-dab native footprint coverage on a fixed 256px raster grid. Flow,
 * pressure opacity, selection and whole-stroke opacity are applied elsewhere. */
export async function wetDabCoverage(stroke: BrushStrokeData, frame: AffineTransform, region: Rect, check: () => void, assets?: AssetStore, textures?: BrushTextureSampler): Promise<Uint8Array> {
  const result = new Uint8Array(region.width * region.height), cell = 256, gutter = 2;
  for (let cy = Math.floor(region.y / cell) * cell; cy < region.y + region.height; cy += cell)
    for (let cx = Math.floor(region.x / cell) * cell; cx < region.x + region.width; cx += cell) {
      check(); const size = cell + gutter * 2, shape = createCanvas(size, size);
      let texture: HTMLCanvasElement | undefined;
      try {
        const context = shape.getContext('2d')!, transform = AffineTransform.translation(-cx + gutter, -cy + gutter).multiply(frame);
        context.setTransform(transform.a, transform.b, transform.c, transform.d, transform.e, transform.f);
        context.fillStyle = '#ffffff';
        if (stroke.kind === 'pencil') context.fillRect(-1, -1, 2, 2);
        else {
          if (stroke.hardness < .999) { const gradient = context.createRadialGradient(0, 0, stroke.hardness, 0, 0, 1); gradient.addColorStop(0, '#ffffff'); gradient.addColorStop(1, '#ffffff00'); context.fillStyle = gradient; }
          context.beginPath(); context.arc(0, 0, 1, 0, Math.PI * 2); context.fill();
        }
        if (stroke.texture) {
          if (!assets || !textures) throw new Error('Wet-paint textured coverage requires captured source assets.');
          const source = assets.get(stroke.texture.assetId);
          texture = await textures.prepareAffine(assets, stroke.texture, {
            width: size, height: size, smoothing: stroke.kind !== 'pencil',
            sourceToOutput: transform.multiply(AffineTransform.translation(-1, -1)).multiply(AffineTransform.scale(2 / source.width, 2 / source.height)).toJSON(),
          }, { isCancelled: () => { check(); return false; } });
          check(); context.resetTransform(); context.globalCompositeOperation = 'destination-in'; context.drawImage(texture, 0, 0);
        }
        const left = Math.max(cx, region.x), top = Math.max(cy, region.y), width = Math.min(cx + cell, region.x + region.width) - left, height = Math.min(cy + cell, region.y + region.height) - top;
        const pixels = context.getImageData(left - cx + gutter, top - cy + gutter, width, height).data;
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) result[(top - region.y + y) * region.width + left - region.x + x] = pixels[(y * width + x) * 4 + 3];
      } finally { if (texture) release(texture); release(shape); }
    }
  check(); return result;
}
