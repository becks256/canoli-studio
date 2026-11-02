import { it, expect } from "vitest";
import {
  Document,
  PaintLayer,
  PencilStroke,
  BrushStroke,
  LayerGroup,
  AffineTransform,
} from "../src/dom";
import { execute } from "../src/core/commands";
import { RecipeRecorder, executeRecipe } from "../src/ai/recipes";
import {
  recipeAssetIds,
  serializeRecipePackage,
  readRecipePackage,
} from "../src/ai/recipes/package";

it("recorded editable strokes append through created semantic outputs and repeat with fresh operation IDs", () => {
  const source = new Document({ precision: "float32" }),
    paint = new PaintLayer({ name: "Recorded paint" }),
    stroke = new PencilStroke({
      points: [{ x: 3, y: 4 }],
      size: 2,
      opacity: 0.64123,
    }),
    recorder = new RecipeRecorder();
  recorder.start();
  let before = source.toJSON();
  const add = { type: "layer.add" as const, layer: paint.toJSON() },
    after = execute(before, add);
  recorder.recordCommand(add, before, after);
  before = after;
  const append = {
      type: "paint.add" as const,
      id: paint.id,
      stroke: stroke.toJSON(),
    },
    complete = execute(before, append);
  recorder.recordCommand(append, before, complete);
  const recipe = recorder.stop({ name: "Editable paint" }),
    target = new Document({ precision: "float32" });
  target.layers.add(new PaintLayer({ name: "Recorded paint" }));
  const initial = target.toJSON();
  expect(recipe.steps[1].target?.by).toBe("stepResult");
  expect(executeRecipe(recipe, target).success).toBe(true);
  expect(target.layers.length).toBe(2);
  const authored = target.layers.at(1) as PaintLayer;
  expect(authored.strokes.at(0)?.toJSON().opacity).toBe(0.64123);
  target.undo();
  expect(target.toJSON()).toEqual(initial);
  target.redo();
  expect(executeRecipe(recipe, target).success).toBe(true);
  const second = target.layers.at(2) as PaintLayer;
  expect(second.strokes.at(0)?.id).not.toBe(authored.strokes.at(0)?.id);
});

it("portable paint append captures texture originals and malformed/locked appends never modify target state", async () => {
  const source = new Document(),
    paint = source.layers.add(new PaintLayer({ name: "Existing paint" })),
    recorder = new RecipeRecorder();
  recorder.start(paint.id);
  const stroke = new BrushStroke({
      points: [{ x: 3, y: 4 }],
      texture: { assetId: "texture-original", channel: "alpha", invert: false },
    }),
    before = source.toJSON(),
    command = {
      type: "paint.add" as const,
      id: paint.id,
      stroke: stroke.toJSON(),
    };
  recorder.recordCommand(command, before, execute(before, command));
  const recipe = recorder.stop({ name: "Append original brush" });
  expect([...recipeAssetIds(recipe)]).toEqual(["texture-original"]);
  const blob = new Blob(["original coverage"], { type: "image/png" }),
    packed = await serializeRecipePackage(recipe, {
      get: (id) => ({
        id,
        name: "Original texture",
        width: 3,
        height: 2,
        blob,
      }),
    }),
    read = await readRecipePackage(packed);
  expect(await read.assets[0].blob.text()).toBe("original coverage");
  expect(read.recipe.steps[0].action).toEqual(recipe.steps[0].action);
  const target = new Document(),
    layer = target.layers.add(new PaintLayer());
  target.selectedLayer = layer;
  layer.locked = true;
  const saved = target.toJSON();
  expect(executeRecipe(recipe, target).success).toBe(false);
  expect(target.toJSON()).toEqual(saved);
});

it("fresh paint placement retains semantic group ownership, affine preservation and locked-destination rollback", () => {
  const source = new Document({ precision: "float32" }),
    group = source.layers.add(new LayerGroup({ name: "Frame" }));
  group.transform = new AffineTransform(2, 0.25, 0.5, 1, 12, 8);
  const recorder = new RecipeRecorder();
  recorder.start(group.id);
  let before = source.toJSON();
  const paint = new PaintLayer({ name: "New stroke" }),
    stroke = new PencilStroke({ points: [{ x: 20, y: 20 }], size: 4 });
  const commands = [
    { type: "layer.add" as const, layer: paint.toJSON() },
    {
      type: "layer.place" as const,
      id: paint.id,
      targetId: group.id,
      placement: "inside" as const,
      preservePosition: true,
    },
    { type: "paint.add" as const, id: paint.id, stroke: stroke.toJSON() },
  ];
  for (const command of commands) {
    const after = execute(before, command);
    recorder.recordCommand(command, before, after);
    before = after;
  }
  const recipe = recorder.stop({ name: "Placed drawing" }),
    target = new Document({ precision: "float32" }),
    destination = target.layers.add(
      new LayerGroup({ name: "Different frame" }),
    );
  destination.transform = group.transform;
  target.selectedLayer = destination;
  expect(executeRecipe(recipe, target).success).toBe(true);
  expect(target.layers.length).toBe(1);
  expect(destination.layers.length).toBe(1);
  expect(destination.layers.at(0)?.toJSON().transform).toEqual(
    (
      before.children[0] as Extract<
        import("../src/core/model").LayerData,
        { kind: "group" }
      >
    ).children[0].transform,
  );
  target.undo();
  destination.locked = true;
  target.selectedLayer = destination;
  const saved = target.toJSON(),
    rejected = executeRecipe(recipe, target);
  expect(rejected.success).toBe(false);
  expect(rejected.error).toMatch(/unlock|locked/i);
  expect(target.toJSON()).toEqual(saved);
});
