import { test, expect } from "@playwright/test";
import {layerControlsWorkflow} from './helpers/layer-controls';

test('layer glyphs and controls stay current through typing, history and group changes', async ({page},info) => {
  await layerControlsWorkflow(page,info);
});

test("filters nested layers without changing selection, history, or collapsed state", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("search", { name: "Filter layers" }),
  ).toBeVisible();
  const baseline = await page.evaluate(() => {
    const { editor, LayerGroup, TextLayer, PaintLayer } = window.luma;
    const group = new LayerGroup({ name: "Collection" });
    group.layers.add(new TextLayer({ name: "Blue label", text: "Hello" }));
    group.layers.add(new PaintLayer({ name: "Paint marks" }));
    editor.document.layers.add(group);
    const selected = editor.document.layers.add(
      new TextLayer({ name: "Outside title", text: "Outside" }),
    );
    editor.document.selectedLayer = selected;
    return editor.document.getSnapshot().revision;
  });
  await page.getByRole("button", { name: "Toggle Collection" }).click();
  await expect(
    page.getByRole("button", { name: "Select Blue label", exact: true }),
  ).not.toBeVisible();
  await page
    .getByRole("textbox", { name: "Search layers", exact: true })
    .fill("blue");
  await expect(
    page.getByRole("button", { name: "Select Collection", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Select Blue label", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Select Paint marks", exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByText("Selected layer: Outside title. Outside current filter."),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => window.luma.editor.document.getSnapshot().revision,
    ),
  ).toBe(baseline);
  await page.getByLabel("Layer type", { exact: true }).selectOption("paint");
  await expect(
    page.getByText("No matching layers.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Select Blue label", exact: true }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "Toggle Collection" }).click();
  await page.evaluate(() => {
    const group = window.luma.editor.document.layers.at(0)!;
    group.visible = false;
    group.locked = true;
  });
  await page
    .getByLabel("Layer visibility", { exact: true })
    .selectOption("hidden");
  await page
    .getByLabel("Layer locking", { exact: true })
    .selectOption("locked");
  await page.getByLabel("Layer type", { exact: true }).selectOption("text");
  await expect(
    page.getByRole("button", { name: "Select Blue label", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Select Outside title", exact: true }),
  ).not.toBeVisible();
  await page
    .getByRole("button", { name: "Select Blue label", exact: true })
    .click();
  expect(
    await page.evaluate(() => window.luma.editor.document.selectedLayer?.name),
  ).toBe("Blue label");
  await expect(
    page.getByRole("button", { name: "Delete layer (Delete)", exact: true }),
  ).toBeDisabled();
});
