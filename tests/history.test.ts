import { expect, it } from "vitest";
import { Document } from "../src/dom";
import { EditorStore } from "../src/core/store";
import { createDocument, SCHEMA_VERSION } from "../src/core/model";
import { parseRetainedHistory } from "../src/core/history";

it("restores detached undo and redo snapshots and truncates redo on a new branch", () => {
  const source = new Document({ name: "Original" });
  source.name = "First";
  source.name = "Second";
  source.undo();
  const state = source.getSnapshot();
  const history = structuredClone({
    version: 1,
    past: state.past,
    future: state.future,
  });
  const restored = Document._fromWorkspace(source.toJSON(), history);
  history.past[0].document.name = "External mutation";
  expect(restored.getSnapshot().past.map((entry) => entry.label)).toEqual(
    state.past.map((entry) => entry.label),
  );
  restored.redo();
  expect(restored.name).toBe("Second");
  restored.undo();
  restored.undo();
  expect(restored.name).toBe("Original");
  restored.redo();
  expect(restored.name).toBe("First");
  restored.name = "Branch";
  restored.redo();
  expect(restored.name).toBe("Branch");
  expect(restored.getSnapshot().future).toHaveLength(0);
});

it("validates every retained entry and the combined history budget before installation", () => {
  const current = createDocument();
  const entry = {
    document: structuredClone(current),
    label: "Edit",
    canvasChanged: false,
  };
  expect(() =>
    parseRetainedHistory(
      {
        version: 1,
        past: Array(30).fill(entry),
        future: Array(30).fill(entry),
      },
      current,
    ),
  ).not.toThrow();
  for (const invalid of [
    { version: 1, past: Array(31).fill(entry), future: Array(30).fill(entry) },
    {
      version: 1,
      past: [{ ...entry, document: createDocument() }],
      future: [],
    },
    { version: 1, past: [], future: [{ ...entry, canvasChanged: "yes" }] },
    {
      version: 1,
      past: [],
      future: [{ ...entry, document: { ...current, width: -1 } }],
    },
  ]) {
    expect(() => new EditorStore(current, invalid)).toThrow();
    expect(() => new EditorStore(current, invalid, {migrateSchema:true})).toThrow();
  }
});

it("migrates validated legacy undo and redo states with the current workspace document", () => {
  const current = createDocument("Current");
  current.schemaVersion = 12;
  const past = { ...structuredClone(current), name: "Before" };
  const future = { ...structuredClone(current), name: "After" };
  const restored = Document._fromWorkspace(current, {
    version: 1,
    past: [{ document: past, label: "Before", canvasChanged: false }],
    future: [{ document: future, label: "After", canvasChanged: false }],
  });
  restored.undo();
  expect(restored.toJSON().schemaVersion).toBe(38);
  expect(restored.name).toBe("Before");
  restored.redo();
  restored.redo();
  expect(restored.toJSON().schemaVersion).toBe(38);
  expect(restored.name).toBe("After");
});

it("shares immutable pixel coverage and unaffected artwork across edits, undo and restored history", () => {
  const document = new Document({ width: 100, height: 100 });
  const selection = { regions: [{ shape: "pixels" as const, x: 0, y: 0, width: 100, height: 100,
    operation: "add" as const, coverage: { width: 100, height: 100,
      runs: Array.from({ length: 20000 }, (_, i) => i % 2 ? 128 : i / 2 + 1) } }] };
  document._dispatch({ type: "selection.set", selection });
  const original = document.getSnapshot().document;
  for (let i = 0; i < 30; i++) document.name = `Edit ${i}`;
  const state = document.getSnapshot();
  expect(state.document.selection).toBe(original.selection);
  expect(state.past.slice(1).every(entry => entry.document.selection === original.selection)).toBe(true);
  document.undo(); expect(document.name).toBe("Edit 28");
  document.redo(); expect(document.name).toBe("Edit 29");
  const before = document.getSnapshot();
  document.name = document.name;
  expect(document.getSnapshot()).toBe(before);
  selection.regions[0].coverage.runs[1] = 0;
  expect(original.selection!.regions[0].coverage!.runs[1]).toBe(128);
  const restored = Document._fromWorkspace(document.toJSON(), { version: 1, past: state.past, future: state.future });
  const restoredState = restored.getSnapshot();
  expect(restoredState.past.slice(1).every(entry => entry.document.selection === restoredState.document.selection)).toBe(true);
});

it("keeps sibling layers and prior strokes immutable when appending paint or updating a nested layer", async () => {
  const { PaintLayer, LayerGroup, BrushStroke } = await import("../src/dom");
  const document = new Document();
  const group = document.layers.add(new LayerGroup());
  const paint = group.layers.add(new PaintLayer());
  const sibling = group.layers.add(new PaintLayer());
  paint.strokes.add(new BrushStroke({ points: [{ x: 1, y: 1 }] }));
  const before = document.getSnapshot().document;
  paint.strokes.add(new BrushStroke({ points: [{ x: 2, y: 2 }] }));
  const after = document.getSnapshot().document;
  if (before.children[0].kind !== "group" || after.children[0].kind !== "group") throw new Error("Expected group");
  const oldPaint = before.children[0].children[0], newPaint = after.children[0].children[0];
  if (oldPaint.kind !== "paint" || newPaint.kind !== "paint") throw new Error("Expected paint");
  expect(oldPaint.strokes).toHaveLength(1);
  expect(newPaint.strokes).toHaveLength(2);
  expect(newPaint.strokes[0]).toBe(oldPaint.strokes[0]);
  expect(after.children[0].children[1]).toBe(before.children[0].children[1]);
  sibling.x = 7;
  expect(before.children[0].children[1].x).toBe(0);
  document.undo(); expect(sibling.x).toBe(0);
  document.undo(); expect(paint.strokes.length).toBe(1);
});

it("path updates isolate changed geometry while retaining immutable siblings and undo", async () => {
  const { VectorLayer, VectorPath, LayerGroup } = await import("../src/dom");
  const { execute } = await import("../src/core/commands");
  const document = new Document();
  const group = document.layers.add(new LayerGroup());
  const layer = group.layers.add(new VectorLayer());
  const first = layer.paths.add(new VectorPath({points:[{x:1,y:2},{x:3,y:4}]}));
  layer.paths.add(new VectorPath({points:[{x:10,y:20},{x:30,y:40}]}));
  const before = document.getSnapshot().document;
  const points = [{x:5,y:6,in:{x:4,y:6},out:{x:7,y:6}},{x:3,y:4,in:{x:3,y:4},out:{x:3,y:4}}];
  document._dispatch({type:"path.update",id:layer.id,pathId:first.id,patch:{points}});
  const after = document.getSnapshot().document;
  const read = (data: typeof before) => {
    const parent = data.children[0];
    if(parent.kind!=="group" || parent.children[0].kind!=="vector") throw Error("Expected nested vector");
    return parent.children[0];
  };
  expect(read(after).paths[1]).toBe(read(before).paths[1]);
  expect(read(before).paths[0].points[0].x).toBe(1);
  points[0].x=999;
  expect(read(after).paths[0].points[0].x).toBe(5);
  expect(() => execute(after,{type:"path.update",id:layer.id,pathId:first.id,patch:{points:[]}})).toThrow();
  expect(read(after).paths[0].points[0].x).toBe(5);
  document.undo(); expect(document.getSnapshot().document).toBe(before);
  document.redo(); expect(document.getSnapshot().document).toBe(after);
});

it("path patches share only store-frozen points and copy mutable caller geometry", async () => {
  const {VectorLayer,VectorPath} = await import("../src/dom");
  const {execute} = await import("../src/core/commands");
  const {freeze} = await import("../src/core/immutable");
  const document = new Document();
  const layer = document.layers.add(new VectorLayer());
  const path = layer.paths.add(new VectorPath({points:[{x:1,y:2},{x:3,y:4}]}));
  const before=document.getSnapshot().document;
  const vector=before.children[0];
  if(vector.kind!=="vector") throw Error("Expected vector");
  const changed={x:8,y:9,in:{x:8,y:9},out:{x:8,y:9}};
  const points=[freeze(structuredClone(vector.paths[0].points[0])),changed];
  const preview=execute(before,{type:"path.update",id:layer.id,pathId:path.id,patch:{points}});
  if(preview.children[0].kind!=="vector") throw Error("Expected vector");
  expect(preview.children[0].paths[0].points[0]).toBe(points[0]);
  changed.in.x=999;
  expect(preview.children[0].paths[0].points[1].in.x).toBe(8);
  expect(vector.paths[0].points[1].x).toBe(3);
  expect(document.getSnapshot().document).toBe(before);
});


it("store schema migration validates the original version and preserves caller metadata", () => {
  const legacy = {...createDocument(),schemaVersion:1 as const};
  expect(new EditorStore(legacy).getSnapshot().document.schemaVersion).toBe(1);
  const migrated = new EditorStore(legacy, undefined, {migrateSchema:true});
  expect(migrated.getSnapshot().document.schemaVersion).toBe(SCHEMA_VERSION);
  expect(legacy.schemaVersion).toBe(1);
  expect(Object.isFrozen(legacy)).toBe(false);
  expect(() => new EditorStore({...legacy,guides:[]}, undefined, {migrateSchema:true})).toThrow(/guides/);
  expect(() => new EditorStore(null, undefined, {migrateSchema:true})).toThrow();
});


it("store validates the copied snapshot even when input accessors change values", () => {
  let reads = 0;
  const data = {...createDocument(),get width(){return ++reads === 1 ? 800 : -1;}};
  const store = new EditorStore(data, undefined, {migrateSchema:true});
  expect(store.getSnapshot().document.width).toBe(800);
  expect(reads).toBe(1);
  const invalid = {...createDocument(),get width(){return -1;}};
  expect(() => new EditorStore(invalid, undefined, {migrateSchema:true})).toThrow();
});
