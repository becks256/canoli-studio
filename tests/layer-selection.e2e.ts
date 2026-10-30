import { test, expect } from "@playwright/test";

test("multi-layer selection supports shared nudge, alignment, drag and undo", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("textbox", { name: "Search layers" }),
  ).toBeVisible();
  await page.evaluate(() => {
    const { editor, TextLayer } = window.luma;
    editor.newDocument({ width: 400, height: 300 });
    editor.document.layers.add(
      new TextLayer({ name: "First", text: "First", x: 40, y: 40 }),
    );
    editor.document.layers.add(
      new TextLayer({ name: "Second", text: "Second", x: 180, y: 100 }),
    );
  });
  await page.getByRole("button", { name: "Select First", exact: true }).click();
  await page
    .getByRole("button", { name: "Select Second", exact: true })
    .click({ modifiers: ["Control"] });
  await expect(
    page.getByText("2 layers selected", { exact: true }),
  ).toBeVisible();
  const positions = () =>
    page.evaluate(() =>
      window.luma.editor.document.toJSON().children.map((l) => [l.x, l.y]),
    );
  const viewport = page.locator(".viewport");
  await viewport.focus(); await expect(viewport).toBeFocused();
  await page.keyboard.press("ArrowRight");
  expect(await positions()).toEqual([
    [41, 40],
    [181, 100],
  ]);
  await page.keyboard.press("Control+z");
  expect(await positions()).toEqual([
    [40, 40],
    [180, 100],
  ]);
  await page
    .getByLabel("Align selected layers", { exact: true })
    .selectOption("left");
  expect(await positions()).toEqual([
    [40, 40],
    [40, 100],
  ]);
  await page
    .getByRole("button", { name: "Select Second", exact: true })
    .focus();
  await page.keyboard.press("Control+z");
  const box = await page.locator(".canvas-wrap").boundingBox();
  if (!box) throw new Error("Canvas absent");
  const scale = box.width / 400;
  await page.mouse.move(box.x + 50 * scale, box.y + 50 * scale);
  await page.mouse.down();
  await page.mouse.move(box.x + 70 * scale, box.y + 60 * scale, { steps: 3 });
  await page.mouse.up();
  expect(await positions()).toEqual([
    [60, 50],
    [200, 110],
  ]);
  await page.keyboard.press("Control+z");
  expect(await positions()).toEqual([
    [40, 40],
    [180, 100],
  ]);
  await page
    .getByRole("button", { name: "Delete layer (Delete)", exact: true })
    .click();
  expect(
    await page.evaluate(() => window.luma.editor.document.layers.length),
  ).toBe(0);
  await page.keyboard.press("Control+z");
  expect(
    await page.evaluate(() => window.luma.editor.document.layers.length),
  ).toBe(2);
});

test("isolated scripts round-trip multi-selection and commit one transaction", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("textbox", { name: "Search layers" }),
  ).toBeVisible();
  const result = await page.evaluate(async () => {
    const { editor, TextLayer } = window.luma;
    editor.document.layers.add(new TextLayer({ name: "A", x: 10 }));
    editor.document.layers.add(new TextLayer({ name: "B", x: 80 }));
    const before = editor.document.getSnapshot().revision;
    await editor.runScript(
      `document.selectLayers([document.layers.at(0), document.layers.at(1)]); document.layerSelection.translate(5, 3);`,
    );
    const selected = editor.document.selectedLayers.map((l) => l.name);
    const x = editor.document.selectedLayers.map((l) => l.x);
    const delta = editor.document.getSnapshot().revision - before;
    await editor.runScript(
      `if (document.selectedLayers.length !== 2) throw new Error('Selection lost'); document.layerSelection.align('left');`,
    );
    const aligned = editor.document.selectedLayers.map((l) => l.x);
    editor.document.undo();
    return {
      selected,
      x,
      delta,
      aligned,
      undone: editor.document.selectedLayers.map((l) => l.x),
    };
  });
  expect(result).toEqual({
    selected: ["A", "B"],
    x: [15, 85],
    delta: 1,
    aligned: [15, 15],
    undone: [15, 85],
  });
});

test("read-only plugins cannot change the selection set while retaining the active layer", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("textbox", { name: "Search layers" }),
  ).toBeVisible();
  const result = await page.evaluate(async () => {
    const { editor, TextLayer } = window.luma;
    const a = editor.document.layers.add(new TextLayer({ name: "A" }));
    const b = editor.document.layers.add(new TextLayer({ name: "B" }));
    editor.document.selectLayers([a, b]);
    const { examplePlugin } = await import(
      /* @vite-ignore */ String("/src/plugins/index.ts")
    );
    editor.plugins.install({
      ...examplePlugin,
      permissions: ["document:read"],
      commands: [
        {
          id: "selection",
          title: "Selection",
          source: "document.selectLayers([document.activeLayer]);",
        },
      ],
    });
    let error = "";
    try {
      await editor.runPlugin(examplePlugin.id, "selection");
    } catch (e) {
      error = String(e);
    }
    return {
      error,
      names: editor.document.selectedLayers.map((layer) => layer.name),
    };
  });
  expect(result.error).toContain("document:read");
  expect(result.names).toEqual(["A", "B"]);
});

test("multi-layer rotation respects transformed parents, undo and scripting", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const { editor, LayerGroup, TextLayer, AffineTransform } = window.luma;
    editor.newDocument({ width: 400, height: 300 });
    const group = new LayerGroup();
    editor.document.layers.add(group);
    group.transform = new AffineTransform(2, 0.3, 0.2, 1, 20, 30);
    const first = new TextLayer({ name: "Nested", text: "A", x: 10, y: 20 });
    group.layers.add(first);
    const second = new TextLayer({ name: "Root", text: "B", x: 200, y: 100 });
    editor.document.layers.add(second);
    editor.document.selectLayers([first, second]);
    const { layerTransform } = await import(
      /* @vite-ignore */ String("/src/core/spatial.ts")
    );
    const bounds = editor.document.layerSelection.bounds!;
    const rotation = AffineTransform.rotation(Math.PI / 2).around({
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    });
    (window as any).rotationExpected = [first, second].map((layer) =>
      rotation
        .multiply(layerTransform(editor.document.toJSON(), layer.id)!)
        .toJSON(),
    );
    (window as any).rotationBefore = JSON.stringify(editor.document.toJSON());
  });
  await page
    .getByLabel("Rotate selected layers", { exact: true })
    .selectOption("90");
  const result = await page.evaluate(async () => {
    const { editor } = window.luma;
    const { layerTransform } = await import(
      /* @vite-ignore */ String("/src/core/spatial.ts")
    );
    return {
      actual: editor.document.selectedLayers.map((layer) =>
        layerTransform(editor.document.toJSON(), layer.id)!.toJSON(),
      ),
      expected: (window as any).rotationExpected,
    };
  });
  for (let index = 0; index < 2; index++)
    for (const key of ["a", "b", "c", "d", "e", "f"]) {
      expect(
        result.actual[index][key as keyof (typeof result.actual)[number]],
      ).toBeCloseTo(result.expected[index][key]);
    }
  await page.evaluate(() => window.luma.editor.document.undo());
  expect(
    await page.evaluate(() =>
      JSON.stringify(window.luma.editor.document.toJSON()),
    ),
  ).toBe(await page.evaluate(() => (window as any).rotationBefore));
  await page.evaluate(async () => {
    await window.luma.editor.runScript("document.layerSelection.rotate(30);");
  });
  expect(
    await page.evaluate(() =>
      JSON.stringify(window.luma.editor.document.toJSON()),
    ),
  ).not.toBe(await page.evaluate(() => (window as any).rotationBefore));
  await page.evaluate(() => window.luma.editor.document.undo());
  expect(
    await page.evaluate(() =>
      JSON.stringify(window.luma.editor.document.toJSON()),
    ),
  ).toBe(await page.evaluate(() => (window as any).rotationBefore));
});

test("multi-layer pointer rotation previews and commits all roots as one undo step", async ({
  page,
}) => {
  await page.goto("/");
  const setup = await page.evaluate(async () => {
    const { editor } = window.luma;
    const canvas = document.createElement("canvas");
    canvas.width = 20;
    canvas.height = 20;
    canvas.getContext("2d")!.fillRect(0, 0, 20, 20);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((value) => resolve(value!)),
    );
    const first = await editor.importImage(
      new File([blob], "First", { type: "image/png" }),
    );
    editor.document.resize(250, 200);
    first.update({ x: 60, y: 60 });
    const second = first.duplicate();
    second.update({ x: 100, y: 60 });
    editor.document.selectLayers([first, second]);
    return {
      before: JSON.stringify(editor.document.toJSON()),
      revision: editor.document.getSnapshot().revision,
    };
  });
  await page
    .getByRole("button", { name: "Move tool (V)", exact: true })
    .click();
  await page.keyboard.press("Control+1");
  const box = (await page.locator(".canvas-wrap").boundingBox())!;
  const handle = (await page
    .getByRole("button", { name: "Drag to rotate layer" })
    .boundingBox())!;
  await page.keyboard.down("Shift");
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(box.x + 150, box.y + 70, { steps: 4 });
  expect(
    await page.evaluate(
      () => window.luma.editor.document.getSnapshot().revision,
    ),
  ).toBe(setup.revision);
  await page.mouse.up();
  await page.keyboard.up("Shift");
  const after = await page.evaluate(() => ({
    revision: window.luma.editor.document.getSnapshot().revision,
    layers: window.luma.editor.document.selectedLayers.map((layer) => ({
      angle: (Math.atan2(layer.transform.b, layer.transform.a) * 180) / Math.PI,
      center: layer.transform.point({ x: 10, y: 10 }),
    })),
  }));
  expect(after.revision).toBe(setup.revision + 1);
  expect(after.layers[0].angle).toBeCloseTo(90);
  expect(after.layers[1].angle).toBeCloseTo(90);
  expect(after.layers[0].center.x).toBeCloseTo(90);
  expect(after.layers[1].center.x).toBeCloseTo(90);
  expect(after.layers[0].center.y).toBeCloseTo(50);
  expect(after.layers[1].center.y).toBeCloseTo(90);
  await page.keyboard.press("Control+z");
  expect(
    await page.evaluate(() =>
      JSON.stringify(window.luma.editor.document.toJSON()),
    ),
  ).toBe(setup.before);
});

test("selection scaling keeps artwork editable and supports UI, scripts and undo", async ({
  page,
}) => {
  await page.goto("/");
  const before = await page.evaluate(() => {
    const { editor, TextLayer, LayerGroup, AffineTransform } = window.luma;
    editor.newDocument({ width: 400, height: 300 });
    const group = new LayerGroup();
    editor.document.layers.add(group);
    group.transform = new AffineTransform(2, 0.2, 0.3, 1, 10, 20);
    const first = new TextLayer({ text: "Editable A", x: 20, y: 30 });
    group.layers.add(first);
    const second = new TextLayer({ text: "Editable B", x: 180, y: 100 });
    editor.document.layers.add(second);
    editor.document.selectLayers([first, second]);
    return {
      bounds: editor.document.layerSelection.bounds!,
      snapshot: JSON.stringify(editor.document.toJSON()),
    };
  });
  await page
    .getByLabel("Scale selected layers", { exact: true })
    .selectOption("2");
  const scaled = await page.evaluate(() => ({
    bounds: window.luma.editor.document.layerSelection.bounds!,
    snapshot: JSON.stringify(window.luma.editor.document.toJSON()),
    kinds: window.luma.editor.document.selectedLayers.map(
      (layer) => layer.kind,
    ),
  }));
  expect(scaled.kinds).toEqual(["text", "text"]);
  expect(scaled.bounds.width).toBeCloseTo(before.bounds.width * 2);
  expect(scaled.bounds.height).toBeCloseTo(before.bounds.height * 2);
  expect(scaled.bounds.x + scaled.bounds.width / 2).toBeCloseTo(
    before.bounds.x + before.bounds.width / 2,
  );
  await page.evaluate(async () => {
    await window.luma.editor.runScript("document.layerSelection.scale(0.5);");
  });
  const restoredBounds = await page.evaluate(
    () => window.luma.editor.document.layerSelection.bounds!,
  );
  expect(restoredBounds.width).toBeCloseTo(before.bounds.width);
  await page.evaluate(() => window.luma.editor.document.undo());
  expect(
    await page.evaluate(() =>
      JSON.stringify(window.luma.editor.document.toJSON()),
    ),
  ).toBe(scaled.snapshot);
  await page.evaluate(() => window.luma.editor.document.undo());
  expect(
    await page.evaluate(() =>
      JSON.stringify(window.luma.editor.document.toJSON()),
    ),
  ).toBe(before.snapshot);
});

test("paired selection scale controls stage precise values and apply once", async ({
  page,
}) => {
  await page.goto("/");
  const before = await page.evaluate(() => {
    const { editor, TextLayer } = window.luma;
    editor.newDocument({ width: 400, height: 300 });
    const a = editor.document.layers.add(
      new TextLayer({ text: "First", x: 30, y: 30 }),
    );
    const b = editor.document.layers.add(
      new TextLayer({ text: "Second", x: 150, y: 100 }),
    );
    editor.document.selectLayers([a, b]);
    return {
      revision: editor.document.getSnapshot().revision,
      width: editor.document.layerSelection.bounds!.width,
      snapshot: JSON.stringify(editor.document.toJSON()),
    };
  });
  const value = page.getByRole("spinbutton", {
    name: "Selection scale value",
    exact: true,
  });
  await value.fill("125");
  await value.press("Enter");
  expect(
    await page.evaluate(
      () => window.luma.editor.document.getSnapshot().revision,
    ),
  ).toBe(before.revision);
  const slider = page.getByRole("slider", {
    name: "Selection scale",
    exact: true,
  });
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await expect(value).toHaveValue("125.1");
  await page
    .getByRole("button", { name: "Apply selection scale", exact: true })
    .click();
  expect(
    await page.evaluate(
      () => window.luma.editor.document.layerSelection.bounds!.width,
    ),
  ).toBeCloseTo(before.width * 1.251);
  expect(
    await page.evaluate(
      () => window.luma.editor.document.getSnapshot().revision,
    ),
  ).toBe(before.revision + 1);
  await expect(value).toHaveValue("100");
  await page.evaluate(() => window.luma.editor.document.undo());
  expect(
    await page.evaluate(() =>
      JSON.stringify(window.luma.editor.document.toJSON()),
    ),
  ).toBe(before.snapshot);
});

test("multi-layer corner scaling anchors the opposite corner and commits once", async ({
  page,
}) => {
  await page.goto("/");
  const before = await page.evaluate(() => {
    const { editor, TextLayer } = window.luma;
    editor.newDocument({ width: 600, height: 400 });
    const a = editor.document.layers.add(
      new TextLayer({ text: "A", x: 60, y: 60 }),
    );
    const b = editor.document.layers.add(
      new TextLayer({ text: "B", x: 130, y: 90 }),
    );
    editor.document.selectLayers([a, b]);
    return {
      bounds: editor.document.layerSelection.bounds!,
      revision: editor.document.getSnapshot().revision,
      snapshot: JSON.stringify(editor.document.toJSON()),
    };
  });
  await page
    .getByRole("button", { name: "Move tool (V)", exact: true })
    .click();
  await page.keyboard.press("Control+1");
  const box = (await page.locator(".canvas-wrap").boundingBox())!;
  const handle = (await page
    .locator('.selection-outline [data-handle="se"]')
    .boundingBox())!;
  const start = {
    x: handle.x + handle.width / 2,
    y: handle.y + handle.height / 2,
  };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 60, start.y + 30, { steps: 4 });
  expect(
    await page.evaluate(
      () => window.luma.editor.document.getSnapshot().revision,
    ),
  ).toBe(before.revision);
  await page.mouse.up();
  const after = await page.evaluate(() => ({
    bounds: window.luma.editor.document.layerSelection.bounds!,
    revision: window.luma.editor.document.getSnapshot().revision,
  }));
  expect(after.revision).toBe(before.revision + 1);
  expect(after.bounds.x).toBeCloseTo(before.bounds.x);
  expect(after.bounds.y).toBeCloseTo(before.bounds.y);
  expect(after.bounds.width).toBeCloseTo(
    before.bounds.width * (1 + 60 / (start.x - box.x - before.bounds.x)),
  );
  expect(after.bounds.height).toBeCloseTo(
    before.bounds.height * (1 + 30 / (start.y - box.y - before.bounds.y)),
  );
  await page.keyboard.press("Control+z");
  expect(
    await page.evaluate(() =>
      JSON.stringify(window.luma.editor.document.toJSON()),
    ),
  ).toBe(before.snapshot);
});
