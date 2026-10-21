import {expect,test} from '@playwright/test';

test('saturated texture coverage matches independent native source-over at byte thresholds, whole and incremental',async({page},info)=>{
 await page.goto('/');const rows=await page.evaluate(async()=>{
  const {editor,PencilStroke}=window.luma,{TexturedStrokeRaster}=await import(/* @vite-ignore */String('/src/engine/textured-stroke.ts'));
  const make=()=>{const c=document.createElement('canvas');c.width=320;c.height=64;return c;},rows=[];
  for(const value of [{alpha:255,flow:1,color:'#ffffff'},{alpha:85,flow:.3,color:'#ffffff'},{alpha:85,flow:.1,color:'#000000'},{alpha:170,flow:.3,color:'#ff0000'},{alpha:85,flow:.3,color:'#cc2244'},{alpha:85,flow:1,color:'#ffffff',pressure:'all'},{alpha:85,flow:1,color:'#ffffff',pressure:'varying'}]){
   const source=new OffscreenCanvas(4,4),s=source.getContext('2d')!,image=s.createImageData(4,4);for(let i=0;i<16;i++)image.data.set([0,0,0,value.alpha],i*4);s.putImageData(image,0,0);const asset=await editor.assetStore.add(await source.convertToBlob(),'Threshold texture',undefined,false),points=Array.from({length:21},(_,i)=>({x:36+i*12,y:32,pressure:'pressure'in value&&value.pressure==='varying'?(i<=10?1-i*.05:.5+(i-10)*.05):1})),stroke=new PencilStroke({points,size:512,color:value.color,flow:value.flow,pressureSize:false,pressureOpacity:'pressure'in value}).toJSON(),texture={assetId:asset.id,channel:'alpha' as const},space={x:0,y:0,width:320,height:64,sx:1,sy:1};
   const full=make(),active=make(),reference=make(),mask=make(),rasters=[new TexturedStrokeRaster(editor.renderer.processor),new TexturedStrokeRaster(editor.renderer.processor)];let crop:HTMLCanvasElement|undefined;
   try{
    await rasters[0].draw(stroke,texture,editor.assetStore,full,space);
    await rasters[1].draw({...stroke,points:stroke.points.slice(0,'pressure'in value&&value.pressure==='varying'?1:11)},texture,editor.assetStore,active,space);active.getContext('2d')!.clearRect(0,0,320,64);await rasters[1].draw(stroke,texture,editor.assetStore,active,space);
    // Independent native image projection, conversion and premultiplied
    // source-over. Explicit 1-pixel pencil spacing does not share replay code.
    const c=mask.getContext('2d')!,out=reference.getContext('2d')!,uniform=c.createImageData(320,64);uniform.data.fill(255);
    for(let x=36;x<=276;x++){
     // A uniform source under an integer, axis-aligned rectangle has
     // exactly these bytes. Native tint and source-over remain independent.
     for(let y=0;y<64;y++)for(let px=0;px<320;px++)uniform.data[(y*320+px)*4+3]=px>=x-256&&px<x+256?value.alpha:0;
     c.putImageData(uniform,0,0);
     c.globalCompositeOperation='source-in';c.fillStyle=value.color;c.fillRect(0,0,320,64);const segment=Math.max(0,Math.floor((x-37)/12)),step=x===36?0:(x-36-segment*12),pressure=x===36?points[0].pressure:points[segment].pressure+(points[segment+1].pressure-points[segment].pressure)*step/12;out.globalAlpha=value.flow*pressure;out.drawImage(mask,0,0);
    }
    const expected=out.getImageData(0,0,320,64).data;let difference=0;for(const canvas of [full,active]){const actual=canvas.getContext('2d')!.getImageData(0,0,320,64).data;for(let i=0;i<actual.length;i++)difference=Math.max(difference,Math.abs(actual[i]-expected[i]));}
    crop=document.createElement('canvas');crop.width=144;crop.height=64;const cropped=new TexturedStrokeRaster(editor.renderer.processor);try{await cropped.draw(stroke,texture,editor.assetStore,crop,{...space,x:176,width:144});}finally{cropped.dispose();}
    const actual=crop.getContext('2d')!.getImageData(0,0,144,64).data;for(let y=0;y<64;y++)for(let x=0;x<144;x++)for(let k=0;k<4;k++)difference=Math.max(difference,Math.abs(actual[(y*144+x)*4+k]-expected[(y*320+176+x)*4+k]));
    rows.push({...value,difference,from:rasters[1].lastReplay.from,centerAlpha:expected[(32*320+128)*4+3],sourceAlive:asset.bitmap.width===4});
   }finally{rasters.forEach(r=>r.dispose());for(const c of [full,active,reference,mask,crop])if(c)c.width=c.height=0;}
  }return rows;
 });await info.attach('native-saturated-texture-reference',{body:JSON.stringify(rows),contentType:'application/json'});for(const row of rows){expect(row.difference,JSON.stringify(row)).toBe(0);expect(row.from).toBe('pressure'in row&&row.pressure==='varying'?1:11);expect(row.centerAlpha).toBeGreaterThan(0);expect(row.sourceAlive).toBe(true);}
});

test('a fully saturated texture prefix still yields and cancels without publishing or corrupting retry',async({page},info)=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const {editor,PencilStroke}=window.luma,{TexturedStrokeRaster}=await import(/* @vite-ignore */String('/src/engine/textured-stroke.ts'));
  const source=new OffscreenCanvas(1,1);source.getContext('2d')!.fillRect(0,0,1,1);const asset=await editor.assetStore.add(await source.convertToBlob(),'Opaque saturation',undefined,false),raster=new TexturedStrokeRaster(editor.renderer.processor),fresh=new TexturedStrokeRaster(editor.renderer.processor),texture={assetId:asset.id,channel:'alpha' as const},space={x:0,y:0,width:64,height:64,sx:1,sy:1};
  const make=()=>{const c=document.createElement('canvas');c.width=c.height=64;return c;},target=make(),reference=make(),first=new PencilStroke({points:[{x:32,y:32}],size:2048,color:'#ffffff',pressureSize:false}).toJSON();
  try{
   await raster.draw(first,texture,editor.assetStore,target,space);const retained=raster.retainedBytes;target.getContext('2d')!.fillStyle='#ff0000';target.getContext('2d')!.fillRect(0,0,64,64);
   let cancelled=false,finished=false,during=false;const started=performance.now(),pending=raster.draw({...first,points:Array.from({length:20000},()=>first.points[0])},texture,editor.assetStore,target,space,undefined,{isCancelled:()=>cancelled}),input=new Promise<number>(resolve=>setTimeout(()=>{during=!finished;cancelled=true;resolve(performance.now()-started);},0));
   let error='';try{await pending;}catch(cause){error=String(cause);}finally{finished=true;}const inputMs=await input,cancelMs=performance.now()-started-inputMs,untouched=target.getContext('2d')!.getImageData(0,0,64,64).data.every((v,i)=>v===(i%4===0||i%4===3?255:0)),kept=raster.retainedBytes===retained;
   cancelled=false;target.getContext('2d')!.clearRect(0,0,64,64);const next={...first,points:Array.from({length:3},()=>first.points[0])};await raster.draw(next,texture,editor.assetStore,target,space);await fresh.draw(next,texture,editor.assetStore,reference,space);
   const a=target.getContext('2d')!.getImageData(0,0,64,64).data,b=reference.getContext('2d')!.getImageData(0,0,64,64).data;let difference=0;for(let i=0;i<a.length;i++)difference=Math.max(difference,Math.abs(a[i]-b[i]));return{during,error,inputMs,cancelMs,untouched,kept,difference,from:raster.lastReplay.from};
  }finally{raster.dispose();fresh.dispose();target.width=target.height=reference.width=reference.height=0;}
 });await info.attach('saturated-texture-cancellation',{body:JSON.stringify(result),contentType:'application/json'});expect(result).toMatchObject({during:true,error:'Error: Textured stroke replay was cancelled.',untouched:true,kept:true,difference:0,from:1});expect(result.inputMs).toBeLessThanOrEqual(250);expect(result.cancelMs).toBeLessThanOrEqual(250);
});

test('partial texture accumulation matches cold pixels for every binary pigment and native shape at fractional scales',async({page},info)=>{
 await page.goto('/');const rows=await page.evaluate(async()=>{
  const {editor,BrushStroke,PencilStroke,AffineTransform}=window.luma,{TexturedStrokeRaster}=await import(/* @vite-ignore */String('/src/engine/textured-stroke.ts'));
  const source=new OffscreenCanvas(8,8),s=source.getContext('2d')!,image=s.createImageData(8,8);
  for(let i=0;i<64;i++)image.data.set([(i*31)%256,(i*17)%256,(i*47)%256,[0,1,85,170,255][i%5]],i*4);s.putImageData(image,0,0);
  const asset=await editor.assetStore.add(await source.convertToBlob(),'Partial accumulation',undefined,false),rows=[];
  for(const [index,color]of ['#000000','#ffffff','#ff0000','#00ff00','#0000ff','#ffff00','#00ffff','#ff00ff'].entries())for(const scale of [1,.83]){
   const points=Array.from({length:5},(_,i)=>({x:32+i*12,y:64,pressure:1})),stroke=new(index%2?PencilStroke:BrushStroke)({points,size:512,color,hardness:index%3===0?1:.4,flow:1,pressureSize:false}).toJSON(),texture={assetId:asset.id,channel:index%2?'luminance' as const:'alpha' as const,invert:index%3===0},world=index>=4?new AffineTransform(1,.11,-.17,.94,3.25,-2.5):new AffineTransform(),space={x:0,y:0,width:320,height:128,sx:scale,sy:scale},rasters=[new TexturedStrokeRaster(editor.renderer.processor),new TexturedStrokeRaster(editor.renderer.processor)],canvases=rasters.map(()=>{const c=document.createElement('canvas');c.width=320;c.height=128;return c;});
   try{
    await rasters[0].draw(stroke,texture,editor.assetStore,canvases[0],space,world);
    for(let n=1;n<=points.length;n++){canvases[1].getContext('2d')!.clearRect(0,0,320,128);await rasters[1].draw({...stroke,points:points.slice(0,n)},texture,editor.assetStore,canvases[1],space,world);}
    const a=canvases[0].getContext('2d')!.getImageData(0,0,320,128).data,b=canvases[1].getContext('2d')!.getImageData(0,0,320,128).data;let difference=0;for(let i=0;i<a.length;i++)difference=Math.max(difference,Math.abs(a[i]-b[i]));rows.push({color,scale,difference,from:rasters[1].lastReplay.from,nonempty:a.some((v,i)=>i%4===3&&v>0)});
   }finally{rasters.forEach(r=>r.dispose());canvases.forEach(c=>c.width=c.height=0);}
  }return rows;
 });await info.attach('partial-accumulation-pigments',{body:JSON.stringify(rows),contentType:'application/json'});for(const row of rows){expect(row.difference,JSON.stringify(row)).toBe(0);expect(row.from).toBe(4);expect(row.nonempty).toBe(true);}
});
