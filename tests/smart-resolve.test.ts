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

it('full-frame raster masters retain editable erasures when resolved without another clipping boundary',async()=>{
 const{Document,RasterLayer}=await import('../src/dom'),doc=new Document(),master=new Document({width:16,height:16}),image=master.layers.add(new RasterLayer({assetId:'pixels',width:16,height:16}));image.clear();doc.placeSmartObject(doc.defineComponent(master));const before=doc.toJSON(),resolved=resolveSmartDocument(before,new ComponentRegistry(before.components));
 expect(resolved.children[0].kind).toBe('raster');if(resolved.children[0].kind!=='raster')throw new Error('Expected raster');const original=master.toJSON().children[0];if(original.kind!=='raster')throw new Error('Expected original raster');expect(resolved.children[0].erasures).toEqual(original.erasures);resolved.children[0].erasures![0].width=8;expect(doc.toJSON()).toEqual(before);
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

it("render views share only validated immutable input while public placement results remain owned", async () => {
  const { freeze } = await import("../src/core/immutable");
  const { LayerMask, BrushStroke } = await import("../src/dom");
  const registry = new ComponentRegistry([{ id: "source", name: "Source", source: { kind: "asset", assetId: "pixels", width: 16, height: 16 } }]);
  const input: SmartDocumentData = { ...createDocument("Root", 32, 32), children: [{ ...instance("source"), filterMask: new LayerMask({ base: 1, strokes: [{ mode: "hide", stroke: new BrushStroke({ points: [{ x: 1, y: 2 }] }) }] }).toJSON() }] };
  const frozen = freeze(structuredClone(input));
  expect(registry.validatedView(frozen)).toBe(frozen);
  const expanded = resolveSmartDocument(frozen, registry, { preserveFiltered: true, retainImmutable: true });
  expect((expanded.children[0] as SmartObjectInstanceData).filterMask).toBe((frozen.children[0] as SmartObjectInstanceData).filterMask);
  const publicCopy = registry.validatePlacements(frozen);
  publicCopy.name = "Mutable copy";
  (publicCopy.children[0] as SmartObjectInstanceData).filterMask!.strokes![0].stroke.points[0].x = 99;
  expect((frozen.children[0] as SmartObjectInstanceData).filterMask!.strokes![0].stroke.points[0].x).toBe(1);
  const shallow = Object.freeze(input);
  const detached = registry.validatedView(shallow);
  input.children[0].name = "Later mutation";
  expect(detached.children[0].name).toBe("Instance");
  const invalid = freeze({ ...frozen, width: 0 });
  expect(() => registry.validatedView(invalid)).toThrow();
  expect(() => registry.validatedView(freeze({ ...frozen, children: [instance("missing")] }))).toThrow("missing");
});
