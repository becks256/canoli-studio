import {test,expect,type Page} from '@playwright/test';

async function artwork(page:Page){
 await page.goto('/');await page.evaluate(async()=>{const {editor,TextLayer}=window.luma;editor.newDocument({name:'Status artwork',width:320,height:200});const text=editor.document.layers.add(new TextLayer({text:'Source text',fontFamily:'monospace',fontSize:18,x:20,y:20}));editor.document.selectedLayer=text;await document.fonts.ready;await editor.recovery.flush();await editor.workspaceAutosave.flush();});
 await expect(page.locator('footer .status-dot.working')).toHaveCount(0);
}
async function holdSave(page:Page){
 await page.evaluate(()=>{
  const controller=window.luma.editor.recovery,repository=controller.repository,original=repository.save;let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  const state={ready:false,failure:false,flush:Promise.resolve(),release:()=>{repository.save=original;release();}};
  (window as unknown as {recoveryStatusHold:typeof state}).recoveryStatusHold=state;
  repository.save=async function(...args:Parameters<typeof original>){state.ready=true;await gate;if(state.failure)throw new DOMException('Status test quota','QuotaExceededError');return original.apply(this,args);};
 });
}
async function beginSave(page:Page){await page.evaluate(()=>{const editor=window.luma.editor,state=(window as unknown as {recoveryStatusHold:{flush:Promise<void>}}).recoveryStatusHold;editor.recovery.schedule(editor.recoverySessionId,editor.document.getSnapshot().document,editor.assetStore);state.flush=editor.recovery.flush();});await page.waitForFunction(()=>(window as unknown as {recoveryStatusHold:{ready:boolean}}).recoveryStatusHold.ready);}
async function releaseSave(page:Page,failure=false){await page.evaluate(async failure=>{const state=(window as unknown as {recoveryStatusHold:{release():void;failure:boolean;flush:Promise<void>}}).recoveryStatusHold;state.failure=failure;state.release();await state.flush;},failure);}

test('recovery progress keeps focused edits, native pixels and undo history while acknowledging actual storage completion',async({page},info)=>{
 await artwork(page);await holdSave(page);const input=page.getByRole('textbox',{name:'Text content',exact:true});await input.fill('Edited while saving');await input.focus();await input.evaluate(element=>(element as HTMLTextAreaElement).setSelectionRange(2,7));
 const before=await page.evaluate(async()=>{const editor=window.luma.editor;return{json:JSON.stringify(editor.document.toJSON()),past:editor.document.getSnapshot().past.length,selection:editor.document.selectedLayer!.id,png:[...new Uint8Array(await(await editor.exportPng()).arrayBuffer())]};});await beginSave(page);
 const status=page.locator('.canvas-status > span:last-child');await expect(status).toHaveText('Saving recovery…');await expect(status).toHaveAttribute('title','Saving recovery…');await expect(input).toBeEnabled();await expect(input).toBeFocused();expect(await input.evaluate(element=>[(element as HTMLTextAreaElement).selectionStart,(element as HTMLTextAreaElement).selectionEnd])).toEqual([2,7]);
 await releaseSave(page);await expect(status).toHaveText('Recovery saved locally');await expect(input).toBeFocused();
 const after=await page.evaluate(async()=>{const editor=window.luma.editor;return{json:JSON.stringify(editor.document.toJSON()),past:editor.document.getSnapshot().past.length,selection:editor.document.selectedLayer!.id,png:[...new Uint8Array(await(await editor.exportPng()).arrayBuffer())]};});expect(after).toEqual(before);await info.attach('recovery-progress-preservation',{body:JSON.stringify({jsonExact:true,nativePngExact:true,historyExact:true,focusedDraftRetained:true,storageAcknowledgedAfterCommit:true}),contentType:'application/json'});
});

for(const outcome of ['complete','fail','close'] as const)test(`inactive document recovery ${outcome} cannot replace the active status or artwork`,async({page},info)=>{
 await artwork(page);const download=page.waitForEvent('download');await page.getByRole('button',{name:'Save project',exact:true}).click();await(await download).saveAs(info.outputPath('downloaded-status-artwork.luma'));const status=page.locator('.canvas-status > span:last-child');await expect(status).toHaveText('Project downloaded');await holdSave(page);await beginSave(page);await expect(status).toHaveText('Project downloaded');await expect(status).toHaveAttribute('title','Saving recovery…');
 const first=await page.evaluate(()=>window.luma.editor.documentSessions.find(session=>session.document===window.luma.editor.document)!.id);
 const second=await page.evaluate(async()=>{const {editor,TextLayer}=window.luma;editor.newDocument({name:'Independent status',width:280,height:180});editor.document.layers.add(new TextLayer({text:'Keep this active artwork',fontFamily:'monospace',fontSize:16}));await editor.recovery.flush();await editor.workspaceAutosave.flush();return{json:JSON.stringify(editor.document.toJSON()),past:editor.document.getSnapshot().past.length};});await expect(status).toHaveText('Recovery saved locally');
 if(outcome==='close'){await page.evaluate(id=>{const editor=window.luma.editor;(window as unknown as {recoveryStatusClosing:Promise<boolean>}).recoveryStatusClosing=editor.closeDocument(editor.documentSessions.find(session=>session.id===id)!.document,{discardChanges:true});},first);expect(await page.evaluate(id=>window.luma.editor.documentSessions.some(session=>session.id===id),first)).toBe(true);}
 await releaseSave(page,outcome==='fail');if(outcome==='close')expect(await page.evaluate(()=>(window as unknown as {recoveryStatusClosing:Promise<boolean>}).recoveryStatusClosing)).toBe(true);await expect(status).toHaveText('Recovery saved locally');await expect(page.getByRole('textbox',{name:'Document name',exact:true})).toHaveValue('Independent status');expect(await page.evaluate(()=>({json:JSON.stringify(window.luma.editor.document.toJSON()),past:window.luma.editor.document.getSnapshot().past.length}))).toEqual(second);
 if(outcome!=='close'){
  await page.evaluate(id=>{const editor=window.luma.editor;editor.activateDocument(editor.documentSessions.find(session=>session.id===id)!.document);},first);
  if(outcome==='fail'){await expect(status).toContainText('Recovery unavailable');await expect(status).toContainText('storage is full');await page.evaluate(()=>window.luma.editor.recovery.flush());}
  await expect(status).toHaveText('Project downloaded');await expect(status).toHaveAttribute('title','Recovery saved locally');
 }else expect(await page.evaluate(id=>window.luma.editor.documentSessions.some(session=>session.id===id),first)).toBe(false);
 await info.attach('recovery-session-status',{body:JSON.stringify({outcome,activeArtworkExact:true,inactiveStatusNeverLeaked:true,downloadAndErrorPriorityPreserved:true}),contentType:'application/json'});
});
