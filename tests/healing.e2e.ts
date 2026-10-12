import { expect, test } from "@playwright/test";

test("healing gesture repairs a blemish on a separate layer and cancels in-flight work", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const editor = window.luma.editor;
    editor.newDocument({ width: 160, height: 100 });
    const canvas = new OffscreenCanvas(160, 100),
      context = canvas.getContext("2d")!;
    context.fillStyle = "#646464";
    context.fillRect(0, 0, 160, 100);
    context.fillStyle = "#ff0000";
    context.fillRect(44, 39, 3, 3);
    await editor.importImage(
      new File([await canvas.convertToBlob()], "blemish.png", {
        type: "image/png",
      }),
    );
  });
  await page
    .getByRole("button", { name: "Move tool (V)", exact: true })
    .click();
  await page.keyboard.press("Control+1");
  await page.keyboard.press("Shift+J");
  await expect(
    page.getByRole("button", { name: "Spot Healing (Shift+J)", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Foreground color")).toHaveCount(0);
  await page.evaluate(() =>
    window.luma.editor.tools.configure({
      size: 12,
      hardness: 1,
      opacity: 1,
      flow: 1,
      pressureSize: false,
      pressureOpacity: false,
      smoothing: 0,
    }),
  );
  const before = await page.evaluate(() =>
    JSON.stringify(window.luma.editor.document.toJSON()),
  );
  const history = await page.evaluate(
    () => window.luma.editor.document.getSnapshot().past.length,
  );
  const box = (await page.locator(".canvas-wrap").boundingBox())!;
  const drag = async () => {
    await page.mouse.move(box.x + 40, box.y + 40);
    await page.mouse.down();
    await page.mouse.move(box.x + 50, box.y + 40, { steps: 6 });
  };
  await drag();
  await expect(page.getByTestId("healing-stroke-preview")).toBeVisible();
  expect(
    await page.evaluate(() => window.luma.editor.document.layers.length),
  ).toBe(1);
  await page.mouse.up();
  await expect
    .poll(() => page.evaluate(() => window.luma.editor.document.layers.length))
    .toBe(2);
  const result = await page.evaluate(async () => {
    const editor = window.luma.editor;
    const surface = await editor.renderer.render(
      editor.document.toJSON(),
      editor.assetStore,
      { cache: false, readback: true },
    );
    const healed = [
      ...surface.getContext("2d")!.getImageData(45, 40, 1, 1).data,
    ];
    surface.width = surface.height = 0;
    const original = new OffscreenCanvas(1, 1),
      c = original.getContext("2d")!;
    c.drawImage(editor.assetStore.values()[0].bitmap, -45, -40);
    return {
      healed,
      original: [...c.getImageData(0, 0, 1, 1).data],
      history: editor.document.getSnapshot().past.length,
    };
  });
  expect(result).toEqual({
    healed: [100, 100, 100, 255],
    original: [255, 0, 0, 255],
    history: history + 1,
  });
  await page.keyboard.press("Control+z");
  expect(
    await page.evaluate(() =>
      JSON.stringify(window.luma.editor.document.toJSON()),
    ),
  ).toBe(before);
  // Hold native sampling after pointer-up so Escape exercises an active async operation.
  await page.evaluate(() => {
    const editor = window.luma.editor,
      render = editor.renderer.render.bind(editor.renderer);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    (window as any).releaseHeal = () => {
      editor.renderer.render = render;
      release();
    };
    (window as any).healSampling = false;
    editor.renderer.render = async (...args: Parameters<typeof render>) => {
      if (args[2]?.readback && args[2]?.region) {
        (window as any).healSampling = true;
        await gate;
      }
      return render(...args);
    };
  });
  const assets = await page.evaluate(
    () => window.luma.editor.assetStore.values().length,
  );
  await drag();
  await page.mouse.up();
  await expect
    .poll(() => page.evaluate(() => (window as any).healSampling))
    .toBe(true);
  await page.keyboard.press("Escape");
  await page.evaluate(() => (window as any).releaseHeal());
  await expect
    .poll(() =>
      page.evaluate(() => window.luma.editor.tools.getSnapshot().drawing),
    )
    .toBe(false);
  await expect(
    page.getByRole("button", { name: "Spot Healing (Shift+J)", exact: true }),
  ).toBeEnabled();
  expect(
    await page.evaluate(() =>
      JSON.stringify(window.luma.editor.document.toJSON()),
    ),
  ).toBe(before);
  expect(
    await page.evaluate(() => window.luma.editor.assetStore.values().length),
  ).toBe(assets);
});

test("healing brush coverage respects clipping, pressure and soft edges", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { renderRetouchCoverage } = await import(
      /* @vite-ignore */ String("/src/engine/retouch.ts")
    );
    const { PixelProcessor } = await import(
      /* @vite-ignore */ String("/src/engine/processor.ts")
    );
    const processor = new PixelProcessor();
    try {
      const brush = new window.luma.BrushStroke({
        points: [
          { x: 8, y: 8, pressure: 0.25 },
          { x: 24, y: 8, pressure: 1 },
        ],
        size: 12,
        hardness: 0.5,
        pressureSize: true,
        pressureOpacity: true,
        clip: new window.luma.MarqueeSelection({
          shape: "rectangle",
          x: 0,
          y: 0,
          width: 26,
          height: 16,
        }),
      });
      const coverage = await renderRetouchCoverage(
        brush.toJSON(),
        { x: 0, y: 0, width: 32, height: 16, sx: 1, sy: 1 },
        processor,
      );
      return {
        small: coverage[8 * 32 + 8],
        large: coverage[8 * 32 + 24],
        clipped: coverage[8 * 32 + 28],
        soft: coverage.some((value: number) => value > 0 && value < 255),
      };
    } finally {
      processor.dispose();
    }
  });
  expect(result.small).toBeLessThan(result.large);
  expect(result.large).toBeGreaterThan(200);
  expect(result.clipped).toBe(0);
  expect(result.soft).toBe(true);
});

test("aborting donor search terminates its dedicated worker and a subsequent repair succeeds", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const editor = window.luma.editor;
    editor.newDocument({ width: 32, height: 32 });
    const canvas = new OffscreenCanvas(32, 32),
      c = canvas.getContext("2d")!;
    c.fillStyle = "#646464";
    c.fillRect(0, 0, 32, 32);
    c.fillStyle = "#ff0000";
    c.fillRect(15, 15, 2, 2);
    await editor.importImage(
      new File([await canvas.convertToBlob()], "source.png", {
        type: "image/png",
      }),
    );
    const before = JSON.stringify(editor.document.toJSON()),
      assets = editor.assetStore.values().length;
    const NativeWorker = window.Worker,
      controller = new AbortController();
    let dispatched = false,
      terminated = 0,
      error = "";
    window.Worker = class extends NativeWorker {
      postMessage(
        message: any,
        transfer: Transferable[] | StructuredSerializeOptions = [],
      ) {
        if (Array.isArray(transfer)) super.postMessage(message, transfer);
        else super.postMessage(message, transfer);
        if (message.donorSearch) {
          dispatched = true;
          controller.abort();
        }
      }
      terminate() {
        terminated++;
        super.terminate();
      }
    } as typeof Worker;
    const brush = new window.luma.BrushStroke({
      points: [{ x: 16, y: 16, pressure: 1 }],
      size: 8,
      hardness: 1,
      pressureSize: false,
      pressureOpacity: false,
    });
    try {
      await editor.healStroke(
        brush,
        undefined,
        undefined,
        12,
        controller.signal,
      );
    } catch (failure) {
      error = String(failure);
    } finally {
      window.Worker = NativeWorker;
    }
    const unchanged =
      before === JSON.stringify(editor.document.toJSON()) &&
      assets === editor.assetStore.values().length;
    await editor.healStroke(brush, undefined, undefined, 12);
    return {
      dispatched,
      terminated,
      error,
      unchanged,
      layers: editor.document.layers.length,
    };
  });
  expect(result.dispatched).toBe(true);
  expect(result.terminated).toBe(1);
  expect(result.error).toContain("closed");
  expect(result.unchanged).toBe(true);
  expect(result.layers).toBe(2);
});

test("healing reuses captured pixels and falls back for off-canvas solver halos", async ({
  page,
}) => {
  await page.goto("/");
  const results = await page.evaluate(async () => {
    const { prepareHealingStroke } = await import(
      /* @vite-ignore */ String("/src/engine/healing.ts")
    );
    const { solveRetouchRegion } = await import(
      /* @vite-ignore */ String("/src/engine/patch.ts")
    );
    const { PixelProcessor } = await import(
      /* @vite-ignore */ String("/src/engine/processor.ts")
    );
    const editor = window.luma.editor;
    editor.newDocument({ width: 32, height: 32 });
    const canvas = new OffscreenCanvas(40, 32),
      c = canvas.getContext("2d")!;
    c.fillStyle = "#646464";
    c.fillRect(0, 0, 40, 32);
    c.fillStyle = "#787878";
    c.fillRect(0, 0, 4, 32);
    const asset = await editor.assetStore.add(
      await canvas.convertToBlob(),
      "extends beyond canvas",
    );
    editor.document.layers.add(
      new window.luma.RasterLayer({
        assetId: asset.id,
        x: -4,
        y: 0,
        width: 40,
        height: 32,
      }),
    );
    const processor = new PixelProcessor(),
      render = editor.renderer.render.bind(editor.renderer),
      search = processor.findDonor.bind(processor);
    let offset = { x: 0, y: 0 },
      renders = 0;
    processor.findDonor = async (...args: Parameters<typeof search>) => {
      const result = await search(...args);
      offset = result;
      return result;
    };
    editor.renderer.render = async (...args: Parameters<typeof render>) => {
      if (args[2]?.readback && args[2]?.region) renders++;
      return render(...args);
    };
    try {
      const results = [];
      for (const x of [16, 1]) {
        renders = 0;
        const brush = new window.luma.BrushStroke({
          points: [{ x, y: 16, pressure: 1 }],
          size: 6,
          hardness: 1,
          pressureSize: false,
          pressureOpacity: false,
        });
        const snapshot = editor.document.toJSON();
        const reused = await prepareHealingStroke(
          snapshot,
          editor.assetStore,
          editor.renderer,
          processor,
          brush.toJSON(),
          { mode: "all-layers" },
          {},
          10,
        );
        const preparationRenders = renders;
        const reference = await solveRetouchRegion(
          snapshot,
          editor.assetStore,
          editor.renderer,
          processor,
          reused.bounds,
          reused.coverage,
          offset,
          {},
        );
        results.push({
          x,
          preparationRenders,
          equal: reused.pixels.every(
            (value: number, index: number) => value === reference.pixels[index],
          ),
          equalCorrections: reused.correctedPixels.every(
            (value: number, index: number) =>
              value === reference.correctedPixels[index],
          ),
        });
      }
      return results;
    } finally {
      processor.dispose();
      editor.renderer.render = render;
    }
  });
  expect(results[0]).toMatchObject({
    preparationRenders: 1,
    equal: true,
    equalCorrections: true,
  });
  expect(results[1].preparationRenders).toBeGreaterThan(1);
  expect(results[1]).toMatchObject({ equal: true, equalCorrections: true });
});

test('successful healing reuses one idle worker; cancellation discards it and disposal releases its replacement',async({page})=>{
 await page.goto('/');
 const result=await page.evaluate(async()=>{
  const {editor:e,BrushStroke}=window.luma;
  e.newDocument({width:32,height:32});
  const c=new OffscreenCanvas(32,32),ctx=c.getContext('2d')!;
  ctx.fillStyle='#646464';ctx.fillRect(0,0,32,32);
  await e.importImage(new File([await c.convertToBlob()],'source.png',{type:'image/png'}));
  const brush=new BrushStroke({points:[{x:16,y:16}],size:8,hardness:1,pressureSize:false,pressureOpacity:false});
  await e.healStroke(brush,undefined,undefined,12);
  const worker=(e as any).idleRetouchProcessor;
  await e.healStroke(brush,undefined,undefined,12);
  const reused=worker===(e as any).idleRetouchProcessor;
  const before=JSON.stringify(e.document.toJSON()),controller=new AbortController();
  const find=worker.findDonor.bind(worker);
  worker.findDonor=(...args:unknown[])=>{const pending=find(...args);controller.abort();return pending;};
  let rejected=false;
  try{await e.healStroke(brush,undefined,undefined,12,controller.signal);}catch{rejected=true;}
  const unchanged=JSON.stringify(e.document.toJSON())===before;
  const discarded=(e as any).idleRetouchProcessor===null&&worker.disposed;
  await e.healStroke(brush,undefined,undefined,12);
  const replacement=(e as any).idleRetouchProcessor;
  e.dispose();
  return {reused,rejected,unchanged,discarded,replaced:replacement!==worker,released:replacement.disposed};
 });
 expect(result).toEqual({reused:true,rejected:true,unchanged:true,discarded:true,replaced:true,released:true});
});
