import{test,expect,type Page,type TestInfo}from'@playwright/test';
import{writeFile}from'node:fs/promises';

async function warmScene(page:Page){
 await page.goto('/');await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
 await page.evaluate(async()=>{
  const{editor:e,TextLayer}=window.luma;const state={prepared:[]as any[],frames:[]as any[]};(window as any).committedFrames=state;const prepare=e.renderer.prepareViewport.bind(e.renderer);let sequence=0;
  e.renderer.prepareViewport=async(doc,assets,options)=>{const entry={sequence:++sequence,name:doc.name,id:doc.id,families:doc.children.filter(l=>l.kind==='text').map(l=>l.fontFamily),region:options?.region,scale:options?.scale};state.prepared.push(entry);const frame=await prepare(doc,assets,options),present=frame.present.bind(frame);frame.present=canvas=>{present(canvas);const c=frame.backend==='canvas2d'?canvas.getContext('2d'):null;state.frames.push({...entry,backend:frame.backend,sourceCurrent:e.document.getSnapshot().document===doc,png:c?canvas.toDataURL():null,center:c?[...c.getImageData(Math.floor(canvas.width/2),Math.floor(canvas.height/2),1,1).data]:null});};return frame;};
  e.newDocument({name:'Committed type',width:698,height:396});e.document.layers.add(new TextLayer({text:'Canoli frame ready',fontFamily:'serif',fontSize:38,color:'#2468ac',x:70,y:90}));await document.fonts.ready;
 });
 await expect.poll(()=>page.evaluate(()=>(window as any).committedFrames.frames.some((r:any)=>r.name==='Committed type'&&r.families[0]==='serif'&&r.sourceCurrent))).toBe(true);
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
}
async function pauseFrames(page:Page){
 await page.evaluate(()=>{const request=window.requestAnimationFrame.bind(window),cancel=window.cancelAnimationFrame.bind(window),pending=new Map<number,FrameRequestCallback>();let id=1000000;const clock={pending,advanced:0,advance(){this.advanced++;const callbacks=[...pending.values()];pending.clear();for(const cb of callbacks)cb(performance.now());},restore(){window.requestAnimationFrame=request;window.cancelAnimationFrame=cancel;this.advance();}};(window as any).pausedFrames=clock;window.requestAnimationFrame=cb=>{const token=++id;pending.set(token,cb);return token;};window.cancelAnimationFrame=token=>{if(!pending.delete(token))cancel(token);};});
}
async function restoreFrames(page:Page){await page.evaluate(()=>(window as any).pausedFrames?.restore());}
async function evidence(page:Page,info:TestInfo){const data=await page.evaluate(()=>({prepared:(window as any).committedFrames.prepared,frames:(window as any).committedFrames.frames.map(({png,...row}:any)=>row),advances:(window as any).pausedFrames.advanced,pending:(window as any).pausedFrames.pending.size}));await writeFile(info.outputPath('committed-frame-scheduling.json'),JSON.stringify(data,null,2));}

test('committed font edits, Undo and Redo present exact frames while the animation-frame clock is paused',async({page},info)=>{
 await warmScene(page);const before=await page.evaluate(()=>({model:JSON.stringify(window.luma.editor.document.toJSON()),past:window.luma.editor.document.getSnapshot().past.length,frame:(window as any).committedFrames.frames.at(-1)}));expect(before.frame.backend).toBe('canvas2d');await pauseFrames(page);
 try{
  await page.evaluate(()=>window.luma.editor.document.fonts.replace('serif','monospace'));
  await expect.poll(()=>page.evaluate(()=>(window as any).committedFrames.frames.at(-1).families[0])).toBe('monospace');
  const changed=await page.evaluate(()=>({frame:(window as any).committedFrames.frames.at(-1),past:window.luma.editor.document.getSnapshot().past.length,advances:(window as any).pausedFrames.advanced,model:JSON.stringify(window.luma.editor.document.toJSON())}));expect(changed.advances).toBe(0);expect(changed.past).toBe(before.past+1);expect(changed.frame.sourceCurrent).toBe(true);expect(changed.frame.png).not.toBe(before.frame.png);
  await page.evaluate(()=>window.luma.editor.document.undo());await expect.poll(()=>page.evaluate(()=>(window as any).committedFrames.frames.at(-1).families[0])).toBe('serif');expect(await page.evaluate(()=>({model:JSON.stringify(window.luma.editor.document.toJSON()),png:(window as any).committedFrames.frames.at(-1).png,advances:(window as any).pausedFrames.advanced}))).toEqual({model:before.model,png:before.frame.png,advances:0});
  await page.evaluate(()=>window.luma.editor.document.redo());await expect.poll(()=>page.evaluate(()=>(window as any).committedFrames.frames.at(-1).families[0])).toBe('monospace');expect(await page.evaluate(()=>({model:JSON.stringify(window.luma.editor.document.toJSON()),png:(window as any).committedFrames.frames.at(-1).png,advances:(window as any).pausedFrames.advanced}))).toEqual({model:changed.model,png:changed.frame.png,advances:0});await evidence(page,info);
 }finally{await restoreFrames(page);}
  await expect(page.locator('.canvas-status')).toContainText('Ready');
});

test('a committed edit interrupts an older view wait and uses the newest view without publishing stale source',async({page},info)=>{
 await warmScene(page);const before=await page.evaluate(()=>({frames:(window as any).committedFrames.frames.length,prepared:(window as any).committedFrames.prepared.length,scale:(window as any).committedFrames.frames.at(-1).scale,past:window.luma.editor.document.getSnapshot().past.length}));await pauseFrames(page);
 try{
  await page.evaluate(()=>{for(let i=0;i<2;i++)(document.querySelector('button[aria-label="Zoom out"]')as HTMLButtonElement).click();});await expect.poll(()=>page.evaluate(()=>(window as any).pausedFrames.pending.size)).toBeGreaterThan(0);expect(await page.evaluate(()=>(window as any).committedFrames.prepared.length)).toBe(before.prepared);
  await page.evaluate(()=>window.luma.editor.document.fonts.replace('serif','monospace'));await expect.poll(()=>page.evaluate(()=>(window as any).committedFrames.frames.at(-1).families[0])).toBe('monospace');
  const result=await page.evaluate(()=>({frames:(window as any).committedFrames.frames.slice(-1),advances:(window as any).pausedFrames.advanced,past:window.luma.editor.document.getSnapshot().past.length}));expect(result.advances).toBe(0);expect(result.past).toBe(before.past+1);expect(result.frames[0].sourceCurrent).toBe(true);expect(result.frames[0].scale).toBeLessThan(before.scale);await evidence(page,info);
 }finally{await restoreFrames(page);}
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));expect(await page.evaluate(()=>(window as any).committedFrames.frames.every((r:any)=>r.sourceCurrent))).toBe(true);
});

test('view-only bursts and a newly activated document still wait for frame admission',async({page},info)=>{
 await warmScene(page);const before=await page.evaluate(()=>({prepared:(window as any).committedFrames.prepared.length,past:window.luma.editor.document.getSnapshot().past.length}));await pauseFrames(page);
 try{
  await page.evaluate(()=>{for(let i=0;i<3;i++)(document.querySelector('button[aria-label="Zoom out"]')as HTMLButtonElement).click();});await expect.poll(()=>page.evaluate(()=>(window as any).pausedFrames.pending.size)).toBeGreaterThan(0);expect(await page.evaluate(()=>(window as any).committedFrames.prepared.length)).toBe(before.prepared);expect(await page.evaluate(()=>window.luma.editor.document.getSnapshot().past.length)).toBe(before.past);
  await page.evaluate(()=>(window as any).pausedFrames.advance());await expect.poll(()=>page.evaluate(()=>(window as any).committedFrames.prepared.length)).toBe(before.prepared+1);
  await page.evaluate(()=>{const{editor:e,PaintLayer,PaintFill}=window.luma;e.newDocument({name:'New frame owner',width:698,height:396});const layer=e.document.layers.add(new PaintLayer());layer.strokes.add(new PaintFill({bounds:{x:0,y:0,width:698,height:396},color:'#207040'}));});await expect.poll(()=>page.evaluate(()=>(window as any).pausedFrames.pending.size)).toBeGreaterThan(0);expect(await page.evaluate(()=>(window as any).committedFrames.frames.some((r:any)=>r.name==='New frame owner'))).toBe(false);
  await page.evaluate(()=>(window as any).pausedFrames.advance());await expect.poll(()=>page.evaluate(()=>(window as any).committedFrames.frames.some((r:any)=>r.name==='New frame owner'&&r.sourceCurrent))).toBe(true);expect(await page.evaluate(()=>(window as any).committedFrames.frames.at(-1).center)).toEqual([32,112,64,255]);await evidence(page,info);
 }finally{await restoreFrames(page);}
});

test('opening identical document data keeps a new owner frame-gated and preserves exact pixels',async({page},info)=>{
 await warmScene(page);const before=await page.evaluate(()=>({model:JSON.stringify(window.luma.editor.document.toJSON()),frame:(window as any).committedFrames.frames.at(-1),prepared:(window as any).committedFrames.prepared.length}));await pauseFrames(page);
 try{
  const changed=await page.evaluate(()=>{const{editor:e,Document}=window.luma,owner=e.document,snapshot=owner.getSnapshot().document,copy=Document.fromJSON(snapshot),Store=e.assetStore.constructor as new()=>typeof e.assetStore;e.replace(copy,new Store());return{differentOwner:copy!==owner,sameId:copy.id===owner.id,sharedSnapshot:copy.getSnapshot().document===snapshot};});expect(changed).toMatchObject({differentOwner:true,sameId:true});await expect.poll(()=>page.evaluate(()=>(window as any).pausedFrames.pending.size)).toBeGreaterThan(0);expect(await page.evaluate(()=>(window as any).committedFrames.prepared.length)).toBe(before.prepared);
  await page.evaluate(()=>(window as any).pausedFrames.advance());await expect.poll(()=>page.evaluate(()=>(window as any).committedFrames.prepared.length)).toBeGreaterThan(before.prepared);await expect.poll(()=>page.evaluate(()=>(window as any).committedFrames.frames.at(-1).sequence)).toBeGreaterThan(before.frame.sequence);expect(await page.evaluate(()=>({model:JSON.stringify(window.luma.editor.document.toJSON()),png:(window as any).committedFrames.frames.at(-1).png,current:(window as any).committedFrames.frames.at(-1).sourceCurrent}))).toEqual({model:before.model,png:before.frame.png,current:true});await evidence(page,info);await writeFile(info.outputPath('identical-data-new-owner.json'),JSON.stringify(changed,null,2));
 }finally{await restoreFrames(page);}
});
