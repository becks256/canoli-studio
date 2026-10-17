import { selectionRegionTransform, type SelectionData } from '../core/drawing';
import { selectionModificationRequestSchema, type SelectionModificationRequest, type SelectionModificationProgress } from '../core/selection-modification';
import { renderSelection, featherAlpha, type PixelKernel } from './wasm';

/** Exact grayscale disk dilation/erosion on a padded native-resolution tile. */
export function morphSelectionTile(
  pixels: Uint8ClampedArray, sourceWidth: number, width: number, height: number,
  padding: number, radius: number, expand: boolean,
): Uint8Array {
  const output = new Uint8Array(width * height);
  if (!expand) output.fill(255);
  const queue = new Int32Array(sourceWidth);
  for (let y = 0; y < height; y++) {
    for (let dy = -radius; dy <= radius; dy++) {
      const half = Math.floor(Math.sqrt(radius * radius - dy * dy));
      const row = (y + padding + dy) * sourceWidth * 4;
      let head = 0, tail = 0;
      for (let x = padding - half; x < padding + width + half; x++) {
        while (head < tail && queue[head] < x - 2 * half) head++;
        const value = pixels[row + x * 4 + 3];
        while (head < tail && (expand
          ? pixels[row + queue[tail - 1] * 4 + 3] <= value
          : pixels[row + queue[tail - 1] * 4 + 3] >= value)) tail--;
        queue[tail++] = x;
        const column = x - half - padding;
        if (column < 0) continue;
        const index = y * width + column, best = pixels[row + queue[head] * 4 + 3];
        output[index] = expand ? Math.max(output[index], best) : Math.min(output[index], best);
      }
    }
  }
  return output;
}

/** Worker-only pixels; retained output is sparse RLE plus at most one 512-row band. */
export async function modifySelectionCoverage(
  kernel: PixelKernel, input: SelectionModificationRequest,
  progress: (value: SelectionModificationProgress) => void = () => {},
): Promise<SelectionData> {
  const request = selectionModificationRequestSchema.parse(input);
  const { selection, width: canvasWidth, height: canvasHeight, operation, radius } = request;
  const padding = operation === 'feather' ? 3 * Math.ceil(radius / 3) : radius;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const region of selection.regions) {
    if (region.operation !== 'add') continue;
    const bounds = selectionRegionTransform(region).bounds(region);
    left = Math.min(left, bounds.x); top = Math.min(top, bounds.y);
    right = Math.max(right, bounds.x + bounds.width); bottom = Math.max(bottom, bounds.y + bounds.height);
  }
  left = Math.max(0, Math.floor(left - padding)); top = Math.max(0, Math.floor(top - padding));
  right = Math.min(canvasWidth, Math.ceil(right + padding)); bottom = Math.min(canvasHeight, Math.ceil(bottom + padding));
  if (right <= left || bottom <= top) { progress({completed:1,total:1}); return {regions:[]}; }
  const width = right - left, height = bottom - top;
  if (!Number.isSafeInteger(width * height)) throw new Error('Selection coverage exceeds safe integer indexing.');
  const tileSize = 512, total = Math.ceil(width / tileSize) * Math.ceil(height / tileSize);
  let completed = 0, nonempty = false, offset = 0;
  const runs: number[] = [];
  const append = (end: number, value: number) => {
    if (runs.length && runs[runs.length - 1] === value) runs[runs.length - 2] = end;
    else runs.push(end, value);
  };
  progress({completed,total});
  for (let by = 0; by < height; by += tileSize) {
    const h = Math.min(tileSize, height - by), rows: number[][] = Array.from({length:h}, () => []);
    for (let bx = 0; bx < width; bx += tileSize) {
      const w = Math.min(tileSize, width - bx), sw = w + 2 * padding, sh = h + 2 * padding;
      const x = left + bx - padding, y = top + by - padding;
      let pixels = renderSelection(kernel, {selection,width:sw,height:sh,x,y,stepX:1,stepY:1});
      // Outside the canvas is unselected, including when source regions extend beyond it.
      if (x < 0 || y < 0 || x + sw > canvasWidth || y + sh > canvasHeight)
        for (let row = 0; row < sh; row++) for (let col = 0; col < sw; col++)
          if (x + col < 0 || x + col >= canvasWidth || y + row < 0 || y + row >= canvasHeight)
            pixels[(row * sw + col) * 4 + 3] = 0;
      let coverage: Uint8Array | undefined;
      if (operation === 'feather') pixels = featherAlpha(kernel,pixels,{width:sw,height:sh,radiusX:radius/3,radiusY:radius/3});
      else coverage = morphSelectionTile(pixels,sw,w,h,padding,radius,operation === 'expand');
      for (let row = 0; row < h; row++) {
        const spans = rows[row];
        let value = -1;
        for (let col = 0; col < w; col++) {
          const alpha = coverage ? coverage[row*w+col] : pixels[((row+padding)*sw+col+padding)*4+3];
          nonempty ||= alpha > 0;
          if (alpha !== value) {
            if (col) spans.push(bx+col,value);
            value = alpha;
          }
        }
        spans.push(bx+w,value);
      }
      progress({completed:++completed,total});
    }
    for (const row of rows) {
      for (let i = 0; i < row.length; i += 2) append(offset + row[i],row[i+1]);
      offset += width;
    }
  }
  return nonempty ? {regions:[{shape:'pixels',operation:'add',x:left,y:top,width,height,coverage:{width,height,runs}}]} : {regions:[]};
}
