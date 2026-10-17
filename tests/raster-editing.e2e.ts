import { test, expect, type Page } from '@playwright/test';
async function setup(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name:'Move tool (V)', exact:true }).click();
  await page.evaluate(async () => {
    const editor = window.luma.editor; editor.newDocument({width:64,height:32});
    const canvas = document.createElement('canvas'); canvas.width=64; canvas.height=32;
    const c=canvas.getContext('2d')!;
    c.fillStyle='#ff0000'; c.fillRect(8,8,16,16); c.fillRect(40,8,16,16);
    c.clearRect(8,8,1,1); c.fillStyle='rgba(255,0,0,0.5)'; c.fillRect(8,8,1,1);
    const blob=await new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!),'image/png'));
    const layer=await editor.importImage(new File([blob],'transparent.png',{type:'image/png'}));
    (window as any).originalSource=[...new Uint8Array(await editor.assetStore.get(layer.assetId).blob.arrayBuffer())];
  });
  await page.keyboard.press('Control+1');
}
async function alpha(page:Page, x:number,y:number) {
  return page.evaluate(async ({x,y})=>{
    const image=await createImageBitmap(await window.luma.editor.exportPng());
    const c=document.createElement('canvas');c.width=c.height=1;
    c.getContext('2d')!.drawImage(image,-x,-y);image.close();
    return c.getContext('2d')!.getImageData(0,0,1,1).data[3];
  },{x,y});
}
async function clickPixel(page:Page,x:number,y:number) {
  const box=(await page.locator('.canvas-wrap').boundingBox())!;
  await page.mouse.click(box.x+x,box.y+y);
}

test('eraser edits imported raster alpha in place, leaves source immutable and persists with undo',async({page})=>{
  await setup(page);
  await page.getByRole('button',{name:'Eraser tool (E)',exact:true}).click();
  await page.evaluate(()=>window.luma.editor.tools.configure({size:6,hardness:1,opacity:1,flow:1,pressureSize:false}));
  const before=await page.evaluate(()=>window.luma.editor.document.getSnapshot().past.length);
  await clickPixel(page,16,16);
  await expect.poll(()=>alpha(page,16,16)).toBe(0);
  expect(await alpha(page,20,20)).toBe(255);
  expect(await page.evaluate(()=>window.luma.editor.document.layers.length)).toBe(1);
  expect(await page.evaluate(()=>window.luma.editor.document.getSnapshot().past.length)).toBe(before+1);
  await page.keyboard.press('Control+z');expect(await alpha(page,16,16)).toBe(255);
  await page.keyboard.press('Control+Shift+z');
  const saved=await page.evaluate(async()=>{
    const editor=window.luma.editor,layer=editor.document.toJSON().children[0];
    if(layer.kind!=='raster')throw new Error('Expected raster');
    const unchanged=JSON.stringify([...new Uint8Array(await editor.assetStore.get(layer.assetId).blob.arrayBuffer())])===JSON.stringify((window as any).originalSource);
    const blob=await editor.saveProject();await editor.openProject(new File([blob],"raster.luma"));
    return {unchanged,kind:editor.document.toJSON().children[0].kind};
  });
  expect(saved).toEqual({unchanged:true,kind:'raster'});expect(await alpha(page,16,16)).toBe(0);
  await page.evaluate(()=>{const e=window.luma.editor;e.document.resize(128,32);e.document.layers.at(0)!.update({width:128});});
  expect(await alpha(page,32,16)).toBe(0);expect(await alpha(page,22,16)).toBe(255);
});

test('marquee copy/paste retains partial alpha, pixel position and a separate undoable raster layer',async({page})=>{
  await setup(page);
  await page.getByRole('button',{name:'Marquee tool (M)',exact:true}).click();
  const box=(await page.locator('.canvas-wrap').boundingBox())!;
  await page.mouse.move(box.x+8,box.y+8);await page.mouse.down();await page.mouse.move(box.x+16,box.y+24);await page.mouse.up();
  await page.keyboard.press('Control+c');
  await expect.poll(()=>page.evaluate(()=>window.luma.editor.pixels.canPaste)).toBe(true);
  await page.keyboard.press('Control+v');await expect(page.locator('.layer-row')).toHaveCount(2);
  const pasted=await page.evaluate(()=>window.luma.editor.document.selectedLayer!.toJSON());
  expect(pasted).toMatchObject({kind:'raster',x:8,y:8,width:8,height:16});
  await page.keyboard.press('Control+z');await expect(page.locator('.layer-row')).toHaveCount(1);
  await page.keyboard.press('Control+Shift+z');
  await page.evaluate(()=>{const e=window.luma.editor; e.document.layers.at(0)!.visible=false;});
  expect(await alpha(page,8,8)).toBe(128);expect(await alpha(page,12,12)).toBe(255);expect(await alpha(page,20,12)).toBe(0);
});

test('Ctrl-click raster thumbnail loads alpha coverage and wand selects contiguous or matching islands',async({page})=>{
  await setup(page);
  await page.locator('.layer-select img').click({modifiers:['Control']});
  await expect(page.getByTestId('pixel-selection-outline')).toBeVisible();
  const coverage=await page.evaluate(async()=>{
    const e=window.luma.editor;
    const mask=await e.renderer.processor.selection({selection:e.document.selection!.toJSON(),width:64,height:32,x:0,y:0,stepX:1,stepY:1});
    return [mask[(8*64+8)*4+3],mask[(16*64+16)*4+3],mask[(16*64+32)*4+3]];
  });
  expect(coverage).toEqual([128,255,0]);
  await page.getByRole('button',{name:'Magic wand tool (W)',exact:true}).click();
  await clickPixel(page,16,16);
  await expect.poll(()=>page.evaluate(()=>window.luma.editor.document.selection!.toJSON().regions[0].coverage!.runs.length)).toBeGreaterThan(1);
  const selected=()=>page.evaluate(async()=>{
    const e=window.luma.editor;const mask=await e.renderer.processor.selection({selection:e.document.selection!.toJSON(),width:64,height:32,x:0,y:0,stepX:1,stepY:1});
    return [mask[(16*64+16)*4+3],mask[(16*64+48)*4+3]];
  });
  await expect.poll(selected).toEqual([255,0]);
  await page.getByRole('checkbox',{name:'Contiguous',exact:true}).uncheck();
  await clickPixel(page,16,16);await expect.poll(selected).toEqual([255,255]);
  await page.keyboard.press('Control+z');await expect.poll(selected).toEqual([255,0]);
  await page.evaluate(async()=>{const e=window.luma.editor;const saved=await e.saveProject();await e.openProject(new File([saved],"selection.luma"));});
  await expect.poll(selected).toEqual([255,0]);
});


test('Delete clears selected raster pixels without deleting the layer',async({page})=>{
  await setup(page);
  await page.evaluate(async()=>{
    const {MarqueeSelection}=await import(/* @vite-ignore */ String('/src/dom/index.ts'));
    window.luma.editor.document.selection=new MarqueeSelection({shape:'rectangle',x:8,y:8,width:8,height:16});
  });
  await page.keyboard.press('Delete');
  await expect.poll(()=>alpha(page,12,12)).toBe(0);
  expect(await alpha(page,20,12)).toBe(255);
  await expect(page.locator('.layer-row')).toHaveCount(1);
  await page.keyboard.press('Control+z');expect(await alpha(page,12,12)).toBe(255);
});

test('isolated scripts clear fractional pixel selections and PSD cannot silently restore erasures',async({page})=>{
  await setup(page);
  await page.evaluate(async()=>{
    await window.luma.editor.runScript(`
      const image = document.selectedLayer;
      if (!(image instanceof RasterLayer)) throw new Error("Select an image layer.");
      image.clear(new MarqueeSelection({shape:"pixels",x:16,y:16,width:1,height:1,
        coverage:{width:1,height:1,runs:[1,128]}}));
    `);
  });
  expect(await alpha(page,16,16)).toBe(127);
  expect(await alpha(page,17,16)).toBe(255);
  const exported=await page.evaluate(async()=>{
    const {parsePsd}=await import(/* @vite-ignore */String('/src/core/interchange/psd/parser.ts'));
    const result=await window.luma.editor.export({format:'psd'});
    const psd=parsePsd(await result.blob.arrayBuffer()),pixels=psd.composite!.data;
    const at=(x:number,y:number)=>pixels[(y*psd.header.width+x)*4+3];
    return {erased:at(16,16),untouched:at(17,16),layerAlpha:psd.layers[0].imageData!.data[(16*psd.layers[0].width+16)*4+3]};
  });
  expect(exported).toEqual({erased:127,untouched:255,layerAlpha:127});
  await page.keyboard.press('Control+z');expect(await alpha(page,16,16)).toBe(255);
});

test('pixel capture rejects a changed document without committing a stale selection',async({page})=>{
  await setup(page);
  const result=await page.evaluate(async()=>{
    const e=window.luma.editor;
    const pending=e.pixels.loadTransparency().then(()=>'',error=>String(error));
    e.document.selectedLayer!.name='Changed during capture';
    return {error:await pending,selection:e.document.selection};
  });
  expect(result.error).toContain('changed while reading pixels');
  expect(result.selection).toBeNull();
});

test('paint thumbnails load hidden unselected layer alpha through transformed ancestry and update after edits',async({page})=>{
  await setup(page);
  const originalId=await page.evaluate(async()=>{
    const {LayerGroup,PaintLayer,PaintFill}=window.luma;
    const e=window.luma.editor, original=e.document.selectedLayer!;
    const group=e.document.layers.add(new LayerGroup({name:'Hidden group',x:8,visible:false}));
    const paint=group.layers.add(new PaintLayer({name:'Paint sample',x:16}));
    paint.strokes.add(new PaintFill({bounds:{x:8,y:8,width:8,height:8},color:'#ff0000',opacity:0.5}));
    e.document.selectedLayer=original;
    return original.id;
  });
  const thumb=page.getByRole('img',{name:'Paint sample thumbnail',exact:true});
  await expect(thumb).toHaveAttribute('src',/^data:image\/png/);
  const first=await thumb.getAttribute('src');
  await thumb.click({modifiers:['Control']});
  const selected=()=>page.evaluate(async()=>{
    const e=window.luma.editor;
    if (!e.document.selection) return null;
    const mask=await e.renderer.processor.selection({selection:e.document.selection!.toJSON(),width:64,height:32,x:0,y:0,stepX:1,stepY:1});
    return [mask[(10*64+34)*4+3],mask[(10*64+10)*4+3]];
  });
  await expect.poll(selected).toEqual([128,0]);
  expect(await page.evaluate(()=>window.luma.editor.document.selectedLayer!.id)).toBe(originalId);
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(()=>window.luma.editor.document.selection)).toBeNull();
  await page.evaluate(async()=>{
    const {PaintLayer,PaintFill}=window.luma;
    const e=window.luma.editor;
    const group=e.document.layers.at(1)!;
    if (!(group instanceof window.luma.LayerGroup)) throw new Error("Expected group");
    const paint=group.layers.at(0)! as InstanceType<typeof PaintLayer>;
    paint.strokes.add(new PaintFill({bounds:{x:8,y:8,width:8,height:8},color:'#0000ff'}));
  });
  await expect.poll(()=>thumb.getAttribute('src')).not.toBe(first);
  await expect(thumb).toHaveAttribute('src',/^data:image\/png/);
  await thumb.click({modifiers:['Meta']});
  await expect.poll(selected).toEqual([255,0]);
  // Hidden imported layers remain valid thumbnail targets, independent of active layer.
  await page.evaluate(()=>{const e=window.luma.editor;e.document.layers.at(0)!.visible=false;e.document.selectedLayer=null;});
  await page.getByRole('img',{name:'transparent.png thumbnail',exact:true}).click({modifiers:['Control']});
  await expect.poll(selected).toEqual([0,255]);
});

test('empty paint layer has a thumbnail and loads an empty selection',async({page})=>{
  await setup(page);
  await page.evaluate(async()=>{
    const {PaintLayer}=window.luma;
    window.luma.editor.document.layers.add(new PaintLayer({name:'Empty paint'}));
  });
  const thumb=page.getByRole('img',{name:'Empty paint thumbnail',exact:true});
  await expect(thumb).toHaveAttribute('src',/^data:image\/png/);
  await thumb.click({modifiers:['Control']});
  await expect.poll(()=>page.evaluate(()=>window.luma.editor.document.selection?.toJSON().regions[0].coverage?.runs)).toEqual([1,0]);
});

test('selection coverage worker results cannot commit after the document changes',async({page})=>{
  await setup(page);
  await page.evaluate(()=>{
    const e=window.luma.editor, processor=e.renderer.processor;
    const original=processor.selectionCoverage.bind(processor);
    processor.selectionCoverage=async(...args)=>{
      const result=await original(...args);
      await new Promise<void>(resolve=>{(window as any).releaseCoverage=resolve;});
      return result;
    };
    (window as any).coverageResult=e.pixels.loadTransparency().then(()=>'',error=>String(error));
  });
  await expect.poll(()=>page.evaluate(()=>typeof (window as any).releaseCoverage)).toBe('function');
  const result=await page.evaluate(async()=>{
    const e=window.luma.editor;e.document.selectedLayer!.name='Changed while worker returned';
    (window as any).releaseCoverage();
    return {error:await (window as any).coverageResult,selection:e.document.selection};
  });
  expect(result.error).toContain('changed while reading pixels');
  expect(result.selection).toBeNull();
});

test('late clipboard worker output cannot replace the prior clipboard after an edit',async({page})=>{
  await setup(page);
  await page.evaluate(async()=>{
    const e=window.luma.editor;await e.pixels.copy();e.document.selectedLayer!.x=2;
    const original=e.renderer.processor.clipboardPixels.bind(e.renderer.processor);
    e.renderer.processor.clipboardPixels=async(...args)=>{
      const result=await original(...args);
      await new Promise<void>(resolve=>{(window as any).releaseClipboard=resolve;});
      return result;
    };
    (window as any).copyResult=e.pixels.copy().then(()=>'',error=>String(error));
  });
  await expect.poll(()=>page.evaluate(()=>typeof (window as any).releaseClipboard)).toBe('function');
  const error=await page.evaluate(async()=>{
    const e=window.luma.editor;e.document.selectedLayer!.x+=5;
    (window as any).releaseClipboard();return await (window as any).copyResult;
  });
  expect(error).toContain('changed while reading pixels');
  await page.evaluate(()=>window.luma.editor.pixels.paste());
  expect(await page.evaluate(()=>window.luma.editor.document.selectedLayer!.x)).toBe(8);
});

for (const outcome of ["complete", "escape", "blur", "edit"]) test(`paste requested during copy: ${outcome}`, async ({page}) => {
  const cancel = outcome !== "complete";
  await setup(page);
  await page.evaluate(() => {
    const processor = window.luma.editor.renderer.processor;
    const original = processor.clipboardPixels.bind(processor);
    processor.clipboardPixels = async (...args) => {
      const result = await original(...args);
      await new Promise<void>(resolve => { (window as any).releaseCopy = resolve; });
      return result;
    };
  });
  await page.keyboard.press('Control+c');
  await page.waitForFunction(() => !!(window as any).releaseCopy);
  await page.keyboard.press('Control+v');
  await page.keyboard.press('Control+v');
  if (outcome === "escape") await page.keyboard.press('Escape');
  if (outcome === "blur") await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  if (outcome === "edit") await page.evaluate(() => { window.luma.editor.document.selectedLayer!.x += 1; });
  await page.evaluate(() => (window as any).releaseCopy());
  await expect(page.getByText('Working…', {exact:true})).toHaveCount(0);
  await expect(page.locator('.layer-row')).toHaveCount(cancel ? 1 : 3);
  if (!cancel) {
    await page.keyboard.press('Control+z');
    await expect(page.locator('.layer-row')).toHaveCount(2);
    await page.keyboard.press('Control+z');
    await expect(page.locator('.layer-row')).toHaveCount(1);
  }
});
