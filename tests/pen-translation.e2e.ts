import {test, expect} from '@playwright/test';
import {penControlPosition, expectPenControl} from './pen-control-position';

for (const fixture of ['ordinary', 'rotation', 'reflection-shear', 'large-offset', 'precision-transition', 'blocks'] as const) test(`Pen controls retain independent affine pixels and screen sizes: ${fixture}`, async ({page}, info) => {
  await page.goto('/');
  await page.evaluate(fixture => {
    const {editor, VectorLayer, VectorPath, VectorContour, LayerGroup, AffineTransform} = window.luma;
    const doc = editor.newDocument({width: 480, height: 320});
    const group = doc.layers.add(new LayerGroup());
    const transforms = {
      ordinary: [[1, 0, 0, 1, 40, 30], [1, 0, 0, 1, 20, 10]],
      rotation: [[0, 1.5, -1, 0, 220.25, 30.75], [1, 0.1, 0.2, 1, 10.5, 5.25]],
      'reflection-shear': [[-0.9, 0.35, 0.22, 1.2, 220.3, 65.6], [1.1, 0.2, -0.1, 0.9, 30.25, 15.5]],
      'large-offset': [[1, 0, 0, 1, -1e10, -1e10], [1, 0, 0, 1, 0, 0]],
      'precision-transition': [[1, 0, 0, 1, -6000, -6000], [1, 0, 0, 1, 0, 0]],
      blocks: [[1, 0.2, -0.15, 1, 80, 30], [1, 0, 0.1, 1, 10, 5]],
    }[fixture];
    const [g, l] = transforms;
    group.transform = new AffineTransform(...g as [number, number, number, number, number, number]);
    const layer = group.layers.add(new VectorLayer());
    layer.transform = new AffineTransform(...l as [number, number, number, number, number, number]);
    const offset = fixture === 'large-offset' ? 1e10 : fixture === 'precision-transition' ? 6000 : 0;
    const shift = (p: {x: number; y: number; in?: {x: number; y: number}; out?: {x: number; y: number}}) => ({x: p.x+offset, y: p.y+offset, ...(p.in ? {in: {x: p.in.x+offset, y: p.in.y+offset}} : {}), ...(p.out ? {out: {x: p.out.x+offset, y: p.out.y+offset}} : {})});
    layer.paths.add(new VectorPath({closed: true, fill: '#304460', points: (fixture === 'blocks' ? Array.from({length: 130}, (_, i) => {
      const x=20+i%16*9,y=20+Math.floor(i/16)*9;
      return {x,y,in:{x:x-5,y:y+4},out:{x:x+5,y:y-4}};
    }) : [{x: 20, y: 20, in: {x: 10, y: 15}, out: {x: 30, y: 25}}, {x: 100, y: 35}, {x: 70, y: 100}]).map(shift),
      subpaths: [new VectorContour({points: [{x: 45, y: 40}, {x: 65, y: 45}, {x: 50, y: 65}].map(shift)})]}));
    doc.selectedLayer = layer;
    (window as any).penReferenceMatrices = {g, l};
  }, fixture);
  await page.getByRole('button', {name: 'Vector pen (P)', exact: true}).click();
  await page.keyboard.press('Control+1');
  const anchor = page.getByTestId('pen-controls').locator('rect').first();
  await expect(anchor).toBeVisible();
  const before = (await anchor.boundingBox())!;
  const reports = [];
  for (const zoom of [1, 1.5625]) {
    if (zoom !== 1) {
      await page.getByRole('button', {name: /^Zoom in/}).click();
      await page.getByRole('button', {name: /^Zoom in/}).click();
    }
    reports.push(await page.evaluate(async () => {
      const root = document.querySelector('svg.drawing-overlay') as SVGSVGElement;
      const {g, l} = (window as any).penReferenceMatrices as {g: number[]; l: number[]};
      const m = [g[0]*l[0]+g[2]*l[1], g[1]*l[0]+g[3]*l[1], g[0]*l[2]+g[2]*l[3], g[1]*l[2]+g[3]*l[3], g[0]*l[4]+g[2]*l[5]+g[4], g[1]*l[4]+g[3]*l[5]+g[5]];
      const width = Number(root.getAttribute('width')), height = Number(root.getAttribute('height')), zoom = width / 480;
      const layer = window.luma.editor.document.selectedLayer!.toJSON();
      if (layer.kind !== 'vector') throw new Error('Expected vector artwork.');
      const points = layer.paths.flatMap(p => [p.points, ...(p.subpaths ?? []).map(c => c.points)]);
      const at = (p: {x: number; y: number}) => ({x: m[0]*p.x+m[2]*p.y+m[4], y: m[1]*p.x+m[3]*p.y+m[5]});
      const expected = points.map(contour => contour.map((point, index) => {
        const p = at(point), inside = at(point.in), outside = at(point.out);
        return `<g><line x1="${inside.x}" y1="${inside.y}" x2="${outside.x}" y2="${outside.y}" stroke="#d5e79b" stroke-width="${1/zoom}"/><circle cx="${inside.x}" cy="${inside.y}" r="${3/zoom}" fill="#202523" stroke="#d5e79b" stroke-width="${1/zoom}"/><circle cx="${outside.x}" cy="${outside.y}" r="${3/zoom}" fill="#202523" stroke="#d5e79b" stroke-width="${1/zoom}"/><rect x="${p.x-4/zoom}" y="${p.y-4/zoom}" width="${8/zoom}" height="${8/zoom}" fill="${index===0?'#d5e79b':'#202523'}" stroke="#d5e79b" stroke-width="${1/zoom}"/></g>`;
      }).join('')).join('');
      const actual = root.cloneNode(true) as SVGSVGElement, reference = root.cloneNode(true) as SVGSVGElement;
      for (const svg of [actual, reference]) {svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); svg.removeAttribute('class');}
      const controls = reference.querySelector('[data-testid="pen-controls"]')!;
      controls.removeAttribute('transform'); controls.innerHTML = expected;
      const pixels = async (svg: SVGSVGElement) => {
        const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], {type: 'image/svg+xml'}));
        const image = new Image(), canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        try {image.src = url; await image.decode(); const c = canvas.getContext('2d')!; c.drawImage(image, 0, 0); return c.getImageData(0, 0, width, height).data;}
        finally {URL.revokeObjectURL(url); canvas.width = canvas.height = 0;}
      };
      const [a, b] = await Promise.all([pixels(actual), pixels(reference)]);
      let max = 0, different = 0;
      for (let i = 0; i < a.length; i++) {max = Math.max(max, Math.abs(a[i]-b[i])); if(a[i]!==b[i]) different++;}
      return {zoom, max, different, size: a.length, expectedAnchor: at(points[0][0])};
    }));
    const after = (await anchor.boundingBox())!;
    expect(after.width).toBeCloseTo(before.width, 3); expect(after.height).toBeCloseTo(before.height, 3);
    const position = await penControlPosition(anchor), wanted = reports.at(-1)!.expectedAnchor;
    expect(position.x).toBeCloseTo(wanted.x, 2); expect(position.y).toBeCloseTo(wanted.y, 2);
  }
  if (fixture === 'large-offset') {
    const original = await page.evaluate(() => JSON.stringify(window.luma.editor.document.toJSON()));
    await page.keyboard.press('ArrowRight');
    await expectPenControl(anchor, 21, 20);
    await page.keyboard.press('Control+z');
    await expectPenControl(anchor, 20, 20);
    expect(await page.evaluate(() => JSON.stringify(window.luma.editor.document.toJSON()))).toBe(original);
  }
  await info.attach('pen-affine-reference', {body: JSON.stringify({fixture, reports}), contentType: 'application/json'});
  for (const report of reports) expect(report.max, JSON.stringify(report)).toBeLessThanOrEqual(1);
});

test('translating dense Pen artwork updates one shared transform and preserves every handle', async ({page}, info) => {
  await page.goto('/');
  await page.evaluate(() => {
    const {editor, VectorLayer, VectorPath} = window.luma;
    editor.newDocument({width: 800, height: 600});
    const layer = new VectorLayer();
    for (let i = 0; i < 100; i++) {
      const x = 20+i%10*60, y = 20+Math.floor(i/10)*40;
      layer.paths.add(new VectorPath({points: Array.from({length: 20}, (_, j) => ({x: x+j%5*4, y: y+Math.floor(j/5)*4})), closed: true, fill: '#e07142'}));
    }
    editor.document.selectedLayer = editor.document.layers.add(layer);
  });
  await page.getByRole('button', {name: 'Vector pen (P)', exact: true}).click();
  await page.keyboard.press('Control+1');
  const controls = page.getByTestId('pen-controls'), anchor = controls.locator('rect').first();
  await expect(controls.locator('rect')).toHaveCount(2000);
  await expectPenControl(anchor, 20, 20);
  const original = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="pen-controls"]')!;
    const events: string[] = [];
    const observer = new MutationObserver(records => events.push(...records.map(r => r.attributeName ?? '')));
    observer.observe(root, {attributes: true, subtree: true});
    (window as any).penMutations = {events, stop: () => {events.push(...observer.takeRecords().map(r => r.attributeName ?? '')); observer.disconnect();}};
    return JSON.stringify(window.luma.editor.document.toJSON());
  });
  await page.keyboard.press('ArrowRight');
  await expectPenControl(anchor, 21, 20);
  const changes = await page.evaluate(() => {const s=(window as any).penMutations; s.stop(); return s.events as string[];});
  expect(changes).toEqual(['transform']);
  await expect(controls.locator('rect')).toHaveCount(2000);
  await page.keyboard.press('Control+z');
  await expectPenControl(anchor, 20, 20);
  expect(await page.evaluate(() => JSON.stringify(window.luma.editor.document.toJSON()))).toBe(original);
  await info.attach('pen-translation-mutations', {body: JSON.stringify({anchors: 2000, changes}), contentType: 'application/json'});
});
