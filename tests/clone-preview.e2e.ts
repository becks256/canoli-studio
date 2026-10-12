import {test,expect} from '@playwright/test';

for(const fresh of [false,true])for(const angle of [0,.3])test(`clone live pixels match commit, fresh ${fresh}, angle ${angle}`,async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
 const result=await page.evaluate(async({fresh,angle})=>{
  const {execute}=await import(/* @vite-ignore */ String('/src/core/commands.ts'));
  const {CanvasRenderer}=await import(/* @vite-ignore */ String('/src/engine/renderer.ts'));
  const {editor:e,PaintLayer,PaintFill,MarqueeSelection,AffineTransform}=window.luma;
  e.newDocument({width:512,height:384});
  const source=e.document.layers.add(new PaintLayer());source.strokes.add(new PaintFill({bounds:{x:0,y:0,width:512,height:120},color:'#ff0040'}));
  source.opacity=.5;
  const target=e.document.layers.add(new PaintLayer());target.transform=AffineTransform.rotation(angle);
  e.document.selectedLayer=fresh?null:target;
  e.document.selection=new MarqueeSelection({shape:'ellipse',x:190,y:210,width:160,height:50});
  e.tools.configure({size:32,hardness:.5,opacity:.6,flow:.8,smoothing:0,pressureSize:false,pressureOpacity:false,color:'#123456'});
  const modifiers={alt:false,shift:false,pressure:1};
  e.tools.begin('clone',{x:200,y:50},{...modifiers,alt:true},1);
  const before=e.document.getSnapshot(),assets=e.assetStore.values().length;
  e.tools.begin('clone',{x:200,y:230},modifiers,1);e.tools.move({x:340,y:230},modifiers);
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  const state=e.tools.getSnapshot();
  const renderer=new CanvasRenderer();
  const view=state.preview?execute(before.document,state.preview):before.document;
  const canvas=await renderer.render(view,e.assetStore,{cache:false,paintPreview:state.paintPreview});
  const live=canvas.getContext('2d')!.getImageData(0,0,512,384).data;canvas.width=0;
  const unchanged=e.document.getSnapshot().revision===before.revision&&e.assetStore.values().length===assets;
  await e.tools.end();
  const committed=await renderer.render(e.document.getSnapshot().document,e.assetStore,{cache:false});
  const pixels=committed.getContext('2d')!.getImageData(0,0,512,384).data;
  let max=0,count=0;for(let i=0;i<live.length;i++){const delta=Math.abs(live[i]-pixels[i]);max=Math.max(max,delta);if(delta)count++;}
  const shown=live[(230*512+270)*4+3];committed.width=0;renderer.dispose();
  return {max,count,shown,unchanged,history:e.document.getSnapshot().past.length-before.past.length};
 },{fresh,angle});
 expect(result.unchanged).toBe(true);expect(result.history).toBe(1);expect(result.shown).toBeGreaterThan(0);expect(result.max,JSON.stringify(result)).toBe(0);
});

for(const action of ['cancel','switch'] as const)test(`pending clone source is released after ${action}`,async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
 const result=await page.evaluate(async(action)=>{
  const {execute}=await import(/* @vite-ignore */ String('/src/core/commands.ts'));
  const {CanvasRenderer}=await import(/* @vite-ignore */ String('/src/engine/renderer.ts'));
  const e=window.luma.editor;e.newDocument({width:128,height:128});
  const doc=e.document,before=doc.getSnapshot(),assetCount=e.assetStore.values().length;
  const modifiers={alt:false,shift:false,pressure:1};
  e.tools.begin('clone',{x:20,y:20},{...modifiers,alt:true},1);e.tools.begin('clone',{x:60,y:60},modifiers,1);
  const state=e.tools.getSnapshot(),source=state.paintPreview!.cloneSource! as any;
  let signal!:()=>void,unblock!:()=>void;
  const started=new Promise<void>(resolve=>signal=resolve),gate=new Promise<void>(resolve=>unblock=resolve);
  const original=source.sample,images:HTMLCanvasElement[]=[];
  source.sample=async(...args:any[])=>{const image=await original(...args);images.push(image);signal();await gate;return image;};
  const renderer=new CanvasRenderer();
  const pending=renderer.render(execute(before.document,state.preview!),e.assetStore,{cache:false,paintPreview:state.paintPreview}).then((c:HTMLCanvasElement)=>{c.width=0;return 'unexpected success';},(error:unknown)=>String(error));
  await started;
  if(action==='cancel')e.tools.cancel();else e.newDocument({width:64,height:64});
  unblock();const error=await pending;renderer.dispose();
  return {error,released:images.every(image=>image.width===0),history:doc.getSnapshot().past.length-before.past.length,revision:doc.getSnapshot().revision-before.revision,assetCount,remaining:e.assetStore.values().length,preview:e.tools.getSnapshot().paintPreview};
 },action);
 expect(result.error).toContain('ended');expect(result.released).toBe(true);expect(result.history).toBe(0);expect(result.revision).toBe(0);expect(result.remaining).toBe(result.assetCount);expect(result.preview).toBeNull();
});

for(const scale of [1,.125])test(`sparse diagonal clone sources match full sampling at scale ${scale}`,async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
 const result=await page.evaluate(async scale=>{
  const {CanvasRenderer}=await import(/* @vite-ignore */ String('/src/engine/renderer.ts'));
  const {editor:e,PaintLayer,PaintFill,AffineTransform}=window.luma;
  e.newDocument({width:3000,height:2000});
  const background=e.document.layers.add(new PaintLayer());background.opacity=.5;
  background.strokes.add(new PaintFill({bounds:{x:0,y:0,width:3000,height:2000},color:'#ee4400'}));
  const layer=e.document.layers.add(new PaintLayer());layer.transform=new AffineTransform(1,.2,.3,.8,0,0);e.document.selectedLayer=layer;
  e.tools.configure({size:35,hardness:.4,opacity:.6,flow:.7,smoothing:0,pressureSize:true,pressureOpacity:true});
  const modifiers={alt:false,shift:false,pressure:.2};
  e.tools.begin('clone',{x:100,y:100},{...modifiers,alt:true},1);e.tools.begin('clone',{x:200,y:300},modifiers,1);
  e.tools.move({x:2500,y:1700},{...modifiers,pressure:1});
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  const preview=e.tools.getSnapshot().paintPreview!,source=preview.cloneSource! as any;
  const renderer=new CanvasRenderer(),options={paintPreview:preview,cache:false,scale};
  const sparse=await renderer.render(e.document.getSnapshot().document,e.assetStore,options);
  const draw=source.draw.bind(source);source.draw=(c:any,b:any,v:any)=>draw(c,b,v,()=>true);
  const reference=await renderer.render(e.document.getSnapshot().document,e.assetStore,options);
  const a=sparse.getContext('2d')!.getImageData(0,0,sparse.width,sparse.height).data,b=reference.getContext('2d')!.getImageData(0,0,reference.width,reference.height).data;
  let differences=0,max=0;for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);if(d)differences++;max=Math.max(max,d);}
  sparse.width=reference.width=0;e.tools.cancel();renderer.dispose();return {differences,max};
 },scale);
 expect(result).toEqual({differences:0,max:0});
});

test('released clone rejects a held preview while retaining the last frame until commit',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
 await page.evaluate(()=>{
  const {editor:e,PaintLayer,PaintFill}=window.luma;e.newDocument({width:200,height:100});
  const source=e.document.layers.add(new PaintLayer());source.strokes.add(new PaintFill({bounds:{x:0,y:0,width:100,height:100},color:'#ff0000'}));
  e.document.selectedLayer=e.document.layers.add(new PaintLayer());
 });
 await page.keyboard.press('Control+1');await page.keyboard.press('s');await page.waitForTimeout(100);
 const box=(await page.locator('.canvas-wrap').boundingBox())!;
 await page.keyboard.down('Alt');await page.mouse.click(box.x+20,box.y+20);await page.keyboard.up('Alt');
 await page.mouse.move(box.x+120,box.y+50);await page.mouse.down();
 const pixel=()=>page.evaluate(()=>[...document.querySelector<HTMLCanvasElement>('[data-testid="artwork"]')!.getContext('2d')!.getImageData(120,50,1,1).data]);
 await expect.poll(pixel).toEqual([255,0,0,255]);
 await page.evaluate(()=>{
  const e=window.luma.editor,prepare=e.renderer.prepareViewport.bind(e.renderer),add=e.assetStore.add.bind(e.assetStore);
  const state={held:false,presented:0,returned:false,assetStarted:false,source:e.tools.getSnapshot().paintPreview!.cloneSource!,releaseFrame:()=>{},releaseAsset:()=>{},revision:e.document.getSnapshot().revision};(window as any).heldClone=state;
  let armed=true;
  e.renderer.prepareViewport=async(...args)=>{
   const frame=await prepare(...args);
   if(armed&&args[2]?.paintPreview?.cloneSource){armed=false;const present=frame.present.bind(frame);frame.present=canvas=>{state.presented++;present(canvas);};state.held=true;await new Promise<void>(resolve=>state.releaseFrame=resolve);state.returned=true;}
   return frame;
  };
  e.assetStore.add=async(...args)=>{const asset=await add(...args);state.assetStarted=true;await new Promise<void>(resolve=>state.releaseAsset=resolve);return asset;};
 });
 await page.mouse.move(box.x+130,box.y+50);
 await expect.poll(()=>page.evaluate(()=>(window as any).heldClone.held)).toBe(true);
 await page.mouse.up();await expect.poll(()=>page.evaluate(()=>(window as any).heldClone.assetStarted)).toBe(true);
 expect(await page.evaluate(()=>(window as any).heldClone.source.isDisposed)).toBe(true);
 await page.evaluate(()=>(window as any).heldClone.releaseFrame());
 await expect.poll(()=>page.evaluate(()=>(window as any).heldClone.returned)).toBe(true);
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 expect(await page.evaluate(()=>(window as any).heldClone.presented)).toBe(0);expect(await pixel()).toEqual([255,0,0,255]);
 await expect(page.getByText('Clone preview ended.',{exact:false})).toHaveCount(0);
 await page.evaluate(()=>(window as any).heldClone.releaseAsset());
 await expect.poll(()=>page.evaluate(()=>window.luma.editor.document.getSnapshot().revision-(window as any).heldClone.revision)).toBe(1);
});

for (const patterned of [false,true]) for (const points of [1,30]) test(`committed cropped clone matches ${patterned ? "original tile capture" : "full source"} with ${points} segments`,async({page})=>{
 await page.goto('/');
 const results=await page.evaluate(async({points,patterned})=>{
  const {editor:e,PaintLayer,PaintFill}=window.luma;
  e.newDocument({width:3000,height:2000});
  const background=e.document.layers.add(new PaintLayer());
  background.strokes.add(new PaintFill({bounds:{x:0,y:0,width:3000,height:2000},color:'#ee4400'}));
  if(patterned)background.opacity=.7;
  for(let i=0;patterned&&i<12;i++)background.strokes.add(new PaintFill({bounds:{x:i*251,y:(i%3)*300,width:117,height:1700},color:i%2?'#0088ff':'#00ff44',opacity:.6}));
  const target=e.document.layers.add(new PaintLayer());e.document.selectedLayer=target;
  const sourceDocument=e.document.toJSON();
  const full=await e.renderer.render(e.document.getSnapshot().document,e.assetStore,{cache:false});
  const blob=await new Promise<Blob>(resolve=>full.toBlob(b=>resolve(b!),'image/png'));
  full.width=full.height=1;
  const asset=await e.assetStore.add(blob,'Full clone reference',undefined,false);
  e.tools.configure({size:35,hardness:.4,opacity:.6,flow:.7,smoothing:0,pressureSize:false,pressureOpacity:false});
  const modifiers={alt:false,shift:false,pressure:1};
  e.tools.begin('clone',{x:100,y:100},{...modifiers,alt:true},1);
  e.tools.begin('clone',{x:100,y:100},modifiers,1);
  for(let i=1;i<=points;i++)e.tools.move({x:100+2700*i/points,y:100+1700*i/points},modifiers);await e.tools.end();
  const sparse=e.document.toJSON();
  sparse.children=sparse.children.filter(l=>l.id===target.id);
  const reference=structuredClone(sparse),layer=reference.children[0];
  if(layer.kind!=='paint'||layer.strokes[0].kind!=='clone')throw Error('Expected clone');
  if(patterned){
   // Compare against the original native tile capture, including its existing
   // per-tile rasterization/alpha rounding rather than a single-image encoding.
   const {strokeBounds}=await import(/* @vite-ignore */ String('/src/core/drawing.ts'));
   const {strokeIntersectsRegion}=await import(/* @vite-ignore */ String('/src/engine/stroke-region.ts'));
   const stroke=layer.strokes[0],bounds=strokeBounds(stroke),tiles=[];
   for(let y=Math.floor(bounds.y);y<Math.ceil(bounds.y+bounds.height);y+=1024)
    for(let x=Math.floor(bounds.x);x<Math.ceil(bounds.x+bounds.width);x+=1024){
     const width=Math.min(1024,Math.ceil(bounds.x+bounds.width)-x),height=Math.min(1024,Math.ceil(bounds.y+bounds.height)-y);
     if(!strokeIntersectsRegion(stroke,{x,y,width,height}))continue;
     const canvas=await e.renderer.render(sourceDocument,e.assetStore,{cache:false,readback:true,region:{x,y,width,height}});
     const pixels=canvas.getContext('2d')!.getImageData(0,0,width,height).data;canvas.width=canvas.height=1;
     const encoded=await e.renderer.processor.encodePng(pixels,width,height);
     const asset=await e.assetStore.add(encoded,'Original tile reference',undefined,false);
     tiles.push({assetId:asset.id,x,y,width,height});
    }
   stroke.tiles=tiles;
  }else layer.strokes[0].tiles=[{assetId:asset.id,x:0,y:0,width:3000,height:2000}];
  const results=[];
  for(const scale of [1,.125,.01,.001]){
   const options={cache:false,outputSize:{width:Math.max(1,Math.round(3000*scale)),height:Math.max(1,Math.round(2000*scale))}};
   const a=await e.renderer.render(sparse,e.assetStore,options),b=await e.renderer.render(reference,e.assetStore,options);
   const x=a.getContext('2d')!.getImageData(0,0,a.width,a.height).data,y=b.getContext('2d')!.getImageData(0,0,b.width,b.height).data;
   let max=0;for(let i=0;i<x.length;i++)max=Math.max(max,Math.abs(x[i]-y[i]));
   results.push({scale,max});a.width=a.height=b.width=b.height=1;
  }
  return results;
 },{points,patterned});
 expect(results.every(r=>r.max===0),JSON.stringify(results)).toBe(true);
});
