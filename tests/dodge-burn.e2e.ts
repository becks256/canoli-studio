import { SCHEMA_VERSION } from "../src/core/model";
import { expect, test } from "@playwright/test";

test("retouch worker preserves caller buffers and snapshots inputs before asynchronous execution", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { PixelProcessor } = await import(
      /* @vite-ignore */ String("/src/engine/processor.ts")
    );
    const { applyDodgeBurn } = await import(
      /* @vite-ignore */ String("/src/core/retouch/dodgeBurn.ts")
    );
    const worker = new PixelProcessor();
    try {
      const storage = new Uint8ClampedArray([
        9, 8, 7, 6, 100, 120, 140, 97, 80, 80, 80, 255, 5, 4, 3, 2,
      ]);
      const source = storage.subarray(4, 12);
      const original = source.slice();
      const coverage = new Uint8Array([255, 0]);
      const options = {
        mode: "dodge" as const,
        range: "midtones" as const,
        exposure: 0.75,
      };
      const expected = applyDodgeBurn(original, 2, 1, options, coverage);
      const pending = worker.dodgeBurn(source, 2, 1, options, coverage);
      source[0] = 33;
      coverage[0] = 0;
      options.exposure = 0;
      const actual = await pending;
      const caller = {
        bytes: storage.byteLength,
        source: source[0],
        coverage: coverage[0],
        border: [...storage.slice(0, 4)],
      };
      let invalid = "";
      try {
        await worker.dodgeBurn(original, 3, 1, options);
      } catch (error) {
        invalid = String(error);
      }
      const afterError = await worker.dodgeBurn(original, 2, 1, {
        ...options,
        exposure: 0,
      });
      return {
        actual: [...actual],
        expected: [...expected],
        caller,
        invalid,
        usable: [...afterError],
        original: [...original],
      };
    } finally {
      worker.dispose();
    }
  });
  expect(result.actual).toEqual(result.expected);
  expect(result.caller).toEqual({
    bytes: 16,
    source: 33,
    coverage: 0,
    border: [9, 8, 7, 6],
  });
  expect(result.invalid).toContain("dimensions");
  expect(result.usable).toEqual(result.original);
});

test("tonal brush coverage respects clipping, placement and tile boundaries without changing sources", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { PixelProcessor } = await import(
      /* @vite-ignore */ String("/src/engine/processor.ts")
    );
    const { renderTonalStroke } = await import(
      /* @vite-ignore */ String("/src/engine/retouch.ts")
    );
    const { AffineTransform } = await import(
      /* @vite-ignore */ String("/src/core/affine.ts")
    );
    const processor = new PixelProcessor();
    const source = new Uint8ClampedArray(32 * 16 * 4);
    for (let i = 0; i < source.length; i += 4)
      source.set([100, 100, 100, 177], i);
    const before = source.slice();
    const stroke = {
      id: "tonal",
      kind: "brush",
      points: [
        { x: 4, y: 8, pressure: 0.25 },
        { x: 20, y: 8, pressure: 1 },
      ],
      size: 12,
      hardness: 1,
      opacity: 1,
      flow: 0.5,
      spacing: 0.2,
      pressureSize: true,
      pressureOpacity: true,
      color: "#ffffff",
      tiles: [],
      clip: {
        regions: [
          {
            x: 0,
            y: 0,
            width: 18,
            height: 16,
            shape: "rectangle",
            operation: "add",
          },
        ],
      },
    };
    const options = { mode: "dodge", range: "midtones", exposure: 1 };
    const world = AffineTransform.translation(244, 0);
    const space = { x: 240, y: 0, width: 32, height: 16, sx: 1, sy: 1 };
    try {
      const whole: Uint8ClampedArray = await renderTonalStroke(
        source,
        stroke,
        options,
        space,
        processor,
        world,
      );
      const joined = new Uint8ClampedArray(source.length);
      for (const x of [0, 16]) {
        const input = new Uint8ClampedArray(16 * 16 * 4);
        for (let y = 0; y < 16; y++)
          input.set(
            source.subarray((y * 32 + x) * 4, (y * 32 + x + 16) * 4),
            y * 16 * 4,
          );
        const tile = await renderTonalStroke(
          input,
          stroke,
          options,
          { ...space, x: space.x + x, width: 16 },
          processor,
          world,
        );
        for (let y = 0; y < 16; y++)
          joined.set(
            tile.subarray(y * 16 * 4, (y + 1) * 16 * 4),
            (y * 32 + x) * 4,
          );
      }
      const zero: Uint8ClampedArray = await renderTonalStroke(
        source,
        { ...stroke, flow: 0 },
        options,
        space,
        processor,
        world,
      );
      return {
        sameTiles: whole.every((v, i) => v === joined[i]),
        unchanged: source.every((v, i) => v === before[i]),
        zero: zero.every((v, i) => v === before[i]),
        alpha: whole.every((v, i) => i % 4 !== 3 || v === 177),
        changed: whole[(8 * 32 + 16) * 4] > 100,
        clipped: whole[(8 * 32 + 24) * 4] === 100,
        outside: whole[0] === 100,
      };
    } finally {
      processor.dispose();
    }
  });
  expect(result).toEqual({
    sameTiles: true,
    unchanged: true,
    zero: true,
    alpha: true,
    changed: true,
    clipped: true,
    outside: true,
  });
});

test("scripted tonal layers render a live backdrop, undo and survive project round-trip", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const editor = window.luma.editor;
    editor.newDocument({ width: 32, height: 32 });
    const canvas = new OffscreenCanvas(32, 32);
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#646464";
    context.fillRect(0, 0, 32, 32);
    await editor.importImage(
      new File(
        [await canvas.convertToBlob({ type: "image/png" })],
        "gray.png",
        { type: "image/png" },
      ),
    );
    const originalBytes = [
      ...new Uint8Array(await editor.assetStore.values()[0].blob.arrayBuffer()),
    ];
    await editor.runScript(`
      document.applyTonalSculpt([{ x: 16, y: 16, pressure: 1 }], 'dodge', 'midtones', 1, { size: 12, hardness: 1 });
    `);
    const sample = async () => {
      const output = await editor.renderer.render(
        editor.document.toJSON(),
        editor.assetStore,
        { cache: false, readback: true },
      );
      const c = output.getContext("2d")!;
      const values = {
        center: [...c.getImageData(16, 16, 1, 1).data],
        outside: [...c.getImageData(0, 0, 1, 1).data],
      };
      output.width = output.height = 0;
      return values;
    };
    const applied = await sample();
    editor.document.undo();
    const undone = await sample();
    editor.document.redo();
    const redone = await sample();
    const project = await editor.saveProject();
    await editor.openProject(new File([project], "tonal.luma"));
    const restored = await sample();
    const unchangedSource =
      JSON.stringify(originalBytes) ===
      JSON.stringify([
        ...new Uint8Array(
          await editor.assetStore.values()[0].blob.arrayBuffer(),
        ),
      ]);
    editor.document.layers.at(0)!.opacity = 0.5;
    const live = await sample();
    editor.document.undo();
    return {
      live,
      applied,
      undone,
      redone,
      restored,
      unchangedSource,
      schema: editor.document.toJSON().schemaVersion,
    };
  });
  expect(result.applied.center[0]).toBeGreaterThan(100);
  expect(result.applied.outside).toEqual([100, 100, 100, 255]);
  expect(result.undone.center).toEqual([100, 100, 100, 255]);
  expect(result.redone).toEqual(result.applied);
  expect(result.restored).toEqual(result.applied);
  expect(result.live.center[3]).toBe(128);
  expect(result.live.outside[3]).toBe(128);
  expect(result.unchangedSource).toBe(true);
  expect(result.schema).toBe(SCHEMA_VERSION);
});

test("dodge and burn gestures preview, share a tonal layer, and undo without changing the source", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const editor = window.luma.editor;
    editor.newDocument({ width: 160, height: 100 });
    const canvas = new OffscreenCanvas(160, 100);
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#646464";
    context.fillRect(0, 0, 160, 100);
    await editor.importImage(
      new File([await canvas.convertToBlob()], "gray.png", {
        type: "image/png",
      }),
    );
    editor.tools.configure({
      size: 20,
      hardness: 1,
      pressureSize: false,
      pressureOpacity: false,
      smoothing: 0,
    });
  });
  await page
    .getByRole("button", { name: "Move tool (V)", exact: true })
    .click();
  await page.keyboard.press("Control+1");
  await page.keyboard.press("o");
  await expect(
    page.getByRole("button", { name: "Dodge tool (O)", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .locator(".tool-options")
    .getByRole("spinbutton", { name: "Exposure value", exact: true })
    .fill("100");
  await page
    .locator(".tool-options")
    .getByRole("spinbutton", { name: "Exposure value", exact: true })
    .press("Tab");
  await expect(page.getByLabel("Foreground color")).toHaveCount(0);
  const initial = await page.evaluate(
    () => window.luma.editor.document.getSnapshot().past.length,
  );
  const box = (await page.locator(".canvas-wrap").boundingBox())!;
  const sample = async (preview = false) =>
    page.evaluate(async (preview) => {
      const editor = window.luma.editor;
      const { execute } = await import(
        /* @vite-ignore */ String("/src/core/commands.ts")
      );
      const state = editor.tools.getSnapshot();
      let doc = editor.document.toJSON();
      if (preview && state.preview) doc = execute(doc, state.preview);
      const output = await editor.renderer.render(doc, editor.assetStore, {
        cache: false,
        readback: true,
        ...(preview ? { paintPreview: state.paintPreview ?? undefined } : {}),
      });
      try {
        const ctx = output.getContext("2d")!;
        return {
          dodge: ctx.getImageData(60, 35, 1, 1).data[0],
          burn: ctx.getImageData(60, 65, 1, 1).data[0],
          outside: [...ctx.getImageData(0, 0, 1, 1).data],
        };
      } finally {
        output.width = output.height = 0;
      }
    }, preview);
  const begin = async (y: number) => {
    await page.mouse.move(box.x + 40, box.y + y);
    await page.mouse.down();
    await page.mouse.move(box.x + 90, box.y + y, { steps: 8 });
  };
  await begin(35);
  await expect
    .poll(() =>
      page.evaluate(
        () => window.luma.editor.tools.getSnapshot().paintPreview?.tonal?.mode,
      ),
    )
    .toBe("dodge");
  const preview = await sample(true);
  expect(preview.dodge).toBeGreaterThan(100);
  expect((await sample()).dodge).toBe(100);
  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(
        () => window.luma.editor.document.getSnapshot().past.length,
      ),
    )
    .toBe(initial + 1);
  expect(await sample()).toEqual(preview);
  await page.keyboard.press("Shift+O");
  await expect(
    page.getByRole("button", { name: "Burn tool (Shift+O)", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await begin(65);
  await page.mouse.up();
  const burned = await sample();
  expect(burned.burn).toBeLessThan(100);
  expect(burned.dodge).toBe(preview.dodge);
  expect(burned.outside).toEqual([100, 100, 100, 255]);
  const saved = await page.evaluate(() => {
    const editor = window.luma.editor;
    const layer = editor.document.toJSON().children[1];
    return {
      layers: editor.document.layers.length,
      strokes:
        layer.kind === "adjustment" && layer.adjustment.kind === "tonal"
          ? layer.adjustment.strokes.map((s) => s.mode)
          : [],
      history: editor.document.getSnapshot().past.length,
    };
  });
  expect(saved).toEqual({
    layers: 2,
    strokes: ["dodge", "burn"],
    history: initial + 2,
  });
  await page.keyboard.press("Control+z");
  expect(await sample()).toEqual(preview);
  await page.keyboard.press("Control+Shift+z");
  expect(await sample()).toEqual(burned);
  await begin(80);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await sample()).toEqual(burned);
  expect(
    await page.evaluate(
      () => window.luma.editor.document.getSnapshot().past.length,
    ),
  ).toBe(initial + 2);
  const original = await page.evaluate(() => {
    const bitmap = window.luma.editor.assetStore.values()[0].bitmap;
    const canvas = new OffscreenCanvas(1, 1);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, -60, -35);
    return [...ctx.getImageData(0, 0, 1, 1).data];
  });
  expect(original).toEqual([100, 100, 100, 255]);
});

test('sparse tonal processing matches full-tile correction for every mode and range',async({page})=>{
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const {renderTonalStroke,renderRetouchCoverage}=await import(/* @vite-ignore */ String('/src/engine/retouch.ts'));
    const {AffineTransform}=await import(/* @vite-ignore */ String('/src/core/affine.ts'));
    const processor=window.luma.editor.renderer.processor;
    const source=new Uint8ClampedArray(160*128*4);
    for(let i=0;i<source.length;i++)source[i]=(i*73+19)%256;
    const before=source.slice();
    const brush=new window.luma.BrushStroke({points:[{x:5,y:8,pressure:.3},{x:30,y:20,pressure:1}],size:18,hardness:.4,opacity:.7,flow:.6}).toJSON();
    const space={x:13.25,y:7.5,width:160,height:128,sx:1.25,sy:.8};
    const world=new AffineTransform(1,.4,-.3,1,50,40);
    const coverage=await renderRetouchCoverage(brush,space,processor,world);
    const checks=[];
    for(const mode of ['dodge','burn'] as const)for(const range of ['shadows','midtones','highlights'] as const)for(const protectTones of [false,true]){
      const options={mode,range,exposure:.75,protectTones};
      const expected=await processor.dodgeBurn(source,160,128,{...options,flow:1},coverage);
      const actual=await renderTonalStroke(source,brush,options,space,processor,world);
      checks.push(actual.every((v:number,i:number)=>v===expected[i]));
    }
    return {checks,unchanged:source.every((v,i)=>v===before[i]),covered:coverage.filter((v:number)=>v>0).length};
  });
  expect(result.checks).toEqual(Array(12).fill(true));
  expect(result.unchanged).toBe(true);expect(result.covered).toBeGreaterThan(0);expect(result.covered).toBeLessThan(160*128/4);
});

test('retouch cell culling matches an uncropped fixed-grid coverage oracle',async({page})=>{
  await page.goto('/');
  const results=await page.evaluate(async()=>{
    const {renderRetouchCoverage}=await import(/* @vite-ignore */ String('/src/engine/retouch.ts'));
    const {drawMaskStroke}=await import(/* @vite-ignore */ String('/src/engine/drawing.ts'));
    const {AffineTransform}=await import(/* @vite-ignore */ String('/src/core/affine.ts'));
    const e=window.luma.editor,results=[];
    const brush=new window.luma.BrushStroke({points:[{x:0,y:0,pressure:.2},{x:35,y:18,pressure:1}],size:27,hardness:.3,opacity:.6,flow:.7}).toJSON();
    for(const [x,y,sx,sy,tx,ty] of [[0,0,1,1,255,255],[12.3,-8.7,.7,1.4,250,170],[-270,-30,1.2,.8,-10,5],[0,0,1,1,3000,3000]]){
      const space={x,y,sx,sy,width:700,height:540},world=new AffineTransform(1,.3,-.4,1,tx,ty);
      const expected=new Uint8Array(space.width*space.height),px=Math.floor(x*sx),py=Math.floor(y*sy),phaseX=x*sx-px,phaseY=y*sy-py;
      for(let cy=Math.floor(py/256)*256;cy<py+space.height;cy+=256)for(let cx=Math.floor(px/256)*256;cx<px+space.width;cx+=256){
        const cell=document.createElement('canvas');cell.width=cell.height=260;
        try{
          await drawMaskStroke({mode:'reveal',stroke:brush},cell,{...space,x:(cx+phaseX-2)/sx,y:(cy+phaseY-2)/sy,width:260,height:260},0,0,e.renderer.processor,undefined,world);
          const left=Math.max(cx,px),top=Math.max(cy,py),w=Math.min(cx+256,px+space.width)-left,h=Math.min(cy+256,py+space.height)-top;
          const rgba=cell.getContext('2d')!.getImageData(left-cx+2,top-cy+2,w,h).data;
          for(let row=0;row<h;row++)for(let col=0;col<w;col++)expected[(top-py+row)*space.width+left-px+col]=rgba[(row*w+col)*4+3];
        }finally{cell.width=cell.height=0;}
      }
      const actual=await renderRetouchCoverage(brush,space,e.renderer.processor,world);
      results.push(actual.every((v:number,i:number)=>v===expected[i]));
    }
    return results;
  });
  expect(results).toEqual([true,true,true,true]);
});
