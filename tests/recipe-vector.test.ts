import { it, expect } from "vitest";
import {
  Document,
  VectorLayer,
  VectorPath,
  VectorContour,
  PaintLayer,
} from "../src/dom";
import { execute } from "../src/core/commands";
import { RecipeRecorder, executeRecipe, type Recipe } from "../src/ai/recipes";
import { recipeSchema } from "../src/ai/recipes/schema";
import {
  serializeRecipePackage,
  readRecipePackage,
} from "../src/ai/recipes/package";

it("recorded vector append resolves created semantic targets and repeats with fresh path and contour identities", async () => {
  const source = new Document({ precision: "float32" }),
    layer = new VectorLayer({ name: "Vectors" }),
    path = VectorPath.rectangle({ x: 0, y: 0, width: 16, height: 16 }, 0, {
      fill: "#208040",
      fillRule: "evenodd",
      strokeDashArray: [3, 2],
    });
  path.subpaths.add(
    new VectorContour({
      points: VectorPath.rectangle({ x: 4, y: 4, width: 8, height: 8 }).points,
    }),
  );
  const recorder = new RecipeRecorder();
  recorder.start();
  let before = source.toJSON();
  for (const command of [
    { type: "layer.add" as const, layer: layer.toJSON() },
    { type: "path.add" as const, id: layer.id, path: path.toJSON() },
  ]) {
    const after = execute(before, command);
    recorder.recordCommand(command, before, after);
    before = after;
  }
  const recipe = recorder.stop({ name: "Editable vector append" });
  expect(recipe.steps[1].action.type).toBe("path.add");
  expect(recipe.steps[1].target?.by).toBe("stepResult");
  const packed = await serializeRecipePackage(recipe, {
      get() {
        throw new Error("No image assets");
      },
    }),
    read = await readRecipePackage(packed);
  expect(read.assets).toHaveLength(0);
  expect(read.recipe).toEqual(recipe);
  const target = new Document({ precision: "float32" });
  target.layers.add(new VectorLayer({ name: "Vectors" }));
  const initial = target.toJSON();
  expect(executeRecipe(recipe, target).success).toBe(true);
  expect(target.layers.length).toBe(2);
  const first = (target.layers.at(1) as VectorLayer).paths.at(0)!;
  expect(first.id).not.toBe(path.id);
  expect(first.subpaths.at(0)!.id).not.toBe(path.subpaths.at(0)!.id);
  target.undo();
  expect(target.toJSON()).toEqual(initial);
  target.redo();
  expect(executeRecipe(recipe, target).success).toBe(true);
  const second = (target.layers.at(2) as VectorLayer).paths.at(0)!;
  expect(second.id).not.toBe(first.id);
  expect(second.subpaths.at(0)!.id).not.toBe(first.subpaths.at(0)!.id);
  expect(second.fill).toBe("#208040");
  expect(second.strokeDashArray).toEqual([3, 2]);
});
it("vector append recipes reject wrong kinds, locked ancestry and malformed paint atomically", () => {
  const path = VectorPath.rectangle({
      x: 0,
      y: 0,
      width: 16,
      height: 16,
    }).toJSON(),
    recipe = recipeSchema.parse({
      schemaVersion: 1,
      id: "vector-append",
      name: "Append",
      description: "",
      version: 1,
      parameters: [],
      steps: [
        {
          id: "append",
          name: "Append",
          target: { role: "selected" },
          action: { type: "path.add", path },
        },
      ],
    }) as Recipe;
  for (const kind of ["paint", "locked-vector"]) {
    const doc = new Document({ precision: "float32" }),
      layer = doc.layers.add(
        kind === "paint" ? new PaintLayer() : new VectorLayer({ locked: true }),
      );
    doc.selectedLayer = layer;
    const saved = doc.toJSON();
    expect(executeRecipe(recipe, doc).success).toBe(false);
    expect(doc.toJSON()).toEqual(saved);
  }
  expect(() =>
    recipeSchema.parse({
      ...recipe,
      steps: [
        {
          ...recipe.steps[0],
          action: { type: "path.add", path: { ...path, strokeWidth: -1 } },
        },
      ],
    }),
  ).toThrow();
});
