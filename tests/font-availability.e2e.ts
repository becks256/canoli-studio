import { test, expect } from "@playwright/test";
import {writeFile} from 'node:fs/promises';

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

test("system font discovery is explicit, deduplicated, refreshable and preserves undo", async ({ page }) => {
  await page.addInitScript(() => {
    let calls = 0;
    Object.defineProperty(window, "queryLocalFonts", { configurable: true, value: async () => {
      calls++;
      if (calls === 1) throw new DOMException("Denied", "NotAllowedError");
      return [{family:"DejaVu Sans"}, {family:"DejaVu Sans"}, {family:"DejaVu Serif"}];
    }});
  });
  await page.goto("/");
  const before = await page.evaluate(() => {
    const {editor, TextLayer} = window.luma;
    editor.newDocument({width:200,height:100});
    editor.document.selectedLayer = editor.document.layers.add(new TextLayer({text:"Fonts",fontFamily:"serif"}));
    return JSON.stringify(editor.document.toJSON());
  });
  const picker = page.getByLabel("Font", {exact:true});
  await expect(picker.locator('option[value="DejaVu Sans"]')).toHaveCount(0);
  await page.getByRole("button", {name:"Access system fonts"}).click();
  await expect(page.getByText("System fonts could not be accessed.", {exact:false})).toBeVisible();
  await page.getByRole("button", {name:"Access system fonts"}).click();
  await expect(picker.locator('option[value="DejaVu Sans"]')).toHaveCount(1);
  expect(await page.evaluate(() => JSON.stringify(window.luma.editor.document.toJSON()))).toBe(before);
  await picker.selectOption("DejaVu Sans");
  await page.evaluate(() => window.luma.editor.document.undo());
  await expect(picker).toHaveValue("serif");
  await page.getByRole("button", {name:"Refresh system fonts"}).click();
  await expect(picker.locator('option[value="DejaVu Serif"]')).toHaveCount(1);
});

test("unsupported font enumeration retains manual family entry", async ({ page }) => {
  await page.addInitScript(() => { delete (window as unknown as {queryLocalFonts?: unknown}).queryLocalFonts; });
  await page.goto("/");
  await page.evaluate(() => {
    const {editor, TextLayer} = window.luma;
    editor.document.selectedLayer = editor.document.layers.add(new TextLayer({text:"Fonts"}));
  });
  await expect(page.getByText("This browser cannot list installed fonts.", {exact:false})).toBeVisible();
  await expect(page.getByRole("textbox", {name:"Font family", exact:true})).toBeEnabled();
});


test("real installed fonts populate the picker and change rendered text", async ({ page, context }) => {
  await page.goto("/");
  const cdp = await context.newCDPSession(page);
  const {targetInfo}=await cdp.send('Target.getTargetInfo');
  expect(targetInfo.browserContextId).toBeTruthy();
  await cdp.send("Browser.setPermission", {
    permission: { name: "local-fonts" },
    setting: "granted",
    origin: new URL(page.url()).origin,
    browserContextId: targetInfo.browserContextId,
  });
  expect(await page.evaluate(async()=>(await navigator.permissions.query({name:'local-fonts' as PermissionName})).state)).toBe('granted');
  await page.evaluate(() => {
    const { editor, TextLayer } = window.luma;
    editor.newDocument({ width: 400, height: 120 });
    editor.document.selectedLayer = editor.document.layers.add(new TextLayer({
      text: "iiii WWWW", fontFamily: "monospace", fontSize: 32,
    }));
  });
  const pixels = () => page.evaluate(async () => {
    const { editor } = window.luma;
    const canvas = await editor.renderer.render(editor.document.getSnapshot().document,
      editor.assetStore, { cache: false, readback: true });
    const data = Array.from(canvas.getContext("2d")!.getImageData(0, 0, 400, 120).data);
    canvas.width = canvas.height = 0;
    return data;
  });
  const before = await pixels();
  await page.getByRole("button", { name: "Access system fonts", exact: true }).click();
  const picker = page.getByLabel("Font", { exact: true });
  const empty = page.getByText("No fonts were shared.", { exact: false });
  await expect(page.getByRole("status").filter({ hasText: /installed font families available|No fonts were shared/ })).toBeVisible();
  test.skip(await empty.isVisible(), "This Chromium environment returns no local fonts, even with permission granted.");
  const families=await page.evaluate(async()=>[...new Set((await (window as unknown as {queryLocalFonts():Promise<{family:string}[]>}).queryLocalFonts()).map(font=>font.family).filter(Boolean))]);
  const options=await picker.locator('option').evaluateAll(nodes=>nodes.map(node=>(node as HTMLOptionElement).value));
  for(const family of families)expect(options.filter(value=>value===family)).toHaveLength(1);
  // This family is installed in the Linux browser test environment.
  await expect(picker.locator('option[value="DejaVu Serif"]')).toHaveCount(1);
  await picker.selectOption("DejaVu Serif");
  expect(await pixels()).not.toEqual(before);
  await page.evaluate(() => window.luma.editor.document.undo());
  expect(await pixels()).toEqual(before);
  await writeFile('/tmp/canoli-text-spacing-installed-fonts.json',JSON.stringify({permission:'granted',contextScoped:true,familyCount:families.length,allFamiliesPresentOnce:true,selected:'DejaVu Serif',glyphsChanged:true,undoPixelsExact:true},null,2)+'\n');
  await cdp.detach();
});
