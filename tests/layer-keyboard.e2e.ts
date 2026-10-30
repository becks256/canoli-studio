import {test, expect, type Page} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {layerKeyboardWorkflow} from './helpers/layer-keyboard';

test('keyboard tree selection and row edits preserve the 50 MP original, Undo and project reopening', async ({page}, info) => {
  test.setTimeout(180000); await layerKeyboardWorkflow(page, info);
});

async function scene(page: Page) {
  await page.goto('/'); await page.getByRole('button', {name: 'Move tool (V)', exact: true}).click();
  await page.evaluate(() => {
    const {editor, PaintLayer, PaintFill, LayerGroup} = window.luma;
    editor.newDocument({width: 400, height: 300});
    const paint = (name: string) => { const layer = new PaintLayer({name}); layer.strokes.add(new PaintFill({bounds: {x: 40, y: 60, width: 40, height: 40}, color: '#3c8e59'})); return layer; };
    editor.document.layers.add(paint('Bottom'));
    const group = new LayerGroup({name: 'Collection'}), nested = new LayerGroup({name: 'Nested'});
    group.layers.add(paint('Amber')); nested.layers.add(paint('Blue')); group.layers.add(nested); group.layers.add(paint('Bravo'));
    editor.document.layers.add(group); editor.document.selectedLayer = editor.document.layers.add(paint('Top'));
  });
  await expect(page.getByRole('treeitem')).toHaveCount(7);
}
const row = (page: Page, name: string) => page.getByRole('treeitem', {name, exact: true});
const model = (page: Page) => page.evaluate(() => ({model: JSON.stringify(window.luma.editor.document.toJSON()), past: window.luma.editor.document.getSnapshot().past.length, revision: window.luma.editor.document.getSnapshot().revision}));
const selected = (page: Page) => page.evaluate(() => window.luma.editor.document.selectedLayers.map(layer => layer.name));

test('tree hierarchy, expansion, parent focus and Home/End preserve selection and artwork', async ({page}) => {
  await scene(page); const before = await model(page);
  await expect(page.getByRole('tree', {name: 'Layers', exact: true})).toHaveAttribute('aria-multiselectable', 'true');
  await expect(row(page, 'Collection')).toHaveAttribute('aria-expanded', 'true');
  await expect(row(page, 'Blue')).toHaveAttribute('aria-level', '3');
  await expect(row(page, 'Top')).toHaveAttribute('aria-posinset', '1');
  await expect(row(page, 'Top')).toHaveAttribute('aria-setsize', '3');
  await expect(row(page, 'Top')).not.toHaveAttribute('aria-expanded');
  await row(page, 'Top').focus(); await page.keyboard.press('ArrowDown'); await expect(row(page, 'Collection')).toBeFocused();
  await page.keyboard.press('ArrowRight'); await expect(row(page, 'Bravo')).toBeFocused();
  await page.keyboard.press('ArrowDown'); await expect(row(page, 'Nested')).toBeFocused();
  await page.keyboard.press('ArrowRight'); await expect(row(page, 'Blue')).toBeFocused();
  await page.keyboard.press('ArrowLeft'); await expect(row(page, 'Nested')).toBeFocused();
  await page.keyboard.press('ArrowLeft'); await expect(row(page, 'Nested')).toHaveAttribute('aria-expanded', 'false'); await expect(row(page, 'Blue')).toHaveCount(0);
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await expect(row(page, 'Blue')).toBeFocused();
  await page.keyboard.press('Home'); await expect(row(page, 'Top')).toBeFocused();
  await page.keyboard.press('End'); await expect(row(page, 'Bottom')).toBeFocused();
  expect(await selected(page)).toEqual(['Top']); expect(await model(page)).toEqual(before);
});

test('Space toggles, Enter selects and Shift+Space selects a contiguous range', async ({page}) => {
  await scene(page); const before = await model(page); await row(page, 'Top').focus();
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Space'); expect(await selected(page)).toEqual(['Top', 'Collection']);
  await page.keyboard.press('Space'); expect(await selected(page)).toEqual(['Top']);
  await page.keyboard.press('Enter'); expect(await selected(page)).toEqual(['Collection']);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Space'); expect(await selected(page)).toEqual(['Collection', 'Bravo']);
  await page.keyboard.press('End'); await page.keyboard.press('Shift+Space');
  expect(await selected(page)).toEqual(['Bravo', 'Nested', 'Blue', 'Amber', 'Bottom']); expect(await model(page)).toEqual(before);
});

test('keyboard ranges grow, shrink and keep the focused endpoint active during additive ranges', async ({page}) => {
  await scene(page); const before = await model(page); await row(page, 'Top').focus();
  await page.keyboard.press('Shift+ArrowDown'); expect(await selected(page)).toEqual(['Top', 'Collection']);
  await page.keyboard.press('Shift+ArrowDown'); expect(await selected(page)).toEqual(['Top', 'Collection', 'Bravo']);
  await page.keyboard.press('Shift+ArrowUp'); expect(await selected(page)).toEqual(['Top', 'Collection']);
  await page.keyboard.press('Enter'); await page.keyboard.press('End'); await page.keyboard.press('Space');
  await page.keyboard.press('Home'); await page.keyboard.press('Control+Shift+ArrowDown');
  expect(new Set(await selected(page))).toEqual(new Set(['Collection', 'Bravo', 'Nested', 'Blue', 'Amber', 'Bottom']));
  expect(await page.evaluate(() => window.luma.editor.document.selectedLayer?.name)).toBe('Collection'); expect(await model(page)).toEqual(before);
});

test('filtered bulk selection excludes context groups and empty-tree keys never reach the canvas', async ({page}) => {
  await scene(page); const before = await model(page); await row(page, 'Collection').focus(); await page.keyboard.press('ArrowLeft');
  const search = page.getByRole('textbox', {name: 'Search layers', exact: true}); await search.fill('blue');
  await expect(page.getByRole('treeitem')).toHaveCount(3); await row(page, 'Collection').focus(); await page.keyboard.press('Control+a'); expect(await selected(page)).toEqual(['Blue']);
  await page.keyboard.press('ArrowRight'); await expect(row(page, 'Nested')).toBeFocused();
  await page.keyboard.press('ArrowLeft'); await expect(row(page, 'Collection')).toBeFocused(); await expect(row(page, 'Collection')).toHaveAttribute('aria-expanded', 'true');
  await search.fill('no match exists'); const tree = page.getByRole('tree', {name: 'Layers', exact: true}); await tree.focus();
  for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Space', 'b']) await page.keyboard.press(key);
  expect(await selected(page)).toEqual(['Blue']); await page.keyboard.press('Control+a'); expect(await selected(page)).toEqual([]);
  await expect(page.getByRole('button', {name: 'Move tool (V)', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await search.fill(''); await expect(row(page, 'Collection')).toHaveAttribute('aria-expanded', 'false'); await expect(row(page, 'Blue')).toHaveCount(0);
  expect(await model(page)).toEqual(before);
});

test('type-ahead refines a prefix and does not switch tools', async ({page}) => {
  await scene(page); const before = await model(page); await row(page, 'Top').focus();
  await page.keyboard.type('bra'); await expect(row(page, 'Bravo')).toBeFocused();
  await expect(page.getByRole('button', {name: 'Move tool (V)', exact: true})).toHaveAttribute('aria-pressed', 'true');
  expect(await selected(page)).toEqual(['Top']); expect(await model(page)).toEqual(before);
});

test('repeated type-ahead characters cycle visible names', async ({page}) => {
  await scene(page); await row(page, 'Top').focus();
  for (const name of ['Bravo', 'Blue', 'Bottom', 'Bravo']) { await page.keyboard.press('b'); await expect(row(page, name)).toBeFocused(); }
});

test('native row controls keep keyboard activation, shared Undo and Space isolation', async ({page}, info) => {
  await scene(page); const before = await model(page); await row(page, 'Top').focus(); await page.keyboard.press('Tab');
  const lock = page.getByRole('button', {name: 'Lock Top', exact: true}); await info.attach('tab-focus.json', {body: JSON.stringify(await page.evaluate(() => ({active: document.activeElement?.outerHTML, tabs: [...document.querySelectorAll('[data-layer-node-id]')].map(node => ({name: node.getAttribute('aria-label'), tab: node.getAttribute('tabindex')}))}))), contentType: 'application/json'}); await expect(lock).toBeFocused();
  await page.keyboard.down('Space'); await expect(page.locator('.viewport')).not.toHaveClass(/\bhand\b/); await page.keyboard.up('Space');
  await expect(page.getByRole('button', {name: 'Unlock Top', exact: true})).toBeFocused(); await page.keyboard.press('Space');
  await page.keyboard.press('Tab'); await expect(page.getByRole('button', {name: 'Hide Top', exact: true})).toBeFocused(); await page.keyboard.press('Space');
  await expect(page.getByRole('button', {name: 'Show Top', exact: true})).toBeFocused();
  expect((await model(page)).past).toBe(before.past + 3);
  for (let i = 0; i < 3; i++) await page.keyboard.press('Control+z'); expect(await model(page)).toMatchObject({model: before.model, past: before.past});
});

test('canvas arrows still nudge while editable filter keys stay native', async ({page}) => {
  await scene(page); const before = await model(page); const viewport = page.locator('.viewport'); await viewport.focus(); await expect(viewport).toBeFocused();
  await page.keyboard.press('ArrowDown'); expect((await model(page)).past).toBe(before.past + 1);
  expect(await page.evaluate(() => window.luma.editor.document.selectedLayer?.y)).toBe(1);
  await page.keyboard.press('Control+z'); expect((await model(page)).model).toBe(before.model);
  const search = page.getByRole('textbox', {name: 'Search layers', exact: true}); await search.fill('b'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Space');
  expect((await model(page)).model).toBe(before.model); await expect(search).toBeFocused();
});

test('a selection changed and restored in one task cannot revive a range anchor', async ({page}) => {
  await scene(page); const before = await model(page); await row(page, 'Top').focus(); await page.keyboard.press('Shift+ArrowDown'); await page.keyboard.press('ArrowDown');
  await page.evaluate(() => { const doc = window.luma.editor.document, selected = doc.selectedLayers; doc.selectedLayer = doc.layers.at(0)!; doc.selectLayers(selected); });
  await page.keyboard.press('Shift+ArrowDown'); expect(await selected(page)).toEqual(['Bravo', 'Nested']); expect(await model(page)).toEqual(before);
});

test('deleting the focused row repairs focus and tabs return to the current selection', async ({page}) => {
  await scene(page); await row(page, 'Top').focus(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowRight');
  await page.evaluate(() => { const group = window.luma.editor.document.layers.at(1); if (!(group instanceof window.luma.LayerGroup)) throw new Error('Missing group'); group.layers.at(2)!.remove(); });
  await expect(row(page, 'Collection')).toBeFocused();
  await page.getByRole('textbox', {name: 'Search layers', exact: true}).focus();
  await page.evaluate(() => { window.luma.editor.document.selectedLayer = window.luma.editor.document.layers.at(0)!; });
  await expect(row(page, 'Bottom')).toHaveAttribute('tabindex', '0');
});

test('Shift+Space uses the current active selection when no earlier tree anchor exists', async ({page}) => {
  await scene(page); const before = await model(page); await row(page, 'Top').focus(); await page.keyboard.press('End'); await page.keyboard.press('Shift+Space');
  expect(await selected(page)).toEqual(['Top', 'Collection', 'Bravo', 'Nested', 'Blue', 'Amber', 'Bottom']); expect(await model(page)).toEqual(before);
});

test('different imported selections with delimiter-colliding IDs cannot retain a range anchor', async ({page}) => {
  await page.goto('/'); await page.evaluate(() => {
    const {editor, Document, PaintLayer} = window.luma, source = new Document({width: 400, height: 300}), ids = ['a:b', 'c', 'a', 'b:c'];
    for (const id of ids) source.layers.add(new PaintLayer({name: 'Imported ' + id}));
    const data = source.toJSON(); data.children.forEach((layer, index) => layer.id = ids[index]);
    const doc = Document.fromJSON(data), Store = editor.assetStore.constructor as new () => typeof editor.assetStore;
    editor.replace(doc, new Store()); doc.selectLayers([doc.layers.at(0)!, doc.layers.at(1)!]);
  });
  const before = await model(page); await row(page, 'Imported a:b').focus(); await page.keyboard.press('Shift+ArrowUp');
  const changed = await page.evaluate(() => { const doc = window.luma.editor.document, from = doc.getSnapshot().selectedIds; doc.selectLayers([doc.layers.at(2)!, doc.layers.at(3)!]); return {from, to: doc.getSnapshot().selectedIds}; });
  expect(changed.from.join(':')).toBe(changed.to.join(':')); expect(changed.from).not.toEqual(changed.to);
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('Shift+ArrowUp'); expect(await selected(page)).toEqual(['Imported a', 'Imported b:c']); expect(await model(page)).toEqual(before);
});

test('a replacement document with identical IDs rejects old UI keys and resets focus/range ownership', async ({page}) => {
  await scene(page); await row(page, 'Top').focus(); await page.keyboard.press('Shift+ArrowDown'); await page.keyboard.press('ArrowDown');
  const replaced = await page.evaluate(() => {
    const {editor, Document} = window.luma, old = editor.document, before = [...old.getSnapshot().selectedIds], next = Document.fromJSON(old.toJSON()); next.selectedLayer = next.layers.at(0)!;
    const Store = editor.assetStore.constructor as new () => typeof editor.assetStore; editor.replace(next, new Store());
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', {key: ' ', code: 'Space', bubbles: true, cancelable: true}));
    return {sameId: old.id === next.id, oldBefore: before, oldAfter: old.getSnapshot().selectedIds, next: next.selectedLayers.map(layer => layer.name), data: JSON.stringify(next.toJSON()), past: next.getSnapshot().past.length};
  });
  expect(replaced.sameId).toBe(true); expect(replaced.oldAfter).toEqual(replaced.oldBefore); expect(replaced.next).toEqual(['Bottom']);
  await expect(row(page, 'Bottom')).toBeFocused(); await page.keyboard.press('Shift+ArrowUp'); expect(await selected(page)).toEqual(['Bottom', 'Amber']);
  expect(await model(page)).toMatchObject({model: replaced.data, past: replaced.past});
});

test('narrow layouts keep the active row controls reachable by keyboard', async ({page}) => {
  await page.setViewportSize({width: 900, height: 900}); await scene(page); const before = await model(page); await row(page, 'Top').focus();
  await page.keyboard.press('Tab'); const lock = page.getByRole('button', {name: 'Lock Top', exact: true}); await expect(lock).toBeFocused(); await expect(lock).toBeVisible();
  await page.keyboard.press('Space'); await expect(page.getByRole('button', {name: 'Unlock Top', exact: true})).toBeFocused(); await page.keyboard.press('Control+z');
  expect((await model(page)).model).toBe(before.model); await page.keyboard.press('Tab'); await expect(page.getByRole('button', {name: 'Hide Top', exact: true})).toBeFocused();
});

test('Undo restores row focus and usable selection after the Layers tree becomes empty', async ({page}) => {
  await page.goto('/'); await page.evaluate(() => {
    const {editor, PaintLayer} = window.luma; editor.newDocument({width: 400, height: 300});
    editor.document.layers.add(new PaintLayer({name: 'Restored row'}));
  });
  const restored = row(page, 'Restored row'), before = await model(page);
  await restored.focus(); await page.evaluate(() => window.luma.editor.document.layers.at(0)!.remove());
  await expect(page.getByRole('tree', {name: 'Layers', exact: true})).toBeFocused();
  await page.keyboard.press('Control+z'); await expect(restored).toBeFocused();
  await page.keyboard.press('Home'); await page.keyboard.press('Control+a'); await expect(restored).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Space'); await expect(restored).toHaveAttribute('aria-selected', 'false');
  expect(await model(page)).toMatchObject({model: before.model, past: before.past});
});

test('layer navigation keys move tree focus without nudging artwork or changing history', async ({page}, info) => {
  await page.goto('/');
  await page.evaluate(() => {
    const {editor, PaintLayer, PaintFill} = window.luma; editor.newDocument({width: 400, height: 300});
    for (let i = 0; i < 3; i++) { const layer = editor.document.layers.add(new PaintLayer({name: 'Keyboard ' + i})); layer.strokes.add(new PaintFill({bounds: {x: i * 70 + 20, y: 60, width: 40, height: 40}, color: '#3c8e59'})); }
    editor.document.selectedLayer = editor.document.layers.at(2)!;
  });
  const before = await page.evaluate(() => ({model: JSON.stringify(window.luma.editor.document.toJSON()), past: window.luma.editor.document.getSnapshot().past.length, selected: window.luma.editor.document.getSnapshot().selectedIds}));
  await page.getByRole('button', {name: 'Select Keyboard 2', exact: true}).focus();
  await page.keyboard.press('ArrowDown');
  const after = await page.evaluate(() => ({model: JSON.stringify(window.luma.editor.document.toJSON()), past: window.luma.editor.document.getSnapshot().past.length, selected: window.luma.editor.document.getSnapshot().selectedIds}));
  await writeFile(info.outputPath('navigation-authority.json'), JSON.stringify({before, after}, null, 2));
  expect(after).toEqual(before);
  await expect(page.getByRole('treeitem', {name: 'Keyboard 1', exact: true})).toBeFocused();
});
