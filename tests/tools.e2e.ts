import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function setup(page: Page) {
  await page.goto("/");
  await page.evaluate(() =>
    window.luma.editor.newDocument({ width: 400, height: 300 }),
  );
  await page
    .getByRole("button", { name: "Move tool (V)", exact: true })
    .click();
  await page.keyboard.press("Control+1");
}
async function drag(page: Page, from: [number, number], to: [number, number]) {
  const box = (await page.locator(".canvas-wrap").boundingBox())!;
  await page.mouse.move(box.x + from[0], box.y + from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + to[0], box.y + to[1], { steps: 8 });
  await page.mouse.up();
  await expect(
    page.getByRole("button", { name: "Brush tool (B)" }),
  ).toBeEnabled();
}
async function click(page: Page, x: number, y: number) {
  const box = (await page.locator(".canvas-wrap").boundingBox())!;
  await page.mouse.click(box.x + x, box.y + y);
  await expect(
    page.getByRole("button", { name: "Brush tool (B)" }),
  ).toBeEnabled();
}
async function pixels(page: Page, points: number[][]) {
  return page.evaluate(async (points) => {
    const { editor } = window.luma;
    const bitmap = await createImageBitmap(await editor.exportPng());
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const c = canvas.getContext("2d")!;
    const result = points.map(([x, y]) => {
      c.clearRect(0, 0, 1, 1);
      c.drawImage(bitmap, x, y, 1, 1, 0, 0, 1, 1);
      return [...c.getImageData(0, 0, 1, 1).data];
    });
    bitmap.close();
    return result;
  }, points);
}
test("brush and pencil gestures, clipping, shortcuts, undo, and reopen", async ({
  page,
}) => {
  await setup(page);
  await page.keyboard.press("b");
  await expect(
    page.getByRole("button", { name: "Brush tool (B)" }),
  ).toHaveAttribute("aria-pressed", "true");
  await drag(page, [40, 50], [130, 50]);
  expect(
    await pixels(page, [
      [70, 50],
      [70, 80],
    ]),
  ).toEqual([
    [213, 231, 155, 255],
    [0, 0, 0, 0],
  ]);
  expect(
    await page.evaluate(
      () => window.luma.editor.document.getSnapshot().past.length,
    ),
  ).toBe(1);
  await page.keyboard.press("Control+z");
  await expect(page.locator(".layer-row")).toHaveCount(0);
  await page.keyboard.press("Control+Shift+z");
  await page.keyboard.press("n");
  await drag(page, [40.5, 100.5], [130.5, 100.5]);
  expect(
    await pixels(page, [
      [70, 100],
      [70, 101],
      [70, 99],
    ]),
  ).toEqual([
    [213, 231, 155, 255],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ]);
  await page.keyboard.press("m");
  await drag(page, [200, 120], [240, 180]);
  await page.keyboard.press("b");
  await drag(page, [180, 150], [280, 150]);
  expect(
    await pixels(page, [
      [190, 150],
      [220, 150],
      [250, 150],
    ]),
  ).toEqual([
    [0, 0, 0, 0],
    [213, 231, 155, 255],
    [0, 0, 0, 0],
  ]);
  await page.keyboard.press("Control+d");
  expect(
    await page.evaluate(() => window.luma.editor.document.selection),
  ).toBeNull();
  const before = await pixels(page, [
    [70, 50],
    [70, 100],
    [220, 150],
  ]);
  await page.evaluate(async () => {
    const e = window.luma.editor,
      blob = await e.saveProject();
    e.newDocument();
    await e.openProject(new File([blob], "drawing.luma"));
  });
  expect(
    await pixels(page, [
      [70, 50],
      [70, 100],
      [220, 150],
    ]),
  ).toEqual(before);
});

test("pen creates and edits Bézier paths, closed fills, anchors and handles", async ({
  page,
}) => {
  await setup(page);
  await page.keyboard.press("p");
  await page.getByLabel("Fill new paths").check();
  await click(page, 60, 60);
  await drag(page, [200, 60], [230, 90]);
  await click(page, 200, 220);
  await click(page, 60, 220);
  await click(page, 60, 60);
  await expect(page.getByLabel("Closed path")).toBeChecked();
  expect((await pixels(page, [[100, 130]]))[0]).toEqual([213, 231, 155, 255]);
  const data = () =>
    page.evaluate(() => {
      const l = window.luma.editor.document.selectedLayer;
      return l instanceof window.luma.VectorLayer
        ? l.paths.at(0)!.toJSON()
        : null;
    });
  expect((await data())!.points[1].out).toEqual({ x: 230, y: 90 });
  await drag(page, [60, 60], [80, 70]);
  expect((await data())!.points[0].x).toBe(80);
  await page.keyboard.down("Alt");
  await drag(page, [230, 90], [245, 95]);
  await page.keyboard.up("Alt");
  expect((await data())!.points[1].out).toEqual({ x: 245, y: 95 });
  expect((await data())!.points[1].in).toEqual({ x: 170, y: 30 });
  await page.keyboard.press("Control+z");
  expect((await data())!.points[1].out).toEqual({ x: 230, y: 90 });
  // Create a second closed path, then pick an anchor of the first one. Its
  // inspector must edit that first path rather than always the last path.
  await click(page, 280, 100);
  await click(page, 330, 100);
  await click(page, 320, 160);
  await click(page, 280, 100);
  await click(page, 80, 70);
  await page
    .getByRole("spinbutton", { name: "Path stroke width value", exact: true })
    .fill("7");
  await page
    .getByRole("spinbutton", { name: "Path stroke width value", exact: true })
    .press("Enter");
  expect((await data())!.strokeWidth).toBe(7);
  await page.screenshot({ path: "test-results/luma-vector-tools.png" });
});

test("clone samples visible composition, clips, retains snapshots and reopens", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    const { editor, PaintLayer, PaintFill, MarqueeSelection } = window.luma;
    const source = editor.document.layers.add(
      new PaintLayer({ name: "Source" }),
    );
    source.strokes.add(
      new PaintFill({
        bounds: { x: 20, y: 20, width: 80, height: 80 },
        color: "#ff0000",
      }),
    );
    editor.document.selectedLayer = null;
    editor.document.selection = new MarqueeSelection({
      shape: "rectangle",
      x: 180,
      y: 130,
      width: 20,
      height: 40,
    });
    editor.tools.configure({ size: 40, hardness: 1 });
  });
  await page.keyboard.press("s");
  await page.keyboard.down("Alt");
  await click(page, 50, 50);
  await page.keyboard.up("Alt");
  await drag(page, [190, 150], [220, 150]);
  expect(
    await pixels(page, [
      [190, 150],
      [210, 150],
      [50, 50],
    ]),
  ).toEqual([
    [255, 0, 0, 255],
    [0, 0, 0, 0],
    [255, 0, 0, 255],
  ]);
  await page.keyboard.press("Control+z");
  expect((await pixels(page, [[190, 150]]))[0][3]).toBe(0);
  await page.keyboard.press("Control+Shift+z");
  await page.evaluate(async () => {
    const { editor } = window.luma;
    editor.document.layers.at(0)!.visible = false;
    const blob = await editor.saveProject();
    editor.newDocument();
    await editor.openProject(new File([blob], "clone.luma"));
  });
  expect(
    await pixels(page, [
      [190, 150],
      [50, 50],
    ]),
  ).toEqual([
    [255, 0, 0, 255],
    [0, 0, 0, 0],
  ]);
});

test("cancelled clone capture releases staged assets and commits no history", async ({
  page,
}) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    const { editor } = window.luma,
      assets = editor.assetStore,
      add = assets.add.bind(assets);
    const before = JSON.stringify(editor.document.toJSON()),
      history = editor.document.getSnapshot().past.length;
    let unblock!: () => void, sampled!: () => void;
    const gate = new Promise<void>((resolve) => {
        unblock = resolve;
      }),
      started = new Promise<void>((resolve) => {
        sampled = resolve;
      });
    assets.add = async (...args) => {
      const asset = await add(...args);
      sampled();
      await gate;
      return asset;
    };
    const modifiers = { alt: false, shift: false, pressure: 1 };
    editor.tools.begin(
      "clone",
      { x: 40, y: 40 },
      { ...modifiers, alt: true },
      1,
    );
    editor.tools.begin("clone", { x: 150, y: 150 }, modifiers, 1);
    const pending = editor.tools.end().then(
      () => "unexpected success",
      (error) => (error as Error).message,
    );
    await started;
    editor.tools.cancel();
    unblock();
    const error = await pending;
    assets.add = add;
    return {
      error,
      assets: assets.values().length,
      unchanged: before === JSON.stringify(editor.document.toJSON()),
      history: editor.document.getSnapshot().past.length - history,
    };
  });
  expect(result.error).toContain("changed");
  expect(result.assets).toBe(0);
  expect(result.unchanged).toBe(true);
  expect(result.history).toBe(0);
});

test("layer rows reorder and enter groups preserving position; canvas moves a group", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    const { editor, LayerGroup, PaintLayer, PaintFill } = window.luma;
    for (const name of ["Back", "Front"]) {
      const l = editor.document.layers.add(
        new PaintLayer({ name, x: 30, y: 30 }),
      );
      l.strokes.add(
        new PaintFill({ bounds: { x: 0, y: 0, width: 70, height: 70 } }),
      );
    }
    editor.document.layers.add(
      new LayerGroup({ name: "Container", x: 50, y: 40 }),
    );
  });
  const row = (name: string) =>
    page.locator(".layer-row").filter({
      has: page.getByRole("button", { name: `Select ${name}`, exact: true }),
    });
  await row("Back").dragTo(row("Front"), { targetPosition: { x: 100, y: 5 } });
  expect(
    await page.evaluate(() =>
      [...window.luma.editor.document.layers].map((l) => l.name),
    ),
  ).toEqual(["Front", "Back", "Container"]);
  await row("Back").dragTo(row("Container"));
  expect(
    await page.evaluate(() => {
      const g = [...window.luma.editor.document.layers].find(
        (l) => l.name === "Container",
      );
      return g instanceof window.luma.LayerGroup
        ? [g.layers.at(0)!.x, g.layers.at(0)!.y]
        : null;
    }),
  ).toEqual([-20, -10]);
  await page
    .getByRole("button", { name: "Select Container", exact: true })
    .click();
  await drag(page, [50, 50], [80, 70]);
  expect(
    await page.evaluate(() => [
      window.luma.editor.document.selectedLayer!.x,
      window.luma.editor.document.selectedLayer!.y,
    ]),
  ).toEqual([80, 60]);
  await page.keyboard.press("Control+z");
  expect(
    await page.evaluate(() => window.luma.editor.document.selectedLayer!.x),
  ).toBe(50);
});

test("Blend If inspector changes exported alpha, supports feathering and undo", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    const { editor, PaintLayer, PaintFill } = window.luma;
    const l = editor.document.layers.add(new PaintLayer());
    l.strokes.add(
      new PaintFill({
        bounds: { x: 0, y: 0, width: 400, height: 300 },
        color: "#646464",
      }),
    );
    editor.document.selectedLayer = l;
  });
  await page.getByLabel("Enable Blend If").check();
  const cutoff = page.getByLabel("This layer Shadow cutoff value", {
    exact: true,
  });
  await cutoff.fill("120");
  await cutoff.press("Enter");
  expect((await pixels(page, [[100, 100]]))[0][3]).toBe(0);
  await page
    .getByRole("button", { name: "Move tool (V)", exact: true })
    .click();
  await page.keyboard.press("Control+z");
  expect((await pixels(page, [[100, 100]]))[0][3]).toBe(255);
  const feather = page.getByLabel("This layer Shadow feather value", {
    exact: true,
  });
  await feather.fill("200");
  await feather.press("Enter");
  const alpha = (await pixels(page, [[100, 100]]))[0][3];
  expect(alpha).toBeGreaterThanOrEqual(127);
  expect(alpha).toBeLessThanOrEqual(128);
  await page.getByLabel("Blend If channel").selectOption("red");
  await page.screenshot({ path: "test-results/luma-layer-styles.png" });
});

test("selection boolean masks, styles and shadows match tiled full-resolution export", async ({
  page,
}) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    const {
      editor,
      Document,
      PaintLayer,
      PaintFill,
      MarqueeSelection,
      VectorLayer,
      VectorPath,
      LayerStyle,
      BlendIf,
    } = window.luma;
    // 2100px width crosses horizontal export tiles; 600px height crosses row strips.
    const doc = new Document({ width: 2100, height: 600 });
    const selection = new MarqueeSelection({
      shape: "ellipse",
      x: 1950,
      y: 180,
      width: 140,
      height: 200,
    })
      .combine(
        new MarqueeSelection({
          shape: "rectangle",
          x: 2000,
          y: 180,
          width: 30,
          height: 200,
        }),
        "subtract",
      )
      .combine(
        new MarqueeSelection({
          shape: "rectangle",
          x: 1900,
          y: 240,
          width: 200,
          height: 140,
        }),
        "intersect",
      );
    const p = doc.layers.add(new PaintLayer());
    p.strokes.add(
      new PaintFill({
        bounds: { x: 1900, y: 180, width: 200, height: 200 },
        clip: selection,
        color: "#ff0000",
      }),
    );
    const v = doc.layers.add(new VectorLayer());
    v.paths.add(
      new VectorPath({
        points: [
          { x: 2035, y: 450 },
          { x: 2070, y: 450 },
          { x: 2070, y: 500 },
          { x: 2035, y: 500 },
        ],
        closed: true,
        fill: "#0000ff",
        stroke: null,
      }),
    );
    v.styles = new LayerStyle({
      colorOverlay: { enabled: true, color: "#00ff00" },
      dropShadow: {
        enabled: true,
        color: "#ff0000",
        opacity: 1,
        x: -8,
        y: 10,
        blur: 8,
      },
      blendIf: new BlendIf({ enabled: true }),
    });
    const whole = await editor.renderer.render(doc.toJSON(), editor.assetStore);
    // Export via public integration after portable project load.
    await editor.openProject(
      new File(
        [
          JSON.stringify({
            format: "luma",
            version: 1,
            document: doc.toJSON(),
            assets: [],
          }),
        ],
        "styles.luma",
      ),
    );
    const bitmap = await createImageBitmap(await editor.exportPng());
    const out = document.createElement("canvas");
    out.width = 2100;
    out.height = 600;
    const c = out.getContext("2d")!;
    c.drawImage(bitmap, 0, 0);
    bitmap.close();
    const a = whole.getContext("2d")!.getImageData(0, 0, 2100, 600).data,
      b = c.getImageData(0, 0, 2100, 600).data;
    let maxDiff = 0;
    const differences: unknown[] = [];
    for (let i = 0; i < a.length; i++) {
      if (i % 4 !== 3 && a[i - (i % 4) + 3] < 10 && b[i - (i % 4) + 3] < 10)
        continue;
      if (Math.abs(a[i] - b[i]) > maxDiff) {
        maxDiff = Math.abs(a[i] - b[i]);
        differences.push({
          x: Math.floor(i / 4) % 2100,
          y: Math.floor(i / 4 / 2100),
          channel: i % 4,
          a: a[i],
          b: b[i],
        });
      }
    }
    const sample = (x: number, y: number) => [
      ...c.getImageData(x, y, 1, 1).data,
    ];
    return {
      maxDiff,
      differences,
      samples: [
        sample(1990, 290),
        sample(2010, 290),
        sample(2040, 290),
        sample(1990, 210),
        sample(2050, 470),
        sample(2025, 480),
      ],
    };
  });
  expect(result.maxDiff, JSON.stringify(result)).toBeLessThanOrEqual(2);
  expect(result.samples.slice(0, 5)).toEqual([
    [255, 0, 0, 255],
    [0, 0, 0, 0],
    [255, 0, 0, 255],
    [0, 0, 0, 0],
    [0, 255, 0, 255],
  ]);
  expect(result.samples[5][0]).toBe(255);
  expect(result.samples[5][3]).toBeGreaterThan(0);
});

test("fill tool fills canvas or marquee selection, supports shortcuts and undo/redo", async ({
  page,
}) => {
  await setup(page);
  await page.keyboard.press("g");
  await expect(
    page.getByRole("button", { name: "Paint bucket (G)" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".tool-hint")).toHaveText(
    "Click to fill canvas or active selection",
  );

  await click(page, 50, 50);
  expect(
    await pixels(page, [
      [10, 10],
      [100, 100],
      [200, 150],
      [350, 250],
    ]),
  ).toEqual([
    [213, 231, 155, 255],
    [213, 231, 155, 255],
    [213, 231, 155, 255],
    [213, 231, 155, 255],
  ]);
  expect(
    await page.evaluate(
      () => window.luma.editor.document.getSnapshot().past.length,
    ),
  ).toBe(1);

  await page.keyboard.press("Control+z");
  expect(
    await pixels(page, [
      [10, 10],
      [100, 100],
    ]),
  ).toEqual([
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ]);

  await page.keyboard.press("Control+Shift+z");
  expect(
    await pixels(page, [
      [10, 10],
      [100, 100],
    ]),
  ).toEqual([
    [213, 231, 155, 255],
    [213, 231, 155, 255],
  ]);

  await page.keyboard.press("m");
  await drag(page, [50, 50], [150, 150]);

  await page.keyboard.press("g");
  await page.evaluate(() => {
    window.luma.editor.tools.configure({ color: "#ff0000" });
  });
  await click(page, 60, 60);

  expect(
    await pixels(page, [
      [100, 100],
      [20, 20],
      [250, 200],
    ]),
  ).toEqual([
    [255, 0, 0, 255],
    [213, 231, 155, 255],
    [213, 231, 155, 255],
  ]);
});

test("developer docs link, anchors and documented scripts work in the actual sandbox", async ({
  page,
  context,
}) => {
  await setup(page);
  const opened = context.waitForEvent("page");
  await page.getByRole("link", { name: "Developer docs", exact: true }).click();
  const guide = await opened;
  await expect(
    guide.getByRole("heading", { name: "Scripting API", exact: true }),
  ).toBeVisible();
  await guide
    .getByRole("link", { name: "PaintLayer and strokes", exact: true })
    .click();
  expect(
    await guide.evaluate(() => !!document.querySelector(location.hash)),
  ).toBe(true);
  await guide.close();
  const markdown = await readFile("docs/SCRIPTING_API.md", "utf8");
  const examples = [
    ...markdown.matchAll(/<!-- example: ([\w-]+) -->\s*```js\n([\s\S]*?)```/g),
  ];
  expect(examples.length).toBeGreaterThanOrEqual(8);
  for (const [, name, code] of examples) {
    const result = await page.evaluate(async (code) => {
      const e = window.luma.editor;
      await e.openSample();
      try {
        const logs = await e.runScript(code);
        return { logs };
      } catch (error) {
        return { error: (error as Error).message };
      }
    }, code);
    expect(result.error, name).toBeUndefined();
  }
});

test("dense Pen hit testing avoids point copies and preserves preview, cancellation and undo", async ({page}) => {
  await page.goto("/");
  await page.getByRole("button",{name:"Move tool (V)",exact:true}).click();
  await page.evaluate(()=>{
    const {editor,VectorLayer,VectorPath}=window.luma;
    editor.newDocument({width:800,height:600});
    const layer=editor.document.layers.add(new VectorLayer());
    layer.paths.add(new VectorPath({points:Array.from({length:8000},(_,i)=>({x:20+i%20*30,y:20+Math.floor(i/20)*30}))}));
    editor.document.selectedLayer=layer;
    const descriptor=Object.getOwnPropertyDescriptor(VectorPath.prototype,"points")!;
    (window as any).pointReads=0;
    Object.defineProperty(VectorPath.prototype,"points",{...descriptor,get(){(window as any).pointReads++;return descriptor.get!.call(this);}});
  });
  await page.getByRole("button",{name:"Vector pen (P)",exact:true}).click();
  await page.keyboard.press("Control+1");
  await expect(page.getByText("8000 anchors",{exact:false})).toBeVisible();
  const box=(await page.locator(".canvas-wrap").boundingBox())!;
  await page.mouse.move(box.x+590,box.y+290);
  await page.mouse.down();
  await page.mouse.move(box.x+580,box.y+280);
  expect(await page.evaluate(()=>{
    const layer=window.luma.editor.document.getSnapshot().document.children[0];
    return layer.kind==="vector" ? layer.paths[0].points[199].x : null;
  })).toBe(590);
  await page.mouse.up();
  await expect.poll(()=>page.evaluate(()=>{
    const layer=window.luma.editor.document.selectedLayer!.toJSON();
    return layer.kind==="vector" ? layer.paths[0].points[199].x : null;
  })).toBe(580);
  expect(await page.evaluate(()=>(window as any).pointReads)).toBe(0);
  await page.keyboard.press("Control+z");
  await expect(page.getByText("8000 anchors",{exact:false})).toBeVisible();
  const beforeCancel=await page.evaluate(()=>JSON.stringify(window.luma.editor.document.toJSON()));
  await page.mouse.move(box.x+590,box.y+290);
  await page.mouse.down();
  await page.mouse.move(box.x+570,box.y+270);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await page.evaluate(()=>JSON.stringify(window.luma.editor.document.toJSON()))).toBe(beforeCancel);
});
