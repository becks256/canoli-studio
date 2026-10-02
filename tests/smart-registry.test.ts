import { expect, it } from "vitest";
import { createDocument, createGroup, createRaster } from "../src/core/model";
import { ComponentRegistry } from "../src/core/smart/manager";
import type {
  SmartComponentDefinition,
  SmartLayerData,
  SmartObjectInstanceData,
} from "../src/core/smart/types";

function instance(componentId: string): SmartObjectInstanceData {
  const {
    assetId: _asset,
    effects: _effects,
    ...base
  } = createRaster("Instance", "placeholder", 16, 16);
  return { ...base, kind: "smart-object", componentId };
}
const asset = (
  id: string,
  assetId = `${id}-pixels`,
): SmartComponentDefinition => ({
  id,
  name: id,
  source: { kind: "asset", assetId, width: 16, height: 16 },
});
function composition(
  id: string,
  children: SmartLayerData[],
): SmartComponentDefinition {
  return {
    id,
    name: id,
    source: {
      kind: "document",
      document: { ...createDocument(id, 32, 32), children },
    },
  };
}

it("tracks repeated nested instances and propagates invalidation through a diamond graph once", () => {
  const registry = new ComponentRegistry([
    asset("leaf"),
    composition("left", [instance("leaf"), instance("leaf")]),
    composition("right", [
      { ...createGroup("Nested"), children: [instance("leaf")] },
    ]),
    composition("root", [
      instance("left"),
      instance("right"),
      createRaster("Photo", "photo", 32, 32),
    ]),
    asset("unrelated"),
  ]);
  expect(registry.referenceCount("leaf")).toBe(3);
  expect(registry.affectedBy("leaf")).toEqual(
    new Set(["leaf", "left", "right", "root"]),
  );
  const next = registry.withDefinitions([asset("leaf", "replacement")]);
  expect(next.invalidated).toEqual(new Set(["leaf", "left", "right", "root"]));
  expect(next.registry.assetIds()).toEqual(
    new Set(["replacement", "photo", "unrelated-pixels"]),
  );
  expect(registry.assetIds()).toEqual(
    new Set(["leaf-pixels", "photo", "unrelated-pixels"]),
  );
  expect(() => registry.without("leaf")).toThrow("still referenced");
  expect(registry.without("root").referenceCount("left")).toBe(0);
});

it("rejects missing definitions, duplicate IDs, direct and indirect cycles atomically", () => {
  expect(() => new ComponentRegistry([asset("a"), asset("a")])).toThrow(
    "Duplicate",
  );
  expect(
    () => new ComponentRegistry([composition("a", [instance("missing")])]),
  ).toThrow("missing");
  expect(
    () => new ComponentRegistry([composition("a", [instance("a")])]),
  ).toThrow("Circular");
  const registry = new ComponentRegistry([
    asset("a"),
    composition("b", [instance("a")]),
  ]);
  expect(() =>
    registry.withDefinitions([composition("a", [instance("b")])]),
  ).toThrow("Circular");
  expect(registry.get("a")).toEqual(asset("a"));
  const next = registry.withDefinitions([
    composition("a", [instance("b")]),
    asset("b"),
  ]);
  expect(next.registry.referenceCount("b")).toBe(1);
});

it("owns detached definition snapshots and preserves original geometry through instance changes", () => {
  const placement = instance("source");
  placement.transform = { a: 0.01, b: 0, c: 0, d: 0.01, e: 0, f: 0 };
  placement.x = 20;
  placement.y = 30;
  placement.width = 16.5;
  const input = [asset("source"), composition("scene", [placement])];
  const registry = new ComponentRegistry(input);
  input[0].name = "Mutated";
  const scene = registry.get("scene");
  if (scene.source.kind !== "document") throw new Error("Expected document");
  scene.source.document.children[0].transform = {
    a: 1,
    b: 0,
    c: 0,
    d: 1,
    e: 0,
    f: 0,
  };
  const restored = registry.withDefinitions([scene]).registry;
  expect(restored.get("source")).toEqual(asset("source"));
  expect(registry.get("source").name).toBe("source");
  const saved = JSON.parse(JSON.stringify(restored.values()));
  expect(new ComponentRegistry(saved).values()).toEqual(restored.values());
});

it("validates master documents and smart instance geometry before publishing a registry", () => {
  const invalid = instance("source");
  invalid.width = -1;
  expect(
    () =>
      new ComponentRegistry([asset("source"), composition("scene", [invalid])]),
  ).toThrow();
  const duplicate = instance("source");
  expect(
    () =>
      new ComponentRegistry([
        asset("source"),
        composition("scene", [duplicate, duplicate]),
      ]),
  ).toThrow();
  const group = {
    ...createGroup("Recursive"),
    children: [] as SmartLayerData[],
  };
  group.children.push(group);
  expect(() => new ComponentRegistry([composition("scene", [group])])).toThrow(
    "layer tree",
  );
});

it("collects bitmap masks on instances without confusing component references with real asset IDs", () => {
  const placed = instance("source");
  placed.mask = {
    kind: "bitmap",
    assetId: "mask",
    enabled: true,
    inverted: false,
    density: 1,
  };
  const registry = new ComponentRegistry([
    asset("source"),
    composition("scene", [
      placed,
      createRaster("Real source", "component-validation-placeholder", 16, 16),
    ]),
  ]);
  const ids = registry.assetIds();
  expect(ids).toEqual(
    new Set(["source-pixels", "mask", "component-validation-placeholder"]),
  );
  ids.clear();
  expect(registry.assetIds().size).toBe(3);
});

it("requires schema 10 for nested smart instances inside a master", () => {
  const master = composition("scene", [instance("source")]);
  if (master.source.kind !== "document")
    throw new Error("Expected composition");
  master.source.document.schemaVersion = 9;
  expect(() => new ComponentRegistry([asset("source"), master])).toThrow(
    "schema version 10",
  );
});
