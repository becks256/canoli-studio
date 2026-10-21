import {expect,test}from '@playwright/test';

test('extreme bitmap masks and source rasters retain their complete geometry, fractional edges and alpha',async({page},info)=>{
 await page.goto('/');const rows=await page.evaluate(async()=>{
  const {editor,Document,RasterLayer,AffineTransform}=window.luma,{bitmapMask}=await import(/* @vite-ignore */String('/src/engine/drawing.ts')),{CanvasRenderer}=await import(/* @vite-ignore */String('/src/engine/renderer.ts'));
  const rows=[];
  for(const alpha of [1,64,128,255]){
   const source=new OffscreenCanvas(1,1),c=source.getContext('2d')!,image=c.createImageData(1,1);image.data.set([255,0,0,alpha]);c.putImageData(image,0,0);const asset=await editor.assetStore.add(await source.convertToBlob(),'Extreme source',undefined,false);
   for(const scale of [128,1e9,1e12])for(const edge of [.25,.5,.75])for(const mirrored of [false,true]){
    const matrix=new AffineTransform(mirrored?-scale:scale,0,0,mirrored?-scale:scale,(mirrored?scale:-scale)+4+edge,mirrored?scale-16:-16),space={x:0,y:0,width:32,height:32,sx:1,sy:1},mask=await bitmapMask(asset.bitmap,space,0,0,matrix),document=new Document({width:32,height:32});const layer=document.layers.add(new RasterLayer({assetId:asset.id,width:1,height:1}));layer.transform=matrix;const renderer=new CanvasRenderer();await renderer.processor.ready;
    try{const raster=await renderer.render(document.toJSON(),editor.assetStore,{cache:false,readback:true});try{const read=(canvas:HTMLCanvasElement)=>[...canvas.getContext('2d')!.getImageData(2,17,5,1).data].filter((_,i)=>i%4===3),expected=mirrored?[0,0,edge<.5?alpha:0,alpha,alpha]:[alpha,alpha,edge<.5?0:alpha,0,0];rows.push({alpha,scale,edge,mirrored,mask:read(mask),raster:read(raster),expected});}finally{raster.width=raster.height=0;}}finally{renderer.dispose();mask.width=mask.height=0;}
   }
  }return rows;
 });await info.attach('extreme-bitmap-native-pixels',{body:JSON.stringify(rows),contentType:'application/json'});expect(rows).toHaveLength(72);for(const row of rows){expect(row.mask,JSON.stringify(row)).toEqual(row.expected);expect(row.raster,JSON.stringify(row)).toEqual(row.expected);}
});

test('extreme affine bitmap edges retain the exact area of a sheared rectangle across cropped regions',async({page},info)=>{
 await page.goto('/');const rows=await page.evaluate(async()=>{
  const {editor,AffineTransform}=window.luma,{projectBitmapPixels}=await import(/* @vite-ignore */String('/src/engine/bitmap-projection.ts'));const source=new OffscreenCanvas(1,1);source.getContext('2d')!.fillRect(0,0,1,1);const asset=await editor.assetStore.add(await source.convertToBlob(),'Sheared source',undefined,false),rows=[];
  for(const scale of [1e9,1e12]){
   const matrix=new AffineTransform(scale,0,scale,scale,-scale-15.75,-16),full=await projectBitmapPixels(asset.bitmap,matrix,{x:0,y:0,width:32,height:32}),part=await projectBitmapPixels(asset.bitmap,matrix,{x:13,y:7,width:17,height:19});let max=0,crop=0;
   for(let y=0;y<32;y++)for(let x=0;x<32;x++){const alpha=x<y?255:x===y?183:x===y+1?8:0;max=Math.max(max,Math.abs(full.data[(y*32+x)*4+3]-alpha));}
   for(let y=0;y<19;y++)for(let x=0;x<17;x++)for(let k=0;k<4;k++)crop=Math.max(crop,Math.abs(part.data[(y*17+x)*4+k]-full.data[((y+7)*32+x+13)*4+k]));rows.push({scale,max,crop});
  }return rows;
 });await info.attach('extreme-affine-area-oracle',{body:JSON.stringify(rows),contentType:'application/json'});for(const row of rows){expect(row.max,JSON.stringify(row)).toBe(0);expect(row.crop).toBe(0);}
});

test('mixed native and precision texture batch captures agree with independent single reads without deadlock',async({page},info)=>{
 await page.goto('/');const rows=await page.evaluate(async()=>{
  const {editor,AffineTransform}=window.luma,{BrushTextureSampler}=await import(/* @vite-ignore */String('/src/engine/brush-texture.ts'));
  const source=new OffscreenCanvas(2,2),c=source.getContext('2d')!,image=c.createImageData(2,2);image.data.set([255,0,0,0,0,255,0,64,0,0,255,128,255,255,255,255]);c.putImageData(image,0,0);const asset=await editor.assetStore.add(await source.convertToBlob(),'Mixed precision source',undefined,false),rows=[];
  const inputs=[{width:32,height:32,sourceToOutput:new AffineTransform(8,0,0,8,3.25,4.5).toJSON()},{width:32,height:32,sourceToOutput:new AffineTransform(1e9,0,0,1e9,-2e9+16.75,-1e9+16.5).toJSON()},{width:32,height:32,sourceToOutput:new AffineTransform(1e12,0,1e12,1e12,-2e12-15.75,-16).toJSON()}];
  for(const channel of ['alpha','luminance']as const)for(const invert of [false,true])for(const smoothing of [false,true]){
   const sampler=new BrushTextureSampler(editor.renderer.processor,0),options={assetId:asset.id,channel,invert},samples=inputs.map(input=>({...input,smoothing}));
   try{const batch=await sampler.prepareAffineBatch(editor.assetStore,options,samples),references=await Promise.all(samples.map(sample=>sampler.prepareAffine(editor.assetStore,options,sample)));try{let max=0;for(let j=0;j<samples.length;j++){const a=batch[j].getContext('2d')!.getImageData(0,0,32,32).data,b=references[j].getContext('2d')!.getImageData(0,0,32,32).data;for(let i=0;i<a.length;i++)max=Math.max(max,Math.abs(a[i]-b[i]));}rows.push({channel,invert,smoothing,max});}finally{for(const canvas of [...batch,...references])canvas.width=canvas.height=0;}}finally{sampler.dispose();}
  }return rows;
 });await info.attach('mixed-texture-capture-barrier',{body:JSON.stringify(rows),contentType:'application/json'});expect(rows).toHaveLength(8);for(const row of rows)expect(row.max,JSON.stringify(row)).toBe(0);
});

test('precision textures retain the actual oversized brush and pencil footprint with bounded scratch',async({page},info)=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const {editor,BrushStroke,PencilStroke,PaintLayer,BrushTexture,AffineTransform}=window.luma,{drawPaint}=await import(/* @vite-ignore */String('/src/engine/drawing.ts'));
  const source=new OffscreenCanvas(1,1),c=source.getContext('2d')!,image=c.createImageData(1,1);image.data.set([255,255,255,128]);c.putImageData(image,0,0);const asset=await editor.assetStore.add(await source.convertToBlob(),'Huge tip alpha',undefined,false),rows=[];
  const native=document.createElement.bind(document),allocations:number[][]=[];document.createElement=((...args:Parameters<typeof document.createElement>)=>{const element=native(...args);if(element.tagName==='CANVAS'){const canvas=element as HTMLCanvasElement,get=canvas.getContext.bind(canvas);canvas.getContext=((...input:Parameters<typeof canvas.getContext>)=>{allocations.push([canvas.width,canvas.height]);return get(...input);})as typeof canvas.getContext;}return element;})as typeof document.createElement;
  try{for(const pencil of [false,true])for(const scale of [1e9,1e12]){
   const layer=new PaintLayer();layer.strokes.add(new(pencil?PencilStroke:BrushStroke)({points:[{x:0,y:0}],size:2048,hardness:1,flow:1,pressureSize:false,color:'#ff0000',texture:new BrushTexture({assetId:asset.id,channel:'alpha'})}));
   const target=document.createElement('canvas');target.width=target.height=32;
   try{await drawPaint(layer.toJSON(),editor.assetStore,target,{x:0,y:0,width:32,height:32,sx:1,sy:1},new AffineTransform(scale,0,0,scale,-1024*scale+4.5,0),editor.renderer.processor);rows.push({pencil,scale,alpha:[...target.getContext('2d')!.getImageData(2,16,5,1).data].filter((_,i)=>i%4===3)});}finally{target.width=target.height=0;}
  }}finally{document.createElement=native;}return{rows,maxPixels:Math.max(...allocations.map(([w,h])=>w*h))};
 });await info.attach('actual-extreme-texture-footprints',{body:JSON.stringify(result),contentType:'application/json'});expect(result.maxPixels).toBeLessThanOrEqual(4_000_000);for(const row of result.rows)expect(row.alpha,JSON.stringify(row)).toEqual([128,128,64,0,0]);
});

test('precision texture cancellation and source closure reject every private batch result',async({page},info)=>{
 await page.goto('/');const rows=await page.evaluate(async()=>{
  const {editor,AffineTransform}=window.luma,{BrushTextureSampler}=await import(/* @vite-ignore */String('/src/engine/brush-texture.ts'));const rows=[];
  for(const action of ['cancel','close','replace']as const){
   const surface=new OffscreenCanvas(2,2);surface.getContext('2d')!.fillRect(0,0,2,2);const blob=await surface.convertToBlob(),asset=await editor.assetStore.add(blob,action,undefined,false),sampler=new BrushTextureSampler(editor.renderer.processor,0),abort=new AbortController(),controller={signal:abort.signal};
   const input={width:512,height:512,sourceToOutput:new AffineTransform(1e9,0,0,1e9,-1e9,-1e9).toJSON()};let error='',published=0;
   const pending=sampler.prepareAffineBatch(editor.assetStore,{assetId:asset.id,channel:'alpha'},[input,input],controller).then((canvases:HTMLCanvasElement[])=>{published=canvases.length;for(const canvas of canvases)canvas.width=canvas.height=0;},(cause:Error)=>{error=String(cause);});
   if(action==='cancel')abort.abort();else if(action==='close')asset.bitmap.close();else asset.bitmap=await createImageBitmap(blob);
   await pending;rows.push({action,error,published,bytes:sampler.byteLength});sampler.dispose();
  }return rows;
 });await info.attach('precision-batch-cancel-source-lifetime',{body:JSON.stringify(rows),contentType:'application/json'});for(const row of rows){expect(row.error,JSON.stringify(row)).not.toBe('');expect(row.published).toBe(0);expect(row.bytes).toBe(0);}
});

test('precision filtering reconstructs native premultiplied bytes before channel conversion',async({page},info)=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const {editor,AffineTransform}=window.luma,{BrushTextureSampler}=await import(/* @vite-ignore */String('/src/engine/brush-texture.ts'));
  const source=new OffscreenCanvas(2,2),c=source.getContext('2d')!,image=c.createImageData(2,2);image.data.set([230,21,91,13,17,216,63,97,83,58,207,171,194,157,18,241]);c.putImageData(image,0,0);const asset=await editor.assetStore.add(await source.convertToBlob(),'Premultiplied corners',undefined,false),native=new OffscreenCanvas(2,2),ctx=native.getContext('2d')!;ctx.drawImage(asset.bitmap,0,0);const original=[...ctx.getImageData(0,0,2,2).data],rows=[];
  for(const smoothing of [false,true])for(const channel of ['alpha','luminance']as const)for(const invert of [false,true]){
   const sampler=new BrushTextureSampler(editor.renderer.processor,0);try{const output=await sampler.prepareAffine(editor.assetStore,{assetId:asset.id,channel,invert},{width:1,height:1,smoothing,sourceToOutput:new AffineTransform(1e9,0,0,1e9,-750000000+.5,-750000000+.5).toJSON()});try{rows.push({smoothing,channel,invert,alpha:output.getContext('2d')!.getImageData(0,0,1,1).data[3]});}finally{output.width=output.height=0;}}finally{sampler.dispose();}
  }return{original,rows};
 });await info.attach('precision-native-byte-oracle',{body:JSON.stringify(result),contentType:'application/json'});
 for(const row of result.rows){
  const weights=row.smoothing?[9/16,3/16,3/16,1/16]:[1,0,0,0],source=result.original;
  const alpha=Math.round(weights.reduce((sum,w,i)=>sum+w*source[i*4+3],0));
  const rgb=[0,1,2].map(c=>{const premul=Math.round(weights.reduce((sum,w,i)=>sum+w*Math.round(source[i*4+c]*source[i*4+3]/255),0));return alpha?Math.round(Math.min(alpha,premul)*255/alpha):0;});
  const luminance=rgb[0]*2126+rgb[1]*7152+rgb[2]*722;
  const expected=row.channel==='alpha'?(row.invert?255-alpha:alpha):Math.floor((alpha*(row.invert?luminance:2550000-luminance)+1275000)/2550000);
  expect(row.alpha,JSON.stringify(row)).toBe(expected);
 }
});


test('clearing numerical captures stops new work while cache retirement preserves independent reads',async({page},info)=>{
 await page.goto('/');const rows=await page.evaluate(async()=>{
  const {editor,AffineTransform}=window.luma,{BrushTextureSampler}=await import(/* @vite-ignore */String('/src/engine/brush-texture.ts'));const source=new OffscreenCanvas(1,1);source.getContext('2d')!.fillRect(0,0,1,1);const asset=await editor.assetStore.add(await source.convertToBlob(),'Capture lifetime',undefined,false),rows=[];
  for(const action of ['clear','dispose','retireCache']as const){
   const sampler=new BrushTextureSampler(editor.renderer.processor,0);let probes=0,published=0,error='';
   const pending=sampler.prepareAffineBatch(editor.assetStore,{assetId:asset.id,channel:'alpha'},[{width:512,height:512,sourceToOutput:new AffineTransform(1e9,0,0,1e9,-1e8,-1e8).toJSON()}],{isCancelled:()=>{probes++;return false;}}).then((canvases:HTMLCanvasElement[])=>{published=canvases.length;for(const canvas of canvases)canvas.width=canvas.height=0;},(cause:Error)=>{error=String(cause);});
   await new Promise(resolve=>setTimeout(resolve,0));const before=probes;sampler[action]();await pending;rows.push({action,before,after:probes,published,error});sampler.dispose();
  }return rows;
 });await info.attach('numerical-capture-retirement-controls',{body:JSON.stringify(rows),contentType:'application/json'});for(const row of rows){expect(row.before).toBeGreaterThan(0);if(row.action==='retireCache'){expect(row.error).toBe('');expect(row.published).toBe(1);expect(row.after).toBeGreaterThan(row.before);}else{expect(row.error).toContain('cleared or disposed');expect(row.published).toBe(0);expect(row.after).toBe(row.before);}}
});

test('a full numerical texture batch yields before capturing all samples and preserves every byte',async({page},info)=>{
 test.setTimeout(120000);await page.goto('/');const result=await page.evaluate(async()=>{
  const {editor,AffineTransform}=window.luma,{BrushTextureSampler}=await import(/* @vite-ignore */String('/src/engine/brush-texture.ts'));const source=new OffscreenCanvas(1,1);source.getContext('2d')!.fillRect(0,0,1,1);const asset=await editor.assetStore.add(await source.convertToBlob(),'Full capture batch',undefined,false),sampler=new BrushTextureSampler(editor.renderer.processor,0);
  const native=CanvasRenderingContext2D.prototype.getImageData;let sourceReads=0,beforeTimer=-1;
  CanvasRenderingContext2D.prototype.getImageData=function(...args:Parameters<typeof native>){if(this.canvas.width===64&&this.canvas.height===64&&args[0]===0&&args[1]===0&&args[2]===1&&args[3]===1)sourceReads++;return native.apply(this,args);};
  const timer=new Promise<void>(resolve=>setTimeout(()=>{beforeTimer=sourceReads;resolve();},0));
  try{
   const outputs=await sampler.prepareAffineBatch(editor.assetStore,{assetId:asset.id,channel:'alpha'},Array.from({length:64},(_,index)=>({width:125,height:125,sourceToOutput:new AffineTransform(1e9,0,0,1e9,-1e8-index,-1e8).toJSON()})));
   try{await timer;let errors=0;for(const canvas of outputs){const pixels=canvas.getContext('2d')!.getImageData(0,0,125,125).data;for(let i=0;i<pixels.length;i++)errors+=Number(pixels[i]!==255);}return{beforeTimer,sourceReads,count:outputs.length,errors};}finally{for(const canvas of outputs)canvas.width=canvas.height=0;}
  }finally{CanvasRenderingContext2D.prototype.getImageData=native;sampler.dispose();}
 });await info.attach('full-numerical-batch-ui-yield',{body:JSON.stringify(result),contentType:'application/json'});expect(result.count).toBe(64);expect(result.sourceReads).toBe(64);expect(result.beforeTimer).toBeGreaterThanOrEqual(0);expect(result.beforeTimer).toBeLessThan(64);expect(result.errors).toBe(0);
});

test('mutable native canvases are captured once and private bitmaps close after success or cancellation',async({page},info)=>{
 await page.goto('/');const rows=await page.evaluate(async()=>{
  const {AffineTransform}=window.luma,{projectBitmapPixels}=await import(/* @vite-ignore */String('/src/engine/bitmap-projection.ts')),native=createImageBitmap,rows=[];
  for(const cancel of [false,true]){
   const source=document.createElement('canvas');source.width=source.height=2;const c=source.getContext('2d')!;c.fillStyle='#ff0000';c.fillRect(0,0,2,2);let captures=0,closes=0,error='';const abort=new AbortController();
   window.createImageBitmap=(async(...args:Parameters<typeof native>)=>{captures++;const bitmap=await native(...args),close=bitmap.close.bind(bitmap);bitmap.close=()=>{closes++;close();};return bitmap;})as typeof native;
   const pending=projectBitmapPixels(source,new AffineTransform(1e9,0,0,1e9,-1e9,-1e9),{x:0,y:0,width:64,height:64},false,{signal:abort.signal}).then((image:ImageData)=>image,(cause:Error)=>{error=String(cause);return null;});
   c.fillStyle='#0000ff';c.fillRect(0,0,2,2);if(cancel)abort.abort();const image=await pending;rows.push({cancel,captures,closes,error,pixel:image?[...image.data.slice(0,4)]:null});window.createImageBitmap=native;source.width=source.height=0;
  }return rows;
 });await info.attach('mutable-native-capture-ownership',{body:JSON.stringify(rows),contentType:'application/json'});for(const row of rows){expect(row.captures).toBe(1);expect(row.closes).toBe(1);if(row.cancel){expect(row.error).not.toBe('');expect(row.pixel).toBe(null);}else{expect(row.error).toBe('');expect(row.pixel).toEqual([255,0,0,255]);}}
});

test('cancelling mixed ordinary and numerical captures never starts a late worker conversion',async({page},info)=>{
 await page.goto('/');const rows=await page.evaluate(async()=>{
  const {editor,AffineTransform}=window.luma,{BrushTextureSampler}=await import(/* @vite-ignore */String('/src/engine/brush-texture.ts'));const source=new OffscreenCanvas(1,1);source.getContext('2d')!.fillRect(0,0,1,1);const asset=await editor.assetStore.add(await source.convertToBlob(),'Mixed capture lifetime',undefined,false),rows=[];
  for(const action of ['clear','dispose','retireCache']as const){
   let workerCalls=0,published=0,error='';const sampler=new BrushTextureSampler({brushTexture:(...args:Parameters<typeof editor.renderer.processor.brushTexture>)=>{workerCalls++;return editor.renderer.processor.brushTexture(...args);}},0);
   const pending=sampler.prepareAffineBatch(editor.assetStore,{assetId:asset.id,channel:'alpha'},[{width:32,height:32,sourceToOutput:new AffineTransform(32,0,0,32).toJSON()},{width:512,height:512,sourceToOutput:new AffineTransform(1e9,0,0,1e9,-1e8,-1e8).toJSON()}]).then((outputs:HTMLCanvasElement[])=>{published=outputs.length;for(const canvas of outputs)canvas.width=canvas.height=0;},(cause:Error)=>{error=String(cause);});
   await new Promise(resolve=>setTimeout(resolve,0));sampler[action]();await pending;rows.push({action,workerCalls,published,error});sampler.dispose();
  }return rows;
 });await info.attach('mixed-capture-worker-cancellation',{body:JSON.stringify(rows),contentType:'application/json'});for(const row of rows){if(row.action==='retireCache'){expect(row.workerCalls).toBe(1);expect(row.published).toBe(2);expect(row.error).toBe('');}else{expect(row.workerCalls).toBe(0);expect(row.published).toBe(0);expect(row.error).toContain('cleared or disposed');}}
});
