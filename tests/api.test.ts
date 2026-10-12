import { afterAll, beforeAll, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { createApiServer } from "../server/app";
import {
  LayerMask,
  LayerGroup,
  PaintLayer,
  BrushStroke,
  VectorLayer,
  VectorPath,
  TextLayer,
  MarqueeSelection,
  AffineTransform,
  LayerStyle,
  BlendIf,
  AdjustmentLayer,
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
it("applies tonal sculpt through the DOM with REST revision and undo protection", async () => {
  const created = await request("/documents", { width: 10000, height: 5000 });
  const endpoint = `/documents/${created.body.document.id}`;
  const payload = {
    expectedRevision: created.body.revision,
    path: [{ x: 5000, y: 2500 }],
    mode: "dodge",
    range: "midtones",
    exposure: 0.5,
    options: { size: 50, hardness: 1, clipSelection: false },
  };
  for (const options of [{ size: -1 }, { flow: 2 }, { unrecognized: true }]) {
    expect(
      (await request(`${endpoint}/tonal-sculpt`, { ...payload, options }))
        .status,
    ).toBe(400);
    expect((await request(endpoint)).body.revision).toBe(created.body.revision);
  }
  const applied = await request(`${endpoint}/tonal-sculpt`, payload);
  expect(applied.status).toBe(200);
  expect(applied.body.document.children[0]).toMatchObject({
    id: applied.body.layerId,
    kind: "adjustment",
    adjustment: {
      kind: "tonal",
      strokes: [
        {
          mode: "dodge",
          exposure: 0.5,
          brush: {
            points: [{ x: 5000, y: 2500, pressure: 1 }],
            size: 50,
            clip: null,
          },
        },
      ],
    },
  });
  expect((await request(`${endpoint}/tonal-sculpt`, payload)).status).toBe(409);
  const undone = await request(`${endpoint}/undo`, {
    expectedRevision: applied.body.revision,
  });
  expect(undone.body.document).toEqual(created.body.document);
  const redone = await request(`${endpoint}/redo`, {
    expectedRevision: undone.body.revision,
  });
  expect(redone.body.document).toEqual(applied.body.document);
});

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

it("round-trips authored metadata through REST with revision validation and undo", async () => {
  const created = await request("/documents", { name: "Metadata" });
  const path = `/documents/${created.body.document.id}`;
  const layer = new TextLayer({ text: "Artwork" });
  const metadata = {
    title: "Botanical",
    description: "Hand drawn",
    altText: "Green leaves",
    creator: "Studio",
    copyright: "Studio",
    license: "Internal use",
    keywords: ["botanical"],
  };
  const changed = await request(path + "/commands", {
    expectedRevision: 0,
    commands: [
      { type: "layer.add", layer: layer.toJSON() },
      { type: "layer.update", id: layer.id, patch: { metadata } },
    ],
  });
  expect(changed.status).toBe(200);
  expect(changed.body.document.schemaVersion).toBe(16);
  expect(changed.body.document.children[0].metadata).toEqual(metadata);
  const invalid = await request(path + "/commands", {
    expectedRevision: 1,
    commands: [
      {
        type: "layer.update",
        id: layer.id,
        patch: { metadata: { ...metadata, license: "x".repeat(1025) } },
      },
    ],
  });
  expect(invalid.status).toBe(400);
  const undone = await request(path + "/undo", { expectedRevision: 1 });
  expect(undone.status).toBe(200);
  expect(undone.body.document.children).toHaveLength(0);
});

it("applies and undoes layer masks through the REST command boundary", async () => {
  const created = await request("/documents", { name: "Masked artwork" });
  const path = `/documents/${created.body.document.id}`;
  const layer = new TextLayer({ text: "Mask me" });
  const mask = {
    kind: "selection",
    enabled: true,
    inverted: false,
    density: 0.75,
    selection: {
      regions: [
        {
          shape: "ellipse",
          operation: "add",
          x: 0,
          y: 0,
          width: 80,
          height: 60,
        },
      ],
    },
  };
  const added = await request(path + "/commands", {
    expectedRevision: 0,
    commands: [
      { type: "layer.add", layer: layer.toJSON() },
      { type: "layer.update", id: layer.id, patch: { mask } },
    ],
  });
  expect(added.status).toBe(200);
  expect(added.body.document.children[0].mask).toEqual(mask);
  const removed = await request(path + "/commands", {
    expectedRevision: 1,
    commands: [{ type: "layer.update", id: layer.id, patch: { mask: null } }],
  });
  expect(removed.status).toBe(200);
  const undone = await request(path + "/undo", { expectedRevision: 2 });
  expect(undone.body.document.children[0].mask).toEqual(mask);
});

it("persists vector-mask geometry and rejects unsupported fill rules through REST", async () => {
  const created = await request("/documents", { name: "Vector masked" });
  const path = `/documents/${created.body.document.id}`;
  const layer = new TextLayer({ text: "Curved" });
  const points = [
    { x: 0, y: 0 },
    { x: 50, y: 0 },
    { x: 50, y: 50 },
    { x: 0, y: 50 },
  ].map((p) => ({ ...p, in: { ...p }, out: { ...p } }));
  const mask = {
    kind: "vector",
    paths: [{ points }],
    strokes: [
      {
        mode: "hide",
        stroke: new BrushStroke({
          points: [{ x: 10, y: 10 }],
          opacity: 0.4,
        }).toJSON(),
      },
    ],
    fillRule: "evenodd",
    enabled: true,
    inverted: false,
    density: 0.8,
    feather: 7.5,
    linked: false,
    x: 12.5,
    y: -8,
  };
  const response = await request(path + "/commands", {
    expectedRevision: 0,
    commands: [
      { type: "layer.add", layer: layer.toJSON() },
      { type: "layer.update", id: layer.id, patch: { mask } },
    ],
  });
  expect(response.status).toBe(200);
  expect(response.body.document.children[0].mask).toEqual(mask);
  const invalid = await request(path + "/commands", {
    expectedRevision: 1,
    commands: [
      {
        type: "layer.update",
        id: layer.id,
        patch: { mask: { ...mask, fillRule: "invalid" } },
      },
    ],
  });
  expect(invalid.status).toBe(400);
  const undone = await request(path + "/undo", { expectedRevision: 1 });
  expect(undone.body.document.children).toHaveLength(0);
});

it("round-trips painted masks and rejects unsafe stroke kinds through REST", async () => {
  const created = await request("/documents", { name: "Painted mask" }),
    path = `/documents/${created.body.document.id}`;
  const layer = new PaintLayer(),
    mask = new LayerMask({ base: 1 })
      .paint(
        new BrushStroke({ points: [{ x: 30, y: 40 }], opacity: 0.5 }),
        "hide",
      )
      .toJSON();
  const response = await request(path + "/commands", {
    expectedRevision: 0,
    commands: [
      { type: "layer.add", layer: layer.toJSON() },
      { type: "layer.update", id: layer.id, patch: { mask } },
    ],
  });
  expect(response.status).toBe(200);
  expect(response.body.document.children[0].mask).toEqual(mask);
  if (mask.kind !== "paint") throw Error("paint mask expected");
  const invalid = await request(path + "/commands", {
    expectedRevision: 1,
    commands: [
      {
        type: "layer.update",
        id: layer.id,
        patch: {
          mask: {
            ...mask,
            strokes: [
              {
                ...mask.strokes[0],
                stroke: { ...mask.strokes[0].stroke, kind: "clone" },
              },
            ],
          },
        },
      },
    ],
  });
  expect(invalid.status).toBe(400);
  expect((await request(path)).body.revision).toBe(1);
});

it("crops through REST with atomic validation, coordinate rebasing and revision checks", async () => {
  const created = await request("/documents", {
    name: "Crop",
    width: 200,
    height: 160,
  });
  const path = `/documents/${created.body.document.id}`;
  const layer = new PaintLayer({ x: 20, y: 30 });
  layer.mask = new LayerMask({ base: 1, linked: false, x: 50, y: 60 });
  const added = await request(path + "/commands", {
    expectedRevision: 0,
    commands: [{ type: "layer.add", layer: layer.toJSON() }],
  });
  expect(added.status).toBe(200);
  const cropped = await request(path + "/commands", {
    expectedRevision: 1,
    commands: [
      {
        type: "document.crop",
        bounds: { x: 10, y: 15, width: 100, height: 80 },
      },
    ],
  });
  expect(cropped.status).toBe(200);
  expect(cropped.body.document).toMatchObject({
    width: 100,
    height: 80,
    children: [{ x: 10, y: 15, mask: { x: 40, y: 45 } }],
  });
  const stale = await request(path + "/commands", {
    expectedRevision: 1,
    commands: [
      { type: "document.crop", bounds: { x: 0, y: 0, width: 20, height: 20 } },
    ],
  });
  expect(stale.status).toBe(409);
  const invalid = await request(path + "/commands", {
    expectedRevision: 2,
    commands: [
      { type: "document.rename", name: "Discard" },
      {
        type: "document.crop",
        bounds: { x: 0.5, y: 0, width: 20, height: 20 },
      },
    ],
  });
  expect(invalid.status).toBe(400);
  expect((await request(path)).body.document).toEqual(cropped.body.document);
  const undone = await request(path + "/undo", { expectedRevision: 2 });
  expect(undone.body.document).toEqual(added.body.document);
  const redone = await request(path + "/redo", { expectedRevision: 3 });
  expect(redone.body.document).toEqual(cropped.body.document);
});

it("creates and updates adjustment layers via REST API commands with undo/redo", async () => {
  const created = await request("/documents", {
    name: "Adjustment REST",
    width: 200,
    height: 150,
  });
  const path = `/documents/${created.body.document.id}`;
  const layer = new AdjustmentLayer({
    name: "Curves REST",
    adjustment: {
      kind: "curves",
      rgb: [
        { x: 0, y: 0 },
        { x: 128, y: 150 },
        { x: 255, y: 255 },
      ],
    },
  });

  const added = await request(path + "/commands", {
    expectedRevision: 0,
    commands: [{ type: "layer.add", layer: layer.toJSON() }],
  });
  expect(added.status).toBe(200);
  expect(added.body.document.children[0].kind).toBe("adjustment");
  expect(added.body.document.children[0].adjustment.kind).toBe("curves");

  // Update adjustment to levels
  const updated = await request(path + "/commands", {
    expectedRevision: 1,
    commands: [
      {
        type: "layer.update",
        id: layer.id,
        patch: {
          adjustment: {
            kind: "levels",
            rgb: {
              inputBlack: 25,
              inputWhite: 235,
              gamma: 1.15,
              outputBlack: 0,
              outputWhite: 255,
            },
          },
        },
      },
    ],
  });
  expect(updated.status).toBe(200);
  expect(updated.body.document.children[0].adjustment.kind).toBe("levels");
  expect(updated.body.document.children[0].adjustment.rgb.inputBlack).toBe(25);

  // Reject invalid adjustment patch (inputWhite <= inputBlack)
  const invalid = await request(path + "/commands", {
    expectedRevision: 2,
    commands: [
      {
        type: "layer.update",
        id: layer.id,
        patch: {
          adjustment: {
            kind: "levels",
            rgb: {
              inputBlack: 200,
              inputWhite: 100, // Invalid!
              gamma: 1.0,
              outputBlack: 0,
              outputWhite: 255,
            },
          },
        },
      },
    ],
  });
  expect(invalid.status).toBe(400);

  // Undo reverts back to curves
  const undone = await request(path + "/undo", { expectedRevision: 2 });
  expect(undone.status).toBe(200);
  expect(undone.body.document.children[0].adjustment.kind).toBe("curves");

  // Redo brings levels back
  const redone = await request(path + "/redo", { expectedRevision: 3 });
  expect(redone.status).toBe(200);
  expect(redone.body.document.children[0].adjustment.kind).toBe("levels");
});

it("persists affine selections through REST and rejects singular transforms atomically", async () => {
  const created = await request("/documents", { name: "Affine selection" });
  const path = `/documents/${created.body.document.id}`;
  const selection = new MarqueeSelection({
    shape: "rectangle",
    x: 2,
    y: 3,
    width: 40,
    height: 20,
  })
    .transformed(new AffineTransform(0, 1, -1, 0, 100, 40))
    .toJSON();
  const changed = await request(path + "/commands", {
    expectedRevision: 0,
    commands: [{ type: "selection.set", selection }],
  });
  expect(changed.status).toBe(200);
  expect(changed.body.document.selection).toEqual(selection);
  const invalid = await request(path + "/commands", {
    expectedRevision: 1,
    commands: [
      { type: "document.rename", name: "Must not commit" },
      {
        type: "selection.set",
        selection: {
          regions: [
            {
              ...selection.regions[0],
              transform: { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 },
            },
          ],
        },
      },
    ],
  });
  expect(invalid.status).toBe(400);
  const current = await request(path);
  expect(current.body.document.name).toBe("Affine selection");
  expect(current.body.document.selection).toEqual(selection);
  const undo = await request(path + "/undo", { expectedRevision: 1 });
  expect(undo.status).toBe(200);
  expect(undo.body.document.selection ?? null).toBeNull();
});

it("rejects unconfigured REST generation instead of returning synthetic success", async () => {
  const created = await request("/documents", { width: 16, height: 16 });
  const result = await request(`/documents/${created.body.document.id}/jobs`, {
    prompt: "real generation",
    targetWidth: 16,
    targetHeight: 16,
  });
  expect(result.status).toBe(503);
  expect(result.body.error).toContain("No REST generation executor");
  expect(result.body.job).toBeUndefined();
});

it("validates guide commands through REST and preserves atomic undo", async () => {
  const created = await request("/documents", { width: 100, height: 100 });
  const path = `/documents/${created.body.document.id}`;
  const guides = [{ id: "margin", orientation: "vertical", position: 12.5 }];
  const changed = await request(path + "/commands", {
    expectedRevision: 0,
    commands: [{ type: "document.guides", guides }],
  });
  expect(changed.status).toBe(200);
  expect(changed.body.document.guides).toEqual(guides);
  const rejected = await request(path + "/commands", {
    expectedRevision: 1,
    commands: [{ type: "document.guides", guides: [...guides, ...guides] }],
  });
  expect(rejected.status).toBe(400);
  expect((await request(path)).body.document.guides).toEqual(guides);
  const undone = await request(path + "/undo", { expectedRevision: 1 });
  expect(undone.status).toBe(200);
  expect(undone.body.document.guides ?? []).toEqual([]);
});

it("persists component definitions and places instances in one REST transaction with undo", async () => {
  const { Document, SmartObjectLayer } = await import("../src/dom");
  const master = new Document({ width: 16, height: 16 });
  master.layers.add(new TextLayer({ text: "Master" }));
  const target = new Document();
  const componentId = target.defineComponent(master);
  const created = await request("/documents", { width: 32, height: 16 });
  const path = `/documents/${created.body.document.id}`;
  const placed = await request(path + "/commands", {
    expectedRevision: 0,
    commands: [
      { type: "component.set", definition: target.toJSON().components![0] },
      {
        type: "layer.add",
        layer: new SmartObjectLayer({
          componentId,
          width: 16,
          height: 16,
        }).toJSON(),
      },
    ],
  });
  expect(placed.status).toBe(200);
  expect(placed.body.document.children[0].kind).toBe("smart-object");
  expect(placed.body.document.components).toHaveLength(1);
  const invalid = await request(path + "/commands", {
    expectedRevision: 1,
    commands: [{ type: "component.remove", id: componentId }],
  });
  expect(invalid.status).toBe(400);
  const undone = await request(path + "/undo", { expectedRevision: 1 });
  expect(undone.status).toBe(200);
  expect(undone.body.document.children).toHaveLength(0);
  expect(undone.body.document.components).toBeUndefined();
});

it("converts a raster through strict REST commands and restores its original identity on undo", async () => {
  const { RasterLayer } = await import("../src/dom");
  const created = await request("/documents", { width: 32, height: 32 });
  const path = `/documents/${created.body.document.id}`;
  const photo = new RasterLayer({
    assetId: "source",
    width: 16,
    height: 16,
    x: 3,
    y: 4,
  });
  expect(
    (
      await request(path + "/commands", {
        expectedRevision: 0,
        commands: [{ type: "layer.add", layer: photo.toJSON() }],
      })
    ).status,
  ).toBe(200);
  const converted = await request(path + "/commands", {
    expectedRevision: 1,
    commands: [
      {
        type: "smartObject.convertRaster",
        id: photo.id,
        componentId: "master",
        instanceId: "instance",
      },
    ],
  });
  expect(converted.status).toBe(200);
  expect(converted.body.document.children[0]).toMatchObject({
    id: "instance",
    kind: "smart-object",
    componentId: "master",
    x: 3,
    y: 4,
  });
  expect(converted.body.document.components[0].source).toMatchObject({
    kind: "asset",
    assetId: "source",
  });
  expect(
    (
      await request(path + "/commands", {
        expectedRevision: 2,
        commands: [
          {
            type: "smartObject.convertRaster",
            id: "instance",
            componentId: "other",
            instanceId: "next",
          },
        ],
      })
    ).status,
  ).toBe(400);
  const undone = await request(path + "/undo", { expectedRevision: 2 });
  expect(undone.body.document.children).toEqual([photo.toJSON()]);
  expect(undone.body.document.components).toBeUndefined();
});

it("duplicates an independent component graph through REST with deterministic identities and undo", async () => {
  const { Document, SmartObjectLayer } = await import("../src/dom");
  const document = new Document();
  const componentId = document.defineComponent(new Document());
  const instance = new SmartObjectLayer({ componentId, width: 16, height: 16 });
  const created = await request("/documents", { width: 64, height: 64 });
  const path = `/documents/${created.body.document.id}`;
  expect(
    (
      await request(path + "/commands", {
        expectedRevision: 0,
        commands: [
          {
            type: "component.set",
            definition: document.toJSON().components![0],
          },
          { type: "layer.add", layer: instance.toJSON() },
        ],
      })
    ).status,
  ).toBe(200);
  const invalid = await request(path + "/commands", {
    expectedRevision: 1,
    commands: [
      {
        type: "smartObject.duplicateIndependent",
        id: instance.id,
        instanceId: "copy",
        componentIds: {},
      },
    ],
  });
  expect(invalid.status).toBe(400);
  const copied = await request(path + "/commands", {
    expectedRevision: 1,
    commands: [
      {
        type: "smartObject.duplicateIndependent",
        id: instance.id,
        instanceId: "copy",
        componentIds: { [componentId]: "copied-master" },
      },
    ],
  });
  expect(copied.status).toBe(200);
  expect(copied.body.document.children[1]).toMatchObject({
    id: "copy",
    kind: "smart-object",
    componentId: "copied-master",
    x: 24,
    y: 24,
  });
  expect(copied.body.document.components).toHaveLength(2);
  const undone = await request(path + "/undo", { expectedRevision: 2 });
  expect(undone.body.document.children).toHaveLength(1);
  expect(undone.body.document.components).toHaveLength(1);
});

it("applies smart filter stacks through strict REST commands with revision and undo protection", async () => {
  const { Document, GaussianBlurFilter } = await import("../src/dom");
  const target = new Document(),
    componentId = target.defineComponent(
      new Document({ width: 16, height: 16 }),
    );
  const instance = target.placeSmartObject(componentId);
  const created = await request("/documents", { width: 32, height: 16 });
  const path = `/documents/${created.body.document.id}`;
  await request(path + "/commands", {
    expectedRevision: 0,
    commands: [
      { type: "component.set", definition: target.toJSON().components![0] },
      { type: "layer.add", layer: instance.toJSON() },
    ],
  });
  const filter = new GaussianBlurFilter({ sigma: 2 }).toJSON();
  const filtered = await request(path + "/commands", {
    expectedRevision: 1,
    commands: [
      { type: "smartObject.filters", id: instance.id, filters: [filter] },
    ],
  });
  expect(filtered.status).toBe(200);
  expect(filtered.body.document.children[0].smartFilters).toEqual([filter]);
  const invalid = await request(path + "/commands", {
    expectedRevision: 2,
    commands: [
      {
        type: "smartObject.filters",
        id: instance.id,
        filters: [{ ...filter, sigma: -1 }],
      },
    ],
  });
  expect(invalid.status).toBe(400);
  const undo = await request(path + "/undo", { expectedRevision: 2 });
  expect(undo.status).toBe(200);
  expect(undo.body.document.children[0].smartFilters).toBeUndefined();
});

it("sets smart-filter masks through REST and rejects stale and invalid updates atomically", async () => {
  const { Document, LayerMask } = await import("../src/dom");
  const model = new Document(),
    key = model.defineComponent(new Document({ width: 16, height: 16 }));
  const instance = model.placeSmartObject(key);
  const created = await request("/documents", { width: 32, height: 16 });
  const path = `/documents/${created.body.document.id}`;
  await request(path + "/commands", {
    expectedRevision: 0,
    commands: [
      { type: "component.set", definition: model.toJSON().components![0] },
      { type: "layer.add", layer: instance.toJSON() },
    ],
  });
  const mask = new LayerMask({ base: 0, density: 0.7, linked: false }).toJSON();
  const set = await request(path + "/commands", {
    expectedRevision: 1,
    commands: [{ type: "smartObject.filterMask", id: instance.id, mask }],
  });
  expect(set.status).toBe(200);
  expect(set.body.document.children[0].filterMask).toEqual(mask);
  expect(
    (
      await request(path + "/commands", {
        expectedRevision: 1,
        commands: [
          { type: "smartObject.filterMask", id: instance.id, mask: null },
        ],
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await request(path + "/commands", {
        expectedRevision: 2,
        commands: [
          {
            type: "smartObject.filterMask",
            id: instance.id,
            mask: { ...mask, density: -1 },
          },
        ],
      })
    ).status,
  ).toBe(400);
  const undo = await request(path + "/undo", { expectedRevision: 2 });
  expect(undo.status).toBe(200);
  expect(undo.body.document.children[0].filterMask).toBeUndefined();
});

it("converts a sibling selection through REST with strict rollback and undo", async () => {
  const created = await request("/documents", { width: 100, height: 80 });
  const path = `/documents/${created.body.document.id}`;
  const layers = ["A", "B", "C"].map((text) =>
    new TextLayer({ name: text, text }).toJSON(),
  );
  await request(path + "/commands", {
    expectedRevision: 0,
    commands: layers.map((layer) => ({ type: "layer.add", layer })),
  });
  const bad = await request(path + "/commands", {
    expectedRevision: 1,
    commands: [
      {
        type: "smartObject.convertLayers",
        ids: [layers[0].id, layers[2].id],
        componentId: "master",
        instanceId: "instance",
      },
    ],
  });
  expect(bad.status).toBe(400);
  const converted = await request(path + "/commands", {
    expectedRevision: 1,
    commands: [
      {
        type: "smartObject.convertLayers",
        ids: [layers[1].id, layers[0].id],
        componentId: "master",
        instanceId: "instance",
      },
    ],
  });
  expect(converted.status).toBe(200);
  expect(
    converted.body.document.children.map((layer: { id: string }) => layer.id),
  ).toEqual(["instance", layers[2].id]);
  expect(
    converted.body.document.components[0].source.document.children.map(
      (layer: { name: string }) => layer.name,
    ),
  ).toEqual(["A", "B"]);
  const undone = await request(path + "/undo", { expectedRevision: 2 });
  expect(undone.body.document.children).toEqual(layers);
  expect(undone.body.document.components).toBeUndefined();
});

it("commits externally prepared raster data in place of a smart instance with REST undo", async () => {
  const { Document, RasterLayer } = await import("../src/dom");
  const model = new Document(),
    master = new Document({ width: 16, height: 16 });
  master.layers.add(new TextLayer({ text: "Master" }));
  const smart = model.placeSmartObject(model.defineComponent(master));
  const created = await request("/documents", { width: 64, height: 64 });
  const path = `/documents/${created.body.document.id}`;
  const setup = await request(path + "/commands", {
    expectedRevision: 0,
    commands: [
      { type: "component.set", definition: model.toJSON().components![0] },
      { type: "layer.add", layer: smart.toJSON() },
    ],
  });
  expect(setup.status).toBe(200);
  const raster = new RasterLayer({
    assetId: "prepared-raster",
    width: 16,
    height: 16,
  }).toJSON();
  const committed = await request(path + "/commands", {
    expectedRevision: 1,
    commands: [
      { type: "smartObject.convertToRaster", id: smart.id, layer: raster },
    ],
  });
  expect(committed.status).toBe(200);
  expect(committed.body.document.children).toEqual([raster]);
  const undo = await request(path + "/undo", { expectedRevision: 2 });
  expect(undo.body.document.children).toEqual([smart.toJSON()]);
});

it("persists a linked image declaration through REST component commands and undo", async () => {
  const created = await request("/documents", { width: 16, height: 16 });
  const path = `/documents/${created.body.document.id}`;
  const source = {
    kind: "asset",
    assetId: "cached-file",
    width: 16,
    height: 16,
    link: {
      kind: "local-file",
      name: "source.png",
      sha256: "a".repeat(64),
      byteLength: 123,
      lastModified: 42,
    },
  };
  const result = await request(path + "/commands", {
    expectedRevision: 0,
    commands: [
      {
        type: "component.set",
        definition: { id: "linked", name: "Linked", source },
      },
    ],
  });
  expect(result.status).toBe(200);
  expect(result.body.document.schemaVersion).toBe(16);
  expect(result.body.document.components[0].source).toEqual(source);
  const undo = await request(path + "/undo", { expectedRevision: 1 });
  expect(undo.body.document.components).toBeUndefined();
});

it("saves and applies layer comps through REST with atomic undo and strict ownership", async () => {
  const { captureLayerComp } = await import("../src/core/layer-comps");
  const created = await request("/documents", { width: 32, height: 32 });
  const path = `/documents/${created.body.document.id}`;
  const layer = new TextLayer({ text: "Original", x: 3 }).toJSON();
  const added = await request(path + "/commands", {
    expectedRevision: 0,
    commands: [{ type: "layer.add", layer }],
  });
  const comp = captureLayerComp(added.body.document, "Original layout");
  const saved = await request(path + "/commands", {
    expectedRevision: 1,
    commands: [
      { type: "layerComp.set", comp },
      { type: "layer.update", id: layer.id, patch: { x: 19 } },
    ],
  });
  expect(saved.status).toBe(200);
  const applied = await request(path + "/commands", {
    expectedRevision: 2,
    commands: [{ type: "layerComp.apply", id: comp.id }],
  });
  expect(applied.status).toBe(200);
  expect(applied.body.document.children[0].x).toBe(3);
  const undone = await request(path + "/undo", { expectedRevision: 3 });
  expect(undone.body.document.children[0].x).toBe(19);
  const invalid = await request(path + "/commands", {
    expectedRevision: 4,
    commands: [
      { type: "layerComp.set", comp: { ...comp, documentId: "foreign" } },
    ],
  });
  expect(invalid.status).toBeGreaterThanOrEqual(400);
});

it("distributes layers through REST with undo and rejects invalid distribution modes", async () => {
  const created = await request("/documents", { width: 200, height: 100 });
  const path = `/documents/${created.body.document.id}`;
  const layers = [0, 40, 150].map((x) => ({
    ...new TextLayer({ text: "A", x }).toJSON(),
    width: 20,
    height: 20,
  }));
  await request(path + "/commands", {
    expectedRevision: 0,
    commands: layers.map((layer) => ({ type: "layer.add", layer })),
  });
  const distributed = await request(path + "/commands", {
    expectedRevision: 1,
    commands: [
      {
        type: "layer.distribute",
        ids: layers.map((layer) => layer.id),
        axis: "horizontal",
        mode: "gaps",
      },
    ],
  });
  expect(distributed.status).toBe(200);
  expect(
    distributed.body.document.children.map((layer: { x: number }) => layer.x),
  ).toEqual([0, 75, 150]);
  const undone = await request(path + "/undo", { expectedRevision: 2 });
  expect(
    undone.body.document.children.map((layer: { x: number }) => layer.x),
  ).toEqual([0, 40, 150]);
  const invalid = await request(path + "/commands", {
    expectedRevision: 3,
    commands: [
      {
        type: "layer.distribute",
        ids: layers.map((layer) => layer.id),
        axis: "horizontal",
        mode: "random",
      },
    ],
  });
  expect(invalid.status).toBe(400);
});

it("flips a layer via REST without changing native dimensions and supports undo", async () => {
  const created = await request("/documents", { width: 64, height: 64 });
  const path = `/documents/${created.body.document.id}`;
  const layer = new TextLayer({ text: "A", x: 5, y: 7 }).toJSON();
  if (layer.kind !== "text") throw new Error("Expected a text fixture.");
  await request(path + "/commands", {
    expectedRevision: 0,
    commands: [{ type: "layer.add", layer }],
  });
  const flipped = await request(path + "/commands", {
    expectedRevision: 1,
    commands: [{ type: "layer.flip", ids: [layer.id], axis: "horizontal" }],
  });
  expect(flipped.status).toBe(200);
  expect(flipped.body.document.children[0]).toMatchObject({
    x: layer.x + layer.width,
    y: layer.y,
    width: layer.width,
    height: layer.height,
    transform: { a: -1, d: 1 },
  });
  const undo = await request(path + "/undo", { expectedRevision: 2 });
  expect(undo.body.document.children).toEqual([layer]);
});

it("creates and updates an HSL adjustment via REST with validation and undo", async () => {
  const created = await request("/documents", { width: 32, height: 32 });
  const path = `/documents/${created.body.document.id}`;
  const layer = new AdjustmentLayer({
    adjustment: { kind: "hsl", hue: 0, saturation: 0, lightness: 0 },
  }).toJSON();
  await request(path + "/commands", {
    expectedRevision: 0,
    commands: [{ type: "layer.add", layer }],
  });
  const changed = await request(path + "/commands", {
    expectedRevision: 1,
    commands: [
      {
        type: "layer.update",
        id: layer.id,
        patch: {
          adjustment: { kind: "hsl", hue: 120, saturation: 0, lightness: 0 },
        },
      },
    ],
  });
  expect(changed.status).toBe(200);
  expect(changed.body.document.children[0].adjustment.hue).toBe(120);
  const invalid = await request(path + "/commands", {
    expectedRevision: 2,
    commands: [
      {
        type: "layer.update",
        id: layer.id,
        patch: {
          adjustment: { kind: "hsl", hue: 181, saturation: 0, lightness: 0 },
        },
      },
    ],
  });
  expect(invalid.status).toBeGreaterThanOrEqual(400);
  const undone = await request(path + "/undo", { expectedRevision: 2 });
  expect(undone.body.document.children).toEqual([layer]);
});
