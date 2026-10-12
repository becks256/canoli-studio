import { expect, test } from "@playwright/test";

test("800x600 overlay picking previews without history churn, commits once, and leaves tools responsive", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Move tool (V)", exact: true }).click();
  await page.evaluate(() => {
    const { editor, PaintLayer, PaintFill } = window.luma;
    editor.newDocument({ width: 800, height: 600 });
    const layer = editor.document.layers.add(new PaintLayer({ name: "Color test" }));
    layer.strokes.add(new PaintFill({ bounds: { x: 0, y: 0, width: 800, height: 600 }, color: "#ff0000" }));
    editor.document.selectedLayer = layer;
  });
  await page.getByRole("checkbox", { name: "Enable color overlay", exact: true }).check();
  const picker = page.getByLabel("Overlay color", { exact: true });
  const before = await page.evaluate(() => {
    const e = window.luma.editor;
    return { history: e.document.getSnapshot().past.length, color: e.document.selectedLayer!.styles.toJSON().colorOverlay.color };
  });
  await picker.focus();
  await picker.evaluate(element => {
    const input = element as HTMLInputElement;
    for (let i = 0; i < 80; i++) {
      input.value = `#${(0x100000 + i * 1000).toString(16)}`;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    input.value = "#0000ff";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  expect(await page.evaluate(() => window.luma.editor.document.getSnapshot().past.length)).toBe(before.history);
  expect(await page.evaluate(() => window.luma.editor.document.selectedLayer!.styles.toJSON().colorOverlay.color)).toBe(before.color);
  await picker.evaluate(element => element.dispatchEvent(new Event("change", { bubbles: true })));
  await expect.poll(() => page.evaluate(() => window.luma.editor.document.selectedLayer!.styles.toJSON().colorOverlay.color)).toBe("#0000ff");
  expect(await page.evaluate(() => window.luma.editor.document.getSnapshot().past.length)).toBe(before.history + 1);
  await page.getByRole("button", { name: "Move tool (V)", exact: true }).click();
  await page.keyboard.press("Control+z");
  expect(await page.evaluate(() => window.luma.editor.document.selectedLayer!.styles.toJSON().colorOverlay.color)).toBe(before.color);
  const history = await page.evaluate(() => window.luma.editor.document.getSnapshot().past.length);
  for (let i = 0; i < 4; i++) for (const label of ["Brush tool (B)", "Pencil tool (N)", "Move tool (V)"]) {
    const tool = page.getByRole("button", { name: label, exact: true });
    await tool.click(); await expect(tool).toHaveAttribute("aria-pressed", "true");
  }
  expect(await page.evaluate(() => window.luma.editor.document.getSnapshot().past.length)).toBe(history);
  await picker.focus();
  await picker.evaluate(element => { const input = element as HTMLInputElement; input.value = "#00ff00"; input.dispatchEvent(new Event("input", { bubbles: true })); });
  await picker.press("Escape");
  expect(await page.evaluate(() => window.luma.editor.document.getSnapshot().past.length)).toBe(history);
  await expect(picker).toHaveValue(before.color);
});

test("overlay previews reuse raster source pixels while updating the rendered color", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { CanvasRenderer } = await import(/* @vite-ignore */ String('/src/engine/renderer.ts'));
    const { editor, LayerStyle } = window.luma;
    const canvas = document.createElement('canvas'); canvas.width=800; canvas.height=600;
    canvas.getContext('2d')!.fillRect(0,0,800,600);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!)));
    const layer = await editor.importImage(new File([blob], 'source.png', {type:'image/png'}));
    await document.fonts.ready;
    const renderer = new CanvasRenderer();
    let reads = 0;
    const raw = (renderer as any).raster.bind(renderer);
    (renderer as any).raster = (...args: unknown[]) => { reads++; return raw(...args); };
    const pixels: number[][] = [];
    try {
      for (const color of ['#ff0000','#0000ff','#00ff00']) {
        layer.styles = new LayerStyle({colorOverlay:{enabled:true,color,opacity:1}});
        const output = await renderer.render(editor.document.getSnapshot().document, editor.assetStore, {maxDimension:800,maxPixels:480000});
        pixels.push([...output.getContext('2d')!.getImageData(10,10,1,1).data]);
        output.width=output.height=0;
      }
    } finally { renderer.dispose(); }
    return {reads,pixels};
  });
  expect(result.reads).toBe(1);
  expect(result.pixels).toEqual([[255,0,0,255],[0,0,255,255],[0,255,0,255]]);
});

test("cancelling a queued color input does not resurrect a preview", async ({page}) => {
  await page.goto('/');
  await page.evaluate(()=>{
    const {editor:e,PaintLayer,PaintFill}=window.luma;
    e.newDocument({width:200,height:100});
    const layer=e.document.layers.add(new PaintLayer());
    layer.strokes.add(new PaintFill({bounds:{x:0,y:0,width:200,height:100},color:'#ff0000'}));
    e.document.selectedLayer=layer;
  });
  await page.getByRole('checkbox',{name:'Enable color overlay',exact:true}).check();
  const picker=page.getByLabel('Overlay color',{exact:true});
  await picker.focus();await page.waitForTimeout(200);
  const pixel=()=>page.locator('.canvas-wrap canvas').evaluate(canvas=>[...(canvas as HTMLCanvasElement).getContext('2d')!.getImageData(10,10,1,1).data]);
  const before=await pixel();
  const revision=await page.evaluate(()=>window.luma.editor.document.getSnapshot().revision);
  const color=await picker.inputValue();
  await picker.evaluate(element=>{
    const input=element as HTMLInputElement;
    input.value='#00ff00';input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  });
  await page.evaluate(async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});
  await expect(picker).toHaveValue(color);
  expect(await pixel()).toEqual(before);
  expect(await page.evaluate(()=>window.luma.editor.document.getSnapshot().revision)).toBe(revision);
});
