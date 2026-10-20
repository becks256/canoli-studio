import {test,expect} from '@playwright/test';

test('oversized native brush footprints remain exact across crops, masks and active replay',async({page})=>{
 await page.goto('/');
 const rows=await page.evaluate(async()=>{
  const {editor,BrushStroke,PencilStroke,BrushTip,PaintLayer,PaintFill,AffineTransform}=window.luma;
  const {drawPaint,drawMaskStroke,ActiveStrokeRaster}=await import(/* @vite-ignore */String('/src/engine/drawing.ts'));
  const results=[];
  for(const kind of ['hard','soft','pencil','tip']){
   const options={points:[{x:-750,y:128}],size:2048,pressureSize:false,color:'#cc2244',flow:.7,opacity:.6,hardness:kind==='hard'?1:.4,...(kind==='tip'?{tip:new BrushTip({roundness:.5,angle:27})}:{})};
   const stroke=(kind==='pencil'?new PencilStroke(options):new BrushStroke(options)).toJSON();
   const layer=new PaintLayer();layer.strokes.add(new PaintFill({bounds:{x:-10,y:-10,width:600,height:300},color:'#00cc66',opacity:.4}));layer.strokes.add(kind==='pencil'?new PencilStroke(options):new BrushStroke(options));
   const world=new AffineTransform(2,0,0,2);
   for(const mask of [false,true]){
    const read=async(region:{x:number;y:number;width:number;height:number},active=false)=>{
     const canvas=document.createElement('canvas');canvas.width=region.width;canvas.height=region.height;
     const cache=active?new ActiveStrokeRaster():undefined,c=canvas.getContext('2d')!;
     try{
      if(mask){c.fillStyle='#fff';c.fillRect(0,0,canvas.width,canvas.height);await drawMaskStroke({stroke,mode:'hide'},canvas,{...region,sx:1,sy:1},0,0,editor.renderer.processor,cache,world);}
      else await drawPaint(layer.toJSON(),editor.assetStore,canvas,{...region,sx:1,sy:1},world,editor.renderer.processor,cache);
      return c.getImageData(0,0,canvas.width,canvas.height).data;
     }finally{cache?.clear();canvas.width=canvas.height=0;}
    };
    const region={x:0,y:0,width:1080,height:440},full=await read(region),active=await read(region,true);
    let delta=0;for(let i=0;i<full.length;i++)delta=Math.max(delta,Math.abs(full[i]-active[i]));
    for(const crop of [{x:254,y:62,width:260,height:130},{x:510,y:254,width:516,height:130}]){
     const pixels=await read(crop);for(let y=0;y<crop.height;y++)for(let x=0;x<crop.width;x++)for(let c=0;c<4;c++)delta=Math.max(delta,Math.abs(pixels[(y*crop.width+x)*4+c]-full[((crop.y+y)*1080+crop.x+x)*4+c]));
    }
    results.push({kind,mask,delta,edited:mask?full.some((v:number,i:number)=>i%4===3&&v<255):full.some((v:number,i:number)=>i%4===0&&v>0)});
   }
  }
  return results;
 });
 expect(rows.every(row=>row.delta===0&&row.edited),JSON.stringify(rows)).toBe(true);
});

test('working buffers do not limit extremely enlarged footprint geometry and retain analytic quarter-pixel edges',async({page})=>{
 await page.goto('/');
 const rows=await page.evaluate(async()=>{
  const {editor,BrushStroke,PencilStroke,PaintLayer,AffineTransform}=window.luma;
  const {drawPaint}=await import(/* @vite-ignore */String('/src/engine/drawing.ts'));
  const result=[];
  for(const pencil of [false,true]){
   const layer=new PaintLayer(),options={points:[{x:0,y:0}],size:2048,hardness:1,pressureSize:false,color:'#ff0000'};
   layer.strokes.add(pencil?new PencilStroke(options):new BrushStroke(options));
   const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;
   try{await drawPaint(layer.toJSON(),editor.assetStore,canvas,{x:-4,y:-16,width:32,height:32,sx:1,sy:1},new AffineTransform(1e9,0,0,1e9,-1.024e12+.25,.5),editor.renderer.processor);
    result.push({pencil,samples:[3,4,5].map(x=>[...canvas.getContext('2d')!.getImageData(x,16,1,1).data])});
   }finally{canvas.width=canvas.height=0;}
  }
  return result;
 });
 expect(rows.map(row=>row.samples)).toEqual(Array.from({length:2},()=>[[255,0,0,255],[255,0,0,64],[0,0,0,0]]));
});

test('clearing or superseding a yielded brush preview cannot publish or corrupt the next gesture',async({page})=>{
 await page.goto('/');
 const result=await page.evaluate(async()=>{
  const {BrushStroke,AffineTransform}=window.luma,{ActiveStrokeRaster}=await import(/* @vite-ignore */String('/src/engine/drawing.ts'));
  const active=new ActiveStrokeRaster(),a=document.createElement('canvas'),b=document.createElement('canvas');a.width=b.width=320;a.height=b.height=180;
  const space={x:0,y:0,width:320,height:180,sx:1,sy:1},big=new BrushStroke({points:[{x:0,y:0}],size:2048,hardness:.4,pressureSize:false,color:'#ff0000'}).toJSON();
  const small=new BrushStroke({points:[{x:12.5,y:12.5}],size:8,hardness:1,color:'#00ff00'}).toJSON();
  try{
   const work=active.draw(big,a,space,0,0,new AffineTransform(2,0,0,2));
   const yielded=work instanceof Promise;
   await active.draw(small,b,space,0,0);
   const before=[...b.getContext('2d')!.getImageData(0,0,b.width,b.height).data];
   let error='';try{await work;}catch(e){error=String(e);}
   const after=[...b.getContext('2d')!.getImageData(0,0,b.width,b.height).data];
   return{yielded,error,oldEmpty:![...a.getContext('2d')!.getImageData(0,0,a.width,a.height).data].some(v=>v>0),nextStable:JSON.stringify(before)===JSON.stringify(after),nextCenter:[...b.getContext('2d')!.getImageData(12,12,1,1).data]};
  }finally{active.clear();a.width=a.height=b.width=b.height=0;}
 });
 expect(result).toMatchObject({yielded:true,oldEmpty:true,nextStable:true,nextCenter:[0,255,0,255]});expect(result.error).toBe('AbortError: Render superseded.');
});

test('yielded brush replay owns mutable input and rejects a resized presentation target',async({page})=>{
 await page.goto('/');
 const result=await page.evaluate(async()=>{
  const {BrushStroke,AffineTransform}=window.luma,{ActiveStrokeRaster}=await import(/* @vite-ignore */String('/src/engine/drawing.ts'));
  const original=new BrushStroke({points:[{x:-750,y:128},{x:-740,y:129}],size:2048,hardness:.4,pressureSize:false,color:'#ff0000',flow:.4}).toJSON();
  const space={x:0,y:0,width:320,height:180,sx:1,sy:1},world=new AffineTransform(2,0,0,2);
  const canvases=Array.from({length:3},()=>{const c=document.createElement('canvas');c.width=320;c.height=180;return c;}),rasters=Array.from({length:3},()=>new ActiveStrokeRaster());
  try{
   const input=structuredClone(original),inputSpace={...space},pending=rasters[0].draw(input,canvases[0],inputSpace,0,0,world);
   input.points[1].x=900;input.points[1].pressure=0;input.color='#0000ff';
   inputSpace.x=4000;inputSpace.sx=2;
   await pending;await rasters[1].draw(original,canvases[1],space,0,0,world);
   const a=canvases[0].getContext('2d')!.getImageData(0,0,320,180).data,b=canvases[1].getContext('2d')!.getImageData(0,0,320,180).data;
   let delta=0;for(let i=0;i<a.length;i++)delta=Math.max(delta,Math.abs(a[i]-b[i]));
   const resized=rasters[2].draw(original,canvases[2],space,0,0,world);canvases[2].width++;
   let error='';try{await resized;}catch(e){error=String(e);}
   return{delta,error,resizedEmpty:![...canvases[2].getContext('2d')!.getImageData(0,0,321,180).data].some(v=>v>0)};
  }finally{rasters.forEach(r=>r.clear());canvases.forEach(c=>c.width=c.height=0);}
 });
 expect(result).toEqual({delta:0,error:'AbortError: Render superseded.',resizedEmpty:true});
});

test('a cancelled numerical extension retains the accepted raw prefix for exact incremental retry',async({page})=>{
 await page.goto('/');
 const result=await page.evaluate(async()=>{
  const {BrushStroke,AffineTransform}=window.luma,{ActiveStrokeRaster}=await import(/* @vite-ignore */String('/src/engine/drawing.ts'));
  const active=new ActiveStrokeRaster(),fresh=new ActiveStrokeRaster(),a=document.createElement('canvas'),b=document.createElement('canvas');a.width=b.width=320;a.height=b.height=180;
  const space={x:0,y:0,width:320,height:180,sx:1,sy:1},world=new AffineTransform(2,0,0,2),first=new BrushStroke({points:[{x:-750,y:128}],size:2048,hardness:.4,pressureSize:false,color:'#cc2244',flow:.4}).toJSON();
  const next={...first,points:[...first.points,{x:-740,y:129,pressure:1}]};
  try{
   await active.draw(first,a,space,0,0,world);a.getContext('2d')!.clearRect(0,0,320,180);
   let cancelled=false;const pending=active.draw(next,a,space,0,0,world,()=>cancelled);cancelled=true;
   let error='';try{await pending;}catch(e){error=String(e);}
   const cancelledEmpty=![...a.getContext('2d')!.getImageData(0,0,320,180).data].some(v=>v>0);
   await active.draw(next,a,space,0,0,world);await fresh.draw(next,b,space,0,0,world);
   const av=a.getContext('2d')!.getImageData(0,0,320,180).data,bv=b.getContext('2d')!.getImageData(0,0,320,180).data;
   let delta=0;for(let i=0;i<av.length;i++)delta=Math.max(delta,Math.abs(av[i]-bv[i]));
   return{error,cancelledEmpty,delta,appended:active.appendedPoints};
  }finally{active.clear();fresh.clear();a.width=a.height=b.width=b.height=0;}
 });
 expect(result).toEqual({error:'AbortError: Render superseded.',cancelledEmpty:true,delta:0,appended:3});
});

test('large source coordinates retain the same quarter-pixel tip and mirrored geometry after rebasing',async({page})=>{
 await page.goto('/');
 const result=await page.evaluate(async()=>{
  const {editor,BrushStroke,BrushTip,BrushSymmetry,PaintLayer,AffineTransform}=window.luma,{drawPaint}=await import(/* @vite-ignore */String('/src/engine/drawing.ts'));
  const rows=[];
  for(const hardness of [.4,1])for(const mirrored of [false,true]){
   const read=async(base:number)=>{
    const layer=new PaintLayer(),options={points:[{x:base+16.25,y:base+28.5}],size:27,hardness,flow:.4,pressureSize:false,color:'#cc2244',tip:new BrushTip({roundness:.4,angle:27}),...(mirrored?{symmetry:BrushSymmetry.mirrorVertical(base+32)}:{})};layer.strokes.add(new BrushStroke(options));
    const canvas=document.createElement('canvas');canvas.width=canvas.height=64;
    try{await drawPaint(layer.toJSON(),editor.assetStore,canvas,{x:0,y:0,width:64,height:64,sx:1,sy:1},new AffineTransform(1,0,0,1,-base,-base),editor.renderer.processor);return canvas.getContext('2d')!.getImageData(0,0,64,64).data;}finally{canvas.width=canvas.height=0;}
   };
   const small=await read(0),large=await read(1e12);let delta=0;for(let i=0;i<small.length;i++)delta=Math.max(delta,Math.abs(small[i]-large[i]));rows.push({hardness,mirrored,delta,visible:large.some((v:number,i:number)=>i%4===3&&v>0)});
  }
  return rows;
 });
 expect(result.every(row=>row.delta===0&&row.visible),JSON.stringify(result)).toBe(true);
});

test('oversized soft-brush work yields to real tool input and cancellation without publishing a partial layer',async({page},info)=>{
 await page.goto('/');
 const result=await page.getByRole('button',{name:'Pencil tool (N)',exact:true}).evaluate(async(button)=>{
  const {editor,BrushStroke,PaintLayer,AffineTransform}=window.luma,{drawPaint}=await import(/* @vite-ignore */String('/src/engine/drawing.ts'));
  await editor.renderer.processor.ready;
  const before=JSON.stringify(editor.document.toJSON()),layer=new PaintLayer();layer.strokes.add(new BrushStroke({points:[{x:-750,y:128},{x:-740,y:129}],size:2048,hardness:.4,pressureSize:false,color:'#cc2244',flow:.4}));
  const canvas=document.createElement('canvas');canvas.width=768;canvas.height=440;
  const tasks:{start:number;duration:number}[]=[],observer=new PerformanceObserver(list=>{for(const e of list.getEntries())tasks.push({start:e.startTime,duration:e.duration});});observer.observe({type:'longtask'});
  try{
   await new Promise(resolve=>setTimeout(resolve,0));const controlStart=performance.now();while(performance.now()-controlStart<75){}const controlEnd=performance.now();await new Promise(resolve=>setTimeout(resolve,100));
   let cancelled=false,finished=false,during=false;const started=performance.now();
   const input=new Promise<number>(resolve=>setTimeout(()=>{during=!finished;(button as HTMLButtonElement).click();cancelled=true;resolve(performance.now()-started);},0));
   let error='';try{await drawPaint(layer.toJSON(),editor.assetStore,canvas,{x:0,y:0,width:768,height:440,sx:1,sy:1},new AffineTransform(2,0,0,2),editor.renderer.processor,undefined,undefined,undefined,undefined,()=>cancelled);}catch(e){error=String(e);}finally{finished=true;}
   const ended=performance.now(),inputMs=await input;await new Promise(resolve=>setTimeout(resolve,50));
   const blank=![...canvas.getContext('2d')!.getImageData(0,0,768,440).data].some(v=>v>0);
   return{during,inputMs,cancelMs:ended-started-inputMs,error,blank,readonly:before===JSON.stringify(editor.document.toJSON()),nativeControl:tasks.some(t=>t.start<controlEnd&&t.start+t.duration>controlStart&&t.duration>=50),workLongTasks:tasks.filter(t=>t.start<ended&&t.start+t.duration>started),toolActive:button.getAttribute('aria-pressed')==='true'};
  }finally{observer.disconnect();canvas.width=canvas.height=0;}
 });
 await info.attach('large-brush-responsiveness',{body:JSON.stringify(result),contentType:'application/json'});
 expect(result).toMatchObject({during:true,error:'AbortError: Render superseded.',blank:true,readonly:true,nativeControl:true,toolActive:true,workLongTasks:[]});expect(result.inputMs).toBeLessThanOrEqual(250);expect(result.cancelMs).toBeLessThanOrEqual(250);
});

test('editing or appending a mutable accepted stroke invalidates its cached native prefix',async({page})=>{
 await page.goto('/');
 const result=await page.evaluate(async()=>{
  const {BrushStroke,BrushTip,AffineTransform}=window.luma,{ActiveStrokeRaster}=await import(/* @vite-ignore */String('/src/engine/drawing.ts'));
  const stroke=new BrushStroke({points:[{x:36,y:40,pressure:.8,tilt:{altitude:.8,azimuth:1.2}}],size:24,flow:.6,color:'#cc2244',tip:new BrushTip({roundness:.4,angle:27,tiltAngle:true,tiltRoundness:true})}).toJSON();
  const space={x:0,y:0,width:128,height:80,sx:1,sy:1},a=document.createElement('canvas'),b=document.createElement('canvas'),active=new ActiveStrokeRaster(),fresh=new ActiveStrokeRaster();a.width=b.width=128;a.height=b.height=80;
  try{
   await active.draw(stroke,a,space,0,0,new AffineTransform());
   stroke.points[0].x=60;stroke.points[0].tilt!.azimuth=2.4;
   stroke.points.push({x:90,y:40,pressure:1});
   a.getContext('2d')!.clearRect(0,0,128,80);
   await active.draw(stroke,a,space,0,0,new AffineTransform());await fresh.draw(stroke,b,space,0,0,new AffineTransform());
   const av=a.getContext('2d')!.getImageData(0,0,128,80).data,bv=b.getContext('2d')!.getImageData(0,0,128,80).data;
   let delta=0;for(let p=0;p<av.length;p++)delta=Math.max(delta,Math.abs(av[p]-bv[p]));
   return{delta,appended:active.appendedPoints,visible:bv.some((v:number,i:number)=>i%4===3&&v>0)};
  }finally{active.clear();fresh.clear();a.width=a.height=b.width=b.height=0;}
 });
 expect(result).toEqual({delta:0,appended:3,visible:true});
});

test('ordinary paint and mask pixels are exact across tile seams, affine crops, scale and incremental previews',async({page})=>{
 await page.goto('/');
 const result=await page.evaluate(async()=>{
  const {editor,BrushStroke,PencilStroke,BrushTip,BrushSymmetry,PaintLayer,AffineTransform}=window.luma;
  const {drawPaint,drawMaskStroke,ActiveStrokeRaster}=await import(/* @vite-ignore */String('/src/engine/drawing.ts'));
  const rows=[];
  for(const pencil of [false,true])for(const hardness of [.4,1])for(const [sx,sy]of [[1,1],[1.25,.75],[.83,.83],[Math.PI/4,1],[.37,.83]]){
   const stroke=new (pencil?PencilStroke:BrushStroke)({points:[{x:250,y:10,pressure:.2},{x:270,y:90,pressure:.8},{x:510,y:180,pressure:.4},{x:770,y:300,pressure:1}],size:37,color:'#cc2244',hardness,opacity:.6,flow:.6,tip:new BrushTip({angle:27,roundness:.4}),symmetry:BrushSymmetry.bothAxes({x:512,y:192})}).toJSON();
   const world=new AffineTransform(.93,.17,-.09,1.04,31,14),space={x:0,y:0,width:1080,height:440,sx,sy};
   for(const mask of [false,true]){
    const read=async(region:typeof space,active=false)=>{
     const canvas=document.createElement('canvas');canvas.width=region.width;canvas.height=region.height;
     const cache=active?new ActiveStrokeRaster():undefined,c=canvas.getContext('2d')!;
     try{
      const counts=active?stroke.points.map((_:unknown,i:number)=>i+1):[stroke.points.length];
      for(const count of counts){
       c.clearRect(0,0,canvas.width,canvas.height);if(mask){c.fillStyle='#fff';c.fillRect(0,0,canvas.width,canvas.height);}
       const current={...stroke,points:stroke.points.slice(0,count)};
       if(mask)await drawMaskStroke({mode:'hide',stroke:current},canvas,region,0,0,editor.renderer.processor,cache,world);
       else{const layer=new PaintLayer().toJSON();if(layer.kind!=='paint')throw new Error('Expected paint layer.');layer.strokes.push(current);await drawPaint(layer,editor.assetStore,canvas,region,world,editor.renderer.processor,cache);}
      }
      return{pixels:c.getImageData(0,0,canvas.width,canvas.height).data,appended:cache?.appendedPoints};
     }finally{cache?.clear();canvas.width=canvas.height=0;}
    };
    const whole=await read(space),preview=await read(space,true);let delta=0;
    for(let p=0;p<whole.pixels.length;p++)delta=Math.max(delta,Math.abs(whole.pixels[p]-preview.pixels[p]));
    for(const crop of [{x:254,y:62,width:260,height:130},{x:510,y:254,width:516,height:130}]){
     const part=await read({...space,...crop,x:crop.x/sx,y:crop.y/sy});
     for(let y=0;y<crop.height;y++)for(let x=0;x<crop.width;x++)for(let c=0;c<4;c++)delta=Math.max(delta,Math.abs(part.pixels[(y*crop.width+x)*4+c]-whole.pixels[((y+crop.y)*space.width+x+crop.x)*4+c]));
    }
    rows.push({pencil,hardness,sx,sy,mask,delta,appended:preview.appended,edited:whole.pixels.some((v:number,i:number)=>i%4===3&&(mask?v<255:v>0))});
   }
  }
  return rows;
 });
 expect(result.every(row=>row.delta===0&&row.appended===4&&row.edited),JSON.stringify(result)).toBe(true);
});

test('painted mask LRU budgets include retained native padding and growth at an existing key',async({page},info)=>{
 await page.goto('/');await page.waitForFunction(()=>!document.querySelector('footer .status-dot.working'));
 const rows=await page.evaluate(async()=>{
  const {editor,LayerMask,BrushStroke,AffineTransform}=window.luma;
  const {PaintedMaskRaster}=await import(/* @vite-ignore */String('/src/engine/masks.ts')),{CanvasCache}=await import(/* @vite-ignore */String('/src/engine/cache.ts'));
  await editor.renderer.processor.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  const rows=[];
  for(const budget of [16*1024*1024,1024*1024]){
   const cache=new CanvasCache(0),raster=new PaintedMaskRaster(cache,budget),canvases=new Set<HTMLCanvasElement>(),original=HTMLCanvasElement.prototype.getContext;
   HTMLCanvasElement.prototype.getContext=function(this:HTMLCanvasElement,...args:Parameters<typeof original>){canvases.add(this);return original.apply(this,args);} as typeof original;
   const retained=()=>[...canvases].reduce((sum,c)=>sum+(c.isConnected?0:c.width*c.height*4),0),samples=[];
   try{
    const sizes=budget===1024*1024?[8,512,8]:Array(8).fill(512);
    for(const [index,size]of sizes.entries()){
     const mask=new LayerMask({base:1}).paint(new BrushStroke({points:[{x:1,y:1}],size,pressureSize:false}),'hide').toJSON();
     const output=await raster.render(mask,{x:0,y:0,width:2,height:2,sx:1,sy:1},0,0,editor.renderer.processor,budget===1024*1024?'same-key':`mask-${index}`,()=>true,new AffineTransform(),undefined,false);
     const alpha=output.getContext('2d')!.getImageData(0,0,2,2).data[3];output.width=output.height=0;
     samples.push({size,alpha,owned:retained(),reported:raster.diagnostics.activeBytes});
    }
    raster.clear();cache.clear();rows.push({budget,samples,afterClear:retained(),reportedAfterClear:raster.diagnostics.activeBytes});
   }finally{raster.clear();cache.clear();HTMLCanvasElement.prototype.getContext=original;}
  }
  return rows;
 });
 await info.attach('owned-mask-padding-budgets',{body:JSON.stringify(rows),contentType:'application/json'});
 for(const row of rows){
  expect(row.samples.every(sample=>sample.alpha===0&&sample.owned<=sample.reported&&sample.reported<=row.budget),JSON.stringify(row)).toBe(true);
  expect(row.afterClear).toBe(0);expect(row.reportedAfterClear).toBe(0);
  if(row.budget===1024*1024)expect(row.samples[1].reported).toBe(0);
 }
});

test('opaque oversized-pencil loops yield across stamps and cancel without publishing partial paint',async({page},info)=>{
 await page.goto('/');
 const result=await page.getByRole('button',{name:'Pencil tool (N)',exact:true}).evaluate(async(button)=>{
  const {editor,PencilStroke,PaintLayer,AffineTransform}=window.luma,{drawPaint}=await import(/* @vite-ignore */String('/src/engine/drawing.ts'));
  await editor.renderer.processor.ready;
  const before=JSON.stringify(editor.document.toJSON()),layer=new PaintLayer();layer.strokes.add(new PencilStroke({points:Array.from({length:20000},()=>({x:128,y:128})),size:2048,pressureSize:false,color:'#cc2244'}));
  const canvas=document.createElement('canvas');canvas.width=768;canvas.height=440;
  const tasks:{start:number;duration:number}[]=[],observer=new PerformanceObserver(list=>{for(const e of list.getEntries())tasks.push({start:e.startTime,duration:e.duration});});observer.observe({type:'longtask'});
  try{
   await new Promise(resolve=>setTimeout(resolve,0));const controlStart=performance.now();while(performance.now()-controlStart<75){}const controlEnd=performance.now();await new Promise(resolve=>setTimeout(resolve,100));
   let cancelled=false,finished=false,during=false;const started=performance.now();
   const input=new Promise<number>(resolve=>setTimeout(()=>{during=!finished;(button as HTMLButtonElement).click();cancelled=true;resolve(performance.now()-started);},0));
   let error='';try{await drawPaint(layer.toJSON(),editor.assetStore,canvas,{x:0,y:0,width:768,height:440,sx:1,sy:1},new AffineTransform(2,0,0,2),editor.renderer.processor,undefined,undefined,undefined,undefined,()=>cancelled);}catch(e){error=String(e);}finally{finished=true;}
   const ended=performance.now(),inputMs=await input;await new Promise(resolve=>setTimeout(resolve,50));
   const blank=![...canvas.getContext('2d')!.getImageData(0,0,768,440).data].some(v=>v>0);
   return{during,inputMs,cancelMs:ended-started-inputMs,error,blank,readonly:before===JSON.stringify(editor.document.toJSON()),nativeControl:tasks.some(t=>t.start<controlEnd&&t.start+t.duration>controlStart&&t.duration>=50),workLongTasks:tasks.filter(t=>t.start<ended&&t.start+t.duration>started),toolActive:button.getAttribute('aria-pressed')==='true'};
  }finally{observer.disconnect();canvas.width=canvas.height=0;}
 });
 await info.attach('opaque-pencil-responsiveness',{body:JSON.stringify(result),contentType:'application/json'});
 expect(result).toMatchObject({during:true,error:'AbortError: Render superseded.',blank:true,readonly:true,nativeControl:true,toolActive:true,workLongTasks:[]});expect(result.inputMs).toBeLessThanOrEqual(250);expect(result.cancelMs).toBeLessThanOrEqual(250);
});


test('numerical large-brush and native vector coverage retain exact fractional-zoom crop pixels',async({page})=>{
 await page.goto('/');
 const rows=await page.evaluate(async()=>{
  const {editor,BrushStroke,PaintLayer,VectorPath,AffineTransform}=window.luma;
  const {drawPaint,vectorMask}=await import(/* @vite-ignore */String('/src/engine/drawing.ts'));
  const rows=[];
  for(const vector of [false,true])for(const sx of [.83,Math.PI/4]){
   const sy=.83,world=new AffineTransform(2,0,0,2),space={x:0,y:0,width:800,height:440,sx,sy};
   const layer=new PaintLayer();layer.strokes.add(new BrushStroke({points:[{x:100,y:80}],size:2048,hardness:.4,flow:.7,opacity:.6,pressureSize:false,color:'#cc2244'}));
   const path=VectorPath.ellipse({x:0,y:0,width:600,height:240}).toJSON();
   const mask={kind:'vector' as const,enabled:true,inverted:false,density:1,fillRule:'evenodd' as const,paths:[{points:path.points}]};
   const read=async(region:typeof space)=>{
    const canvas=vector?vectorMask(mask,region,0,0,world):document.createElement('canvas');
    try{if(!vector){canvas.width=region.width;canvas.height=region.height;await drawPaint(layer.toJSON(),editor.assetStore,canvas,region,world,editor.renderer.processor);}
     return canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data;
    }finally{canvas.width=canvas.height=0;}
   };
   const full=await read(space),part=await read({...space,x:510/sx,y:254/sy,width:260,height:130});let delta=0;
   for(let y=0;y<130;y++)for(let x=0;x<260;x++)for(let c=0;c<4;c++)delta=Math.max(delta,Math.abs(part[(y*260+x)*4+c]-full[((y+254)*800+x+510)*4+c]));
   rows.push({vector,sx,delta,visible:part.some((v:number,i:number)=>i%4===3&&v>0)});
  }
  return rows;
 });
 expect(rows.every(row=>row.delta===0&&row.visible),JSON.stringify(rows)).toBe(true);
});

test('retiring a yielded mask cache producer preserves its independent reader and releases the owner afterward',async({page})=>{
 await page.goto('/');
 const result=await page.evaluate(async()=>{
  const {editor,LayerMask,BrushStroke,AffineTransform}=window.luma;
  const {PaintedMaskRaster}=await import(/* @vite-ignore */String('/src/engine/masks.ts')),{CanvasCache}=await import(/* @vite-ignore */String('/src/engine/cache.ts')),{paintedMask}=await import(/* @vite-ignore */String('/src/engine/drawing.ts'));
  const cache=new CanvasCache(),raster=new PaintedMaskRaster(cache),space={x:0,y:0,width:320,height:180,sx:1,sy:1},world=new AffineTransform(2,0,0,2);
  const mask=new LayerMask({base:1}).paint(new BrushStroke({points:[{x:-750,y:128}],size:2048,hardness:.4,pressureSize:false,flow:.4}),'hide').toJSON();
  let retired=false,current=true,finished=false,output:HTMLCanvasElement|undefined,reference:HTMLCanvasElement|undefined;
  const reset=new Promise<void>(resolve=>setTimeout(()=>{retired=!finished;current=false;raster.clear();cache.clear();resolve();},0));
  try{
   output=await raster.render(mask,space,0,0,editor.renderer.processor,'reader',()=>current,world);finished=true;await reset;
   reference=await paintedMask(mask,space,0,0,editor.renderer.processor,world);
   if(!output||!reference)throw new Error('Missing independent mask results.');
   const a=output.getContext('2d')!.getImageData(0,0,320,180).data,b=reference.getContext('2d')!.getImageData(0,0,320,180).data;
   let delta=0;for(let p=0;p<a.length;p++)delta=Math.max(delta,Math.abs(a[p]-b[p]));
   return{retired,delta,retained:raster.diagnostics.activeBytes,cacheBytes:cache.byteLength};
  }finally{finished=true;await reset;raster.clear();cache.clear();if(output)output.width=output.height=0;if(reference)reference.width=reference.height=0;}
 });
 expect(result).toEqual({retired:true,delta:0,retained:0,cacheBytes:0});
});

test('simultaneous mask readers at the same cache key retain their independent exact results',async({page})=>{
 await page.goto('/');
 const result=await page.evaluate(async()=>{
  const {editor,LayerMask,BrushStroke,AffineTransform}=window.luma;
  const {PaintedMaskRaster}=await import(/* @vite-ignore */String('/src/engine/masks.ts')),{CanvasCache}=await import(/* @vite-ignore */String('/src/engine/cache.ts')),{paintedMask}=await import(/* @vite-ignore */String('/src/engine/drawing.ts'));
  const cache=new CanvasCache(),raster=new PaintedMaskRaster(cache),space={x:0,y:0,width:320,height:180,sx:1,sy:1},world=new AffineTransform(2,0,0,2);
  const masks=[-750,-700].map(x=>new LayerMask({base:1}).paint(new BrushStroke({points:[{x,y:128}],size:2048,hardness:.4,pressureSize:false,flow:.4}),'hide').toJSON());
  const outputs:HTMLCanvasElement[]=[];
  try{
   const settled=await Promise.allSettled(masks.map(mask=>raster.render(mask,space,0,0,editor.renderer.processor,'same',()=>true,world)));
   for(const row of settled)if(row.status==='fulfilled')outputs.push(row.value);
   if(settled.some(row=>row.status==='rejected'))throw new Error(settled.map(row=>row.status==='rejected'?String(row.reason):'ready').join(','));
   const deltas=[];
   for(let i=0;i<2;i++){
    const reference=await paintedMask(masks[i],space,0,0,editor.renderer.processor,world);
    try{const a=outputs[i].getContext('2d')!.getImageData(0,0,320,180).data,b=reference.getContext('2d')!.getImageData(0,0,320,180).data;let delta=0;for(let p=0;p<a.length;p++)delta=Math.max(delta,Math.abs(a[p]-b[p]));deltas.push(delta);}finally{reference.width=reference.height=0;}
   }
   return deltas;
  }finally{outputs.forEach(c=>c.width=c.height=0);raster.clear();cache.clear();}
 });
 expect(result).toEqual([0,0]);
});

test('clearing viewport caches during a direct feathered-mask read disables retention without cancelling the read',async({page})=>{
 await page.goto('/');
 const result=await page.evaluate(async()=>{
  const {editor,LayerMask,BrushStroke,PencilStroke,AffineTransform}=window.luma,{CanvasRenderer}=await import(/* @vite-ignore */String('/src/engine/renderer.ts'));
  const renderer=new CanvasRenderer(),world=new AffineTransform(),space={x:0,y:0,width:2100,height:90,sx:1,sy:1};
  const mask=new LayerMask({base:.8,feather:4.5,density:.75}).paint(new BrushStroke({points:[{x:950,y:15},{x:2070,y:70}],size:44,hardness:.4,opacity:.8}),'hide').paint(new PencilStroke({points:[{x:1000,y:40},{x:2080,y:40}],size:6,opacity:.6}),'reveal').toJSON();
  await renderer.processor.ready;let finished=false,during=false,output:HTMLCanvasElement|undefined,reference:HTMLCanvasElement|undefined;
  const reset=new Promise<void>(resolve=>setTimeout(()=>{during=!finished;renderer.clearCache();resolve();},0));
  try{
   output=await renderer.renderMaskCoverage(mask,space,0,0,'direct',true,world,editor.assetStore);finished=true;await reset;
   reference=await renderer.renderMaskCoverage(mask,space,0,0,'reference',false,world,editor.assetStore);
   if(!output||!reference)throw new Error('Missing direct mask results.');
   const a=output.getContext('2d')!.getImageData(0,0,2100,90).data,b=reference.getContext('2d')!.getImageData(0,0,2100,90).data;
   let delta=0;for(let p=0;p<a.length;p++)delta=Math.max(delta,Math.abs(a[p]-b[p]));
   return{during,delta,retained:renderer.maskDiagnostics.activeBytes};
  }finally{finished=true;await reset;if(output)output.width=output.height=0;if(reference)reference.width=reference.height=0;renderer.dispose();}
 });
 expect(result).toEqual({during:true,delta:0,retained:0});
});
