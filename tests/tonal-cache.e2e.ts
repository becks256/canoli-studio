import {test,expect} from '@playwright/test';

test('tonal prefixes match replay across edits, previews, undo and eviction',async({page})=>{
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const {CanvasRenderer}=await import(/* @vite-ignore */ String('/src/engine/renderer.ts'));
    const renderer=new CanvasRenderer();
    const e=window.luma.editor,{BrushStroke,TonalStroke,LayerMask,MarqueeSelection}=window.luma;
    e.newDocument({width:80,height:48});
    const canvas=new OffscreenCanvas(80,48),c=canvas.getContext('2d')!,data=c.createImageData(80,48);
    for(let p=0;p<80*48;p++)data.data.set([80+p%80,110,140,p%256],p*4);
    c.putImageData(data,0,0);await e.importImage(new File([await canvas.convertToBlob()],'alpha.png',{type:'image/png'}));
    const base=e.document.selectedLayer!;
    const layer=e.document.applyTonalSculpt([{x:15,y:20,pressure:1}],'dodge','midtones',.6,{size:18});
    let calls=0;const original=renderer.processor.dodgeBurn.bind(renderer.processor);
    renderer.processor.dodgeBurn=(...args:any[])=>{calls++;return original(...args);};
    const checks: boolean[]=[],counts:number[]=[];
    const compare=async(preview?:any)=>{
      const doc=e.document.getSnapshot().document;
      calls=0;
      const cached=await renderer.render(doc,e.assetStore,{paintPreview:preview});const count=calls;
      const replay=await renderer.render(doc,e.assetStore,{cache:false,paintPreview:preview});
      const a=cached.getContext('2d')!.getImageData(0,0,80,48).data,b=replay.getContext('2d')!.getImageData(0,0,80,48).data;
      checks.push(a.every((v:number,i:number)=>v===b[i]));counts.push(count);
      cached.width=cached.height=replay.width=replay.height=0;
    };
    await compare();await compare();
    layer.addTonalStroke(new TonalStroke({brush:new BrushStroke({points:[{x:25,y:22,pressure:.7}],size:20}),mode:'burn',range:'shadows',exposure:.3}));
    await compare();
    const preview={layerId:layer.id,stroke:new BrushStroke({points:[{x:30,y:20,pressure:1}],size:16}).toJSON(),tonal:{mode:'dodge',range:'highlights',exposure:.5}};
    await compare(preview);await compare();
    base.opacity=.5;await compare();
    base.mask=new LayerMask({selection:new MarqueeSelection({shape:'rectangle',x:0,y:0,width:40,height:48})});await compare();
    layer.x=2;await compare();e.document.undo();await compare();
    layer.mask=new LayerMask({selection:new MarqueeSelection({shape:'rectangle',x:0,y:0,width:55,height:48})});await compare();
    await compare({layerId:base.id,stroke:new window.luma.EraserStroke({points:[{x:20,y:20,pressure:1}],size:20}).toJSON()});
    renderer.clearCache();await compare();
    const strokeCount=()=>{const a=layer.adjustment;return a.kind==='tonal'?a.strokes.length:0;};
    while(strokeCount()===2)e.document.undo();
    await compare();e.document.redo();await compare();
    renderer.dispose();
    return {checks,counts};
  });
  expect(result.checks.every(Boolean)).toBe(true);
  expect(result.counts.slice(0,5)).toEqual([1,0,1,1,0]);
  expect(result.counts[5]).toBe(2);expect(result.counts[6]).toBe(2);expect(result.counts[7]).toBe(2);
  expect(result.counts[10]).toBe(2);expect(result.counts[11]).toBe(2);
  expect(result.counts.slice(-2)).toEqual([1,1]);
});

test('pixel cache preserves straight RGBA ownership and shares surface eviction',async({page})=>{
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const {CanvasCache}=await import(/* @vite-ignore */ String('/src/engine/cache.ts'));
    const cache=new CanvasCache(36),source=new Uint8ClampedArray([121,89,37,1,45,91,221,0]);
    cache.writePixels('pixels','a',source);source[0]=0;
    const read=cache.readPixels('pixels','a')!;read[1]=0;
    const preserved=[...cache.readPixels('pixels','a')!];
    const surface=document.createElement('canvas');surface.width=surface.height=2;
    cache.write('surface','b',surface);cache.readPixels('pixels','a');
    cache.writePixels('new','c',new Uint8ClampedArray(12));
    const surfaceEvicted=!cache.read('surface','b',surface),bytes=cache.byteLength;
    cache.clear();return {preserved,surfaceEvicted,bytes,cleared:cache.byteLength};
  });
  expect(result.preserved).toEqual([121,89,37,1,45,91,221,0]);expect(result.surfaceEvicted).toBe(true);
  expect(result.bytes).toBeLessThanOrEqual(36);expect(result.cleared).toBe(0);
});
