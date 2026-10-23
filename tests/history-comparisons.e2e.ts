import {test,expect} from '@playwright/test';
import {gunzipSync} from 'node:zlib';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {historyComparisonsWorkflow,comparisonImage} from './helpers/history-comparisons';
import {historyProject,historyPng,openHistoryInspector} from './helpers/history-inspector';
test('saved comparison regions retain alternatives and restore editable states through native UI',async({page},info)=>{await historyComparisonsWorkflow(page,info);});
test('saved regions clip off-canvas artwork to each historical canvas before measuring displayed differences',async({page},info)=>{
 await page.goto('/');await expect(page.getByRole('button',{name:'History',exact:true})).toBeVisible();
 const result=await page.evaluate(async()=>{
  const {editor,PaintLayer,PaintFill}=window.luma;editor.newDocument({width:60,height:20});const doc=editor.document;
  const layer=doc.layers.add(new PaintLayer());layer.strokes.add(new PaintFill({bounds:{x:0,y:0,width:120,height:20},color:'#ff0000'}));doc.resize(120,20);
  const id=doc.createHistoryComparison('Canvas edge',{kind:'timeline',position:2},{kind:'current'},{x:60,y:0,width:60,height:20}),revision=doc.getSnapshot().revision;
  const value=await editor.previewHistoryComparison(id);const sample=async(blob:Blob)=>{const image=await createImageBitmap(blob),canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const context=canvas.getContext('2d')!;context.drawImage(image,0,0);image.close();return [...context.getImageData(0,0,1,1).data];};
  return {before:await sample(value.before),after:await sample(value.after),difference:await sample(value.difference),statistics:value.statistics,revisionBefore:revision,revisionAfter:doc.getSnapshot().revision};
 });
 expect(result.before).toEqual([0,0,0,0]);expect(result.after).toEqual([255,0,0,255]);expect(result.difference).toEqual([255,0,255,255]);expect(result.statistics).toEqual({comparedPixels:1200,changedPixels:1200,maximumChannelDelta:255,meanAbsoluteChannelDelta:127.5});expect(result.revisionAfter).toBe(result.revisionBefore);
 const dialog=await openHistoryInspector(page);await dialog.getByRole('button',{name:'Preview saved comparison',exact:true}).click();await expect(dialog.getByRole('img',{name:'Saved comparison difference',exact:true})).toBeVisible();await comparisonImage(page,info,'Saved comparison before','comparison-clipped-before.png');await comparisonImage(page,info,'Saved comparison after','comparison-clipped-after.png');
});
test('comparison previews cancel and release privately leased sources when the owner closes',async({page})=>{
 await page.goto('/');await expect(page.getByRole('button',{name:'History',exact:true})).toBeVisible();
 const result=await page.evaluate(async()=>{
  const {editor}=window.luma;editor.newDocument({width:16,height:16});const canvas=document.createElement('canvas');canvas.width=canvas.height=16;canvas.getContext('2d')!.fillRect(0,0,16,16);
  const blob=await new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!)));await editor.importImage(new File([blob],'source.png',{type:'image/png'}));const doc=editor.document,id=doc.createHistoryComparison('Private lease',{kind:'current'},{kind:'current'}),bitmap=editor.assetStore.values()[0].bitmap;
  const native=HTMLCanvasElement.prototype.toBlob;let enter!:()=>void,finish!:()=>void;const ready=new Promise<void>(resolve=>{enter=resolve;});
  HTMLCanvasElement.prototype.toBlob=function(callback,...args){if(this.width===16&&this.height===16)native.call(this,value=>{finish=()=>callback(value);enter();},...args);else native.call(this,callback,...args);};
  const pending=editor.previewHistoryComparison(id).then(()=>'Unexpected success',cause=>String(cause));
  try{await ready;editor.newDocument({width:16,height:16});await editor.closeDocument(doc,{discardChanges:true});const held=bitmap.width;finish();const error=await pending;return {held,released:bitmap.width,error};}finally{HTMLCanvasElement.prototype.toBlob=native;}
 });expect(result.held).toBe(16);expect(result.released).toBe(0);expect(result.error).toContain('History changed');
});
test('isolated comparison mutations roll back all preceding commands and leave host comparisons untouched',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();const before=await page.evaluate(()=>window.luma.editor.document.toJSON());
 for(const call of ["createHistoryComparison('Bad',{kind:'current'},{kind:'current'})","updateHistoryComparison('bad',{name:'Bad'})","deleteHistoryComparison('bad')","createHistoryBranchFromComparison('bad','before','Bad')"]){
  await page.getByLabel('Script code',{exact:true}).fill("document.name='Must roll back';document."+call);await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('Use editor history comparisons after a script finishes.');expect(await page.evaluate(()=>window.luma.editor.document.toJSON())).toEqual(before);
 }
});
test('stale comparison captures reject metadata changes and pinned restores invalidate active recording',async({page})=>{
 await page.goto('/');await expect(page.getByRole('button',{name:'History',exact:true})).toBeVisible();const dialog=await openHistoryInspector(page);await dialog.getByText('Save a new comparison',{exact:true}).click();await dialog.getByLabel('New comparison name',{exact:true}).fill('Pinned');
 await page.evaluate(()=>{window.luma.editor.document.name='Concurrent edit';});await dialog.getByRole('button',{name:'Save new comparison',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('History changed');expect(await page.evaluate(()=>window.luma.editor.document.getSnapshot().comparisons)).toEqual([]);
 await dialog.getByRole('button',{name:'Reload history timeline',exact:true}).click();await dialog.getByRole('button',{name:'Save new comparison',exact:true}).click();await dialog.getByRole('button',{name:'Done',exact:true}).click();
 const result=await page.evaluate(()=>{const {editor}=window.luma;editor.recipes.recorder.start();editor.document.createHistoryComparison('Second',{kind:'current'},{kind:'current'});const before=editor.recipes.recorder.getUnsupportedCommands();editor.document.createHistoryBranchFromComparison(editor.document.getSnapshot().comparisons[0].id,'before','Continue');return {before,after:editor.recipes.recorder.getUnsupportedCommands()};});expect(result.before).toEqual([]);expect(result.after.join(' ')).toMatch(/branch switched/);
});
test('50 MP RAW originals retained only by saved comparisons survive recovery, native reopen and editable continuation',async({page},info)=>{
 test.setTimeout(480000);const path=info.outputPath('comparison-50mp.dng');await writeFile(path,gunzipSync(await readFile('tests/fixtures/raw/native-50mp.dng.gz')));
 await page.goto('/');await page.getByTestId('import-input').setInputFiles(path);const review=page.getByRole('dialog',{name:'Import camera RAW',exact:true});await review.getByRole('checkbox',{name:'Convert RAW development to 8-bit editing precision',exact:true}).check();await review.getByRole('button',{name:'Import RAW image',exact:true}).click();await expect(review).toHaveCount(0,{timeout:180000});
 const captured=await page.evaluate(async()=>{const {editor}=window.luma,doc=editor.document,position=doc.getSnapshot().past.length;doc.layers.at(0)!.remove();doc.createHistoryComparison('Original versus empty',{kind:'timeline',position},{kind:'current'});for(let i=0;i<65;i++)doc.name=`Empty ${i}`;const state=doc.getSnapshot();editor.workspaceRepository.restoreOnStartup=true;await editor.workspaceAutosave.flush();return {branches:state.branches.length,linearHasRaster:[state.document,...state.past.map(value=>value.document),...state.future.map(value=>value.document)].some(value=>value.children.length)};});expect(captured).toEqual({branches:0,linearHasRaster:false});
 await page.reload();await expect(page.getByRole('button',{name:'History',exact:true})).toBeVisible();const saved=await historyProject(page,info,'comparisons-50mp.luma');expect(saved.value.history?.version).toBe(3);if(saved.value.history?.version!==3)throw Error('Missing comparisons');expect(saved.value.history.branches).toEqual([]);expect(saved.value.document.children).toEqual([]);
 const source=saved.value.entries.find(value=>value.raw)!.raw!.originalBlob;expect(source.size).toBe(100000672);expect(createHash('sha256').update(Buffer.from(await source.arrayBuffer())).digest('hex')).toBe('cfe25bed379735dfea685695e956838b284106e6527e6aff77e3901ef6ef9d85');
 await page.getByTestId('project-input').setInputFiles(saved.path);const dialog=await openHistoryInspector(page);await dialog.getByRole('button',{name:'Preview saved comparison',exact:true}).click();await expect(dialog.getByRole('img',{name:'Saved comparison difference',exact:true})).toBeVisible();
 await dialog.getByLabel('Comparison branch name',{exact:true}).fill('Original restored');await dialog.getByRole('button',{name:'Continue before as branch',exact:true}).click();await dialog.getByRole('button',{name:'Done',exact:true}).click();
 expect(await page.evaluate(()=>[window.luma.editor.document.width,window.luma.editor.document.height,window.luma.editor.document.layers.length])).toEqual([10000,5000,1]);const png=await historyPng(page,info,'comparisons-50mp.png');await info.attach('comparisons-50mp.png',{body:png.bytes,contentType:'image/png'});
});
