import {test, expect} from '@playwright/test';
import {gunzipSync} from 'node:zlib';
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {historyInspectorProductionWorkflow, openHistoryInspector, historyProject, historyPng} from './helpers/history-inspector';

test('history inspector previews and moves through retained artwork with normal undo and redo', async ({page}, info) => {
  await historyInspectorProductionWorkflow(page, info);
});
test('stale inspector captures reject navigation without dropping newer edits', async ({page}) => {
  await page.goto('/'); await expect(page.getByRole('button', {name: 'History', exact: true})).toBeVisible();
  await page.evaluate(() => {window.luma.editor.document.name = 'First'; window.luma.editor.document.name = 'Second';});
  const dialog = await openHistoryInspector(page); await dialog.getByRole('button', {name: /^Inspect history state 0:/}).click();
  await page.evaluate(() => {window.luma.editor.document.name = 'Newer edit';});
  await dialog.getByRole('button', {name: 'Move to selected history state', exact: true}).click();
  await expect(dialog.getByRole('alert')).toContainText('History changed');
  expect(await page.evaluate(() => window.luma.editor.document.name)).toBe('Newer edit');
  await dialog.getByRole('button', {name: 'Reload history timeline', exact: true}).click();
  await expect(dialog.getByRole('button', {name: /^Inspect history state /})).toHaveCount(4);
  await dialog.getByRole('button', {name: /^Inspect history state 0:/}).click();
  await dialog.getByRole('button', {name: 'Move to selected history state', exact: true}).click();
  expect(await page.evaluate(() => window.luma.editor.document.getSnapshot().past.length)).toBe(0);
});

test('browser snapshots cannot replace the live model or retained states outside commands', async ({page}) => {
  await page.goto('/'); await expect(page.getByRole('button', {name: 'History', exact: true})).toBeVisible();
  const result = await page.evaluate(() => {
    const document = window.luma.editor.document, initial = document.name;
    document.name = 'Accepted edit'; const state = document.getSnapshot(), revision = state.revision;
    const currentWrite = Reflect.set(state, 'document', {...state.document, name: 'Forged current'});
    const retainedWrite = Reflect.set(state.past[0], 'document', {...state.past[0].document, name: 'Forged retained'});
    const labelWrite = Reflect.set(state.past[0], 'label', 'Forged label');
    const observed = document.name; document.navigateHistory(0);
    return {currentWrite, retainedWrite, labelWrite, observed, initial, restored: document.name, revisionAfter: document.getSnapshot().revision, expectedRevision: revision + 1};
  });
  expect(result.currentWrite).toBe(false); expect(result.retainedWrite).toBe(false); expect(result.labelWrite).toBe(false);
  expect(result.observed).toBe('Accepted edit'); expect(result.restored).toBe(result.initial); expect(result.revisionAfter).toBe(result.expectedRevision);
});
test('isolated scripts cannot navigate host history or commit preceding edits after navigation errors', async ({page}) => {
  await page.goto('/'); await page.getByRole('button', {name: 'Scripts (Mod+Shift+K)', exact: true}).click();
  const before = await page.evaluate(() => window.luma.editor.document.toJSON());
  await page.getByLabel('Script code', {exact: true}).fill("document.name='Must roll back';document.navigateHistory(0)");
  await page.getByRole('button', {name: 'Run script', exact: true}).click();
  await expect(page.getByLabel('Script output')).toContainText('Use editor undo/redo after a script finishes.');
  expect(await page.evaluate(() => window.luma.editor.document.toJSON())).toEqual(before);
});
test('history preview cancellation closes private work and releases source leases after closing its document', async ({page}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const {editor} = window.luma, canvas = document.createElement('canvas'); canvas.width = canvas.height = 16;
    const context = canvas.getContext('2d')!; context.fillStyle = '#315b2a'; context.fillRect(0, 0, 16, 16);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!)));
    editor.newDocument({width:64,height:64});
    const layer = await editor.importImage(new File([blob], 'History source.png', {type: 'image/png'}));
    const source = editor.assetStore.values()[0], bitmap = source.bitmap, documentBefore = editor.document;
    documentBefore.resize(64,64);layer.opacity = 0.5;
    const native = HTMLCanvasElement.prototype.toBlob; let enter!: () => void, finish!: () => void;
    const ready = new Promise<void>(resolve => {enter = resolve;});
    HTMLCanvasElement.prototype.toBlob = function(callback, ...args) {if(this.width===64&&this.height===64)native.call(this, value => {finish = () => callback(value); enter();}, ...args);else native.call(this,callback,...args);};
    const pending = editor.previewHistory(documentBefore.getSnapshot().past.length).then(() => 'unexpected success', cause => String(cause));
    try {
      await ready; editor.newDocument({width: 16, height: 16}); await editor.closeDocument(documentBefore, {discardChanges: true});
      const retainedWhilePending = bitmap.width; finish(); const error = await pending;
      return {retainedWhilePending, releasedAfterCancel: bitmap.width, error, activeLayers: editor.document.layers.length};
    } finally {HTMLCanvasElement.prototype.toBlob = native;}
  });
  expect(result.retainedWhilePending).toBe(16); expect(result.releasedAfterCancel).toBe(0);
  expect(result.error).toContain('History changed'); expect(result.activeLayers).toBe(0);
});
test('native 50 MP RAW history navigation preserves sources, redo and workspace recovery', async ({page}, info) => {
  test.setTimeout(480000); const path = info.outputPath('history-50mp.dng');
  await writeFile(path, gunzipSync(await readFile('tests/fixtures/raw/native-50mp.dng.gz')));
  await page.goto('/'); await page.getByTestId('import-input').setInputFiles(path);
  const review = page.getByRole('dialog', {name: 'Import camera RAW', exact: true});
  await review.getByRole('checkbox', {name: 'Convert RAW development to 8-bit editing precision', exact: true}).check();
  await review.getByRole('button', {name: 'Import RAW image', exact: true}).click(); await expect(review).toHaveCount(0, {timeout: 180000});
  const state = await page.evaluate(async () => {
    const {editor} = window.luma, document = editor.document;
    document.name = 'History 50 MP'; const newest = document.getSnapshot().past.length;
    document.navigateHistory(newest - 1); const preview = await editor.previewHistory(newest - 1);
    const bitmap = await createImageBitmap(preview.after), previewSize = [bitmap.width, bitmap.height]; bitmap.close();
    editor.workspaceRepository.restoreOnStartup = true; await editor.workspaceAutosave.flush();
    return {name: document.name, width: document.width, height: document.height, position: document.getSnapshot().past.length, previewSize};
  });
  expect(state.previewSize).toEqual([512, 256]); await page.reload();
  await expect(page.getByRole('button', {name: 'Redo (Mod+Shift+Z)', exact: true})).toBeEnabled();
  expect(await page.evaluate(() => ({name: window.luma.editor.document.name, width: window.luma.editor.document.width, height: window.luma.editor.document.height, position: window.luma.editor.document.getSnapshot().past.length}))).toEqual({name: state.name, width: 10000, height: 5000, position: state.position});
  await page.getByRole('button', {name: 'Redo (Mod+Shift+Z)', exact: true}).click();
  const project = await historyProject(page, info, 'history-50mp.luma'), original = project.value.entries.find(entry => entry.raw)!.raw!.originalBlob;
  expect(original.size).toBe(100000672); expect(createHash('sha256').update(Buffer.from(await original.arrayBuffer())).digest('hex')).toBe('cfe25bed379735dfea685695e956838b284106e6527e6aff77e3901ef6ef9d85');
  const png = await historyPng(page, info, 'history-50mp.png'); await info.attach('history-50mp.png', {body: png.bytes, contentType: 'image/png'});
});

test('modal keyboard actions stay contained and dismissal restores focus', async ({page}) => {
  await page.goto('/'); await expect(page.getByRole('button', {name: 'History', exact: true})).toBeVisible();
  await page.evaluate(() => {window.luma.editor.document.name = 'Retained change';});
  const dialog = await openHistoryInspector(page), before = await page.evaluate(() => window.luma.editor.document.getSnapshot().revision);
  await dialog.getByRole('button', {name: /^Inspect history state 0:/}).focus();
  await page.keyboard.press('Control+z'); await page.keyboard.press('b');
  expect(await page.evaluate(() => window.luma.editor.document.getSnapshot().revision)).toBe(before);
  await expect(page.locator('button[aria-label="Move tool (V)"]')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Inspect retained history', exact: true})).toBeFocused();
});

test('long retained labels remain intact with wrapped light and dark short layouts', async ({page}, info) => {
  for (const theme of ['light', 'dark']) {
    await page.setViewportSize(theme === 'dark' ? {width: 1280, height: 720} : {width: 1440, height: 1000});
    await page.goto('/'); await expect(page.getByRole('button', {name: 'History', exact: true})).toBeVisible();
    await page.evaluate(theme => {
      window.dispatchEvent(new CustomEvent('luma:set-appearance', {detail: theme}));
      const document = window.luma.editor.document; document.transaction('LongOperationLabel'.repeat(500), () => {document.name = 'Changed';});
    }, theme);
    const dialog = await openHistoryInspector(page);
    await expect(dialog.getByRole('button', {name: 'Done', exact: true})).toBeVisible();
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => window.luma.editor.document.getSnapshot().past[0].label.length)).toBe(9000);
    expect(await dialog.getByRole('button', {name: /^Inspect history state 1:/}).getAttribute('aria-label')).toHaveLength('Inspect history state 1: '.length + 241);
    const controls = await dialog.locator('button').evaluateAll(elements => elements.map(element => ({width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height})));
    expect(controls.every(value => value.width >= 28 && value.height >= 28)).toBe(true);
    await info.attach(`history-${theme}.png`, {body: await dialog.screenshot(), contentType: 'image/png'});
    await dialog.getByRole('button', {name: 'Done', exact: true}).click();
  }
});
