import { test, expect } from "@playwright/test";

test("canvas snapping shows guides, commits once, and Alt bypasses it", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const editor = window.luma.editor;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 20;
    canvas.getContext("2d")!.fillRect(0, 0, 20, 20);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((value) => resolve(value!)),
    );
    const layer = await editor.importImage(
      new File([blob], "Snap", { type: "image/png" }),
    );
    editor.document.resize(200, 200);
    layer.update({ x: 50, y: 50 });
  });
  await page
    .getByRole("button", { name: "Move tool (V)", exact: true })
    .click();
  await page.keyboard.press("Control+1");
  const snap = page.getByRole("checkbox", {
    name: "Snap to canvas and guides",
  });
  await expect(snap).not.toBeChecked();
  await snap.check();
  const box = (await page.locator(".canvas-wrap").boundingBox())!;
  const revision = await page.evaluate(
    () => window.luma.editor.document.getSnapshot().revision,
  );
  await page.mouse.move(box.x + 60, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 107, box.y + 60, { steps: 3 });
  await expect(page.locator(".snap-guide.vertical")).toBeVisible();
  expect(
    await page.evaluate(
      () => window.luma.editor.document.getSnapshot().revision,
    ),
  ).toBe(revision);
  await page.mouse.up();
  expect(
    await page.evaluate(() => window.luma.editor.document.selectedLayer!.x),
  ).toBe(100);
  await expect(page.locator(".snap-guide")).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await page.keyboard.down("Alt");
  await page.mouse.move(box.x + 60, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 107, box.y + 60, { steps: 3 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  expect(
    await page.evaluate(() => window.luma.editor.document.selectedLayer!.x),
  ).toBe(97);
});

test("artwork snapping aligns to a stationary layer without snapping to the moving selection", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const editor = window.luma.editor;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 20;
    canvas.getContext("2d")!.fillRect(0, 0, 20, 20);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((value) => resolve(value!)),
    );
    const moving = await editor.importImage(
      new File([blob], "Moving", { type: "image/png" }),
    );
    editor.document.resize(400, 300);
    moving.update({ x: 50, y: 50 });
    const target = moving.duplicate();
    target.update({ x: 123, y: 50 });
    editor.document.selectedLayer = moving;
  });
  await page
    .getByRole("button", { name: "Move tool (V)", exact: true })
    .click();
  await page.keyboard.press("Control+1");
  await page
    .getByRole("checkbox", { name: "Snap to canvas and guides" })
    .check();
  await page.getByRole("checkbox", { name: "Include artwork" }).check();
  const box = (await page.locator(".canvas-wrap").boundingBox())!;
  await page.mouse.move(box.x + 60, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 130, box.y + 60, { steps: 4 });
  await expect(page.locator(".snap-guide.vertical")).toHaveCSS("left", "123px");
  await page.mouse.up();
  expect(
    await page.evaluate(() => window.luma.editor.document.selectedLayer!.x),
  ).toBe(123);
  await page.keyboard.press("Control+z");
  expect(
    await page.evaluate(() => window.luma.editor.document.selectedLayer!.x),
  ).toBe(50);
});

test("authored guides render at document coordinates and attract moves with Alt bypass", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const editor = window.luma.editor;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 20;
    canvas.getContext("2d")!.fillRect(0, 0, 20, 20);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((value) => resolve(value!)),
    );
    const layer = await editor.importImage(
      new File([blob], "Moving", { type: "image/png" }),
    );
    editor.document.resize(400, 300);
    layer.update({ x: 50, y: 50 });
    await editor.runScript(
      `document.guides.add(new Guide({ orientation: 'vertical', position: 123 }));`,
    );
  });
  await page
    .getByRole("button", { name: "Move tool (V)", exact: true })
    .click();
  await page.keyboard.press("Control+1");
  await expect(page.locator(".document-guide.vertical")).toHaveCSS(
    "left",
    "123px",
  );
  await page
    .getByRole("checkbox", { name: "Snap to canvas and guides" })
    .check();
  const box = (await page.locator(".canvas-wrap").boundingBox())!;
  const drag = async () => {
    await page.mouse.move(box.x + 60, box.y + 60);
    await page.mouse.down();
    await page.mouse.move(box.x + 130, box.y + 60, { steps: 3 });
    await page.mouse.up();
  };
  await drag();
  expect(
    await page.evaluate(() => window.luma.editor.document.selectedLayer!.x),
  ).toBe(123);
  await page.keyboard.press("Control+z");
  await page.keyboard.down("Alt");
  await drag();
  await page.keyboard.up("Alt");
  expect(
    await page.evaluate(() => window.luma.editor.document.selectedLayer!.x),
  ).toBe(120);
  await expect(page.locator(".document-guide.vertical")).toBeVisible();
});
