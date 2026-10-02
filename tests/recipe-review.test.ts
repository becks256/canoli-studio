import { expect, it } from "vitest";
import {
  Document,
  LayerGroup,
  LayerMask,
  RasterLayer,
  TextLayer,
} from "../src/dom";
import { RecipeRecorder } from "../src/ai/recipes/recorder";
import { validateRecipe } from "../src/ai/recipes/schema";
import { resolveTarget } from "../src/ai/recipes/resolver";
import { executeRecipe } from "../src/ai/recipes/executor";
import { PRESET_PRODUCT_DROP_SHADOW } from "../src/ai/recipes/presets";

it("binds an output alias equal to its step ID exactly once", () => {
  for (const allowMultiple of [false, true]) {
    const doc = new Document();
    doc.selectedLayer = doc.layers.add(
      new TextLayer({ text: "Subject", x: 0 }),
    );
    const recipe = structuredClone(PRESET_PRODUCT_DROP_SHADOW);
    recipe.parameters = [];
    recipe.steps = [
      {
        id: "copy",
        name: "Copy",
        outputVar: "copy",
        target: { role: "selected" },
        action: { type: "layer.duplicate", inPlace: true },
      },
      {
        id: "move",
        name: "Move",
        target: { by: "stepResult", stepId: "copy", allowMultiple },
        action: { type: "layer.translate", dx: 10, dy: 0 },
      },
    ];
    expect(validateRecipe(recipe).valid).toBe(true);
    const before = doc.toJSON();
    expect(executeRecipe(recipe, doc).success).toBe(true);
    expect(doc.toJSON().children.map((layer) => layer.x)).toEqual([0, 10]);
    doc.undo();
    expect(doc.toJSON()).toEqual(before);
    recipe.steps[1].outputVar = "copy";
    expect(validateRecipe(recipe).valid).toBe(false);
    expect(executeRecipe(recipe, doc).success).toBe(false);
    expect(doc.toJSON()).toEqual(before);
  }
});

it("active-mask targets the selected masked layer and rejects an unmasked selection", () => {
  const doc = new Document();
  const first = doc.layers.add(new TextLayer({ name: "First", text: "1" }));
  first.mask = new LayerMask({ base: 1 });
  const selected = doc.layers.add(
    new TextLayer({ name: "Selected", text: "2" }),
  );
  selected.mask = new LayerMask({ base: 1 });
  expect(
    resolveTarget({ role: "active-mask" }, doc.toJSON(), selected.id).layer?.id,
  ).toBe(selected.id);
  selected.mask = null;
  expect(
    resolveTarget({ role: "active-mask" }, doc.toJSON(), selected.id).error,
  ).toBeTruthy();
  expect(
    resolveTarget({ role: "active-mask" }, doc.toJSON(), null).error,
  ).toBeTruthy();
});

it("records long names and repeated duplicates as valid replayable recipes", () => {
  const doc = new Document();
  const recorder = new RecipeRecorder();
  recorder.start();
  doc.onCommand((command, before, after) =>
    recorder.recordCommand(command, before, after),
  );
  const original = doc.layers.add(
    new TextLayer({ name: "A".repeat(240), text: "original" }),
  );
  const first = original.duplicate();
  original.duplicate();
  first.opacity = 0.4;
  const recipe = recorder.stop();
  expect(validateRecipe(recipe).valid).toBe(true);
  const destination = new Document();
  expect(executeRecipe(recipe, destination).success).toBe(true);
  expect(destination.toJSON().children.map((layer) => layer.opacity)).toEqual(
    doc.toJSON().children.map((layer) => layer.opacity),
  );
});

it("offsets shadows from their subjects inside groups and preserves transactional undo", () => {
  const doc = new Document();
  const group = doc.layers.add(new LayerGroup({ x: 100, y: 100 }));
  const subject = group.layers.add(
    new RasterLayer({
      name: "Subject",
      assetId: "source",
      width: 100,
      height: 100,
      x: 300,
      y: 200,
    }),
  );
  doc.selectedLayer = subject;
  const before = doc.toJSON();
  const result = executeRecipe(PRESET_PRODUCT_DROP_SHADOW, doc, {
    offsetX: -20,
    offsetY: 30,
  });
  expect(result.success).toBe(true);
  const shadow = [...group.layers].find((layer) => layer.id !== subject.id)!;
  expect([shadow.x, shadow.y]).toEqual([280, 230]);
  const after = doc.toJSON();
  doc.undo();
  expect(doc.toJSON()).toEqual(before);
  doc.redo();
  expect(doc.toJSON()).toEqual(after);
});

it("rejects invalid translations without committing preceding recipe steps", () => {
  const doc = new Document();
  const subject = doc.layers.add(
    new RasterLayer({ assetId: "source", width: 100, height: 100 }),
  );
  doc.selectedLayer = subject;
  const recipe = structuredClone(PRESET_PRODUCT_DROP_SHADOW);
  recipe.steps.at(-1)!.action = {
    type: "layer.translate",
    dx: "not a number",
    dy: 2,
  };
  const before = doc.toJSON();
  expect(executeRecipe(recipe, doc).success).toBe(false);
  expect(doc.toJSON()).toEqual(before);
});

it("replays auto-parameterized tone recordings across the supported editor range", () => {
  for (const values of [
    { exposure: 1, contrast: 25, saturation: 30 },
    { exposure: -3, contrast: -100, saturation: -100 },
    { exposure: 3, contrast: 100, saturation: 100 },
  ]) {
    const source = new Document();
    const photo = source.layers.add(
      new RasterLayer({
        name: "Photo",
        assetId: "source",
        width: 32,
        height: 32,
      }),
    );
    source.selectedLayer = photo;
    const recorder = new RecipeRecorder();
    recorder.start(photo.id);
    source.onCommand((command, before, after) =>
      recorder.recordCommand(command, before, after),
    );
    source._dispatch({ type: "effect.tone", id: photo.id, values });
    const recipe = recorder.stop({ autoParameterizeTone: true });
    const target = new Document();
    const targetPhoto = target.layers.add(
      new RasterLayer({
        name: "Target",
        assetId: "source",
        width: 32,
        height: 32,
      }),
    );
    target.selectedLayer = targetPhoto;
    const before = target.toJSON();
    expect(executeRecipe(recipe, target).success).toBe(true);
    const result = target.toJSON().children[0];
    expect(result.kind === "raster" && result.effects[0]).toMatchObject(values);
    target.undo();
    expect(target.toJSON()).toEqual(before);
    expect(executeRecipe(recipe, target, { exposure: 4 }).success).toBe(false);
    expect(target.toJSON()).toEqual(before);
  }
});

it("rejects incomplete conditions before committing any recipe edits", () => {
  const doc = new Document();
  doc.layers.add(new TextLayer({ text: "Keep me" }));
  const before = doc.toJSON();
  const revision = doc.getSnapshot().revision;
  const recipe = structuredClone(PRESET_PRODUCT_DROP_SHADOW);
  recipe.parameters = [];
  for (const condition of [
    { op: "equals", value: true },
    { op: "truthy" },
    { op: "layerExists" },
    { op: "equals", param: "approved" },
    { op: "greaterThan", param: "count", value: "oops" },
    { op: "layerCountEquals", value: -1 },
  ] as import("../src/ai/recipes/types").StepCondition[]) {
    recipe.steps = [
      {
        id: "rename",
        name: "Rename",
        action: { type: "document.rename", name: "Changed" },
      },
      {
        id: "delete",
        name: "Conditional deletion",
        condition,
        target: { role: "all" },
        action: { type: "layer.remove" },
      },
    ];
    expect(validateRecipe(recipe).valid).toBe(false);
    expect(executeRecipe(recipe, doc).success).toBe(false);
    expect(doc.toJSON()).toEqual(before);
    expect(doc.getSnapshot().revision).toBe(revision);
  }
  recipe.parameters = [
    { name: "approved", label: "Approved", type: "boolean", default: false },
  ];
  recipe.steps = [
    {
      id: "delete",
      name: "Conditional deletion",
      condition: { op: "equals", param: "approved", value: true },
      target: { role: "all" },
      action: { type: "layer.remove" },
    },
  ];
  expect(validateRecipe(recipe).valid).toBe(true);
  expect(executeRecipe(recipe, doc).success).toBe(true);
  expect(doc.toJSON()).toEqual(before);
  expect(executeRecipe(recipe, doc, { approved: true }).success).toBe(true);
  expect(doc.layers.length).toBe(0);
  doc.undo();
  expect(doc.toJSON()).toEqual(before);
});

it("binds prototype-named parameters as data with defaults, required checks and undo", () => {
  for (const name of ["constructor", "toString", "__proto__"]) {
    const doc = new Document();
    const recipe = structuredClone(PRESET_PRODUCT_DROP_SHADOW);
    recipe.parameters = [
      { name, label: "Title", type: "string", default: "Expected title" },
    ];
    recipe.steps = [
      {
        id: "rename",
        name: "Rename",
        action: { type: "document.rename", name: "${" + name + "}" },
      },
    ];
    expect(validateRecipe(recipe).valid).toBe(true);
    const before = doc.toJSON();
    expect(executeRecipe(recipe, doc).success).toBe(true);
    expect(doc.name).toBe("Expected title");
    doc.undo();
    expect(doc.toJSON()).toEqual(before);
    const supplied = JSON.parse(JSON.stringify({ [name]: "Supplied title" }));
    expect(executeRecipe(recipe, doc, supplied).success).toBe(true);
    expect(doc.name).toBe("Supplied title");
    doc.undo();
    expect(doc.toJSON()).toEqual(before);
    recipe.parameters = [
      { name, label: "Title", type: "string", required: true },
    ];
    expect(executeRecipe(recipe, doc).success).toBe(false);
    expect(doc.toJSON()).toEqual(before);
  }
});

it("executes existence conditions with multiple matches and preserves missing-target skips", () => {
  const doc = new Document();
  doc.layers.add(new TextLayer({ name: "Subject", text: "One" }));
  doc.layers.add(new TextLayer({ name: "Subject", text: "Two" }));
  const before = doc.toJSON();
  const recipe = structuredClone(PRESET_PRODUCT_DROP_SHADOW);
  recipe.parameters = [];
  recipe.steps = [
    {
      id: "rename",
      name: "Rename",
      condition: {
        op: "layerExists",
        target: { by: "name", pattern: "Subject" },
      },
      action: { type: "document.rename", name: "Matched" },
    },
  ];
  expect(executeRecipe(recipe, doc).success).toBe(true);
  expect(doc.name).toBe("Matched");
  doc.undo();
  expect(doc.toJSON()).toEqual(before);
  recipe.steps[0].condition!.target!.pattern = "Missing";
  const revision = doc.getSnapshot().revision;
  expect(executeRecipe(recipe, doc).success).toBe(true);
  expect(doc.toJSON()).toEqual(before);
  expect(doc.getSnapshot().revision).toBe(revision);
});
