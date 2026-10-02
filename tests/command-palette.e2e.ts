import { test, expect } from "@playwright/test";

test("palette searches shared commands, navigates, and keeps typed shortcuts off the canvas", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Find a command (Mod+K)" }),
  ).toBeEnabled();
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Find a command" });
  const search = dialog.getByRole("combobox", { name: "Search commands" });
  await expect(search).toBeFocused();
  await dialog.screenshot({ path: "/tmp/luma-command-palette.png" });
  await search.fill("brush");
  await expect(
    page.getByRole("button", { name: "Move tool (V)", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await search.fill("pencil tool");
  await page.keyboard.press("Enter");
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Pencil tool (N)", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const trigger = page.getByRole("button", { name: "Find a command (Mod+K)" });
  await trigger.click();
  await search.fill("tool");
  const initial = await search.getAttribute("aria-activedescendant");
  await page.keyboard.press("ArrowDown");
  expect(await search.getAttribute("aria-activedescendant")).not.toBe(initial);
  await page.keyboard.press("Home");
  expect(await search.getAttribute("aria-activedescendant")).toBe(initial);
  await search.fill("unfindablexyz");
  await expect(dialog.getByRole("status")).toHaveText("No matching commands.");
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});

test("palette respects disabled actions and opens another dialog cleanly", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Find a command (Mod+K)" }),
  ).toBeEnabled();
  await page.keyboard.press("Control+k");
  const search = page.getByRole("combobox", { name: "Search commands" });
  await search.fill("undo");
  const undo = page.getByRole("option").filter({ hasText: "Undo" });
  await expect(undo).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Enter");
  await expect(search).toBeVisible();
  await search.fill("keyboard shortcuts");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "Keyboard shortcuts" }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Close keyboard shortcuts" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  const name = page.getByLabel("Document name", { exact: true });
  await name.focus();
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("palette layer creation and undo use the shared document history", async ({
  page,
}) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Find a command (Mod+K)" });
  await trigger.click();
  await page
    .getByRole("combobox", { name: "Search commands" })
    .fill("new layer");
  await page.keyboard.press("Enter");
  expect(
    await page.evaluate(() => window.luma.editor.document.layers.length),
  ).toBe(1);
  await trigger.click();
  await page.getByRole("combobox", { name: "Search commands" }).fill("undo");
  await page.keyboard.press("Enter");
  expect(
    await page.evaluate(() => window.luma.editor.document.layers.length),
  ).toBe(0);
});
