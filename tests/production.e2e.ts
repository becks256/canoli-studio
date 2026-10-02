import { test, expect } from "@playwright/test";

test("docs highlight examples without JavaScript and keep long code keyboard-scrollable", async ({
  browser,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  try {
    for (const [path, languages] of [
      ["scripting-api", ["javascript"]],
      ["api", ["bash", "http", "json"]],
      ["plugins", ["json"]],
    ] as const) {
      await page.goto(`http://127.0.0.1:4173/developer/${path}.html`);
      for (const language of languages) {
        const code = page
          .locator(`.syntax-highlighter code.language-${language}`)
          .first();
        await expect(code).toBeVisible();
        expect(
          await code.locator('span[class^="hljs-"]').count(),
        ).toBeGreaterThan(0);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    await page.goto("http://127.0.0.1:4173/developer/scripting-api.html");
    // Native focusable pre retains text selection/copy and horizontal keyboard scrolling.
    const pre = page.locator(".syntax-highlighter pre").first();
    await pre.focus();
    await expect(pre).toBeFocused();
    await expect(pre).toHaveAttribute("aria-label", "JavaScript code example");
    expect(
      await pre.evaluate((node) => node.scrollWidth > node.clientWidth),
    ).toBe(true);
    await page.keyboard.press("End");
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(() => pre.evaluate((node) => node.scrollLeft))
      .toBeGreaterThan(0);
  } finally {
    await context.close();
  }
});

test("production docs, fragment links and installed plugin commands work without developer globals", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  expect(await page.evaluate(() => "luma" in window)).toBe(false);
  const popup = context.waitForEvent("page");
  await page.getByRole("link", { name: "Developer docs", exact: true }).click();
  const guide = await popup;
  await expect(
    guide.getByRole("heading", { name: "Scripting API", exact: true }),
  ).toBeVisible();
  const broken = await guide.evaluate(() =>
    [...document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')]
      .map((a) => a.hash)
      .filter(
        (hash) => !document.getElementById(decodeURIComponent(hash.slice(1))),
      ),
  );
  expect(broken).toEqual([]);
  await guide
    .getByRole("navigation", { name: "Documentation" })
    .getByRole("link", { name: "Plugins", exact: true })
    .click();
  await expect(
    guide.getByRole("heading", { name: "Plugins and extensions", exact: true }),
  ).toBeVisible();
  await guide.close();
  await page.getByRole("button", { name: "Plugins (Mod+Shift+L)" }).click();
  await page.getByRole("button", { name: "Load example", exact: true }).click();
  await page
    .getByRole("button", { name: "Install plugin", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Run Add guide frame", exact: true })
    .click();
  await expect(page.getByLabel("Plugin output")).toContainText("Finished.");
  await page
    .getByRole("button", { name: "Close plugins", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Select Guide frame", exact: true }),
  ).toBeVisible();
  const exported = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export PNG", exact: true }).click();
  expect((await exported).suggestedFilename()).toMatch(/\.png$/);
  await page.keyboard.press("Control+z");
  await expect(page.locator(".layer-row")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("production brush and pencil draw live, commit and undo without developer globals", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page
    .getByRole("button", { name: "Brush tool (B)", exact: true })
    .click();
  const box = (await page.locator(".canvas-wrap").boundingBox())!;
  const image = () =>
    page
      .locator(".canvas-wrap canvas")
      .evaluate((node) => (node as HTMLCanvasElement).toDataURL());
  const empty = await image();
  await page.mouse.move(box.x + 70, box.y + 70);
  await page.mouse.down();
  await page.mouse.move(box.x + 250, box.y + 70, { steps: 24 });
  await expect.poll(image).not.toBe(empty);
  await page.mouse.up();
  await expect(
    page.getByRole("button", { name: "Select Brush painting", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Control+z");
  await expect(page.locator(".layer-row")).toHaveCount(0);
  await page.keyboard.press("Control+Shift+z");
  await page
    .getByRole("button", { name: "Select Brush painting", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Pencil tool (N)", exact: true })
    .click();
  const brush = await image();
  await page.mouse.move(box.x + 70, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 250, box.y + 100, { steps: 24 });
  await expect.poll(image).not.toBe(brush);
  await page.mouse.up();
  await page.keyboard.press("Control+z");
  await expect.poll(image).toBe(brush);
  await expect(page.locator(".layer-row")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("appearance follows the OS, persists overrides, and synchronizes editor and docs", async ({
  page,
  context,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  const root = page.locator("html");
  const appearance = page.getByRole("combobox", {
    name: "Appearance",
    exact: true,
    includeHidden: true,
  });
  await expect(root).toHaveAttribute("data-theme", "dark");
  await expect(appearance).toHaveValue("system");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(root).toHaveAttribute("data-theme", "light");
  await page
    .getByRole("button", { name: "Switch to dark mode", exact: true })
    .click();
  await page.reload();
  await expect(root).toHaveAttribute("data-theme", "dark");
  await expect(appearance).toHaveValue("dark");
  const guide = await context.newPage();
  await guide.goto("/developer/scripting-api.html");
  await expect(guide.locator("html")).toHaveAttribute("data-theme", "dark");
  await guide
    .getByRole("combobox", { name: "Appearance", exact: true })
    .selectOption("light");
  await expect(root).toHaveAttribute("data-theme", "light");
  await expect(appearance).toHaveValue("light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(root).toHaveAttribute("data-theme", "light");
  await page
    .getByRole("button", { name: "Switch to dark mode", exact: true })
    .focus();
  await page.keyboard.press("ArrowDown");
  await expect(appearance).toBeFocused();
  await appearance.selectOption("system");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Switch to light mode", exact: true }),
  ).toBeFocused();
  await expect(root).toHaveAttribute("data-theme", "dark");
  await expect(
    guide.getByRole("combobox", { name: "Appearance", exact: true }),
  ).toHaveValue("system");
  await guide.evaluate(() =>
    localStorage.setItem("luma.appearance.v1", "invalid"),
  );
  await expect(appearance).toHaveValue("system");
  await guide.close();
});

test("appearance changes preserve rendered pixels, export bytes, and undo history", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Brush tool (B)", exact: true })
    .click();
  const box = (await page.locator(".canvas-wrap").boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 150, box.y + 100, { steps: 8 });
  await page.mouse.up();
  await expect(
    page.getByRole("button", { name: "Undo (Mod+Z)", exact: true }),
  ).toBeEnabled();
  const exportBytes = async () => {
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export PNG", exact: true }).click();
    const download = await pending;
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  };
  const image = () =>
    page
      .locator(".canvas-wrap canvas")
      .evaluate((node) => (node as HTMLCanvasElement).toDataURL());
  const before = await exportBytes();
  const pixels = await image();
  for (const theme of ["dark", "light"]) {
    if ((await page.locator("html").getAttribute("data-theme")) !== theme) {
      await page
        .getByRole("button", { name: `Switch to ${theme} mode`, exact: true })
        .click();
    }
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    expect(await image()).toBe(pixels);
    expect(await exportBytes()).toEqual(before);
  }
  await page.getByRole("button", { name: "Undo (Mod+Z)", exact: true }).click();
  await expect(page.locator(".layer-row")).toHaveCount(0);
});

test("appearance works with unavailable storage and docs honor the OS without JavaScript", async ({
  browser,
}) => {
  const context = await browser.newContext({ colorScheme: "light" });
  await context.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("Blocked", "SecurityError");
      },
    });
  });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4173/");
  await page
    .getByRole("button", { name: "Switch to dark mode", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await context.close();
  const staticContext = await browser.newContext({
    javaScriptEnabled: false,
    colorScheme: "light",
  });
  const guide = await staticContext.newPage();
  await guide.goto("http://127.0.0.1:4173/developer/api.html");
  expect(
    await guide
      .locator("body")
      .evaluate((node) => getComputedStyle(node).backgroundColor),
  ).toBe("rgb(244, 243, 237)");
  await guide.emulateMedia({ colorScheme: "dark" });
  expect(
    await guide
      .locator("body")
      .evaluate((node) => getComputedStyle(node).backgroundColor),
  ).toBe("rgb(24, 28, 27)");
  await staticContext.close();
});

test("production metadata worker reads imported file facts and exports a private-field-free sidecar", async ({
  page,
}) => {
  await page.goto("/");
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 17;
    canvas.height = 23;
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((value) => resolve(value!)),
    );
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  await page.getByTestId("import-input").setInputFiles({
    name: "private-name.png",
    mimeType: "image/png",
    buffer: Buffer.from(bytes),
  });
  await page.getByText("Asset info", { exact: true }).click();
  const info = page.getByRole("region", { name: "Asset information" });
  await expect(info).toContainText("Decoded width");
  await expect(info).toContainText("private-name.png");
  await expect(
    info.getByRole("checkbox", { name: /Include private fields/ }),
  ).not.toBeChecked();
  const downloading = page.waitForEvent("download");
  await info.getByRole("button", { name: "Export metadata sidecar" }).click();
  const stream = await (await downloading).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const sidecar = JSON.parse(Buffer.concat(chunks).toString());
  expect(
    sidecar.fields.find((field: { id: string }) => field.id === "file:width")
      .value,
  ).toBe(17);
  expect(
    sidecar.fields.some(
      (field: { privacy: string }) => field.privacy === "private",
    ),
  ).toBe(false);
});

test("production scripting creates an editable Bézier layer mask with no developer globals", async ({
  page,
}) => {
  await page.goto("/");
  expect(await page.evaluate(() => "luma" in window)).toBe(false);
  await page
    .getByRole("button", { name: "Scripts (Mod+Shift+K)", exact: true })
    .click();
  await page.getByLabel("Script code").fill(`
    document.resize(200,120);
    const layer = document.layers.add(new PaintLayer({name:"Masked paint"}));
    layer.strokes.add(new PaintFill({bounds:{x:0,y:0,width:100,height:100},color:"#ee9955"}));
    layer.mask = new LayerMask({paths:[new VectorPath({closed:true,points:[{x:10,y:40,in:{x:10,y:0},out:{x:10,y:80}},{x:70,y:40,in:{x:70,y:80},out:{x:70,y:0}}]})],feather:8});
    document.selectedLayer = layer;
    layer.mask=layer.mask.paint(new BrushStroke({points:[{x:40,y:40}],size:10}),"hide");
    print("Geometry",layer.mask.kind,layer.mask.paths.length);
    print("Mask density", layer.mask.density);
  `);
  await page.getByRole("button", { name: "Run script", exact: true }).click();
  await expect(page.getByLabel("Script output")).toContainText(
    "Mask density 1",
  );
  await expect(page.getByLabel("Script output")).toContainText(
    "Geometry vector 1",
  );
  await page
    .getByRole("button", { name: "Close scripts", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "Enable layer mask" }),
  ).toBeChecked();
  await expect(
    page.getByRole("spinbutton", { name: "Mask feather value", exact: true }),
  ).toHaveValue("8");
  const link = page.getByRole("checkbox", {
    name: "Link mask to layer",
    exact: true,
  });
  await link.uncheck();
  const maskX = page.getByRole("spinbutton", { name: "Mask X", exact: true });
  await maskX.fill("5");
  await maskX.press("Enter");
  await page.getByRole("button", { name: "Undo (Mod+Z)", exact: true }).click();
  await expect(maskX).toHaveValue("0");
  await expect(link).not.toBeChecked();
  await page
    .getByRole("combobox", { name: "Move target", exact: true })
    .selectOption("mask");
  await page.getByLabel("Editing canvas", { exact: true }).focus();
  await page.keyboard.press("Shift+ArrowRight");
  await expect(maskX).toHaveValue("10");
  await page.keyboard.press("Control+z");
  await expect(maskX).toHaveValue("0");
  await page.getByRole("checkbox", { name: "Invert layer mask" }).check();
  await page.getByRole("button", { name: "Undo (Mod+Z)", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "Invert layer mask" }),
  ).not.toBeChecked();
  await page
    .getByRole("button", { name: "Vector pen (P)", exact: true })
    .click();
  await page.keyboard.press("Control+1");
  await page
    .getByRole("combobox", { name: "Pen target", exact: true })
    .selectOption("mask");
  const box = (await page.locator(".canvas-wrap").boundingBox())!;
  const artwork = () =>
    page
      .locator(".canvas-wrap canvas")
      .evaluate((node) => (node as HTMLCanvasElement).toDataURL());
  const before = await artwork();
  const anchors = page.locator('.drawing-overlay rect[stroke="#d5e79b"]');
  await expect(anchors).toHaveCount(2);
  await page.mouse.click(box.x + 40, box.y + 70);
  await expect(anchors).toHaveCount(3);
  await page.getByRole("button", { name: "Undo (Mod+Z)", exact: true }).click();
  await expect(anchors).toHaveCount(2);
  await expect.poll(artwork).toBe(before);
  await page.mouse.click(box.x + 10, box.y + 40);
  await page
    .getByRole("button", { name: "Insert midpoint", exact: true })
    .click();
  await expect(anchors).toHaveCount(3);
  await page.getByRole("button", { name: "Undo (Mod+Z)", exact: true }).click();
  await expect(anchors).toHaveCount(2);
  await expect.poll(artwork).toBe(before);
  await page.getByRole("button", { name: "New contour", exact: true }).click();
  for (const [x, y] of [
    [30, 30],
    [50, 30],
    [50, 50],
  ])
    await page.mouse.click(box.x + x, box.y + y);
  await page.keyboard.press("Enter");
  await expect(anchors).toHaveCount(5);
  await page.getByRole("button", { name: "Undo (Mod+Z)", exact: true }).click();
  await expect(anchors).toHaveCount(2);
  await expect.poll(artwork).toBe(before);
  await page.mouse.move(box.x + 10, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 20, box.y + 40, { steps: 3 });
  await page.mouse.up();
  await expect.poll(artwork).not.toBe(before);
  await page.getByRole("button", { name: "Undo (Mod+Z)", exact: true }).click();
  await expect.poll(artwork).toBe(before);
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export PNG", exact: true }).click();
  expect((await downloading).suggestedFilename()).toMatch(/\.png$/);
});

test("production painted masks expose brush targets and export through the bundled renderer", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Scripts (Mod+Shift+K)", exact: true })
    .click();
  await page.getByLabel("Script code").fill(`
    document.resize(200,150);
    const layer=document.layers.add(new PaintLayer({name:"Painted mask"}));
    layer.strokes.add(new PaintFill({bounds:{x:0,y:0,width:200,height:150},color:"#ffaa55"}));
    layer.mask=new LayerMask({base:1,feather:4}).paint(new BrushStroke({points:[{x:60,y:60}],size:30}),"hide");
    document.selectedLayer=layer;print(layer.mask.kind,layer.mask.strokes.length);
  `);
  await page.getByRole("button", { name: "Run script", exact: true }).click();
  await expect(page.getByLabel("Script output")).toContainText("paint 1");
  await page
    .getByRole("button", { name: "Close scripts", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Brush tool (B)", exact: true })
    .click();
  await page.keyboard.press("Control+1");
  await page
    .getByRole("combobox", { name: "Paint target", exact: true })
    .selectOption("mask-reveal");
  const box = (await page.locator(".canvas-wrap").boundingBox())!;
  const artwork = () =>
    page
      .locator(".canvas-wrap canvas")
      .evaluate((node) => (node as HTMLCanvasElement).toDataURL());
  const before = await artwork();
  await page.mouse.move(box.x + 60, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 65, box.y + 60, { steps: 3 });
  await expect.poll(artwork).not.toBe(before);
  await page.mouse.up();
  await page.getByRole("button", { name: "Undo (Mod+Z)", exact: true }).click();
  await expect.poll(artwork).toBe(before);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export PNG", exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.png$/);
});

test("production crop uses precise bounds and on-canvas frames before export", async ({
  page,
}) => {
  await page.goto("/");
  expect(await page.evaluate(() => "luma" in window)).toBe(false);
  await page
    .getByRole("button", { name: "Scripts (Mod+Shift+K)", exact: true })
    .click();
  await page.getByLabel("Script code").fill(`
    document.resize(160,120);
    const layer=document.layers.add(new PaintLayer({name:"Crop artwork"}));
    layer.strokes.add(new PaintFill({bounds:{x:0,y:0,width:160,height:120},color:"#ee9955"}));
    document.selectedLayer=layer;
    document.selection=new MarqueeSelection({shape:"rectangle",x:20,y:15,width:80,height:60});
    print("Ready to crop");
  `);
  await page.getByRole("button", { name: "Run script", exact: true }).click();
  await expect(page.getByLabel("Script output")).toContainText("Ready to crop");
  await page
    .getByRole("button", { name: "Close scripts", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Crop canvas (C)", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Precise bounds…", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Crop canvas", exact: true });
  await expect(
    dialog.getByRole("spinbutton", { name: "Crop X", exact: true }),
  ).toHaveValue("20");
  await dialog.getByRole("button", { name: "Apply crop", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Undo (Mod+Z)", exact: true }).click();
  await page
    .getByRole("button", { name: "Redo (Mod+Shift+Z)", exact: true })
    .click();
  await page.keyboard.press("Control+1");
  await page.getByRole("button", { name: "New frame", exact: true }).click();
  const box = (await page.locator(".canvas-wrap").boundingBox())!;
  await page.mouse.move(box.x + 5, box.y + 5);
  await page.mouse.down();
  await page.mouse.move(box.x + 65, box.y + 45, { steps: 3 });
  await page.mouse.up();
  await expect(
    page.getByRole("group", { name: "Crop frame", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("group", { name: "Crop frame", exact: true }),
  ).toHaveCount(0);
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export PNG", exact: true }).click();
  const stream = await (await downloading).createReadStream(),
    chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const png = Buffer.concat(chunks);
  expect(png.subarray(1, 4).toString()).toBe("PNG");
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([60, 40]);
});
