import {test, expect} from '@playwright/test';
import {historyProvenanceWorkflow} from './helpers/history-provenance';
import {examplePlugin} from '../src/plugins';

test('operation origins follow script, editor and plugin paths through undo and native reopening', async ({page}, info) => {
  await historyProvenanceWorkflow(page, info);
});

for (const change of ['human-edit', 'permission-revocation'] as const) {
  test('isolated candidate placement rejects ' + change + ' during source promotion', async ({page}) => {
    await page.goto('/');
    await expect(page.getByRole('button', {name: 'History', exact: true})).toBeVisible();
    const result = await page.evaluate(async ({change, manifest}) => {
      const editor = window.luma.editor, doc = editor.document, staging = editor.ai.staging;
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 16;
      canvas.getContext('2d')!.fillRect(0, 0, 16, 16);
      const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!)));
      const candidate = await staging.stageCandidate('local-fixture-job', {
        id: crypto.randomUUID(), providerId: 'local-fixture', width: 16, height: 16, hasAlpha: false,
        imageData: new Uint8Array(await blob.arrayBuffer()), mimeType: 'image/png', durationMs: 0, costCents: 0,
      }, {prompt: 'Local fixture, no inference', modality: 'text-to-image', targetWidth: 16, targetHeight: 16});
      let release!: () => void, entered!: () => void;
      const ready = new Promise<void>(resolve => {entered = resolve;});
      const hold = new Promise<void>(resolve => {release = resolve;});
      const promote = staging.promote.bind(staging);
      staging.promote = async (...args) => {entered(); await hold; return promote(...args);};
      const source = `await host.jobs.applyCandidate(${JSON.stringify(candidate.id)});`;
      if (change === 'permission-revocation') editor.plugins.install({...manifest, commands: [{id: 'held', title: 'Held candidate', source}]});
      const pending = (change === 'human-edit' ? editor.runScript(source) : editor.runPlugin(manifest.id, 'held'))
        .then(() => 'Unexpected success', cause => String(cause));
      try {
        await Promise.race([ready, pending.then(error => {throw Error('Host did not reach promotion: ' + error);})]);
        if (change === 'human-edit') doc.name = 'Human edit wins';
        else editor.plugins.revokePermission(manifest.id, 'document:write');
        release();
        const error = await pending;
        return {error, name: doc.name, layers: doc.layers.length, revision: doc.getSnapshot().revision,
          operation: doc.getSnapshot().provenance.current, assets: editor.assetStore.values().length, review: candidate.reviewState};
      } finally {release(); staging.promote = promote;}
    }, {change, manifest: examplePlugin});
    expect(result.error).toContain(change === 'human-edit' ? 'Document changed before the script host commit' : 'Plugin permissions changed before host commit');
    expect(result).toMatchObject({layers: 0, assets: 0, review: 'staged', revision: change === 'human-edit' ? 1 : 0});
    if (change === 'human-edit') expect(result.operation).toMatchObject({origin: {surface: 'editor'}});
    else expect(result.operation).toBeNull();
  });
}

test('isolated scripts cannot assign operation origins or commit preceding staged changes', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button', {name: 'Scripts (Mod+Shift+K)', exact: true}).click();
  const before = await page.evaluate(() => window.luma.editor.document.toJSON());
  for (const call of ["_setDefaultHistoryOrigin({surface:'editor'})", "_withHistoryOrigin({surface:'rest'},()=>{})"]) {
    await page.getByLabel('Script code', {exact: true}).fill("document.name='Must roll back';document." + call);
    await page.getByRole('button', {name: 'Run script', exact: true}).click();
    await expect(page.getByLabel('Script output')).toContainText('History origins are assigned by the host.');
    expect(await page.evaluate(() => window.luma.editor.document.toJSON())).toEqual(before);
    expect(await page.evaluate(() => window.luma.editor.document.getSnapshot().provenance.current)).toBeNull();
  }
});

for (const ending of ['return', 'throw'] as const) {
  test('unawaited candidate placement cannot commit after a script ends with ' + ending, async ({page}) => {
    await page.goto('/');
    await expect(page.getByRole('button', {name: 'History', exact: true})).toBeVisible();
    const result = await page.evaluate(async ending => {
      const editor = window.luma.editor, doc = editor.document, staging = editor.ai.staging;
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 16;
      canvas.getContext('2d')!.fillRect(0, 0, 16, 16);
      const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!)));
      const candidate = await staging.stageCandidate('abandoned-fixture-job', {
        id: crypto.randomUUID(), providerId: 'local-fixture', width: 16, height: 16, hasAlpha: false,
        imageData: new Uint8Array(await blob.arrayBuffer()), mimeType: 'image/png', durationMs: 0, costCents: 0,
      }, {prompt: 'Local fixture, no inference', modality: 'text-to-image', targetWidth: 16, targetHeight: 16});
      let release!: () => void, entered!: () => void, settle!: () => void;
      const ready = new Promise<void>(resolve => {entered = resolve;});
      const hold = new Promise<void>(resolve => {release = resolve;});
      const finished = new Promise<void>(resolve => {settle = resolve;});
      const promote = staging.promote.bind(staging), apply = editor.ai.applyCandidate.bind(editor.ai);
      staging.promote = async (...args) => {entered(); await hold; return promote(...args);};
      editor.ai.applyCandidate = async (...args) => {try {return await apply(...args);} finally {settle();}};
      const pending = editor.runScript(`host.jobs.applyCandidate(${JSON.stringify(candidate.id)});await new Promise(resolve=>setTimeout(resolve,100));${ending === 'throw' ? "throw Error('Script failed after starting host work');" : "print('Script finished');"}`)
        .then(logs => logs.join(' '), cause => String(cause));
      try {
        await Promise.race([ready, pending.then(error => {throw Error('Host did not reach promotion: ' + error);})]);
        const scriptResult = await pending;
        release(); await finished;
        return {scriptResult, layers: doc.layers.length, revision: doc.getSnapshot().revision,
          operation: doc.getSnapshot().provenance.current, assets: editor.assetStore.values().length, review: candidate.reviewState};
      } finally {release(); staging.promote = promote; editor.ai.applyCandidate = apply;}
    }, ending);
    expect(result.scriptResult).toContain(ending === 'throw' ? 'Script failed after starting host work' : 'Script finished');
    expect(result).toMatchObject({layers: 0, revision: 0, operation: null, assets: 0, review: 'staged'});
  });
}
