import {test, expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';

test('transformed SVG and Canvas retain independent native shaping, raster and tracking scales', async ({page}, info) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const {nativeLayoutSizeFontBytes} = await import(/* @vite-ignore */ String('/src/engine/native-layout-size-font.ts'));
    const {captureNativeLayoutSize} = await import(/* @vite-ignore */ String('/src/engine/native-layout-size.ts'));
    const {captureNativeTextSize} = await import(/* @vite-ignore */ String('/src/engine/native-text-size.ts'));
    // This independent font has a one-em nominal advance and a one-em GPOS
    // adjustment per adjacent pair. No artwork, reference pixels or fitted
    // glyph coordinates determine any measurement below.
    const face = new FontFace('IndependentSvgScale_' + crypto.randomUUID(), nativeLayoutSizeFontBytes().buffer);
    const before = JSON.stringify(window.luma.editor.document.toJSON());
    const ns = 'http://www.w3.org/2000/svg';
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-100000px;top:0;width:1px;height:1px;contain:strict;visibility:hidden';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', '2048');
    svg.setAttribute('height', '256');
    const group = document.createElementNS(ns, 'g');
    const text = document.createElementNS(ns, 'text');
    group.append(text);
    svg.append(group);
    host.attachShadow({mode: 'closed'}).append(svg);
    const rows = [];
    try {
      await face.load();
      document.fonts.add(face);
      document.body.append(host);
      text.style.fontFamily = face.family;
      text.style.whiteSpace = 'pre';
      text.style.wordSpacing = '0px';
      text.setAttribute('x', '0');
      text.setAttribute('y', '64');
      text.setAttribute('direction', 'ltr');
      text.setAttribute('text-anchor', 'start');
      const count = 1001;
      text.textContent = 'A'.repeat(count);
      for (const world of [[1, 0, 0, 1, 0, 0], [1.25, .125, -.25, .9, 15, 14]]) {
        const factor = Math.fround(Math.sqrt((world[0] ** 2 + world[1] ** 2 + world[2] ** 2 + world[3] ** 2) / 2));
        group.setAttribute('transform', `matrix(${world.join(' ')})`);
        for (const size of [40, 33.333, 64.5]) {
          const computedSize = Math.fround(size * factor);
          text.style.fontSize = size + 'px';
          text.style.letterSpacing = '0px';
          text.style.fontKerning = 'none';
          const off = text.getComputedTextLength();
          text.style.fontKerning = 'normal';
          const on = text.getComputedTextLength();
          const layout = await captureNativeLayoutSize(computedSize);
          const raster = await captureNativeTextSize(computedSize);
          text.style.fontKerning = 'none';
          const tracking = [];
          for (const spacing of [-30, -.001, .001, 1, 10]) {
            text.style.letterSpacing = spacing + 'px';
            tracking.push({spacing, physical: (text.getComputedTextLength() - off) * factor / count});
          }
          rows.push({world, size, factor, computedSize, layout, raster,
            svgLayout: (on - off) * factor / (count - 1),
            svgRaster: off * factor / count, tracking});
        }
      }
    } finally {
      host.remove();
      document.fonts.delete(face);
    }
    return {rows, unchanged: before === JSON.stringify(window.luma.editor.document.toJSON()),
      remainingFaces: [...document.fonts].filter(f => f.family === face.family || /^CanoliSize_/.test(f.family)).length};
  });
  await writeFile(info.outputPath('native-svg-context.json'), JSON.stringify(result, null, 2));
  expect(result).toMatchObject({unchanged: true, remainingFaces: 0});
  expect(result.rows).toHaveLength(6);
  for (const row of result.rows) {
    // DOM text lengths round the complete long run before returning Float32
    // geometry. This metric allowance is well below a layout unit; it grants
    // no tolerance to the separate exact ink and color-ownership checks.
    expect(Math.abs(row.svgLayout - row.layout)).toBeLessThan(.0001);
    expect(Math.abs(row.svgRaster - row.raster)).toBeLessThan(.0001);
    for (const sample of row.tracking) {
      expect(Math.abs(sample.physical - Math.fround(sample.spacing * row.factor))).toBeLessThan(.0001);
    }
  }
});
