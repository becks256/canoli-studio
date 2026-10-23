import {it, expect} from 'vitest';
import {Document, PaintLayer, RasterLayer} from '../src/dom';
import {historyTimeline, inspectHistoryChange} from '../src/core/history-inspection';

it('assembles the exact chronological timeline across undo and redo stacks', () => {
  const document = new Document(), snapshots = [document.toJSON()];
  for (let index = 0; index < 5; index++) {document.name = 'State ' + index; snapshots.push(document.toJSON());}
  for (let position = 0; position <= 5; position++) {
    document.navigateHistory(position);
    const timeline = historyTimeline(document.getSnapshot());
    expect(timeline.map(item => item.position)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(timeline.map(item => item.document)).toEqual(snapshots);
    expect(timeline[0].label).toBe('Oldest retained state');
  }
});
it('reports document fields, additions, removals, edits and layer-order changes without mutating snapshots', () => {
  const document = new Document(), empty = document.toJSON();
  const first = document.layers.add(new PaintLayer({name: 'First'})), second = document.layers.add(new PaintLayer({name: 'Second'}));
  expect(inspectHistoryChange(empty, document.toJSON()).layers.map(layer => layer.change)).toEqual(['added', 'added']);
  const before = document.toJSON(), copy = structuredClone(before);
  document.name = 'Reviewed'; first.name = 'Renamed'; second.remove();
  const summary = inspectHistoryChange(before, document.toJSON());
  expect(summary.documentFields).toContain('name');
  expect(summary.layers).toEqual(expect.arrayContaining([
    expect.objectContaining({id: first.id, change: 'edited', fields: ['name']}), expect.objectContaining({id: second.id, change: 'removed'}),
  ]));
  expect(before).toEqual(copy);
});
it('reports native artwork geometry independently of viewport zoom and source image resolution', () => {
  const document = new Document({width: 10000, height: 5000}), before = document.toJSON();
  const image = document.layers.add(new RasterLayer({assetId: 'native-source', name: 'Native', width: 10000, height: 5000, x: -20, y: 30}));
  const summary = inspectHistoryChange(before, document.toJSON());
  expect(summary.layers[0].id).toBe(image.id); expect(summary.bounds).toEqual({x: -20, y: 30, width: 10000, height: 5000});
});
it('retains exact totals while disclosing omitted report rows, without dropping document content', () => {
  const document = new Document(), before = document.toJSON();
  document.transaction('Many layers', () => {for (let index = 0; index < 40; index++) document.layers.add(new PaintLayer({name: 'Layer ' + index}));});
  const summary = inspectHistoryChange(before, document.toJSON());
  expect(summary.totalLayers).toBe(40); expect(summary.layers.length).toBe(32); expect(summary.omittedLayers).toBe(8); expect(document.layers.length).toBe(40);
});
it('does not invent a prior operation or timestamp for the oldest retained state', () => {
  const document = new Document(); for (let index = 0; index < 65; index++) document.name = 'Edit ' + index;
  const timeline = historyTimeline(document.getSnapshot());
  expect(timeline.length).toBe(61); expect(timeline[0].document.name).toBe('Edit 4');
  expect(inspectHistoryChange(null, timeline[0].document).totalLayers).toBe(0);
});

it('bounds displayed operation labels without truncating retained source history', () => {
  const document = new Document(); document.name = 'Changed';
  const state = document.getSnapshot(), label = 'Very long operation '.repeat(1000);
  const restored = Document._fromWorkspace(document.toJSON(), {version: 1, past: state.past.map(entry => ({...entry, label})), future: []});
  const timeline = historyTimeline(restored.getSnapshot());
  expect(timeline[1].label.length).toBe(241); expect(timeline[1].labelTruncated).toBe(true);
  expect(restored.getSnapshot().past[0].label).toBe(label);
});

it('clipped labels retain whole graphemes and valid Unicode without editing stored labels', () => {
  for (const ending of ['🎨', '👩‍👩‍👧‍👦', 'e\u0301']) {
    const document = new Document(), label = 'a'.repeat(239) + ending + 'z'.repeat(12);
    document.transaction(label, () => {document.name = 'Changed';});
    const displayed = historyTimeline(document.getSnapshot())[1];
    expect(displayed.label).toBe('a'.repeat(239) + '…'); expect(displayed.labelTruncated).toBe(true);
    expect(new TextDecoder().decode(new TextEncoder().encode(displayed.label))).toBe(displayed.label);
    expect(document.getSnapshot().past[0].label).toBe(label);
  }
});
