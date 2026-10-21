import {expect,test}from '@playwright/test';
test.use({launchOptions:{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,args:['--enable-gpu','--enable-unsafe-webgpu','--use-angle=vulkan','--enable-features=Vulkan','--use-vulkan=swiftshader','--use-webgpu-adapter=swiftshader','--disable-vulkan-surface']}});

test('actual WGSL composition preserves extreme raster and linked/unlinked bitmap-mask pixels',async({page},info)=>{
 await page.goto('/');const rows=await page.evaluate(async()=>{
  const {editor,Document,RasterLayer,LayerMask,AffineTransform}=window.luma,{CanvasRenderer}=await import(/* @vite-ignore */String('/src/engine/renderer.ts')),{WebGpuRenderer}=await import(/* @vite-ignore */String('/src/engine/gpu/renderer.ts'));
  const surface=new OffscreenCanvas(1,1),c=surface.getContext('2d')!,image=c.createImageData(1,1);image.data.set([255,0,0,128]);c.putImageData(image,0,0);const asset=await editor.assetStore.add(await surface.convertToBlob(),'Precision GPU source',undefined,false),reference=new CanvasRenderer(),gpu=new WebGpuRenderer(reference,{allowSoftwareAdapter:true}),rows=[];await gpu.ready;
  try{for(const scale of [1e9,1e12])for(const mask of ['none','linked','unlinked']as const){
   const doc=new Document({width:32,height:32}),layer=doc.layers.add(new RasterLayer({assetId:asset.id,width:1,height:1}));layer.transform=new AffineTransform(scale,0,0,scale,-scale+4.75,-16);if(mask!=='none')layer.mask=LayerMask.fromBitmap(asset.id,{linked:mask==='linked'});
   const frame=await gpu.prepare(doc.getSnapshot().document,editor.assetStore);if(!frame)throw new Error(JSON.stringify(gpu.diagnostics));
   try{const actual=await frame.readPixels(),canvas=await reference.render(doc.toJSON(),editor.assetStore,{cache:false,readback:true});try{const expected=canvas.getContext('2d')!.getImageData(0,0,32,32).data;let max=0,alpha=0;for(let i=0;i<actual.length;i++){const value=i%4===3?expected[i]:Math.round(expected[i]*expected[i-i%4+3]/255);max=Math.max(max,Math.abs(actual[i]-value));if(i%4===3)alpha=Math.max(alpha,Math.abs(actual[i]-value));}rows.push({scale,mask,max,alpha,nonempty:actual.some((v:number,i:number)=>i%4===3&&v>0)});}finally{canvas.width=canvas.height=0;}}finally{frame.dispose();}
  }}finally{gpu.dispose();reference.dispose();}return rows;
 });await info.attach('extreme-projection-wgsl-reference',{body:JSON.stringify(rows),contentType:'application/json'});expect(rows).toHaveLength(6);for(const row of rows){expect(row.nonempty,JSON.stringify(row)).toBe(true);expect(row.max).toBeLessThanOrEqual(1);expect(row.alpha).toBeLessThanOrEqual(1);}
});
