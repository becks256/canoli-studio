import {test, expect} from '@playwright/test';
import {expectPenControl} from './pen-control-position';

for (const target of ['artwork', 'mask'] as const) test(`Pen edits across control blocks retain all geometry and atomic undo: ${target}`, async ({page}, info) => {
  await page.goto('/');
  await page.evaluate(target => {
    const {editor, VectorLayer, VectorPath, LayerMask} = window.luma;
    const document = editor.newDocument({width: 800, height: 600});
    const layer = document.layers.add(new VectorLayer());
    const path = new VectorPath({closed: true, fill: '#d05324', points: Array.from({length: 130}, (_, i) => {
      const x = 50+i%16*40, y = 50+Math.floor(i/16)*40;
      return {x, y, in: {x: x-12, y: y+12}, out: {x: x+12, y: y-12}};
    })});
    layer.paths.add(path);
    if (target === 'mask') layer.mask = new LayerMask({paths: [path]});
    document.selectedLayer = layer;
  }, target);
  await page.getByRole('button', {name: 'Vector pen (P)', exact: true}).click();
  if (target === 'mask') await page.getByRole('combobox', {name: 'Pen target', exact: true}).selectOption('mask');
  await page.keyboard.press('Control+1');
  const controls = page.getByTestId('pen-controls'), anchors = controls.locator('rect');
  await expect(anchors).toHaveCount(130);
  await expect(controls.locator('circle')).toHaveCount(260);
  await page.waitForFunction(() => !document.querySelector('footer .status-dot.working'));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const model = () => page.evaluate(() => JSON.stringify(window.luma.editor.document.toJSON()));
  const pixels = () => page.locator('.canvas-wrap canvas').evaluate(node => (node as HTMLCanvasElement).toDataURL());
  const original = await model(), originalPixels = await pixels();
  const changes = [];
  for (const index of [63, 64, 127, 128]) {
    const x = 50+index%16*40, y = 50+Math.floor(index/16)*40;
    const revision = await page.evaluate(() => window.luma.editor.document.getSnapshot().revision);
    const rect = (await anchors.nth(index).boundingBox())!;
    await page.mouse.move(rect.x+rect.width/2, rect.y+rect.height/2);
    await page.mouse.down();
    await page.mouse.move(rect.x+rect.width/2+17, rect.y+rect.height/2+13);
    await expectPenControl(anchors.nth(index), x+17, y+13);
    await expectPenControl(anchors.nth(index-1), 50+(index-1)%16*40, 50+Math.floor((index-1)/16)*40);
    expect(await model()).toBe(original);
    expect(await page.evaluate(() => window.luma.editor.document.getSnapshot().revision)).toBe(revision);
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => window.luma.editor.document.getSnapshot().revision)).toBe(revision+1);
    const edited = await model();
    expect(edited).not.toBe(original);
    await page.keyboard.press('Control+z');
    await expectPenControl(anchors.nth(index), x, y);
    expect(await model()).toBe(original);
    await page.keyboard.press('Control+Shift+z');
    await expectPenControl(anchors.nth(index), x+17, y+13);
    expect(await model()).toBe(edited);
    await page.keyboard.press('Control+z');
    changes.push({index, x, y, revision});
  }
  // A handle in the partial final block must invalidate just as an anchor does.
  const handle = controls.locator('circle').nth(128*2+1), box = (await handle.boundingBox())!;
  await page.mouse.move(box.x+box.width/2, box.y+box.height/2);
  await page.mouse.down();
  await page.mouse.move(box.x+box.width/2+9, box.y+box.height/2-5);
  await expectPenControl(handle, 71, 353);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expectPenControl(handle, 62, 358);
  expect(await model()).toBe(original);
  await expect.poll(pixels).toBe(originalPixels);
  await expect(anchors).toHaveCount(130);
  await expect(controls.locator('circle')).toHaveCount(260);
  await info.attach('pen-block-edits', {body: JSON.stringify({target, changes, handleCancelled: true, modelExact: true, pixelsExact: true}), contentType: 'application/json'});
});

test('Pen controls follow path length changes and restore exact geometry on undo', async ({page}, info) => {
  await page.goto('/');
  await page.evaluate(() => {
    const {editor, VectorLayer, VectorPath} = window.luma;
    const document = editor.newDocument({width: 800, height: 600});
    const layer = document.layers.add(new VectorLayer());
    layer.paths.add(new VectorPath({points: Array.from({length: 130}, (_, i) => ({x: 20+i%20*25, y: 20+Math.floor(i/20)*25}))}));
    document.selectedLayer = layer;
  });
  await page.getByRole('button', {name: 'Vector pen (P)', exact: true}).click();
  await page.keyboard.press('Control+1');
  const controls = page.getByTestId('pen-controls'), anchors = controls.locator('rect');
  const original = await page.evaluate(() => JSON.stringify(window.luma.editor.document.toJSON()));
  for (const length of [1, 63, 64, 65, 127, 128, 129, 130]) {
    await page.evaluate(length => {
      const owner = window.luma.editor.document.selectedLayer;
      if (!(owner instanceof window.luma.VectorLayer)) throw new Error('Expected vector layer.');
      owner.paths.at(0)!.update({points: Array.from({length}, (_, i) => {
        const x = i === length-1 ? 300 : 20+i%20*25, y = i === length-1 ? 300 : 20+Math.floor(i/20)*25;
        return {x, y, in: {x, y}, out: {x, y}};
      })});
    }, length);
    await expect(anchors).toHaveCount(length);
    await expect(controls.locator('circle')).toHaveCount(length*2);
    await expectPenControl(anchors.last(), 300, 300);
    await page.keyboard.press('Control+z');
    await expect(anchors).toHaveCount(130);
    await expectPenControl(anchors.last(), 245, 170);
    expect(await page.evaluate(() => JSON.stringify(window.luma.editor.document.toJSON()))).toBe(original);
  }
  await info.attach('pen-length-transitions', {body: JSON.stringify({lengths: [1, 63, 64, 65, 127, 128, 129, 130], modelUndoExact: true}), contentType: 'application/json'});
});
