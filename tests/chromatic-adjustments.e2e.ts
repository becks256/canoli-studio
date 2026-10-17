import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

test.beforeEach(async({page})=>{
  await page.goto('/');
  await page.evaluate(async()=>{
    const {editor,RasterLayer}=window.luma;editor.newDocument({width:64,height:32});
    const c=document.createElement('canvas');c.width=64;c.height=32;
    const ctx=c.getContext('2d')!;ctx.fillStyle='rgb(80,120,150)';ctx.fillRect(0,0,64,32);
    const blob=await new Promise<Blob>(resolve=>c.toBlob(v=>resolve(v!)));
    const asset=await editor.assetStore.add(blob,'original',undefined,false);
    editor.document.selectedLayer=editor.document.layers.add(new RasterLayer({assetId:asset.id,width:64,height:32}));
  });
});

test('named Color Balance creation, channel controls, reset and locking share undo',async({page})=>{
  await page.getByLabel('Editing canvas',{exact:true}).focus();await page.keyboard.press('Control+k');
  await page.getByRole('combobox',{name:'Search commands',exact:true}).fill('Color Balance');await page.keyboard.press('Enter');
  await expect(page.getByLabel('Adjustment type',{exact:true})).toHaveValue('color-balance');
  expect(await page.evaluate(()=>window.luma.editor.document.selectedLayer?.name)).toBe('Color Balance 1');
  const red=page.getByRole('spinbutton',{name:'Cyan / Red value',exact:true});
  const revision=await page.evaluate(()=>window.luma.editor.document.getSnapshot().revision);
  await red.fill('40');expect(await page.evaluate(()=>window.luma.editor.document.getSnapshot().revision)).toBe(revision);
  await red.press('Enter');expect(await page.evaluate(()=>window.luma.editor.document.getSnapshot().revision)).toBe(revision+1);
  const midtones=await page.evaluate(()=>window.luma.editor.document.selectedLayer!.toJSON());
  expect((midtones as any).adjustment.midtones.red).toBe(40);
  await page.getByRole('combobox',{name:'Color balance range',exact:true}).selectOption('shadows');
  await red.fill('-30');await red.press('Enter');
  await page.getByRole('button',{name:'Reset adjustment',exact:true}).click();
  await expect(red).toHaveValue('0');
  await page.getByLabel('Editing canvas',{exact:true}).focus();await page.keyboard.press('Control+z');
  await expect(red).toHaveValue('-30');
  await page.evaluate(()=>{window.luma.editor.document.selectedLayer!.locked=true;});await expect(red).toBeDisabled();
});

test('Color Balance and Vibrance render masks, export and project reopening without changing originals',async({page})=>{
  const result=await page.evaluate(async()=>{
    const {editor,AdjustmentLayer,LayerMask,MarqueeSelection,defaultColorBalanceAdjustment}=window.luma;
    const source=editor.assetStore.values()[0],original=Array.from(new Uint8Array(await source.blob.arrayBuffer()));
    const settings=defaultColorBalanceAdjustment();settings.midtones.red=35;settings.preserveLuminosity=false;
    const layer=editor.document.layers.add(new AdjustmentLayer({adjustment:settings}));
    layer.mask=new LayerMask({selection:new MarqueeSelection({shape:'rectangle',x:0,y:0,width:32,height:32})});
    const pixels=async()=>{
      const image=await createImageBitmap(await editor.exportPng());const c=document.createElement('canvas');c.width=64;c.height=32;
      const ctx=c.getContext('2d')!;ctx.drawImage(image,0,0);image.close();return[4,48].map(x=>Array.from(ctx.getImageData(x,10,1,1).data));
    };
    const balanced=await pixels();layer.adjustment={kind:'vibrance',vibrance:100,saturation:0};const vibrant=await pixels();
    editor.document.undo();const undone=await pixels();editor.document.redo();
    const project=await editor.saveProject();await editor.openProject(new File([project],'chromatic.luma'));
    return{balanced,vibrant,undone,reopened:await pixels(),original,after:Array.from(new Uint8Array(await editor.assetStore.values()[0].blob.arrayBuffer())),schema:editor.document.toJSON().schemaVersion};
  });
  expect(result.balanced[0][0]).toBeGreaterThan(80);expect(result.balanced[1]).toEqual([80,120,150,255]);
  expect(result.vibrant[0][2]-result.vibrant[0][0]).toBeGreaterThan(70);expect(result.vibrant[1]).toEqual([80,120,150,255]);
  expect(result.undone).toEqual(result.balanced);expect(result.reopened).toEqual(result.vibrant);expect(result.after).toEqual(result.original);expect(result.schema).toBe(27);
});

test('Vibrance context action and controls retain independent saturation and one-step undo',async({page})=>{
  await page.locator('.viewport').click({button:'right',position:{x:50,y:50}});
  expect(await page.locator('.canvas-context-menu').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
  await page.locator('.canvas-context-menu').getByRole('button',{name:'Vibrance',exact:true}).click();
  await expect(page.getByLabel('Adjustment type',{exact:true})).toHaveValue('vibrance');
  const vibrance=page.getByRole('spinbutton',{name:'Vibrance value',exact:true});await vibrance.fill('70');await vibrance.press('Enter');
  const saturation=page.getByRole('spinbutton',{name:'Vibrance saturation value',exact:true});await saturation.fill('-25');await saturation.press('Enter');
  expect(await page.evaluate(()=> (window.luma.editor.document.selectedLayer!.toJSON() as any).adjustment)).toEqual({kind:'vibrance',vibrance:70,saturation:-25});
  await page.getByLabel('Editing canvas',{exact:true}).focus();await page.keyboard.press('Control+z');
  await expect(saturation).toHaveValue('0');await expect(vibrance).toHaveValue('70');
});

test('chromatic workers snapshot nested caller settings and agree with the reference',async({page})=>{
  const result=await page.evaluate(async()=>{
    const {PixelProcessor}=await import(/* @vite-ignore */String('/src/engine/processor.ts'));
    const {adjustChromatic}=await import(/* @vite-ignore */String('/src/engine/chromatic.ts'));
    const processor=new PixelProcessor(),source=new Uint8ClampedArray([80,120,150,128,30,40,50,255]);
    const settings=window.luma.defaultColorBalanceAdjustment();settings.midtones.red=50;
    const expected=adjustChromatic(source,settings),pending=processor.chromatic(source,settings);
    settings.midtones.red=-90;source.fill(0);
    try{return{expected:Array.from(expected),actual:Array.from(await pending),retained:source.byteLength===8};}finally{processor.dispose();}
  });
  expect(result.actual).toEqual(result.expected);expect(result.retained).toBe(true);
});

test('documented chromatic scripting example executes atomically and survives portable projects',async({page})=>{
  const guide=await readFile('docs/SCRIPTING_API.md','utf8');
  const example=guide.match(/```js\n\/\/ example: chromatic-adjustments\n([\s\S]*?)```/)![1];
  const result=await page.evaluate(async source=>{
    const editor=window.luma.editor,before=editor.document.toJSON();await editor.runScript(source);
    const after=editor.document.toJSON();editor.document.undo();const undone=editor.document.toJSON();editor.document.redo();
    const project=await editor.saveProject();await editor.openProject(new File([project],'scripted.luma'));
    return{before,after,undone,reopened:editor.document.toJSON()};
  },example);
  expect(result.after.children).toHaveLength(result.before.children.length+2);expect(result.undone).toEqual(result.before);expect(result.reopened).toEqual(result.after);
});

test('chromatic workspace checkpoints retain current and redo-only parameters after reload',async({page})=>{
  const saved=await page.evaluate(async()=>{
    const {editor,AdjustmentLayer,defaultColorBalanceAdjustment}=window.luma;
    const balance=defaultColorBalanceAdjustment();balance.midtones.red=18;
    editor.document.layers.add(new AdjustmentLayer({adjustment:balance}));
    const layer=editor.document.layers.add(new AdjustmentLayer({adjustment:{kind:'vibrance',vibrance:30,saturation:4}}));
    layer.adjustment={kind:'vibrance',vibrance:70,saturation:-11};editor.document.undo();
    const version=await editor.saveWorkspaceVersion('Chromatic history');
    return{version,document:editor.document.toJSON(),past:editor.document.getSnapshot().past.map(x=>x.label),future:editor.document.getSnapshot().future.map(x=>x.label)};
  });
  await page.reload();
  const restored=await page.evaluate(async version=>{
    const editor=window.luma.editor;await editor.restoreWorkspace(version);
    const doc=editor.document,before=doc.toJSON(),past=doc.getSnapshot().past.map(x=>x.label),future=doc.getSnapshot().future.map(x=>x.label);
    doc.redo();const adjustment=(doc.layers.at(2) as import('../src/dom').AdjustmentLayer).adjustment;
    const result=await editor.renderer.render(doc.getSnapshot().document,editor.assetStore,{cache:false,readback:true});
    const pixel=Array.from(result.getContext('2d')!.getImageData(4,4,1,1).data);result.width=result.height=0;
    return{before,past,future,adjustment,pixel};
  },saved.version);
  expect(restored.before).toEqual(saved.document);expect(restored.past).toEqual(saved.past);expect(restored.future).toEqual(saved.future);
  expect(restored.adjustment).toEqual({kind:'vibrance',vibrance:70,saturation:-11});expect(restored.pixel[3]).toBe(255);
});
