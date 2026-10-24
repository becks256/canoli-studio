import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";

test("repeated source reloads preserve editor identity and recipe recovery", async ({ page }, info) => {
  const failures: { path: string; error: string | null }[] = [];
  const pageErrors: string[] = [];
  const loads: { index: number; identity: boolean; modules: number }[] = [];
  let modules = new Set<string>();
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/src/") && request.resourceType() === "script") {
      modules.add(url.pathname);
    }
  });
  page.on("requestfailed", request => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/src/")) {
      failures.push({ path: url.pathname, error: request.failure()?.errorText ?? null });
    }
  });
  page.on("pageerror", error => pageErrors.push(error.message));
  try {
    for (let index = 0; index < 6; index++) {
      modules = new Set();
      if (index === 0) await page.goto("/");
      else await page.reload();
      await expect(page.getByRole("button", { name: "Move tool (V)", exact: true })).toBeVisible();
      const identity = await page.evaluate(async () => {
        const { Document } = await import(/* @vite-ignore */ String("/src/dom/index.ts"));
        return Document === window.luma.Document && window.luma.editor.document instanceof Document;
      });
      expect(identity).toBe(true);
      await page.getByRole("button", { name: "Recipes", exact: true }).click();
      const dialog = page.locator(".recipe-dialog");
      await expect(dialog).toBeVisible();
      if (index > 0) {
        await expect(dialog.getByRole("alert")).toContainText("Saved data was preserved");
        await expect(dialog.getByRole("button", { name: "Export unreadable library" })).toBeVisible();
      }
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      loads.push({ index, identity, modules: modules.size });
      if (index === 0) {
        await page.evaluate(() => localStorage.setItem("luma_custom_recipes_v1", "{unreadable-library"));
      }
    }
    expect(failures).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await writeFile(info.outputPath("reload-diagnostics.json"), JSON.stringify({ loads, failures, pageErrors }, null, 2));
  }
});
