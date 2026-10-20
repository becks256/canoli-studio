import {test,expect} from '@playwright/test';

test.use({launchOptions:{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,args:['--enable-gpu','--enable-unsafe-webgpu','--use-angle=vulkan','--enable-features=Vulkan','--use-vulkan=swiftshader','--use-webgpu-adapter=swiftshader','--disable-vulkan-surface']}});

test('real WGSL uses transformed wet mask coverage, reuses it and invalidates it after undo',async({page},info)=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const {editor,PaintLayer,PaintFill,LayerMask,PencilStroke,WetPaintStroke,AffineTransform}=window.luma;
  const {AdaptiveRenderer}=await import(/* @vite-ignore */ String('/src/engine/adaptive.ts')),{encodeRgbaPng}=await import(/* @vite-ignore */ String('/src/engine/png.ts'));
  editor.newDocument({width:64,height:64});const layer=editor.document.layers.add(new PaintLayer());layer.strokes.add(new PaintFill({bounds:{x:0,y:0,width:64,height:64},color:'#0000ff'}));
  layer.mask=new LayerMask({base:1,inverted:true,density:.8,feather:3,x:3,y:4,basis:new AffineTransform(1.2,.2,.25,1),linked:false});
  const add=async(alpha:number)=>(await editor.assetStore.add(await encodeRgbaPng(new Uint8Array([255,255,255,alpha]),1,1),'Native coverage',undefined,false)).id;
  const output=await add(64),support=await add(255);layer.mask=layer.mask!.applyWetPaint(new WetPaintStroke({brush:new PencilStroke({points:[{x:16,y:16}]}),nativeTransform:new AffineTransform(16,0,0,12,16,16),tiles:[{x:0,y:0,width:1,height:1,assetId:output,coverage:{assetId:support}}]}));
  const renderer=new AdaptiveRenderer({allowSoftwareAdapter:true}),observations=[];
  try{
   for(const phase of ['cold','warm','undo'] as const){
    if(phase==='undo')editor.document.undo();
    const state=editor.document.getSnapshot().document,reference=await renderer.render(state,editor.assetStore,{cache:false});
    try{
     const expected=reference.getContext('2d')!.getImageData(0,0,64,64).data,frame=await renderer.prepareViewport(state,editor.assetStore);
     try{
      if(!frame.readPixels)throw new Error('Expected actual WGSL composition');
      const actual=await frame.readPixels();let maximum=0,varied=0;
      for(let at=0;at<actual.length;at+=4){for(let c=0;c<4;c++){const value=c===3?expected[at+3]:Math.round(expected[at+c]*expected[at+3]/255);maximum=Math.max(maximum,Math.abs(actual[at+c]-value));}if(actual[at+3]!==actual[3])varied++;}
      observations.push({phase,backend:frame.backend,maximum,varied,cacheHits:renderer.gpu.diagnostics.cacheHits});
     }finally{frame.dispose();}
    }finally{reference.width=reference.height=0;}
   }
  }finally{renderer.dispose();}
  return observations;
 });
 for(const observation of result){expect(observation.backend).toBe('webgpu');expect(observation.maximum).toBeLessThanOrEqual(1);}
 expect(result[0].varied).toBeGreaterThan(100);expect(result[1].varied).toBe(result[0].varied);expect(result[1].cacheHits).toBeGreaterThan(result[0].cacheHits);expect(result[2].varied).toBe(0);
 await info.attach('wet-mask-software-wgsl-parity',{body:JSON.stringify(result),contentType:'application/json'});
});
