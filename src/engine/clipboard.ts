import type { SelectionData } from '../core/drawing';
import { renderSelection, type PixelKernel } from './wasm';
import { encodeCapturedPng } from './png';

export interface ClipboardRequest { width: number; height: number; x: number; y: number; selection?: SelectionData | null }
export interface ClipboardResult { blob: Blob; x: number; y: number }

/** Runs in the image worker on private captured RGBA pixels. */
export async function prepareClipboard(kernel: PixelKernel, pixels: Uint8ClampedArray, options: ClipboardRequest): Promise<ClipboardResult> {
  const { selection, ...region } = options;
  if (!Number.isSafeInteger(region.width) || !Number.isSafeInteger(region.height) || region.width <= 0 || region.height <= 0 || pixels.length !== region.width * region.height * 4)
    throw new Error('Clipboard pixels require matching RGBA dimensions.');
    if (selection) {
      for (let y = 0; y < region.height; y += 1024) for (let x = 0; x < region.width; x += 1024) {
        const width = Math.min(1024, region.width-x), height = Math.min(1024, region.height-y);
        const mask = renderSelection(kernel, { selection: selection,
          width, height, x: options.x+x, y: options.y+y, stepX: 1, stepY: 1 });
        for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
          const p = ((y+row)*region.width+x+col)*4+3;
          pixels[p] = Math.round(pixels[p]*mask[(row*width+col)*4+3]/255);
        }
      }
    }
    let left = region.width, top = region.height, right = 0, bottom = 0;
    // Only the first and last visible pixel of each row can extend its bounds.
    // Dense rows therefore need two alpha checks, regardless of their width.
    for (let y = 0; y < region.height; y++) {
      const row = y * region.width * 4;
      let first = 0;
      while (first < region.width && !pixels[row + first * 4 + 3]) first++;
      if (first === region.width) continue;
      let last = region.width - 1;
      while (last > first && !pixels[row + last * 4 + 3]) last--;
      left = Math.min(left, first);
      right = Math.max(right, last + 1);
      top = Math.min(top, y);
      bottom = y + 1;
    }
    if (right <= left || bottom <= top) throw new Error('The selection contains no visible pixels on this layer.');
    const width = right-left, height = bottom-top;
    const cropped = width === region.width && height === region.height
      ? pixels : new Uint8ClampedArray(width*height*4);
    if (cropped !== pixels)
      for (let y = 0; y < height; y++) cropped.set(pixels.subarray(((top+y)*region.width+left)*4, ((top+y)*region.width+right)*4), y*width*4);
    const blob = await encodeCapturedPng(cropped, width, height);
    return { blob, x: left, y: top };
}
