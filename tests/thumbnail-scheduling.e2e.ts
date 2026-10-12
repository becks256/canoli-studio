import { test, expect } from '@playwright/test';

test('thumbnail refresh waits for a stroke to finish and skips unchanged layers', async ({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
  await page.evaluate(()=>{
    const {editor,PaintLayer,PaintFill}=window.luma;
    editor.newDocument({width:698,height:396});
    for(let i=0;i<5;i++){
      const layer=editor.document.layers.add(new PaintLayer({name:`Thumb ${i}`}));
      layer.strokes.add(new PaintFill({bounds:{x:0,y:0,width:300,height:200},color:'#ff0000'}));
      editor.document.selectedLayer=layer;
    }
  });
  await expect(page.locator('.pixel-thumb[src^="data:image/png"]')).toHaveCount(5);
  await page.evaluate(()=>{
    const {editor,PaintLayer,PaintFill}=window.luma;
    (window as any).thumbnailCalls=[];
    const original=editor.pixels.thumbnail.bind(editor.pixels);
    editor.pixels.thumbnail=(...args)=>{(window as any).thumbnailCalls.push(args[1]);return original(...args);};
    (editor.document.selectedLayer as InstanceType<typeof PaintLayer>).strokes.add(new PaintFill({bounds:{x:0,y:0,width:300,height:200},color:'#0000ff'}));
    editor.tools.begin('brush',{x:20,y:20},{shift:false,alt:false,pressure:1},1);
    editor.tools.move({x:100,y:30},{shift:false,alt:false,pressure:1});
  });
  // Exceeds the thumbnail debounce while keeping the gesture active.
  await page.waitForTimeout(350);
  expect(await page.evaluate(()=>(window as any).thumbnailCalls)).toEqual([]);
  await page.evaluate(()=>window.luma.editor.tools.end());
  await expect.poll(()=>page.evaluate(()=>(window as any).thumbnailCalls.length)).toBe(1);
  await expect(page.locator('.pixel-thumb[src^="data:image/png"]')).toHaveCount(5);
  await page.evaluate(()=>{
    const e=window.luma.editor;
    e.tools.begin('brush',{x:20,y:20},{shift:false,alt:false,pressure:1},1);
    e.tools.cancel();
  });
  await page.waitForTimeout(350);
  expect(await page.evaluate(()=>(window as any).thumbnailCalls.length)).toBe(1);
});

test('cached thumbnails match fresh renders after paint, erase, styles and undo', async ({page})=>{
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const {editor:e,PaintLayer,PaintFill,BrushStroke,EraserStroke,LayerStyle}=window.luma;
    const {transparencySource}=await import(/* @vite-ignore */ String('/src/raster-editing.ts'));
    const {layerBounds}=await import(/* @vite-ignore */ String('/src/core/spatial.ts'));
    e.newDocument({width:320,height:200});
    const layer=e.document.layers.add(new PaintLayer());
    layer.strokes.add(new PaintFill({bounds:{x:0,y:0,width:320,height:200},color:'#cc5533'}));
    const equal:boolean[]=[];
    const check=async()=>{
      const source=transparencySource(e.document.getSnapshot().document,layer.id);
      const bounds=layerBounds(source,layer.id)!;
      const scale=Math.min(1,64/Math.max(bounds.width,bounds.height));
      const cached=await e.pixels.thumbnail(source,layer.id);
      const fresh=await e.renderer.render(source,e.assetStore,{region:bounds,
        outputSize:{width:Math.max(1,Math.ceil(bounds.width*scale)),height:Math.max(1,Math.ceil(bounds.height*scale))},cache:false});
      equal.push(cached===fresh.toDataURL('image/png'));
      fresh.width=fresh.height=1;
    };
    await check();
    for(let i=0;i<6;i++){
      layer.strokes.add(new (i%2===1 ? EraserStroke : BrushStroke)({points:[{x:20,y:20+i*20},{x:280,y:25+i*20}],size:15,hardness:.5,opacity:.6,color:'#3388dd'}));
      await check();
    }
    layer.styles=new LayerStyle({colorOverlay:{enabled:true,color:'#55bb44',opacity:.4}});
    await check();e.document.undo();await check();e.document.undo();await check();
    layer.strokes.add(new BrushStroke({points:[{x:80,y:80}],size:30,color:'#eeeeee'}));
    await check();e.document.undo();await check();e.document.redo();await check();
    return equal;
  });
  expect(result).toHaveLength(13);
  expect(result.every(Boolean)).toBe(true);
});
