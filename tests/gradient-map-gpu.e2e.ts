import {test,expect} from '@playwright/test';
test.use({launchOptions:{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,args:['--enable-gpu','--enable-unsafe-webgpu','--use-angle=vulkan','--enable-features=Vulkan','--use-vulkan=swiftshader','--use-webgpu-adapter=swiftshader','--disable-vulkan-surface']}});

test('Gradient Map WGSL agrees with masked WASM output across reversal, stop counts, blending and alpha',async({page})=>{
  await page.goto('/');
  const results=await page.evaluate(async()=>{
    const {WebGpuRenderer}=await import(/* @vite-ignore */String('/src/engine/gpu/renderer.ts'));
    const {CanvasRenderer}=await import(/* @vite-ignore */String('/src/engine/renderer.ts'));
    const {editor,Document,RasterLayer,AdjustmentLayer,LayerMask,MarqueeSelection,defaultGradientMapAdjustment}=window.luma;
    const reference=new CanvasRenderer(),gpu=new WebGpuRenderer(reference,{allowSoftwareAdapter:true});
    await gpu.ready;
    const canvas=document.createElement('canvas');canvas.width=64;canvas.height=32;
    const c=canvas.getContext('2d')!,image=c.createImageData(64,32);
    for(let y=0;y<32;y++)for(let x=0;x<64;x++){
      const i=(y*64+x)*4;image.data.set([(x*37+y*13)%256,(x*17+y*31)%256,(x*53+y*11)%256,[0,64,128,255][y%4]],i);
    }
    c.putImageData(image,0,0);const blob=await new Promise<Blob>(resolve=>canvas.toBlob(v=>resolve(v!)));
    const asset=await editor.assetStore.add(blob,'chromatic-backdrop',undefined,false);
    const doc=new Document({width:64,height:32});doc.layers.add(new RasterLayer({assetId:asset.id,width:64,height:32}));
    const layer=doc.layers.add(new AdjustmentLayer());
    const colors={kind:'gradient-map' as const,reverse:false,stops:[{position:.1,color:'#ff0000'},{position:.45,color:'#ffaa22'},{position:.9,color:'#0000ff'}]};
    const many={kind:'gradient-map' as const,reverse:false,stops:Array.from({length:32},(_,i)=>({position:i/31,color:i%2?'#fac28a':'#194e73'}))};
    const results=[];
    try{
      for(const adjustment of [defaultGradientMapAdjustment(),colors,{...colors,reverse:true},many])for(const opacity of [1,.5])for(const masked of [false,true]){
        layer.adjustment=adjustment;layer.opacity=opacity;layer.blendMode=masked?'multiply':'normal';
        layer.mask=masked?new LayerMask({selection:new MarqueeSelection({shape:'rectangle',x:8,y:0,width:32,height:32}),density:.7}):null;
        const frame=await gpu.prepare(doc.getSnapshot().document,editor.assetStore);
        if(!frame)throw new Error(JSON.stringify(gpu.diagnostics));
        const actual=await frame.readPixels();frame.dispose();
        const result=await reference.render(doc.getSnapshot().document,editor.assetStore,{cache:false,readback:true});
        const expected=result.getContext('2d')!.getImageData(0,0,64,32).data;
        let maxDiff=0,alphaMismatch=0,total=0;
        for(let i=0;i<expected.length;i+=4){
          if(actual[i+3]!==expected[i+3])alphaMismatch++;
          for(let channel=0;channel<3;channel++){
            const delta=Math.abs(actual[i+channel]-Math.round(expected[i+channel]*expected[i+3]/255));
            maxDiff=Math.max(maxDiff,delta);total+=delta;
          }
        }
        result.width=result.height=0;
        results.push({stops:adjustment.stops.length,reverse:adjustment.reverse,opacity,masked,maxDiff,meanDiff:total/(expected.length/4*3),alphaMismatch});
      }
    }finally{gpu.dispose();reference.dispose();}
    return results;
  });
  expect(results).toHaveLength(16);
  for(const result of results){expect(result.alphaMismatch,JSON.stringify(result)).toBe(0);expect(result.maxDiff,JSON.stringify(result)).toBeLessThanOrEqual(3);expect(result.meanDiff,JSON.stringify(result)).toBeLessThan(1);}
});

test('float32-collapsed gradient stops use the real Canvas/WASM fallback without losing settings',async({page})=>{
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const {AdaptiveRenderer}=await import(/* @vite-ignore */String('/src/engine/adaptive.ts'));
    const {Document,PaintLayer,PaintFill,AdjustmentLayer,editor}=window.luma;
    const renderer=new AdaptiveRenderer({allowSoftwareAdapter:true});
    const ready=await renderer.gpu.ready,doc=new Document({width:8,height:8});
    const paint=doc.layers.add(new PaintLayer());paint.strokes.add(new PaintFill({bounds:{x:0,y:0,width:8,height:8},color:'#808080'}));
    const settings={kind:'gradient-map' as const,reverse:false,stops:[{position:0,color:'#000000'},{position:.5,color:'#ff0000'},{position:.5000000001,color:'#0000ff'},{position:1,color:'#ffffff'}]};
    const layer=doc.layers.add(new AdjustmentLayer({adjustment:settings}));
    try{
      const frame=await renderer.prepareViewport(doc.getSnapshot().document,editor.assetStore);
      const canvas=document.createElement('canvas');frame.present(canvas);const pixel=Array.from(canvas.getContext('2d')!.getImageData(4,4,1,1).data);
      const backend=frame.backend;frame.dispose();return{ready,backend,pixel,settings:layer.adjustment};
    }finally{renderer.dispose();}
  });
  expect(result.ready).toBe(true);expect(result.backend).toBe('canvas2d');expect(result.pixel).toEqual([1,1,255,255]);
  expect((result.settings as any).stops[2].position).toBe(.5000000001);
});
