import {expect,test} from '@playwright/test';

test('retiring viewport caches preserves a pending independent textured-mask read',async({page},info)=>{
 await page.goto('/');await page.evaluate(()=>document.fonts.ready.then(()=>undefined));
 const result=await page.evaluate(async()=>{
  const {editor,LayerMask,BrushStroke,BrushTexture}=window.luma,{CanvasRenderer}=await import(/* @vite-ignore */String('/src/engine/renderer.ts'));
  const source=new OffscreenCanvas(8,8),context=source.getContext('2d')!;context.fillStyle='#fff';context.fillRect(0,0,4,8);context.fillStyle='#ffffff66';context.fillRect(4,0,4,8);
  const asset=await editor.assetStore.add(await source.convertToBlob(),'Retirement texture','texture-retirement',false),mask=new LayerMask({base:1,feather:2}).paint(new BrushStroke({points:[{x:31,y:29}],size:43,pressureSize:false,texture:new BrushTexture({assetId:asset.id,channel:'alpha'})}),'hide').toJSON(),space={x:0,y:0,width:64,height:64,sx:1,sy:1},renderer=new CanvasRenderer();await renderer.processor.ready;
  let enter!:()=>void,unblock!:()=>void,blocked=true;const entered=new Promise<void>(resolve=>enter=resolve),gate=new Promise<void>(resolve=>unblock=resolve),convert=renderer.processor.brushTexture.bind(renderer.processor);renderer.processor.brushTexture=async(...args:Parameters<typeof convert>)=>{const pixels=await convert(...args);if(blocked){enter();await gate;}return pixels;};
  let output:HTMLCanvasElement|undefined,reference:HTMLCanvasElement|undefined,error='';
  try{
   const pending=renderer.renderMaskCoverage(mask,space,0,0,'independent-texture',true,undefined,editor.assetStore);await entered;renderer.clearCache();blocked=false;unblock();try{output=await pending;}catch(cause){error=String(cause);}
   reference=await renderer.renderMaskCoverage(mask,space,0,0,'reference',false,undefined,editor.assetStore);
   if(!reference)throw new Error('Missing fresh mask reference.');let difference=0,edited=false;if(output){const a=output.getContext('2d')!.getImageData(0,0,64,64).data,b=reference.getContext('2d')!.getImageData(0,0,64,64).data;for(let i=0;i<a.length;i++){difference=Math.max(difference,Math.abs(a[i]-b[i]));if(i%4===3&&a[i]<255)edited=true;}}
   return{error,difference,edited,sourceAlive:asset.bitmap.width===8};
  }finally{unblock();if(output)output.width=output.height=0;if(reference)reference.width=reference.height=0;renderer.dispose();}
 });await info.attach('independent-textured-mask',{body:JSON.stringify(result),contentType:'application/json'});expect(result).toEqual({error:'',difference:0,edited:true,sourceAlive:true});
});

test('retired texture conversions cannot repopulate or displace the next viewport cache',async({page},info)=>{
 await page.goto('/');
 const result=await page.evaluate(async()=>{
  const {editor}=window.luma,{BrushTextureSampler}=await import(/* @vite-ignore */String('/src/engine/brush-texture.ts'));
  const source=new OffscreenCanvas(8,8);source.getContext('2d')!.fillRect(0,0,8,8);const asset=await editor.assetStore.add(await source.convertToBlob(),'Retired conversion','texture-retired-conversion',false);
  let enter!:()=>void,unblock!:()=>void,blocked=true;const entered=new Promise<void>(resolve=>enter=resolve),gate=new Promise<void>(resolve=>unblock=resolve),sampler=new BrushTextureSampler({brushTexture:async(...args:Parameters<typeof editor.renderer.processor.brushTexture>)=>{const pixels=await editor.renderer.processor.brushTexture(...args);if(blocked){enter();await gate;}return pixels;}});
  const outputs:HTMLCanvasElement[]=[];
  try{
   const pending=sampler.prepare(editor.assetStore,{assetId:asset.id,channel:'alpha'},{width:8,height:8});await entered;sampler.retireCache();const retiredBytes=sampler.byteLength;blocked=false;
   outputs.push(await sampler.prepare(editor.assetStore,{assetId:asset.id,channel:'alpha'},{width:16,height:16}));const nextBytes=sampler.byteLength;unblock();outputs.push(await pending);const afterBytes=sampler.byteLength;
   return{retiredBytes,nextBytes,afterBytes,opaque:outputs.every(c=>c.getContext('2d')!.getImageData(0,0,c.width,c.height).data.every((v,i)=>i%4!==3||v===255)),sourceAlive:asset.bitmap.width===8};
  }finally{unblock();outputs.forEach(c=>c.width=c.height=0);sampler.dispose();}
 });await info.attach('retired-texture-cache',{body:JSON.stringify(result),contentType:'application/json'});expect(result.retiredBytes).toBe(0);expect(result.nextBytes).toBeGreaterThan(0);expect(result.afterBytes).toBe(result.nextBytes);expect(result).toMatchObject({opaque:true,sourceAlive:true});
});
