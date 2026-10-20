import { test, expect } from "@playwright/test";

test("panel resizing supports pointer, keyboard, cancellation, reload and reset without document edits", async ({
  page,
}) => {
  await page.goto("/");
  const handle = page.getByRole("separator", {
    name: "Resize layers panel",
    exact: true,
  });
  await expect(handle).toBeVisible();
  const before = await page.evaluate(() =>
    JSON.stringify(window.luma.editor.document.toJSON()),
  );
  const initial = Number(await handle.getAttribute("aria-valuenow"));
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + 3, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 73, box.y + 100);
  await page.mouse.up();
  await expect(handle).toHaveAttribute("aria-valuenow", String(initial + 70));
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem("luma.panel-widths.v1")!).layers,
      ),
    )
    .toBe(initial + 70);
  await handle.focus();
  await page.keyboard.press("ArrowRight");
  await expect(handle).toHaveAttribute("aria-valuenow", String(initial + 80));
  const moved = (await handle.boundingBox())!;
  await page.mouse.move(moved.x + 3, moved.y + 100);
  await page.mouse.down();
  await page.mouse.move(moved.x + 33, moved.y + 100);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(handle).toHaveAttribute("aria-valuenow", String(initial + 80));
  expect(
    await page.evaluate(() =>
      JSON.stringify(window.luma.editor.document.toJSON()),
    ),
  ).toBe(before);
  await page.reload();
  await expect(handle).toHaveAttribute("aria-valuenow", String(initial + 80));
  await handle.dblclick();
  await expect(handle).toHaveAttribute("aria-valuenow", String(initial));
  const inspector = page.getByRole("separator", {
    name: "Resize inspector panel",
    exact: true,
  });
  const originalInspector = Number(
    await inspector.getAttribute("aria-valuenow"),
  );
  await inspector.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(inspector).toHaveAttribute(
    "aria-valuenow",
    String(originalInspector + 10),
  );
});

test("panel constraints retain canvas space and a failed save restores prior width", async ({
  page,
}) => {
  await page.goto("/");
  const handle = page.getByRole("separator", {
    name: "Resize layers panel",
    exact: true,
  });
  await handle.focus();
  await page.keyboard.press("End");
  await page.setViewportSize({ width: 900, height: 900 });
  const bounds = await page.locator(".canvas-column").boundingBox();
  expect(bounds!.width).toBeGreaterThanOrEqual(200);
  await page.setViewportSize({ width: 760, height: 900 });
  await expect.poll(async () => (await page.locator(".canvas-column").boundingBox())!.width).toBeGreaterThanOrEqual(200);
  const before = await handle.getAttribute("aria-valuenow");
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "luma.panel-widths.v1") throw new Error("quota");
      return original.call(this, key, value);
    };
  });
  await handle.focus();
  await page.keyboard.press("Home");
  await expect(page.getByRole("alert")).toContainText(
    "Panel layout could not be saved",
  );
  await expect(handle).toHaveAttribute("aria-valuenow", before!);
});
