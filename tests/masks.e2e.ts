import {expectPenControl} from './pen-control-position';
import { test, expect } from "@playwright/test";

test("mask inspector supports keyboard toggles, density, undo and script/project round trips", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    const { editor, PaintLayer, PaintFill, MarqueeSelection } = window.luma;
    editor.newDocument({ width: 120, height: 80 });
    const layer = editor.document.layers.add(new PaintLayer());
    layer.strokes.add(
      new PaintFill({
        bounds: { x: 0, y: 0, width: 120, height: 80 },
        color: "#ff0000",
      }),
    );
    editor.document.selectedLayer = layer;
    editor.document.selection = new MarqueeSelection({
      shape: "rectangle",
      x: 10,
      y: 10,
      width: 40,
      height: 40,
    });
  });
  await page
    .getByRole("button", { name: "Mask from selection", exact: true })
    .click();
  const alpha = () =>
    page.evaluate(async () => {
      const e = window.luma.editor;
      const rendered = await e.renderer.render(
        e.document.toJSON(),
        e.assetStore,
      );
      const c = rendered.getContext("2d")!;
      const result = [
        c.getImageData(20, 20, 1, 1).data[3],
        c.getImageData(80, 20, 1, 1).data[3],
      ];
      rendered.width = rendered.height = 1;
      return result;
    });
  expect(await alpha()).toEqual([255, 0]);
  const invert = page.getByRole("checkbox", { name: "Invert layer mask" });
  await invert.focus();
  await page.keyboard.press("Space");
  expect(await alpha()).toEqual([0, 255]);
  const density = page.getByRole("spinbutton", {
    name: "Mask density value",
    exact: true,
  });
  await density.fill("50");
  await density.press("Enter");
  const half = await alpha();
  expect(half[0]).toBeGreaterThanOrEqual(127);
  expect(half[0]).toBeLessThanOrEqual(128);
  await page.getByRole("button", { name: "Undo (Mod+Z)", exact: true }).click();
  expect(await alpha()).toEqual([0, 255]);
  await page.evaluate(async () => {
    const e = window.luma.editor;
    await e.runScript(
      "document.selectedLayer.mask = document.selectedLayer.mask.with({ inverted: false }); print(new LayerMask({selection: new MarqueeSelection(), inverted: true}).enabled);",
    );
    await e.openProject(new File([await e.saveProject()], "mask.luma"));
    e.document.selectedLayer = e.document.layers.at(0)!;
  });
  expect(await alpha()).toEqual([255, 0]);
  await page.getByRole("checkbox", { name: "Enable layer mask" }).uncheck();
  expect(await alpha()).toEqual([255, 255]);
  await page.getByRole("button", { name: "Remove layer mask" }).click();
  await expect(
    page.getByRole("button", { name: "Add reveal-all mask" }),
  ).toBeVisible();
});

test("nested masks with holes and shadows agree with tiled export and invalidate cached content", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const {
      editor: e,
      LayerGroup,
      PaintLayer,
      PaintFill,
      LayerMask,
      MarqueeSelection,
      LayerStyle,
    } = window.luma;
    e.newDocument({ width: 2100, height: 600 });
    const group = e.document.layers.add(new LayerGroup({ x: 20, y: 10 }));
    const layer = group.layers.add(new PaintLayer({ x: 5, y: 5 }));
    layer.strokes.add(
      new PaintFill({
        bounds: { x: 0, y: 0, width: 2075, height: 585 },
        color: "#ec8244",
      }),
    );
    layer.mask = new LayerMask({
      selection: new MarqueeSelection({
        shape: "ellipse",
        x: 1950,
        y: 180,
        width: 145,
        height: 240,
      }).combine(
        new MarqueeSelection({
          shape: "rectangle",
          x: 2010,
          y: 200,
          width: 15,
          height: 180,
        }),
        "subtract",
      ),
      feather: 8,
    });
    layer.styles = new LayerStyle({
      dropShadow: {
        enabled: true,
        opacity: 0.5,
        blur: 8,
        x: -12,
        y: 10,
        color: "#000000",
      },
    });
    group.mask = new LayerMask({
      selection: new MarqueeSelection({
        shape: "rectangle",
        x: 1900,
        y: 180,
        width: 180,
        height: 300,
      }),
      density: 0.7,
      feather: 4.25,
    });
    const options = { maxPixels: 2100 * 600, maxDimension: 2100 };
    const whole = await e.renderer.render(
      e.document.toJSON(),
      e.assetStore,
      options,
    );
    const bitmap = await createImageBitmap(await e.exportPng());
    const output = document.createElement("canvas");
    output.width = 2100;
    output.height = 600;
    const c = output.getContext("2d")!;
    c.drawImage(bitmap, 0, 0);
    bitmap.close();
    const a = whole.getContext("2d")!.getImageData(0, 0, 2100, 600).data,
      b = c.getImageData(0, 0, 2100, 600).data;
    let maxAlpha = 0;
    for (let i = 3; i < a.length; i += 4)
      maxAlpha = Math.max(maxAlpha, Math.abs(a[i] - b[i]));
    const old = a[(300 * 2100 + 2000) * 4 + 3];
    layer.mask = layer.mask.with({ inverted: true });
    const cached = await e.renderer.render(
      e.document.toJSON(),
      e.assetStore,
      options,
    );
    const fresh = await e.renderer.render(e.document.toJSON(), e.assetStore, {
      ...options,
      cache: false,
    });
    const cp = cached.getContext("2d")!.getImageData(0, 0, 2100, 600).data,
      fp = fresh.getContext("2d")!.getImageData(0, 0, 2100, 600).data;
    let maxCached = 0;
    for (let i = 0; i < cp.length; i++)
      maxCached = Math.max(maxCached, Math.abs(cp[i] - fp[i]));
    const updated = cp[(300 * 2100 + 2000) * 4 + 3];
    for (const canvas of [whole, output, cached, fresh])
      canvas.width = canvas.height = 1;
    return { maxAlpha, maxCached, old, updated };
  });
  expect(result.maxAlpha).toBeLessThanOrEqual(1);
  expect(result.maxCached).toBe(0);
  expect(result.old).toBeGreaterThan(result.updated);
});

test("vector mask UI copies closed paths, switches hole rules and survives scripted edits and reopen", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    const {
      editor: e,
      PaintLayer,
      PaintFill,
      VectorLayer,
      VectorPath,
      LayerGroup,
    } = window.luma;
    e.newDocument({ width: 140, height: 100 });
    const group = e.document.layers.add(new LayerGroup({ x: 20, y: 10 }));
    const source = group.layers.add(
      new VectorLayer({ name: "Cutout paths", visible: false }),
    );
    for (const [x, y, width, height] of [
      [0, 0, 80, 60],
      [20, 20, 20, 20],
    ])
      source.paths.add(
        new VectorPath({
          closed: true,
          points: [
            { x, y },
            { x: x + width, y },
            { x: x + width, y: y + height },
            { x, y: y + height },
          ],
        }),
      );
    const target = e.document.layers.add(new PaintLayer({ x: 10, y: 10 }));
    target.strokes.add(
      new PaintFill({
        bounds: { x: 0, y: 0, width: 130, height: 90 },
        color: "#ee9955",
      }),
    );
    e.document.selectedLayer = target;
  });
  await page
    .getByRole("combobox", { name: "Mask path source", exact: true })
    .selectOption({ label: "Cutout paths" });
  await page
    .getByRole("button", { name: "Mask from paths", exact: true })
    .click();
  const alpha = () =>
    page.evaluate(async () => {
      const e = window.luma.editor;
      const canvas = await e.renderer.render(e.document.toJSON(), e.assetStore);
      const c = canvas.getContext("2d")!;
      const result = [
        [30, 20],
        [50, 40],
        [120, 40],
      ].map(([x, y]) => c.getImageData(x, y, 1, 1).data[3]);
      canvas.width = canvas.height = 1;
      return result;
    });
  expect(await alpha()).toEqual([255, 0, 0]);
  await page
    .getByRole("combobox", { name: "Mask fill rule", exact: true })
    .selectOption("nonzero");
  expect(await alpha()).toEqual([255, 255, 0]);
  await page.getByRole("button", { name: "Undo (Mod+Z)", exact: true }).click();
  expect(await alpha()).toEqual([255, 0, 0]);
  await page.evaluate(async () => {
    const e = window.luma.editor;
    await e.runScript(
      "const mask = document.selectedLayer.mask; const paths = mask.paths; paths.pop(); document.selectedLayer.mask = mask.with({ paths });",
    );
    const id = e.document.selectedLayer!.id;
    await e.openProject(new File([await e.saveProject()], "vector-mask.luma"));
    e.document.selectedLayer = e.document.getLayer(id);
  });
  expect(await alpha()).toEqual([255, 255, 0]);
  await expect(
    page.getByText("Bézier path mask", { exact: true }),
  ).toBeVisible();
});

test("curved vector masks preserve compound holes across export tiles", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const {
      editor: e,
      PaintLayer,
      PaintFill,
      LayerMask,
      VectorPath,
    } = window.luma;
    e.newDocument({ width: 2100, height: 600 });
    const layer = e.document.layers.add(new PaintLayer());
    layer.strokes.add(
      new PaintFill({
        bounds: { x: 0, y: 0, width: 2100, height: 600 },
        color: "#ab5533",
      }),
    );
    const outer = new VectorPath({
      closed: true,
      points: [
        { x: 1950, y: 300, in: { x: 1950, y: 200 }, out: { x: 1950, y: 400 } },
        { x: 2090, y: 300, in: { x: 2090, y: 400 }, out: { x: 2090, y: 200 } },
      ],
    });
    const hole = new VectorPath({
      closed: true,
      points: [
        { x: 2010, y: 285 },
        { x: 2050, y: 285 },
        { x: 2050, y: 315 },
        { x: 2010, y: 315 },
      ],
    });
    layer.mask = new LayerMask({
      paths: [outer, hole],
      density: 0.8,
      feather: 9.5,
    });
    const whole = await e.renderer.render(e.document.toJSON(), e.assetStore, {
      maxPixels: 2100 * 600,
      maxDimension: 2100,
    });
    const bitmap = await createImageBitmap(await e.exportPng());
    const exported = document.createElement("canvas");
    exported.width = 2100;
    exported.height = 600;
    exported.getContext("2d")!.drawImage(bitmap, 0, 0);
    bitmap.close();
    const a = whole.getContext("2d")!.getImageData(0, 0, 2100, 600).data,
      b = exported.getContext("2d")!.getImageData(0, 0, 2100, 600).data;
    let max = 0;
    const differences: unknown[] = [];
    for (let i = 3; i < a.length; i += 4) {
      const d = Math.abs(a[i] - b[i]);
      if (d > max) {
        max = d;
        differences.push({
          x: Math.floor(i / 4) % 2100,
          y: Math.floor(i / 4 / 2100),
          a: a[i],
          b: b[i],
        });
      }
    }
    const samples = [1980, 2030].map((x) => a[(300 * 2100 + x) * 4 + 3]);
    whole.width = whole.height = exported.width = exported.height = 1;
    return { max, samples, differences };
  });
  console.log("Vector mask tile comparison", result);
  expect(result.max).toBeLessThanOrEqual(1);
  expect(result.samples[0]).toBe(255);
  expect(result.samples[1]).toBeGreaterThanOrEqual(50);
  expect(result.samples[1]).toBeLessThanOrEqual(51);
});

test("mask feather controls soften edges, share undo and persist through scripts and reopen", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    const {
      editor: e,
      PaintLayer,
      PaintFill,
      LayerMask,
      MarqueeSelection,
    } = window.luma;
    e.newDocument({ width: 128, height: 96 });
    const layer = e.document.layers.add(new PaintLayer());
    layer.strokes.add(
      new PaintFill({
        bounds: { x: 0, y: 0, width: 128, height: 96 },
        color: "#aa6633",
      }),
    );
    layer.mask = new LayerMask({
      selection: new MarqueeSelection({
        shape: "rectangle",
        x: 32,
        y: 16,
        width: 64,
        height: 64,
      }),
    });
    e.document.selectedLayer = layer;
  });
  const alpha = () =>
    page.evaluate(async () => {
      const e = window.luma.editor,
        canvas = await e.renderer.render(e.document.toJSON(), e.assetStore);
      const c = canvas.getContext("2d")!,
        result = [31, 32].map((x) => c.getImageData(x, 48, 1, 1).data[3]);
      canvas.width = canvas.height = 0;
      return result;
    });
  expect(await alpha()).toEqual([0, 255]);
  const input = page.getByRole("spinbutton", {
    name: "Mask feather value",
    exact: true,
  });
  await input.fill("12.5");
  await input.press("Enter");
  const softened = await alpha();
  expect(softened[0]).toBeGreaterThan(0);
  expect(softened[0]).toBeLessThan(128);
  expect(softened[1]).toBeGreaterThan(128);
  expect(softened[1]).toBeLessThan(255);
  expect(Math.abs(softened[0] + softened[1] - 255)).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "Undo (Mod+Z)", exact: true }).click();
  expect(await alpha()).toEqual([0, 255]);
  await page
    .getByRole("button", { name: "Redo (Mod+Shift+Z)", exact: true })
    .click();
  expect(await alpha()).toEqual(softened);
  await page.evaluate(async () => {
    const e = window.luma.editor;
    await e.runScript(
      "document.selectedLayer.mask = document.selectedLayer.mask.with({ feather: 6.25 });",
    );
    await e.openProject(new File([await e.saveProject()], "soft-mask.luma"));
    e.document.selectedLayer = e.document.layers.at(0)!;
  });
  await expect(input).toHaveValue("6.25");
});

test("mask positioning and link controls keep unlinked masks fixed through layer and parent moves", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    const {
      editor: e,
      LayerGroup,
      PaintLayer,
      PaintFill,
      LayerMask,
      MarqueeSelection,
    } = window.luma;
    e.newDocument({ width: 160, height: 100 });
    const parent = e.document.layers.add(new LayerGroup({ x: 10, y: 0 }));
    const layer = parent.layers.add(new PaintLayer({ x: 10, y: 0 }));
    layer.strokes.add(
      new PaintFill({
        bounds: { x: 0, y: 0, width: 140, height: 100 },
        color: "#ee8844",
      }),
    );
    layer.mask = new LayerMask({
      selection: new MarqueeSelection({
        shape: "rectangle",
        x: 10,
        y: 10,
        width: 20,
        height: 60,
      }),
    });
    e.document.selectedLayer = layer;
  });
  const pixels = () =>
    page.evaluate(async () => {
      const e = window.luma.editor,
        c = await e.renderer.render(e.document.toJSON(), e.assetStore);
      const result = [35, 45, 55, 65].map(
        (x) => c.getContext("2d")!.getImageData(x, 40, 1, 1).data[3],
      );
      c.width = c.height = 0;
      return result;
    });
  expect(await pixels()).toEqual([255, 255, 0, 0]);
  const link = page.getByRole("checkbox", {
    name: "Link mask to layer",
    exact: true,
  });
  await link.uncheck();
  expect(await pixels()).toEqual([255, 255, 0, 0]);
  await expect(
    page.getByRole("spinbutton", { name: "Mask X", exact: true }),
  ).toHaveValue("20");
  await page.evaluate(() => {
    window.luma.editor.document.layers.at(0)!.x += 10;
  });
  expect(await pixels()).toEqual([255, 255, 0, 0]);
  await link.check();
  expect(await pixels()).toEqual([255, 255, 0, 0]);
  await page.evaluate(() => {
    window.luma.editor.document.layers.at(0)!.x += 10;
  });
  expect(await pixels()).toEqual([0, 255, 255, 0]);
  const x = page.getByRole("spinbutton", { name: "Mask X", exact: true });
  await x.fill("0");
  await x.press("Enter");
  expect(await pixels()).toEqual([0, 0, 255, 255]);
  await page.getByRole("button", { name: "Undo (Mod+Z)", exact: true }).click();
  expect(await pixels()).toEqual([0, 255, 255, 0]);
  await page.evaluate(async () => {
    const e = window.luma.editor;
    await e.runScript(
      "document.selectedLayer.setMaskLinked(false); document.selectedLayer.mask = document.selectedLayer.mask.with({ y: 2.5 });",
    );
    const id = e.document.selectedLayer!.id;
    await e.openProject(
      new File([await e.saveProject()], "positioned-mask.luma"),
    );
    e.document.selectedLayer = e.document.getLayer(id);
  });
  await expect(link).not.toBeChecked();
  await expect(
    page.getByRole("spinbutton", { name: "Mask Y", exact: true }),
  ).toHaveValue("2.5");
  expect(await pixels()).toEqual([0, 255, 255, 0]);
});

test("Move target drags and nudges masks independently with preview, cancellation and one undo", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    const {
      editor: e,
      PaintLayer,
      PaintFill,
      LayerMask,
      MarqueeSelection,
    } = window.luma;
    e.newDocument({ width: 300, height: 200 });
    const layer = e.document.layers.add(
      new PaintLayer({ name: "Move mask", x: 10 }),
    );
    layer.strokes.add(
      new PaintFill({
        bounds: { x: 0, y: 0, width: 290, height: 200 },
        color: "#ff8800",
      }),
    );
    layer.mask = new LayerMask({
      selection: new MarqueeSelection({
        shape: "rectangle",
        x: 20,
        y: 20,
        width: 80,
        height: 80,
      }),
    });
    e.document.selectedLayer = layer;
  });
  await page.keyboard.press("Control+1");
  const target = page.getByRole("combobox", {
    name: "Move target",
    exact: true,
  });
  await target.selectOption("mask");
  const box = (await page.locator(".canvas-wrap").boundingBox())!;
  const read = () =>
    page.evaluate(() => {
      const e = window.luma.editor,
        l = e.document.selectedLayer!;
      return {
        x: l.x,
        y: l.y,
        mx: l.mask!.x,
        my: l.mask!.y,
        linked: l.mask!.linked,
        past: e.document.getSnapshot().past.length,
      };
    });
  const before = await read();
  await page.mouse.move(box.x + 60, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 85, box.y + 75, { steps: 5 });
  await expect(
    page.getByRole("spinbutton", { name: "Mask X", exact: true }),
  ).toHaveValue("25");
  expect(await read()).toEqual(before);
  await page.mouse.up();
  expect(await read()).toEqual({
    ...before,
    mx: 25,
    my: 15,
    past: before.past + 1,
  });
  await page.keyboard.press("Control+z");
  expect(await read()).toEqual(before);
  await page.keyboard.press("Control+Shift+z");
  await page.mouse.move(box.x + 60, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 100, box.y + 80);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await read()).toEqual({
    ...before,
    mx: 25,
    my: 15,
    past: before.past + 1,
  });
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowDown");
  expect(await read()).toEqual({
    ...before,
    mx: 26,
    my: 25,
    past: before.past + 3,
  });
  await page
    .getByRole("checkbox", { name: "Link mask to layer", exact: true })
    .uncheck();
  const unlinked = await read();
  await page.mouse.move(box.x + 60, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 70, box.y + 65);
  await page.mouse.up();
  expect(await read()).toEqual({
    ...unlinked,
    mx: unlinked.mx + 10,
    my: unlinked.my + 5,
    past: unlinked.past + 1,
  });
  await page.evaluate(() => {
    window.luma.editor.document.selectedLayer!.locked = true;
  });
  const locked = await read();
  await page.mouse.move(box.x + 60, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 90, box.y + 90);
  await page.mouse.up();
  await page.keyboard.press("ArrowLeft");
  expect(await read()).toEqual(locked);
  await page.evaluate(() => {
    const e = window.luma.editor;
    e.document.selectedLayer = e.document.layers.add(
      new window.luma.PaintLayer(),
    );
  });
  await expect(target).toHaveValue("layer");
});

test("painted masks hide and reveal with brush controls, cancel, undo and reopen", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    const { editor: e, PaintLayer, PaintFill } = window.luma;
    e.newDocument({ width: 200, height: 140 });
    const layer = e.document.layers.add(new PaintLayer({ x: 10 }));
    layer.strokes.add(
      new PaintFill({
        bounds: { x: 0, y: 0, width: 190, height: 140 },
        color: "#ee6600",
      }),
    );
    e.document.selectedLayer = layer;
  });
  await page
    .getByRole("button", { name: "Add painted mask", exact: true })
    .click();
  await page.evaluate(() => {
    const { editor: e, MarqueeSelection } = window.luma;
    e.document.selectedLayer!.mask = e.document.selectedLayer!.mask!.with({
      linked: false,
      x: 5,
    });
    e.document.selection = new MarqueeSelection({
      shape: "rectangle",
      x: 50,
      y: 30,
      width: 30,
      height: 60,
    });
  });
  await page.keyboard.press("Control+1");
  await page
    .getByRole("button", { name: "Brush tool (B)", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Paint target", exact: true })
    .selectOption("mask-hide");
  const box = (await page.locator(".canvas-wrap").boundingBox())!;
  const pixels = () =>
    page.evaluate(async () => {
      const e = window.luma.editor,
        c = await e.renderer.render(e.document.toJSON(), e.assetStore);
      const ctx = c.getContext("2d")!,
        result = [
          ctx.getImageData(60, 60, 1, 1).data[3],
          ctx.getImageData(90, 60, 1, 1).data[3],
        ];
      c.width = c.height = 1;
      return result;
    });
  const count = () =>
    page.evaluate(() => window.luma.editor.document.getSnapshot().past.length);
  const before = await count();
  const artwork = () =>
    page
      .locator(".canvas-wrap canvas")
      .evaluate((node) => (node as HTMLCanvasElement).toDataURL());
  const untouched = await artwork();
  await page.mouse.move(box.x + 60, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 90, box.y + 60, { steps: 6 });
  expect(await count()).toBe(before);
  expect(
    await page.evaluate(() => ({
      command: window.luma.editor.tools.getSnapshot().preview,
      mode: window.luma.editor.tools.getSnapshot().paintPreview?.maskMode,
    })),
  ).toEqual({ command: null, mode: "hide" });
  await expect.poll(artwork).not.toBe(untouched);
  await page.mouse.up();
  expect(await count()).toBe(before + 1);
  expect(await pixels()).toEqual([0, 255]);
  await page.keyboard.press("Control+z");
  expect(await pixels()).toEqual([255, 255]);
  await page.keyboard.press("Control+Shift+z");
  await page
    .getByRole("combobox", { name: "Paint target", exact: true })
    .selectOption("mask-reveal");
  await page.mouse.move(box.x + 60, box.y + 60);
  await page.mouse.down();
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await pixels()).toEqual([0, 255]);
  await page.mouse.click(box.x + 60, box.y + 60);
  expect(await pixels()).toEqual([255, 255]);
  await page.evaluate(async () => {
    const e = window.luma.editor;
    await e.runScript(
      'document.selectedLayer.mask = document.selectedLayer.mask.paint(new PencilStroke({points:[{x:55,y:60}],size:4}), "hide");',
    );
    await e.openProject(new File([await e.saveProject()], "painted.luma"));
    e.document.selectedLayer = e.document.layers.at(0)!;
  });
  expect(await pixels()).toEqual([0, 255]);
  const result = await page.evaluate(() => {
    const l = window.luma.editor.document.selectedLayer!;
    return { kind: l.mask!.kind, strokes: l.mask!.strokes.length, x: l.x };
  });
  expect(result).toEqual({ kind: "paint", strokes: 3, x: 10 });
});

test("painted mask strokes and feather preserve alpha across export tiles", async ({
  page,
}) => {
  await page.goto("/");
  const max = await page.evaluate(async () => {
    const {
      editor: e,
      PaintLayer,
      PaintFill,
      LayerMask,
      BrushStroke,
      PencilStroke,
    } = window.luma;
    e.newDocument({ width: 2100, height: 90 });
    const layer = e.document.layers.add(new PaintLayer());
    layer.strokes.add(
      new PaintFill({
        bounds: { x: 0, y: 0, width: 2100, height: 90 },
        color: "#88bbdd",
      }),
    );
    layer.mask = new LayerMask({ base: 0.8, feather: 4.5, density: 0.75 })
      .paint(
        new BrushStroke({
          points: [
            { x: 950, y: 15 },
            { x: 2070, y: 70 },
          ],
          size: 44,
          hardness: 0.4,
          opacity: 0.8,
        }),
        "hide",
      )
      .paint(
        new PencilStroke({
          points: [
            { x: 1000, y: 40 },
            { x: 2080, y: 40 },
          ],
          size: 6,
          opacity: 0.6,
        }),
        "reveal",
      );
    const whole = await e.renderer.render(e.document.toJSON(), e.assetStore, {
      maxPixels: 2100 * 90,
      maxDimension: 2100,
    });
    const bitmap = await createImageBitmap(await e.exportPng());
    const output = document.createElement("canvas");
    output.width = 2100;
    output.height = 90;
    const ctx = output.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const expected = whole.getContext("2d")!.getImageData(0, 0, 2100, 90).data,
      actual = ctx.getImageData(0, 0, 2100, 90).data;
    let difference = 0;
    for (let i = 3; i < actual.length; i += 4)
      difference = Math.max(difference, Math.abs(actual[i] - expected[i]));
    whole.width = whole.height = output.width = output.height = 1;
    return difference;
  });
  expect(max).toBeLessThanOrEqual(1);
});

test("painted-mask prefixes and active stamps are reused without changing preview pixels", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const rendererPath = "/src/engine/renderer.ts",
      { CanvasRenderer } = await import(rendererPath);
    const {
      Document,
      LayerGroup,
      TextLayer,
      LayerMask,
      BrushStroke,
      MarqueeSelection,
      editor,
    } = window.luma;
    const renderer = new CanvasRenderer();
    const original = CanvasRenderingContext2D.prototype.fillText;
    let textDraws = 0;
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
      if (text === "Cached source") textDraws++;
      return original.call(this, text, ...args);
    };
    const differences: number[] = [],
      increments: number[] = [],
      replayCounts: number[] = [];
    try {
      for (const feather of [0, 9.5]) for (const clipped of [false, true]) for (const mode of ["hide", "reveal"] as const) {
        renderer.clearCache();
        const doc = new Document({ width: 600, height: 90 });
        const group = doc.layers.add(new LayerGroup());
        group.layers.add(
          new TextLayer({
            text: "Cached source",
            fontSize: 60,
            color: "#ff8855",
          }),
        );
        const clip = new MarqueeSelection({
          shape: "rectangle",
          x: 10,
          y: 5,
          width: 580,
          height: 70,
        });
        const finished = new BrushStroke({
          points: [
            { x: 100, y: 40 },
            { x: 500, y: 40 },
          ],
          size: 30,
          opacity: 0.3,
        });
        const live = new BrushStroke({
          points: [
            { x: 40, y: 30 },
            { x: 550, y: 35 },
          ],
          size: 38,
          opacity: 0.6,
          hardness: 0.35,
          ...(clipped ? { clip } : {}),
        });
        let base = new LayerMask({ base: mode === "hide" ? 1 : 0, feather })
          .paint(finished, mode)
          .paint(live, mode)
          .toJSON();
        if (base.kind !== "paint") throw Error("paint mask expected");
        const draw = async (cache = true) => {
          const c = await renderer.render(
            doc.getSnapshot().document,
            editor.assetStore,
            { cache },
          );
          const pixels = c.getContext("2d")!.getImageData(0, 0, 600, 90).data;
          c.width = c.height = 1;
          return pixels;
        };
        group.update({ mask: base });
        await draw();
        const before = renderer.maskDiagnostics,
          drawsBefore = textDraws;
        base = structuredClone(base);
        base.strokes
          .at(-1)!
          .stroke.points.push({ x: 570, y: 45, pressure: 0.7 });
        group.update({ mask: base });
        const actual = await draw();
        const after = renderer.maskDiagnostics;
        increments.push(after.appendedPoints - before.appendedPoints);
        replayCounts.push(after.prefixReplays - before.prefixReplays);
        if (textDraws !== drawsBefore)
          throw Error("Mask edit rerasterized unchanged source text");
        const expected = await draw(false);
        let max = 0;
        for (let i = 0; i < actual.length; i++)
          max = Math.max(max, Math.abs(actual[i] - expected[i]));
        differences.push(max);
        // Editing an earlier point must reset active coverage, rather than append over stale pixels.
        base = structuredClone(base);
        base.strokes.at(-1)!.stroke.points[0].y = 65;
        group.update({ mask: base });
        const changed = await draw(),
          reference = await draw(false);
        let changedMax = 0;
        for (let i = 0; i < changed.length; i++)
          changedMax = Math.max(
            changedMax,
            Math.abs(changed[i] - reference[i]),
          );
        differences.push(changedMax);
      }
      const retained = renderer.maskDiagnostics.activeBytes;
      renderer.clearCache();
      return {
        differences,
        increments,
        replayCounts,
        retained,
        cleared: renderer.maskDiagnostics.activeBytes,
      };
    } finally {
      CanvasRenderingContext2D.prototype.fillText = original;
      renderer.dispose();
    }
  });
  expect(result.differences).toEqual(Array(16).fill(0));
  expect(result.increments).toEqual(Array(8).fill(1));
  expect(result.replayCounts).toEqual(Array(8).fill(0));
  expect(result.retained).toBeGreaterThan(0);
  expect(result.retained).toBeLessThanOrEqual(16 * 1024 * 1024);
  expect(result.cleared).toBe(0);
});

test("transient mask previews match commits on groups, text and paint without changing snapshots", async ({
  page,
}) => {
  await page.goto("/");
  const differences = await page.evaluate(async () => {
    const path = "/src/engine/renderer.ts",
      { CanvasRenderer } = await import(path);
    const {
      Document,
      LayerGroup,
      PaintLayer,
      TextLayer,
      PaintFill,
      LayerMask,
      BrushStroke,
      editor,
    } = window.luma;
    const renderer = new CanvasRenderer(),
      differences: number[] = [];
    try {
      for (const kind of ["group", "text", "paint"] as const)
        for (const mode of ["hide", "reveal"] as const) {
          const doc = new Document({ width: 180, height: 100 });
          const parent = doc.layers.add(new LayerGroup({ x: 4, y: 3 }));
          const paint = parent.layers.add(new PaintLayer());
          paint.strokes.add(
            new PaintFill({
              bounds: { x: 0, y: 0, width: 170, height: 90 },
              color: "#ee8866",
            }),
          );
          const text = parent.layers.add(
            new TextLayer({ text: "Mask", fontSize: 50 }),
          );
          const target =
            kind === "group" ? parent : kind === "text" ? text : paint;
          target.mask = new LayerMask({
            base: mode === "hide" ? 1 : 0,
            feather: 4,
          });
          const stroke = new BrushStroke({
            points: [
              { x: 30, y: 30 },
              { x: 120, y: 60 },
            ],
            size: 45,
            opacity: 0.6,
          });
          const snapshot = doc.getSnapshot(),
            serialized = JSON.stringify(snapshot.document);
          const read = async (preview?: unknown) => {
            const c = await renderer.render(
              doc.getSnapshot().document,
              editor.assetStore,
              { paintPreview: preview },
            );
            const data = c.getContext("2d")!.getImageData(0, 0, 180, 100).data;
            c.width = c.height = 1;
            return data;
          };
          const original = await read();
          const preview = await read({
            layerId: target.id,
            stroke: stroke.toJSON(),
            maskMode: mode,
          });
          if (
            doc.getSnapshot() !== snapshot ||
            JSON.stringify(snapshot.document) !== serialized
          )
            throw Error("Preview mutated document");
          const cancelled = await read();
          let cancellation = 0;
          for (let i = 0; i < original.length; i++)
            cancellation = Math.max(
              cancellation,
              Math.abs(original[i] - cancelled[i]),
            );
          target.mask = target.mask!.paint(stroke, mode);
          const committed = await read();
          let max = 0;
          for (let i = 0; i < preview.length; i++)
            max = Math.max(max, Math.abs(preview[i] - committed[i]));
          differences.push(cancellation, max);
        }
      return differences;
    } finally {
      renderer.dispose();
    }
  });
  expect(differences).toEqual(Array(12).fill(0));
});

test("mask stroke budgets reject an uncommittable preview before drawing starts", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(() => {
    const { editor: e, PaintLayer, LayerMask, BrushStroke } = window.luma;
    e.newDocument({ width: 100, height: 100 });
    const layer = e.document.layers.add(new PaintLayer());
    const stroke = new BrushStroke({ points: [{ x: 1, y: 1 }] });
    layer.mask = new LayerMask({
      base: 1,
      strokes: Array.from({ length: 2048 }, () => ({
        stroke,
        mode: "hide" as const,
      })),
    });
    e.document.selectedLayer = layer;
    e.tools.configure({ paintTarget: "mask-hide" });
    const revision = e.document.getSnapshot().revision;
    let message = "";
    try {
      e.tools.begin(
        "brush",
        { x: 20, y: 20 },
        { alt: false, shift: false, pressure: 1 },
        1,
      );
    } catch (error) {
      message = (error as Error).message;
    }
    return {
      message,
      revisionUnchanged: revision === e.document.getSnapshot().revision,
      drawing: e.tools.getSnapshot().drawing,
      preview: e.tools.getSnapshot().paintPreview,
    };
  });
  expect(result).toEqual({
    message: "This mask has reached its 2,048-stroke limit.",
    revisionUnchanged: true,
    drawing: false,
    preview: null,
  });
});

test("brush refinements preserve selection and Bezier mask geometry through undo and reopen", async ({
  page,
}) => {
  await page.goto("/");
  for (const kind of ["selection", "vector"] as const) {
    await page.evaluate((kind) => {
      const {
        editor: e,
        PaintLayer,
        PaintFill,
        LayerMask,
        MarqueeSelection,
        VectorPath,
      } = window.luma;
      e.newDocument({ width: 200, height: 140 });
      const layer = e.document.layers.add(new PaintLayer());
      layer.strokes.add(
        new PaintFill({
          bounds: { x: 0, y: 0, width: 200, height: 140 },
          color: "#ee8844",
        }),
      );
      layer.mask =
        kind === "selection"
          ? new LayerMask({
              selection: new MarqueeSelection({
                shape: "rectangle",
                x: 20,
                y: 20,
                width: 80,
                height: 80,
              }),
            })
          : new LayerMask({
              paths: [
                new VectorPath({
                  closed: true,
                  points: [
                    { x: 20, y: 20 },
                    { x: 100, y: 20 },
                    { x: 100, y: 100 },
                    { x: 20, y: 100 },
                  ],
                }),
              ],
            });
      e.document.selectedLayer = layer;
    }, kind);
    await page.keyboard.press("Control+1");
    await page
      .getByRole("button", { name: "Brush tool (B)", exact: true })
      .click();
    const target = page.getByRole("combobox", {
      name: "Paint target",
      exact: true,
    });
    await target.selectOption("mask-hide");
    const box = (await page.locator(".canvas-wrap").boundingBox())!;
    await page.mouse.click(box.x + 60, box.y + 60);
    await target.selectOption("mask-reveal");
    await page.mouse.click(box.x + 140, box.y + 60);
    const pixels = () =>
      page.evaluate(async () => {
        const e = window.luma.editor,
          c = await e.renderer.render(e.document.toJSON(), e.assetStore);
        const context = c.getContext("2d")!,
          alpha = [60, 140].map(
            (x) => context.getImageData(x, 60, 1, 1).data[3],
          );
        c.width = c.height = 1;
        return alpha;
      });
    expect(await pixels()).toEqual([0, 255]);
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+z");
    expect(await pixels()).toEqual([255, 0]);
    await page.keyboard.press("Control+Shift+z");
    await page.keyboard.press("Control+Shift+z");
    await page.evaluate(async () => {
      const e = window.luma.editor;
      await e.openProject(
        new File([await e.saveProject()], "refined-mask.luma"),
      );
      e.document.selectedLayer = e.document.layers.at(0)!;
    });
    expect(await pixels()).toEqual([0, 255]);
    const preserved = await page.evaluate(() => {
      const mask = window.luma.editor.document.selectedLayer!.mask!;
      return {
        kind: mask.kind,
        strokes: mask.strokes.length,
        geometry:
          mask.kind === "vector"
            ? mask.paths[0].points.length
            : mask.selection.regions.length,
      };
    });
    expect(preserved).toEqual({
      kind,
      strokes: 2,
      geometry: kind === "vector" ? 4 : 1,
    });
  }
});

test("Pen mask target edits anchors and handles with keyboard, cancellation and retained refinements", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    const {
      editor: e,
      LayerGroup,
      PaintLayer,
      PaintFill,
      LayerMask,
      VectorPath,
      BrushStroke,
    } = window.luma;
    e.newDocument({ width: 260, height: 180 });
    const group = e.document.layers.add(new LayerGroup({ x: 20, y: 10 }));
    const layer = group.layers.add(new PaintLayer({ x: 5, y: 5 }));
    layer.strokes.add(
      new PaintFill({
        bounds: { x: 0, y: 0, width: 230, height: 160 },
        color: "#dd9955",
      }),
    );
    layer.mask = new LayerMask({
      paths: [
        new VectorPath({
          closed: true,
          points: [
            { x: 30, y: 40, in: { x: 15, y: 40 }, out: { x: 45, y: 40 } },
            { x: 130, y: 40 },
            { x: 130, y: 120 },
            { x: 30, y: 120 },
          ],
        }),
      ],
      x: 5,
      y: 5,
    }).paint(new BrushStroke({ points: [{ x: 90, y: 80 }], size: 10 }), "hide");
    e.document.selectedLayer = layer;
  });
  await page.keyboard.press("Control+1");
  await page
    .getByRole("button", { name: "Vector pen (P)", exact: true })
    .click();
  const target = page.getByRole("combobox", {
    name: "Pen target",
    exact: true,
  });
  await target.selectOption("mask");
  await expect(
    page.getByRole("spinbutton", { name: "Pen width value", exact: true }),
  ).toHaveCount(0);
  const box = (await page.locator(".canvas-wrap").boundingBox())!;
  const read = () =>
    page.evaluate(() => {
      const e = window.luma.editor,
        l = e.document.selectedLayer!,
        m = l.mask!;
      return {
        anchor: m.paths[0].points[0],
        count: m.paths[0].points.length,
        strokes: m.strokes.length,
        x: l.x,
        y: l.y,
        past: e.document.getSnapshot().past.length,
      };
    });
  const before = await read();
  const insert = page.getByRole("button", {
    name: "Insert midpoint",
    exact: true,
  });
  await expect(insert).toBeDisabled();
  await page.mouse.click(box.x + 60, box.y + 60);
  const controls = page.getByTestId("pen-controls");
  await expect(controls.locator("rect").first()).toHaveAttribute("fill", "#d5e79b");
  await expect(controls.locator("rect").nth(1)).toHaveAttribute("fill", "#202523");
  await insert.click();
  expect((await read()).count).toBe(5);
  expect((await read()).strokes).toBe(1);
  expect((await read()).past).toBe(before.past + 1);
  await page.keyboard.press("Control+z");
  expect(await read()).toEqual(before);
  await page.keyboard.press("Control+Shift+z");
  expect((await read()).count).toBe(5);
  await page.keyboard.press("Control+z");
  const drag = async (from: number[], to: number[]) => {
    await page.mouse.move(box.x + from[0], box.y + from[1]);
    await page.mouse.down();
    await page.mouse.move(box.x + to[0], box.y + to[1], { steps: 4 });
  };
  // Accumulated layer origin 25,15 plus mask offset 5,5.
  await drag([60, 60], [70, 65]);
  await expectPenControl(controls.locator("rect").first(), 70, 65);
  await expectPenControl(controls.locator("circle").nth(1), 85, 65);
  expect(await read()).toEqual(before);
  await page.mouse.up();
  expect(await read()).toEqual({
    ...before,
    anchor: { x: 40, y: 45, in: { x: 25, y: 45 }, out: { x: 55, y: 45 } },
    past: before.past + 1,
  });
  await page.keyboard.press("Control+z");
  expect(await read()).toEqual(before);
  await page.keyboard.press("Control+Shift+z");
  const moved = await read();
  await drag([85, 65], [95, 75]);
  await expectPenControl(controls.locator("circle").nth(1), 95, 75);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await read()).toEqual(moved);
  await drag([85, 65], [95, 75]);
  await expectPenControl(controls.locator("circle").nth(1), 95, 75);
  await page.mouse.up();
  expect((await read()).anchor).toEqual({
    x: 40,
    y: 45,
    out: { x: 65, y: 55 },
    in: { x: 15, y: 35 },
  });
  await page.keyboard.down("Alt");
  await drag([95, 75], [100, 80]);
  await page.mouse.up();
  await page.keyboard.up("Alt");
  expect((await read()).anchor).toEqual({
    x: 40,
    y: 45,
    out: { x: 70, y: 60 },
    in: { x: 15, y: 35 },
  });
  const independent = await read();
  await page.mouse.click(box.x + 100, box.y + 80);
  expect(await read()).toEqual(independent);
  await page.mouse.click(box.x + 70, box.y + 65);
  await page.keyboard.press("Shift+ArrowRight");
  expect((await read()).anchor.x).toBe(50);
  await page.keyboard.press("Delete");
  expect((await read()).count).toBe(3);
  await page.keyboard.press("Control+z");
  expect((await read()).count).toBe(4);
  await page
    .getByRole("checkbox", { name: "Link mask to layer", exact: true })
    .uncheck();
  await page.evaluate(() => {
    window.luma.editor.document.selectedLayer!.x += 10;
  });
  const unlinked = await read();
  await drag([80, 65], [85, 65]);
  await page.mouse.up();
  expect((await read()).anchor.x).toBe(unlinked.anchor.x + 5);
  expect((await read()).strokes).toBe(1);
  await page.evaluate(async () => {
    const e = window.luma.editor,
      id = e.document.selectedLayer!.id;
    await e.openProject(new File([await e.saveProject()], "edited-mask.luma"));
    e.document.selectedLayer = e.document.getLayer(id);
  });
  expect((await read()).anchor.x).toBe(unlinked.anchor.x + 5);
  await expect(target).toHaveValue("layer");
  await target.selectOption("mask");
  await page.evaluate(() => {
    window.luma.editor.document.layers.at(0)!.locked = true;
  });
  const locked = await read();
  await drag([85, 65], [95, 70]);
  await page.mouse.up();
  await page.keyboard.press("Delete");
  await page.keyboard.press("ArrowRight");
  expect(await read()).toEqual(locked);
});

test("draws new mask contours from an empty mask, with draft cancellation, holes and one-step undo", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    const { editor: e, PaintLayer, PaintFill } = window.luma;
    e.newDocument({ width: 200, height: 160 });
    const layer = e.document.layers.add(new PaintLayer());
    layer.strokes.add(
      new PaintFill({
        bounds: { x: 0, y: 0, width: 200, height: 160 },
        color: "#ee9955",
      }),
    );
    e.document.selectedLayer = layer;
  });
  await page
    .getByRole("button", { name: "Add Bézier mask", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Vector pen (P)", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Pen target", exact: true })
    .selectOption("mask");
  await page.keyboard.press("Control+1");
  const box = (await page.locator(".canvas-wrap").boundingBox())!;
  const click = async (x: number, y: number) =>
    page.mouse.click(box.x + x, box.y + y);
  const read = () =>
    page.evaluate(() => {
      const e = window.luma.editor;
      return {
        mask: e.document.selectedLayer!.mask!.toJSON(),
        past: e.document.getSnapshot().past.length,
      };
    });
  const pixels = () =>
    page.evaluate(async () => {
      const e = window.luma.editor,
        c = await e.renderer.render(e.document.toJSON(), e.assetStore, {
          cache: false,
        });
      const ctx = c.getContext("2d")!;
      const values = [
        ctx.getImageData(30, 60, 1, 1).data[3],
        ctx.getImageData(60, 60, 1, 1).data[3],
        ctx.getImageData(150, 60, 1, 1).data[3],
      ];
      c.width = c.height = 1;
      return values;
    });
  const before = await read();
  const start = page.getByRole("button", { name: "New contour", exact: true });
  await start.click();
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 30, box.y + 20, { steps: 3 });
  await page.mouse.up();
  await click(100, 20);
  await click(100, 100);
  expect(await read()).toEqual(before);
  await page.keyboard.press("Delete");
  await click(100, 100);
  await click(20, 100);
  await page.keyboard.press("Enter");
  const outer = await read();
  expect(outer.mask.kind).toBe("vector");
  if (outer.mask.kind !== "vector") throw Error("Expected vector mask");
  expect(outer.mask.paths).toHaveLength(1);
  expect(outer.mask.paths[0].points).toHaveLength(4);
  expect(outer.mask.paths[0].points[0].out).toEqual({ x: 30, y: 20 });
  expect(outer.past).toBe(before.past + 1);
  expect(await pixels()).toEqual([255, 255, 0]);
  await start.click();
  await click(40, 40);
  await click(80, 40);
  await page.keyboard.press("Escape");
  expect(await read()).toEqual(outer);
  await start.click();
  await click(40, 40);
  await click(80, 40);
  await click(80, 80);
  await click(40, 80);
  await click(40, 40);
  expect((await read()).past).toBe(outer.past + 1);
  expect(await pixels()).toEqual([255, 0, 0]);
  await page.keyboard.press("Control+z");
  expect(await read()).toEqual(outer);
  await page.keyboard.press("Control+Shift+z");
  expect(await pixels()).toEqual([255, 0, 0]);
  const saved = await read();
  await page.evaluate(async () => {
    const e = window.luma.editor,
      id = e.document.selectedLayer!.id;
    await e.openProject(new File([await e.saveProject()], "drawn-mask.luma"));
    e.document.selectedLayer = e.document.getLayer(id);
  });
  expect((await read()).mask).toEqual(saved.mask);
  expect(await pixels()).toEqual([255, 0, 0]);
  await page
    .getByRole("combobox", { name: "Pen target", exact: true })
    .selectOption("mask");
  await start.click();
  await click(130, 30);
  await page.evaluate(() => {
    window.luma.editor.document.selectedLayer!.opacity = 0.6;
  });
  await expect(start).toBeVisible();
  expect((await read()).mask).toEqual(saved.mask);
});

test("clicking near mask curves inserts with screen-space tolerance, cancel, undo and unlinked coordinates", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    const {
      editor: e,
      LayerGroup,
      PaintLayer,
      PaintFill,
      LayerMask,
      VectorPath,
      BrushStroke,
    } = window.luma;
    e.newDocument({ width: 220, height: 200 });
    const group = e.document.layers.add(new LayerGroup({ x: 20, y: 10 }));
    const layer = group.layers.add(new PaintLayer({ x: 5, y: 5 }));
    layer.strokes.add(
      new PaintFill({
        bounds: { x: 0, y: 0, width: 220, height: 200 },
        color: "#ffaa55",
      }),
    );
    layer.mask = new LayerMask({
      x: 5,
      y: 5,
      paths: [
        new VectorPath({
          closed: true,
          points: [
            { x: 20, y: 50, in: { x: 20, y: -30 }, out: { x: 20, y: 130 } },
            { x: 140, y: 50, in: { x: 140, y: 130 }, out: { x: 140, y: -30 } },
          ],
        }),
      ],
    }).paint(new BrushStroke({ points: [{ x: 80, y: 50 }], size: 10 }), "hide");
    e.document.selectedLayer = layer;
  });
  await page
    .getByRole("button", { name: "Vector pen (P)", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Pen target", exact: true })
    .selectOption("mask");
  await page.keyboard.press("Control+1");
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  const box = (await page.locator(".canvas-wrap").boundingBox())!,
    zoom = box.width / 220;
  const read = () =>
    page.evaluate(() => {
      const e = window.luma.editor;
      return {
        mask: e.document.selectedLayer!.mask!.toJSON(),
        past: e.document.getSnapshot().past.length,
      };
    });
  const original = await read();
  await page.mouse.click(box.x + 110 * zoom, box.y + 130 * zoom + 8);
  expect(await read()).toEqual(original);
  await page.mouse.move(box.x + 110 * zoom, box.y + 130 * zoom + 6);
  await page.mouse.down();
  expect(await read()).toEqual(original);
  await expect(
    page.locator('.drawing-overlay rect[stroke="#d5e79b"]'),
  ).toHaveCount(3);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await read()).toEqual(original);
  await page.mouse.click(box.x + 110 * zoom, box.y + 130 * zoom + 6);
  const inserted = await read();
  expect(inserted.past).toBe(original.past + 1);
  if (inserted.mask.kind !== "vector") throw Error("Expected vector mask");
  expect(inserted.mask.paths[0].points).toHaveLength(3);
  expect(inserted.mask.paths[0].points[1].x).toBeCloseTo(80, 2);
  expect(inserted.mask.paths[0].points[1].y).toBeCloseTo(110, 2);
  expect(inserted.mask.strokes).toEqual(original.mask.strokes);
  await page.keyboard.press("Control+z");
  expect(await read()).toEqual(original);
  await page.keyboard.press("Control+Shift+z");
  expect(await read()).toEqual(inserted);
  await page
    .getByRole("checkbox", { name: "Link mask to layer", exact: true })
    .uncheck();
  await page.evaluate(() => {
    window.luma.editor.document.selectedLayer!.x += 10;
  });
  await page.mouse.click(box.x + 110 * zoom, box.y + 10 * zoom);
  const closing = await read();
  if (closing.mask.kind !== "vector") throw Error("Expected vector mask");
  expect(closing.mask.paths[0].points).toHaveLength(4);
  expect(closing.mask.paths[0].points[3].x).toBeCloseTo(80, 2);
  expect(closing.mask.paths[0].points[3].y).toBeCloseTo(-10, 2);
  await page.evaluate(async () => {
    const e = window.luma.editor,
      id = e.document.selectedLayer!.id;
    await e.openProject(
      new File([await e.saveProject()], "inserted-mask.luma"),
    );
    e.document.selectedLayer = e.document.getLayer(id);
  });
  expect((await read()).mask).toEqual(closing.mask);
});
