import{test,expect,type Page}from'@playwright/test';
import{writeFile}from'node:fs/promises';

async function warm(page:Page,second=false){
 await page.goto('/');await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
 await page.evaluate(second=>{
  const{editor:e,Document,PaintLayer,PaintFill}=window.luma,doc=new Document({width:400,height:300}),red=doc.layers.add(new PaintLayer({name:'Red rectangle'}));red.strokes.add(new PaintFill({bounds:{x:100,y:100,width:80,height:40},color:'#ee6633'}));
  if(second){const blue=doc.layers.add(new PaintLayer({name:'Blue rectangle'}));blue.strokes.add(new PaintFill({bounds:{x:240,y:100,width:40,height:40},color:'#2255bb'}));}
  const restored=Document.fromJSON(doc.getSnapshot().document),Store=e.assetStore.constructor as new()=>typeof e.assetStore;restored.selectedLayer=restored.layers.at(0)!;e.replace(restored,new Store());
 },second);
 await page.keyboard.press('Control+1');await page.getByLabel('Snap to canvas and guides',{exact:true}).uncheck();await expect(page.getByTestId('artwork')).toHaveJSProperty('width',400);await expect(page.getByTestId('artwork')).toHaveJSProperty('height',300);
 await page.evaluate(()=>{
  const e=window.luma.editor,state={prepared:[]as{x:number}[],frames:[]as{x:number;different:number;ownerCurrent:boolean;sourceCurrent:boolean}[]};(window as any).gestureFrames=state;
  const prepare=e.renderer.prepareViewport.bind(e.renderer);e.renderer.prepareViewport=async(doc,assets,options)=>{const owner=e.document,x=doc.children[0].x;state.prepared.push({x});const frame=await prepare(doc,assets,options),present=frame.present.bind(frame);frame.present=canvas=>{present(canvas);const actual=canvas.getContext('2d')!.getImageData(0,0,400,300).data;let different=0;for(let y=0;y<300;y++)for(let px=0;px<400;px++){const red=px>=100+x&&px<180+x&&y>=100&&y<140,blue=doc.children.length>1&&px>=240&&px<280&&y>=100&&y<140,expected=blue?[34,85,187,255]:red?[238,102,51,255]:[0,0,0,0],at=(y*400+px)*4;for(let c=0;c<4;c++)if(actual[at+c]!==expected[c])different++;}state.frames.push({x,different,ownerCurrent:owner===e.document,sourceCurrent:doc===e.document.getSnapshot().document});};return frame;};
 });
 // A harmless source revision gives the probe one complete current base frame.
 await page.evaluate(()=>{window.luma.editor.document.name='Gesture admission';});await expect.poll(()=>page.evaluate(()=>(window as any).gestureFrames.frames.at(-1)?.x)).toBe(0);expect(await page.evaluate(()=>(window as any).gestureFrames.frames.at(-1).different)).toBe(0);
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
}
async function pause(page:Page){await page.evaluate(()=>{const request=window.requestAnimationFrame.bind(window),cancel=window.cancelAnimationFrame.bind(window),pending=new Map<number,FrameRequestCallback>();let id=1000000;(window as any).gestureClock={pending,advanced:0,advance(){this.advanced++;const work=[...pending.values()];pending.clear();for(const callback of work)callback(performance.now());},restore(){window.requestAnimationFrame=request;window.cancelAnimationFrame=cancel;this.advance();}};window.requestAnimationFrame=callback=>{const token=++id;pending.set(token,callback);return token;};window.cancelAnimationFrame=token=>{if(!pending.delete(token))cancel(token);};});}
async function restore(page:Page){await page.evaluate(()=>(window as any).gestureClock?.restore());}
async function capture(page:Page){return page.evaluate(()=>({prepared:(window as any).gestureFrames.prepared,frames:(window as any).gestureFrames.frames,advances:(window as any).gestureClock.advanced,pending:(window as any).gestureClock.pending.size,model:JSON.stringify(window.luma.editor.document.toJSON()),past:window.luma.editor.document.getSnapshot().past.length}));}

test('warm pointer previews start immediately, share exact pixels with React and coalesce later inputs once per frame',async({page},info)=>{
 await warm(page);const before=await page.evaluate(()=>({model:JSON.stringify(window.luma.editor.document.toJSON()),past:window.luma.editor.document.getSnapshot().past.length,prepared:(window as any).gestureFrames.prepared.length,frames:(window as any).gestureFrames.frames.length})),box=(await page.getByTestId('artwork').boundingBox())!;await pause(page);
 try{
  await page.mouse.move(box.x+120,box.y+120);await page.mouse.down();await page.mouse.move(box.x+132,box.y+120);
  await expect.poll(()=>page.evaluate(()=>(window as any).gestureFrames.frames.at(-1).x)).toBe(12);let seen=await capture(page);expect(seen.advances).toBe(0);expect(seen.prepared.length).toBe(before.prepared+1);expect(seen.frames.length).toBe(before.frames+1);expect(seen.frames.at(-1).different).toBe(0);expect(seen.model).toBe(before.model);expect(seen.past).toBe(before.past);
  await page.mouse.move(box.x+144,box.y+120);await page.mouse.move(box.x+156,box.y+120);seen=await capture(page);expect(seen.prepared.length).toBe(before.prepared+1);expect(seen.frames.at(-1).x).toBe(12);
  await page.evaluate(()=>(window as any).gestureClock.advance());await expect.poll(()=>page.evaluate(()=>(window as any).gestureFrames.frames.at(-1).x)).toBe(36);seen=await capture(page);expect(seen.prepared.slice(before.prepared).map((r:{x:number})=>r.x)).toEqual([12,36]);expect(seen.frames.at(-1).different).toBe(0);expect(seen.advances).toBe(1);expect(seen.model).toBe(before.model);
  await page.mouse.move(box.x+168,box.y+120);expect((await capture(page)).prepared.length).toBe(before.prepared+2);
  await page.mouse.up();await expect.poll(()=>page.evaluate(()=>({current:(window as any).gestureFrames.frames.at(-1).sourceCurrent,x:(window as any).gestureFrames.frames.at(-1).x}))).toEqual({current:true,x:48});expect((await capture(page)).past).toBe(before.past+1);await page.evaluate(()=>window.luma.editor.document.undo());await expect.poll(()=>page.evaluate(()=>(window as any).gestureFrames.frames.at(-1).x)).toBe(0);expect((await capture(page)).model).toBe(before.model);await page.evaluate(()=>window.luma.editor.document.redo());await expect.poll(()=>page.evaluate(()=>(window as any).gestureFrames.frames.at(-1).x)).toBe(48);seen=await capture(page);expect(seen.advances).toBe(1);expect(seen.frames.every((f:{different:number;ownerCurrent:boolean})=>f.different===0&&f.ownerCurrent)).toBe(true);await writeFile(info.outputPath('gesture-admission.json'),JSON.stringify(seen,null,2));
 }finally{await page.mouse.up();await restore(page);}
});

for(const change of['selection','same-selection','owner']as const)test(`a held pointer preview respects ${change} before React can retarget it`,async({page},info)=>{
 await warm(page,true);const before=await page.evaluate(()=>({model:JSON.stringify(window.luma.editor.document.toJSON()),source:window.luma.editor.document.getSnapshot().document.id})),box=(await page.getByTestId('artwork').boundingBox())!;
 await page.mouse.move(box.x+120,box.y+120);await page.mouse.down();await page.evaluate(()=>{const e=window.luma.editor,prepare=e.renderer.prepareViewport.bind(e.renderer),held={ready:false,presented:0,disposed:false,release:()=>{}};(window as any).heldGesture=held;let first=true;e.renderer.prepareViewport=async(...args)=>{const result=await prepare(...args);if(first){first=false;const present=result.present.bind(result),dispose=result.dispose.bind(result);result.present=canvas=>{held.presented++;present(canvas);};result.dispose=()=>{held.disposed=true;dispose();};held.ready=true;await new Promise<void>(resolve=>held.release=resolve);}return result;};});
 await page.mouse.move(box.x+132,box.y+120);await expect.poll(()=>page.evaluate(()=>(window as any).heldGesture.ready)).toBe(true);
 const authority=await page.evaluate(change=>{const{editor:e,Document}=window.luma,owner=e.document,source=owner.getSnapshot().document,revision=owner.getSnapshot().revision;
  if(change==='owner'){const Store=e.assetStore.constructor as new()=>typeof e.assetStore,copy=Document.fromJSON(source);copy.selectedLayer=copy.layers.at(0)!;e.replace(copy,new Store());}
  else owner.selectedLayer=owner.layers.at(change==='selection'?1:0)!;
  (window as any).heldGesture.release();return{ownerChanged:e.document!==owner,sameId:e.document.id===source.id,sourceUnchanged:owner.getSnapshot().document===source,revisionUnchanged:owner.getSnapshot().revision===revision};
 },change);expect(authority).toMatchObject({ownerChanged:change==='owner',sameId:true,sourceUnchanged:true,revisionUnchanged:true});
 await expect.poll(()=>page.evaluate(()=>(window as any).heldGesture.disposed)).toBe(true);
 if(change==='same-selection')await expect.poll(()=>page.evaluate(()=>(window as any).heldGesture.presented)).toBe(1);
 else{await expect.poll(()=>page.evaluate(()=>(window as any).gestureFrames.frames.at(-1).sourceCurrent)).toBe(true);expect(await page.evaluate(()=>(window as any).heldGesture.presented)).toBe(0);}
 expect(await page.evaluate(()=>(window as any).gestureFrames.frames.every((f:{different:number;ownerCurrent:boolean})=>f.different===0&&f.ownerCurrent))).toBe(true);await page.keyboard.press('Escape');await page.mouse.up();expect(await page.evaluate(()=>JSON.stringify(window.luma.editor.document.toJSON()))).toBe(before.model);await writeFile(info.outputPath('held-gesture-'+change+'.json'),JSON.stringify({authority,frames:await page.evaluate(()=>(window as any).gestureFrames.frames)},null,2));
});
