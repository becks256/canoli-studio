import {yieldTask} from '../core/task-yield';
import type {HistoryComparison} from '../core/history';
import type {AssetStore} from '../core/assets';
import {CanvasRenderer} from './renderer';
import {createCanvas, release} from './canvas';

export interface HistoryDifferenceStatistics {
  comparedPixels: number; changedPixels: number; maximumChannelDelta: number; meanAbsoluteChannelDelta: number;
}
export interface HistoryComparisonPreview {
  before: Blob; after: Blob; difference: Blob; width: number; height: number; statistics: HistoryDifferenceStatistics;
}

/** Compare displayed sRGB8 premultiplied RGBA, including alpha; never label this a native-pixel proof. */
export async function compareHistoryPixels(before: Uint8ClampedArray, after: Uint8ClampedArray, width: number, height: number, check: () => void = () => {}): Promise<{pixels: Uint8ClampedArray; statistics: HistoryDifferenceStatistics}> {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > 512 * 512 || before.length !== width * height * 4 || after.length !== before.length)
    throw new Error('Invalid history comparison preview buffers.');
  const pixels = new Uint8ClampedArray(before.length);
  let changedPixels = 0, maximumChannelDelta = 0, absolute = 0;
  check();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4; let maximum = 0;
      for (let channel = 0; channel < 4; channel++) {
        const left = channel === 3 ? before[index + 3] : Math.round(before[index + channel] * before[index + 3] / 255);
        const right = channel === 3 ? after[index + 3] : Math.round(after[index + channel] * after[index + 3] / 255);
        const delta = Math.abs(left - right); absolute += delta; maximum = Math.max(maximum, delta);
      }
      if (maximum) changedPixels++;
      maximumChannelDelta = Math.max(maximumChannelDelta, maximum);
      pixels[index] = pixels[index + 2] = maximum; pixels[index + 3] = 255;
    }
    if ((y + 1) % 16 === 0) {await yieldTask(); check();}
  }
  check();
  return {pixels, statistics: {comparedPixels: width * height, changedPixels, maximumChannelDelta, meanAbsoluteChannelDelta: absolute / before.length}};
}

/** Private prepared inputs; the caller owns cancellation, leases and renderer disposal. */
export async function renderHistoryComparison(comparison: HistoryComparison, assets: AssetStore, renderer: CanvasRenderer, check: () => void, isCancelled: () => boolean): Promise<HistoryComparisonPreview> {
  const canvases: HTMLCanvasElement[] = [];
  const png = (canvas: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => {
    check(); canvas.toBlob(value => {try {check(); if (!value) throw new Error('History comparison could not be encoded.'); resolve(value);} catch (cause) {reject(cause);}}, 'image/png');
  });
  try {
    const rendered: HTMLCanvasElement[] = [];
    for (const document of [comparison.before, comparison.after]) {
      check(); const canvas = await renderer.render(document, assets, {cache: false, readback: true, region: comparison.region,
        scale: Math.min(1, 512 / comparison.region.width, 512 / comparison.region.height), maxPixels: 512 * 512, maxDimension: 512, isCancelled});
      canvases.push(canvas); check();
      // Region coordinates use a common document plane. Outside a smaller canvas
      // is transparent, even when that snapshot has off-canvas layer geometry.
      const context = canvas.getContext('2d')!; context.save(); context.resetTransform(); context.globalAlpha = 1; context.globalCompositeOperation = 'destination-in'; context.fillStyle = '#000';
      context.fillRect(-comparison.region.x * canvas.width / comparison.region.width, -comparison.region.y * canvas.height / comparison.region.height,
        document.width * canvas.width / comparison.region.width, document.height * canvas.height / comparison.region.height); context.restore();
      rendered.push(canvas);
    }
    const [before, after] = rendered, width = before.width, height = before.height;
    const result = await compareHistoryPixels(before.getContext('2d')!.getImageData(0, 0, width, height).data, after.getContext('2d')!.getImageData(0, 0, width, height).data, width, height, check);
    const difference = createCanvas(width, height, true); canvases.push(difference);
    const context = difference.getContext('2d')!, image = context.createImageData(width, height); image.data.set(result.pixels); context.putImageData(image, 0, 0);
    const beforeBlob = await png(before), afterBlob = await png(after), differenceBlob = await png(difference); check();
    return {before: beforeBlob, after: afterBlob, difference: differenceBlob, width, height, statistics: result.statistics};
  } finally {for (const canvas of canvases) release(canvas);}
}
