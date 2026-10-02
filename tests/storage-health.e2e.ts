import { expect, test } from "@playwright/test";

test("recovery shows storage estimates and requests persistence only on explicit action", async ({
  page,
}) => {
  await page.addInitScript(() => {
    let granted = false;
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: {
        estimate: async () => ({ usage: 2 * 1024 ** 2, quota: 8 * 1024 ** 2 }),
        persisted: async () => granted,
        persist: async () => {
          (window as any).persistCalls =
            ((window as any).persistCalls ?? 0) + 1;
          granted = true;
          return true;
        },
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Recover work", exact: true }).click();
  const panel = page.getByRole("region", { name: "Browser storage" });
  await expect(panel.getByText("2 MiB", { exact: true })).toBeVisible();
  await expect(panel.getByText("8 MiB", { exact: true })).toBeVisible();
  await expect(panel.getByText("6 MiB", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).persistCalls ?? 0)).toBe(0);
  await panel
    .getByRole("button", { name: "Request persistent storage" })
    .click();
  await expect(panel.getByText("Granted", { exact: true })).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Request persistent storage" }),
  ).toBeDisabled();
  expect(await page.evaluate(() => (window as any).persistCalls)).toBe(1);
  await page.evaluate(() => {
    navigator.storage.estimate = async () => ({
      usage: 3 * 1024 ** 2,
      quota: 8 * 1024 ** 2,
    });
  });
  await panel.getByRole("button", { name: "Refresh storage estimate" }).click();
  await expect(panel.getByText("3 MiB", { exact: true })).toBeVisible();
  await expect(panel.getByText("5 MiB", { exact: true })).toBeVisible();
});

test("storage API failure and persistence denial leave recovery controls usable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: {
        estimate: async () => {
          throw new Error("Unavailable");
        },
        persisted: async () => false,
        persist: async () => false,
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Recover work", exact: true }).click();
  const panel = page.getByRole("region", { name: "Browser storage" });
  await expect(
    panel.getByText("Storage usage could not be read."),
  ).toBeVisible();
  await panel
    .getByRole("button", { name: "Request persistent storage" })
    .click();
  await expect(panel).toContainText("did not grant persistent storage");
  await expect(panel.getByText("Not granted", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download current project", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Save workspace", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Save workspace", exact: true })
    .click();
  await expect(
    page.getByText(
      "Workspace saved in this browser, including tab order and canvas views.",
    ),
  ).toBeVisible();
});
