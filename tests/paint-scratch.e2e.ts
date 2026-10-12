import {test,expect} from '@playwright/test';

test('paint replay scratch reuse matches fresh per-stroke surfaces',async({page})=>{
 await page.goto('/');
 const rows=await page.evaluate(async()=>{
  const {drawPaint}=await import(/* @vite-ignore */ String('/src/engine/drawing.ts'));
  const {editor:e,PaintLayer,PaintFill,BrushStroke,PencilStroke,EraserStroke,CloneStroke,MarqueeSelection,AffineTransform}=window.luma;
  const source=new OffscreenCanvas(64,64),c=source.getContext('2d')!;
  c.fillStyle='#7040a0';c.fillRect(0,0,64,64);
  const raster=await e.importImage(new File([await source.convertToBlob()],'clone.png',{type:'image/png'}));
  const clip=new MarqueeSelection({shape:'ellipse',x:15,y:10,width:130,height:110});
  const paint=new PaintLayer();
  paint.strokes.add(new PaintFill({bounds:{x:5.25,y:6.5,width:180,height:120},color:'#307050',opacity:.4}));
  paint.strokes.add(new BrushStroke({points:[{x:10,y:20,pressure:.2},{x:180,y:90,pressure:1}],size:31,hardness:.3,color:'#cc4020',opacity:.6,flow:.4,clip}));
  paint.strokes.add(new EraserStroke({points:[{x:20,y:40},{x:160,y:60}],size:23,hardness:.6,opacity:.45}));
  paint.strokes.add(new CloneStroke({points:[{x:10,y:10},{x:55,y:55}],size:20,hardness:.5,opacity:.8,tiles:[{assetId:raster.assetId,x:0,y:0,width:64,height:64}]}));
  paint.strokes.add(new PencilStroke({points:[{x:17,y:16},{x:160,y:120}],size:7,color:'#70a0cc',opacity:.7}));
  paint.strokes.add(new PaintFill({bounds:{x:5,y:90,width:40,height:25},erase:true,opacity:.4}));
  paint.strokes.add(new PencilStroke({points:[{x:15.49,y:20.01,pressure:.05},{x:21.01,y:28.99,pressure:.07}],size:1,pressureSize:true,color:'#ffeecc'}));
  const layer=paint.toJSON();if(layer.kind!=='paint')throw Error('fixture');
  const rows=[];
  for(const scale of [1,.5,2,8]){
   const space={x:-10,y:-10,width:256*scale,height:192*scale,sx:scale,sy:scale};
   for(const world of [new AffineTransform(),new AffineTransform(1,.2,-.15,.9,12.5,7.25)]){
    const a=document.createElement('canvas'),b=document.createElement('canvas');a.width=b.width=space.width;a.height=b.height=space.height;
    // Independent reference: fresh stroke surfaces and full-canvas composition.
    const reference=b.getContext('2d')!,fullCopy=reference.drawImage.bind(reference);
    reference.drawImage=((image:CanvasImageSource)=>fullCopy(image,0,0)) as typeof reference.drawImage;
    reference.clip=()=>{};
    await drawPaint(layer,e.assetStore,a,space,world,e.renderer.processor);
    for(const stroke of layer.strokes)await drawPaint({...layer,strokes:[stroke]},e.assetStore,b,space,world,e.renderer.processor);
    const x=a.getContext('2d')!.getImageData(0,0,a.width,a.height).data,y=b.getContext('2d')!.getImageData(0,0,b.width,b.height).data;
    let max=0;for(let i=0;i<x.length;i++)max=Math.max(max,Math.abs(x[i]-y[i]));rows.push({scale,max});a.width=a.height=b.width=b.height=1;
   }
  }
  return rows;
 });
 expect(rows.every(row=>row.max===0),JSON.stringify(rows)).toBe(true);
});

test('tool controls update while a cold paint replay is still running',async({page})=>{
 await page.goto('/');
 await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
 const result=await page.getByRole('button',{name:'Pencil tool (N)',exact:true}).evaluate(async(button)=>{
  const {editor:e,Document,PaintLayer,BrushStroke}=window.luma;
  const doc=new Document({width:698,height:396}),paint=new PaintLayer();
  for(let i=0;i<96;i++)paint.strokes.add(new BrushStroke({points:[{x:10,y:10+i*3},{x:680,y:15+i*3}],size:24,hardness:.5,color:'#5588aa',opacity:.5}));
  doc.layers.add(paint);
  let finished=false;
  const rendering=e.renderer.render(doc.getSnapshot().document,e.assetStore,{cache:false}).then(canvas=>{finished=true;canvas.width=canvas.height=1;});
  const interactive=new Promise<boolean>(resolve=>setTimeout(()=>{
   (button as HTMLButtonElement).click();
   requestAnimationFrame(()=>resolve(!finished && button.getAttribute('aria-pressed')==='true'));
  },0));
  const during=await interactive;
  await rendering;
  return {during,finished};
 });
 expect(result).toEqual({during:true,finished:true});
});
test('tool controls update during a single long stroke replay',async({page})=>{
 await page.goto('/');
 await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
 const result=await page.getByRole('button',{name:'Pencil tool (N)',exact:true}).evaluate(async(button)=>{
  const {editor:e,Document,PaintLayer,BrushStroke}=window.luma;
  const doc=new Document({width:698,height:396}),paint=new PaintLayer();
  paint.strokes.add(new BrushStroke({points:Array.from({length:1200},(_,i)=>({x:i%2?680:10,y:10+(i%120)*3})),size:24,hardness:.5,color:'#5588aa',opacity:.5}));
  doc.layers.add(paint);
  const longTasks:number[]=[];
  const observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())longTasks.push(entry.duration);});
  observer.observe({type:'longtask'});
  await new Promise<void>(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
  const started=performance.now();
  let finished=false;
  const rendering=e.renderer.render(doc.getSnapshot().document,e.assetStore,{cache:false}).then(canvas=>{finished=true;canvas.width=canvas.height=1;});
  const interactive=new Promise<boolean>(resolve=>setTimeout(()=>{
   (button as HTMLButtonElement).click();
   requestAnimationFrame(()=>resolve(!finished && button.getAttribute('aria-pressed')==='true'));
  },0));
  const during=await interactive,controlMs=performance.now()-started;
  await rendering;
  const renderMs=performance.now()-started;
  await new Promise(resolve=>setTimeout(resolve,30));
  observer.disconnect();
  return {during,finished,controlMs,renderMs,longTasks};
 });
 console.log('single-stroke-replay',JSON.stringify(result));
 expect(result).toMatchObject({during:true,finished:true});
});

test('cooperative long stroke matches synchronous preview pixels',async({page})=>{
 await page.goto('/');
 const max=await page.evaluate(async()=>{
  const {drawPaint,ActiveStrokeRaster}=await import(/* @vite-ignore */ String('/src/engine/drawing.ts'));
  const {editor:e,PaintLayer,BrushStroke,MarqueeSelection,AffineTransform}=window.luma;
  const layer=new PaintLayer();
  layer.strokes.add(new BrushStroke({points:Array.from({length:600},(_,i)=>({x:i%2?220:15,y:15+(i%80),pressure:.2+(i%9)/12})),size:19,hardness:.4,flow:.3,opacity:.6,color:'#cc5040',clip:new MarqueeSelection({shape:'ellipse',x:10,y:10,width:190,height:100})}));
  const a=document.createElement('canvas'),b=document.createElement('canvas');a.width=b.width=256;a.height=b.height=128;
  const active=new ActiveStrokeRaster(),space={x:0,y:0,width:256,height:128,sx:1,sy:1},world=new AffineTransform(1,.05,-.03,1,3,2);
  try{
   await drawPaint(layer.toJSON(),e.assetStore,a,space,world,e.renderer.processor);
   await drawPaint(layer.toJSON(),e.assetStore,b,space,world,e.renderer.processor,active);
   const x=a.getContext('2d')!.getImageData(0,0,256,128).data,y=b.getContext('2d')!.getImageData(0,0,256,128).data;
   let max=0;for(let i=0;i<x.length;i++)max=Math.max(max,Math.abs(x[i]-y[i]));return max;
  }finally{active.clear();a.width=a.height=b.width=b.height=1;}
 });
 expect(max).toBe(0);
});
