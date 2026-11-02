import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import {
  historyProject,
  historyScript,
  historyPng,
} from "./helpers/history-inspector";

for (const tool of ["brush", "pencil"] as const)
  test(
    "production editable float " +
      tool +
      " uses real controls, native delivery, cancellation and shared Undo without developer globals",
    async ({ page }, info) => {
      await page.goto("/");
      expect(await page.evaluate(() => "luma" in window)).toBe(false);
      await page
        .getByTestId("import-input")
        .setInputFiles("tests/fixtures/tiff-float/rgba-raw-le.tif");
      const dialog = page.getByRole("dialog", {
        name: "Import TIFF",
        exact: true,
      });
      await dialog
        .getByLabel("TIFF editing precision", { exact: true })
        .selectOption("float32");
      await dialog
        .getByRole("button", { name: "Import TIFF page", exact: true })
        .click();
      await expect(dialog).toHaveCount(0);
      await historyScript(
        page,
        "document.layers.at(0).visible=false;document.selectedLayer=document.layers.at(0);",
        "Paint ready",
      );
      await page.keyboard.press(tool === "brush" ? "b" : "n");
      await page.keyboard.press("Control+1");
      for (const [label, value] of [
        ["Size value", "8"],
        ["Tool opacity value", "64.123"],
        ...(tool === "brush"
          ? [
              ["Hardness value", "100"],
              ["Flow value", "100"],
            ]
          : []),
      ]) {
        const input = page.getByRole("spinbutton", {
          name: label,
          exact: true,
        });
        await input.fill(value);
        await input.press("Enter");
      }
      await page
        .getByLabel("Foreground color", { exact: true })
        .fill("#208040");
      await page
        .getByRole("checkbox", { name: "Pressure controls size", exact: true })
        .uncheck();
      const before = await historyProject(page, info, "before.luma"),
        box = (await page.locator(".canvas-wrap").boundingBox())!,
        point = { x: box.x + 20.5, y: box.y + 20.5 };
      await page.mouse.move(point.x, point.y);
      await page.mouse.down();
      await page.waitForTimeout(100);
      await page.keyboard.press("Escape");
      await page.mouse.up();
      expect(
        (await historyProject(page, info, "cancelled.luma")).value.document,
      ).toEqual(before.value.document);
      await page.mouse.click(point.x, point.y);
      await expect(
        page.getByRole("button", { name: "Save project", exact: true }),
      ).toBeEnabled();
      const after = await historyProject(page, info, "paint.luma"),
        paint = after.value.document.children.find(
          (layer) => layer.kind === "paint",
        );
      if (paint?.kind !== "paint") throw new Error("No editable paint");
      expect(paint.strokes).toHaveLength(1);
      const stroke = paint.strokes[0];
      if (stroke.kind === "wet" || stroke.kind === "fill")
        throw new Error("Not an editable dry brush");
      expect(stroke.kind).toBe(tool);
      expect(stroke.opacity).toBe(64.123 / 100);
      const raster = after.value.document.children.find(
        (layer) => layer.kind === "raster",
      );
      if (raster?.kind !== "raster") throw new Error("No original");
      expect(
        Buffer.from(
          await after.value.entries
            .find((entry) => entry.id === raster.assetId)!
            .blob.arrayBuffer(),
        ),
      ).toEqual(await readFile("tests/fixtures/tiff-float/rgba-raw-le.tif"));
      const tiff = async (name: string) => {
        await page
          .getByRole("button", { name: "Export…", exact: true })
          .click();
        const exportDialog = page.locator(".export-dialog");
        await exportDialog
          .getByLabel("Format", { exact: true })
          .selectOption("tiff");
        await exportDialog
          .getByLabel("TIFF precision", { exact: true })
          .selectOption("float32");
        await exportDialog
          .getByLabel("Use output RGB profile for high-precision TIFF", {
            exact: true,
          })
          .uncheck();
        const pending = page.waitForEvent("download");
        await exportDialog
          .getByRole("button", { name: "Export .tif", exact: true })
          .click();
        await (await pending).saveAs(info.outputPath(name + ".tif"));
        await expect(exportDialog).toHaveCount(0);
      };
      await tiff("paint");
      await page
        .getByRole("button", { name: "Undo (Mod+Z)", exact: true })
        .click();
      expect(
        (await historyProject(page, info, "undo.luma")).value.document,
      ).toEqual(before.value.document);
      await page
        .getByRole("button", { name: "Redo (Mod+Shift+Z)", exact: true })
        .click();
      expect(
        (await historyProject(page, info, "redo.luma")).value.document,
      ).toEqual(after.value.document);
      await page.getByTestId("project-input").setInputFiles(after.path);
      expect(
        (await historyProject(page, info, "reopened.luma")).value.document,
      ).toEqual(after.value.document);
      await tiff("reopened");
      await writeFile(
        info.outputPath("float-paint-production.json"),
        JSON.stringify(
          {
            tool,
            stroke,
            oneUndo: true,
            sourceExact: true,
            debugGlobals: false,
          },
          null,
          2,
        ),
      );
      if (tool === "pencil") {
        const reference = spawnSync(
          "python3",
          ["scripts/check-float-paint.py", info.outputDir],
          { encoding: "utf8", timeout: 120000 },
        );
        expect(reference.status, reference.stderr || reference.stdout).toBe(0);
        await writeFile(
          info.outputPath("independent-native-paint.json"),
          reference.stdout,
        );
      }
      expect(await page.evaluate(() => "luma" in window)).toBe(false);
    },
  );

test.describe("native paint guide", () => {
  test.use({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  test("documents editable linear paint without JavaScript", async ({
    page,
  }) => {
    await page.goto("/developer/float-paint.html");
    await expect(
      page.getByRole("heading", {
        name: "Editable linear float paint",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator("main")).toContainText(
      "Stroke opacity remains a separate",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
});

test("production Action Recorder captures and replays actual new float paint placement through one Undo", async ({
  page,
}, info) => {
  await page.goto("/");
  expect(await page.evaluate(() => "luma" in window)).toBe(false);
  await page
    .getByTestId("import-input")
    .setInputFiles("tests/fixtures/tiff-float/rgba-raw-le.tif");
  const tiff = page.getByRole("dialog", { name: "Import TIFF", exact: true });
  await tiff
    .getByLabel("TIFF editing precision", { exact: true })
    .selectOption("float32");
  await tiff
    .getByRole("button", { name: "Import TIFF page", exact: true })
    .click();
  await expect(tiff).toHaveCount(0);
  await page
    .getByRole("button", { name: "Select rgba-raw-le.tif", exact: true })
    .click();
  const before = await historyProject(page, info, "record-before.luma");
  await page.getByRole("button", { name: "Recipes", exact: true }).click();
  let recipes = page.locator(".recipe-dialog");
  await recipes
    .getByRole("tab", { name: "Action Recorder", exact: true })
    .click();
  await recipes
    .getByLabel("Recipe Name", { exact: true })
    .fill("Native draw replay");
  await recipes
    .getByRole("button", { name: "Start Recording", exact: true })
    .click();
  await recipes.getByRole("button", { name: "Close", exact: true }).click();
  await page.keyboard.press("n");
  await page.keyboard.press("Control+1");
  const box = (await page.locator(".canvas-wrap").boundingBox())!;
  await page.mouse.click(box.x + 20.5, box.y + 20.5);
  await page.getByRole("button", { name: "Recipes", exact: true }).click();
  recipes = page.locator(".recipe-dialog");
  await recipes.getByRole("tab", { name: /Action Recorder/ }).click();
  await recipes
    .getByRole("button", { name: "Stop & Save Recipe", exact: true })
    .click();
  await expect(
    recipes.getByRole("heading", { name: "Native draw replay", exact: true }),
  ).toBeVisible();
  const pending = page.waitForEvent("download");
  await recipes
    .locator(".recipe-card")
    .filter({ hasText: "Native draw replay" })
    .getByRole("button", { name: "Export Recipe", exact: true })
    .click();
  const path = info.outputPath("native-draw.recipe.json");
  await (await pending).saveAs(path);
  const recipe = JSON.parse(await readFile(path, "utf8"));
  expect(
    recipe.steps.map((step: { action: { type: string } }) => step.action.type),
  ).toEqual(["layer.add", "layer.place", "paint.add"]);
  await recipes.getByRole("button", { name: "Close", exact: true }).click();
  const authored = await historyPng(page, info, "record-authored.png");
  await page.getByRole("button", { name: "Undo (Mod+Z)", exact: true }).click();
  expect(
    (await historyProject(page, info, "record-undo.luma")).value.document,
  ).toEqual(before.value.document);
  await page
    .getByRole("button", { name: "Select rgba-raw-le.tif", exact: true })
    .click();
  await page.getByRole("button", { name: "Recipes", exact: true }).click();
  recipes = page.locator(".recipe-dialog");
  await recipes
    .locator(".recipe-card")
    .filter({ hasText: "Native draw replay" })
    .click();
  await expect(
    recipes.getByRole("heading", { name: "Native draw replay", exact: true }),
  ).toBeVisible();
  await recipes
    .getByRole("button", { name: "Run Recipe", exact: true })
    .click();
  await expect(
    recipes.getByText(
      'Executed "Native draw replay" successfully in 1 atomic step. Undo available with Mod+Z.',
      { exact: true },
    ),
  ).toBeVisible();
  await recipes.getByRole("button", { name: "Close", exact: true }).click();
  expect((await historyPng(page, info, "record-replayed.png")).bytes).toEqual(
    authored.bytes,
  );
  await page.getByRole("button", { name: "Undo (Mod+Z)", exact: true }).click();
  expect(
    (await historyProject(page, info, "record-replay-undo.luma")).value
      .document,
  ).toEqual(before.value.document);
  expect(await page.evaluate(() => "luma" in window)).toBe(false);
});
