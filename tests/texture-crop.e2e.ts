import {test,expect} from '@playwright/test';

test('textured raw ink preserves whole, incremental and cropped pixels at native and fractional zoom',async({page},info)=>{
 await page.goto('/');
 const rows=await page.evaluate(async()=>{
  const {editor,BrushStroke,PencilStroke,EraserStroke,BrushTip,BrushSymmetry,AffineTransform}=window.luma;
  const {TexturedStrokeRaster}=await import(/* @vite-ignore */String('/src/engine/textured-stroke.ts'));
  const source=new OffscreenCanvas(16,12),c=source.getContext('2d')!,image=c.createImageData(16,12);
  for(let y=0;y<12;y++)for(let x=0;x<16;x++)image.data.set([(31*x+7*y)%256,(43*x+9*y)%256,(17*x+13*y)%256,[0,85,170,255][(x+y)%4]],(y*16+x)*4);
  c.putImageData(image,0,0);const asset=await editor.assetStore.add(await source.convertToBlob(),'Crop texture','texture-crop-pattern',false),rows=[];
  const delta=(a:Uint8ClampedArray,b:Uint8ClampedArray)=>{let d=0;for(let i=0;i<a.length;i++)d=Math.max(d,Math.abs(a[i]-b[i]));return d;};
  for(const variant of ['brush-alpha','brush-alpha-inverted','brush-luminance-inverted','pencil-alpha','eraser-alpha','tip-symmetry'])for(const scale of [1,.83,Math.PI/4]){
   const options={points:[{x:250,y:10,pressure:.2},{x:270,y:90,pressure:.8},{x:510,y:180,pressure:.4},{x:770,y:300,pressure:1}],size:61,color:'#5544ee',hardness:.4,flow:.6,opacity:.65,tip:new BrushTip({roundness:.4,angle:27}),...(variant==='tip-symmetry'?{symmetry:BrushSymmetry.bothAxes({x:512,y:192})}:{})};
   const stroke=new(variant.startsWith('pencil')?PencilStroke:variant.startsWith('eraser')?EraserStroke:BrushStroke)(options).toJSON(),texture={assetId:asset.id,channel:variant.includes('luminance')?'luminance' as const:'alpha' as const,invert:variant.includes('inverted')};
   const world=variant==='tip-symmetry'?new AffineTransform(.93,.17,-.09,1.04,3.25,1.5):new AffineTransform();
   const read=async(x:number,y:number,width:number,height:number,incremental=false)=>{
    const target=document.createElement('canvas');target.width=width;target.height=height;const raster=new TexturedStrokeRaster(editor.renderer.processor),space={x:x/scale,y:y/scale,width,height,sx:scale,sy:scale};
    try{
     if(incremental){await raster.draw({...stroke,points:stroke.points.slice(0,2)},texture,editor.assetStore,target,space,world);target.getContext('2d')!.clearRect(0,0,width,height);}
     await raster.draw(stroke,texture,editor.assetStore,target,space,world);
     return{pixels:target.getContext('2d')!.getImageData(0,0,width,height).data,from:raster.lastReplay.from};
    }finally{raster.dispose();target.width=target.height=0;}
   };
   const full=await read(0,0,1080,440),active=await read(0,0,1080,440,true);let difference=delta(full.pixels,active.pixels);
   for(const crop of [{x:254,y:2,width:260,height:130},{x:510,y:126,width:516,height:260}]){
    const part=await read(crop.x,crop.y,crop.width,crop.height),expected=new Uint8ClampedArray(part.pixels.length);
    for(let y=0;y<crop.height;y++)expected.set(full.pixels.subarray(((y+crop.y)*1080+crop.x)*4,((y+crop.y)*1080+crop.x+crop.width)*4),y*crop.width*4);
    difference=Math.max(difference,delta(part.pixels,expected));
   }
   rows.push({variant,scale,difference,from:active.from,nonempty:full.pixels.some((v,i)=>i%4===3&&v>0)});
  }
  return rows;
 });
 await info.attach('texture-crop-matrix',{body:JSON.stringify(rows),contentType:'application/json'});
 expect(rows.every(row=>row.difference===0&&row.from===2&&row.nonempty),JSON.stringify(rows)).toBe(true);
});

test('oversized textured footprints keep original geometry and bounded native sampling across crops',async({page},info)=>{
 await page.goto('/');
 const rows=await page.evaluate(async()=>{
  const {editor,BrushStroke,PencilStroke,BrushTip,AffineTransform}=window.luma,{TexturedStrokeRaster}=await import(/* @vite-ignore */String('/src/engine/textured-stroke.ts'));
  const source=new OffscreenCanvas(8,8),c=source.getContext('2d')!,image=c.createImageData(8,8);for(let i=0;i<64;i++)image.data.set([255,255,255,[64,128,192,255][i%4]],i*4);c.putImageData(image,0,0);
  const asset=await editor.assetStore.add(await source.convertToBlob(),'Large crop texture','texture-large-crop',false),rows=[];
  for(const scale of [1,.83,Math.PI/4])for(const kind of ['hard','soft','pencil','tip']){
   const stroke=new(kind==='pencil'?PencilStroke:BrushStroke)({points:[{x:-750,y:128},{x:-740,y:129}],size:2048,pressureSize:false,color:'#cc2244',flow:.7,hardness:kind==='hard'?1:.4,...(kind==='tip'?{tip:new BrushTip({roundness:.6,angle:12})}:{})}).toJSON(),world=new AffineTransform(2,0,0,2),sizes:number[][]=[];
   const processor={brushTexture:async(...args:Parameters<typeof editor.renderer.processor.brushTexture>)=>{sizes.push([args[0].length]);return editor.renderer.processor.brushTexture(...args);}};
   const read=async(region:{x:number;y:number;width:number;height:number},active=false)=>{const target=document.createElement('canvas');target.width=region.width;target.height=region.height;const raster=new TexturedStrokeRaster(processor);
    try{if(active){await raster.draw({...stroke,points:stroke.points.slice(0,1)},{assetId:asset.id,channel:'alpha'},editor.assetStore,target,{...region,x:region.x/scale,y:region.y/scale,sx:scale,sy:scale},world);target.getContext('2d')!.clearRect(0,0,region.width,region.height);}
     await raster.draw(stroke,{assetId:asset.id,channel:'alpha'},editor.assetStore,target,{...region,x:region.x/scale,y:region.y/scale,sx:scale,sy:scale},world);return target.getContext('2d')!.getImageData(0,0,region.width,region.height).data;
    }finally{raster.dispose();target.width=target.height=0;}};
   const full=await read({x:0,y:0,width:1080,height:440}),active=await read({x:0,y:0,width:1080,height:440},true);let difference=0,activeDifference=0,alphaDifference=0;const crops:unknown[]=[];
   for(let i=0;i<full.length;i++)activeDifference=Math.max(activeDifference,Math.abs(full[i]-active[i]));difference=activeDifference;
   for(const crop of [{x:254,y:62,width:260,height:130},{x:510,y:254,width:516,height:130}]){const part=await read(crop);let cropDifference=0,changed=0,first:unknown=null;for(let y=0;y<crop.height;y++)for(let x=0;x<crop.width;x++)for(let k=0;k<4;k++){const a=(y*crop.width+x)*4,b=((crop.y+y)*1080+crop.x+x)*4,d=Math.abs(part[a+k]-full[b+k]);cropDifference=Math.max(cropDifference,d);if(k===3)alphaDifference=Math.max(alphaDifference,d);if(d){changed++;first??={x:x+crop.x,y:y+crop.y,part:[...part.subarray(a,a+4)],full:[...full.subarray(b,b+4)]};}}difference=Math.max(difference,cropDifference);crops.push({crop,cropDifference,changed,first});}
   rows.push({kind,scale,difference,activeDifference,alphaDifference,crops,nonempty:full.some((v,i)=>i%4===3&&v>0),largestBatchPixels:Math.max(...sizes.map(v=>v[0]/4))});
  }
  return rows;
 });
 await info.attach('oversized-texture-crops',{body:JSON.stringify(rows),contentType:'application/json'});
 expect(rows.every(row=>row.difference===0&&row.nonempty&&row.largestBatchPixels<=1_000_000),JSON.stringify(rows)).toBe(true);
});
