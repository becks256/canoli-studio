import {it, expect} from 'vitest';
import {Document, PaintLayer, RasterLayer} from '../src/dom';
import {captureRetainedHistory, parseRetainedHistory, retainedDocuments} from '../src/core/history';
import {readProject, serializeProject} from '../src/core/project';

it('preserves an abandoned redo result as Main and creates an independent branch for a new edit', () => {
  const doc = new Document(); doc.name = 'Shared'; doc.name = 'Original result';
  const original = doc.toJSON(); doc.undo(); const origin = doc.toJSON(); doc.name = 'Alternative';
  const state = doc.getSnapshot(); expect(state.branches).toHaveLength(2); expect(doc.canRedo).toBe(false);
  const main = state.branches.find(branch => branch.name === 'Main')!, alternative = state.branches.find(branch => branch.id === state.activeBranchId)!;
  expect(alternative.parentId).toBe(main.id); expect(alternative.forkDocument).toEqual(origin);
  doc.checkoutHistoryBranch(main.id); expect(doc.toJSON()).toEqual(original); doc.undo(); expect(doc.toJSON()).toEqual(origin); doc.redo();
  doc.checkoutHistoryBranch(alternative.id); expect(doc.name).toBe('Alternative'); doc.undo(); expect(doc.toJSON()).toEqual(origin);
  expect(parseRetainedHistory(captureRetainedHistory(doc.getSnapshot()), doc.toJSON()).version).toBe(4);
});
it('forks explicitly at the current cursor and restores latest tips rather than abandoned undo cursors', () => {
  const doc = new Document(); doc.name = 'First'; doc.name = 'Latest'; doc.undo();
  let publications = 0; doc.subscribe(() => {publications++;}); const revision = doc.getSnapshot().revision;
  const fork = doc.createHistoryBranch('  Trial  '); expect(doc.name).toBe('First'); expect(doc.canRedo).toBe(false);
  expect(publications).toBe(1); expect(doc.getSnapshot().revision).toBe(revision + 1);
  const main = doc.getSnapshot().branches.find(branch => branch.name === 'Main')!;
  doc.checkoutHistoryBranch(main.id); expect(doc.name).toBe('Latest'); doc.undo();
  doc.checkoutHistoryBranch(fork); expect(doc.name).toBe('First');
  doc.checkoutHistoryBranch(main.id); expect(doc.name).toBe('Latest');
});
it('keeps fork origins after both linear paths exceed the retention window', () => {
  const doc = new Document(); doc.name = 'Fork point'; const fork = doc.createHistoryBranch('Long alternative');
  const main = doc.getSnapshot().branches.find(branch => branch.name === 'Main')!;
  for (let i = 0; i < 90; i++) doc.name = `Alternative ${i}`;
  expect(doc.getSnapshot().past).toHaveLength(60);
  doc.checkoutHistoryBranch(main.id); for (let i = 0; i < 75; i++) doc.name = `Main ${i}`;
  const restored = Document._fromWorkspace(doc.toJSON(), captureRetainedHistory(doc.getSnapshot()));
  restored.checkoutHistoryBranch(fork); expect(restored.name).toBe('Alternative 89');
  expect(restored.getSnapshot().branches.find(branch => branch.id === fork)!.forkDocument.name).toBe('Fork point');
  expect(restored.getSnapshot().past).toHaveLength(60); restored.navigateHistory(0); expect(restored.name).toBe('Alternative 29');
});
it('validates names, rejects transaction/reentrant calls and only deletes inactive leaf branches', () => {
  const doc = new Document(), first = doc.createHistoryBranch('Candidate'), main = doc.getSnapshot().branches.find(branch => branch.name === 'Main')!;
  for (const name of ['', ' ', 'x'.repeat(121), 'ＣＡＮＤＩＤＡＴＥ']) expect(() => doc.createHistoryBranch(name)).toThrow();
  expect(() => doc.transaction('No branch', () => doc.createHistoryBranch('Bad'))).toThrow(/transaction/);
  expect(() => doc.deleteHistoryBranch(first)).toThrow(/active branch/);
  expect(() => doc.deleteHistoryBranch(main.id)).toThrow(/child branches/);
  doc.renameHistoryBranch(first, 'Approved alternative'); const state = doc.getSnapshot();
  expect(() => doc.renameHistoryBranch(first, ' main ')).toThrow(/already exists/); expect(doc.getSnapshot()).toBe(state);
  expect(Reflect.set(state.branches[1].tip, 'document', main.tip.document)).toBe(false);
  expect(Reflect.set(state.branches[1], 'name', 'Injected')).toBe(false);
  doc.checkoutHistoryBranch(main.id); doc.deleteHistoryBranch(first); expect(doc.getSnapshot().branches).toHaveLength(1);
  expect(() => doc.checkoutHistoryBranch(first)).toThrow(/not found/);
});
it('notifies every branch observer after accepted publication and prevents reentrant mutation', () => {
  const doc = new Document(), fork = doc.createHistoryBranch('Alternative'), main = doc.getSnapshot().branches.find(branch => branch.name === 'Main')!;
  doc.layers.add(new PaintLayer()); let notified = 0;
  const off = doc.subscribe(() => {doc.name = 'Forbidden reentry';});
  doc.onHistoryBranchSwitch(() => {throw undefined;}); doc.onHistoryBranchSwitch(() => {notified++;});
  expect(() => doc.checkoutHistoryBranch(main.id)).toThrow(/branch changed.*observer failed/);
  expect(doc.layers.length).toBe(0); expect(notified).toBe(1); off();
  expect(() => doc.checkoutHistoryBranch(fork)).toThrow(/branch changed.*observer failed/);
  expect(doc.layers.length).toBe(1); expect(notified).toBe(2);
});
it('rejects malformed branch graphs atomically and accepts reordered equivalent model keys', () => {
  const doc = new Document(); doc.name = 'Latest'; const id = doc.createHistoryBranch('Other'); doc.name = 'Other result';
  const captured = captureRetainedHistory(doc.getSnapshot()); if (captured.version !== 4) throw Error('Expected branches');
  const corruptions = [
    (h: typeof captured) => {h.activeBranchId = crypto.randomUUID();},
    (h: typeof captured) => {h.branches[0].parentId = id;},
    (h: typeof captured) => {h.branches[1].parentId = crypto.randomUUID();},
    (h: typeof captured) => {h.branches[1].id = h.branches[0].id;},
    (h: typeof captured) => {h.branches[1].name = 'ＭＡＩＮ';},
    (h: typeof captured) => {h.branches[1].tip.document.name = 'Wrong tip';},
    (h: typeof captured) => {h.branches[0].forkDocument.id = crypto.randomUUID();},
    (h: typeof captured) => {h.branches[0].tip.past = Array(61).fill(h.branches[1].tip.past[0]);},
  ];
  for (const corrupt of corruptions) {const input = structuredClone(captured); corrupt(input); expect(() => Document._fromWorkspace(doc.toJSON(), input)).toThrow();}
  const reordered = structuredClone(captured); reordered.branches[1].tip.document = Object.fromEntries(Object.entries(reordered.branches[1].tip.document).reverse()) as never;
  expect(Document._fromWorkspace(doc.toJSON(), reordered).name).toBe('Other result');
});
it('includes branch-only image sources in native files and rejects missing assets before reopening', async () => {
  const doc = new Document(); doc.layers.add(new RasterLayer({assetId:'branch-only', width:2, height:2})); const original = doc.toJSON();
  doc.undo(); doc.name = 'Empty alternative';
  const asset = {id:'branch-only', name:'Original source', width:2, height:2, blob:new Blob([new Uint8Array([137,80,78,71,1,2,3,4])],{type:'image/png'})};
  const history = captureRetainedHistory(doc.getSnapshot());
  expect(retainedDocuments(doc.toJSON(), history).some(data => data.children.length)).toBe(true);
  const blob = await serializeProject(doc.toJSON(), {get:() => asset}, history), loaded = await readProject(blob);
  expect(await loaded.entries[0].blob.arrayBuffer()).toEqual(await asset.blob.arrayBuffer());
  const restored = Document._fromWorkspace(loaded.document, loaded.history), main = restored.getSnapshot().branches.find(branch => branch.name === 'Main')!;
  restored.checkoutHistoryBranch(main.id); expect(restored.toJSON()).toEqual(original);
  await expect(serializeProject(doc.toJSON(), {get:() => {throw Error('Missing branch source');}}, history)).rejects.toThrow(/Missing branch source/);
});
it('retains legacy format 1 for unknown snapshots and records new unbranched operations in format 4', () => {
  const doc = new Document(); expect(captureRetainedHistory(doc.getSnapshot()).version).toBe(1);doc.name = 'Linear'; doc.undo();
  expect(captureRetainedHistory(doc.getSnapshot()).version).toBe(4);
  doc.redo(); expect(doc.getSnapshot().branches).toEqual([]);
});
