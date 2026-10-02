import { test, expect } from "@playwright/test";

test("custom shortcuts persist, update hints and preserve typing and resets", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Keyboard shortcuts (?)", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  const move = dialog.locator('[data-action="move"]');
  await move
    .getByRole("button", { name: "Change Move tool shortcut", exact: true })
    .click();
  await page.keyboard.press("b");
  await expect(dialog.getByRole("alert")).toContainText("conflicts");
  await page.keyboard.press("x");
  await expect(move.locator("kbd")).toHaveText("X");
  await dialog
    .getByRole("button", { name: "Close keyboard shortcuts" })
    .click();
  await expect(
    page.getByRole("button", { name: "Move tool (X)", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Brush tool (B)", exact: true })
    .click();
  await page.keyboard.press("x");
  await expect(
    page.getByRole("button", { name: "Move tool (X)", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Move tool (X)", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Brush tool (B)", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Document name", exact: true })
    .fill("x");
  await expect(
    page.getByRole("button", { name: "Brush tool (B)", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", { name: "Keyboard shortcuts (?)", exact: true })
    .click();
  await move
    .getByRole("button", { name: "Clear Move tool shortcut", exact: true })
    .click();
  await expect(move.locator("kbd")).toHaveText("Unassigned");
  await move
    .getByRole("button", { name: "Reset Move tool shortcut", exact: true })
    .click();
  await expect(move.locator("kbd")).toHaveText("V");
  await move
    .getByRole("button", { name: "Change Move tool shortcut", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(move.locator("kbd")).toHaveText("V");
});

test("storage failures preserve active bindings and malformed preferences expose recovery", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("luma.shortcut-bindings.v1", "{broken"),
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "Keyboard shortcuts (?)", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog
    .getByRole("button", { name: "Restore default shortcuts" })
    .click();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "luma.shortcut-bindings.v1")
        throw new Error("Preferences storage unavailable");
      return original.call(this, key, value);
    };
  });
  await dialog
    .locator('[data-action="move"]')
    .getByRole("button", { name: "Change Move tool shortcut" })
    .click();
  await page.keyboard.press("x");
  await expect(dialog.getByRole("alert")).toContainText("storage unavailable");
  await expect(dialog.locator('[data-action="move"] kbd')).toHaveText("V");
});
