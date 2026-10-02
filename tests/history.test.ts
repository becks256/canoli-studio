import { expect, it } from "vitest";
import { Document } from "../src/dom";
import { EditorStore } from "../src/core/store";
import { createDocument } from "../src/core/model";
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
  ])
    expect(() => new EditorStore(current, invalid)).toThrow();
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
  expect(restored.toJSON().schemaVersion).toBe(15);
  expect(restored.name).toBe("Before");
  restored.redo();
  restored.redo();
  expect(restored.toJSON().schemaVersion).toBe(15);
  expect(restored.name).toBe("After");
});
