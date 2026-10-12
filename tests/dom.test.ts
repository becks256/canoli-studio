import { describe, expect, it } from "vitest";
import {
  BlendIf,
  BrushStroke,
  CloneStroke,
  Document,
  LayerGroup,
  MarqueeSelection,
  PaintFill,
  PaintLayer,
  PencilStroke,
  RasterLayer,
  TextLayer,
  ToneAdjustment,
  VectorLayer,
  VectorPath,
} from "../src/dom";
import { createDocumentSchema, parseCommands } from "../src/core/validation";
import { parseProject } from "../src/core/project";
import { layerOrigin } from "../src/core/spatial";
import { referencedAssets } from "../src/core/model";

const image = () =>
  new RasterLayer({ assetId: "original", width: 100, height: 80 });

describe("constructor DOM", () => {
  it("keeps detached ownership and live handles across attach, undo, and redo", () => {
    const document = new Document();
    const group = new LayerGroup();
    const child = group.layers.add(image());
    child.name = "Original";
    document.layers.add(group);
    expect(document.getLayer(child.id)).toBe(child);
    child.x = 42;
    document.undo();
    expect(child.x).toBe(0);
    document.redo();
    expect(child.x).toBe(42);
    expect(() => new Document().layers.add(child)).toThrow(/owner/);
    group.remove();
    expect(() => child.x).toThrow(/revision/);
    document.undo();
    expect(child.x).toBe(42);
  });
  it("commits scripts of constructors as one atomic, reversible operation", () => {
    const document = new Document();
    const child = image();
    document.transaction("Create variation", () => {
      document.layers.add(child);
      child.adjustments.add(new ToneAdjustment({ exposure: 0.5 }));
      child.x = 30;
    });
    expect(document.getSnapshot().past).toHaveLength(1);
    document.undo();
    expect(document.layers.length).toBe(0);
    document.redo();
    expect(child.adjustments.at(0)?.exposure).toBe(0.5);
    const before = document.toJSON();
    expect(() =>
      document.transaction("Invalid", () => {
        child.x = 99;
        child.opacity = 2;
      }),
    ).toThrow();
    expect(document.toJSON()).toEqual(before);
    expect(document.getSnapshot().past).toHaveLength(1);
  });
  it("rejects cycles and honors locked ancestors", () => {
    const document = new Document();
    const root = document.layers.add(new LayerGroup());
    const nested = root.layers.add(new LayerGroup());
    const child = nested.layers.add(image());
    expect(() => root.moveTo(nested)).toThrow(/itself/);
    root.locked = true;
    expect(() => {
      child.x = 4;
    }).toThrow(/Unlock/);
    expect(() => nested.layers.add(image())).toThrow(/Unlock/);
    root.locked = false;
    child.x = 4;
    expect(child.x).toBe(4);
  });
  it("preserves source references on duplication while giving effects independent identities", () => {
    const document = new Document();
    const child = document.layers.add(image());
    child.adjustments.add(new ToneAdjustment({ saturation: -20 }));
    const copy = child.duplicate() as RasterLayer;
    expect(copy.assetId).toBe(child.assetId);
    expect(copy.adjustments.at(0)?.id).not.toBe(child.adjustments.at(0)?.id);
    copy.adjustments.at(0)!.saturation = 40;
    expect(child.adjustments.at(0)?.saturation).toBe(-20);
  });
  it("supports PaintLayer with brush and pencil strokes with undo/redo", () => {
    const document = new Document();
    const paint = document.layers.add(new PaintLayer({ name: "Artwork" }));
    const brush = new BrushStroke({
      size: 15,
      color: "#ff0000",
      opacity: 0.8,
      hardness: 0.5,
      points: [
        { x: 10, y: 10, pressure: 0.5 },
        { x: 20, y: 20, pressure: 1.0 },
      ],
    });
    paint.strokes.add(brush);
    expect(paint.strokes.length).toBe(1);
    expect(paint.strokes.at(0)?.kind).toBe("brush");

    const pencil = new PencilStroke({
      size: 2,
      color: "#00ff00",
      points: [{ x: 5, y: 5, pressure: 1.0 }],
    });
    paint.strokes.add(pencil);
    expect(paint.strokes.length).toBe(2);
    expect(paint.strokes.at(1)).toBeInstanceOf(PencilStroke);

    document.undo();
    expect(paint.strokes.length).toBe(1);
    document.redo();
    expect(paint.strokes.length).toBe(2);
  });
  it("supports PaintLayer with PaintFill operations and undo/redo", () => {
    const document = new Document({ width: 200, height: 100 });
    const paint = document.layers.add(new PaintLayer({ name: "Fill" }));
    const fill = new PaintFill({
      bounds: { x: 0, y: 0, width: 200, height: 100 },
      color: "#ff0000",
      opacity: 0.8,
    });
    paint.strokes.add(fill);
    expect(paint.strokes.length).toBe(1);
    expect(paint.strokes.at(0)?.kind).toBe("fill");
    const storedFill = paint.strokes.at(0);
    expect(storedFill).toBeInstanceOf(PaintFill);
    if (!(storedFill instanceof PaintFill))
      throw new Error("Expected a paint fill");
    expect(storedFill.color).toBe("#ff0000");
    expect(storedFill.opacity).toBe(0.8);

    document.undo();
    expect(paint.strokes.length).toBe(0);
    document.redo();
    expect(paint.strokes.length).toBe(1);
    expect(paint.strokes.at(0)?.kind).toBe("fill");
  });
  it("supports VectorLayer with editable paths, anchor manipulation, and styles", () => {
    const document = new Document();
    const vector = document.layers.add(new VectorLayer({ name: "Curves" }));
    const path = new VectorPath({
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
      ],
      stroke: "#ffffff",
      strokeWidth: 4,
      closed: true,
    });
    vector.paths.add(path);
    expect(vector.paths.length).toBe(1);
    expect(path.closed).toBe(true);

    path.addPoint({ x: 50, y: 150 });
    expect(path.points.length).toBe(3);

    path.strokeWidth = 8;
    expect(path.strokeWidth).toBe(8);

    document.undo();
    expect(path.strokeWidth).toBe(4);
    document.redo();
    expect(path.strokeWidth).toBe(8);
  });
  it("manages layer styles including Blend If, fillOpacity, and drop shadows", () => {
    const document = new Document();
    const layer = document.layers.add(image());
    layer.fillOpacity = 0.75;
    layer.styles.blendIf = new BlendIf({
      enabled: true,
      channel: "luminance",
      source: [20, 40, 220, 240],
      underlying: [0, 0, 255, 255],
    });
    layer.styles.dropShadow = {
      enabled: true,
      color: "#000000",
      blur: 10,
      opacity: 0.5,
      x: 5,
      y: 5,
    };
    expect(layer.fillOpacity).toBe(0.75);
    expect(layer.styles.blendIf.source).toEqual([20, 40, 220, 240]);
    expect(layer.styles.dropShadow.blur).toBe(10);

    document.undo();
    expect(layer.styles.dropShadow.enabled).toBe(false);
    document.redo();
    expect(layer.styles.dropShadow.enabled).toBe(true);
  });
  it("supports document marquee selections", () => {
    const document = new Document();
    const selection = new MarqueeSelection({
      shape: "rectangle",
      x: 10,
      y: 10,
      width: 100,
      height: 80,
    });
    document.selection = selection;
    expect(document.selection?.regions.length).toBe(1);
    expect(document.selection?.regions[0].width).toBe(100);

    document.selection = null;
    expect(document.selection).toBeNull();
    document.undo();
    expect(document.toJSON().selection).toEqual(selection.toJSON());
    expect(Document.fromJSON(document.toJSON()).selection?.toJSON()).toEqual(
      selection.toJSON(),
    );
  });
  it("resizes the document canvas with undo/redo and property setters", () => {
    const document = new Document({ width: 1600, height: 1200 });
    expect(document.width).toBe(1600);
    expect(document.height).toBe(1200);

    document.resize(1920, 1080);
    expect(document.width).toBe(1920);
    expect(document.height).toBe(1080);
    expect(document.toJSON().width).toBe(1920);
    expect(document.toJSON().height).toBe(1080);

    document.undo();
    expect(document.width).toBe(1600);
    expect(document.height).toBe(1200);

    document.redo();
    expect(document.width).toBe(1920);
    expect(document.height).toBe(1080);

    document.width = 2400;
    expect(document.width).toBe(2400);
    expect(document.height).toBe(1080);

    document.height = 1800;
    expect(document.width).toBe(2400);
    expect(document.height).toBe(1800);

    expect(() => document.resize(0, 1000)).toThrow();
    expect(() => document.resize(-500, 1000)).toThrow();
    expect(() => document.resize(1000, 1.5)).toThrow();
    expect(() =>
      parseCommands([{ type: "document.resize", width: 0, height: 1000 }]),
    ).toThrow();
    expect(() =>
      parseCommands([{ type: "document.resize", width: 1000, height: -10 }]),
    ).toThrow();
  });
  it("preserves world position on placement and rejects cycles, locked destinations and invalid ranges", () => {
    const document = new Document(),
      group = document.layers.add(new LayerGroup({ x: 100, y: 30 }));
    const child = document.layers.add(new PaintLayer({ x: 15, y: 20 }));
    child.moveTo(group, { preservePosition: true });
    expect([child.x, child.y]).toEqual([-85, -10]);
    expect(layerOrigin(document.toJSON(), child.id)).toEqual({ x: 15, y: 20 });
    child.moveAfter(group);
    expect([...document.layers].map((l) => l.id)).toEqual([group.id, child.id]);
    document.undo();
    expect(group.layers.at(0)?.id).toBe(child.id);
    expect(() => group.moveAfter(child)).toThrow();
    child.moveAfter(group);
    group.locked = true;
    expect(() => child.moveTo(group)).toThrow(/Unlock/);
    expect(() => new BlendIf({ source: [100, 20, 200, 255] })).toThrow();
    expect(() =>
      parseCommands([
        { type: "layer.update", id: child.id, patch: { fillOpacity: 2 } },
      ]),
    ).toThrow();
  });
  it("keeps path ownership/live handles, independent duplicates, and clone project asset references", () => {
    const document = new Document(),
      vector = document.layers.add(new VectorLayer());
    const path = vector.paths.add(
      new VectorPath({
        points: [
          { x: 1, y: 2 },
          { x: 40, y: 50 },
        ],
      }),
    );
    expect(() => new VectorLayer().paths.add(path)).toThrow();
    const copy = vector.duplicate() as VectorLayer;
    expect(copy.paths.at(0)?.id).not.toBe(path.id);
    copy.paths.at(0)!.stroke = "#ff0000";
    expect(path.stroke).toBe("#d5e79b");
    path.remove();
    expect(() => path.points).toThrow();
    document.undo();
    expect(path.points).toHaveLength(2);
    const paint = document.layers.add(new PaintLayer());
    paint.strokes.add(
      new CloneStroke({
        points: [{ x: 1, y: 2 }],
        tiles: [{ assetId: "tile", x: 0, y: 0, width: 10, height: 10 }],
      }),
    );
    expect([...referencedAssets(document.toJSON())]).toEqual(["tile"]);
    const project = {
      format: "luma",
      version: 1,
      document: document.toJSON(),
      assets: [] as unknown[],
    };
    expect(() => parseProject(JSON.stringify(project))).toThrow(/Missing/);
    project.assets = [
      {
        id: "tile",
        name: "Tile",
        width: 10,
        height: 10,
        dataUrl: "data:image/png;base64,AAAA",
      },
    ];
    expect(parseProject(JSON.stringify(project)).document).toEqual(
      document.toJSON(),
    );
  });
});

describe("image resolution is not a product limit", () => {
  it.each([
    [10000, 5000],
    [40000, 6000],
    [100000, 100000],
  ])(
    "accepts %i × %i in constructors, REST schema, and project metadata",
    (width, height) => {
      const options = createDocumentSchema.parse({ width, height });
      const document = new Document(options);
      document.layers.add(
        new RasterLayer({
          assetId: "full-resolution",
          width,
          height,
          x: 35000,
        }),
      );
      const project = parseProject(
        JSON.stringify({
          format: "luma",
          version: 1,
          document: document.toJSON(),
          assets: [
            {
              id: "full-resolution",
              name: "Source",
              width,
              height,
              dataUrl: "data:image/png;base64,AAAA",
            },
          ],
        }),
      );
      expect(project.document.width).toBe(width);
      expect(project.document.height).toBe(height);
    },
  );
  it("still rejects malformed dimensions and untrusted mutation properties", () => {
    for (const width of [
      0,
      -1,
      NaN,
      Infinity,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
    ])
      expect(() => new Document({ width })).toThrow();
    expect(() =>
      parseCommands([
        { type: "layer.update", id: "a", patch: { assetId: "replace-source" } },
      ]),
    ).toThrow();
    expect(() =>
      parseCommands([{ type: "run.javascript", code: "whatever" }]),
    ).toThrow();
  });
  it("supports text layers with live mutations, bounds recalculation, and undo/redo", () => {
    const document = new Document();
    const textLayer = new TextLayer({
      name: "Greeting",
      text: "Hello World",
      fontSize: 48,
      color: "#ff0000",
      align: "center",
    });
    expect(textLayer.name).toBe("Greeting");
    expect(textLayer.text).toBe("Hello World");
    expect(textLayer.fontSize).toBe(48);
    expect(textLayer.color).toBe("#ff0000");
    expect(textLayer.align).toBe("center");
    expect(textLayer.width).toBeGreaterThan(0);
    expect(textLayer.height).toBeGreaterThan(0);

    const initialWidth = textLayer.width;

    // Attach to document
    document.layers.add(textLayer);
    expect(document.layers.length).toBe(1);
    expect(document.getLayer(textLayer.id)).toBe(textLayer);

    // Mutate text and properties
    textLayer.text = "Hello World with longer text content";
    expect(textLayer.text).toBe("Hello World with longer text content");
    expect(textLayer.width).toBeGreaterThan(initialWidth);

    textLayer.fontSize = 64;
    expect(textLayer.fontSize).toBe(64);

    textLayer.color = "#00ff00";
    expect(textLayer.color).toBe("#00ff00");

    textLayer.align = "right";
    expect(textLayer.align).toBe("right");

    textLayer.lineHeight = 1.5;
    expect(textLayer.lineHeight).toBe(1.5);

    // Undo line height
    document.undo();
    expect(textLayer.lineHeight).toBe(1.2);

    // Undo align
    document.undo();
    expect(textLayer.align).toBe("center");

    // Undo color
    document.undo();
    expect(textLayer.color).toBe("#ff0000");

    // Undo fontSize
    document.undo();
    expect(textLayer.fontSize).toBe(48);

    // Undo text
    document.undo();
    expect(textLayer.text).toBe("Hello World");
    expect(textLayer.width).toBe(initialWidth);

    // Redo all
    document.redo();
    expect(textLayer.text).toBe("Hello World with longer text content");
    document.redo();
    expect(textLayer.fontSize).toBe(64);

    // Duplicate text layer
    const duplicate = textLayer.duplicate();
    expect(duplicate).toBeInstanceOf(TextLayer);
    expect((duplicate as TextLayer).text).toBe(textLayer.text);
    expect((duplicate as TextLayer).fontSize).toBe(64);
    expect(duplicate.id).not.toBe(textLayer.id);
  });
});

it('transactions retain unchanged drawing data and leave earlier stages stable',()=>{
 const document=new Document();
 const first=document.layers.add(new PaintLayer()),second=document.layers.add(new PaintLayer());
 first.strokes.add(new BrushStroke({points:[{x:0,y:0},{x:100,y:80}],size:20}));
 const before=document.getSnapshot(),strokes=(before.document.children[0] as import('../src/core/model').PaintLayerData).strokes;
 document.transaction('Move two layers',()=>{
  first.x=10;
  const earlier=document._read();
  second.y=20;
  const later=document._read();
  expect((later.children[0] as import('../src/core/model').PaintLayerData).strokes).toBe(strokes);
  expect(earlier.children[1].y).toBe(0);
  expect(later.children[1].y).toBe(20);
  expect(document.getSnapshot().document).toBe(before.document);
 });
 expect(document.getSnapshot().past.length).toBe(before.past.length+1);
 document.undo();expect(document.toJSON()).toEqual(before.document);
 document.redo();expect([first.x,second.y]).toEqual([10,20]);
 const committed=document.toJSON();
 expect(()=>document.transaction('Rollback',()=>{first.x=50;second.opacity=2;})).toThrow();
 expect(document.toJSON()).toEqual(committed);
});


it("fromJSON owns nested data without freezing or modifying the source", () => {
  const original = new Document();
  const layer = original.layers.add(new PaintLayer());
  layer.strokes.add(new BrushStroke({size:8,points:[{x:10,y:20,pressure:1}]}));
  const data = original.toJSON();
  const restored = Document.fromJSON(data);
  const expected = restored.toJSON();
  const sourceLayer = data.children[0];
  if (sourceLayer.kind !== "paint" || sourceLayer.strokes[0].kind !== "brush") throw Error("fixture");
  expect(Object.isFrozen(sourceLayer.strokes[0].points[0])).toBe(false);
  sourceLayer.strokes[0].points[0].x = 999;
  sourceLayer.strokes[0].size = 200;
  sourceLayer.name = "External change";
  expect(restored.toJSON()).toEqual(expected);
  restored.layers.at(0)!.name = "Owned edit";
  restored.undo();
  expect(restored.toJSON()).toEqual(expected);
  expect(sourceLayer.name).toBe("External change");
  expect(() => Document.fromJSON({...data,children:[{...sourceLayer,
    strokes:[{...sourceLayer.strokes[0],size:-1}],
  }]})).toThrow();
  expect(restored.selectedLayer).toBeNull();
});

it("fromJSON validates legacy metadata before migration and leaves its version intact", () => {
  const data = new Document().toJSON();
  data.schemaVersion = 1;
  const restored = Document.fromJSON(data);
  expect(data.schemaVersion).toBe(1);
  expect(restored.toJSON().schemaVersion).toBe(new Document().toJSON().schemaVersion);
  expect(restored.getSnapshot().past).toHaveLength(0);
  expect(() => Document.fromJSON({...data,width:0})).toThrow();
  expect(() => Document.fromJSON({...data,schemaVersion:999})).toThrow();
  expect(() => Document.fromJSON({...data,guides:[]})).toThrow(/guides/);
});

it("restored layer handles retain live ownership through transactions, copies, removal and undo", () => {
  const source = new Document();
  const group = source.layers.add(new LayerGroup());
  const paint = group.layers.add(new PaintLayer());
  paint.strokes.add(new BrushStroke({points:[{x:1,y:2,pressure:1},{x:3,y:4,pressure:1}]}));
  const restored = Document.fromJSON(source.toJSON());
  const handle = restored.getLayer(paint.id) as PaintLayer;
  const groupHandle = restored.getLayer(group.id) as LayerGroup;
  expect(groupHandle.layers.at(0)).toBe(handle);
  const snapshot = restored.getSnapshot().document;
  restored.transaction("Edit restored handle", () => {
    handle.name = "Edited";
    expect(handle.name).toBe("Edited");
    expect(restored.getLayer(paint.id)).toBe(handle);
  });
  expect(snapshot.children[0]).toEqual(source.getSnapshot().document.children[0]);
  const copy = handle.toJSON();
  if (copy.kind !== "paint") throw new Error("Expected paint");
  copy.strokes.length = 0;
  expect(handle.strokes.length).toBe(1);
  const duplicate = handle.duplicate() as PaintLayer;
  duplicate.name = "Independent";
  expect(handle.name).toBe("Edited");
  groupHandle.remove();
  expect(() => handle.name).toThrow(/current document revision/);
  restored.undo();
  expect(restored.getLayer(paint.id)).toBe(handle);
  expect(handle.name).toBe("Edited");
  expect(handle.strokes.length).toBe(1);
});

it("restored path handles preserve live data, returned-copy ownership and undo", () => {
  const source = new Document();
  const vector = source.layers.add(new VectorLayer());
  vector.paths.add(new VectorPath({points:[{x:1,y:2},{x:30,y:40}]}));
  const restored = Document.fromJSON(source.toJSON());
  const owner = restored.layers.at(0) as VectorLayer;
  const path = owner.paths.at(0)!;
  const original = restored.getSnapshot().document;
  const points = path.points;
  points[0].in.x = 999;
  const json = path.toJSON();
  json.points[0].x = 999;
  expect(path.points[0]).toMatchObject({x:1,in:{x:1,y:2}});
  restored.transaction("Edit restored path", () => {
    path.update({points:[{...path.points[0],x:5},path.points[1]]});
    expect(owner.paths.get(path.id)).toBe(path);
    expect(path.points[0].x).toBe(5);
  });
  expect(original.children[0]).toEqual(source.getSnapshot().document.children[0]);
  restored.undo();
  expect(path.points[0].x).toBe(1);
  path.remove();
  expect(() => path.points).toThrow(/current document revision/);
  restored.undo();
  expect(owner.paths.get(path.id)).toBe(path);
  expect(path.points[0].x).toBe(1);
  const copiedLayer = owner.duplicate() as VectorLayer;
  copiedLayer.paths.at(0)!.stroke = "#ff0000";
  expect(path.stroke).not.toBe("#ff0000");
});
