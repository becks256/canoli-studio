import { expect, test } from "@playwright/test";

test("isolated scripts create guides that survive crop, undo and project reopening", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const editor = window.luma.editor;
    editor.newDocument({ width: 200, height: 200 });
    await editor.runScript(`
      document.guides.add(new Guide({ id: 'vertical', orientation: 'vertical', position: 25.5 }));
      document.guides.add(new Guide({ id: 'horizontal', orientation: 'horizontal', position: 80 }));
    `);
    const expected = editor.document.toJSON();
    const saved = await editor.saveProject();
    editor.document._dispatch({
      type: "document.crop",
      bounds: { x: 30, y: 40, width: 100, height: 100 },
    });
    const cropped = editor.document.guides.items.map((guide) => guide.position);
    editor.document.undo();
    const undone =
      JSON.stringify(expected) === JSON.stringify(editor.document.toJSON());
    await editor.runScript(`document.guides.clear();`);
    await editor.openProject(new File([saved], "guides.luma"));
    return { cropped, undone, guides: editor.document.toJSON().guides };
  });
  expect(result.cropped).toEqual([-4.5, 40]);
  expect(result.undone).toBe(true);
  expect(result.guides).toEqual([
    { id: "vertical", orientation: "vertical", position: 25.5 },
    { id: "horizontal", orientation: "horizontal", position: 80 },
  ]);
});

test("guide controls create, edit, hide and delete with keyboard input and undo", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() =>
    window.luma.editor.newDocument({ width: 200, height: 200 }),
  );
  await page.keyboard.press("Control+1");
  const panel = page.getByRole("region", { name: "Guides", exact: true });
  await panel.getByRole("button", { name: /Guides/ }).click();
  await panel
    .getByRole("spinbutton", { name: "New guide position", exact: true })
    .fill("25.5");
  await panel
    .getByRole("spinbutton", { name: "New guide position", exact: true })
    .press("Enter");
  await panel.getByRole("button", { name: "Add guide", exact: true }).click();
  await expect(page.locator(".document-guide.vertical")).toHaveCSS(
    "left",
    "25.5px",
  );
  await panel
    .getByRole("spinbutton", { name: "Guide 1 position", exact: true })
    .fill("40");
  await panel
    .getByRole("spinbutton", { name: "Guide 1 position", exact: true })
    .press("Enter");
  await panel
    .getByRole("combobox", { name: "Guide 1 orientation", exact: true })
    .selectOption("horizontal");
  await expect(page.locator(".document-guide.horizontal")).toHaveCSS(
    "top",
    "40px",
  );
  const revision = await page.evaluate(
    () => window.luma.editor.document.getSnapshot().revision,
  );
  await panel.getByRole("checkbox", { name: "Show guides" }).uncheck();
  await expect(page.locator(".document-guide")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => window.luma.editor.document.getSnapshot().revision,
    ),
  ).toBe(revision);
  await panel.getByRole("checkbox", { name: "Show guides" }).check();
  await panel
    .getByRole("button", { name: "Delete guide 1", exact: true })
    .click();
  await expect(page.locator(".document-guide")).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(page.locator(".document-guide.horizontal")).toHaveCSS(
    "top",
    "40px",
  );
  await panel
    .getByRole("button", { name: "Clear guides", exact: true })
    .click();
  await expect(page.locator(".document-guide")).toHaveCount(0);
});

test("guide dragging previews without history, commits once and cancels on Escape or intervening edits", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const editor = window.luma.editor;
    editor.newDocument({ width: 200, height: 200 });
    await editor.runScript(
      `document.guides.add(new Guide({ id: 'drag', orientation: 'vertical', position: 40 }));`,
    );
  });
  await page
    .getByRole("button", { name: "Move tool (V)", exact: true })
    .click();
  await page.keyboard.press("Control+1");
  const canvas = (await page.locator(".canvas-wrap").boundingBox())!;
  const revision = await page.evaluate(
    () => window.luma.editor.document.getSnapshot().revision,
  );
  const start = async (x: number) => {
    await page.mouse.move(canvas.x + x, canvas.y + 80);
    await page.mouse.down();
  };
  await start(40);
  await page.mouse.move(canvas.x + 70, canvas.y + 80);
  await expect(page.locator(".document-guide")).toHaveCSS("left", "70px");
  expect(
    await page.evaluate(
      () => window.luma.editor.document.getSnapshot().revision,
    ),
  ).toBe(revision);
  await page.mouse.up();
  expect(
    await page.evaluate(
      () => window.luma.editor.document.getSnapshot().revision,
    ),
  ).toBe(revision + 1);
  await page.keyboard.press("Control+z");
  await expect(page.locator(".document-guide")).toHaveCSS("left", "40px");
  await start(40);
  await page.mouse.move(canvas.x + 80, canvas.y + 80);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.locator(".document-guide")).toHaveCSS("left", "40px");
  await start(40);
  await page.mouse.move(canvas.x + 90, canvas.y + 80);
  await page.evaluate(() => {
    window.luma.editor.document.name = "Intervening edit";
  });
  const changed = await page.evaluate(
    () => window.luma.editor.document.getSnapshot().revision,
  );
  await page.mouse.up();
  await expect(page.locator(".document-guide")).toHaveCSS("left", "40px");
  expect(
    await page.evaluate(
      () => window.luma.editor.document.getSnapshot().revision,
    ),
  ).toBe(changed);
  await page.locator(".document-guide").focus();
  await page.keyboard.press("Shift+ArrowRight");
  await expect(page.locator(".document-guide")).toHaveCSS("left", "50px");
});

test("rulers create guides by dragging and keyboard with cancellable previews", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() =>
    window.luma.editor.newDocument({ width: 200, height: 200 }),
  );
  await page.keyboard.press("Control+1");
  const canvas = (await page.locator(".canvas-wrap").boundingBox())!;
  const ruler = page.getByRole("button", {
    name: "Horizontal ruler",
    exact: true,
  });
  const bounds = (await ruler.boundingBox())!;
  const start = async () => {
    await page.mouse.move(canvas.x + 60, bounds.y + 10);
    await page.mouse.down();
  };
  const revision = await page.evaluate(
    () => window.luma.editor.document.getSnapshot().revision,
  );
  await start();
  await page.mouse.move(canvas.x + 60, canvas.y + 75);
  await expect(page.locator(".ruler-guide-preview")).toBeVisible();
  expect(
    await page.evaluate(
      () => window.luma.editor.document.getSnapshot().revision,
    ),
  ).toBe(revision);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(
    await page.evaluate(() => window.luma.editor.document.guides.length),
  ).toBe(0);
  await start();
  await page.mouse.move(canvas.x + 60, canvas.y + 75);
  await page.mouse.up();
  const guide = await page.evaluate(() =>
    window.luma.editor.document.guides.items[0].toJSON(),
  );
  expect(guide.orientation).toBe("horizontal");
  expect(guide.position).toBeCloseTo(75, 0);
  expect(
    await page.evaluate(
      () => window.luma.editor.document.getSnapshot().revision,
    ),
  ).toBe(revision + 1);
  await page.keyboard.press("Control+z");
  expect(
    await page.evaluate(() => window.luma.editor.document.guides.length),
  ).toBe(0);
  await page
    .getByRole("button", { name: "Vertical ruler", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  expect(
    await page.evaluate(
      () => window.luma.editor.document.guides.items[0].position,
    ),
  ).toBe(100);
});
