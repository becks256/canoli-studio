import { expect, test } from "@playwright/test";

test('custom eraser cursor follows size and zoom, supports hand mode and restores the system pointer outside the canvas', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
  await page.evaluate(()=>window.luma.editor.newDocument({width:800,height:600}));
  await page.getByRole('button',{name:'Eraser tool (E)',exact:true}).click();
  await page.keyboard.press('Control+1');
  await page.evaluate(()=>window.luma.editor.tools.configure({size:40}));
  const viewport=page.getByLabel('Editing canvas',{exact:true});
  const box=(await viewport.boundingBox())!;
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  const cursor=page.getByTestId('canvas-custom-cursor');
  await expect(cursor).toBeVisible();
  await expect(cursor).toHaveAttribute('data-cursor-kind','eraser');
  await expect(cursor.locator('circle').first()).toHaveAttribute('r','20');
  expect(await viewport.evaluate(node=>getComputedStyle(node).cursor)).toBe('none');
  await page.keyboard.press('-');
  await expect.poll(()=>cursor.locator('circle').first().getAttribute('r')).not.toBe('20');
  await page.keyboard.down('Space');
  await expect(cursor).toHaveAttribute('data-cursor-kind','hand');
  await page.keyboard.up('Space');
  await expect(cursor).toHaveAttribute('data-cursor-kind','eraser');
  await page.getByRole('button',{name:'Move tool (V)',exact:true}).hover();
  await expect(cursor).toBeHidden();
  expect(await viewport.evaluate(node=>node.hasAttribute('data-custom-cursor-active'))).toBe(false);
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  await expect(cursor).toBeVisible();
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  await expect(cursor).toBeHidden();
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox',{name:'Search commands'}).fill('Use system canvas cursors');
  await page.getByRole('option',{name:/Use system canvas cursors/}).click();
  await page.mouse.move(box.x+box.width/2+20,box.y+box.height/2);
  await expect(cursor).toBeHidden();
  expect(await viewport.evaluate(node=>getComputedStyle(node).cursor)).not.toBe('none');
  expect(await page.evaluate(()=>localStorage.getItem('luma.custom-cursors.v1'))).toBe('false');
});

test('hover and tool switching avoid document serialization with a detailed pixel selection; idle recorder takes no command snapshots',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
  await page.evaluate(()=>{
    const {editor,PaintLayer,PaintFill,MarqueeSelection}=window.luma;
    editor.newDocument({width:800,height:600});
    const paint=editor.document.layers.add(new PaintLayer());
    paint.strokes.add(new PaintFill({bounds:{x:0,y:0,width:800,height:600},color:'#ffffff'}));
    editor.document.selectedLayer=paint;
    editor.document.selection=new MarqueeSelection({shape:'pixels',x:0,y:0,width:800,height:600,
      coverage:{width:800,height:600,runs:Array.from({length:240000},(_,i)=>i%2?128:(i/2+1)*4)}});
  });
  await expect(page.getByTestId('pixel-selection-outline')).toBeVisible();
  await page.evaluate(()=>{
    const e=window.luma.editor;
    (window as any).documentCopies=0;
    const serialize=e.document.toJSON.bind(e.document);
    e.document.toJSON=()=>{(window as any).documentCopies++;return serialize();};
    e.document.name='No idle recorder copying';
  });
  const copiesAfterEdit=await page.evaluate(()=>(window as any).documentCopies);
  expect(copiesAfterEdit).toBe(0);
  for(const label of ['Eraser tool (E)','Brush tool (B)','Pencil tool (N)','Move tool (V)']) {
    const button=page.getByRole('button',{name:label,exact:true});
    await button.click();await expect(button).toHaveAttribute('aria-pressed','true');
  }
  const box=(await page.getByLabel('Editing canvas',{exact:true}).boundingBox())!;
  await page.mouse.move(box.x+100,box.y+100);
  for(let i=0;i<20;i++)await page.mouse.move(box.x+100+i*3,box.y+100+i);
  expect(await page.evaluate(()=>(window as any).documentCopies)).toBe(0);
  await page.evaluate(async()=>{
    const e=window.luma.editor;
    e.tools.begin('brush',{x:100,y:100},{shift:false,alt:false,pressure:1},1);
    e.tools.move({x:120,y:110},{shift:false,alt:false,pressure:1});
    await e.tools.end();
  });
  expect(await page.evaluate(()=>(window as any).documentCopies)).toBe(0);
  const recording=await page.evaluate(()=>{
    const e=window.luma.editor;
    e.recipes.recorder.start(e.document.selectedLayer!.id);
    e.document.selectedLayer!.x=10;
    const active=(window as any).documentCopies;
    e.recipes.recorder.stop();
    e.document.selectedLayer!.x=20;
    return {active,stopped:(window as any).documentCopies};
  });
  expect(recording.active).toBeGreaterThan(0);
  expect(recording.stopped).toBe(recording.active);
});

test('custom cursor hides the native pointer over artwork and transform handles', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
  await page.evaluate(()=>{
    const {editor:e,VectorLayer,VectorPath}=window.luma;
    e.newDocument({width:800,height:600});
    const layer=e.document.layers.add(new VectorLayer());
    layer.paths.add(new VectorPath({points:[{x:150,y:150},{x:350,y:150},{x:350,y:300},{x:150,y:300}],closed:true,fill:'#ff0000'}));
    e.document.selectedLayer=layer;
  });
  await page.keyboard.press('Control+1');
  await page.keyboard.press('p');
  const canvas=(await page.locator('.canvas-wrap').boundingBox())!;
  await page.mouse.move(canvas.x+200,canvas.y+200);
  const cursor=page.getByTestId('canvas-custom-cursor');
  await expect(cursor).toHaveAttribute('data-cursor-kind','crosshair');
  expect(await page.evaluate(({x,y})=>getComputedStyle(document.elementFromPoint(x,y)!).cursor,{x:canvas.x+200,y:canvas.y+200})).toBe('none');
  await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
  await page.evaluate(async()=>{
    const canvas=new OffscreenCanvas(160,80);
    canvas.getContext('2d')!.fillRect(0,0,160,80);
    const layer=await window.luma.editor.importImage(new File([await canvas.convertToBlob()],'Transform.png',{type:'image/png'}));
    layer.update({x:220,y:140});
  });
  const handle=page.locator('[data-handle="nw"]');
  await handle.hover();
  await expect(cursor).toHaveAttribute('data-cursor-kind','resize');
  expect(await handle.evaluate(node=>getComputedStyle(node).cursor)).toBe('none');
  const rotate=page.getByRole('button',{name:'Drag to rotate layer',exact:true});
  await rotate.hover();
  await expect(cursor).toHaveAttribute('data-cursor-kind','rotate');
  expect(await rotate.evaluate(node=>getComputedStyle(node).cursor)).toBe('none');
});
