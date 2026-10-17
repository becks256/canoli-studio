import {test,expect} from '@playwright/test';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';

const root=process.env.CANOLI_MATTING_DATASET,reportPath=process.env.CANOLI_MATTING_REPORT;
if(!root||!reportPath)throw new Error('Set CANOLI_MATTING_DATASET to the prepared external cache and CANOLI_MATTING_REPORT to its completed candidate report.');
const manifest=JSON.parse(await readFile(join(root,'manifest.json'),'utf8')),candidate=JSON.parse(await readFile(reportPath,'utf8'));
const output=process.env.CANOLI_MATTING_BROWSER_OUTPUT??'/tmp/canoli-matting-natural/browser';await mkdir(output,{recursive:true});
const ids=['GT01-Trimap1','GT04-Trimap2','GT25-Trimap2','GT13-Trimap2'];
for(const id of ids)test(`native photographed ${id} matches the numerical pipeline, preserves source bytes and undoes atomically`,async({page})=>{
  const item=manifest.cases.find((entry:any)=>entry.id===id),record=candidate.cases.find((entry:any)=>entry.id===id);
  expect(record?.status,`${id} needs a completed successful candidate evaluation`).toBe('success');
  const expected=new Uint8Array(await readFile(record.outputs.find((entry:any)=>entry.smoothness===10).path));
  await page.goto('/');await page.getByTestId('import-input').setInputFiles(join(root,item.input));await expect(page.locator('.layer-row')).toHaveCount(1);
  const labels=[...await readFile(join(root,item.trimapAsset))];
  const result=await page.evaluate(async({labels})=>{
    const {editor}=window.luma,target=editor.document.selectedLayer!,sourceId=(target as any).assetId,original=new Uint8Array(await editor.assetStore.get(sourceId).blob.arrayBuffer()),before=editor.document.toJSON(),revision=editor.document.getSnapshot().revision;
    const trimap=await editor.assetStore.add(new Blob([new Uint8Array(labels)],{type:'image/png'}),'Official alpha trimap',undefined,false),progress:any[]=[],longTasks:number[]=[],observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())longTasks.push(entry.duration);});observer.observe({type:'longtask'});let responseMs:number|undefined,queued=false;
    const processorPath='/src/engine/processor.ts',{PixelProcessor}=await import(processorPath),originalSolve=PixelProcessor.prototype.solveMatting;let diagnostics:any;
    PixelProcessor.prototype.solveMatting=async function(this:unknown,...args:any[]){diagnostics=await originalSolve.apply(this,args);return diagnostics;};
    const at=performance.now();try{await target.refineEdge({trimapAssetId:trimap.id},{onProgress:state=>{progress.push(state);if(state.phase==='solve'&&(state.iteration??0)>0&&!queued){queued=true;const start=performance.now();setTimeout(()=>{(document.querySelector('button[aria-label="Hand tool (H)"]') as HTMLButtonElement).click();responseMs=performance.now()-start;},0);}}});}finally{PixelProcessor.prototype.solveMatting=originalSolve;}const elapsedMs=performance.now()-at,revisionDelta=editor.document.getSnapshot().revision-revision;await new Promise(resolve=>setTimeout(resolve,0));for(const entry of observer.takeRecords())longTasks.push(entry.duration);observer.disconnect();
    const asset=editor.assetStore.get(target.mask!.assetId!),canvas=document.createElement('canvas');canvas.width=asset.width;canvas.height=asset.height;const c=canvas.getContext('2d')!;c.drawImage(asset.bitmap,0,0);const alpha=Array.from(c.getImageData(0,0,asset.width,asset.height).data).filter((_,i)=>i%4===3),after=editor.document.toJSON(),bytes=new Uint8Array(await editor.assetStore.get(sourceId).blob.arrayBuffer());editor.document.undo();const undone=editor.document.toJSON();editor.document.redo();return{diagnostics,before,after,undone,redone:editor.document.toJSON(),alpha,width:asset.width,height:asset.height,elapsedMs,responseMs,revisionDelta,longTasks,solveLast:progress.filter(state=>state.phase==='solve').at(-1),sourceUnchanged:original.length===bytes.length&&original.every((value,i)=>value===bytes[i])};
  },{labels});
  expect(result.diagnostics.iterationBackend).toBe('wasm');expect(result.diagnostics.iterationBytes).toBeGreaterThan(0);expect(result.diagnostics.estimatedGraphBytes).toBeLessThanOrEqual(192*1024*1024);
  const differences=result.alpha.map((value,i)=>Math.abs(value-expected[i])),maximumByteError=differences.reduce((largest,value)=>Math.max(largest,value),0),meanByteError=differences.reduce((a,b)=>a+b,0)/differences.length;
  expect([result.width,result.height]).toEqual([item.width,item.height]);expect(maximumByteError).toBeLessThanOrEqual(1);expect(meanByteError).toBeLessThan(.02);expect(result.revisionDelta).toBe(1);expect(result.sourceUnchanged).toBe(true);expect(result.undone).toEqual(result.before);expect(result.redone).toEqual(result.after);expect(result.solveLast.relativeResidual).toBeLessThanOrEqual(record.diagnostics.coarseBlocks?1e-9:1e-7);expect(result.responseMs).toBeLessThan(250);
  await writeFile(join(output,id+'.json'),JSON.stringify({...result,before:undefined,after:undefined,undone:undefined,redone:undefined,alpha:undefined,maximumByteError,meanByteError},null,2));
  // Captures stay local alongside the downloaded research data.
  if(id==='GT04-Trimap2')await page.screenshot({path:join(output,'photographed-hair-result.png')});
});

test('a photographed isolated-script job either commits completely within its budget or times out without private asset leakage',async({page})=>{
 const item=manifest.cases.find((entry:any)=>entry.id==='GT04-Trimap2');await page.goto('/');await page.getByTestId('import-input').setInputFiles(join(root,item.input));await expect(page.locator('.layer-row')).toHaveCount(1);const labels=[...await readFile(join(root,item.trimapAsset))];
 const result=await page.evaluate(async labels=>{
  const {editor}=window.luma,trimap=await editor.assetStore.add(new Blob([new Uint8Array(labels)],{type:'image/png'}),'Trimap',undefined,false),before=editor.document.toJSON(),count=editor.assetStore.values().length;let error='';const at=performance.now();try{await editor.runScript(`await document.selectedLayer.refineEdge({trimapAssetId:${JSON.stringify(trimap.id)}});print('Native photo ready');`);}catch(cause){error=String(cause);}await new Promise(resolve=>setTimeout(resolve,150));return{error,before,after:editor.document.toJSON(),count,afterCount:editor.assetStore.values().length,elapsedMs:performance.now()-at};
 },labels);
 if(result.error){expect(result.error).toContain('5-second time limit');expect(result.after).toEqual(result.before);expect(result.afterCount).toBe(result.count);}else{expect(result.after.children[0].mask?.kind).toBe('bitmap');expect(result.afterCount).toBe(result.count+1);}
 await writeFile(resolve(output,'isolated-photo-budget.json'),JSON.stringify({...result,before:undefined,after:undefined},null,2));
});
