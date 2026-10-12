import { test, expect } from '@playwright/test';

test('committed clipped strokes reuse selection coverage and match uncached pixels', async ({page}, info) => {
  await page.goto('/');
  await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
  const result = await page.evaluate(async()=>{
    const {CanvasRenderer}=await import(/* @vite-ignore */ String('/src/engine/renderer.ts'));
    const {editor,PaintLayer,BrushStroke,MarqueeSelection}=window.luma;
    editor.newDocument({width:698,height:396});
    const clip=new MarqueeSelection({shape:'rectangle',x:20,y:20,width:640,height:350});
    let layer:any;
    editor.document.transaction('Fixture',()=>{
      for(let i=0;i<5;i++)layer=editor.document.layers.add(new PaintLayer());
      for(let i=0;i<20;i++)layer.strokes.add(new BrushStroke({points:[{x:10,y:30+i*12,pressure:1},{x:680,y:30+i*12,pressure:1}],size:20,hardness:0.5,color:'#ff0000',clip}));
    });
    await document.fonts.ready;
    const renderer=new CanvasRenderer();
    let selections=0;
    const selection=renderer.processor.selection.bind(renderer.processor);
    renderer.processor.selection=(...args:any[])=>{selections++;return selection(...args);};
    const snapshot=editor.document.getSnapshot().document;
    const started=performance.now();
    const cached=await renderer.render(snapshot,editor.assetStore);
    const elapsed=performance.now()-started, cachedSelections=selections;
    layer.strokes.add(new BrushStroke({points:[{x:50,y:300,pressure:1},{x:600,y:300,pressure:1}],size:20,color:'#0000ff',clip}));
    const appendStart=performance.now();
    const appended=await renderer.render(editor.document.getSnapshot().document,editor.assetStore);
    const appendMs=performance.now()-appendStart;
    const reference=await renderer.render(editor.document.getSnapshot().document,editor.assetStore,{cache:false});
    const a=appended.getContext('2d')!.getImageData(0,0,698,396).data;
    const b=reference.getContext('2d')!.getImageData(0,0,698,396).data;
    const equal=a.every((v:number,i:number)=>v===b[i]);
    editor.document.undo();
    const undoStart=performance.now();
    const undone=await renderer.render(editor.document.getSnapshot().document,editor.assetStore);
    const undoMs=performance.now()-undoStart;
    const original=cached.getContext('2d')!.getImageData(0,0,698,396).data;
    const undoPixels=undone.getContext('2d')!.getImageData(0,0,698,396).data;
    const undoEqual=original.every((v:number,i:number)=>v===undoPixels[i]);
    undone.width=0;
    cached.width=appended.width=reference.width=0;renderer.dispose();
    return {elapsed,appendMs,undoMs,cachedSelections,equal,undoEqual};
  });
  await info.attach('committed-render',{body:JSON.stringify(result),contentType:'application/json'});
  console.log('committed render',result);
  expect(result.equal).toBe(true);
  expect(result.undoEqual).toBe(true);
  expect(result.cachedSelections).toBe(1);
});

test('raster erasure appends reuse source pixels and preserve full-render output through undo and resize',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
  const result=await page.evaluate(async()=>{
    const {CanvasRenderer}=await import(/* @vite-ignore */ String('/src/engine/renderer.ts'));
    const {editor,EraserStroke}=window.luma;
    editor.newDocument({width:64,height:64});
    const source=document.createElement('canvas');source.width=source.height=64;
    source.getContext('2d')!.fillRect(0,0,64,64);
    const blob=await new Promise<Blob>(resolve=>source.toBlob(b=>resolve(b!)));
    const layer=await editor.importImage(new File([blob],'source.png',{type:'image/png'}));
    await document.fonts.ready;
    const renderer=new CanvasRenderer();let reads=0;
    const raster=(renderer as any).raster.bind(renderer);
    (renderer as any).raster=(...args:any[])=>{reads++;return raster(...args);};
    const render=()=>renderer.render(editor.document.getSnapshot().document,editor.assetStore);
    const initial=await render();initial.width=0;
    for(let i=0;i<8;i++){
      layer.erase(new EraserStroke({points:[{x:8+i*6,y:32,pressure:1}],size:10,hardness:0.5,opacity:0.5}));
      const frame=await render();frame.width=0;
    }
    const appendReads=reads;
    const compare=async()=>{
      const cached=await render();
      const full=await renderer.render(editor.document.getSnapshot().document,editor.assetStore,{cache:false});
      const a=cached.getContext('2d')!.getImageData(0,0,64,64).data;
      const b=full.getContext('2d')!.getImageData(0,0,64,64).data;
      const equal=a.every((v:number,i:number)=>v===b[i]);cached.width=full.width=0;return equal;
    };
    const appendEqual=await compare();
    editor.document.undo();const undoEqual=await compare();
    layer.width=48;const resizeEqual=await compare();
    renderer.clearCache();const evictionEqual=await compare();
    renderer.dispose();return {appendReads,appendEqual,undoEqual,resizeEqual,evictionEqual};
  });
  expect(result).toEqual({appendReads:1,appendEqual:true,undoEqual:true,resizeEqual:true,evictionEqual:true});
});
