import { expect, it } from "vitest";
import {
  base,
  createDocument,
  createRaster,
  allLayers,
} from "../src/core/model";
import { ComponentRegistry } from "../src/core/smart/manager";
import { resolveSmartDocument } from "../src/core/smart/resolve";
import type {
  SmartDocumentData,
  SmartObjectInstanceData,
} from "../src/core/smart/types";

const instance = (componentId: string): SmartObjectInstanceData => ({
  ...base("Instance"),
  kind: "smart-object",
  componentId,
  width: 16,
  height: 16,
});
it("resolves multiple nested placements to unique deterministic IDs without changing authored definitions", () => {
  const leaf = {
    id: "leaf",
    name: "Leaf",
    source: {
      kind: "asset" as const,
      assetId: "pixels",
      width: 16,
      height: 16,
    },
  };
  const registry = new ComponentRegistry([
    leaf,
    {
      id: "master",
      name: "Master",
      source: {
        kind: "document",
        document: {
          ...createDocument("Master", 16, 16),
          children: [instance("leaf")],
        },
      },
    },
  ]);
  const input: SmartDocumentData = {
    ...createDocument("Root", 32, 16),
    children: [instance("master"), { ...instance("master"), x: 16 }],
  };
  const before = structuredClone(input);
  const definitions = registry.values();
  const first = resolveSmartDocument(input, registry);
  const second = resolveSmartDocument(input, registry);
  expect(first).toEqual(second);
  const layers = allLayers(first.children);
  expect(new Set(layers.map((layer) => layer.id)).size).toBe(layers.length);
  expect(
    layers
      .filter((layer) => layer.kind === "raster")
      .map((layer) => layer.assetId),
  ).toEqual(["pixels", "pixels"]);
  expect(input).toEqual(before);
  expect(registry.values()).toEqual(definitions);
});

it("rejects missing placements and expansion budget overflow before rendering", () => {
  const registry = new ComponentRegistry([
    {
      id: "master",
      name: "Master",
      source: {
        kind: "document",
        document: {
          ...createDocument("Master", 16, 16),
          children: [
            createRaster("Photo", "pixels", 16, 16),
            createRaster("Overlay", "pixels", 16, 16),
          ],
        },
      },
    },
  ]);
  const input: SmartDocumentData = {
    ...createDocument(),
    children: [instance("master")],
  };
  expect(() => resolveSmartDocument(input, registry, { maxNodes: 2 })).toThrow(
    "budget",
  );
  expect(() => resolveSmartDocument(input, registry, { maxDepth: 1 })).toThrow(
    "budget",
  );
  expect(() =>
    resolveSmartDocument(input, registry, { maxNodes: NaN }),
  ).toThrow("budget");
  input.children = [instance("missing")];
  expect(() => resolveSmartDocument(input, registry)).toThrow("missing");
});
