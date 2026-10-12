import { readFile } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { instantiateKernel, renderSelection } from '../src/engine/wasm';
import { MarqueeSelection } from '../src/dom';
import { prepareClipboard } from '../src/engine/clipboard';
import { encodeCapturedPng } from '../src/engine/png';
vi.mock('../src/engine/png', () => ({ encodeCapturedPng: vi.fn(async () => new Blob()) }));

it('clipboard crop matches full pixel bounds with holes, edge pixels, partial alpha and selection masking', async () => {
  const kernel = await instantiateKernel(new Uint8Array(await readFile('public/wasm/pixels.wasm')));
  for (const pattern of ['dense', 'sparse', 'edges', 'single', 'empty']) {
    for (const masked of [false, true]) {
      const width = 37, height = 19, x = 5, y = 7;
      const pixels = new Uint8ClampedArray(width * height * 4);
      for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
        const i = (row * width + col) * 4;
        pixels.set([col * 5, row * 11, 99, 0], i);
        if (pattern === 'dense' || (pattern === 'sparse' && (row * 17 + col * 13) % 29 === 0) ||
            (pattern === 'edges' && (row === 0 || col === width - 1)) ||
            (pattern === 'single' && row === 9 && col === 18)) pixels[i + 3] = 1 + (row * 17 + col * 13) % 255;
      }
      const selection = masked ? new MarqueeSelection({shape:'ellipse', x:8.5, y:9.25, width:27, height:13}).toJSON() : undefined;
      const expected = pixels.slice();
      if (selection) {
        const mask = renderSelection(kernel, {selection, width, height, x, y, stepX:1, stepY:1});
        for (let i = 3; i < expected.length; i += 4) expected[i] = Math.round(expected[i] * mask[i] / 255);
      }
      let left = width, top = height, right = 0, bottom = 0;
      for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) if (expected[(row * width + col) * 4 + 3]) {
        left = Math.min(left, col); right = Math.max(right, col + 1);
        top = Math.min(top, row); bottom = Math.max(bottom, row + 1);
      }
      vi.mocked(encodeCapturedPng).mockClear();
      if (right <= left) {
        await expect(prepareClipboard(kernel, pixels, {width,height,x,y,selection})).rejects.toThrow('no visible pixels');
        expect(encodeCapturedPng).not.toHaveBeenCalled();
        continue;
      }
      const result = await prepareClipboard(kernel, pixels, {width,height,x,y,selection});
      expect([result.x,result.y]).toEqual([left,top]);
      const [actual,w,h] = vi.mocked(encodeCapturedPng).mock.calls[0];
      expect([w,h]).toEqual([right-left,bottom-top]);
      for (let row = top; row < bottom; row++) {
        expect(actual.slice((row-top)*w*4,(row-top+1)*w*4))
          .toEqual(expected.slice((row*width+left)*4,(row*width+right)*4));
      }
    }
  }
});
