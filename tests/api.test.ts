import { afterAll, beforeAll, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { createApiServer } from "../server/app";
import {
  LayerGroup,
  PaintLayer,
  BrushStroke,
  VectorLayer,
  VectorPath,
  TextLayer,
  MarqueeSelection,
  LayerStyle,
  BlendIf,
} from "../src/dom";
const server = createApiServer();
let base: string;
beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
});
afterAll(async () => {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});
async function request(
  path: string,
  data?: unknown,
  method = data ? "POST" : "GET",
) {
  const response = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: data ? JSON.stringify(data) : undefined,
  });
  return { status: response.status, body: await response.json() };
}
it("creates a 50 MP document and applies atomic commands with revision conflict protection", async () => {
  const created = await request("/documents", {
    name: "50 MP",
    width: 10000,
    height: 5000,
  });
  expect(created.status).toBe(201);
  const path = `/documents/${created.body.document.id}`;
  const group = new LayerGroup({ name: "Variations" });
  const result = await request(path + "/commands", {
    expectedRevision: 0,
    commands: [
      { type: "layer.add", layer: group.toJSON() },
      { type: "document.rename", name: "Edited" },
    ],
  });
  expect(result.status).toBe(200);
  expect(result.body.revision).toBe(1);
  const conflict = await request(path + "/commands", {
    expectedRevision: 0,
    commands: [],
  });
  expect(conflict.status).toBe(409);
  const invalid = await request(path + "/commands", {
    expectedRevision: 1,
    commands: [
      { type: "document.rename", name: "Should roll back" },
      { type: "layer.remove", id: "missing" },
    ],
  });
  expect(invalid.status).toBe(400);
  expect((await request(path)).body.document.name).toBe("Edited");
  const undo = await request(path + "/undo", { expectedRevision: 1 });
  expect(undo.body.document.children).toHaveLength(0);
  expect(undo.body.document.name).toBe("50 MP");
  const redo = await request(path + "/redo", { expectedRevision: 2 });
  expect(redo.body.document.children).toHaveLength(1);
  expect((await request(path, { expectedRevision: 3 }, "DELETE")).status).toBe(
    200,
  );
  expect((await request(path)).status).toBe(404);
});
it("rejects cross-site browser requests", async () => {
  const response = await fetch(base + "/health", {
    headers: { Origin: "https://untrusted.example" },
  });
  expect(response.status).toBe(403);
});

it("accepts drawing, selection and style commands, and rolls back invalid external drawing data", async () => {
  const created = await request("/documents", { width: 400, height: 300 });
  const path = `/documents/${created.body.document.id}`,
    paint = new PaintLayer(),
    vector = new VectorLayer();
  const selection = new MarqueeSelection({
    shape: "ellipse",
    x: 10,
    y: 10,
    width: 80,
    height: 60,
  });
  const result = await request(path + "/commands", {
    expectedRevision: 0,
    commands: [
      { type: "layer.add", layer: paint.toJSON() },
      { type: "layer.add", layer: vector.toJSON() },
      {
        type: "paint.add",
        id: paint.id,
        stroke: new BrushStroke({
          points: [{ x: 10, y: 20 }],
          clip: selection,
        }).toJSON(),
      },
      {
        type: "path.add",
        id: vector.id,
        path: new VectorPath({
          points: [
            { x: 0, y: 0 },
            { x: 90, y: 90 },
          ],
        }).toJSON(),
      },
      { type: "selection.set", selection: selection.toJSON() },
      {
        type: "layer.update",
        id: paint.id,
        patch: {
          styles: new LayerStyle({
            blendIf: new BlendIf({ enabled: true, source: [0, 20, 220, 255] }),
          }).toJSON(),
        },
      },
    ],
  });
  expect(result.status).toBe(200);
  expect(result.body.revision).toBe(1);
  expect(result.body.document.children[0].strokes).toHaveLength(1);
  expect(result.body.document.children[1].paths).toHaveLength(1);
  const invalid = await request(path + "/commands", {
    expectedRevision: 1,
    commands: [
      { type: "document.rename", name: "Invalid edit" },
      {
        type: "path.update",
        id: vector.id,
        pathId: result.body.document.children[1].paths[0].id,
        patch: { stroke: "not-a-color" },
      },
    ],
  });
  expect(invalid.status).toBe(400);
  expect((await request(path)).body.document).toEqual(result.body.document);
  const undo = await request(path + "/undo", { expectedRevision: 1 });
  expect(undo.body.document.children).toHaveLength(0);
  expect(undo.body.document.selection ?? null).toBeNull();
});

it("resizes document canvas via REST API commands with undo/redo", async () => {
  const created = await request("/documents", {
    name: "Resize Test",
    width: 1200,
    height: 800,
  });
  expect(created.status).toBe(201);
  const docId = created.body.document.id;
  const path = `/documents/${docId}`;

  const resizeResult = await request(path + "/commands", {
    expectedRevision: 0,
    commands: [{ type: "document.resize", width: 2400, height: 1600 }],
  });
  expect(resizeResult.status).toBe(200);
  expect(resizeResult.body.document.width).toBe(2400);
  expect(resizeResult.body.document.height).toBe(1600);

  const undoResult = await request(path + "/undo", { expectedRevision: 1 });
  expect(undoResult.status).toBe(200);
  expect(undoResult.body.document.width).toBe(1200);
  expect(undoResult.body.document.height).toBe(800);
});

it("creates and updates text layers via REST API commands with undo/redo", async () => {
  const created = await request("/documents", {
    name: "Text Layer Test",
    width: 800,
    height: 600,
  });
  expect(created.status).toBe(201);
  const docId = created.body.document.id;
  const path = `/documents/${docId}`;

  const textLayer = new TextLayer({
    name: "Heading",
    text: "Title Text",
    fontSize: 40,
    color: "#ffffff",
    align: "center",
  });

  const addResult = await request(path + "/commands", {
    expectedRevision: 0,
    commands: [{ type: "layer.add", layer: textLayer.toJSON() }],
  });
  expect(addResult.status).toBe(200);
  expect(addResult.body.document.children).toHaveLength(1);
  const addedNode = addResult.body.document.children[0];
  expect(addedNode.kind).toBe("text");
  expect(addedNode.text).toBe("Title Text");
  expect(addedNode.fontSize).toBe(40);
  expect(addedNode.align).toBe("center");

  const updateResult = await request(path + "/commands", {
    expectedRevision: 1,
    commands: [
      {
        type: "layer.update",
        id: textLayer.id,
        patch: { text: "Updated Title", fontSize: 48, color: "#ff0000" },
      },
    ],
  });
  expect(updateResult.status).toBe(200);
  const updatedNode = updateResult.body.document.children[0];
  expect(updatedNode.text).toBe("Updated Title");
  expect(updatedNode.fontSize).toBe(48);
  expect(updatedNode.color).toBe("#ff0000");

  const undoResult = await request(path + "/undo", { expectedRevision: 2 });
  expect(undoResult.status).toBe(200);
  expect(undoResult.body.document.children[0].text).toBe("Title Text");
  expect(undoResult.body.document.children[0].fontSize).toBe(40);
});

