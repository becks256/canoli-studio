import { test, expect } from "@playwright/test";
test.use({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
test("float text groundwork guide keeps implementation and remaining native text work explicit without JavaScript", async ({
  page,
}) => {
  await page.goto("/developer/float-text.html");
  await expect(
    page.getByRole("heading", {
      name: "Native float text — implementation in progress",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator("main")).toContainText(
    "Schema 60 now connects the existing TextLayer and Text tool",
  );
  await expect(page.locator("main")).toContainText(
    "first requested family to be a declared FontFile",
  );
  await expect(page.locator("main")).toContainText("source-linear glyph paint");
  await expect(page.locator("main")).toContainText(
    "All 384 fallback layouts/36 independent references",
  );
  await expect(page.locator("main")).toContainText(
    "it has no native text renderer or browser synchronization",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
