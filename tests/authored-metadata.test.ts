import { describe, it, expect } from "vitest";
import { Document, RasterLayer, LayerMetadata } from "../src/dom";
import { parseCommands } from "../src/core/validation";

function fixture() {
  const document = new Document();
  const layer = document.layers.add(
    new RasterLayer({ assetId: "source", width: 10, height: 10 }),
  );
  return { document, layer };
}

describe("authored layer metadata", () => {
  it("uses constructors, live handles and one transaction across undo/redo", () => {
    const { document, layer } = fixture();
    const metadata = layer.metadata;
    document.transaction("Describe", () => {
      layer.metadata = new LayerMetadata({ title: "Artwork" });
      metadata.creator = "Artist";
      metadata.keywords = ["botanical"];
    });
    expect(metadata.title).toBe("Artwork");
    const detached = metadata.toJSON();
    detached.keywords.push("mutation");
    expect(metadata.keywords).toEqual(["botanical"]);
    document.undo();
    expect(metadata.title).toBe("");
    document.redo();
    expect(metadata.creator).toBe("Artist");
    const duplicate = layer.duplicate();
    duplicate.metadata.title = "Variant";
    expect(metadata.title).toBe("Artwork");
  });
  it("validates constructor and REST input, honors locks and rolls back invalid transactions", () => {
    const { document, layer } = fixture();
    expect(() => new LayerMetadata({ keywords: ["x".repeat(81)] })).toThrow();
    expect(() =>
      parseCommands([
        {
          type: "layer.update",
          id: layer.id,
          patch: {
            metadata: { ...new LayerMetadata().toJSON(), surprise: true },
          },
        },
      ]),
    ).toThrow();
    layer.locked = true;
    expect(() => (layer.metadata.title = "No")).toThrow(/Unlock/);
    layer.locked = false;
    expect(() =>
      document.transaction("Invalid", () => {
        layer.metadata.title = "Uncommitted";
        layer.metadata.description = "x".repeat(4097);
      }),
    ).toThrow();
    expect(layer.metadata.title).toBe("");
  });
  it("migrates v1 documents and serializes metadata under schema v2", () => {
    const { document, layer } = fixture();
    const legacy = document.toJSON();
    legacy.schemaVersion = 1;
    const reopened = Document.fromJSON(legacy);
    expect(reopened.toJSON().schemaVersion).toBe(38);
    layer.metadata = new LayerMetadata({ copyright: "Author supplied" });
    const saved = document.toJSON();
    expect(
      Document.fromJSON(saved).getLayer(layer.id)!.metadata.copyright,
    ).toBe("Author supplied");
    saved.schemaVersion = 1;
    expect(() => Document.fromJSON(saved)).toThrow(/schema version 2/);
  });
});

it("keeps metadata snapshots and keyword getters independent through attachment, reset and undo", () => {
  const layer = new RasterLayer({assetId:"source",width:10,height:10});
  const keywords = ["original"];
  layer.metadata = new LayerMetadata({title:"Detached",keywords});
  keywords.push("caller edit");
  const handle = layer.metadata, before = handle.toJSON();
  const document = new Document(); document.layers.add(layer);
  const returned = handle.keywords; returned.push("getter edit");
  expect(handle.keywords).toEqual(["original"]);
  document.transaction("Metadata", () => {
    handle.title = "Attached";
    expect(handle.title).toBe("Attached");
    handle.keywords = ["updated"];
  });
  expect(before.title).toBe("Detached");expect(before.keywords).toEqual(["original"]);
  handle.reset();expect(handle.title).toBe("");expect(handle.keywords).toEqual([]);
  document.undo();expect(handle.title).toBe("Attached");expect(handle.keywords).toEqual(["updated"]);
  document.undo();expect(handle.title).toBe("Detached");expect(handle.keywords).toEqual(["original"]);
  layer.remove();expect(()=>handle.toJSON()).toThrow("current document revision");
});
