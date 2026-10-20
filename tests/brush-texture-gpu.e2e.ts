import {expect,test} from '@playwright/test';
test.use({launchOptions:{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,args:['--enable-gpu','--enable-unsafe-webgpu','--use-angle=vulkan','--enable-features=Vulkan','--use-vulkan=swiftshader','--use-webgpu-adapter=swiftshader','--disable-vulkan-surface']}});

for(const masked of [false,true])test(`actual software WebGPU ${masked?'composes native texture mask coverage':'selects complete textured paint fallback'}`,async({page})=>{
 await page.goto('/');const result=await page.evaluate(async masked=>{
  const {editor,Document,PaintLayer,PaintFill,BrushStroke,BrushTexture,LayerMask}=window.luma,{AdaptiveRenderer}=await import(/* @vite-ignore */String('/src/engine/adaptive.ts')),renderer=new AdaptiveRenderer({allowSoftwareAdapter:true});
  const c=document.createElement('canvas');c.width=c.height=8;const context=c.getContext('2d')!;context.fillRect(0,0,4,8);context.fillStyle='#ffffff';context.fillRect(4,0,4,8);const blob=await new Promise<Blob>(resolve=>c.toBlob(value=>resolve(value!)));c.width=c.height=0;const asset=await editor.assetStore.add(blob,'Half grain',undefined,false),doc=new Document({width:64,height:64}),layer=doc.layers.add(new PaintLayer());
  layer.strokes.add(new PaintFill({color:'#ff0000',bounds:{x:0,y:0,width:64,height:64}}));
  try{
   const plain=await renderer.prepareViewport(doc.getSnapshot().document,editor.assetStore),initialBackend=plain.backend;plain.dispose();
   const brush=new BrushStroke({points:[{x:32,y:32}],size:32,hardness:1,color:'#0000ff',pressureSize:false,texture:new BrushTexture({assetId:asset.id})});
   if(masked)layer.mask=new LayerMask({base:1,strokes:[{mode:'hide',stroke:brush}]});else layer.strokes.add(brush);
   const frame=await renderer.prepareViewport(doc.getSnapshot().document,editor.assetStore);try{const out=document.createElement('canvas');let bytes:Uint8Array|Uint8ClampedArray;
    if(frame.readPixels)bytes=await frame.readPixels();else{frame.present(out);bytes=out.getContext('2d')!.getImageData(0,0,64,64).data;}out.width=out.height=0;
    return{initialBackend,backend:frame.backend,samples:[[24,32],[40,32],[0,0]].map(([x,y])=>[...bytes.slice((y*64+x)*4,(y*64+x)*4+4)])};
   }finally{frame.dispose();}
  }finally{renderer.dispose();}
 },masked);expect(result.initialBackend).toBe('webgpu');expect(result.backend).toBe(masked?'webgpu':'canvas2d');expect(result.samples).toEqual(masked?[[0,0,0,0],[255,0,0,255],[255,0,0,255]]:[[0,0,255,255],[255,0,0,255],[255,0,0,255]]);
});
