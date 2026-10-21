import {expect,test} from '@playwright/test';

test('wide native Linear Light and Burn strips equal one whole-image WASM reference',async({page},info)=>{
 await page.goto('/');const rows=await page.evaluate(async()=>{
  const {editor,Document,RasterLayer}=window.luma,{CanvasRenderer}=await import(/* @vite-ignore */String('/src/engine/renderer.ts'));
  const width=2052,height=68,ids:string[]=[],rows=[];
  for(const phase of [0,1]){const surface=new OffscreenCanvas(width,height),c=surface.getContext('2d')!,image=c.createImageData(width,height);
   for(let y=0;y<height;y++)for(let x=0;x<width;x++)image.data.set([(31*x+7*y+phase*13)%256,(9*x+43*y+phase*71)%256,(17*x+11*y+phase*39)%256,[0,1,64,128,255][(x+y+phase)%5]],(y*width+x)*4);
   c.putImageData(image,0,0);ids.push((await editor.assetStore.add(await surface.convertToBlob(),'Wide blend source',undefined,false)).id);
  }
  const renderer:import('../src/engine/renderer').CanvasRenderer=new CanvasRenderer();await renderer.processor.ready;
  const read=async(data:import('../src/core/model').DocumentData)=>{const surface=await renderer.render(data,editor.assetStore,{cache:false,readback:true});try{return surface.getContext('2d')!.getImageData(0,0,width,height).data;}finally{surface.width=surface.height=0;}};
  try{
   const planes=[];for(const assetId of ids){const doc=new Document({width,height});doc.layers.add(new RasterLayer({assetId,width,height}));planes.push(await read(doc.toJSON()));}
   const doc=new Document({width,height});doc.layers.add(new RasterLayer({assetId:ids[0],width,height}));const top=doc.layers.add(new RasterLayer({assetId:ids[1],width,height})),blend=renderer.processor.linearBlend.bind(renderer.processor);
   for(const mode of ['linear-light','linear-burn']as const)for(const opacity of [0,.2,.53,1]){
    top.blendMode=mode;top.opacity=opacity;const reference=await blend(planes[1],planes[0],opacity,mode),surface=new OffscreenCanvas(width,height),c=surface.getContext('2d')!,image=c.createImageData(width,height);image.data.set(reference);c.putImageData(image,0,0);const expected=c.getImageData(0,0,width,height).data;
    let calls=0,pixels=0;renderer.processor.linearBlend=async(...args:Parameters<typeof blend>)=>{calls++;pixels+=args[0].length/4;return blend(...args);};
    const actual=await read(doc.toJSON());let max=0,changed=0;for(let i=0;i<actual.length;i++){const delta=Math.abs(actual[i]-expected[i]);max=Math.max(max,delta);changed+=Number(delta>0);}rows.push({mode,opacity,max,changed,calls,pixels});
   }
  }finally{renderer.dispose();}return rows;
 });await info.attach('wide-native-blend-reference',{body:JSON.stringify(rows),contentType:'application/json'});expect(rows).toHaveLength(8);for(const row of rows){expect(row.max,JSON.stringify(row)).toBe(0);expect(row.changed).toBe(0);expect(row.calls).toBe(row.opacity===0?0:1);expect(row.pixels).toBe(row.opacity===0?0:2052*68);}
});


test('cancelling a wide blend rejects before publishing or starting the next job',async({page})=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const {editor,Document,RasterLayer}=window.luma,{CanvasRenderer}=await import(/* @vite-ignore */String('/src/engine/renderer.ts'));
  const surface=new OffscreenCanvas(4096,512);surface.getContext('2d')!.fillRect(0,0,4096,512);const asset=await editor.assetStore.add(await surface.convertToBlob(),'Cancellation source',undefined,false),doc=new Document({width:4096,height:512});
  doc.layers.add(new RasterLayer({assetId:asset.id,width:4096,height:512}));doc.layers.add(new RasterLayer({assetId:asset.id,width:4096,height:512,blendMode:'linear-light'}));
  const before=JSON.stringify(doc.toJSON()),renderer:import('../src/engine/renderer').CanvasRenderer=new CanvasRenderer();await renderer.processor.ready;let cancelled=false,calls=0,maxPixels=0,error='',errorName='';const blend=renderer.processor.linearBlend.bind(renderer.processor);
  renderer.processor.linearBlend=async(...args:Parameters<typeof blend>)=>{calls++;maxPixels=Math.max(maxPixels,args[0].length/4);const pixels=await blend(...args);cancelled=true;return pixels;};
  try{const output=await renderer.render(doc.toJSON(),editor.assetStore,{cache:false,readback:true,isCancelled:()=>cancelled});output.width=output.height=0;}catch(cause){error=String(cause);errorName=(cause as Error).name;}finally{renderer.dispose();}
  return{calls,maxPixels,error,errorName,unchanged:JSON.stringify(doc.toJSON())===before};
 });expect(result.calls).toBe(1);expect(result.maxPixels).toBeLessThanOrEqual(1024*1024);expect(result.errorName).toBe('AbortError');expect(result.error).toBe('AbortError: Render superseded.');expect(result.unchanged).toBe(true);
});
