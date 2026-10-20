import {test,expect} from '@playwright/test';
test.use({launchOptions:{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,args:['--enable-gpu','--enable-unsafe-webgpu','--use-angle=vulkan','--enable-features=Vulkan','--use-vulkan=swiftshader','--use-webgpu-adapter=swiftshader','--disable-vulkan-surface']}});

test('Linear Light/Burn WGSL preserves source-over alpha, masks, opacity and the distinct paint-clear operation',async({page})=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const {WebGpuRenderer}=await import(/* @vite-ignore */String('/src/engine/gpu/renderer.ts')),{CanvasRenderer}=await import(/* @vite-ignore */String('/src/engine/renderer.ts'));
  const {editor,Document,RasterLayer,PaintLayer,PaintFill,LayerMask,MarqueeSelection,AdjustmentLayer,RedEyeAdjustment}=window.luma,reference=new CanvasRenderer(),gpu=new WebGpuRenderer(reference,{allowSoftwareAdapter:true});await gpu.ready;
  const colors=[[220,24,64],[31,180,240],[255,0,127],[127,128,129],[0,0,0],[255,255,255]],ids=[];
  for(const phase of [0,1]){
   const canvas=document.createElement('canvas');canvas.width=30;canvas.height=5;const c=canvas.getContext('2d')!,image=c.createImageData(30,5);
   for(let y=0;y<5;y++)for(let x=0;x<30;x++)image.data.set([...colors[(x+phase)%colors.length],[0,1,64,128,255][(y+phase)%5]],(y*30+x)*4);
   c.putImageData(image,0,0);const blob=await new Promise<Blob>(r=>canvas.toBlob(v=>r(v!)));ids.push((await editor.assetStore.add(blob,'Blend test',undefined,false)).id);canvas.width=canvas.height=0;
  }
  const doc=new Document({width:30,height:5});doc.layers.add(new RasterLayer({assetId:ids[0],width:30,height:5}));const top=doc.layers.add(new RasterLayer({assetId:ids[1],width:30,height:5})),results:{label:string;rgb:number;alpha:number}[]=[];
  const compare=async(label:string)=>{const frame=await gpu.prepare(doc.getSnapshot().document,editor.assetStore);if(!frame)throw new Error(JSON.stringify(gpu.diagnostics));const actual=await frame.readPixels();frame.dispose();const canvas=await reference.render(doc.toJSON(),editor.assetStore,{cache:false,readback:true});try{const expected=canvas.getContext('2d')!.getImageData(0,0,30,5).data;let rgb=0,alpha=0;for(let p=0;p<actual.length;p+=4){alpha=Math.max(alpha,Math.abs(actual[p+3]-expected[p+3]));for(let c=0;c<3;c++)rgb=Math.max(rgb,Math.abs(actual[p+c]-Math.round(expected[p+c]*expected[p+3]/255)));}results.push({label,rgb,alpha});}finally{canvas.width=canvas.height=0;}};
  try{
   for(const mode of ['linear-light','linear-burn'] as const)for(const opacity of [0,.5,1])for(const masked of [false,true]){top.blendMode=mode;top.opacity=opacity;top.mask=masked?new LayerMask({selection:new MarqueeSelection({shape:'rectangle',x:4,y:0,width:20,height:5}),density:.7}):null;await compare(`${mode}/${opacity}/${masked}`);}
   top.remove();
   const paint=doc.layers.add(new PaintLayer());paint.strokes.add(new PaintFill({bounds:{x:0,y:0,width:30,height:5},color:'#dca020'}));paint.strokes.add(new PaintFill({bounds:{x:8,y:0,width:12,height:5},erase:true,opacity:.5}));await compare('paint-clear');
   paint.remove();const adjustment=doc.layers.add(new AdjustmentLayer({adjustment:new RedEyeAdjustment({threshold:0,strength:50})}));
   for(const mode of ['linear-light','linear-burn'] as const){adjustment.blendMode=mode;adjustment.opacity=.5;await compare(`adjustment/${mode}`);}
  }finally{gpu.dispose();reference.dispose();}return results;
 });console.log('Actual Linear Light/Burn WGSL:',JSON.stringify(result));expect(result).toHaveLength(15);for(const row of result){expect(row.rgb,JSON.stringify(row)).toBeLessThanOrEqual(2);expect(row.alpha,JSON.stringify(row)).toBeLessThanOrEqual(1);}
});
