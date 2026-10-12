import { expect, it } from "vitest";
import { freezeOwnedData, isImmutable } from "../src/core/immutable";
import { EditorStore } from "../src/core/store";
import { createDocument, SCHEMA_VERSION } from "../src/core/model";

it("cooperatively proves nested owned data before allowing store sharing", async () => {
  const shared = {x:1};
  const value = {points:Array.from({length:20000}, (_,x) => ({x,y:x})), shared:[shared,shared]};
  let complete = false, yielded = false;
  const timer = new Promise<void>(resolve => setTimeout(() => { yielded = !complete; resolve(); }, 0));
  await freezeOwnedData(value); complete = true; await timer;
  expect(yielded).toBe(true);
  expect(isImmutable(value)).toBe(true);
  expect(isImmutable(value.points[19000])).toBe(true);
  expect(Object.isFrozen(value.points[19000])).toBe(true);
  expect(value.shared[0]).toBe(value.shared[1]);
});

it("shares proven model data while preserving migration ownership and validation", async () => {
  const source = createDocument();
  source.schemaVersion = 1;
  await freezeOwnedData(source);
  const store = new EditorStore(source, undefined, {migrateSchema:true});
  expect(store.getSnapshot().document.schemaVersion).toBe(SCHEMA_VERSION);
  expect(source.schemaVersion).toBe(1);
  expect(store.getSnapshot().document.children).toBe(source.children);
  const invalid = {...createDocument(), width:0};
  await freezeOwnedData(invalid);
  expect(() => new EditorStore(invalid)).toThrow();
  const shallow = Object.freeze(createDocument());
  const separate = new EditorStore(shallow);
  expect(separate.getSnapshot().document.children).not.toBe(shallow.children);
});

it("does not publish a parent proof for cycles or non-model objects", async () => {
  const cycle: {self?: unknown} = {}; cycle.self = cycle;
  await expect(freezeOwnedData(cycle)).rejects.toThrow(/cycles/);
  expect(isImmutable(cycle)).toBe(false);
  const date = {date:new Date()};
  await expect(freezeOwnedData(date)).rejects.toThrow(/plain objects/);
  expect(isImmutable(date)).toBe(false);
});
