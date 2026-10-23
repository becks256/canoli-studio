import {test, expect} from '@playwright/test';
import {historyBranchesWorkflow} from './helpers/history-branches';
import {openHistoryInspector, historyProject, historyPng} from './helpers/history-inspector';
import {gunzipSync} from 'node:zlib';
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

test('persistent branches restore artwork, undo paths and saved native alternatives through the UI', async ({page}, info) => {
  await historyBranchesWorkflow(page, info);
});
test('branch controls reject stale captures and contain typing shortcuts', async ({page}) => {
  await page.goto('/'); await expect(page.getByRole('button', {name:'History', exact:true})).toBeVisible();
  const dialog = await openHistoryInspector(page), input = dialog.getByLabel('Branch name', {exact:true});
  await input.fill('Keyboard candidate'); await input.press('Control+a'); await input.fill('Typed candidate');
  await page.evaluate(() => {window.luma.editor.document.name = 'Concurrent accepted edit';});
  await dialog.getByRole('button', {name:'Create branch from current state', exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('History changed');
  expect(await page.evaluate(() => window.luma.editor.document.getSnapshot().branches.length)).toBe(0);
  await dialog.getByRole('button', {name:'Reload history timeline', exact:true}).click();
  await dialog.getByRole('button', {name:'Create branch from current state', exact:true}).click();
  expect(await page.evaluate(() => window.luma.editor.document.name)).toBe('Concurrent accepted edit');
});
test('isolated scripts cannot mutate host branches and failed branch scripts roll back prior commands', async ({page}) => {
  await page.goto('/'); await page.getByRole('button', {name:'Scripts (Mod+Shift+K)', exact:true}).click();
  const before = await page.evaluate(() => window.luma.editor.document.toJSON());
  for (const call of ["createHistoryBranch('Forbidden')", "checkoutHistoryBranch('bad')", "renameHistoryBranch('bad','Forbidden')", "deleteHistoryBranch('bad')"]) {
    await page.getByLabel('Script code', {exact:true}).fill("document.name='Must roll back';document." + call);
    await page.getByRole('button', {name:'Run script', exact:true}).click();
    await expect(page.getByLabel('Script output')).toContainText('Use editor history branches after a script finishes.');
    expect(await page.evaluate(() => window.luma.editor.document.toJSON())).toEqual(before);
  }
});
test('branch switching explicitly invalidates a real active semantic recording', async ({page}) => {
  await page.goto('/'); await expect(page.getByRole('button', {name:'History', exact:true})).toBeVisible();
  const result = await page.evaluate(() => {
    const {editor, PaintLayer} = window.luma, doc = editor.document;
    doc.createHistoryBranch('Recorded alternative'); const main = doc.getSnapshot().branches.find(branch => branch.name === 'Main')!;
    editor.recipes.recorder.start(); doc.layers.add(new PaintLayer()); doc.checkoutHistoryBranch(main.id);
    return {messages:editor.recipes.recorder.getUnsupportedCommands(), layers:doc.layers.length};
  });
  expect(result.messages.join(' ')).toMatch(/branch switched/); expect(result.layers).toBe(0);
});
test('50 MP RAW branch-only sources survive pruned history, workspace recovery and native reopening', async ({page}, info) => {
  test.setTimeout(480000); const path = info.outputPath('branch-50mp.dng');
  await writeFile(path, gunzipSync(await readFile('tests/fixtures/raw/native-50mp.dng.gz')));
  await page.goto('/'); await page.getByTestId('import-input').setInputFiles(path);
  const review = page.getByRole('dialog', {name:'Import camera RAW', exact:true});
  await review.getByRole('checkbox', {name:'Convert RAW development to 8-bit editing precision', exact:true}).check();
  await review.getByRole('button', {name:'Import RAW image', exact:true}).click(); await expect(review).toHaveCount(0,{timeout:180000});
  const before = await page.evaluate(async () => {
    const {editor} = window.luma, doc = editor.document;
    doc.createHistoryBranch('Empty alternative'); doc.layers.at(0)!.remove();
    for (let i=0;i<65;i++) doc.name = `Empty revision ${i}`;
    const current = doc.getSnapshot();
    const linearHasRaster = [current.document,...current.past.map(entry => entry.document),...current.future.map(entry => entry.document)].some(value => value.children.length);
    editor.workspaceRepository.restoreOnStartup = true; await editor.workspaceAutosave.flush();
    return {linearHasRaster, branches:current.branches.map(branch=>branch.name)};
  });
  expect(before.linearHasRaster).toBe(false); expect(before.branches).toEqual(['Main','Empty alternative']);
  await page.reload(); await expect(page.getByRole('button', {name:'History', exact:true})).toBeVisible();
  const saved = await historyProject(page, info, 'branches-50mp.luma');
  expect(saved.value.document.children).toHaveLength(0); expect(saved.value.history?.version).toBe(4);
  const original = saved.value.entries.find(entry => entry.raw)!.raw!.originalBlob;
  expect(original.size).toBe(100000672); expect(createHash('sha256').update(Buffer.from(await original.arrayBuffer())).digest('hex')).toBe('cfe25bed379735dfea685695e956838b284106e6527e6aff77e3901ef6ef9d85');
  await page.getByTestId('project-input').setInputFiles(saved.path);
  const dialog = await openHistoryInspector(page);
  await dialog.getByLabel('Saved history branch', {exact:true}).selectOption({label:'Main'}); await dialog.getByRole('button', {name:'Switch to branch tip', exact:true}).click();
  await dialog.getByRole('button', {name:'Done', exact:true}).click();
  expect(await page.evaluate(() => [window.luma.editor.document.width,window.luma.editor.document.height,window.luma.editor.document.layers.length])).toEqual([10000,5000,1]);
  const png = await historyPng(page, info, 'branches-50mp.png'); await info.attach('branches-50mp.png', {body:png.bytes,contentType:'image/png'});
});
