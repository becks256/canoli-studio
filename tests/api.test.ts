import { afterAll, beforeAll, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { createApiServer } from "../server/app";
import {
  LayerMask,
  LayerGroup,
  PaintLayer,
  BrushStroke,
  PressureCurve,
  VectorLayer,
  VectorPath,
  VectorContour,
  TextLayer,
  MarqueeSelection,
  AffineTransform,
  LayerStyle,
  BlendIf,
  AdjustmentLayer,
  parseCubeLut,
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
it('validates prepared wet pixels before atomic REST edits, revision checks and undo', async () => {
  const { WetPaintStroke } = await import('../src/dom'), { PngRowEncoder } = await import('../src/core/png-stream');
  const created = await request('/documents', { width: 16, height: 16 }), endpoint = `/documents/${created.body.document.id}`, paint = new PaintLayer();
  const added = await request(endpoint + '/commands', { expectedRevision: 0, commands: [{ type: 'layer.add', layer: paint.toJSON() }] });
  const upload = async (alpha: number) => { const png = new PngRowEncoder(1, 1); await png.append(new Uint8Array([255, 0, 0, alpha]), 1); const blob = await png.finish(); const result = await request(endpoint + '/assets', { name: 'Prepared tile', width: 1, height: 1, contentType: 'image/png', data: Buffer.from(await blob.arrayBuffer()).toString('base64') }); expect(result.status).toBe(201); return result.body.asset.id as string; };
  const output = await upload(128), support = await upload(255), empty = await upload(0);
  const stroke = (coverage: string) => new WetPaintStroke({ brush: new BrushStroke({ points: [{ x: 3.5, y: 4.5 }] }), tiles: [{ x: 3, y: 4, width: 1, height: 1, assetId: output, coverage: { assetId: coverage } }] }).toJSON();
  for (const coverage of [empty, 'missing']) {
    const bad = await request(endpoint + '/commands', { expectedRevision: added.body.revision, commands: [{ type: 'document.rename', name: 'Uncommitted' }, { type: 'paint.add', id: paint.id, stroke: stroke(coverage) }] });
    expect(bad.status, JSON.stringify(bad.body)).toBe(400); expect((await request(endpoint)).body.document).toEqual(added.body.document);
  }
  const changed = await request(endpoint + '/commands', { expectedRevision: added.body.revision, commands: [{ type: 'paint.add', id: paint.id, stroke: stroke(support) }] });
  expect(changed.status, JSON.stringify(changed.body)).toBe(200); expect(changed.body.document.children[0].strokes[0].kind).toBe('wet');
  expect((await request(endpoint + '/commands', { expectedRevision: added.body.revision, commands: [{ type: 'document.rename', name: 'Stale' }] })).status).toBe(409);
  const undo = await request(endpoint + '/undo', { expectedRevision: changed.body.revision }); expect(undo.body.document).toEqual(added.body.document);
  const redo = await request(endpoint + '/redo', { expectedRevision: undo.body.revision }); expect(redo.body.document).toEqual(changed.body.document);
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
it('validates serialized pressure curves atomically with revisions, locks and undo',async()=>{
 const created=await request('/documents',{width:64,height:64}),endpoint=`/documents/${created.body.document.id}`,paint=new PaintLayer(),curve=PressureCurve.firm().toJSON(),stroke=new BrushStroke({points:[{x:20,y:20,pressure:.25}],pressureOpacity:true,pressureCurve:curve}).toJSON();
 const added=await request(endpoint+'/commands',{expectedRevision:0,commands:[{type:'layer.add',layer:paint.toJSON()}]});expect(added.status).toBe(200);
 for(const pressureCurve of [null,{points:[]},{points:[{input:0,output:1},{input:1,output:0}]},{...curve,unknown:true}]){
  const bad=await request(endpoint+'/commands',{expectedRevision:added.body.revision,commands:[{type:'document.rename',name:'Uncommitted'},{type:'paint.add',id:paint.id,stroke:{...stroke,pressureCurve}}]});expect(bad.status).toBe(400);expect((await request(endpoint)).body.document).toEqual(added.body.document);
 }
 const changed=await request(endpoint+'/commands',{expectedRevision:added.body.revision,commands:[{type:'paint.add',id:paint.id,stroke}]});expect(changed.status,JSON.stringify(changed.body)).toBe(200);expect(changed.body.document.children[0].strokes[0].pressureCurve).toEqual(curve);
 expect((await request(endpoint+'/commands',{expectedRevision:added.body.revision,commands:[{type:'paint.add',id:paint.id,stroke}]})).status).toBe(409);
 const undone=await request(endpoint+'/undo',{expectedRevision:changed.body.revision});expect(undone.body.document).toEqual(added.body.document);
 const redone=await request(endpoint+'/redo',{expectedRevision:undone.body.revision});expect(redone.body.document).toEqual(changed.body.document);
 const locked=await request(endpoint+'/commands',{expectedRevision:redone.body.revision,commands:[{type:'layer.update',id:paint.id,patch:{locked:true}}]});expect(locked.status).toBe(200);
 expect((await request(endpoint+'/commands',{expectedRevision:locked.body.revision,commands:[{type:'paint.add',id:paint.id,stroke:{...stroke,id:'another-stroke'}}]})).status).toBe(400);
});
it('validates pass-through group commands with shared revision, locks and one-step undo',async()=>{
 const created=await request('/documents',{width:32,height:24}),endpoint=`/documents/${created.body.document.id}`;
 const group=new LayerGroup({blendMode:'pass-through'}),raster=new (await import('../src/dom')).RasterLayer({assetId:'source',width:4,height:4});
 const added=await request(endpoint+'/commands',{expectedRevision:0,commands:[{type:'layer.add',layer:group.toJSON()}]});expect(added.status).toBe(200);expect(added.body.document.schemaVersion).toBe(40);
 const changed=await request(endpoint+'/commands',{expectedRevision:added.body.revision,commands:[{type:'layer.update',id:group.id,patch:{opacity:.5,blendMode:'normal'}}]});expect(changed.status).toBe(200);
 expect((await request(endpoint+'/commands',{expectedRevision:added.body.revision,commands:[{type:'layer.update',id:group.id,patch:{blendMode:'pass-through'}}]})).status).toBe(409);
 const undone=await request(endpoint+'/undo',{expectedRevision:changed.body.revision});expect(undone.body.document.children[0]).toMatchObject({blendMode:'pass-through',opacity:1});
 const bad=await request(endpoint+'/commands',{expectedRevision:undone.body.revision,commands:[{type:'layer.add',layer:{...raster.toJSON(),blendMode:'pass-through'}}]});expect(bad.status).toBe(400);expect((await request(endpoint)).body.document).toEqual(undone.body.document);
 const locked=await request(endpoint+'/commands',{expectedRevision:undone.body.revision,commands:[{type:'layer.update',id:group.id,patch:{locked:true}}]});expect(locked.status).toBe(200);
 expect((await request(endpoint+'/commands',{expectedRevision:locked.body.revision,commands:[{type:'layer.update',id:group.id,patch:{opacity:.25}}]})).status).toBe(400);
});
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
  expect(changed.body.document.schemaVersion).toBe(40);
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

it('shares linked paragraph styles, overrides, rollback, history and locks through strict REST commands',async()=>{
  const {TextLayer,ParagraphStyle}=await import('../src/dom'),style=new ParagraphStyle({name:'Body',format:{fontSize:20}}),first=new TextLayer({text:'First frame'}),second=new TextLayer({text:'Second frame'});
  const created=await request('/documents',{width:400,height:200}),path=`/documents/${created.body.document.id}`;
  const added=await request(path+'/commands',{expectedRevision:0,commands:[{type:'paragraphStyle.set',style:style.toJSON()},
    {type:'layer.add',layer:first.toJSON()},{type:'layer.add',layer:second.toJSON()},
    {type:'text.paragraphStyle',id:first.id,styleId:style.id},{type:'text.paragraphStyle',id:second.id,styleId:style.id}]});
  expect(added.status,JSON.stringify(added.body)).toBe(200);expect(added.body.document.schemaVersion).toBe(40);
  const local=await request(path+'/commands',{expectedRevision:added.body.revision,commands:[{type:'layer.update',id:second.id,patch:{fontSize:29}}]});expect(local.status).toBe(200);
  const changed=await request(path+'/commands',{expectedRevision:local.body.revision,commands:[{type:'paragraphStyle.set',style:{...style.toJSON(),format:{...style.format,fontSize:36,color:'#336699'}}}]});
  expect(changed.status,JSON.stringify(changed.body)).toBe(200);expect(changed.body.document.children[0].fontSize).toBe(36);expect(changed.body.document.children[1].fontSize).toBe(29);
  expect(changed.body.document.children[1].paragraphStyle.overrides).toEqual({fontSize:29});
  for(const command of [{type:'paragraphStyle.set',style:{...style.toJSON(),extra:true}},
    {type:'paragraphStyle.set',style:{...style.toJSON(),format:{...style.format,fontSize:0}}},
    {type:'text.paragraphStyle',id:first.id,styleId:'missing'},
    {type:'text.paragraphOverrides.clear',id:second.id,keys:['unknown']}]){
    const invalid=await request(path+'/commands',{expectedRevision:changed.body.revision,commands:[{type:'document.rename',name:'Uncommitted'},command]});
    expect(invalid.status).toBe(400);expect((await request(path)).body.document).toEqual(changed.body.document);
  }
  expect((await request(path+'/commands',{expectedRevision:local.body.revision,commands:[{type:'text.paragraphOverrides.clear',id:second.id}]})).status).toBe(409);
  const undo=await request(path+'/undo',{expectedRevision:changed.body.revision});expect(undo.body.document).toEqual(local.body.document);
  const redo=await request(path+'/redo',{expectedRevision:undo.body.revision});expect(redo.body.document).toEqual(changed.body.document);
  const locked=await request(path+'/commands',{expectedRevision:redo.body.revision,commands:[{type:'layer.update',id:first.id,patch:{locked:true}}]});
  expect((await request(path+'/commands',{expectedRevision:locked.body.revision,commands:[{type:'paragraphStyle.set',style:style.toJSON()}]})).status).toBe(400);
  expect((await request(path)).body.document).toEqual(locked.body.document);
});

it('applies bilateral denoise through strict REST commands with rollback, stale revisions and locks',async()=>{
  const {Document,BilateralDenoiseFilter}=await import('../src/dom'),target=new Document();
  const instance=target.placeSmartObject(target.defineComponent(new Document({width:16,height:16})));
  const created=await request('/documents',{width:32,height:16}),path=`/documents/${created.body.document.id}`;
  const added=await request(path+'/commands',{expectedRevision:0,commands:[{type:'component.set',definition:target.toJSON().components![0]},{type:'layer.add',layer:instance.toJSON()}]});
  expect(added.status).toBe(200);const filter=new BilateralDenoiseFilter({radius:3,colorSigma:20,amount:.75}).toJSON();
  const changed=await request(path+'/commands',{expectedRevision:added.body.revision,commands:[{type:'smartObject.filters',id:instance.id,filters:[filter]}]});
  expect(changed.status,JSON.stringify(changed.body)).toBe(200);expect(changed.body.document.schemaVersion).toBe(40);
  expect(changed.body.document.children[0].smartFilters).toEqual([filter]);expect(changed.body.document.components).toEqual(added.body.document.components);
  for(const patch of [{radius:1.5},{radius:17},{radius:null},{colorSigma:-1},{colorSigma:null},{amount:1.1},{amount:null},{extra:1}]){
    const invalid=await request(path+'/commands',{expectedRevision:changed.body.revision,commands:[{type:'document.rename',name:'Uncommitted'},
      {type:'smartObject.filters',id:instance.id,filters:[{...filter,...patch}]}]});
    expect(invalid.status).toBe(400);expect((await request(path)).body.document).toEqual(changed.body.document);
  }
  expect((await request(path+'/commands',{expectedRevision:added.body.revision,commands:[{type:'smartObject.filters',id:instance.id,filters:[]}]})).status).toBe(409);
  const undone=await request(path+'/undo',{expectedRevision:changed.body.revision});expect(undone.body.document).toEqual(added.body.document);
  const redone=await request(path+'/redo',{expectedRevision:undone.body.revision});expect(redone.body.document).toEqual(changed.body.document);
  const locked=await request(path+'/commands',{expectedRevision:redone.body.revision,commands:[{type:'layer.update',id:instance.id,patch:{locked:true}}]});
  expect((await request(path+'/commands',{expectedRevision:locked.body.revision,commands:[{type:'smartObject.filters',id:instance.id,filters:[]}]})).status).toBe(400);
});

it('applies median denoise through REST with strict parameters, atomic rollback, locks and revisions',async()=>{
  const {Document,MedianFilter}=await import('../src/dom'),target=new Document();
  const instance=target.placeSmartObject(target.defineComponent(new Document({width:16,height:16})));
  const created=await request('/documents',{width:32,height:16}),path=`/documents/${created.body.document.id}`;
  const added=await request(path+'/commands',{expectedRevision:0,commands:[
    {type:'component.set',definition:target.toJSON().components![0]},{type:'layer.add',layer:instance.toJSON()}]});
  expect(added.status).toBe(200);
  const filter=new MedianFilter({radius:3}).toJSON();
  const changed=await request(path+'/commands',{expectedRevision:added.body.revision,commands:[{type:'smartObject.filters',id:instance.id,filters:[filter]}]});
  expect(changed.status,JSON.stringify(changed.body)).toBe(200);expect(changed.body.document.schemaVersion).toBe(40);
  expect(changed.body.document.children[0].smartFilters).toEqual([filter]);expect(changed.body.document.components).toEqual(added.body.document.components);
  for(const bad of [{...filter,radius:1.5},{...filter,radius:33},{...filter,radius:null},{...filter,extra:true}]){
    const invalid=await request(path+'/commands',{expectedRevision:changed.body.revision,commands:[{type:'document.rename',name:'Uncommitted'},
      {type:'smartObject.filters',id:instance.id,filters:[bad]}]});
    expect(invalid.status).toBe(400);expect((await request(path)).body.document).toEqual(changed.body.document);
  }
  expect((await request(path+'/commands',{expectedRevision:added.body.revision,commands:[{type:'smartObject.filters',id:instance.id,filters:[]}]})).status).toBe(409);
  const undone=await request(path+'/undo',{expectedRevision:changed.body.revision});expect(undone.body.document).toEqual(added.body.document);
  const redone=await request(path+'/redo',{expectedRevision:undone.body.revision});expect(redone.body.document).toEqual(changed.body.document);
  const locked=await request(path+'/commands',{expectedRevision:redone.body.revision,commands:[{type:'layer.update',id:instance.id,patch:{locked:true}}]});
  expect((await request(path+'/commands',{expectedRevision:locked.body.revision,commands:[{type:'smartObject.filters',id:instance.id,filters:[]}]})).status).toBe(400);
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
  expect(result.body.document.schemaVersion).toBe(40);
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

it('polygon selections use strict shared validation, revision checks and reversible history', async () => {
  const created = await request('/documents', {width:100,height:100});
  const path = `/documents/${created.body.document.id}`;
  const points = [{x:10,y:10},{x:80,y:10},{x:10,y:80}];
  for (const command of [
    {type:'selection.polygon',points:points.slice(0,2)},
    {type:'selection.polygon',points,operation:'union'},
    {type:'selection.polygon',points,extra:true},
    {type:'selection.polygon',points:[{x:1,y:1},{x:2,y:2},{x:3,y:3}]},
  ]) {
    expect((await request(path+'/commands',{expectedRevision:0,commands:[command]})).status).toBe(400);
    expect((await request(path)).body.revision).toBe(0);
  }
  const applied = await request(path+'/commands', {expectedRevision:0,commands:[{type:'selection.polygon',points}]});
  expect(applied.status).toBe(200);
  expect(applied.body.document.selection.regions[0]).toMatchObject({shape:'pixels',x:10,y:10,width:70,height:70});
  expect((await request(path+'/commands',{expectedRevision:0,commands:[{type:'selection.polygon',points,operation:'subtract'}]})).status).toBe(409);
  const undo = await request(path+'/undo',{expectedRevision:applied.body.revision});
  expect(undo.body.document).toEqual(created.body.document);
  const redo = await request(path+'/redo',{expectedRevision:undo.body.revision});
  expect(redo.body.document).toEqual(applied.body.document);
});

it('worker-backed selection modification validates options and commits once with revision protection',async()=>{
  const created=await request('/documents',{width:32,height:32});
  const path=`/documents/${created.body.document.id}`;
  const missing=await request(path+'/selection-modify',{expectedRevision:0,operation:'expand',radius:1});
  expect(missing.status).toBe(400);
  const selected=await request(path+'/commands',{expectedRevision:0,commands:[{type:'selection.set',selection:new MarqueeSelection({shape:'rectangle',x:10,y:10,width:8,height:8}).toJSON()}]});
  for(const options of [{operation:'expand',radius:0},{operation:'grow',radius:2},{operation:'feather',radius:129},{operation:'expand',radius:2,extra:true}]) {
    expect((await request(path+'/selection-modify',{expectedRevision:selected.body.revision,...options})).status).toBe(400);
    expect((await request(path)).body.revision).toBe(selected.body.revision);
  }
  expect((await request(path+'/selection-modify',{expectedRevision:0,operation:'expand',radius:1})).status).toBe(409);
  const expanded=await request(path+'/selection-modify',{expectedRevision:selected.body.revision,operation:'expand',radius:2});
  expect(expanded.status,JSON.stringify(expanded.body)).toBe(200);
  expect(expanded.body.revision).toBe(selected.body.revision+1);
  expect(expanded.body.document.selection.regions[0]).toMatchObject({shape:'pixels',x:8,y:8,width:12,height:12});
  const undo=await request(path+'/undo',{expectedRevision:expanded.body.revision});
  expect(undo.body.document).toEqual(selected.body.document);
  const redo=await request(path+'/redo',{expectedRevision:undo.body.revision});
  expect(redo.body.document).toEqual(expanded.body.document);
});

it('REST revision conflicts protect the document during asynchronous selection requests',async()=>{
  const created=await request('/documents',{width:2000,height:1500});
  const path=`/documents/${created.body.document.id}`;
  const selected=await request(path+'/commands',{expectedRevision:0,commands:[{type:'selection.set',selection:new MarqueeSelection({shape:'rectangle',x:0,y:0,width:2000,height:1500}).toJSON()}]});
  const pending=request(path+'/selection-modify',{expectedRevision:selected.body.revision,operation:'expand',radius:32});
  // Exercise racing requests; browser progress tests separately prove stale results after work starts.
  const renamed=await request(path+'/commands',{expectedRevision:selected.body.revision,commands:[{type:'document.rename',name:'Concurrent edit'}]});
  expect(renamed.status).toBe(200);
  const completed=await pending;
  expect(completed.status).toBe(409);
  const current=await request(path);
  expect(current.body.document.name).toBe('Concurrent edit');
  expect(current.body.document.selection).toEqual(selected.body.document.selection);
});

it('Color Balance and Vibrance REST commands share strict parameters, locks, revisions and undo',async()=>{
  const created=await request('/documents',{width:20,height:20});const path=`/documents/${created.body.document.id}`;
  const balance=new AdjustmentLayer({adjustment:{kind:'color-balance',shadows:{red:0,green:0,blue:0},midtones:{red:25,green:-8,blue:12},highlights:{red:0,green:0,blue:0},preserveLuminosity:true}});
  const added=await request(path+'/commands',{expectedRevision:0,commands:[{type:'layer.add',layer:balance.toJSON()}]});
  expect(added.status).toBe(200);expect(added.body.document.schemaVersion).toBe(40);
  const updated=await request(path+'/commands',{expectedRevision:added.body.revision,commands:[{type:'layer.update',id:balance.id,patch:{adjustment:{kind:'vibrance',vibrance:60,saturation:-15}}}]});
  expect(updated.status).toBe(200);expect(updated.body.document.children[0].adjustment).toEqual({kind:'vibrance',vibrance:60,saturation:-15});
  for(const adjustment of [{kind:'vibrance',vibrance:101,saturation:0},{kind:'vibrance',vibrance:0,saturation:0,unknown:true},{...balance.adjustment,midtones:{red:0,green:0}}]){
    expect((await request(path+'/commands',{expectedRevision:updated.body.revision,commands:[{type:'layer.update',id:balance.id,patch:{adjustment}}]})).status).toBe(400);
    expect((await request(path)).body.document).toEqual(updated.body.document);
  }
  expect((await request(path+'/commands',{expectedRevision:0,commands:[{type:'layer.remove',id:balance.id}]})).status).toBe(409);
  const undone=await request(path+'/undo',{expectedRevision:updated.body.revision});expect(undone.body.document).toEqual(added.body.document);
  const redone=await request(path+'/redo',{expectedRevision:undone.body.revision});expect(redone.body.document).toEqual(updated.body.document);
});


it("gradient map REST commands preserve strict stops, revision conflicts and one-entry undo", async () => {
  const created = await request("/documents", {width: 20, height: 20});
  const path = `/documents/${created.body.document.id}`;
  const adjustment = {kind: "gradient-map" as const, reverse: false, stops: [{position: 0, color: "#ff0000"}, {position: 1, color: "#0000ff"}]};
  const layer = new AdjustmentLayer({adjustment});
  const added = await request(path + "/commands", {expectedRevision: 0, commands: [{type: "layer.add", layer: layer.toJSON()}]});
  expect(added.status, JSON.stringify(added.body)).toBe(200); expect(added.body.document.schemaVersion).toBe(40);
  const changed = await request(path + "/commands", {expectedRevision: added.body.revision, commands: [{type: "layer.update", id: layer.id, patch: {adjustment: {...adjustment, reverse: true}}}]});
  expect(changed.status).toBe(200);
  for (const invalid of [{...adjustment, reverse: "yes"}, {...adjustment, stops: [adjustment.stops[0]]}, {...adjustment, stops: [{position: 0, color: "#fff"}, adjustment.stops[1]]}, {...adjustment, stops: adjustment.stops.map(stop => ({...stop, position: .5}))}]) {
    expect((await request(path + "/commands", {expectedRevision: changed.body.revision, commands: [{type: "layer.update", id: layer.id, patch: {adjustment: invalid}}]})).status).toBe(400);
    expect((await request(path)).body.document).toEqual(changed.body.document);
  }
  expect((await request(path + "/commands", {expectedRevision: 0, commands: [{type: "layer.remove", id: layer.id}]})).status).toBe(409);
  const undone = await request(path + "/undo", {expectedRevision: changed.body.revision}); expect(undone.body.document).toEqual(added.body.document);
  const redone = await request(path + "/redo", {expectedRevision: undone.body.revision}); expect(redone.body.document).toEqual(changed.body.document);
});


it("White Balance REST commands share strict parameters, revisions, locks and atomic undo", async () => {
  const created=await request('/documents',{width:20,height:20}),path=`/documents/${created.body.document.id}`;
  const adjustment={kind:'white-balance' as const,temperature:9000,tint:12},layer=new AdjustmentLayer({adjustment});
  const added=await request(path+'/commands',{expectedRevision:0,commands:[{type:'layer.add',layer:layer.toJSON()}]});
  expect(added.status,JSON.stringify(added.body)).toBe(200);expect(added.body.document.schemaVersion).toBe(40);
  for(const adjustment of [{kind:'white-balance',temperature:1999,tint:0},{kind:'white-balance',temperature:6504,tint:101},{kind:'white-balance',temperature:6504},{kind:'white-balance',temperature:6504,tint:0,extra:true}]) {
    expect((await request(path+'/commands',{expectedRevision:added.body.revision,commands:[{type:'layer.update',id:layer.id,patch:{adjustment}}]})).status).toBe(400);
    expect((await request(path)).body.document).toEqual(added.body.document);
  }
  const updated=await request(path+'/commands',{expectedRevision:added.body.revision,commands:[{type:'layer.update',id:layer.id,patch:{adjustment:{kind:'white-balance',temperature:2856,tint:-20}}}]});
  expect(updated.status).toBe(200);
  expect((await request(path+'/commands',{expectedRevision:0,commands:[{type:'layer.remove',id:layer.id}]})).status).toBe(409);
  const undo=await request(path+'/undo',{expectedRevision:updated.body.revision});expect(undo.body.document).toEqual(added.body.document);
  const redo=await request(path+'/redo',{expectedRevision:undo.body.revision});expect(redo.body.document).toEqual(updated.body.document);
  const locked=await request(path+'/commands',{expectedRevision:redo.body.revision,commands:[{type:'layer.update',id:layer.id,patch:{locked:true}}]});
  expect((await request(path+'/commands',{expectedRevision:locked.body.revision,commands:[{type:'layer.update',id:layer.id,patch:{adjustment}}]})).status).toBe(400);
});


it("LUT REST commands retain portable tables with strict validation, locks, revisions and undo", async () => {
  const created=await request('/documents',{width:20,height:20}),path=`/documents/${created.body.document.id}`;
  const lut=parseCubeLut('LUT_1D_SIZE 2\n0 0 0\n1 1 1');
  const adjustment={kind:'lut' as const,lut,amount:75,interpolation:'tetrahedral' as const},layer=new AdjustmentLayer({adjustment});
  const added=await request(path+'/commands',{expectedRevision:0,commands:[{type:'layer.add',layer:layer.toJSON()}]});
  expect(added.status,JSON.stringify(added.body)).toBe(200);expect(added.body.document.schemaVersion).toBe(40);
  for(const invalid of [{...adjustment,amount:101},{...adjustment,interpolation:'nearest'},{...adjustment,lut:{...lut,data:'AAAA'}},{...adjustment,lut:{...lut,domainMax:[0,1,1]}},{...adjustment,extra:true}]) {
    expect((await request(path+'/commands',{expectedRevision:added.body.revision,commands:[{type:'layer.update',id:layer.id,patch:{adjustment:invalid}}]})).status).toBe(400);
    expect((await request(path)).body.document).toEqual(added.body.document);
  }
  const updated=await request(path+'/commands',{expectedRevision:added.body.revision,commands:[{type:'layer.update',id:layer.id,patch:{adjustment:{...adjustment,amount:25,interpolation:'trilinear'}}}]});
  expect(updated.status).toBe(200);expect(updated.body.document.children[0].adjustment.lut).toEqual(lut);
  expect((await request(path+'/commands',{expectedRevision:0,commands:[{type:'layer.remove',id:layer.id}]})).status).toBe(409);
  const undo=await request(path+'/undo',{expectedRevision:updated.body.revision});expect(undo.body.document).toEqual(added.body.document);
  const redo=await request(path+'/redo',{expectedRevision:undo.body.revision});expect(redo.body.document).toEqual(updated.body.document);
  const locked=await request(path+'/commands',{expectedRevision:redo.body.revision,commands:[{type:'layer.update',id:layer.id,patch:{locked:true}}]});
  expect((await request(path+'/commands',{expectedRevision:locked.body.revision,commands:[{type:'layer.update',id:layer.id,patch:{adjustment}}]})).status).toBe(400);
});

it('vector stroke REST commands validate styles, revisions, ancestor locks and one undo',async()=>{
 const created=await request('/documents',{width:160,height:128}),endpoint=`/documents/${created.body.document.id}`,group=new LayerGroup(),layer=group.layers.add(new VectorLayer()),path=layer.paths.add(VectorPath.fromSvgPath('M24 112L64 16L104 112',{fill:null,stroke:'#ff0000',strokeWidth:16}));
 const added=await request(endpoint+'/commands',{expectedRevision:0,commands:[{type:'layer.add',layer:group.toJSON()}]});expect(added.status).toBe(200);
 const styles={strokeCap:'square',strokeJoin:'miter',strokeMiterLimit:12,strokeDashArray:[16,8,4],strokeDashOffset:-7},updated=await request(endpoint+'/commands',{expectedRevision:added.body.revision,commands:[{type:'path.update',id:layer.id,pathId:path.id,patch:styles}]});expect(updated.status,JSON.stringify(updated.body)).toBe(200);expect(updated.body.document.schemaVersion).toBe(40);expect(updated.body.document.children[0].children[0].paths[0]).toMatchObject(styles);
 for(const patch of [{strokeCap:'triangle'},{strokeJoin:'arcs'},{strokeMiterLimit:.5},{strokeDashArray:[-1,4]},{strokeDashArray:Array(257).fill(1)},{strokeDashOffset:'7'},{unknown:true}]){expect((await request(endpoint+'/commands',{expectedRevision:updated.body.revision,commands:[{type:'path.update',id:layer.id,pathId:path.id,patch}]})).status).toBe(400);expect((await request(endpoint)).body.document).toEqual(updated.body.document);}
 expect((await request(endpoint+'/commands',{expectedRevision:0,commands:[{type:'path.update',id:layer.id,pathId:path.id,patch:{strokeCap:'butt'}}]})).status).toBe(409);
 const undo=await request(endpoint+'/undo',{expectedRevision:updated.body.revision});expect(undo.body.document).toEqual(added.body.document);const redo=await request(endpoint+'/redo',{expectedRevision:undo.body.revision});expect(redo.body.document).toEqual(updated.body.document);const locked=await request(endpoint+'/commands',{expectedRevision:redo.body.revision,commands:[{type:'layer.update',id:group.id,patch:{locked:true}}]});expect((await request(endpoint+'/commands',{expectedRevision:locked.body.revision,commands:[{type:'path.update',id:layer.id,pathId:path.id,patch:{strokeDashArray:[]}}]})).status).toBe(400);
});

it('vector gradient REST commands retain editable nested paint, reject invalid stops and share undo/revision/locks',async()=>{
 const created=await request('/documents',{width:160,height:128}),endpoint=`/documents/${created.body.document.id}`,group=new LayerGroup(),layer=group.layers.add(new VectorLayer()),p=layer.paths.add(VectorPath.rectangle({x:16,y:16,width:128,height:96},0,{fill:'#ff0000',stroke:null}));
 const added=await request(endpoint+'/commands',{expectedRevision:0,commands:[{type:'layer.add',layer:group.toJSON()}]});
 const fillGradient={kind:'linear',start:{x:16,y:64},end:{x:144,y:64},stops:[{position:0,color:'#ff0000'},{position:1,color:'#0000ff',opacity:.5}]},updated=await request(endpoint+'/commands',{expectedRevision:added.body.revision,commands:[{type:'path.update',id:layer.id,pathId:p.id,patch:{fillGradient}}]});expect(updated.status,JSON.stringify(updated.body)).toBe(200);expect(updated.body.document.schemaVersion).toBe(40);expect(updated.body.document.children[0].children[0].paths[0].fillGradient).toEqual(fillGradient);
 for(const invalid of [{...fillGradient,stops:[]},{...fillGradient,stops:[{position:1,color:'#ff0000'},{position:0,color:'#0000ff'}]},{...fillGradient,start:{x:Infinity,y:0}},{...fillGradient,transform:{a:0,b:0,c:0,d:0,e:0,f:0}}]){expect((await request(endpoint+'/commands',{expectedRevision:updated.body.revision,commands:[{type:'path.update',id:layer.id,pathId:p.id,patch:{fillGradient:invalid}}]})).status).toBe(400);expect((await request(endpoint)).body.document).toEqual(updated.body.document);}
 expect((await request(endpoint+'/commands',{expectedRevision:0,commands:[{type:'path.update',id:layer.id,pathId:p.id,patch:{fillGradient:null}}]})).status).toBe(409);const undo=await request(endpoint+'/undo',{expectedRevision:updated.body.revision});expect(undo.body.document).toEqual(added.body.document);const redo=await request(endpoint+'/redo',{expectedRevision:undo.body.revision});expect(redo.body.document).toEqual(updated.body.document);const locked=await request(endpoint+'/commands',{expectedRevision:redo.body.revision,commands:[{type:'layer.update',id:group.id,patch:{locked:true}}]});expect((await request(endpoint+'/commands',{expectedRevision:locked.body.revision,commands:[{type:'path.update',id:layer.id,pathId:p.id,patch:{fillGradient:null}}]})).status).toBe(400);
});

it('compound path REST edits retain all contours atomically through revision checks, undo and ancestor locks',async()=>{
 const created=await request('/documents',{width:160,height:128}),endpoint=`/documents/${created.body.document.id}`,group=new LayerGroup(),layer=group.layers.add(new VectorLayer()),p=layer.paths.add(VectorPath.rectangle({x:8,y:8,width:144,height:112},0,{fill:'#ff0000',stroke:null})),hole=new VectorContour({points:VectorPath.rectangle({x:40,y:40,width:80,height:48}).points});
 const added=await request(endpoint+'/commands',{expectedRevision:0,commands:[{type:'layer.add',layer:group.toJSON()}]}),patch={fillRule:'evenodd',subpaths:[hole.toJSON()]},updated=await request(endpoint+'/commands',{expectedRevision:added.body.revision,commands:[{type:'path.update',id:layer.id,pathId:p.id,patch}]});expect(updated.status,JSON.stringify(updated.body)).toBe(200);expect(updated.body.document.schemaVersion).toBe(40);expect(updated.body.document.children[0].children[0].paths[0]).toMatchObject(patch);
 for(const invalid of [{closed:false},{fillRule:'positive'},{subpaths:[{...hole.toJSON(),closed:false}]},{subpaths:[hole.toJSON(),hole.toJSON()]},{subpaths:[{...hole.toJSON(),points:[]}]}]){const rejected=await request(endpoint+'/commands',{expectedRevision:updated.body.revision,commands:[{type:'path.update',id:layer.id,pathId:p.id,patch:invalid}]});expect(rejected.status).toBe(400);expect((await request(endpoint)).body.document).toEqual(updated.body.document);}
 expect((await request(endpoint+'/commands',{expectedRevision:0,commands:[{type:'path.update',id:layer.id,pathId:p.id,patch:{subpaths:[]}}]})).status).toBe(409);const undo=await request(endpoint+'/undo',{expectedRevision:updated.body.revision});expect(undo.body.document).toEqual(added.body.document);const redo=await request(endpoint+'/redo',{expectedRevision:undo.body.revision});expect(redo.body.document).toEqual(updated.body.document);const locked=await request(endpoint+'/commands',{expectedRevision:redo.body.revision,commands:[{type:'layer.update',id:group.id,patch:{locked:true}}]});expect((await request(endpoint+'/commands',{expectedRevision:locked.body.revision,commands:[{type:'path.update',id:layer.id,pathId:p.id,patch:{subpaths:[]}}]})).status).toBe(400);
});

it('Boolean REST uses real curve workers and one atomic cross-layer replacement with shared revisions/locks/undo',async()=>{
 const created=await request('/documents',{width:160,height:128}),endpoint=`/documents/${created.body.document.id}`,group=new LayerGroup(),a=group.layers.add(new VectorLayer({name:'First'})),b=new VectorLayer({name:'Second'}),first=a.paths.add(VectorPath.rectangle({x:8,y:8,width:144,height:112},0,{fill:'#ed9966',stroke:null})),second=b.paths.add(VectorPath.ellipse({x:40,y:32,width:80,height:64},{stroke:null}));
 const added=await request(endpoint+'/commands',{expectedRevision:0,commands:[{type:'layer.add',layer:group.toJSON()},{type:'layer.add',layer:b.toJSON()}]}),operands=[{layerId:a.id,pathId:first.id},{layerId:b.id,pathId:second.id}],combined=await request(endpoint+'/vector-boolean',{expectedRevision:added.body.revision,operation:'subtract',operands});expect(combined.status,JSON.stringify(combined.body)).toBe(200);expect(combined.body.result).toEqual({layerId:a.id,pathId:first.id});expect(combined.body.document.children).toHaveLength(1);const result=combined.body.document.children[0].children[0].paths[0];expect(result.fill).toBe('#ed9966');expect(result.subpaths).toHaveLength(1);expect(result.subpaths[0].points.some((p:any)=>p.in.x!==p.x||p.in.y!==p.y)).toBe(true);
 const undo=await request(endpoint+'/undo',{expectedRevision:combined.body.revision});expect(undo.body.document).toEqual(added.body.document);const redo=await request(endpoint+'/redo',{expectedRevision:undo.body.revision});expect(redo.body.document).toEqual(combined.body.document);
 expect((await request(endpoint+'/vector-boolean',{expectedRevision:0,operation:'union',operands})).status).toBe(409);const restored=await request(endpoint+'/undo',{expectedRevision:redo.body.revision});
 for(const patch of [{operation:'divide',operands},{operation:'union',operands:[operands[0],operands[0]]},{operation:'union',operands:[operands[0],{layerId:b.id,pathId:'missing'}]}])expect((await request(endpoint+'/vector-boolean',{expectedRevision:restored.body.revision,...patch})).status).toBe(400);
 expect((await request(endpoint)).body.document).toEqual(added.body.document);const locked=await request(endpoint+'/commands',{expectedRevision:restored.body.revision,commands:[{type:'layer.update',id:group.id,patch:{locked:true}}]});expect((await request(endpoint+'/vector-boolean',{expectedRevision:locked.body.revision,operation:'union',operands})).status).toBe(400);expect((await request(endpoint)).body.document).toEqual(locked.body.document);
});

it('Boolean REST preserves concurrent edits and returns empty results without partial operands',async()=>{
 const created=await request('/documents',{width:160,height:128}),endpoint=`/documents/${created.body.document.id}`,layer=new VectorLayer(),a=layer.paths.add(VectorPath.rectangle({x:0,y:0,width:100,height:100})),b=layer.paths.add(VectorPath.rectangle({x:0,y:0,width:100,height:100}));const added=await request(endpoint+'/commands',{expectedRevision:0,commands:[{type:'layer.add',layer:layer.toJSON()}]}),operands=[{layerId:layer.id,pathId:a.id},{layerId:layer.id,pathId:b.id}];
 const pending=request(endpoint+'/vector-boolean',{expectedRevision:added.body.revision,operation:'union',operands});await new Promise(r=>setTimeout(r,20));const renamed=await request(endpoint+'/commands',{expectedRevision:added.body.revision,commands:[{type:'document.rename',name:'Concurrent edit'}]}),stale=await pending;expect(renamed.status).toBe(200);expect(stale.status,JSON.stringify(stale.body)).toBe(409);expect((await request(endpoint)).body.document).toEqual(renamed.body.document);
 const empty=await request(endpoint+'/vector-boolean',{expectedRevision:renamed.body.revision,operation:'exclude',operands});expect(empty.status,JSON.stringify(empty.body)).toBe(200);expect(empty.body.result).toBeNull();expect(empty.body.document.children).toEqual([]);const undo=await request(endpoint+'/undo',{expectedRevision:empty.body.revision});expect(undo.body.document).toEqual(renamed.body.document);
});

it('REST text spacing shares strict validation, atomic undo, conflicts and ancestor locks',async()=>{
 const created=await request('/documents',{width:400,height:120}),endpoint=`/documents/${created.body.document.id}`,group=new LayerGroup(),text=group.layers.add(new TextLayer({text:'AV wide words',fontSize:32})),vector=new VectorLayer();
 const added=await request(endpoint+'/commands',{expectedRevision:0,commands:[{type:'layer.add',layer:group.toJSON()},{type:'layer.add',layer:vector.toJSON()}]});expect(added.status).toBe(200);
 const updated=await request(endpoint+'/commands',{expectedRevision:added.body.revision,commands:[{type:'layer.update',id:text.id,patch:{wordSpacing:18,fontKerning:'none'}}]});expect(updated.status).toBe(200);expect(updated.body.document.schemaVersion).toBe(40);expect(updated.body.document.children[0].children[0]).toMatchObject({wordSpacing:18,fontKerning:'none'});expect(updated.body.document.children[0].children[0].width).toBeGreaterThan(added.body.document.children[0].children[0].width);
 expect((await request(endpoint+'/commands',{expectedRevision:added.body.revision,commands:[{type:'layer.update',id:text.id,patch:{wordSpacing:2}}]})).status).toBe(409);
 for(const command of [{type:'layer.update',id:text.id,patch:{fontKerning:'optical'}},{type:'layer.update',id:text.id,patch:{wordSpacing:501}},{type:'layer.update',id:vector.id,patch:{wordSpacing:2}}])expect((await request(endpoint+'/commands',{expectedRevision:updated.body.revision,commands:[{type:'document.rename',name:'Must roll back'},command]})).status).toBe(400);
 expect((await request(endpoint)).body.document).toEqual(updated.body.document);
 const undo=await request(endpoint+'/undo',{expectedRevision:updated.body.revision});expect(undo.body.document).toEqual(added.body.document);const redo=await request(endpoint+'/redo',{expectedRevision:undo.body.revision});expect(redo.body.document).toEqual(updated.body.document);
 const locked=await request(endpoint+'/commands',{expectedRevision:redo.body.revision,commands:[{type:'layer.update',id:group.id,patch:{locked:true}}]});expect((await request(endpoint+'/commands',{expectedRevision:locked.body.revision,commands:[{type:'layer.update',id:text.id,patch:{fontKerning:'normal'}}]})).status).toBe(400);expect((await request(endpoint)).body.document).toEqual(locked.body.document);
});

it('paragraph REST edits and nullable point reset share strict validation, revisions, locks and atomic undo',async()=>{
 const created=await request('/documents',{width:480,height:320}),endpoint=`/documents/${created.body.document.id}`,group=new LayerGroup(),text=group.layers.add(new TextLayer({text:'One two three four\nFive six',fontSize:20,wrapWidth:120,paragraphSpacing:9,firstLineIndent:12})),vector=group.layers.add(new VectorLayer());
 const added=await request(endpoint+'/commands',{expectedRevision:0,commands:[{type:'layer.add',layer:group.toJSON()}]});expect(added.status).toBe(200);expect(added.body.document.schemaVersion).toBe(40);
 const updated=await request(endpoint+'/commands',{expectedRevision:added.body.revision,commands:[{type:'layer.update',id:text.id,patch:{wrapWidth:90.5,paragraphSpacing:18,firstLineIndent:-8}}]});expect(updated.status,JSON.stringify(updated.body)).toBe(200);expect(updated.body.document.children[0].children[0]).toMatchObject({text:text.text,width:90.5,wrapWidth:90.5,paragraphSpacing:18,firstLineIndent:-8});
 for(const command of [{type:'layer.update',id:text.id,patch:{wrapWidth:0}},{type:'layer.update',id:text.id,patch:{paragraphSpacing:-1}},{type:'layer.update',id:text.id,patch:{firstLineIndent:10001}},{type:'layer.update',id:vector.id,patch:{wrapWidth:100}}]){
  expect((await request(endpoint+'/commands',{expectedRevision:updated.body.revision,commands:[{type:'document.rename',name:'Must roll back'},command]})).status).toBe(400);expect((await request(endpoint)).body.document).toEqual(updated.body.document);
 }
 expect((await request(endpoint+'/commands',{expectedRevision:0,commands:[{type:'layer.update',id:text.id,patch:{wrapWidth:null}}]})).status).toBe(409);
 const undo=await request(endpoint+'/undo',{expectedRevision:updated.body.revision});expect(undo.body.document).toEqual(added.body.document);
 const redo=await request(endpoint+'/redo',{expectedRevision:undo.body.revision});expect(redo.body.document).toEqual(updated.body.document);
 const point=await request(endpoint+'/commands',{expectedRevision:redo.body.revision,commands:[{type:'layer.update',id:text.id,patch:{wrapWidth:null,paragraphSpacing:0,firstLineIndent:0}}]});expect(point.status).toBe(200);expect(point.body.document.children[0].children[0]).toMatchObject({wrapWidth:null,paragraphSpacing:0,firstLineIndent:0,text:text.text});expect(point.body.document.children[0].children[0].width).not.toBe(90.5);
 const locked=await request(endpoint+'/commands',{expectedRevision:point.body.revision,commands:[{type:'layer.update',id:group.id,patch:{locked:true}}]});expect((await request(endpoint+'/commands',{expectedRevision:locked.body.revision,commands:[{type:'layer.update',id:text.id,patch:{wrapWidth:100}}]})).status).toBe(400);expect((await request(endpoint)).body.document).toEqual(locked.body.document);
});

it('paragraph justification REST batches retain strict schema, atomic rollback, revisions and undo',async()=>{
 const created=await request('/documents',{width:480,height:320}),endpoint=`/documents/${created.body.document.id}`,group=new LayerGroup(),text=group.layers.add(new TextLayer({text:'One two three four five',wrapWidth:120})),vector=group.layers.add(new VectorLayer());
 const added=await request(endpoint+'/commands',{expectedRevision:0,commands:[{type:'layer.add',layer:group.toJSON()}]});expect(added.status).toBe(200);
 const updated=await request(endpoint+'/commands',{expectedRevision:added.body.revision,commands:[{type:'layer.update',id:text.id,patch:{paragraphJustify:'inter-word'}}]});expect(updated.status,JSON.stringify(updated.body)).toBe(200);expect(updated.body.document.schemaVersion).toBe(40);expect(updated.body.document.children[0].children[0]).toMatchObject({paragraphJustify:'inter-word',wrapWidth:120,text:text.text});
 for(const command of [{type:'layer.update',id:text.id,patch:{paragraphJustify:true}},{type:'layer.update',id:text.id,patch:{paragraphJustify:'all'}},{type:'layer.update',id:vector.id,patch:{paragraphJustify:'none'}}]){expect((await request(endpoint+'/commands',{expectedRevision:updated.body.revision,commands:[{type:'document.rename',name:'Must roll back'},command]})).status).toBe(400);expect((await request(endpoint)).body.document).toEqual(updated.body.document);}
 expect((await request(endpoint+'/commands',{expectedRevision:0,commands:[{type:'layer.update',id:text.id,patch:{paragraphJustify:'none'}}]})).status).toBe(409);
 const undo=await request(endpoint+'/undo',{expectedRevision:updated.body.revision});expect(undo.body.document).toEqual(added.body.document);const redo=await request(endpoint+'/redo',{expectedRevision:undo.body.revision});expect(redo.body.document).toEqual(updated.body.document);
 const locked=await request(endpoint+'/commands',{expectedRevision:redo.body.revision,commands:[{type:'layer.update',id:group.id,patch:{locked:true}}]});expect((await request(endpoint+'/commands',{expectedRevision:locked.body.revision,commands:[{type:'layer.update',id:text.id,patch:{paragraphJustify:'none'}}]})).status).toBe(400);expect((await request(endpoint)).body.document).toEqual(locked.body.document);
});

it('commits serialized tip and spherical tilt atomically through REST with revisions, locks, tonal options and undo',async()=>{
 const created=await request('/documents',{width:64,height:64}),endpoint=`/documents/${created.body.document.id}`,paint=new PaintLayer(),tip={roundness:.25,angle:30,tiltAngle:true},point={x:20,y:20,pressure:.5,tilt:{altitude:Math.PI/4,azimuth:Math.PI/2}},stroke=new BrushStroke({points:[point],tip}).toJSON();
 const added=await request(endpoint+'/commands',{expectedRevision:0,commands:[{type:'layer.add',layer:paint.toJSON()}]});expect(added.status).toBe(200);
 for(const invalid of [{...stroke,tip:null},{...stroke,tip:{...tip,roundness:0}},{...stroke,tip:{...tip,angle:181}},{...stroke,points:[{...point,tilt:{altitude:-1,azimuth:0}}]},{...stroke,points:[{...point,tilt:{altitude:1,azimuth:0,code:'run'}}]}]){
  expect((await request(endpoint+'/commands',{expectedRevision:added.body.revision,commands:[{type:'document.rename',name:'Must roll back'},{type:'paint.add',id:paint.id,stroke:invalid}]})).status).toBe(400);expect((await request(endpoint)).body.document).toEqual(added.body.document);
 }
 const changed=await request(endpoint+'/commands',{expectedRevision:added.body.revision,commands:[{type:'paint.add',id:paint.id,stroke}]});expect(changed.status,JSON.stringify(changed.body)).toBe(200);expect(changed.body.document.children[0].strokes[0]).toMatchObject({tip,points:[point]});
 expect((await request(endpoint+'/commands',{expectedRevision:added.body.revision,commands:[{type:'paint.add',id:paint.id,stroke}]})).status).toBe(409);
 const undone=await request(endpoint+'/undo',{expectedRevision:changed.body.revision});expect(undone.body.document).toEqual(added.body.document);const redone=await request(endpoint+'/redo',{expectedRevision:undone.body.revision});expect(redone.body.document).toEqual(changed.body.document);
 const tonal=await request(endpoint+'/tonal-sculpt',{expectedRevision:redone.body.revision,path:[point],mode:'dodge',range:'midtones',exposure:.5,options:{tip}});expect(tonal.status,JSON.stringify(tonal.body)).toBe(200);expect(tonal.body.document.children.at(-1).adjustment.strokes[0].brush).toMatchObject({tip,points:[point]});
 const locked=await request(endpoint+'/commands',{expectedRevision:tonal.body.revision,commands:[{type:'layer.update',id:paint.id,patch:{locked:true}}]});expect(locked.status).toBe(200);expect((await request(endpoint+'/commands',{expectedRevision:locked.body.revision,commands:[{type:'paint.add',id:paint.id,stroke}]})).status).toBe(400);
});

it('validates affine symmetry through REST with atomic rollback, revision conflicts, tonal options and undo',async()=>{
 const {BrushSymmetry}=await import('../src/dom'),created=await request('/documents',{width:64,height:64}),endpoint=`/documents/${created.body.document.id}`,paint=new PaintLayer(),symmetry=BrushSymmetry.radial({x:32,y:32},4).toJSON(),stroke=new BrushStroke({points:[{x:10,y:20}],symmetry}).toJSON(),added=await request(endpoint+'/commands',{expectedRevision:0,commands:[{type:'layer.add',layer:paint.toJSON()}]});expect(added.status).toBe(200);
 for(const value of [null,{copies:[]},{copies:[new AffineTransform().toJSON()]},{copies:[new AffineTransform(1,0,0,0).toJSON()]},{...symmetry,code:'run'},{copies:[symmetry.copies[0],symmetry.copies[0]]}]){expect((await request(endpoint+'/commands',{expectedRevision:added.body.revision,commands:[{type:'document.rename',name:'Must not commit'},{type:'paint.add',id:paint.id,stroke:{...stroke,symmetry:value}}]})).status).toBe(400);expect((await request(endpoint)).body.document).toEqual(added.body.document);}
 const changed=await request(endpoint+'/commands',{expectedRevision:added.body.revision,commands:[{type:'paint.add',id:paint.id,stroke}]});expect(changed.status,JSON.stringify(changed.body)).toBe(200);expect(changed.body.document.children[0].strokes[0].symmetry).toEqual(symmetry);expect((await request(endpoint+'/commands',{expectedRevision:added.body.revision,commands:[{type:'paint.add',id:paint.id,stroke}]})).status).toBe(409);const undone=await request(endpoint+'/undo',{expectedRevision:changed.body.revision});expect(undone.body.document).toEqual(added.body.document);const redo=await request(endpoint+'/redo',{expectedRevision:undone.body.revision});expect(redo.body.document).toEqual(changed.body.document);const tonal=await request(endpoint+'/tonal-sculpt',{expectedRevision:redo.body.revision,path:[{x:10,y:20}],mode:'dodge',range:'midtones',exposure:.5,options:{symmetry}});expect(tonal.status,JSON.stringify(tonal.body)).toBe(200);expect(tonal.body.document.children.at(-1).adjustment.strokes[0].brush.symmetry).toEqual(symmetry);
});

it('validates authored texture sources atomically with existing revisions, locks, tonal commands and undo',async()=>{
 const {BrushTexture}=await import('../src/dom'),created=await request('/documents',{width:64,height:64}),endpoint=`/documents/${created.body.document.id}`,paint=new PaintLayer(),added=await request(endpoint+'/commands',{expectedRevision:0,commands:[{type:'layer.add',layer:paint.toJSON()}]});
 const make=(assetId:string)=>new BrushStroke({points:[{x:32,y:32}],texture:new BrushTexture({assetId})}).toJSON();
 const bad=await request(endpoint+'/commands',{expectedRevision:added.body.revision,commands:[{type:'document.rename',name:'Uncommitted'},{type:'paint.add',id:paint.id,stroke:make('missing')}]});expect(bad.status).toBe(400);expect((await request(endpoint)).body.document).toEqual(added.body.document);
 const missingTonal=await request(endpoint+'/tonal-sculpt',{expectedRevision:added.body.revision,path:[{x:32,y:32}],mode:'dodge',range:'midtones',exposure:.5,options:{texture:new BrushTexture({assetId:'missing'}).toJSON()}});expect(missingTonal.status).toBe(400);expect((await request(endpoint)).body.document).toEqual(added.body.document);
 const upload=await request(endpoint+'/assets',{name:'Grain',width:1,height:1,contentType:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='});expect(upload.status).toBe(201);
 const stroke=make(upload.body.asset.id),texture=new BrushTexture({assetId:upload.body.asset.id}).toJSON();
 for(const invalid of [null,{assetId:upload.body.asset.id},{...texture,unknown:true}])expect((await request(endpoint+'/commands',{expectedRevision:added.body.revision,commands:[{type:'paint.add',id:paint.id,stroke:{...stroke,texture:invalid}}]})).status).toBe(400);
 const changed=await request(endpoint+'/commands',{expectedRevision:added.body.revision,commands:[{type:'paint.add',id:paint.id,stroke}]});expect(changed.status,JSON.stringify(changed.body)).toBe(200);expect(changed.body.document.children[0].strokes[0].texture).toEqual(texture);
 expect((await request(endpoint+'/commands',{expectedRevision:added.body.revision,commands:[]})).status).toBe(409);
 const undone=await request(endpoint+'/undo',{expectedRevision:changed.body.revision});expect(undone.body.document).toEqual(added.body.document);const redone=await request(endpoint+'/redo',{expectedRevision:undone.body.revision});expect(redone.body.document).toEqual(changed.body.document);
 const tonal=await request(endpoint+'/tonal-sculpt',{expectedRevision:redone.body.revision,path:[{x:32,y:32}],mode:'dodge',range:'midtones',exposure:.5,options:{texture}});expect(tonal.status,JSON.stringify(tonal.body)).toBe(200);expect(tonal.body.document.children[1].adjustment.strokes[0].brush.texture).toEqual(texture);
 const locked=await request(endpoint+'/commands',{expectedRevision:tonal.body.revision,commands:[{type:'layer.update',id:paint.id,patch:{locked:true}}]});expect(locked.status).toBe(200);expect((await request(endpoint+'/commands',{expectedRevision:locked.body.revision,commands:[{type:'paint.add',id:paint.id,stroke:{...stroke,id:'locked-grain'}}]})).status).toBe(400);
});

it('REST red-eye values and masks share strict batches, revisions, locks and one-step undo', async () => {
  const {RedEyeAdjustment}=await import('../src/dom');
  const created=await request('/documents',{width:64,height:32}),endpoint=`/documents/${created.body.document.id}`;
  const layer=new AdjustmentLayer({adjustment:new RedEyeAdjustment({threshold:32.5,strength:75})});
  layer.mask=new LayerMask({selection:new MarqueeSelection({shape:'ellipse',x:4,y:6,width:8,height:8})});
  const added=await request(endpoint+'/commands',{expectedRevision:0,commands:[{type:'layer.add',layer:layer.toJSON()}]});
  expect(added.status).toBe(200);expect(added.body.document.schemaVersion).toBe(40);
  expect(added.body.document.children[0].adjustment).toEqual(layer.adjustment);
  for(const adjustment of [{kind:'red-eye',threshold:32,strength:null},{kind:'red-eye',threshold:-1,strength:100},{...layer.adjustment,extra:1}]){
    const bad=await request(endpoint+'/commands',{expectedRevision:added.body.revision,commands:[{type:'document.rename',name:'Uncommitted'},{type:'layer.update',id:layer.id,patch:{adjustment}}]});
    expect(bad.status).toBe(400);expect((await request(endpoint)).body.document).toEqual(added.body.document);
  }
  const changed=await request(endpoint+'/commands',{expectedRevision:added.body.revision,commands:[{type:'layer.update',id:layer.id,patch:{adjustment:new RedEyeAdjustment({strength:50}).toJSON()}}]});expect(changed.status).toBe(200);
  expect((await request(endpoint+'/commands',{expectedRevision:added.body.revision,commands:[{type:'document.rename',name:'Stale'}]})).status).toBe(409);
  const undo=await request(endpoint+'/undo',{expectedRevision:changed.body.revision});expect(undo.body.document).toEqual(added.body.document);
  const redo=await request(endpoint+'/redo',{expectedRevision:undo.body.revision});expect(redo.body.document).toEqual(changed.body.document);
  const locked=await request(endpoint+'/commands',{expectedRevision:redo.body.revision,commands:[{type:'layer.update',id:layer.id,patch:{locked:true}}]});
  const denied=await request(endpoint+'/commands',{expectedRevision:locked.body.revision,commands:[{type:'layer.update',id:layer.id,patch:{adjustment:layer.adjustment}}]});expect(denied.status).toBe(400);
  expect((await request(endpoint)).body.document).toEqual(locked.body.document);
});

it('REST frequency primitives share prepared assets, atomic commands, phase validation, revisions and undo',async()=>{
 const {Document,RasterLayer,SmartObjectLayer,DocumentToneFilter,NativeCompositionFilter}=await import('../src/dom'),{PngRowEncoder}=await import('../src/core/png-stream'),{allLayers}=await import('../src/core/model');
 const created=await request('/documents',{width:16,height:8}),endpoint=`/documents/${created.body.document.id}`,png=new PngRowEncoder(4,2);await png.append(new Uint8Array(4*2*4).fill(255),2);const blob=await png.finish();
 const upload=await request(endpoint+'/assets',{name:'Prepared native source',width:4,height:2,contentType:'image/png',data:Buffer.from(await blob.arrayBuffer()).toString('base64')});expect(upload.status).toBe(201);
 const source=new RasterLayer({name:'Original',assetId:upload.body.asset.id,width:4,height:2}),snapshot=new RasterLayer({name:'Native capture',assetId:upload.body.asset.id,width:4,height:2});
 const added=await request(endpoint+'/commands',{expectedRevision:0,commands:[{type:'layer.add',layer:source.toJSON()},{type:'layer.add',layer:snapshot.toJSON()}]});expect(added.status).toBe(200);
 const draft=Document.fromJSON(added.body.document),commands:unknown[]=[];draft.onCommand(command=>commands.push(command));const group=draft.createFrequencySeparation(draft.getLayer(source.id) as InstanceType<typeof RasterLayer>,draft.getLayer(snapshot.id) as InstanceType<typeof RasterLayer>,{sigma:1});
 const changed=await request(endpoint+'/commands',{expectedRevision:added.body.revision,commands});expect(changed.status,JSON.stringify(changed.body)).toBe(200);expect(changed.body.document).toEqual(draft.toJSON());expect(changed.body.document.schemaVersion).toBe(40);
 const instance=draft.getLayer(allLayers([group.toJSON()]).find(layer=>layer.kind==='smart-object')!.id) as InstanceType<typeof SmartObjectLayer>;
 for(const filters of [[new DocumentToneFilter().toJSON(),new NativeCompositionFilter().toJSON()],[{id:'invalid',kind:'frequency-band',enabled:true,sigma:1,band:'middle'}]]){
  const bad=await request(endpoint+'/commands',{expectedRevision:changed.body.revision,commands:[{type:'document.rename',name:'Uncommitted'},{type:'smartObject.filters',id:instance.id,filters}]});expect(bad.status).toBe(400);expect((await request(endpoint)).body.document).toEqual(changed.body.document);
 }
 expect((await request(endpoint+'/commands',{expectedRevision:added.body.revision,commands:[]})).status).toBe(409);
 const undo=await request(endpoint+'/undo',{expectedRevision:changed.body.revision});expect(undo.body.document).toEqual(added.body.document);
 const redo=await request(endpoint+'/redo',{expectedRevision:undo.body.revision});expect(redo.body.document).toEqual(changed.body.document);
 const locked=await request(endpoint+'/commands',{expectedRevision:redo.body.revision,commands:[{type:'layer.update',id:group.id,patch:{locked:true}}]});expect(locked.status).toBe(200);
 const denied=await request(endpoint+'/commands',{expectedRevision:locked.body.revision,commands:[{type:'smartObject.filters',id:instance.id,filters:[]}]});expect(denied.status).toBe(400);expect((await request(endpoint)).body.document).toEqual(locked.body.document);
});

it('REST shared frequency radii use group-only validation, protected children, revision guards and one undo',async()=>{
 const created=await request('/documents',{width:32,height:16}),endpoint=`/documents/${created.body.document.id}`,group=new LayerGroup({frequencyRadius:2}),child=new PaintLayer({locked:true}),plain=new PaintLayer();group.layers.add(child);
 const added=await request(endpoint+'/commands',{expectedRevision:0,commands:[{type:'layer.add',layer:group.toJSON()},{type:'layer.add',layer:plain.toJSON()}]});expect(added.status).toBe(200);
 for(const frequencyRadius of [-1,1400,'3',false,{}]){
  const bad=await request(endpoint+'/commands',{expectedRevision:added.body.revision,commands:[{type:'document.rename',name:'Uncommitted'},{type:'layer.update',id:group.id,patch:{frequencyRadius}}]});expect(bad.status).toBe(400);expect((await request(endpoint)).body.document).toEqual(added.body.document);
 }
 expect((await request(endpoint+'/commands',{expectedRevision:added.body.revision,commands:[{type:'layer.update',id:plain.id,patch:{frequencyRadius:null}}]})).status).toBe(400);
 const changed=await request(endpoint+'/commands',{expectedRevision:added.body.revision,commands:[{type:'layer.update',id:group.id,patch:{frequencyRadius:5}}]});expect(changed.status).toBe(200);expect(changed.body.document.schemaVersion).toBe(40);expect(changed.body.document.children[0]).toMatchObject({frequencyRadius:5,children:[child.toJSON()]});
 expect((await request(endpoint+'/commands',{expectedRevision:added.body.revision,commands:[{type:'layer.update',id:group.id,patch:{frequencyRadius:0}}]})).status).toBe(409);
 const undo=await request(endpoint+'/undo',{expectedRevision:changed.body.revision});expect(undo.body.document).toEqual(added.body.document);const redo=await request(endpoint+'/redo',{expectedRevision:undo.body.revision});expect(redo.body.document).toEqual(changed.body.document);
 const locked=await request(endpoint+'/commands',{expectedRevision:redo.body.revision,commands:[{type:'layer.update',id:group.id,patch:{locked:true}}]});expect((await request(endpoint+'/commands',{expectedRevision:locked.body.revision,commands:[{type:'layer.update',id:group.id,patch:{frequencyRadius:null}}]})).status).toBe(400);expect((await request(endpoint)).body.document).toEqual(locked.body.document);
});
