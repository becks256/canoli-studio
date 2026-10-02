import { test, expect } from "@playwright/test";

test("crop dialog preserves source bytes and nested masked pixels through undo, export and reopen", async ({
  page,
}) => {
  await page.goto("/");
  const before = await page.evaluate(async () => {
    const {
      editor: e,
      RasterLayer,
      LayerGroup,
      LayerMask,
      MarqueeSelection,
      BrushStroke,
    } = window.luma;
    e.newDocument({ width: 240, height: 180 });
    const source = document.createElement("canvas");
    source.width = 240;
    source.height = 180;
    const ctx = source.getContext("2d")!,
      gradient = ctx.createLinearGradient(0, 0, 240, 180);
    gradient.addColorStop(0, "#ff8844");
    gradient.addColorStop(1, "#2266aa");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 240, 180);
    const blob = await new Promise<Blob>((resolve) =>
      source.toBlob((value) => resolve(value!), "image/png"),
    );
    const asset = await e.assetStore.add(blob, "crop-source.png");
    const group = e.document.layers.add(new LayerGroup({ x: 12, y: 8 }));
    const layer = group.layers.add(
      new RasterLayer({
        assetId: asset.id,
        width: 240,
        height: 180,
        x: 5,
        y: 4,
      }),
    );
    group.mask = new LayerMask({
      selection: new MarqueeSelection({
        shape: "rectangle",
        x: 5,
        y: 5,
        width: 200,
        height: 150,
      }),
      feather: 3,
    });
    layer.mask = new LayerMask({
      base: 1,
      linked: false,
      x: 14,
      y: 10,
      feather: 2,
    }).paint(
      new BrushStroke({
        points: [
          { x: 55, y: 45 },
          { x: 90, y: 80 },
        ],
        size: 25,
      }),
      "hide",
    );
    e.document.selection = new MarqueeSelection({
      shape: "rectangle",
      x: 30,
      y: 24,
      width: 100,
      height: 90,
    });
    e.document.selectedLayer = layer;
    group.locked = true;
    e.tools.begin(
      "clone",
      { x: 40, y: 40 },
      { alt: true, shift: false, pressure: 1 },
      1,
    );
    const image = await e.renderer.render(e.document.toJSON(), e.assetStore, {
      cache: false,
    });
    const digest = async (bytes: BufferSource) =>
      Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      ).join(",");
    const cropHash = await digest(
      image.getContext("2d")!.getImageData(30, 24, 100, 90).data,
    );
    const fullHash = await digest(
      image.getContext("2d")!.getImageData(0, 0, 240, 180).data,
    );
    const expected = image.getContext("2d")!.getImageData(30, 24, 100, 90).data;
    const exported = await createImageBitmap(await e.exportPng()),
      decoded = document.createElement("canvas");
    decoded.width = exported.width;
    decoded.height = exported.height;
    decoded.getContext("2d")!.drawImage(exported, 0, 0);
    exported.close();
    const actual = decoded.getContext("2d")!.getImageData(30, 24, 100, 90).data;
    let exportAlphaDifference = 0,
      exportPremultipliedDifference = 0;
    for (let i = 0; i < expected.length; i += 4) {
      exportAlphaDifference = Math.max(
        exportAlphaDifference,
        Math.abs(expected[i + 3] - actual[i + 3]),
      );
      for (let c = 0; c < 3; c++)
        exportPremultipliedDifference = Math.max(
          exportPremultipliedDifference,
          Math.abs(
            (expected[i + c] * expected[i + 3]) / 255 -
              (actual[i + c] * actual[i + 3]) / 255,
          ),
        );
    }
    image.width = image.height = decoded.width = decoded.height = 1;
    return {
      data: e.document.toJSON(),
      past: e.document.getSnapshot().past.length,
      assetId: asset.id,
      sourceHash: await digest(await asset.blob.arrayBuffer()),
      cropHash,
      fullHash,
      exportAlphaDifference,
      exportPremultipliedDifference,
    };
  });
  await page.keyboard.press("c");
  await page
    .getByRole("button", { name: "Precise bounds…", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Crop canvas", exact: true });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("spinbutton", { name: "Crop X", exact: true }),
  ).toHaveValue("30");
  await expect(
    dialog.getByRole("spinbutton", { name: "Crop width", exact: true }),
  ).toHaveValue("100");
  await dialog.getByRole("button", { name: "Apply crop", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const after = await page.evaluate(async (id) => {
    const e = window.luma.editor,
      asset = e.assetStore.get(id);
    const digest = async (bytes: BufferSource) =>
      Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      ).join(",");
    const image = await e.renderer.render(e.document.toJSON(), e.assetStore, {
      cache: false,
    });
    const pixels = await digest(
      image.getContext("2d")!.getImageData(0, 0, 100, 90).data,
    );
    image.width = image.height = 1;
    // PNG export requests software readback surfaces; compare with that same reference mode.
    const exportReference = await e.renderer.render(
      e.document.toJSON(),
      e.assetStore,
      { cache: false, readback: true },
    );
    const expected = exportReference
      .getContext("2d")!
      .getImageData(0, 0, 100, 90).data;
    exportReference.width = exportReference.height = 1;
    const png = await createImageBitmap(await e.exportPng()),
      canvas = document.createElement("canvas");
    canvas.width = png.width;
    canvas.height = png.height;
    canvas.getContext("2d")!.drawImage(png, 0, 0);
    png.close();
    const actual = canvas.getContext("2d")!.getImageData(0, 0, 100, 90).data;
    let alphaDifference = 0,
      premultipliedDifference = 0,
      rawDifference = 0;
    for (let i = 0; i < expected.length; i += 4) {
      alphaDifference = Math.max(
        alphaDifference,
        Math.abs(expected[i + 3] - actual[i + 3]),
      );
      for (let c = 0; c < 3; c++) {
        rawDifference = Math.max(
          rawDifference,
          Math.abs(expected[i + c] - actual[i + c]),
        );
        premultipliedDifference = Math.max(
          premultipliedDifference,
          Math.abs(
            (expected[i + c] * expected[i + 3]) / 255 -
              (actual[i + c] * actual[i + 3]) / 255,
          ),
        );
      }
    }
    return {
      data: e.document.toJSON(),
      past: e.document.getSnapshot().past.length,
      pixels,
      alphaDifference,
      premultipliedDifference,
      rawDifference,
      exportSize: [canvas.width, canvas.height],
      sourceHash: await digest(await asset.blob.arrayBuffer()),
      sourceSize: [asset.width, asset.height],
      clone: e.tools.getSnapshot().cloneSource,
    };
  }, before.assetId);
  expect(after.data).toMatchObject({ width: 100, height: 90 });
  expect(after.past).toBe(before.past + 1);
  expect(after.pixels).toBe(before.cropHash);
  console.log("Crop export comparison", {
    baselineAlpha: before.exportAlphaDifference,
    baselinePremultiplied: before.exportPremultipliedDifference,
    alpha: after.alphaDifference,
    premultiplied: after.premultipliedDifference,
    raw: after.rawDifference,
  });
  expect(after.exportSize).toEqual([100, 90]);
  expect(after.alphaDifference).toBeLessThanOrEqual(1);
  expect(before.exportAlphaDifference).toBeLessThanOrEqual(1);
  expect(before.exportPremultipliedDifference).toBeLessThanOrEqual(2);
  expect(after.premultipliedDifference).toBeLessThanOrEqual(2);
  expect(after.sourceHash).toBe(before.sourceHash);
  expect(after.sourceSize).toEqual([240, 180]);
  expect(after.clone).toBeNull();
  await page.evaluate(() => {
    window.luma.editor.tools.begin(
      "clone",
      { x: 10, y: 10 },
      { alt: true, shift: false, pressure: 1 },
      1,
    );
  });
  await page.keyboard.press("Control+z");
  expect(
    await page.evaluate(() => window.luma.editor.document.toJSON()),
  ).toEqual(before.data);
  expect(
    await page.evaluate(
      () => window.luma.editor.tools.getSnapshot().cloneSource,
    ),
  ).toBeNull();
  await page.keyboard.press("Control+Shift+z");
  expect(
    await page.evaluate(() => window.luma.editor.document.toJSON()),
  ).toEqual(after.data);
  const reopened = await page.evaluate(async (id) => {
    const e = window.luma.editor;
    await e.openProject(new File([await e.saveProject()], "cropped.luma"));
    const cropped = e.document.toJSON();
    e.document.crop({ x: -30, y: -24, width: 240, height: 180 });
    const c = await e.renderer.render(e.document.toJSON(), e.assetStore, {
      cache: false,
    });
    const bytes = c.getContext("2d")!.getImageData(0, 0, 240, 180).data;
    c.width = c.height = 1;
    return {
      cropped,
      restored: e.document.toJSON(),
      fullHash: Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      ).join(","),
      sourceHash: Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            await e.assetStore.get(id).blob.arrayBuffer(),
          ),
        ),
      ).join(","),
    };
  }, before.assetId);
  expect(reopened.cropped).toEqual(after.data);
  expect(reopened.restored).toEqual(before.data);
  expect(reopened.fullHash).toBe(before.fullHash);
  expect(reopened.sourceHash).toBe(before.sourceHash);
});

test("crop cancellation and stale-dialog rejection leave artwork unchanged", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    window.luma.editor.newDocument({ width: 200, height: 100 });
  });
  const before = await page.evaluate(() =>
    window.luma.editor.document.toJSON(),
  );
  await page
    .getByRole("button", { name: "Crop canvas (C)", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Precise bounds…", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Crop canvas", exact: true });
  await dialog
    .getByRole("spinbutton", { name: "Crop width", exact: true })
    .fill("120");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(
    await page.evaluate(() => window.luma.editor.document.toJSON()),
  ).toEqual(before);
  await page
    .getByRole("button", { name: "Crop canvas (C)", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Precise bounds…", exact: true })
    .click();
  await dialog
    .getByRole("spinbutton", { name: "Crop width", exact: true })
    .fill("120");
  await page.evaluate(() => {
    window.luma.editor.document.name = "Changed externally";
  });
  await dialog.getByRole("button", { name: "Apply crop", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("document changed");
  expect(await page.evaluate(() => window.luma.editor.document.width)).toBe(
    200,
  );
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
});

test("on-canvas crop draws, moves and resizes with pointer and keyboard before a single commit", async ({
  page,
}) => {
  await page.goto("/");
  const before = await page.evaluate(() => {
    const { editor: e, PaintLayer, PaintFill } = window.luma;
    e.newDocument({ width: 240, height: 180 });
    const layer = e.document.layers.add(new PaintLayer({ x: 5, y: 7 }));
    layer.strokes.add(
      new PaintFill({
        bounds: { x: 0, y: 0, width: 240, height: 180 },
        color: "#ee9955",
      }),
    );
    layer.locked = true;
    e.document.selectedLayer = layer;
    return {
      data: e.document.toJSON(),
      past: e.document.getSnapshot().past.length,
    };
  });
  await page
    .getByRole("button", { name: "Move tool (V)", exact: true })
    .click();
  await page.keyboard.press("Control+1");
  await page.keyboard.press("c");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Apply crop", exact: true }),
  ).toBeDisabled();
  const box = (await page.locator(".canvas-wrap").boundingBox())!;
  const drag = async (x1: number, y1: number, x2: number, y2: number) => {
    await page.mouse.move(box.x + x1, box.y + y1);
    await page.mouse.down();
    await page.mouse.move(box.x + x2, box.y + y2, { steps: 4 });
    await page.mouse.up();
  };
  const read = () =>
    page.evaluate(() => ({
      data: window.luma.editor.document.toJSON(),
      past: window.luma.editor.document.getSnapshot().past.length,
    }));
  const bounds = () =>
    page.evaluate(() => window.luma.editor.tools.crop.bounds);
  await drag(20, 30, 120, 110);
  expect(await bounds()).toEqual({ x: 20, y: 30, width: 100, height: 80 });
  expect(await read()).toEqual(before);
  await expect(
    page.getByRole("group", { name: "Crop frame", exact: true }),
  ).toBeVisible();
  // Move the frame without changing the artwork or viewport position.
  await drag(60, 70, 70, 75);
  expect(await bounds()).toEqual({ x: 30, y: 35, width: 100, height: 80 });
  const corner = page.getByRole("button", {
    name: "Crop bottom-right handle",
    exact: true,
  });
  const handle = (await corner.boundingBox())!;
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    handle.x + handle.width / 2 + 20,
    handle.y + handle.height / 2 + 10,
    { steps: 3 },
  );
  await page.mouse.up();
  expect(await bounds()).toEqual({ x: 30, y: 35, width: 120, height: 90 });
  await page
    .getByRole("button", { name: "Crop right handle", exact: true })
    .focus();
  await page.keyboard.press("Shift+ArrowRight");
  expect(await bounds()).toEqual({ x: 30, y: 35, width: 130, height: 90 });
  await page.getByLabel("Editing canvas", { exact: true }).focus();
  await page.keyboard.press("ArrowDown");
  expect(await bounds()).toEqual({ x: 30, y: 36, width: 130, height: 90 });
  expect(await read()).toEqual(before);
  // The numeric dialog starts from the draft, and cancelling it retains that frame.
  await page
    .getByRole("button", { name: "Precise bounds…", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Crop canvas", exact: true });
  await expect(
    dialog.getByRole("spinbutton", { name: "Crop width", exact: true }),
  ).toHaveValue("130");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await bounds()).toEqual({ x: 30, y: 36, width: 130, height: 90 });
  await page.getByLabel("Editing canvas", { exact: true }).focus();
  await page.keyboard.press("Enter");
  const applied = await read();
  expect(applied.data).toMatchObject({
    width: 130,
    height: 90,
    children: [{ x: -25, y: -29, locked: true }],
  });
  expect(applied.past).toBe(before.past + 1);
  expect(await bounds()).toBeNull();
  await expect(page.locator(".artwork-host")).toHaveCSS("width", "130px");
  await expect(page.locator(".artwork-host")).toHaveCSS("height", "90px");
  await page.keyboard.press("Control+z");
  expect(await read()).toEqual(before);
  await expect(page.locator(".artwork-host")).toHaveCSS("width", "240px");
  await page.keyboard.press("Control+Shift+z");
  expect(await read()).toEqual(applied);
  await expect(page.locator(".artwork-host")).toHaveCSS("width", "130px");
  // Delete in Crop mode clears the frame; it must never remove locked or unlocked artwork.
  await page.keyboard.press("c");
  await page
    .getByRole("button", { name: "Precise bounds…", exact: true })
    .click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByLabel("Editing canvas", { exact: true }).focus();
  await page.keyboard.press("Delete");
  expect(await read()).toEqual(applied);
  await page.evaluate(() => {
    window.luma.editor.document.selectedLayer!.locked = false;
  });
  const unlocked = await read();
  await page.keyboard.press("Delete");
  expect(await read()).toEqual(unlocked);
});

test("crop drafts cancel on Escape, tool changes, pointer cancellation and document edits", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() =>
    window.luma.editor.newDocument({ width: 200, height: 160 }),
  );
  await page.keyboard.press("Control+1");
  await page.keyboard.press("c");
  const box = (await page.locator(".canvas-wrap").boundingBox())!;
  const draw = async () => {
    await page.mouse.move(box.x + 20, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + 100, { steps: 3 });
    await page.mouse.up();
  };
  await draw();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("group", { name: "Crop frame", exact: true }),
  ).toHaveCount(0);
  await draw();
  await page.keyboard.press("v");
  expect(
    await page.evaluate(() => window.luma.editor.tools.crop.bounds),
  ).toBeNull();
  await page.keyboard.press("c");
  await draw();
  await page.locator(".viewport").dispatchEvent("pointercancel");
  expect(
    await page.evaluate(() => window.luma.editor.tools.crop.bounds),
  ).toBeNull();
  await draw();
  await page.evaluate(() => {
    window.luma.editor.document.name = "External revision";
  });
  await expect(
    page.getByRole("group", { name: "Crop frame", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => [
      window.luma.editor.document.width,
      window.luma.editor.document.height,
    ]),
  ).toEqual([200, 160]);
});
