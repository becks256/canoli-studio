import { describe, expect, it } from "vitest";
import {
  Document,
  LayerGroup,
  RasterLayer,
  TextLayer,
  AdjustmentLayer,
} from "../src/dom";
import {
  createDocument,
  createRaster,
  createAdjustmentLayer,
  createGroup,
  createText,
} from "../src/core/model";
import {
  BUILTIN_PRESETS,
  PRESET_PRODUCT_DROP_SHADOW,
  PRESET_VIGNETTE_WARM,
  PRESET_WATERMARK_STAMP,
  RECIPE_SCHEMA_VERSION,
  RecipeRecorder,
  compileEditPlan,
  executeRecipe,
  interpolateValue,
  resolveTarget,
  validateRecipe,
  type Recipe,
} from "../src/ai/recipes";
import { EditorApplication } from "../src/editor";

// Worker stub for Node test environment (for EditorApplication's PixelProcessor)
if (typeof globalThis.Worker === "undefined") {
  globalThis.Worker = class MockWorker {
    postMessage() {}
    addEventListener() {}
    removeEventListener() {}
    terminate() {}
  } as unknown as typeof Worker;
}

describe("T14: Recipe schema, deterministic recorder & dry-run engine", () => {
  describe("Recipe Schema & Validation", () => {
    it("validates well-formed recipes successfully", () => {
      const recipe: Recipe = {
        schemaVersion: RECIPE_SCHEMA_VERSION,
        id: "test-recipe-1",
        name: "Test Recipe",
        description: "A test recipe for unit testing",
        version: 1,
        parameters: [
          {
            name: "brightness",
            label: "Brightness",
            type: "number",
            default: 0.1,
            min: -1,
            max: 1,
          },
        ],
        steps: [
          {
            id: "step-1",
            name: "Apply Brightness",
            target: { role: "selected" },
            action: {
              type: "effect.tone",
              values: { exposure: "${brightness}" },
            },
          },
        ],
      };

      const result = validateRecipe(recipe);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.recipe).toBeDefined();
    });

    it("rejects recipe without steps", () => {
      const invalid = {
        schemaVersion: RECIPE_SCHEMA_VERSION,
        id: "test-empty",
        name: "Empty Recipe",
        description: "Has no steps",
        version: 1,
        parameters: [],
        steps: [],
      };
      const result = validateRecipe(invalid);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("steps"))).toBe(true);
    });

    it("rejects recipe with duplicate step IDs", () => {
      const duplicateSteps = {
        schemaVersion: RECIPE_SCHEMA_VERSION,
        id: "dup-steps",
        name: "Dup Steps",
        description: "Steps with same id",
        version: 1,
        parameters: [],
        steps: [
          {
            id: "same-id",
            name: "Step A",
            action: { type: "selection.set", selection: null },
          },
          {
            id: "same-id",
            name: "Step B",
            action: { type: "selection.set", selection: null },
          },
        ],
      };
      const result = validateRecipe(duplicateSteps);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.includes("step IDs must be unique")),
      ).toBe(true);
    });

    it("rejects recipe with duplicate parameter names", () => {
      const duplicateParams = {
        schemaVersion: RECIPE_SCHEMA_VERSION,
        id: "dup-params",
        name: "Dup Params",
        description: "Parameters with same name",
        version: 1,
        parameters: [
          { name: "contrast", label: "Contrast 1", type: "number" },
          { name: "contrast", label: "Contrast 2", type: "number" },
        ],
        steps: [
          {
            id: "step-1",
            name: "Step 1",
            action: { type: "selection.set", selection: null },
          },
        ],
      };
      const result = validateRecipe(duplicateParams);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.includes("parameter names must be unique")),
      ).toBe(true);
    });

    it("validates all built-in presets", () => {
      expect(BUILTIN_PRESETS.length).toBeGreaterThanOrEqual(4);
      for (const preset of BUILTIN_PRESETS) {
        const res = validateRecipe(preset);
        expect(res.valid).toBe(true);
        expect(res.errors).toEqual([]);
      }
    });
  });

  describe("Semantic Target Resolution", () => {
    it("resolves role: selected, background, topmost, bottommost", () => {
      const doc = createDocument("Test", 1000, 800);
      const bg = createRaster("Background", "asset-bg", 1000, 800);
      const hero = createRaster("Hero Subject", "asset-hero", 500, 500);
      const overlay = createAdjustmentLayer("Overlay Curve");
      doc.children.push(bg, hero, overlay);

      // Selected role
      const resSelected = resolveTarget({ role: "selected" }, doc, hero.id);
      expect(resSelected.layer?.id).toBe(hero.id);

      // Selected role when nothing selected
      const resNoneSelected = resolveTarget({ role: "selected" }, doc, null);
      expect(resNoneSelected.layer).toBeNull();
      expect(resNoneSelected.error).toContain("No layer is currently selected");

      // Background role
      const resBg = resolveTarget({ role: "background" }, doc, null);
      expect(resBg.layer?.id).toBe(bg.id);

      // Topmost role
      const resTop = resolveTarget({ role: "topmost" }, doc, null);
      expect(resTop.layer?.id).toBe(overlay.id);

      // Bottommost role
      const resBottom = resolveTarget({ role: "bottommost" }, doc, null);
      expect(resBottom.layer?.id).toBe(bg.id);
    });

    it("resolves by name pattern and wildcard", () => {
      const doc = createDocument("Test", 1000, 800);
      const layer1 = createRaster("Product Cutout", "asset-1", 400, 400);
      const layer2 = createRaster("Background Texture", "asset-2", 1000, 800);
      doc.children.push(layer1, layer2);

      // Exact name match
      const resExact = resolveTarget(
        { by: "name", pattern: "Product Cutout" },
        doc,
        null,
      );
      expect(resExact.layer?.id).toBe(layer1.id);

      // Wildcard match
      const resWild = resolveTarget(
        { by: "name", pattern: "Product*" },
        doc,
        null,
      );
      expect(resWild.layer?.id).toBe(layer1.id);

      // Not found
      const resNotFound = resolveTarget(
        { by: "name", pattern: "Nonexistent" },
        doc,
        null,
      );
      expect(resNotFound.layer).toBeNull();
      expect(resNotFound.error).toContain("No layer matching name pattern");
    });

    it("detects and rejects ambiguous targets by default", () => {
      const doc = createDocument("Test", 1000, 800);
      const item1 = createRaster("Item 1", "asset-1", 400, 400);
      const item2 = createRaster("Item 2", "asset-2", 400, 400);
      doc.children.push(item1, item2);

      // Wildcard "Item*" matches both item1 and item2
      const resAmbiguous = resolveTarget(
        { by: "name", pattern: "Item*" },
        doc,
        null,
      );
      expect(resAmbiguous.layer).toBeNull();
      expect(resAmbiguous.error).toContain("is ambiguous; matches 2 layers");

      // With ambiguityStrategy: "first", resolves first match
      const resFirst = resolveTarget(
        { by: "name", pattern: "Item*", ambiguityStrategy: "first" },
        doc,
        null,
      );
      expect(resFirst.layer?.id).toBe(item1.id);
    });

    it("resolves by kind and tags", () => {
      const doc = createDocument("Test", 1000, 800);
      const raster = createRaster("Photo", "asset-1", 400, 400);
      raster.metadata = {
        title: "",
        description: "",
        altText: "",
        creator: "",
        copyright: "",
        license: "",
        keywords: ["hero", "product"],
      };
      const adj = createAdjustmentLayer("Grade");
      doc.children.push(raster, adj);

      // By kind
      const resKind = resolveTarget(
        { by: "kind", kind: "adjustment" },
        doc,
        null,
      );
      expect(resKind.layer?.id).toBe(adj.id);

      // By tag
      const resTag = resolveTarget({ by: "tag", tag: "hero" }, doc, null);
      expect(resTag.layer?.id).toBe(raster.id);
    });

    it("resolves by stepResult output variable", () => {
      const doc = createDocument("Test", 1000, 800);
      const layer = createRaster("Staged", "asset-1", 400, 400);
      doc.children.push(layer);

      const stepOutputs = new Map<string, string>();
      stepOutputs.set("generatedShadow", layer.id);

      const resStep = resolveTarget(
        { by: "stepResult", stepId: "generatedShadow" },
        doc,
        null,
        stepOutputs,
      );
      expect(resStep.layer?.id).toBe(layer.id);
    });
  });

  describe("Variable Interpolation", () => {
    it("interpolates typed primitives, exact variables, and template strings", () => {
      const params = {
        exposureVal: 0.75,
        targetName: "Subject",
        enabled: true,
      };

      // Exact parameter preserve types
      expect(interpolateValue("${exposureVal}", params)).toBe(0.75);
      expect(interpolateValue("${enabled}", params)).toBe(true);

      // String interpolation
      expect(interpolateValue("Prefix-${targetName}-Suffix", params)).toBe(
        "Prefix-Subject-Suffix",
      );

      // Nested structures
      const complex = {
        patch: {
          x: "${exposureVal}",
          label: "Layer: ${targetName}",
        },
      };
      expect(interpolateValue(complex, params)).toEqual({
        patch: {
          x: 0.75,
          label: "Layer: Subject",
        },
      });
    });
  });

  describe("Dry-run Validation Engine (compileEditPlan)", () => {
    it("never mutates the input document state or history during dry-run", () => {
      const doc = new Document({ name: "Original", width: 800, height: 600 });
      const layer = new RasterLayer({
        name: "Base",
        assetId: "asset-1",
        width: 800,
        height: 600,
      });
      doc.layers.add(layer);
      doc.selectedLayer = layer;

      const docBeforeJSON = JSON.stringify(doc.toJSON());
      const revisionBefore = doc.getSnapshot().revision;

      const plan = compileEditPlan(
        PRESET_VIGNETTE_WARM,
        doc.toJSON(),
        doc.selectedLayer?.id ?? null,
        { exposure: 0.5, contrast: 0.4 },
      );

      expect(plan.valid).toBe(true);
      expect(plan.summary.layersAdded).toBe(1);
      expect(plan.summary.layersModified).toBe(1);

      // Document in memory must be 100% untouched
      expect(JSON.stringify(doc.toJSON())).toBe(docBeforeJSON);
      expect(doc.getSnapshot().revision).toBe(revisionBefore);
      expect(doc.layers.length).toBe(1);
    });

    it("rejects plan when target layer is missing", () => {
      const doc = createDocument("Empty", 800, 600);
      const recipe: Recipe = {
        schemaVersion: RECIPE_SCHEMA_VERSION,
        id: "missing-target-recipe",
        name: "Missing Target",
        description: "Targets non-existent layer",
        version: 1,
        parameters: [],
        steps: [
          {
            id: "step-1",
            name: "Update Subject",
            target: { by: "name", pattern: "Subject" },
            action: { type: "layer.update", patch: { opacity: 0.5 } },
          },
        ],
      };

      const plan = compileEditPlan(recipe, doc, null);
      expect(plan.valid).toBe(false);
      expect(
        plan.errors.some((e) =>
          e.includes("No layer matching name pattern 'Subject'"),
        ),
      ).toBe(true);
      expect(plan.preconditions.some((p) => !p.satisfied)).toBe(true);
    });

    it("rejects plan when target layer is locked", () => {
      const doc = createDocument("Locked Doc", 800, 600);
      const lockedLayer = createRaster("Protected Asset", "asset-1", 800, 600);
      lockedLayer.locked = true;
      doc.children.push(lockedLayer);

      const recipe: Recipe = {
        schemaVersion: RECIPE_SCHEMA_VERSION,
        id: "locked-recipe",
        name: "Locked Layer Edit",
        description: "Tries to edit locked layer",
        version: 1,
        parameters: [],
        steps: [
          {
            id: "step-1",
            name: "Modify Protected",
            target: { by: "name", pattern: "Protected Asset" },
            action: { type: "layer.update", patch: { opacity: 0.5 } },
          },
        ],
      };

      const plan = compileEditPlan(recipe, doc, lockedLayer.id);
      expect(plan.valid).toBe(false);
      expect(plan.errors.some((e) => e.includes("is locked"))).toBe(true);
    });

    it("rejects plan when tone adjustment is attempted on non-raster layer", () => {
      const doc = createDocument("Test", 800, 600);
      const adjLayer = createAdjustmentLayer("Color Grade");
      doc.children.push(adjLayer);

      const recipe: Recipe = {
        schemaVersion: RECIPE_SCHEMA_VERSION,
        id: "tone-on-adj",
        name: "Invalid Tone Target",
        description: "Tries tone adjustment on adjustment layer",
        version: 1,
        parameters: [],
        steps: [
          {
            id: "step-1",
            name: "Adjust Tone",
            target: { by: "name", pattern: "Color Grade" },
            action: { type: "effect.tone", values: { exposure: 0.5 } },
          },
        ],
      };

      const plan = compileEditPlan(recipe, doc, adjLayer.id);
      expect(plan.valid).toBe(false);
      expect(
        plan.errors.some((e) =>
          e.includes(
            "Tone adjustment can only be applied to raster image layers",
          ),
        ),
      ).toBe(true);
    });

    it("evaluates conditional steps properly", () => {
      const doc = createDocument("Test", 800, 600);
      const bg = createRaster("Background", "asset-bg", 800, 600);
      doc.children.push(bg);

      const recipe: Recipe = {
        schemaVersion: RECIPE_SCHEMA_VERSION,
        id: "conditional-recipe",
        name: "Conditional Workflow",
        description: "Conditionally executes steps",
        version: 1,
        parameters: [
          {
            name: "includeWatermark",
            label: "Include Watermark",
            type: "boolean",
            default: false,
          },
        ],
        steps: [
          {
            id: "step-always",
            name: "Tone Base",
            target: { role: "background" },
            action: { type: "effect.tone", values: { exposure: 0.2 } },
          },
          {
            id: "step-watermark",
            name: "Add Watermark",
            condition: { param: "includeWatermark", op: "truthy" },
            action: {
              type: "layer.add",
              layerTemplate: {
                kind: "text",
                name: "Watermark",
                text: "COPYRIGHT",
              },
            },
          },
        ],
      };

      // With includeWatermark = false
      const planSkipped = compileEditPlan(recipe, doc, null, {
        includeWatermark: false,
      });
      expect(planSkipped.valid).toBe(true);
      expect(planSkipped.steps[1].skipped).toBe(true);
      expect(planSkipped.steps[1].skipReason).toContain("not satisfied");
      expect(planSkipped.summary.layersAdded).toBe(0);

      // With includeWatermark = true
      const planExecuted = compileEditPlan(recipe, doc, null, {
        includeWatermark: true,
      });
      expect(planExecuted.valid).toBe(true);
      expect(planExecuted.steps[1].skipped).toBe(false);
      expect(planExecuted.summary.layersAdded).toBe(1);
    });
  });

  describe("Atomic Execution & One-Item Rollback (executeRecipe)", () => {
    it("executes valid recipe inside 1 transaction and undoes in 1 step", () => {
      const doc = new Document({ name: "Studio", width: 1200, height: 900 });
      const photo = new RasterLayer({
        name: "Hero Photo",
        assetId: "asset-hero",
        width: 1200,
        height: 900,
      });
      doc.layers.add(photo);
      doc.selectedLayer = photo;

      const revisionBefore = doc.getSnapshot().revision;
      const layerCountBefore = doc.layers.length;

      // Execute PRESET_VIGNETTE_WARM
      const result = executeRecipe(PRESET_VIGNETTE_WARM, doc, {
        exposure: 0.3,
        contrast: 0.2,
      });

      expect(result.success).toBe(true);
      expect(result.plan.valid).toBe(true);
      expect(doc.layers.length).toBe(layerCountBefore + 1); // 1 adjustment layer added
      expect(doc.getSnapshot().revision).toBe(revisionBefore + 1); // Exactly 1 revision step!

      // Verify tone adjustment was applied to photo
      const updatedPhoto = doc.getLayer(photo.id);
      expect(updatedPhoto).toBeDefined();

      // Undo in 1 step!
      expect(doc.canUndo).toBe(true);
      doc.undo();

      // Verify complete rollback to pristine initial state
      expect(doc.layers.length).toBe(layerCountBefore);
      expect(doc.getSnapshot().document.children.length).toBe(1);
      expect(doc.getSnapshot().document.children[0].name).toBe("Hero Photo");

      // Redo restores the recipe changes
      expect(doc.canRedo).toBe(true);
      doc.redo();
      expect(doc.layers.length).toBe(layerCountBefore + 1);
    });

    it("executes product drop shadow recipe, placing shadow behind subject and offsetting", () => {
      const doc = new Document({
        name: "E-Commerce",
        width: 1000,
        height: 1000,
      });
      const product = new RasterLayer({
        name: "Shoe Cutout",
        assetId: "asset-shoe",
        width: 500,
        height: 400,
      });
      doc.layers.add(product);
      doc.selectedLayer = product;

      const result = executeRecipe(PRESET_PRODUCT_DROP_SHADOW, doc, {
        shadowOpacity: 0.4,
        offsetX: 25,
        offsetY: 35,
      });

      expect(result.success).toBe(true);
      expect(doc.layers.length).toBe(2);

      // Verify shadow layer position (placed behind product)
      const layers = [...doc.layers];
      const shadowLayer = layers.find((l) => l.name === "Drop Shadow");
      expect(shadowLayer).toBeDefined();
      expect(shadowLayer?.opacity).toBeCloseTo(0.4);
      expect(shadowLayer?.toJSON()).toMatchObject({
        fillOpacity: 1,
        styles: {
          colorOverlay: { enabled: true, color: "#000000", opacity: 1 },
        },
      });
      expect(shadowLayer?.x).toBe(product.x + 25);
      expect(shadowLayer?.y).toBe(product.y + 35);

      // Drop shadow should be before product in back-to-front order
      expect(layers.indexOf(shadowLayer!)).toBeLessThan(
        layers.indexOf(product),
      );

      // 1-step undo removes shadow completely
      doc.undo();
      expect(doc.layers.length).toBe(1);
      expect(doc.layers.at(0)?.name).toBe("Shoe Cutout");
    });

    it("executes watermark stamp preset cleanly", () => {
      const doc = new Document({ name: "Portfolio", width: 800, height: 600 });
      const img = new RasterLayer({
        name: "Artwork",
        assetId: "asset-art",
        width: 800,
        height: 600,
      });
      doc.layers.add(img);

      const result = executeRecipe(PRESET_WATERMARK_STAMP, doc, {
        watermarkText: "© 2026 LUMA PRO",
        fontSize: 32,
        opacity: 0.7,
      });

      expect(result.success).toBe(true);
      expect(doc.layers.length).toBe(2);
      const watermarkLayer = doc.layers.at(1) as TextLayer;
      expect(watermarkLayer.name).toBe("Watermark");
      expect(watermarkLayer.text).toBe("© 2026 LUMA PRO");
      expect(watermarkLayer.opacity).toBeCloseTo(0.7);

      // 1-step undo
      doc.undo();
      expect(doc.layers.length).toBe(1);
    });

    it("aborts execution cleanly without modifying document when plan is invalid", () => {
      const doc = new Document({ name: "Clean Doc", width: 800, height: 600 });
      const layer = new RasterLayer({
        name: "Base",
        assetId: "asset-base",
        width: 800,
        height: 600,
      });
      doc.layers.add(layer);

      const invalidRecipe: Recipe = {
        schemaVersion: RECIPE_SCHEMA_VERSION,
        id: "failing-recipe",
        name: "Failing Recipe",
        description: "Fails dry-run",
        version: 1,
        parameters: [],
        steps: [
          {
            id: "step-fail",
            name: "Invalid Step",
            target: { by: "name", pattern: "MissingLayer" },
            action: { type: "layer.update", patch: { opacity: 0 } },
          },
        ],
      };

      const docBeforeJSON = JSON.stringify(doc.toJSON());
      const revisionBefore = doc.getSnapshot().revision;
      const result = executeRecipe(invalidRecipe, doc);

      expect(result.success).toBe(false);
      expect(result.error).toContain("validation failed");
      expect(JSON.stringify(doc.toJSON())).toBe(docBeforeJSON);
      expect(doc.getSnapshot().revision).toBe(revisionBefore); // No new history entry pushed
    });
  });

  describe("Deterministic Action Recorder (RecipeRecorder)", () => {
    it("records commands, binds semantic targets, and produces portable recipe", () => {
      const doc = new Document({
        name: "Record Test",
        width: 1000,
        height: 800,
      });
      const photo = new RasterLayer({
        name: "Portrait",
        assetId: "asset-portrait",
        width: 1000,
        height: 800,
      });
      doc.layers.add(photo);
      doc.selectedLayer = photo;

      const recorder = new RecipeRecorder();
      recorder.start(photo.id);

      // Perform edits
      const before1 = doc.toJSON();
      doc._dispatch({
        type: "effect.tone",
        id: photo.id,
        values: { exposure: 0.4, contrast: 0.2 },
      });
      const after1 = doc.toJSON();
      recorder.recordCommand(
        {
          type: "effect.tone",
          id: photo.id,
          values: { exposure: 0.4, contrast: 0.2 },
        },
        before1,
        after1,
      );

      // Duplicate layer
      const before2 = doc.toJSON();
      doc._dispatch({
        type: "layer.duplicate",
        id: photo.id,
      });
      const after2 = doc.toJSON();
      recorder.recordCommand(
        { type: "layer.duplicate", id: photo.id },
        before2,
        after2,
      );

      // Stop recording and generate recipe with auto-parameterized tone
      const recipe = recorder.stop({
        name: "Portrait Warm Duplicate",
        description: "Recorded portrait grade and duplicate",
        autoParameterizeTone: true,
      });

      expect(recipe.name).toBe("Portrait Warm Duplicate");
      expect(recipe.steps.length).toBe(2);

      // Step 1: Tone step should target { role: "selected" } and be parameterized!
      const step1 = recipe.steps[0];
      expect(step1.target?.role).toBe("selected");
      expect(step1.action.type).toBe("effect.tone");
      if (step1.action.type === "effect.tone") {
        expect(step1.action.values.exposure).toBe("${exposure}");
        expect(step1.action.values.contrast).toBe("${contrast}");
      }

      // Parameters should be extracted
      expect(recipe.parameters.some((p) => p.name === "exposure")).toBe(true);
      expect(recipe.parameters.some((p) => p.name === "contrast")).toBe(true);

      // Validate the generated recipe
      const validation = validateRecipe(recipe);
      expect(validation.valid).toBe(true);

      // Test portability: execute the recorded recipe on a completely different document with a different layer name!
      const newDoc = new Document({
        name: "Another Project",
        width: 1200,
        height: 900,
      });
      const subject = new RasterLayer({
        name: "New Subject",
        assetId: "asset-subject",
        width: 1200,
        height: 900,
      });
      newDoc.layers.add(subject);
      newDoc.selectedLayer = subject;

      const execResult = executeRecipe(recipe, newDoc, {
        exposure: 0.6,
        contrast: 0.3,
      });

      expect(execResult.success).toBe(true);
      expect(newDoc.layers.length).toBe(2); // Subject + duplicate
      expect(newDoc.canUndo).toBe(true);

      // Rollback on new document
      newDoc.undo();
      expect(newDoc.layers.length).toBe(1);
    });

    it("coalesces consecutive tone adjustments on same layer during recording", () => {
      const doc = createDocument("Coalesce", 800, 600);
      const layer = createRaster("Target", "asset-1", 800, 600);
      doc.children.push(layer);

      const recorder = new RecipeRecorder();
      recorder.start(layer.id);

      // Simulate dragging a slider: 3 consecutive tone events
      recorder.recordCommand(
        { type: "effect.tone", id: layer.id, values: { exposure: 0.1 } },
        doc,
        doc,
      );
      recorder.recordCommand(
        { type: "effect.tone", id: layer.id, values: { exposure: 0.2 } },
        doc,
        doc,
      );
      recorder.recordCommand(
        {
          type: "effect.tone",
          id: layer.id,
          values: { exposure: 0.5, contrast: 0.3 },
        },
        doc,
        doc,
      );

      const steps = recorder.getRecordedSteps();
      expect(steps.length).toBe(1); // Coalesced into 1 step!
      expect(steps[0].action.type).toBe("effect.tone");
      if (steps[0].action.type === "effect.tone") {
        expect(steps[0].action.values).toEqual({
          exposure: 0.5,
          contrast: 0.3,
        });
      }
    });
  });

  describe("EditorApplication Integration (editor.recipes)", () => {
    it("provides recipe service on EditorApplication", () => {
      const app = new EditorApplication();
      expect(app.recipes).toBeDefined();

      const presets = app.recipes.getPresets();
      expect(presets.length).toBeGreaterThanOrEqual(4);

      // Compile plan through service
      const samplePreset = presets[0];
      const plan = app.recipes.compilePlan(samplePreset);
      expect(plan).toBeDefined();

      app.dispose();
    });
  });

  describe("Code Review Findings Remediation & Invariant Tests", () => {
    it("records duplication followed by an edit targeting the duplicate via stepResult", () => {
      const doc = new Document({ width: 800, height: 600 });
      const baseLayer = new RasterLayer({
        name: "Photo",
        width: 800,
        height: 600,
        assetId: "photo-asset",
      });
      doc.layers.add(baseLayer);
      doc.selectedLayer = baseLayer;

      const recorder = new RecipeRecorder();
      recorder.start(baseLayer.id);

      // Duplicate the base layer
      const beforeDup = doc.toJSON();
      baseLayer.duplicate();
      const afterDup = doc.toJSON();
      const dupLayer = doc.layers.at(1)!;

      // Simulate command listener dispatch
      recorder.recordCommand(
        { type: "layer.duplicate", id: baseLayer.id },
        beforeDup,
        afterDup,
      );

      // Now user selects and edits the duplicate layer
      doc.selectedLayer = dupLayer;
      recorder.setSelectedId(dupLayer.id);

      const beforeUpdate = doc.toJSON();
      dupLayer.opacity = 0.5;
      const afterUpdate = doc.toJSON();

      recorder.recordCommand(
        { type: "layer.update", id: dupLayer.id, patch: { opacity: 0.5 } },
        beforeUpdate,
        afterUpdate,
      );

      const steps = recorder.getRecordedSteps();
      expect(steps.length).toBe(2);
      expect(steps[0].action.type).toBe("layer.duplicate");
      expect(steps[0].outputVar).toBeDefined();

      // The second step MUST target by stepResult referencing steps[0].outputVar, NOT role: "selected"!
      expect(steps[1].target).toEqual({
        by: "stepResult",
        stepId: steps[0].id,
      });

      // When compiled and executed as a recipe, it must successfully update the duplicate layer, not the original!
      const recipe = recorder.stop();
      const execResult = executeRecipe(recipe, doc);
      expect(execResult.success).toBe(true);

      // Check that the original layer opacity remains 1.0 and duplicate is 0.5
      const original = doc.layers.at(0)!;
      const duplicate = doc.layers.at(1)!;
      expect(original.opacity).toBe(1);
      expect(duplicate.opacity).toBe(0.5);
    });

    it("disambiguates multiple tone parameters in autoParameterizeTone without collisions", () => {
      const doc = createDocument("TestDoc", 800, 600);
      const layer1 = createRaster("Layer 1", "asset-1", 800, 600);
      const layer2 = createRaster("Layer 2", "asset-2", 800, 600);
      doc.children.push(layer1, layer2);

      const recorder = new RecipeRecorder();
      recorder.start(layer1.id);

      // Adjust tone on layer 1
      recorder.recordCommand(
        {
          type: "effect.tone",
          id: layer1.id,
          values: { exposure: 0.3, contrast: 0.2 },
        },
        doc,
        doc,
      );

      // Adjust tone on layer 2
      recorder.setSelectedId(layer2.id);
      recorder.recordCommand(
        {
          type: "effect.tone",
          id: layer2.id,
          values: { exposure: -0.2, contrast: -0.1 },
        },
        doc,
        doc,
      );

      const recipe = recorder.stop({ autoParameterizeTone: true });
      expect(recipe.parameters.length).toBe(4);
      const paramNames = recipe.parameters.map((p) => p.name);
      expect(new Set(paramNames).size).toBe(4); // All names must be unique!
      expect(paramNames).toContain("exposure");
      expect(paramNames).toContain("contrast");
      expect(paramNames).toContain("exposure_2");
      expect(paramNames).toContain("contrast_2");

      // Recipe validation must pass cleanly without schema errors
      const validation = validateRecipe(recipe);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it("handles transaction unpacking with intermediate document simulation", () => {
      const doc = createDocument("TestDoc", 800, 600);
      const base = createRaster("Background", "asset-bg", 800, 600);
      doc.children.push(base);

      const recorder = new RecipeRecorder();
      recorder.start(base.id);

      const newLayer = createRaster("New Layer", "asset-new", 800, 600);

      // Transaction contains two commands: adding a layer and then updating it
      recorder.recordCommand(
        {
          type: "transaction",
          label: "Test Transaction",
          commands: [
            { type: "layer.add", layer: newLayer },
            { type: "layer.update", id: newLayer.id, patch: { opacity: 0.8 } },
          ],
        },
        doc,
        { ...doc, children: [...doc.children, { ...newLayer, opacity: 0.8 }] },
      );

      const steps = recorder.getRecordedSteps();
      expect(steps.length).toBe(2);
      expect(steps[0].action.type).toBe("layer.add");
      expect(steps[1].action.type).toBe("layer.update");
      // Second step correctly recognizes the layer added in the first command!
      expect(steps[1].target).toEqual({
        by: "stepResult",
        stepId: steps[0].id,
      });
    });

    it("evaluates advanced step conditions including layerExists and layerCountEquals", () => {
      const doc = createDocument("TestDoc", 800, 600);
      const layer1 = createRaster("Subject", "asset-1", 800, 600);
      doc.children.push(layer1);

      // Recipe with layerExists condition
      const recipe: Recipe = {
        schemaVersion: RECIPE_SCHEMA_VERSION,
        id: "cond-test-recipe",
        name: "Condition Test",
        description: "Tests layerExists and layerCount conditions",
        version: 1,
        parameters: [],
        steps: [
          {
            id: "step-1",
            name: "Only if Subject exists",
            condition: {
              op: "layerExists",
              target: { by: "name", pattern: "Subject" },
            },
            target: { by: "name", pattern: "Subject" },
            action: { type: "layer.update", patch: { opacity: 0.5 } },
          },
          {
            id: "step-2",
            name: "Only if NonExistent exists (should be skipped)",
            condition: {
              op: "layerExists",
              target: { by: "name", pattern: "NonExistent" },
            },
            target: { by: "name", pattern: "Subject" },
            action: { type: "layer.update", patch: { opacity: 0.2 } },
          },
          {
            id: "step-3",
            name: "Only if exactly 1 layer exists",
            condition: {
              op: "layerCountEquals",
              value: 1,
            },
            target: { by: "name", pattern: "Subject" },
            action: {
              type: "layer.update",
              patch: { name: "Subject Verified" },
            },
          },
        ],
      };

      const plan = compileEditPlan(recipe, doc, layer1.id);
      expect(plan.valid).toBe(true);
      expect(plan.steps[0].skipped).toBe(false);
      expect(plan.steps[1].skipped).toBe(true);
      expect(plan.steps[1].skipReason).toContain(
        "Target layer specified in condition was not found",
      );
      expect(plan.steps[2].skipped).toBe(false);
    });

    it("resolves expanded target roles including foreground, all, and active-mask", () => {
      const doc = createDocument("TestDoc", 800, 600);
      const bg = createRaster("Background", "asset-bg", 800, 600);
      const mid = createRaster("Midground", "asset-mid", 800, 600);
      const fg = createRaster("Foreground", "asset-fg", 800, 600);
      mid.mask = {
        kind: "paint",
        base: 1,
        strokes: [],
        enabled: true,
        inverted: false,
        density: 1,
      };
      doc.children.push(bg, mid, fg);

      // foreground role
      const resFg = resolveTarget({ role: "foreground" }, doc, null);
      expect(resFg.layer?.name).toBe("Foreground");

      // active-mask role
      const resMask = resolveTarget({ role: "active-mask" }, doc, mid.id);
      expect(resMask.layer?.name).toBe("Midground");

      // all role
      const resAll = resolveTarget({ role: "all" }, doc, null);
      expect(resAll.layer).toBeDefined();

      // allowMultiple flag
      const resMulti = resolveTarget(
        { by: "kind", kind: "raster", allowMultiple: true },
        doc,
        null,
      );
      expect(resMulti.layer).toBeDefined(); // does not fail with ambiguity
    });

    it("respects ignoreLocked flag on semantic targets", () => {
      const doc = createDocument("TestDoc", 800, 600);
      const layer = createRaster("Locked Layer", "asset-1", 800, 600);
      layer.locked = true;
      doc.children.push(layer);

      const recipe: Recipe = {
        schemaVersion: RECIPE_SCHEMA_VERSION,
        id: "locked-test-recipe",
        name: "Locked Test",
        description: "Tests ignoreLocked flag",
        version: 1,
        parameters: [],
        steps: [
          {
            id: "step-1",
            name: "Ignore locked check",
            target: { by: "name", pattern: "Locked Layer", ignoreLocked: true },
            action: { type: "layer.update", patch: { opacity: 0.7 } },
          },
        ],
      };

      const plan = compileEditPlan(recipe, doc, layer.id);
      expect(plan.valid).toBe(true);
      expect(plan.errors).toHaveLength(0);
    });

    it("updates document.selectedLayer to newly created layer upon executeRecipe", () => {
      const doc = new Document({ width: 800, height: 600 });
      const baseLayer = new RasterLayer({
        name: "Base",
        width: 800,
        height: 600,
        assetId: "base-asset",
      });
      doc.layers.add(baseLayer);
      doc.selectedLayer = baseLayer;

      const recipe: Recipe = {
        schemaVersion: RECIPE_SCHEMA_VERSION,
        id: "add-layer-recipe",
        name: "Add Layer Recipe",
        description: "Creates a layer and verifies selection update",
        version: 1,
        parameters: [],
        steps: [
          {
            id: "step-1",
            name: "Duplicate Base",
            target: { role: "selected" },
            action: { type: "layer.duplicate", newName: "Duplicated Layer" },
            outputVar: "dup_out",
          },
        ],
      };

      const res = executeRecipe(recipe, doc);
      expect(res.success).toBe(true);
      expect(doc.selectedLayer?.name).toBe("Duplicated Layer");
    });

    it("rejects unsupported ai.generate steps before execution with descriptive error", () => {
      const doc = new Document({ width: 800, height: 600 });
      doc.layers.add(
        new RasterLayer({
          name: "Base",
          width: 800,
          height: 600,
          assetId: "asset-1",
        }),
      );
      const recipe: Recipe = {
        schemaVersion: RECIPE_SCHEMA_VERSION,
        id: "ai-step-recipe",
        name: "AI Step Recipe",
        description: "Tests ai.generate preflight rejection",
        version: 1,
        parameters: [],
        steps: [
          {
            id: "rename",
            name: "Rename first",
            target: { role: "background" },
            action: {
              type: "layer.update",
              patch: { name: "Should not commit" },
            },
          },
          {
            id: "ai-step-1",
            name: "Generate Background",
            target: { role: "background" },
            action: {
              type: "ai.generate",
              modality: "text-to-image",
              prompt: "Stylized anime background",
              estimatedCostCents: 4.0,
            },
          },
        ],
      };

      const before = doc.toJSON();
      const revision = doc.getSnapshot().revision;
      const result = executeRecipe(recipe, doc);
      expect(doc.toJSON()).toEqual(before);
      expect(doc.getSnapshot().revision).toBe(revision);
      expect(result.success).toBe(false);
      expect(result.error).toContain("ai.generate");
      expect(result.error).toContain(
        "cannot be executed in offline synchronous transactions",
      );
      expect(result.plan.valid).toBe(false);
    });
  });
});

it("replays populated group templates without dropping descendants or reusing IDs", () => {
  const document = new Document({ width: 100, height: 100 });
  const group = createGroup("Artwork");
  const text = createText("Label", "Keep me", { fontSize: 18 });
  text.x = 7;
  group.children.push(text);
  const recipe: Recipe = {
    schemaVersion: 1,
    id: "group-replay",
    name: "Group replay",
    description: "Preserve artwork",
    version: 1,
    parameters: [],
    steps: [
      {
        id: "add",
        name: "Add artwork",
        action: {
          type: "layer.add",
          layerTemplate: { ...group },
        },
      },
    ],
  };
  expect(executeRecipe(recipe, document).success).toBe(true);
  expect(executeRecipe(recipe, document).success).toBe(true);
  const [first, second] = document.toJSON().children;
  expect(first.kind).toBe("group");
  expect(second.kind).toBe("group");
  if (first.kind !== "group" || second.kind !== "group")
    throw new Error("Expected groups");
  expect(first.children[0]).toEqual({ ...text, id: expect.any(String) });
  expect(first.children[0].id).not.toBe(text.id);
  expect(first.children[0].id).not.toBe(second.children[0].id);
  document.undo();
  expect(document.layers.length).toBe(1);
  document.redo();
  expect(document.toJSON().children[1]).toEqual(second);
});

it("replays edits to identically named created layers without alias collisions", () => {
  const source = new Document({ name: "Recording", width: 100, height: 100 });
  const recorder = new RecipeRecorder();
  source.onCommand((command, before, after) =>
    recorder.recordCommand(command, before, after),
  );
  recorder.start();
  const first = new TextLayer({ name: "Text", text: "first" });
  const second = new TextLayer({ name: "Text", text: "second" });
  source.layers.add(first);
  source.layers.add(second);
  first.x = 25;
  const recipe = recorder.stop();
  const destination = new Document({ name: "Replay", width: 100, height: 100 });
  executeRecipe(recipe, destination);
  expect(destination.layers.at(0)?.x).toBe(25);
  expect(destination.layers.at(1)?.x).toBe(0);
});

it.each(["add", "duplicate"])(
  "replays descendant edits after %s and reordering without name ambiguity",
  (mode) => {
    const source = new Document({ name: "Record", width: 100, height: 100 });
    const group = new LayerGroup({ name: "Group" });
    group.layers.add(new TextLayer({ name: "Caption", text: "first" }));
    group.layers.add(new TextLayer({ name: "Caption", text: "second" }));
    if (mode === "duplicate") source.layers.add(group);
    const initial = source.toJSON();
    const recorder = new RecipeRecorder();
    source.onCommand((command, before, after) =>
      recorder.recordCommand(command, before, after),
    );
    source.selectedLayer = mode === "duplicate" ? group : null;
    recorder.start(source.selectedLayer?.id ?? null);
    const created =
      mode === "duplicate" ? (group.duplicate() as LayerGroup) : group;
    if (mode === "add") source.layers.add(created);
    const child = created.layers.at(0)!;
    source._dispatch({ type: "layer.reorder", id: child.id, direction: "up" });
    child.opacity = 0.4;
    const serialized = JSON.parse(JSON.stringify(recorder.stop()));
    const parsed = validateRecipe(serialized);
    expect(parsed.valid).toBe(true);
    const replay = Document.fromJSON(initial);
    if (mode === "duplicate") replay.selectedLayer = replay.layers.at(0)!;
    expect(executeRecipe(parsed.recipe!, replay).success).toBe(true);
    const result = replay.layers.at(replay.layers.length - 1) as LayerGroup;
    expect(result.layers.at(0)?.opacity).toBe(1);
    expect(result.layers.at(1)?.opacity).toBe(0.4);
    replay.undo();
    expect(replay.toJSON()).toEqual(initial);
    replay.redo();
    expect(
      (replay.layers.at(replay.layers.length - 1) as LayerGroup).layers.at(1)
        ?.opacity,
    ).toBe(0.4);
  },
);

it("rejects ambiguous parameter names atomically while accepting explicit IDs or first-match targeting", () => {
  const document = new Document({ width: 100, height: 100 });
  const first = new TextLayer({ name: "Label", text: "First" });
  const second = new TextLayer({ name: "Label", text: "Second" });
  document.layers.add(first);
  document.layers.add(second);
  const recipe: Recipe = {
    schemaVersion: RECIPE_SCHEMA_VERSION,
    id: "ambiguous-parameter",
    name: "Remove label",
    description: "Parameter ambiguity regression",
    version: 1,
    parameters: [
      { name: "target", label: "Target", type: "layer", required: true },
    ],
    steps: [
      {
        id: "rename",
        name: "Earlier valid edit",
        target: { role: "topmost" },
        action: { type: "layer.update", patch: { opacity: 0.5 } },
      },
      {
        id: "remove",
        name: "Remove target",
        target: { by: "parameter", paramName: "target" },
        action: { type: "layer.remove" },
      },
    ],
  };
  const before = document.toJSON();
  const revision = document.getSnapshot().revision;
  for (const ambiguityStrategy of [undefined, "fail"] as const) {
    recipe.steps[1].target!.ambiguityStrategy = ambiguityStrategy;
    const result = executeRecipe(recipe, document, { target: "Label" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("is ambiguous; matches 2 layers");
    expect(document.toJSON()).toEqual(before);
    expect(document.getSnapshot().revision).toBe(revision);
  }
  expect(executeRecipe(recipe, document, { target: second.id }).success).toBe(
    true,
  );
  expect(document.getLayer(first.id)).toBeDefined();
  expect(document.getLayer(second.id)).toBeNull();
  document.undo();
  expect(document.toJSON()).toEqual(before);
  recipe.steps[1].target!.ambiguityStrategy = "first";
  expect(executeRecipe(recipe, document, { target: "Label" }).success).toBe(
    true,
  );
  expect(document.getLayer(first.id)).toBeNull();
  expect(document.getLayer(second.id)).toBeDefined();
  document.undo();
  expect(document.toJSON()).toEqual(before);
});

it("rejects empty recordings without synthesizing a selection-clearing command", () => {
  const recorder = new RecipeRecorder();
  recorder.start();
  expect(() => recorder.stop()).toThrow("No supported actions were recorded");
  expect(recorder.isRecording()).toBe(false);
  expect(recorder.getRecordedSteps()).toEqual([]);
});

it("records document renames and replays them with one undo entry", () => {
  const doc = new Document({ name: "Before", width: 16, height: 16 });
  const recorder = new RecipeRecorder();
  const unhook = doc.onCommand((command, before, after) =>
    recorder.recordCommand(command, before, after),
  );
  recorder.start();
  doc.name = "After";
  const recipe = recorder.stop();
  unhook();
  const target = new Document({ name: "Target", width: 16, height: 16 });
  expect(executeRecipe(recipe, target).success).toBe(true);
  expect(target.name).toBe("After");
  target.undo();
  expect(target.name).toBe("Target");
});

it("refuses partial recordings containing unsupported edits and resets on a new recording", () => {
  const recorder = new RecipeRecorder();
  const doc = createDocument();
  recorder.start();
  recorder.recordCommand(
    { type: "document.rename", name: "Recorded" },
    doc,
    doc,
  );
  recorder.recordCommand({ type: "document.guides", guides: [] }, doc, doc);
  expect(recorder.getUnsupportedCommands()).toEqual(["document.guides"]);
  expect(() => recorder.stop()).toThrow("No partial recipe was saved");
  expect(recorder.isRecording()).toBe(false);
  recorder.start();
  expect(recorder.getUnsupportedCommands()).toEqual([]);
});

it("records effect addition and positional updates for replay on new layer identities", () => {
  const source = createDocument();
  const layer = createRaster("Art", "asset", 16, 16);
  source.children.push(layer);
  const recorder = new RecipeRecorder();
  recorder.start(layer.id);
  const effect = {
    id: "original-effect",
    kind: "tone" as const,
    enabled: true,
    exposure: 0,
    contrast: 0,
    saturation: 0,
  };
  recorder.recordCommand(
    { type: "effect.add", id: layer.id, effect },
    source,
    source,
  );
  layer.effects.push(effect);
  recorder.recordCommand(
    {
      type: "effect.update",
      id: layer.id,
      effectId: effect.id,
      values: { exposure: 1 },
    },
    source,
    source,
  );
  const recipe = recorder.stop();
  expect(validateRecipe(recipe).valid).toBe(true);
  const target = new Document({ width: 16, height: 16 });
  const raster = target.layers.add(
    new RasterLayer({
      name: "Different",
      assetId: "asset",
      width: 16,
      height: 16,
    }),
  );
  target.selectedLayer = raster;
  const before = target.toJSON();
  expect(executeRecipe(recipe, target).success).toBe(true);
  const result = target.toJSON().children[0];
  expect(result.kind === "raster" && result.effects[0].exposure).toBe(1);
  expect(result.kind === "raster" && result.effects[0].id).not.toBe(effect.id);
  target.undo();
  expect(target.toJSON()).toEqual(before);
});

it("applies all-layer steps atomically and refuses a locked member without partial edits", () => {
  const doc = new Document({ width: 16, height: 16 });
  const a = doc.layers.add(new TextLayer({ name: "A", text: "a" }));
  const b = doc.layers.add(new TextLayer({ name: "B", text: "b" }));
  const recipe: Recipe = {
    schemaVersion: 1,
    id: "multi",
    name: "Multi",
    description: "",
    version: 1,
    parameters: [],
    steps: [
      {
        id: "hide",
        name: "Hide",
        target: { role: "all" },
        action: { type: "layer.update", patch: { visible: false } },
      },
    ],
  };
  const before = doc.toJSON();
  const result = executeRecipe(recipe, doc);
  expect(result.success).toBe(true);
  expect(result.plan.summary.layersModified).toBe(2);
  expect(a.visible).toBe(false);
  expect(b.visible).toBe(false);
  doc.undo();
  expect(doc.toJSON()).toEqual(before);
  b.locked = true;
  const locked = doc.toJSON();
  expect(executeRecipe(recipe, doc).success).toBe(false);
  expect(doc.toJSON()).toEqual(locked);
});

it("replays multiple duplicate outputs without including new matches in the same step", () => {
  const doc = new Document({ width: 16, height: 16 });
  doc.layers.add(new TextLayer({ name: "A", text: "a" }));
  doc.layers.add(new TextLayer({ name: "B", text: "b" }));
  const recipe: Recipe = {
    schemaVersion: 1,
    id: "copies",
    name: "Copies",
    description: "",
    version: 1,
    parameters: [],
    steps: [
      {
        id: "copy",
        name: "Copy",
        target: { by: "kind", kind: "text", allowMultiple: true },
        action: { type: "layer.duplicate" },
      },
      {
        id: "hide",
        name: "Hide copies",
        target: { by: "stepResult", stepId: "copy", allowMultiple: true },
        action: { type: "layer.update", patch: { visible: false } },
      },
    ],
  };
  expect(executeRecipe(recipe, doc).success).toBe(true);
  expect(doc.toJSON().children.filter((layer) => !layer.visible)).toHaveLength(
    2,
  );
  expect(doc.toJSON().children).toHaveLength(4);
  doc.undo();
  expect(doc.toJSON().children).toHaveLength(2);
  recipe.steps[1].target!.allowMultiple = false;
  expect(executeRecipe(recipe, doc).success).toBe(false);
  expect(doc.toJSON().children).toHaveLength(2);
});

it("removes matched groups and descendants once and restores the whole tree on undo", () => {
  const doc = new Document({ width: 16, height: 16 });
  const group = doc.layers.add(new LayerGroup({ name: "Group" }));
  group.layers.add(new TextLayer({ text: "Inside" }));
  const before = doc.toJSON();
  const recipe: Recipe = {
    schemaVersion: 1,
    id: "remove",
    name: "Remove",
    description: "",
    version: 1,
    parameters: [],
    steps: [
      {
        id: "remove",
        name: "Remove",
        target: { role: "all" },
        action: { type: "layer.remove" },
      },
    ],
  };
  expect(executeRecipe(recipe, doc).success).toBe(true);
  expect(doc.layers.length).toBe(0);
  doc.undo();
  expect(doc.toJSON()).toEqual(before);
});

it.each(["effect.remove", "effect.reset"] as const)(
  "records and replays %s on portable effect positions with undo",
  (type) => {
    const make = (suffix: string) => {
      const doc = new Document({ width: 16, height: 16 });
      const layer = doc.layers.add(
        new RasterLayer({
          name: "Art",
          assetId: "asset",
          width: 16,
          height: 16,
        }),
      );
      for (let i = 0; i < 2; i++)
        doc._dispatch({
          type: "effect.add",
          id: layer.id,
          effect: {
            id: `${suffix}-${i}`,
            kind: "tone",
            enabled: true,
            exposure: i,
            contrast: 0,
            saturation: 0,
          },
        });
      doc.selectedLayer = layer;
      return { doc, layer };
    };
    const source = make("source");
    const recorder = new RecipeRecorder();
    source.doc.onCommand((command, before, after) =>
      recorder.recordCommand(command, before, after),
    );
    recorder.start(source.layer.id);
    source.doc._dispatch(
      type === "effect.remove"
        ? { type, id: source.layer.id, effectId: "source-0" }
        : { type, id: source.layer.id },
    );
    const recipe = JSON.parse(JSON.stringify(recorder.stop()));
    expect(validateRecipe(recipe).valid).toBe(true);
    const target = make("target");
    const before = target.doc.toJSON();
    expect(executeRecipe(recipe, target.doc).success).toBe(true);
    const data = target.doc.toJSON().children[0];
    expect(
      data.kind === "raster" && data.effects.map((effect) => effect.id),
    ).toEqual(type === "effect.remove" ? ["target-1"] : []);
    target.doc.undo();
    expect(target.doc.toJSON()).toEqual(before);
    if (type === "effect.remove") {
      target.doc._dispatch({ type: "effect.reset", id: target.layer.id });
      const empty = target.doc.toJSON();
      expect(executeRecipe(recipe, target.doc).success).toBe(false);
      expect(target.doc.toJSON()).toEqual(empty);
    }
  },
);

it.each(["12px", " ", Infinity, -Infinity, NaN, true, [12], { value: 12 }])(
  "rejects malformed numeric recipe input atomically: %s",
  (value) => {
    const doc = new Document({ width: 16, height: 16 });
    doc.layers.add(new TextLayer({ name: "Target", text: "Keep" }));
    const recipe: Recipe = {
      schemaVersion: 1,
      id: "strict-number",
      name: "Strict",
      description: "",
      version: 1,
      parameters: [
        { name: "amount", label: "Amount", type: "number", required: true },
      ],
      steps: [
        {
          id: "rename",
          name: "Rename",
          action: { type: "document.rename", name: "Should not commit" },
        },
        {
          id: "move",
          name: "Move",
          target: { role: "all" },
          action: { type: "layer.update", patch: { x: "${amount}" } },
        },
      ],
    };
    const before = doc.toJSON();
    const revision = doc.getSnapshot().revision;
    const result = executeRecipe(recipe, doc, { amount: value });
    expect(result.success).toBe(false);
    expect(result.plan.errors.join(" ")).toContain("finite decimal");
    expect(doc.toJSON()).toEqual(before);
    expect(doc.getSnapshot().revision).toBe(revision);
  },
);

it("parses false explicitly and rejects ambiguous booleans before conditional steps", () => {
  const recipe: Recipe = {
    schemaVersion: 1,
    id: "strict-bool",
    name: "Strict",
    description: "",
    version: 1,
    parameters: [
      { name: "enabled", label: "Enabled", type: "boolean", required: true },
    ],
    steps: [
      {
        id: "rename",
        name: "Rename",
        condition: { param: "enabled", op: "truthy" },
        action: { type: "document.rename", name: "Enabled" },
      },
    ],
  };
  const doc = new Document({ name: "Original" });
  expect(executeRecipe(recipe, doc, { enabled: "false" }).success).toBe(true);
  expect(doc.name).toBe("Original");
  expect(executeRecipe(recipe, doc, { enabled: "yes" }).success).toBe(false);
  expect(doc.name).toBe("Original");
  expect(executeRecipe(recipe, doc, { enabled: "true" }).success).toBe(true);
  expect(doc.name).toBe("Enabled");
});

it("rejects missing recipe source assets before host execution mutates the document", () => {
  const editor = new EditorApplication();
  const recipe: Recipe = {
    schemaVersion: 1,
    id: "missing-artwork",
    name: "Missing artwork",
    description: "",
    version: 1,
    parameters: [],
    steps: [
      {
        id: "rename",
        name: "Rename",
        action: { type: "document.rename", name: "Must not commit" },
      },
      {
        id: "add",
        name: "Add artwork",
        action: {
          type: "layer.add",
          layerTemplate: {
            kind: "raster",
            name: "Artwork",
            assetId: "unavailable-source",
            width: 16,
            height: 16,
          },
        },
      },
    ],
  };
  const before = editor.document.toJSON();
  const revision = editor.document.getSnapshot().revision;
  const plan = editor.recipes.compilePlan(recipe);
  expect(plan.valid).toBe(false);
  expect(plan.errors.join(" ")).toContain("unavailable-source");
  expect(editor.recipes.execute(recipe).success).toBe(false);
  expect(editor.document.toJSON()).toEqual(before);
  expect(editor.document.getSnapshot().revision).toBe(revision);
});

it("reconciles coalesced recording steps with undo, redo and a new history branch", () => {
  const editor = new EditorApplication();
  const layer = editor.document.layers.add(
    new TextLayer({ name: "Art", text: "Art" }),
  );
  editor.document.selectedLayer = layer;
  editor.recipes.startRecording();
  layer.opacity = 0.5;
  layer.opacity = 0.25;
  editor.document.undo();
  expect(editor.recipes.recorder.getRecordedSteps()[0].action).toMatchObject({
    patch: { opacity: 0.5 },
  });
  editor.document.redo();
  expect(editor.recipes.recorder.getRecordedSteps()[0].action).toMatchObject({
    patch: { opacity: 0.25 },
  });
  editor.document.undo();
  layer.visible = false;
  const recipe = editor.recipes.recorder.stop();
  const target = new Document();
  const copy = target.layers.add(new TextLayer({ name: "Art", text: "Art" }));
  target.selectedLayer = copy;
  expect(executeRecipe(recipe, target).success).toBe(true);
  expect(copy.opacity).toBe(0.5);
  expect(copy.visible).toBe(false);
  editor.dispose();
});

it("tracks a whole transaction as one recording history entry and restores created-layer targets on redo", () => {
  const editor = new EditorApplication();
  editor.recipes.startRecording();
  let layer!: TextLayer;
  editor.document.transaction("Add artwork", () => {
    layer = editor.document.layers.add(
      new TextLayer({ name: "Caption", text: "Caption" }),
    );
    layer.opacity = 0.5;
  });
  editor.document.undo();
  expect(editor.recipes.recorder.getRecordedSteps()).toHaveLength(0);
  editor.document.redo();
  layer.visible = false;
  const recipe = editor.recipes.recorder.stop();
  const target = new Document();
  expect(executeRecipe(recipe, target).success).toBe(true);
  expect(target.layers.at(0)?.visible).toBe(false);
  expect(target.layers.at(0)?.opacity).toBe(0.5);
  editor.dispose();
});

it("keeps paused edits aligned with history and blocks navigation before recording started", () => {
  const editor = new EditorApplication();
  const layer = editor.document.layers.add(new TextLayer({ text: "Art" }));
  editor.document.selectedLayer = layer;
  editor.recipes.startRecording();
  layer.opacity = 0.5;
  editor.recipes.pauseRecording();
  layer.visible = false;
  editor.document.undo();
  editor.recipes.resumeRecording();
  expect(editor.recipes.recorder.getRecordedSteps()).toHaveLength(1);
  editor.document.undo();
  expect(editor.recipes.recorder.getRecordedSteps()).toHaveLength(0);
  editor.document.undo(); // Undo the pre-recording layer creation.
  expect(() => editor.recipes.recorder.stop()).toThrow("recording boundary");
  editor.dispose();
});

it.each(["Art*", "Art?", "${targetName}"])(
  "records literal layer name %s and preserves one-step undo",
  (name) => {
    const source = new Document({ name: "Source" });
    const selected = new LayerGroup({ name: "Selected" });
    const target = new LayerGroup({ name });
    const other = new LayerGroup({ name: "Artwork" });
    source.layers.add(selected);
    source.layers.add(target);
    source.layers.add(other);
    source.selectedLayer = selected;
    const recorder = new RecipeRecorder();
    recorder.start(selected.id);
    const unhook = source.onCommand((command, before, after) =>
      recorder.recordCommand(command, before, after),
    );
    target.opacity = 0.5;
    const recipe = recorder.stop();
    unhook();
    source.undo();
    const parsed = validateRecipe(JSON.parse(JSON.stringify(recipe)));
    expect(parsed.valid).toBe(true);
    expect(parsed.recipe!.steps[0].target).toMatchObject({
      by: "name",
      pattern: name,
      literal: true,
    });
    const result = executeRecipe(parsed.recipe!, source, {
      targetName: "Artwork",
    });
    expect(result.success).toBe(true);
    expect(target.opacity).toBe(0.5);
    expect(other.opacity).toBe(1);
    source.undo();
    expect(target.opacity).toBe(1);
    source.redo();
    expect(target.opacity).toBe(0.5);
    const multiple = structuredClone(parsed.recipe!);
    multiple.steps[0].target!.allowMultiple = true;
    expect(
      compileEditPlan(multiple, source.toJSON(), selected.id).resolvedCommands,
    ).toHaveLength(1);
  },
);

it.each([false, true])(
  "tests all surviving recipe outputs in existence conditions (descendants: %s)",
  (descendants) => {
    const document = new Document({ name: "Original" });
    for (const name of ["A", "B"]) {
      if (descendants) {
        const group = document.layers.add(new LayerGroup({ name }));
        group.layers.add(new TextLayer({ name: `${name} child`, text: name }));
      } else document.layers.add(new TextLayer({ name, text: name }));
    }
    const before = document.toJSON();
    const output = {
      by: "stepResult" as const,
      stepId: "copies",
      allowMultiple: true,
      ...(descendants ? { childPath: [0] } : {}),
    };
    const recipe: Recipe = {
      schemaVersion: RECIPE_SCHEMA_VERSION,
      id: "surviving-outputs",
      name: "Surviving outputs",
      version: 1,
      description: "",
      parameters: [],
      steps: [
        {
          id: "duplicate",
          outputVar: "copies",
          name: "Duplicate",
          target: {
            by: "kind",
            kind: descendants ? "group" : "text",
            allowMultiple: true,
          },
          action: { type: "layer.duplicate" },
        },
        {
          id: "remove-last",
          name: "Remove last copy",
          target: { role: "topmost" },
          action: { type: "layer.remove" },
        },
        {
          id: "rename",
          name: "A copy remains",
          condition: { op: "layerExists", target: output },
          action: { type: "document.rename", name: "Survivor" },
        },
        {
          id: "remove-rest",
          name: "Remove remaining copies",
          target: { by: "name", pattern: "* copy", allowMultiple: true },
          action: { type: "layer.remove" },
        },
        {
          id: "absent",
          name: "No copy remains",
          condition: { op: "layerExists", target: output },
          action: { type: "document.rename", name: "Incorrect" },
        },
      ],
    };
    expect(validateRecipe(recipe).valid).toBe(true);
    const plan = compileEditPlan(recipe, before);
    expect(plan.valid).toBe(true);
    expect(plan.steps.find((step) => step.stepId === "rename")?.skipped).toBe(
      false,
    );
    expect(plan.steps.find((step) => step.stepId === "absent")?.skipped).toBe(
      true,
    );
    expect(executeRecipe(recipe, document).success).toBe(true);
    expect(document.name).toBe("Survivor");
    document.undo();
    expect(document.toJSON()).toEqual(before);
    document.redo();
    expect(document.name).toBe("Survivor");
  },
);

it("replays recorded HSL creation and edits and rejects invalid preset parameters atomically", () => {
  const editor = new EditorApplication();
  editor.recipes.startRecording();
  const layer = editor.document.layers.add(
    new AdjustmentLayer({
      adjustment: { kind: "hsl", hue: 0, saturation: 0, lightness: 0 },
    }),
  );
  layer.adjustment = { kind: "hsl", hue: 120, saturation: 15, lightness: -10 };
  const recipe = editor.recipes.recorder.stop();
  const parsed = validateRecipe(JSON.parse(JSON.stringify(recipe)));
  expect(parsed.valid).toBe(true);
  const target = new Document();
  const before = target.toJSON();
  expect(executeRecipe(parsed.recipe!, target).success).toBe(true);
  expect((target.layers.at(0) as AdjustmentLayer).adjustment).toEqual(
    layer.adjustment,
  );
  target.undo();
  expect(target.toJSON()).toEqual(before);
  target.redo();
  const preset = BUILTIN_PRESETS.find(
    (item) => item.id === "preset-hsl-recolor",
  )!;
  const snapshot = target.toJSON();
  expect(executeRecipe(preset, target, { hue: 181 }).success).toBe(false);
  expect(target.toJSON()).toEqual(snapshot);
  expect(
    executeRecipe(preset, target, {
      hue: "-120",
      saturation: "25",
      lightness: "10",
    }).success,
  ).toBe(true);
  expect((target.layers.at(1) as AdjustmentLayer).adjustment).toEqual({
    kind: "hsl",
    hue: -120,
    saturation: 25,
    lightness: 10,
  });
  editor.dispose();
});

it("monochrome preset uses the tone engine percentage scale and preserves undo", () => {
  const recipe = BUILTIN_PRESETS.find(
    (item) => item.id === "preset-high-contrast-bw",
  )!;
  expect(recipe.version).toBe(2);
  const doc = new Document();
  const layer = doc.layers.add(
    new RasterLayer({ assetId: "source", width: 10, height: 10 }),
  );
  doc.selectedLayer = layer;
  const before = doc.toJSON();
  expect(executeRecipe(recipe, doc).success).toBe(true);
  expect(layer.toJSON()).toMatchObject({
    effects: [
      expect.objectContaining({
        kind: "tone",
        saturation: -100,
        contrast: 45,
        exposure: 0.1,
      }),
    ],
  });
  doc.undo();
  expect(doc.toJSON()).toEqual(before);
  expect(executeRecipe(recipe, doc, { contrast: 101 }).success).toBe(false);
  expect(doc.toJSON()).toEqual(before);
});

it("recipe service returns detached built-in definitions across lookups and editor sessions", () => {
  const first = new EditorApplication(),
    second = new EditorApplication();
  try {
    const original = structuredClone(
      first.recipes.getRecipe("preset-hsl-recolor")!,
    );
    const list = first.recipes.getPresets();
    const recipe = list.find((item) => item.id === original.id)!;
    recipe.name = "Changed by caller";
    recipe.parameters[0].default = 180;
    recipe.steps.length = 0;
    list.length = 0;
    expect(first.recipes.getRecipe(original.id)).toEqual(original);
    expect(second.recipes.getRecipe(original.id)).toEqual(original);
    const all = first.recipes.getAllRecipes();
    all.find((item) => item.id === original.id)!.steps[0].name = "Modified";
    const single = first.recipes.getRecipe(original.id)!;
    single.parameters.length = 0;
    expect(first.recipes.getRecipe(original.id)).toEqual(original);
    const result = first.recipes.execute(
      first.recipes.getRecipe(original.id)!,
      { hue: 120 },
    );
    expect(result.success).toBe(true);
    expect((first.document.layers.at(0) as AdjustmentLayer).adjustment).toEqual(
      { kind: "hsl", hue: 120, saturation: 0, lightness: 0 },
    );
  } finally {
    first.dispose();
    second.dispose();
  }
});

it("replays recorded literal action values while retaining deliberate tone bindings", () => {
  const document = new Document({ name: "Before" });
  const raster = document.layers.add(
    new RasterLayer({
      name: "Image",
      assetId: "source",
      width: 16,
      height: 16,
    }),
  );
  const text = document.layers.add(
    new TextLayer({ name: "Label", text: "Before" }),
  );
  document.selectedLayer = raster;
  const before = document.toJSON();
  const recorder = new RecipeRecorder();
  recorder.start(raster.id);
  const unhook = document.onCommand((command, previous, next) =>
    recorder.recordCommand(command, previous, next),
  );
  raster.name = "Literal ${exposure}";
  text.text = "${exposure} / ${custom} / $$";
  document.name = "Project ${exposure}";
  document._dispatch({
    type: "effect.tone",
    id: raster.id,
    values: { exposure: 1 },
  });
  const recipe = recorder.stop({ autoParameterizeTone: true });
  unhook();
  for (let i = 0; i < 4; i++) document.undo();
  expect(document.toJSON()).toEqual(before);
  const parsed = validateRecipe(JSON.parse(JSON.stringify(recipe)));
  expect(parsed.valid).toBe(true);
  const result = executeRecipe(parsed.recipe!, document, {
    exposure: 2,
    custom: "REPLACED",
  });
  expect(result.success).toBe(true);
  expect(raster.name).toBe("Literal ${exposure}");
  expect(text.text).toBe("${exposure} / ${custom} / $$");
  expect(document.name).toBe("Project ${exposure}");
  const replayed = raster.toJSON();
  expect(replayed.kind === "raster" && replayed.effects[0].exposure).toBe(2);
  document.undo();
  expect(document.toJSON()).toEqual(before);
  document.redo();
  expect(text.text).toBe("${exposure} / ${custom} / $$");
});
