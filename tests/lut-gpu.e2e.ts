import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
test.use({launchOptions:{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,args:['--enable-gpu','--enable-unsafe-webgpu','--use-angle=vulkan','--enable-features=Vulkan','--use-vulkan=swiftshader','--use-webgpu-adapter=swiftshader','--disable-vulkan-surface']}});

test('imported 1D/3D LUT WGSL agrees with WASM across interpolation, domains, masks, amounts, blending and alpha',async({page})=>{
  const sources=await Promise.all(['1d','3d'].map(value=>readFile(`tests/fixtures/lut/independent-${value}.cube`,'utf8')));
  await page.goto('/');
  const result=await page.evaluate(async sources=>{
    const {WebGpuRenderer}=await import(/* @vite-ignore */String('/src/engine/gpu/renderer.ts'));
    const {CanvasRenderer}=await import(/* @vite-ignore */String('/src/engine/renderer.ts'));
    const {editor,Document,RasterLayer,AdjustmentLayer,LayerMask,MarqueeSelection,parseCubeLut}=window.luma;
    const reference=new CanvasRenderer(),gpu=new WebGpuRenderer(reference,{allowSoftwareAdapter:true});await gpu.ready;
    const canvas=document.createElement('canvas');canvas.width=64;canvas.height=32;const c=canvas.getContext('2d')!,image=c.createImageData(64,32);
    for(let y=0;y<32;y++)for(let x=0;x<64;x++)image.data.set([(x*37+y*13)%256,(x*17+y*31)%256,(x*53+y*11)%256,[0,1,64,128,255][y%5]],(y*64+x)*4);
    c.putImageData(image,0,0);const blob=await new Promise<Blob>(resolve=>canvas.toBlob(v=>resolve(v!))),asset=await editor.assetStore.add(blob,'LUT backdrop',undefined,false);
    const doc=new Document({width:64,height:32});doc.layers.add(new RasterLayer({assetId:asset.id,width:64,height:32}));const layer=doc.layers.add(new AdjustmentLayer()),results=[];
    try{
      for(const source of sources)for(const interpolation of ['tetrahedral','trilinear'] as const)for(const amount of [0,35,100])for(const opacity of [1,.5])for(const masked of [false,true])for(const blendMode of ['normal','multiply'] as const){
        layer.adjustment={kind:'lut',lut:parseCubeLut(source),interpolation,amount};layer.opacity=opacity;layer.blendMode=blendMode;
        layer.mask=masked?new LayerMask({selection:new MarqueeSelection({shape:'rectangle',x:8,y:0,width:32,height:32}),density:.7}):null;
        const frame=await gpu.prepare(doc.getSnapshot().document,editor.assetStore);if(!frame)throw new Error(JSON.stringify(gpu.diagnostics));
        const actual=await frame.readPixels();frame.dispose();const rendered=await reference.render(doc.getSnapshot().document,editor.assetStore,{cache:false,readback:true}),expected=rendered.getContext('2d')!.getImageData(0,0,64,32).data;
        let maxDiff=0,total=0,alphaMismatch=0;
        for(let i=0;i<expected.length;i+=4){if(actual[i+3]!==expected[i+3])alphaMismatch++;for(let c=0;c<3;c++){const delta=Math.abs(actual[i+c]-Math.round(expected[i+c]*expected[i+3]/255));maxDiff=Math.max(maxDiff,delta);total+=delta;}}
        rendered.width=rendered.height=0;results.push({dimension:(layer.adjustment as any).lut.dimension,interpolation,amount,opacity,masked,blendMode,maxDiff,meanDiff:total/(expected.length/4*3),alphaMismatch});
      }
      const retained=gpu.diagnostics.retainedBytes;gpu.clearCache();return{results,retained,cleared:gpu.diagnostics.retainedBytes};
    }finally{gpu.dispose();reference.dispose();}
  },sources);
  expect(result.results).toHaveLength(96);
  for(const value of result.results){expect(value.alphaMismatch,JSON.stringify(value)).toBe(0);expect(value.maxDiff,JSON.stringify(value)).toBeLessThanOrEqual(3);expect(value.meanDiff,JSON.stringify(value)).toBeLessThan(1);}
  expect(result.retained).toBeGreaterThan(0);expect(result.cleared).toBe(0);
  console.log('LUT GPU comparison:',JSON.stringify({comparisons:result.results.length,maxPremultipliedRgbError:Math.max(...result.results.map(value=>value.maxDiff)),maxMeanRgbError:Math.max(...result.results.map(value=>value.meanDiff))}));
});

test('precision-unsafe LUT domains and extreme values use real fallback while retaining portable settings',async({page})=>{
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const {WebGpuRenderer}=await import(/* @vite-ignore */String('/src/engine/gpu/renderer.ts'));
    const {CanvasRenderer}=await import(/* @vite-ignore */String('/src/engine/renderer.ts'));
    const {editor,Document,PaintLayer,PaintFill,AdjustmentLayer}=window.luma;
    const reference=new CanvasRenderer(),gpu=new WebGpuRenderer(reference,{allowSoftwareAdapter:true});await gpu.ready;
    const doc=new Document({width:16,height:16}),paint=doc.layers.add(new PaintLayer());paint.strokes.add(new PaintFill({color:'#507896',bounds:{x:0,y:0,width:16,height:16}}));
    const layer=doc.layers.add(new AdjustmentLayer()),results=[];
    try{for(const source of ['LUT_1D_SIZE 2\nDOMAIN_MIN .1 0 0\n0 0 0\n1 1 1','LUT_1D_SIZE 2\n-1e10 0 0\n1e10 1 1']){
      layer.setLut(source);const before=doc.toJSON(),frame=await gpu.prepare(doc.getSnapshot().document,editor.assetStore);
      const canvas=await reference.render(doc.getSnapshot().document,editor.assetStore,{cache:false,readback:true});
      results.push({fallback:frame===null,unchanged:JSON.stringify(before)===JSON.stringify(doc.toJSON()),pixel:Array.from(canvas.getContext('2d')!.getImageData(0,0,1,1).data)});canvas.width=canvas.height=0;
    }}finally{gpu.dispose();reference.dispose();}return results;
  });
  expect(result).toHaveLength(2);for(const value of result){expect(value.fallback).toBe(true);expect(value.unchanged).toBe(true);expect(value.pixel[3]).toBe(255);}
});
