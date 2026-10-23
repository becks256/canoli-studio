import {test, expect} from '@playwright/test';
import {openPalettes, installPalette, paletteFixture, paletteProductionWorkflow} from './helpers/palettes';

test('palette library uses real UI, portable packs, persistence, shared color commands and undo', async ({page}, info) => {
  await paletteProductionWorkflow(page, info);
});
test('malformed pack siblings cannot publish partially; exact duplicates preserve IDs and revisions', async ({page}) => {
  await page.goto('/'); const dialog = await installPalette(page);
  const before = await page.evaluate(() => window.luma.editor.palettes.getSnapshot().entries);
  await dialog.getByTestId('palette-pack-input').setInputFiles({name: 'bad.canolipal', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({...paletteFixture, palettes: [...paletteFixture.palettes, {...paletteFixture.palettes[0], swatches: []}]}))});
  await expect(dialog.getByRole('alert')).toBeVisible();
  expect(await page.evaluate(() => window.luma.editor.palettes.getSnapshot().entries)).toEqual(before);
  await dialog.getByTestId('palette-pack-input').setInputFiles({name: 'same.canolipal', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(paletteFixture))});
  await expect(dialog.getByRole('status')).toContainText('Imported 0 palettes; kept 1 exact duplicates.');
  expect(await page.evaluate(() => window.luma.editor.palettes.getSnapshot().entries)).toEqual(before);
});
test('durable revisions reject stale drafts across real tabs even without notification delivery', async ({page, context}) => {
  await page.addInitScript(() => {Object.defineProperty(window, 'BroadcastChannel', {value: undefined});});
  await page.goto('/'); const dialog = await installPalette(page);
  await dialog.getByRole('button', {name: 'Open color palette Botanical', exact: true}).click();
  const second = await context.newPage(); await second.goto('/'); const other = await openPalettes(second);
  await other.getByRole('button', {name: 'Open color palette Botanical', exact: true}).click();
  await other.getByLabel('Palette name', {exact: true}).fill('Other tab review');
  await other.getByRole('button', {name: 'Save color palette', exact: true}).click();
  await expect(other.getByRole('button', {name: 'Open color palette Other tab review', exact: true})).toBeVisible();
  await dialog.getByLabel('Palette name', {exact: true}).fill('Stale overwrite');
  await dialog.getByRole('button', {name: 'Save color palette', exact: true}).click();
  await expect(dialog.getByRole('alert')).toContainText('changed in another tab');
  await expect(dialog.getByLabel('Palette name', {exact: true})).toHaveValue('Stale overwrite');
  await dialog.getByRole('button', {name: 'Reload palette details', exact: true}).click();
  await expect(dialog.getByLabel('Palette name', {exact: true})).toHaveValue('Other tab review');
  await second.close();
});
test('palette picker contains keyboard shortcuts, cancels cleanly and rejects a changed document', async ({page}) => {
  await page.goto('/'); let dialog = await installPalette(page); await dialog.getByRole('button', {name: 'Done', exact: true}).click();
  await page.getByRole('button', {name: 'Brush tool (B)', exact: true}).click();
  const button = page.getByRole('button', {name: 'Choose foreground color from palettes', exact: true});
  await button.click(); dialog = page.getByRole('dialog', {name: 'Color palettes', exact: true});
  await dialog.getByRole('button', {name: 'Open color palette Botanical', exact: true}).click();
  const before = await page.evaluate(() => ({revision: window.luma.editor.document.getSnapshot().revision}));
  const swatch = dialog.getByRole('button', {name: 'Use swatch Leaf #315b2a', exact: true});
  await swatch.focus(); await page.keyboard.press('v'); await page.keyboard.press('Control+z');
  await expect(page.locator('button[aria-label="Brush tool (B)"]')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => ({revision: window.luma.editor.document.getSnapshot().revision}))).toEqual(before);
  await page.evaluate(() => {window.luma.editor.document.name = 'An external edit';});
  await swatch.click(); await expect(dialog.getByRole('alert')).toContainText('document or selection changed');
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(button).toBeFocused();
});
test('storage denial leaves editing useful and exposes recovery instead of crashing startup', async ({page}) => {
  await page.addInitScript(() => {Object.defineProperty(window, 'indexedDB', {get() {throw new DOMException('Denied', 'SecurityError');}});});
  await page.goto('/'); const dialog = await openPalettes(page);
  await expect(dialog.getByRole('alert')).toContainText('unavailable');
  await expect(dialog.getByRole('button', {name: 'New color palette', exact: true})).toBeDisabled();
  await dialog.getByRole('button', {name: 'Done', exact: true}).click();
  await page.getByRole('button', {name: 'Brush tool (B)', exact: true}).click();
  await expect(page.getByLabel('Foreground color', {exact: true})).toBeEnabled();
});
test('large palettes and catalogs paginate without truncating stored colors', async ({page}) => {
  await page.setViewportSize({width: 1280, height: 720}); await page.goto('/');
  const palettes = Array.from({length: 45}, (_, index) => ({...paletteFixture.palettes[0], name: `Catalog ${String(index).padStart(2, '0')}`,
    swatches: Array.from({length: 70}, (_, swatch) => ({name: `Color ${swatch}`, color: '#315b2a'}))}));
  const dialog = await installPalette(page, {...paletteFixture, palettes});
  await expect(dialog.getByRole('button', {name: /^Open color palette /})).toHaveCount(40);
  await dialog.getByRole('button', {name: 'Next palette page', exact: true}).click();
  await expect(dialog.getByRole('button', {name: /^Open color palette /})).toHaveCount(5);
  await dialog.getByRole('button', {name: /^Open color palette /}).first().click();
  await expect(dialog.getByRole('textbox', {name: /^Swatch \d+ name$/})).toHaveCount(32);
  await dialog.getByRole('button', {name: 'Next swatches', exact: true}).click();
  await dialog.getByRole('button', {name: 'Next swatches', exact: true}).click();
  await expect(dialog.getByRole('textbox', {name: /^Swatch \d+ name$/})).toHaveCount(6);
  await expect(dialog.getByRole('button', {name: 'Done', exact: true})).toBeVisible();
  expect(await page.evaluate(() => window.luma.editor.palettes.getSnapshot().entries.reduce((count, row) => count + (row.entry?.palette.swatches.length ?? 0), 0))).toBe(45 * 70);
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test('a real IndexedDB quota exception rolls back every imported sibling', async ({page}) => {
  await page.goto('/'); const dialog = await installPalette(page);
  const result = await page.evaluate(async fixture => {
    const library = window.luma.editor.palettes, before = library.getSnapshot().entries;
    const put = IDBObjectStore.prototype.put; let writes = 0, error = '';
    IDBObjectStore.prototype.put = function(value: unknown, key?: IDBValidKey) {
      if (this.transaction.db.name === 'canoli-color-palettes' && this.name === 'entries' && ++writes === 2)
        throw new DOMException('Injected full quota', 'QuotaExceededError');
      return key === undefined ? put.call(this, value) : put.call(this, value, key);
    };
    try {await library.importPack(new Blob([JSON.stringify({...fixture, palettes: [1, 2].map(index => ({...fixture.palettes[0], name: 'New ' + index}))})]));}
    catch (cause) {error = String(cause);}
    finally {IDBObjectStore.prototype.put = put;}
    const quotaMessage = library.getSnapshot().error;
    await library.refresh(); return {before, after: library.getSnapshot().entries, writes, error, quotaMessage};
  }, paletteFixture);
  expect(result.writes).toBe(2); expect(result.error).toContain('Quota'); expect(result.quotaMessage).toContain('storage is full');
  expect(result.after).toEqual(result.before);
  await expect(dialog.getByRole('button', {name: /^Open color palette /})).toHaveCount(1);
});

test('corrupt stored records remain recoverable without silently replacing healthy palettes', async ({page}, info) => {
  await page.goto('/'); const dialog = await installPalette(page);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {const request = indexedDB.open('canoli-color-palettes', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);});
    try {await new Promise<void>((resolve, reject) => {const tx = db.transaction('entries', 'readwrite');
      tx.objectStore('entries').put({damaged: 'Keep this diagnostic value'}, 'broken-record'); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
    });} finally {db.close();}
    await window.luma.editor.palettes.refresh();
  });
  await expect(dialog.getByRole('alert')).toContainText('Unreadable palette');
  const pending = page.waitForEvent('download'); await dialog.getByRole('button', {name: 'Recover palette record', exact: true}).click();
  const path = info.outputPath('palette-recovery.json'); await (await pending).saveAs(path);
  const {readFile} = await import('node:fs/promises');
  expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({key: 'broken-record', value: {damaged: 'Keep this diagnostic value'}});
  await dialog.getByRole('button', {name: 'Remove unreadable palette', exact: true}).click();
  await expect(dialog.getByRole('button', {name: 'Recover palette record', exact: true})).toHaveCount(0);
  await expect(dialog.getByRole('button', {name: 'Open color palette Botanical', exact: true})).toBeVisible();
});

test('real cross-tab clearing rejects imports held before commit without notification support', async ({page, context}) => {
  await page.addInitScript(() => {Object.defineProperty(window, 'BroadcastChannel', {value: undefined});});
  await page.goto('/'); const dialog = await installPalette(page);
  await page.evaluate(async fixture => {
    const state = window as unknown as {releasePalette(): void; paletteResult: Promise<string>};
    const blob = new Blob(['pending']), bytes = new TextEncoder().encode(JSON.stringify({...fixture, palettes: [{...fixture.palettes[0], name: 'Must not resurrect'}]}));
    let enter!: () => void; const ready = new Promise<void>(resolve => {enter = resolve;});
    blob.arrayBuffer = () => {enter(); return new Promise(resolve => {state.releasePalette = () => resolve(bytes.buffer);});};
    state.paletteResult = window.luma.editor.palettes.importPack(blob).then(() => 'unexpected commit', cause => String(cause));
    await ready;
  }, paletteFixture);
  const second = await context.newPage(); await second.goto('/'); const other = await openPalettes(second);
  await other.getByRole('button', {name: 'Clear color palettes…', exact: true}).click();
  await other.getByRole('button', {name: 'Clear saved palettes', exact: true}).click();
  await expect(other.getByRole('button', {name: /^Open color palette /})).toHaveCount(0);
  const result = await page.evaluate(async () => {const state = window as unknown as {releasePalette(): void; paletteResult: Promise<string>}; state.releasePalette(); return state.paletteResult;});
  expect(result).toContain('changed during preparation');
  await dialog.getByRole('button', {name: 'Reload color palettes', exact: true}).click();
  await expect(dialog.getByRole('button', {name: /^Open color palette /})).toHaveCount(0);
  await second.close();
});

test('saved gradient-map colors commit once, undo and retain native preview cancellation', async ({page}) => {
  await page.goto('/'); let dialog = await installPalette(page); await dialog.getByRole('button', {name: 'Done', exact: true}).click();
  await page.keyboard.press('Control+k'); await page.getByLabel('Search commands').fill('gradient map');
  await page.getByRole('option', {name: 'New Gradient Map adjustment layer'}).click();
  const before = await page.evaluate(() => window.luma.editor.document.getSnapshot().past.length);
  await page.getByRole('button', {name: 'Choose stop 1 color from palettes', exact: true}).click();
  dialog = page.getByRole('dialog', {name: 'Color palettes', exact: true});
  await dialog.getByRole('button', {name: 'Open color palette Botanical', exact: true}).click();
  await dialog.getByRole('button', {name: 'Use swatch Flower #a43e29', exact: true}).click();
  await expect(page.getByLabel('Stop 1 color', {exact: true})).toHaveValue('#a43e29');
  expect(await page.evaluate(() => window.luma.editor.document.getSnapshot().past.length)).toBe(before + 1);
  await page.getByRole('button', {name: 'Undo (Mod+Z)', exact: true}).click();
  const picker = page.getByLabel('Stop 1 color', {exact: true}); await expect(picker).toHaveValue('#000000');
  await picker.evaluate(element => {const input = element as HTMLInputElement; input.value = '#0088ff'; input.dispatchEvent(new Event('input', {bubbles: true}));});
  await picker.focus(); await page.keyboard.press('Escape'); await expect(picker).toHaveValue('#000000');
  expect(await page.evaluate(() => window.luma.editor.document.getSnapshot().past.length)).toBe(before);
});

test('context-menu swatches survive menu dismissal and change only foreground settings', async ({page}) => {
  await page.goto('/'); let dialog = await installPalette(page); await dialog.getByRole('button', {name: 'Done', exact: true}).click();
  await page.getByRole('button', {name: 'Brush tool (B)', exact: true}).click();
  const before = await page.evaluate(() => window.luma.editor.document.getSnapshot().revision);
  await page.getByLabel('Editing canvas', {exact: true}).click({button: 'right', position: {x: 200, y: 200}});
  await page.getByRole('button', {name: 'Choose context foreground color from palettes', exact: true}).click();
  dialog = page.getByRole('dialog', {name: 'Color palettes', exact: true});
  await dialog.getByRole('button', {name: 'Open color palette Botanical', exact: true}).click();
  await dialog.getByRole('button', {name: 'Use swatch Leaf #315b2a', exact: true}).click();
  await expect(dialog).toHaveCount(0); await expect(page.getByLabel('Foreground color', {exact: true})).toHaveValue('#315b2a');
  expect(await page.evaluate(() => window.luma.editor.document.getSnapshot().revision)).toBe(before);
});

test('light and dark short layouts retain wrapped details, controls and footer', async ({page}, info) => {
  for (const theme of ['light', 'dark']) {
    await page.setViewportSize(theme === 'dark' ? {width: 1280, height: 720} : {width: 1440, height: 1000});
    await page.goto('/');
    await page.evaluate(theme => window.dispatchEvent(new CustomEvent('luma:set-appearance', {detail: theme})), theme);
    const dialog = await installPalette(page);
    await dialog.getByRole('button', {name: 'Open color palette Botanical', exact: true}).click();
    await dialog.getByLabel('Palette name', {exact: true}).fill('VeryLongPalette'.repeat(8));
    await dialog.getByLabel('Palette description', {exact: true}).fill('Long-description-without-spaces'.repeat(100));
    await expect(dialog.getByRole('button', {name: 'Done', exact: true})).toBeVisible();
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    const controls = await dialog.locator('button,input:not([type=file]),textarea').evaluateAll(elements => elements.map(element => ({tag: element.tagName, width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height})));
    expect(controls.every(control => control.width >= 28 && control.height >= 28)).toBe(true);
    await info.attach(`palettes-${theme}.png`, {body: await dialog.screenshot(), contentType: 'image/png'});
    await dialog.getByRole('button', {name: 'Done', exact: true}).click();
  }
});

test('command search creates and edits named palettes through native controls without changing history', async ({page}) => {
  await page.goto('/');
  const before = await page.evaluate(() => window.luma.editor.document.getSnapshot().revision);
  await page.getByRole('button', {name: 'Find a command (Mod+K)', exact: true}).click(); await page.getByLabel('Search commands').fill('color palettes');
  await page.getByRole('option', {name: /Color palettes$/}).click();
  const dialog = page.getByRole('dialog', {name: 'Color palettes', exact: true});
  await dialog.getByRole('button', {name: 'New color palette', exact: true}).click();
  await dialog.getByLabel('Palette name', {exact: true}).fill('Handmade');
  await dialog.getByLabel('Swatch 1 name', {exact: true}).fill('Night ink');
  await dialog.getByLabel('Swatch 1 color', {exact: true}).evaluate(element => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, '#203040');
    element.dispatchEvent(new Event('input', {bubbles: true})); element.dispatchEvent(new Event('change', {bubbles: true}));
  });
  await expect(dialog.getByText('#203040', {exact: true})).toBeVisible();
  await dialog.getByRole('button', {name: 'Add current color', exact: true}).click();
  await dialog.getByLabel('Swatch 2 name', {exact: true}).fill('Temporary color');
  await dialog.getByRole('button', {name: 'Remove swatch 2', exact: true}).click();
  await dialog.getByRole('button', {name: 'Save color palette', exact: true}).click();
  await expect(dialog.getByRole('button', {name: 'Open color palette Handmade', exact: true})).toBeVisible();
  expect(await page.evaluate(() => window.luma.editor.palettes.getSnapshot().entries[0].entry?.palette.swatches)).toEqual([{name: 'Night ink', color: '#203040'}]);
  expect(await page.evaluate(() => window.luma.editor.document.getSnapshot().revision)).toBe(before);
});
