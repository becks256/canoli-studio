import { expect, it } from "vitest";
import { AdjustmentLayer, Document, PatchAdjustment } from "../src/dom";
import { referencedAssets, validateDocument } from "../src/core/model";
import {
  recipeAssetIds,
  readRecipePackage,
  serializeRecipePackage,
} from "../src/ai/recipes/package";
import type { Recipe } from "../src/ai/recipes/types";

it("captures patch values and uses shared validation, locks and history", () => {
  const options = { assetId: "patch", width: 20, height: 10 };
  const patch = new PatchAdjustment(options);
  options.width = 30;
  patch.toJSON().width = 40;
  expect(patch.width).toBe(20);
  const doc = new Document();
  const layer = doc.layers.add(new AdjustmentLayer({ adjustment: patch }));
  const before = doc.toJSON();
  layer.setPatch(
    new PatchAdjustment({ assetId: "second", width: 5, height: 5 }),
  );
  expect([...referencedAssets(doc.toJSON())]).toEqual(["second"]);
  doc.undo();
  expect(doc.toJSON()).toEqual(before);
  doc.redo();
  expect(layer.adjustmentKind).toBe("patch");
  layer.locked = true;
  expect(() => layer.setPatch(patch)).toThrow();
  expect(() => layer.setPatch(patch.toJSON() as any)).toThrow(
    "PatchAdjustment",
  );
  expect(() => new PatchAdjustment({ ...options, width: 0 })).toThrow();
  expect(() => new PatchAdjustment({ ...options, assetId: "" })).toThrow();
  expect(() => validateDocument({ ...before, schemaVersion: 8 })).toThrow(
    "schema version 9",
  );
  expect(Document.fromJSON(before).toJSON()).toEqual(before);
});

it("bundles patch assets from added layers and adjustment updates", async () => {
  const recipe: Recipe = {
    schemaVersion: 1,
    id: "patch",
    name: "Patch",
    description: "",
    version: 1,
    parameters: [],
    steps: [
      {
        id: "add",
        name: "Add",
        action: {
          type: "layer.add",
          layerTemplate: {
            kind: "adjustment",
            name: "Patch",
            adjustment: new PatchAdjustment({
              assetId: "a",
              width: 2,
              height: 2,
            }).toJSON(),
          },
        },
      },
      {
        id: "update",
        name: "Update",
        target: { by: "stepResult", stepId: "add" },
        action: {
          type: "layer.update",
          patch: {
            adjustment: new PatchAdjustment({
              assetId: "b",
              width: 2,
              height: 2,
            }).toJSON(),
          },
        },
      },
    ],
  };
  expect([...recipeAssetIds(recipe)]).toEqual(["a", "b"]);
  const file = await serializeRecipePackage(recipe, {
    get: (id) => ({
      id,
      name: id,
      width: 2,
      height: 2,
      blob: new Blob([id], { type: "image/png" }),
    }),
  });
  const loaded = await readRecipePackage(file);
  expect(loaded.assets.map((asset) => asset.id)).toEqual(["a", "b"]);
});
