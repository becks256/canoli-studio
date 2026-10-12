import { expect, it } from "vitest";
import { Document, LayerGroup, PaintLayer, BrushStroke, VectorLayer, VectorPath } from "../src/dom";
import { validateDocument, validateDocumentCooperatively } from "../src/core/model";
import { freezeOwnedData } from "../src/core/immutable";

function fixture() {
  const doc = new Document();
  const group = doc.layers.add(new LayerGroup());
  const paint = group.layers.add(new PaintLayer());
  paint.strokes.add(new BrushStroke({points:[{x:1,y:2,pressure:1}]}));
  const vector = doc.layers.add(new VectorLayer());
  vector.paths.add(new VectorPath({points:[{x:1,y:2}]}));
  return doc.toJSON();
}

it("cooperative and synchronous validation agree on structural and drawing failures", async () => {
  const cases = [
    (d: any) => d,
    (d: any) => { d.width = 0; },
    (d: any) => { d.schemaVersion = 999; },
    (d: any) => { d.children[0].children[0].strokes[0].points[0].pressure = -1; },
    (d: any) => { const p = d.children[0].children[0]; p.strokes.push(structuredClone(p.strokes[0])); },
    (d: any) => { d.children[1].paths[0].points[0].out.x = Infinity; },
    (d: any) => { d.children[1].id = d.children[0].id; },
    (d: any) => { d.children[1].kind = "unknown"; },
    (d: any) => { d.components = {}; },
  ];
  for (const [index, mutate] of cases.entries()) {
    const value = fixture(); mutate(value);
    const sync = await freezeOwnedData(structuredClone(value));
    const async = await freezeOwnedData(structuredClone(value));
    let syncError = "", asyncError = "";
    try { validateDocument(sync); } catch (error) { syncError = (error as Error).message; }
    try { await validateDocumentCooperatively(async); } catch (error) { asyncError = (error as Error).message; }
    expect(Boolean(syncError)).toBe(index > 0);
    expect(asyncError).toBe(syncError);
  }
});

it("large immutable drawing validation allows pending tasks to run", async () => {
  const doc = new Document();
  doc.layers.add(new PaintLayer());
  const data = doc.toJSON();
  const layer = data.children[0];
  if (layer.kind !== "paint") throw new Error("Expected paint fixture");
  const stroke = new BrushStroke({points:[{x:0,y:0,pressure:1}]}).toJSON();
  // Build serialized input directly; repeated DOM adds measure construction,
  // not the cooperative validation behavior exercised below.
  layer.strokes = Array.from({length:64}, (_,i) => ({...stroke,id:`validation-${i}`,
    points:Array.from({length:1000}, (_,x) => ({x,y:i,pressure:1}))}));
  await freezeOwnedData(data);
  let complete = false;
  const pending = new Promise<boolean>(resolve => setTimeout(() => resolve(!complete), 0));
  await validateDocumentCooperatively(data); complete = true;
  expect(await pending).toBe(true);
  expect(() => validateDocument(data)).not.toThrow();
});

it("cooperative validation refuses mutable or merely shallow-frozen input", async () => {
  await expect(validateDocumentCooperatively(fixture())).rejects.toThrow(/immutable/);
  await expect(validateDocumentCooperatively(Object.freeze(fixture()))).rejects.toThrow(/immutable/);
});
