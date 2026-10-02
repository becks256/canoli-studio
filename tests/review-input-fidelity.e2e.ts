import { expect, test } from "@playwright/test";

test("recorded literal selectors survive saved recipes and undo without editing wildcard neighbours", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const editor = window.luma.editor;
    const { TextLayer } = await import(
      /* @vite-ignore */ String("/src/dom/index.ts")
    );
    const { validateRecipe } = await import(
      /* @vite-ignore */ String("/src/ai/recipes/schema.ts")
    );
    editor.newDocument({ width: 100, height: 100 });
    const selected = editor.document.layers.add(
      new TextLayer({ name: "Selected", text: "Selected" }),
    );
    const target = editor.document.layers.add(
      new TextLayer({ name: "Art*${name}", text: "Artwork" }),
    );
    const neighbour = editor.document.layers.add(
      new TextLayer({ name: "Artwork", text: "Other" }),
    );
    editor.document.selectedLayer = selected;
    editor.recipes.startRecording();
    target.opacity = 0.25;
    const recipe = await editor.recipes.stopRecording({
      name: "Literal name replay",
    });
    editor.document.undo();
    const restored = validateRecipe(JSON.parse(JSON.stringify(recipe))).recipe!;
    const applied = editor.recipes.execute(restored, { name: "work" });
    const values = [target.opacity, neighbour.opacity];
    editor.document.undo();
    return {
      success: applied.success,
      values,
      undone: [target.opacity, neighbour.opacity],
      target: restored.steps[0].target,
    };
  });
  expect(result).toEqual({
    success: true,
    values: [0.25, 1],
    undone: [1, 1],
    target: { by: "name", pattern: "Art*${name}", literal: true },
  });
});

test("decoded PNG output must match requested generation dimensions", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { StagedAssetRepository } = await import(
      /* @vite-ignore */ String("/src/ai/jobs/staging.ts")
    );
    const staging = new StagedAssetRepository();
    const canvas = document.createElement("canvas");
    canvas.width = 2;
    canvas.height = 3;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#ff0000";
    context.fillRect(0, 0, 2, 3);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((value) => resolve(value!), "image/png"),
    );
    const output = {
      id: "wrong",
      providerId: "test",
      width: 2,
      height: 3,
      hasAlpha: false,
      imageData: new Uint8Array(await blob.arrayBuffer()),
      mimeType: "image/png",
      durationMs: 1,
      costCents: 1,
    };
    const wrong = await staging.stageCandidate("wrong-job", output, {
      prompt: "Requested",
      modality: "text-to-image",
      targetWidth: 1024,
      targetHeight: 1024,
    });
    const right = await staging.stageCandidate(
      "right-job",
      { ...output, id: "right" },
      {
        prompt: "Requested",
        modality: "text-to-image",
        targetWidth: 2,
        targetHeight: 3,
      },
    );
    const result = { wrong: wrong.validation, right: right.validation };
    staging.discard(wrong.id);
    staging.discard(right.id);
    return result;
  });
  expect(result.wrong.valid).toBe(false);
  expect(result.wrong.errors.join(" ")).toContain(
    "do not match requested dimensions",
  );
  expect(result.right).toMatchObject({
    valid: true,
    decodedWidth: 2,
    decodedHeight: 3,
  });
});
