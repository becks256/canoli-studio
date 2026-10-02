import { expect, test } from "@playwright/test";
test("public layer rotation renders and survives portable save/reopen", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { editor, AffineTransform } = window.luma;
    const canvas = document.createElement("canvas");
    canvas.width = 4;
    canvas.height = 2;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, 4, 2);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((value) => resolve(value!)),
    );
    const layer = await editor.importImage(
      new File([blob], "rotation.png", { type: "image/png" }),
    );
    editor.document.resize(16, 16);
    layer.transform = new AffineTransform(0, 1, -1, 0, 8, 0);
    const project = await editor.saveProject();
    await editor.openProject(new File([project], "rotation.luma"));
    const bitmap = await createImageBitmap(await editor.exportPng());
    canvas.width = canvas.height = 16;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    return {
      rotated: [...ctx.getImageData(7, 1, 1, 1).data],
      empty: [...ctx.getImageData(1, 1, 1, 1).data],
    };
  });
  expect(result).toEqual({ rotated: [255, 0, 0, 255], empty: [0, 0, 0, 0] });
});

test("moving between transformed groups preserves rendered pixels and undo", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { editor, AffineTransform, LayerGroup } = window.luma;
    const canvas = document.createElement("canvas");
    canvas.width = 4;
    canvas.height = 2;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#00ff00";
    context.fillRect(0, 0, 4, 2);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((value) => resolve(value!)),
    );
    const raster = await editor.importImage(
      new File([blob], "move.png", { type: "image/png" }),
    );
    editor.document.resize(16, 16);
    const a = new LayerGroup({ name: "Rotated" });
    const b = new LayerGroup({ name: "Scaled" });
    editor.document.layers.add(a);
    editor.document.layers.add(b);
    a.transform = new AffineTransform(0, 1, -1, 0, 12, 0);
    b.transform = AffineTransform.scale(2);
    raster.moveTo(a);
    const pixels = async () => {
      const bitmap = await createImageBitmap(await editor.exportPng());
      canvas.width = canvas.height = 16;
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      return [...context.getImageData(0, 0, 16, 16).data];
    };
    const before = await pixels();
    raster.moveTo(b, { preservePosition: true });
    const after = await pixels();
    editor.document.undo();
    const undone = await pixels();
    editor.document.redo();
    const redone = await pixels();
    return {
      equal: [after, undone, redone].every(
        (value) => JSON.stringify(value) === JSON.stringify(before),
      ),
      center: after.slice((1 * 16 + 11) * 4, (1 * 16 + 11) * 4 + 4),
    };
  });
  expect(result).toEqual({ equal: true, center: [0, 255, 0, 255] });
});

test("pointer movement and keyboard mask nudges use canvas coordinates under an affine parent", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const { editor, LayerGroup, AffineTransform, LayerMask, MarqueeSelection } =
      window.luma;
    const canvas = document.createElement("canvas");
    canvas.width = 40;
    canvas.height = 20;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, 40, 20);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((value) => resolve(value!)),
    );
    const raster = await editor.importImage(
      new File([blob], "Moving", { type: "image/png" }),
    );
    editor.document.resize(300, 200);
    const group = new LayerGroup({ name: "Rotated parent" });
    editor.document.layers.add(group);
    group.transform = new AffineTransform(0, 2, -2, 0, 200, 20);
    raster.moveTo(group);
    raster.update({ x: 10, y: 10 });
    raster.mask = new LayerMask({
      selection: new MarqueeSelection({
        shape: "rectangle",
        x: 0,
        y: 0,
        width: 40,
        height: 20,
      }),
    });
    editor.document.selectedLayer = raster;
  });
  await page
    .getByRole("button", { name: "Move tool (V)", exact: true })
    .click();
  await page.keyboard.press("Control+1");
  const position = () =>
    page.evaluate(() => {
      const layer = window.luma.editor.document.selectedLayer!;
      return { x: layer.x, y: layer.y, mx: layer.mask!.x, my: layer.mask!.y };
    });
  await page.keyboard.press("ArrowRight");
  expect(await position()).toEqual({ x: 10, y: 9.5, mx: 0, my: 0 });
  await page.keyboard.press("Control+z");
  const box = (await page.locator(".canvas-wrap").boundingBox())!;
  await page.mouse.move(box.x + 160, box.y + 70);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 80, { steps: 3 });
  await page.mouse.up();
  expect(await position()).toEqual({ x: 15, y: 0, mx: 0, my: 0 });
  await page.keyboard.press("Control+z");
  await page
    .getByRole("combobox", { name: "Move target", exact: true })
    .selectOption("mask");
  await page
    .getByRole("button", { name: "Move tool (V)", exact: true })
    .focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowDown");
  expect(await position()).toEqual({ x: 10, y: 10, mx: 5, my: -0.5 });
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+z");
  expect(await position()).toEqual({ x: 10, y: 10, mx: 0, my: 0 });
  await page.evaluate(() => {
    const layer = window.luma.editor.document.selectedLayer!;
    layer.mask = layer.mask!.with({ linked: false });
  });
  await page.keyboard.press("ArrowRight");
  expect(await position()).toEqual({ x: 10, y: 10, mx: 1, my: 0 });
});

for (const tool of ["brush", "pencil", "mask"] as const) {
  test(`${tool} paints at canvas coordinates with affine selection clipping`, async ({
    page,
  }) => {
    await page.goto("/");
    const result = await page.evaluate(async (tool) => {
      const {
        editor,
        LayerGroup,
        PaintLayer,
        PaintFill,
        LayerMask,
        AffineTransform,
        MarqueeSelection,
      } = window.luma;
      editor.newDocument({ width: 300, height: 200 });
      const group = new LayerGroup();
      editor.document.layers.add(group);
      group.transform = new AffineTransform(0, 2, -2, 0, 200, 20);
      const layer = group.layers.add(new PaintLayer());
      editor.document.selectedLayer = layer;
      if (tool === "mask") {
        layer.strokes.add(
          new PaintFill({
            bounds: { x: 0, y: 0, width: 100, height: 100 },
            color: "#ff0000",
          }),
        );
        layer.mask = new LayerMask({
          selection: new MarqueeSelection({
            shape: "rectangle",
            x: 0,
            y: 0,
            width: 100,
            height: 100,
          }),
        });
      }
      editor.tools.configure({
        paintTarget: tool === "mask" ? "mask-hide" : "layer",
      });
      editor.document.selection = new MarqueeSelection({
        shape: "rectangle",
        x: 150,
        y: 50,
        width: 20,
        height: 40,
      });
      editor.tools.configure({
        size: 6,
        color: "#ff0000",
        hardness: 1,
        opacity: 1,
        flow: 1,
        smoothing: 0,
        pressureSize: false,
        pressureOpacity: false,
      });
      const modifiers = { alt: false, shift: false, pressure: 1 };
      editor.tools.begin(
        tool === "mask" ? "brush" : tool,
        { x: 160, y: 60 },
        modifiers,
        1,
      );
      editor.tools.move({ x: 160, y: 100 }, modifiers);
      await editor.tools.end();
      const sample = async () => {
        const bitmap = await createImageBitmap(await editor.exportPng());
        const canvas = document.createElement("canvas");
        canvas.width = 300;
        canvas.height = 200;
        const context = canvas.getContext("2d")!;
        context.drawImage(bitmap, 0, 0);
        bitmap.close();
        return [
          context.getImageData(160, 70, 1, 1).data[3],
          context.getImageData(160, 100, 1, 1).data[3],
        ];
      };
      const painted = await sample();
      editor.document.undo();
      const undone = await sample();
      editor.document.redo();
      const redone = await sample();
      return { painted, undone, redone };
    }, tool);
    expect(result).toEqual(
      tool === "mask"
        ? { painted: [0, 255], undone: [255, 255], redone: [0, 255] }
        : { painted: [255, 0], undone: [0, 0], redone: [255, 0] },
    );
  });
}

test("fill and clear selection cover canvas geometry through a sheared parent", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const {
      editor,
      LayerGroup,
      PaintLayer,
      AffineTransform,
      MarqueeSelection,
    } = window.luma;
    editor.newDocument({ width: 80, height: 60 });
    const group = new LayerGroup();
    editor.document.layers.add(group);
    group.transform = new AffineTransform(1, 0.5, -0.4, 1.5, 30, -10);
    const paint = group.layers.add(new PaintLayer());
    editor.document.selectedLayer = paint;
    editor.tools.configure({ color: "#ff0000", opacity: 1 });
    const modifiers = { alt: false, shift: false, pressure: 1 };
    editor.tools.begin("fill", { x: 20, y: 20 }, modifiers, 1);
    await editor.tools.end();
    const samples = async () => {
      const bitmap = await createImageBitmap(await editor.exportPng());
      const canvas = document.createElement("canvas");
      canvas.width = 80;
      canvas.height = 60;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      return [
        [5, 5],
        [40, 30],
        [75, 55],
      ].map(([x, y]) => ctx.getImageData(x, y, 1, 1).data[3]);
    };
    const filled = await samples();
    editor.document.selection = new MarqueeSelection({
      shape: "rectangle",
      x: 30,
      y: 20,
      width: 20,
      height: 20,
    });
    editor.tools.fillSelection(true);
    const cleared = await samples();
    editor.document.undo();
    const undone = await samples();
    editor.document.redo();
    const redone = await samples();
    return { filled, cleared, undone, redone };
  });
  expect(result).toEqual({
    filled: [255, 255, 255],
    cleared: [255, 0, 255],
    undone: [255, 255, 255],
    redone: [255, 0, 255],
  });
});

test("new painting inside a transformed group retains canvas placement", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { editor, LayerGroup, AffineTransform } = window.luma;
    editor.newDocument({ width: 100, height: 100 });
    const group = new LayerGroup();
    editor.document.layers.add(group);
    group.transform = new AffineTransform(0, 2, -2, 0, 80, 10);
    editor.document.selectedLayer = group;
    editor.tools.configure({
      size: 10,
      hardness: 1,
      color: "#ff0000",
      opacity: 1,
      pressureSize: false,
      pressureOpacity: false,
    });
    editor.tools.begin(
      "brush",
      { x: 40, y: 40 },
      { alt: false, shift: false, pressure: 1 },
      1,
    );
    await editor.tools.end();
    const layer = group.layers.at(0)!;
    const world = group.transform.multiply(layer.transform);
    return { point: world.point({ x: 40, y: 40 }), count: group.layers.length };
  });
  expect(result).toEqual({ point: { x: 40, y: 40 }, count: 1 });
});

test("pen handles and anchor hit testing follow canvas coordinates under affine transforms", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { editor, LayerGroup, VectorLayer, AffineTransform } = window.luma;
    editor.newDocument({ width: 300, height: 200 });
    const group = new LayerGroup();
    editor.document.layers.add(group);
    group.transform = new AffineTransform(0, 2, -2, 0, 200, 20);
    const layer = group.layers.add(new VectorLayer());
    editor.document.selectedLayer = layer;
    const modifiers = { alt: false, shift: false, pressure: 1 };
    editor.tools.begin("pen", { x: 160, y: 60 }, modifiers, 1);
    editor.tools.move({ x: 140, y: 60 }, modifiers);
    await editor.tools.end();
    editor.tools.begin("pen", { x: 100, y: 100 }, modifiers, 1);
    await editor.tools.end();
    const first = structuredClone(layer.paths.at(0)!.points[0]);
    editor.tools.begin("pen", { x: 162, y: 60 }, modifiers, 1);
    editor.tools.move({ x: 172, y: 70 }, modifiers);
    await editor.tools.end();
    const moved = structuredClone(layer.paths.at(0)!.points[0]);
    editor.document.undo();
    const undone = structuredClone(layer.paths.at(0)!.points[0]);
    return { first, moved, undone, count: layer.paths.at(0)!.points.length };
  });
  expect(result.first).toMatchObject({
    x: 20,
    y: 20,
    out: { x: 20, y: 30 },
    in: { x: 20, y: 10 },
  });
  expect(result.moved).toMatchObject({
    x: 25,
    y: 15,
    out: { x: 25, y: 25 },
    in: { x: 25, y: 5 },
  });
  expect(result.undone).toEqual(result.first);
  expect(result.count).toBe(2);
});

test("pen overlays follow affine artwork while handles retain screen size", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    const { editor, LayerGroup, VectorLayer, VectorPath, AffineTransform } =
      window.luma;
    editor.newDocument({ width: 300, height: 200 });
    const group = new LayerGroup();
    editor.document.layers.add(group);
    group.transform = new AffineTransform(0, 2, -2, 0, 200, 20);
    const layer = group.layers.add(new VectorLayer());
    layer.paths.add(
      new VectorPath({
        points: [
          { x: 20, y: 20, in: { x: 10, y: 20 }, out: { x: 30, y: 20 } },
          { x: 40, y: 40 },
        ],
      }),
    );
    editor.document.selectedLayer = layer;
  });
  await page.keyboard.press("p");
  await page.keyboard.press("Control+1");
  const controls = page.getByTestId("pen-controls");
  const anchor = controls.locator("rect").first();
  await expect(anchor).toHaveAttribute("x", "156");
  await expect(anchor).toHaveAttribute("y", "56");
  await expect(controls.locator("circle").nth(1)).toHaveAttribute("cy", "80");
  const before = (await anchor.boundingBox())!;
  await page.evaluate(() => {
    window.luma.editor.document.layers.at(0)!.transform =
      new window.luma.AffineTransform(3, 1, 0.5, 2, 10, 5);
  });
  await expect(anchor).toHaveAttribute("x", "76");
  await expect(anchor).toHaveAttribute("y", "61");
  const after = (await anchor.boundingBox())!;
  expect(after.width).toBeCloseTo(before.width);
  expect(after.height).toBeCloseTo(before.height);
});

test("mask pen drags, nudges and creates contours in canvas coordinates", async ({
  page,
}) => {
  await page.goto("/");
  await page.keyboard.press("p");
  await page.evaluate(() => {
    const {
      editor,
      LayerGroup,
      PaintLayer,
      LayerMask,
      VectorPath,
      AffineTransform,
    } = window.luma;
    editor.newDocument({ width: 300, height: 200 });
    const group = new LayerGroup();
    editor.document.layers.add(group);
    group.transform = new AffineTransform(0, 2, -2, 0, 200, 20);
    const layer = group.layers.add(new PaintLayer());
    editor.document.selectedLayer = layer;
    layer.mask = new LayerMask({
      paths: [
        new VectorPath({
          closed: true,
          points: [
            { x: 20, y: 20 },
            { x: 60, y: 20 },
            { x: 60, y: 60 },
          ],
        }),
      ],
    });
    editor.tools.configure({ penEditTarget: "mask" });
  });
  await page.keyboard.press("p");
  const result = await page.evaluate(async () => {
    const { editor } = window.luma;
    const layer = editor.document.selectedLayer!;
    editor.tools.configure({ penEditTarget: "mask" });
    const modifiers = { alt: false, shift: false, pressure: 1 };
    editor.tools.begin("pen", { x: 160, y: 60 }, modifiers, 1);
    editor.tools.move({ x: 170, y: 70 }, modifiers);
    await editor.tools.end();
    editor.tools.nudgeMaskPoint(10, 0);
    const moved = layer.mask!.paths[0].points[0];
    editor.document.undo();
    editor.document.undo();
    const undone = layer.mask!.paths[0].points[0];
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    editor.tools.startMaskContour();
    for (const point of [
      { x: 100, y: 100 },
      { x: 120, y: 100 },
      { x: 120, y: 120 },
    ]) {
      editor.tools.begin("pen", point, modifiers, 1);
      await editor.tools.end();
    }
    editor.tools.finishPath();
    return {
      moved: { x: moved.x, y: moved.y },
      undone: { x: undone.x, y: undone.y },
      contour: layer.mask!.paths[1].points.map((p) => ({ x: p.x, y: p.y })),
    };
  });
  expect(result).toEqual({
    moved: { x: 25, y: 10 },
    undone: { x: 20, y: 20 },
    contour: [
      { x: 40, y: 50 },
      { x: 40, y: 40 },
      { x: 50, y: 40 },
    ],
  });
});

test("resize handles follow rotated raster corners and preserve the opposite corner", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const { editor, AffineTransform } = window.luma;
    const canvas = document.createElement("canvas");
    canvas.width = 40;
    canvas.height = 20;
    canvas.getContext("2d")!.fillRect(0, 0, 40, 20);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((value) => resolve(value!)),
    );
    const layer = await editor.importImage(
      new File([blob], "Resize", { type: "image/png" }),
    );
    editor.document.resize(300, 200);
    layer.transform = new AffineTransform(0, 2, -2, 0, 200, 20);
  });
  await page
    .getByRole("button", { name: "Move tool (V)", exact: true })
    .click();
  await page.keyboard.press("Control+1");
  const box = (await page.locator(".canvas-wrap").boundingBox())!;
  const handle = page.locator('[data-handle="nw"]');
  const handleBox = (await handle.boundingBox())!;
  expect(handleBox.x + handleBox.width / 2 - box.x).toBeCloseTo(200, 0);
  expect(handleBox.y + handleBox.height / 2 - box.y).toBeCloseTo(20, 0);
  await page.mouse.move(handleBox.x + 4, handleBox.y + 4);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + 24, handleBox.y + 14, { steps: 3 });
  await page.mouse.up();
  const read = () =>
    page.evaluate(() => {
      const layer = window.luma.editor.document.selectedLayer!;
      const data = layer.toJSON();
      if (data.kind !== "raster") throw new Error("Expected raster");
      return {
        x: data.x,
        y: data.y,
        width: data.width,
        height: data.height,
        opposite: layer.transform.point({ x: data.width, y: data.height }),
      };
    });
  expect(await read()).toEqual({
    x: 220,
    y: 30,
    width: 35,
    height: 30,
    opposite: { x: 160, y: 100 },
  });
  await page.keyboard.press("Control+z");
  expect(await read()).toEqual({
    x: 200,
    y: 20,
    width: 40,
    height: 20,
    opposite: { x: 160, y: 100 },
  });
});

test("canvas selection becomes an aligned mask on transformed artwork and survives reopening", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const {
      editor,
      LayerGroup,
      PaintLayer,
      PaintFill,
      AffineTransform,
      MarqueeSelection,
    } = window.luma;
    editor.newDocument({ width: 100, height: 100 });
    const group = new LayerGroup();
    editor.document.layers.add(group);
    group.transform = new AffineTransform(0, 2, -2, 0, 100, 0);
    const layer = group.layers.add(new PaintLayer());
    layer.strokes.add(
      new PaintFill({
        bounds: { x: 0, y: 0, width: 50, height: 50 },
        color: "#ff0000",
      }),
    );
    editor.document.selection = new MarqueeSelection({
      shape: "rectangle",
      x: 20,
      y: 30,
      width: 30,
      height: 20,
    });
    layer.maskFromSelection(editor.document.selection!);
    const pixels = async () => {
      const bitmap = await createImageBitmap(await editor.exportPng());
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 100;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      return [
        [25, 35],
        [10, 35],
        [25, 60],
      ].map(([x, y]) => ctx.getImageData(x, y, 1, 1).data[3]);
    };
    const masked = await pixels();
    editor.document.undo();
    const undone = await pixels();
    editor.document.redo();
    const project = await editor.saveProject();
    await editor.openProject(new File([project], "masked.luma"));
    return {
      masked,
      undone,
      reopened: await pixels(),
      selection: editor.document.selection!.toJSON().regions[0],
    };
  });
  expect(result.masked).toEqual([255, 0, 0]);
  expect(result.undone).toEqual([255, 255, 255]);
  expect(result.reopened).toEqual(result.masked);
  expect(result.selection).toMatchObject({
    x: 20,
    y: 30,
    width: 30,
    height: 20,
  });
});

for (const unlinkedMask of [false, true])
  test(`clone samples canvas pixels into a rotated paint layer with unlinked mask ${unlinkedMask}`, async ({
    page,
  }) => {
    await page.goto("/");
    const result = await page.evaluate(async (unlinkedMask) => {
      const {
        editor,
        LayerGroup,
        PaintLayer,
        LayerMask,
        MarqueeSelection,
        AffineTransform,
      } = window.luma;
      const canvas = document.createElement("canvas");
      canvas.width = 200;
      canvas.height = 120;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ff0000";
      ctx.fillRect(10, 10, 30, 30);
      ctx.fillStyle = "#00ff00";
      ctx.fillRect(20, 10, 20, 30);
      const blob = await new Promise<Blob>((resolve) =>
        canvas.toBlob((value) => resolve(value!)),
      );
      const source = await editor.importImage(
        new File([blob], "Source", { type: "image/png" }),
      );
      if (unlinkedMask)
        source.mask = new LayerMask({
          linked: false,
          selection: new MarqueeSelection({
            shape: "rectangle",
            x: 10,
            y: 10,
            width: 10,
            height: 30,
          }),
        });
      const group = new LayerGroup();
      editor.document.layers.add(group);
      group.transform = new AffineTransform(0, 2, -2, 0, 200, 20);
      const layer = group.layers.add(new PaintLayer());
      editor.document.selectedLayer = layer;
      editor.tools.configure({
        size: 10,
        hardness: 1,
        opacity: 1,
        flow: 1,
        pressureSize: false,
        pressureOpacity: false,
      });
      editor.tools.begin(
        "clone",
        { x: 20, y: 20 },
        { alt: true, shift: false, pressure: 1 },
        1,
      );
      editor.tools.begin(
        "clone",
        { x: 160, y: 60 },
        { alt: false, shift: false, pressure: 1 },
        1,
      );
      await editor.tools.end();
      const sample = async () => {
        const bitmap = await createImageBitmap(await editor.exportPng());
        ctx.clearRect(0, 0, 200, 120);
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        return [
          [156, 60],
          [164, 60],
        ].map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data]);
      };
      const cloned = await sample();
      editor.document.undo();
      const undone = await sample();
      editor.document.redo();
      const project = await editor.saveProject();
      await editor.openProject(new File([project], "clone.luma"));
      return { cloned, undone, reopened: await sample() };
    }, unlinkedMask);
    expect(result.cloned).toEqual([
      [255, 0, 0, 255],
      unlinkedMask ? [0, 0, 0, 0] : [0, 255, 0, 255],
    ]);
    expect(result.undone).toEqual([
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    expect(result.reopened).toEqual(result.cloned);
  });

test("mask link toggles preserve transformed coverage, refinements and portable pixels", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const {
      editor,
      LayerGroup,
      PaintLayer,
      PaintFill,
      LayerMask,
      MarqueeSelection,
      BrushStroke,
      AffineTransform,
    } = window.luma;
    editor.newDocument({ width: 100, height: 100 });
    const group = new LayerGroup();
    editor.document.layers.add(group);
    group.transform = new AffineTransform(0, 2, -2, 0, 100, 0);
    const layer = group.layers.add(new PaintLayer());
    layer.strokes.add(
      new PaintFill({
        bounds: { x: 0, y: 0, width: 50, height: 50 },
        color: "#ff0000",
      }),
    );
    layer.mask = new LayerMask({
      selection: new MarqueeSelection({
        shape: "rectangle",
        x: 10,
        y: 10,
        width: 20,
        height: 20,
      }),
      x: 2,
      y: 3,
    }).paint(
      new BrushStroke({ points: [{ x: 20, y: 20 }], size: 8, hardness: 1 }),
      "hide",
    );
    const pixels = async () => {
      const bitmap = await createImageBitmap(await editor.exportPng());
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 100;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      return [...ctx.getImageData(0, 0, 100, 100).data];
    };
    const before = await pixels();
    layer.setMaskLinked(false);
    const unlinked = await pixels();
    layer.mask = layer.mask!.with({ density: 0.5 });
    layer.mask = layer.mask!.with({ density: 1 });
    layer.setMaskLinked(true);
    const linked = await pixels();
    editor.document.undo();
    const undone = await pixels();
    const project = await editor.saveProject();
    await editor.openProject(new File([project], "mask-link.luma"));
    return [unlinked, linked, undone, await pixels()].every(
      (value) => JSON.stringify(value) === JSON.stringify(before),
    );
  });
  expect(result).toBe(true);
});

test("rotation slider and precise input rotate in canvas space around the artwork center", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const { editor, LayerGroup, AffineTransform } = window.luma;
    const canvas = document.createElement("canvas");
    canvas.width = 40;
    canvas.height = 20;
    canvas.getContext("2d")!.fillRect(0, 0, 40, 20);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((value) => resolve(value!)),
    );
    const layer = await editor.importImage(
      new File([blob], "Rotate", { type: "image/png" }),
    );
    editor.document.resize(200, 150);
    const group = new LayerGroup();
    editor.document.layers.add(group);
    group.transform = new AffineTransform(2, 0, 0, 1, 50, 20);
    layer.moveTo(group);
    editor.document.selectedLayer = layer;
  });
  const input = page.getByRole("spinbutton", {
    name: "Rotation value",
    exact: true,
  });
  await input.fill("90");
  await input.press("Enter");
  const read = () =>
    page.evaluate(async () => {
      const { layerTransform } = await import(
        /* @vite-ignore */ String("/src/core/spatial.ts")
      );
      const doc = window.luma.editor.document;
      const world = layerTransform(doc.toJSON(), doc.selectedLayer!.id)!;
      return {
        angle: (Math.atan2(world.b, world.a) * 180) / Math.PI,
        center: world.point({ x: 20, y: 10 }),
        xScale: Math.hypot(world.a, world.b),
        yScale: Math.hypot(world.c, world.d),
      };
    });
  const rotated = await read();
  expect(rotated.angle).toBeCloseTo(90);
  expect(rotated.center.x).toBeCloseTo(90);
  expect(rotated.center.y).toBeCloseTo(30);
  expect(rotated.xScale).toBeCloseTo(2);
  expect(rotated.yScale).toBeCloseTo(1);
  await page
    .getByRole("button", { name: "Move tool (V)", exact: true })
    .focus();
  await page.keyboard.press("Control+z");
  expect((await read()).angle).toBeCloseTo(0);
  await page.getByRole("slider", { name: "Rotation", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  expect((await read()).angle).toBeCloseTo(0.1);
});

test("rotation handle previews, snaps and commits a single undoable rotation", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const { editor } = window.luma;
    const canvas = document.createElement("canvas");
    canvas.width = 80;
    canvas.height = 40;
    canvas.getContext("2d")!.fillRect(0, 0, 80, 40);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((value) => resolve(value!)),
    );
    const layer = await editor.importImage(
      new File([blob], "Handle", { type: "image/png" }),
    );
    editor.document.resize(250, 200);
    layer.update({ x: 60, y: 60 });
  });
  await page
    .getByRole("button", { name: "Move tool (V)", exact: true })
    .click();
  await page.keyboard.press("Control+1");
  const box = (await page.locator(".canvas-wrap").boundingBox())!;
  const handle = (await page
    .getByRole("button", { name: "Drag to rotate layer" })
    .boundingBox())!;
  const revision = await page.evaluate(
    () => window.luma.editor.document.getSnapshot().revision,
  );
  await page.keyboard.down("Shift");
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(box.x + 150, box.y + 80, { steps: 4 });
  expect(
    await page.evaluate(
      () => window.luma.editor.document.getSnapshot().revision,
    ),
  ).toBe(revision);
  await page.mouse.up();
  await page.keyboard.up("Shift");
  const result = await page.evaluate(() => {
    const doc = window.luma.editor.document,
      matrix = doc.selectedLayer!.transform;
    return {
      angle: (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI,
      center: matrix.point({ x: 40, y: 20 }),
      revision: doc.getSnapshot().revision,
    };
  });
  expect(result.angle).toBeCloseTo(90);
  expect(result.center.x).toBeCloseTo(100);
  expect(result.center.y).toBeCloseTo(80);
  expect(result.revision).toBe(revision + 1);
  await page.keyboard.press("Control+z");
  expect(
    await page.evaluate(
      () => window.luma.editor.document.selectedLayer!.transform.b,
    ),
  ).toBe(0);
  await page.keyboard.press("Control+Shift+z");
  expect(
    await page.evaluate(
      () => window.luma.editor.document.selectedLayer!.transform.b,
    ),
  ).toBeCloseTo(1);
  const beforeCancel = await page.evaluate(() =>
    JSON.stringify(window.luma.editor.document.toJSON()),
  );
  const nextHandle = (await page
    .getByRole("button", { name: "Drag to rotate layer" })
    .boundingBox())!;
  await page.mouse.move(
    nextHandle.x + nextHandle.width / 2,
    nextHandle.y + nextHandle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(box.x + 140, box.y + 120, { steps: 3 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(
    await page.evaluate(() =>
      JSON.stringify(window.luma.editor.document.toJSON()),
    ),
  ).toBe(beforeCancel);
});
