import { test, expect } from "@playwright/test";

test("missing fonts warn without changing the document, and choosing a generic removes the warning", async ({
  page,
}) => {
  await page.goto("/");
  const before = await page.evaluate(() => {
    const { editor, TextLayer } = window.luma;
    editor.newDocument({ width: 200, height: 100 });
    editor.document.selectedLayer = editor.document.layers.add(
      new TextLayer({
        text: "Missing font",
        fontFamily: "Luma Font That Does Not Exist 928471",
      }),
    );
    return JSON.stringify(editor.document.toJSON());
  });
  await expect(page.locator(".font-fallback-warning")).toContainText(
    "could not be loaded locally",
  );
  await expect(page.getByLabel("Font", { exact: true })).toHaveValue(
    "Luma Font That Does Not Exist 928471",
  );
  expect(
    await page.evaluate(() =>
      JSON.stringify(window.luma.editor.document.toJSON()),
    ),
  ).toBe(before);
  await page.getByLabel("Font", { exact: true }).selectOption("sans-serif");
  await expect(page.locator(".font-fallback-warning")).toHaveCount(0);
  await page.evaluate(() => window.luma.editor.document.undo());
  await expect(page.locator(".font-fallback-warning")).toBeVisible();
  const probe = await page.evaluate(async () => {
    const { fontAvailability } = await import(
      /* @vite-ignore */ String("/src/ui/font-availability.ts")
    );
    return {
      generic: await fontAvailability("monospace"),
      missing: await fontAvailability("Luma Font That Does Not Exist 928471"),
      stack: await fontAvailability("Arial, sans-serif"),
    };
  });
  expect(probe).toEqual({
    generic: "available",
    missing: "unavailable",
    stack: "unknown",
  });
});

test("late font loading invalidates cached text without editing document history", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { editor, TextLayer } = window.luma;
    const doc = editor.newDocument({ width: 400, height: 120 });
    doc.selectedLayer = doc.layers.add(
      new TextLayer({
        text: "iiii WWWW",
        fontFamily: "Luma Late Font Test",
        fontSize: 32,
        x: 10,
        y: 10,
      }),
    );
    const before = JSON.stringify(doc.toJSON()),
      history = doc.getSnapshot().past.length;
    const pixels = async (cache: boolean) => {
      const surface = await editor.renderer.render(
        doc.toJSON(),
        editor.assetStore,
        { cache, readback: true },
      );
      const data = [
        ...surface.getContext("2d")!.getImageData(0, 0, 400, 120).data,
      ];
      surface.width = surface.height = 0;
      return data;
    };
    const fallback = await pixels(true);
    const face = new FontFace(
      "Luma Late Font Test",
      "url(/node_modules/@fontsource/dm-mono/files/dm-mono-latin-400-normal.woff2)",
    );
    const loaded = new Promise<void>((resolve) =>
      document.fonts.addEventListener("loadingdone", () => resolve(), {
        once: true,
      }),
    );
    document.fonts.add(face);
    await document.fonts.load('32px "Luma Late Font Test"');
    await loaded;
    const cached = await pixels(true),
      fresh = await pixels(false);
    const { measureTextBounds } = await import(
      /* @vite-ignore */ String("/src/core/model.ts")
    );
    const expected = measureTextBounds(
      "iiii WWWW",
      32,
      "Luma Late Font Test",
      1.2,
    ).width;
    return {
      width: (
        doc.selectedLayer!.toJSON() as import("../src/core/model").TextLayerData
      ).width,
      expected,
      changed: cached.some((value, index) => value !== fallback[index]),
      equal: cached.every((value, index) => value === fresh[index]),
      unchanged: JSON.stringify(doc.toJSON()) === before,
      history: doc.getSnapshot().past.length - history,
    };
  });
  expect(result).toMatchObject({
    changed: true,
    equal: true,
    unchanged: true,
    history: 0,
  });
  expect(result.expected).not.toBe(result.width);
  await page.getByRole("button", { name: "Reflow text", exact: true }).click();
  expect(
    await page.evaluate(
      () =>
        (
          window.luma.editor.document.selectedLayer!.toJSON() as import("../src/core/model").TextLayerData
        ).width,
    ),
  ).toBe(result.expected);
  await page.evaluate(() => window.luma.editor.document.undo());
  expect(
    await page.evaluate(
      () =>
        (
          window.luma.editor.document.selectedLayer!.toJSON() as import("../src/core/model").TextLayerData
        ).width,
    ),
  ).toBe(result.width);
  await page.evaluate(() => window.luma.editor.document.redo());
  expect(
    await page.evaluate(
      () =>
        (
          window.luma.editor.document.selectedLayer!.toJSON() as import("../src/core/model").TextLayerData
        ).width,
    ),
  ).toBe(result.expected);
});

test("custom font family entry commits once, cancels with Escape and persists without changing other text", async ({
  page,
}) => {
  await page.goto("/");
  const initial = await page.evaluate(() => {
    const { editor, TextLayer } = window.luma;
    editor.newDocument({ width: 200, height: 100 });
    const layer = editor.document.layers.add(
      new TextLayer({
        text: "Family selection",
        fontFamily: "serif",
        fontSize: 24,
      }),
    );
    editor.document.selectedLayer = layer;
    return {
      history: editor.document.getSnapshot().past.length,
      text: layer.text,
    };
  });
  const input = page.getByRole("textbox", { name: "Font family", exact: true });
  await input.fill("Luma Custom Family 293847");
  await input.press("Escape");
  await expect(input).toHaveValue("serif");
  await input.fill("Luma Custom Family 293847");
  await input.press("Enter");
  await expect(page.locator(".font-fallback-warning")).toBeVisible();
  const result = await page.evaluate(async () => {
    const { editor } = window.luma;
    const history = editor.document.getSnapshot().past.length;
    editor.document.undo();
    const undone = editor.document.selectedLayer!.toJSON();
    editor.document.redo();
    const file = await editor.saveProject();
    await editor.openProject(new File([file], "font-family.luma"));
    return {
      history,
      undone,
      restored: editor.document.layers.at(0)!.toJSON(),
    };
  });
  expect(result.history).toBe(initial.history + 1);
  expect(result.undone).toMatchObject({
    fontFamily: "serif",
    text: initial.text,
    fontSize: 24,
  });
  expect(result.restored).toMatchObject({
    fontFamily: "Luma Custom Family 293847",
    text: initial.text,
    fontSize: 24,
  });
});
