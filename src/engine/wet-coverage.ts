import { AffineTransform } from '../core/affine';
import type { AssetStore } from '../core/assets';
import type { BrushStrokeData, Rect } from '../core/drawing';
import type { BrushTextureSampler } from './brush-texture';
import { createCanvas, release } from './canvas';

const cell = 256, gutter = 2, size = cell + gutter * 2;
interface CoverageSurfaces { take(): HTMLCanvasElement; giveBack(canvas: HTMLCanvasElement): void; }

/** One private spare per session. Borrowed surfaces are released by their
 * operation after cancellation, never reset underneath a pending texture read. */
export function createWetDabCoverage() {
  let spare: HTMLCanvasElement | undefined, closed = false;
  const surfaces: CoverageSurfaces = {
    take() {
      if (closed) throw new Error('Wet-paint coverage is disposed.');
      const canvas = spare ?? createCanvas(size, size); spare = undefined;
      const context = canvas.getContext('2d')!;
      context.resetTransform(); context.globalCompositeOperation = 'source-over';
      context.clearRect(0, 0, size, size);
      return canvas;
    },
    giveBack(canvas) {
      if (closed || spare) release(canvas);
      else spare = canvas;
    },
  };
  return {
    sample: ((stroke, frame, region, check, assets, textures) => {
      const current = () => { if (closed) throw new Error('Wet-paint coverage is disposed.'); check(); };
      return renderWetDabCoverage(stroke, frame, region, current, assets, textures, surfaces);
    }) as typeof wetDabCoverage,
    dispose() { closed = true; if (spare) release(spare); spare = undefined; },
  };
}

/** Per-dab native footprint coverage on a fixed 256px raster grid. Flow,
 * pressure opacity, selection and whole-stroke opacity are applied elsewhere. */
export async function wetDabCoverage(stroke: BrushStrokeData, frame: AffineTransform, region: Rect, check: () => void, assets?: AssetStore, textures?: BrushTextureSampler): Promise<Uint8Array> {
  return renderWetDabCoverage(stroke, frame, region, check, assets, textures);
}

async function renderWetDabCoverage(stroke: BrushStrokeData, frame: AffineTransform, region: Rect, check: () => void, assets?: AssetStore, textures?: BrushTextureSampler, surfaces?: CoverageSurfaces): Promise<Uint8Array> {
  const result = new Uint8Array(region.width * region.height);
  for (let cy = Math.floor(region.y / cell) * cell; cy < region.y + region.height; cy += cell)
    for (let cx = Math.floor(region.x / cell) * cell; cx < region.x + region.width; cx += cell) {
      check(); const shape = surfaces?.take() ?? createCanvas(size, size);
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
      } finally { if (texture) release(texture); if (surfaces) surfaces.giveBack(shape); else release(shape); }
    }
  check(); return result;
}
