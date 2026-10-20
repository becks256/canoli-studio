import {test,expect} from '@playwright/test';
test.use({launchOptions:{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,args:['--enable-gpu','--enable-unsafe-webgpu','--use-angle=vulkan','--enable-features=Vulkan','--use-vulkan=swiftshader','--use-webgpu-adapter=swiftshader','--disable-vulkan-surface']}});

test('red-eye WGSL matches masked WASM at integer threshold boundaries, partial alpha, opacity and blend modes',async({page})=>{
 await page.goto('/');const results=await page.evaluate(async()=>{
  const {WebGpuRenderer}=await import(/* @vite-ignore */String('/src/engine/gpu/renderer.ts')),{CanvasRenderer}=await import(/* @vite-ignore */String('/src/engine/renderer.ts'));
  const {editor,Document,RasterLayer,AdjustmentLayer,RedEyeAdjustment,LayerMask,MarqueeSelection}=window.luma,reference=new CanvasRenderer(),gpu=new WebGpuRenderer(reference,{allowSoftwareAdapter:true});await gpu.ready;
  const canvas=document.createElement('canvas');canvas.width=32;canvas.height=5;const c=canvas.getContext('2d')!,image=c.createImageData(32,5);
  const colors=[[64,32,16],[63,32,16],[65,32,16],[255,223,200],[220,20,40],[255,255,255],[128,128,128],[32,64,16]];
  for(let y=0;y<5;y++)for(let x=0;x<32;x++)image.data.set([...colors[x%colors.length],[0,1,64,128,255][y]],(y*32+x)*4);
  c.putImageData(image,0,0);const blob=await new Promise<Blob>(resolve=>canvas.toBlob(v=>resolve(v!))),asset=await editor.assetStore.add(blob,'Red-eye boundaries',undefined,false);
  const doc=new Document({width:32,height:5});doc.layers.add(new RasterLayer({assetId:asset.id,width:32,height:5}));const layer=doc.layers.add(new AdjustmentLayer()),results=[];
  try{
   for(const threshold of [0,31.9999999,32,32.0000001,255])for(const strength of [0,50,100])for(const masked of [false,true])for(const opacity of [1,.5])for(const blendMode of ['normal','multiply'] as const){
    layer.setRedEye(new RedEyeAdjustment({threshold,strength}));layer.opacity=opacity;layer.blendMode=blendMode;layer.mask=masked?new LayerMask({selection:new MarqueeSelection({shape:'rectangle',x:4,y:0,width:20,height:5}),density:.7}):null;
    const frame=await gpu.prepare(doc.getSnapshot().document,editor.assetStore);if(!frame)throw new Error(JSON.stringify(gpu.diagnostics));const actual=await frame.readPixels();frame.dispose();
    const out=await reference.render(doc.getSnapshot().document,editor.assetStore,{cache:false,readback:true}),expected=out.getContext('2d')!.getImageData(0,0,32,5).data;let maxDiff=0,alphaMismatch=0,total=0;
    for(let i=0;i<expected.length;i+=4){if(actual[i+3]!==expected[i+3])alphaMismatch++;for(let k=0;k<3;k++){const d=Math.abs(actual[i+k]-Math.round(expected[i+k]*expected[i+3]/255));maxDiff=Math.max(maxDiff,d);total+=d;}}
    out.width=out.height=0;results.push({threshold,strength,masked,opacity,blendMode,maxDiff,alphaMismatch,meanDiff:total/(32*5*3)});
   }
  }finally{gpu.dispose();reference.dispose();}return results;
 });console.log('Red-eye WGSL comparisons:',JSON.stringify({count:results.length,maxPremultipliedRgbError:Math.max(...results.map(r=>r.maxDiff)),maxMeanRgbError:Math.max(...results.map(r=>r.meanDiff)),alphaMismatches:results.reduce((sum,r)=>sum+r.alphaMismatch,0)}));expect(results).toHaveLength(120);for(const result of results){expect(result.alphaMismatch,JSON.stringify(result)).toBe(0);expect(result.maxDiff,JSON.stringify(result)).toBeLessThanOrEqual(3);expect(result.meanDiff,JSON.stringify(result)).toBeLessThan(1);}
});
