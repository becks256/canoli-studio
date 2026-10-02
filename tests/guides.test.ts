import { expect, it } from "vitest";
import { Document, Guide } from "../src/dom";
import { validateDocument } from "../src/core/model";

it("constructs immutable guides and edits through shared undoable commands", () => {
  const doc = new Document();
  const guide = new Guide({ orientation: "vertical", position: 125.5 });
  expect(Object.isFrozen(guide)).toBe(true);
  doc.guides.add(guide);
  const saved = doc.toJSON();
  doc.guides.update(guide.id, { position: -20 });
  expect(doc.guides.items[0].position).toBe(-20);
  expect(guide.position).toBe(125.5);
  doc.undo();
  expect(doc.toJSON()).toEqual(saved);
  doc.guides.remove(guide.id);
  expect(doc.guides.length).toBe(0);
  doc.undo();
  expect(doc.toJSON()).toEqual(saved);
  expect(Document.fromJSON(saved).guides.items[0].toJSON()).toEqual(
    guide.toJSON(),
  );
  expect(() => doc.guides.add(guide)).toThrow();
  expect(doc.toJSON()).toEqual(saved);
  expect(
    () => new Guide({ orientation: "horizontal", position: Infinity }),
  ).toThrow();
  expect(() => doc.guides.update("missing", { position: 10 })).toThrow(
    "not found",
  );
  expect(() => validateDocument({ ...saved, schemaVersion: 6 })).toThrow(
    "schema version 7",
  );
  const legacy = { ...saved, schemaVersion: 6, guides: undefined };
  expect(Document.fromJSON(legacy).guides.length).toBe(0);
});

it("rebases guides with cropped artwork and restores original positions on undo", () => {
  const doc = new Document({ width: 200, height: 200 });
  doc.guides.add(new Guide({ orientation: "vertical", position: 20.5 }));
  doc.guides.add(new Guide({ orientation: "horizontal", position: 100 }));
  const before = doc.toJSON();
  doc._dispatch({
    type: "document.crop",
    bounds: { x: 40, y: 60, width: 100, height: 100 },
  });
  expect(doc.guides.items.map((guide) => guide.position)).toEqual([-19.5, 40]);
  doc.undo();
  expect(doc.toJSON()).toEqual(before);
  doc.resize(100, 100);
  expect(doc.guides.items.map((guide) => guide.position)).toEqual([20.5, 100]);
});
