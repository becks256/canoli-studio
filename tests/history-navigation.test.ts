import {it, expect} from 'vitest';
import {Document, PaintLayer} from '../src/dom';
import {RecipeRecorder} from '../src/ai/recipes/recorder';
import {executeRecipe} from '../src/ai/recipes/executor';

function timeline() {
  const document = new Document({width: 120, height: 80});
  const states = [document.toJSON()];
  document.layers.add(new PaintLayer({name: 'First'})); states.push(document.toJSON());
  document.layers.add(new PaintLayer({name: 'Second'})); states.push(document.toJSON());
  document.resize(240, 160); states.push(document.toJSON());
  document.layers.at(0)!.name = 'Renamed'; states.push(document.toJSON());
  return {document, states};
}
it('moves between every retained pair with one publication and exact undo/redo ordering', () => {
  for (let from = 0; from <= 4; from++) for (let to = 0; to <= 4; to++) {
    const {document, states} = timeline(); document.navigateHistory(from);
    const before = document.getSnapshot(); let publications = 0;
    document.subscribe(() => {publications++;}); document.navigateHistory(to);
    expect(document.toJSON()).toEqual(states[to]);
    expect(document.getSnapshot().past.length).toBe(to);
    expect(document.getSnapshot().future.length).toBe(4 - to);
    expect(document.getSnapshot().revision).toBe(before.revision + Number(from !== to));
    expect(publications).toBe(Number(from !== to));
    document.navigateHistory(0); for (let index = 1; index <= 4; index++) {document.redo(); expect(document.toJSON()).toEqual(states[index]);}
    for (let index = 3; index >= 0; index--) {document.undo(); expect(document.toJSON()).toEqual(states[index]);}
  }
});
it('invalid positions and navigation during a transaction cannot partially edit history', () => {
  const {document} = timeline(), before = document.getSnapshot();
  for (const value of [-1, 5, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
    expect(() => document.navigateHistory(value)).toThrow(/position/); expect(document.getSnapshot()).toBe(before);
  }
  expect(() => document.transaction('Must roll back', () => {document.name = 'Wrong'; document.navigateHistory(0);})).toThrow(/transaction/);
  expect(document.getSnapshot()).toBe(before);
});
it('canvas-space invalidation accounts for every crossed transition but publishes only one final state', () => {
  const {document} = timeline(); let revision = document.getSnapshot().canvasRevision;
  document.navigateHistory(3); expect(document.getSnapshot().canvasRevision).toBe(revision);
  document.navigateHistory(0); expect(document.getSnapshot().canvasRevision).toBe(++revision);
  document.navigateHistory(4); expect(document.getSnapshot().canvasRevision).toBe(++revision);
});
it('filters selection at the destination and branches normally after an explicit edit', () => {
  const {document} = timeline(); document.selectedLayer = document.layers.at(1);
  document.navigateHistory(1); expect(document.selectedLayers).toEqual([]);
  document.name = 'A new direction'; expect(document.canRedo).toBe(false);
  document.undo(); expect(document.layers.length).toBe(1); expect(document.canRedo).toBe(true);
});
it('notifies recipe history observers for every crossed step after atomic publication', () => {
  const {document} = timeline(), directions: string[] = [], states: number[] = [];
  document.onHistoryNavigation(direction => {directions.push(direction); states.push(document.layers.length);});
  document.navigateHistory(0); expect(directions).toEqual(['undo', 'undo', 'undo', 'undo']); expect(states).toEqual([0, 0, 0, 0]);
  directions.length = 0; document.navigateHistory(4); expect(directions).toEqual(['redo', 'redo', 'redo', 'redo']);
});
it('retains accepted navigation and all observer notifications after an observer failure, then recovers', () => {
  const {document, states} = timeline(); let good = 0, steps = 0;
  const off = document.subscribe(() => {document.name = 'Forbidden reentry';});
  document.subscribe(() => {good++;}); document.onHistoryNavigation(() => {steps++;});
  expect(() => document.navigateHistory(0)).toThrow(/History moved/);
  expect(document.toJSON()).toEqual(states[0]); expect(good).toBe(1); expect(steps).toBe(4);
  off(); document.navigateHistory(4); expect(document.toJSON()).toEqual(states[4]);
});

it('does not lose a falsy thrown observer value after publication', () => {
  const {document, states} = timeline(); let notified = 0;
  document.subscribe(() => {throw undefined;}); document.subscribe(() => {notified++;});
  expect(() => document.navigateHistory(0)).toThrow(/History moved/);
  expect(document.toJSON()).toEqual(states[0]); expect(notified).toBe(1);
});

it('keeps actual recorded semantic recipes aligned across multi-step navigation and a replacement edit', () => {
  const document = new Document(), recorder = new RecipeRecorder(); recorder.start();
  const commands = document.onCommand((command, before, after) => recorder.recordCommand(command, before, after));
  const navigation = document.onHistoryNavigation(direction => recorder.navigateHistory(direction));
  const layer = document.layers.add(new PaintLayer()); layer.name = 'Named'; layer.opacity = 0.5; layer.x = 20;
  document.navigateHistory(1); document.navigateHistory(4); document.navigateHistory(2); layer.opacity = 0.75;
  const recipe = recorder.stop(); commands(); navigation();
  const target = new Document(), result = executeRecipe(JSON.parse(JSON.stringify(recipe)), target);
  expect(result.success).toBe(true); expect(target.layers.length).toBe(1);
  expect(target.layers.at(0)!.name).toBe('Named'); expect(target.layers.at(0)!.opacity).toBe(0.75); expect(target.layers.at(0)!.x).toBe(0);
});

it('invalidates actual recipe recording when a jump crosses its recording boundary', () => {
  const document = new Document(); document.name = 'Before recording';
  const recorder = new RecipeRecorder(); recorder.start();
  const commands = document.onCommand((command, before, after) => recorder.recordCommand(command, before, after));
  const navigation = document.onHistoryNavigation(direction => recorder.navigateHistory(direction));
  document.layers.add(new PaintLayer()); document.navigateHistory(0);
  expect(recorder.getUnsupportedCommands().join(' ')).toMatch(/recording boundary/);
  expect(() => recorder.stop()).toThrow(/recording boundary/); commands(); navigation();
});

it('returned snapshots cannot replace live or retained artwork, revisions, labels or selection', () => {
  const {document, states} = timeline();
  for (const position of [4, 0, 2, 3]) {
    document.navigateHistory(position); const snapshot = document.getSnapshot(), revision = snapshot.revision;
    const forged = {...states[position], name: 'Outside commands'};
    expect(Reflect.set(snapshot, 'document', forged)).toBe(false);
    expect(Reflect.set(snapshot, 'revision', 99999)).toBe(false);
    expect(Reflect.set(snapshot, 'canvasRevision', 99999)).toBe(false);
    expect(() => (snapshot.selectedIds as string[]).push('not-a-layer')).toThrow();
    expect(() => snapshot.past.push({document: forged, label: 'Forged', canvasChanged: false})).toThrow();
    for (const entry of [...snapshot.past, ...snapshot.future]) {
      expect(Reflect.set(entry, 'document', forged)).toBe(false);
      expect(Reflect.set(entry, 'label', 'Forged label')).toBe(false);
    }
    expect(document.toJSON()).toEqual(states[position]); expect(document.getSnapshot().revision).toBe(revision);
  }
  document.navigateHistory(0); expect(document.toJSON()).toEqual(states[0]);
});

it('invalid transaction labels reject before invoking callbacks or corrupting retained history', () => {
  const document = new Document(), before = document.getSnapshot(); let callbacks = 0;
  for (const label of [null, undefined, 42, {}, []]) {
    expect(() => document.transaction(label as never, () => {callbacks++; document.name = 'Must not commit';})).toThrow(/label.*string/);
    expect(document.getSnapshot()).toBe(before);
  }
  expect(callbacks).toBe(0);
});
