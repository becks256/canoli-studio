import {test,expect} from '@playwright/test';

 test.use({launchOptions:{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,args:['--enable-gpu','--enable-unsafe-webgpu','--use-angle=vulkan','--enable-features=Vulkan','--use-vulkan=swiftshader','--use-webgpu-adapter=swiftshader','--disable-vulkan-surface']}});
 test('renders real nonlinear pressure in WebGPU without losing size or alpha',async({page})=>{
  await page.goto('/');const results=await page.evaluate(async()=>{
   const {Document,PaintLayer,BrushStroke,PressureCurve,editor}=window.luma,{AdaptiveRenderer}=await import(/* @vite-ignore */String('/src/engine/adaptive.ts')),renderer=new AdaptiveRenderer({allowSoftwareAdapter:true}),results=[];
   try{for(const mode of ['linear','soft','firm'] as const){const doc=new Document({width:64,height:64}),layer=doc.layers.add(new PaintLayer());layer.strokes.add(new BrushStroke({points:[{x:20,y:20,pressure:.5}],size:40,hardness:1,color:'#ff0000',pressureOpacity:true,pressureCurve:PressureCurve[mode]()}));const frame=await renderer.prepareViewport(doc.getSnapshot().document,editor.assetStore);
    try{if(!frame.readPixels)throw new Error('Missing actual GPU readback');const bytes=await frame.readPixels();results.push({mode,backend:frame.backend,samples:[20,28,35].map(x=>[...bytes.slice((20*64+x)*4,(20*64+x)*4+4)])});}finally{frame.dispose();}
   }return results;}finally{renderer.dispose();}
  });for(const result of results){expect(result.backend).toBe('webgpu');const alpha=result.mode==='soft'?191:result.mode==='firm'?64:128;expect(Math.abs(result.samples[0][3]-alpha)).toBeLessThanOrEqual(1);expect(Math.abs(result.samples[0][0]-alpha)).toBeLessThanOrEqual(1);expect(result.samples[1][3]).toBe(result.mode==='firm'?0:result.samples[0][3]);expect(result.samples[2]).toEqual([0,0,0,0]);}
 });


test('explicit zero pressure stays empty in real WGSL while mixed subpixel pressure selects reference coverage',async({page})=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const {Document,PaintLayer,BrushStroke,PencilStroke,EraserStroke,PaintFill,PressureCurve,editor}=window.luma,{AdaptiveRenderer}=await import(/* @vite-ignore */String('/src/engine/adaptive.ts')),renderer=new AdaptiveRenderer({allowSoftwareAdapter:true}),checks=[];
  try{
   for(const kind of ['brush','pencil','eraser'])for(const [pressureSize,pressureOpacity] of [[true,false],[false,true],[true,true]]){
    const doc=new Document({width:64,height:64}),layer=doc.layers.add(new PaintLayer());layer.strokes.add(new PaintFill({bounds:{x:0,y:0,width:64,height:64},color:'#ff0000'}));
    const options={points:[{x:20,y:20,pressure:0}],size:40,hardness:1,color:'#0000ff',pressureCurve:PressureCurve.linear(),pressureSize,pressureOpacity};layer.strokes.add(kind==='pencil'?new PencilStroke(options):kind==='eraser'?new EraserStroke(options):new BrushStroke(options));
    const frame=await renderer.prepareViewport(doc.getSnapshot().document,editor.assetStore);try{if(!frame.readPixels)throw new Error('Missing WGSL zero-response frame');const bytes=await frame.readPixels();checks.push({kind,backend:frame.backend,unchanged:bytes.length===64*64*4&&bytes.every((value:number,i:number)=>value===(i%4===0||i%4===3?255:0))});}finally{frame.dispose();}
   }
   const doc=new Document({width:64,height:64}),layer=doc.layers.add(new PaintLayer());layer.strokes.add(new BrushStroke({points:[{x:20,y:20,pressure:0},{x:40,y:20,pressure:1}],size:40,color:'#0000ff',pressureCurve:PressureCurve.linear()}));const frame=await renderer.prepareViewport(doc.getSnapshot().document,editor.assetStore),canvas=document.createElement('canvas');try{frame.present(canvas);return{checks,mixedBackend:frame.backend,nonempty:canvas.getContext('2d')!.getImageData(40,20,1,1).data[3]>0};}finally{frame.dispose();canvas.width=canvas.height=0;}
  }finally{renderer.dispose();}
 });expect(result.checks).toHaveLength(9);expect(result.checks.every(check=>check.backend==='webgpu'&&check.unchanged)).toBe(true);expect(result.mixedBackend).toBe('canvas2d');expect(result.nonempty).toBe(true);
});
