import {test,expect,type Page} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';

const reference=JSON.parse(await readFile('tests/fixtures/matting/closed-form-reference.json','utf8')) as {cases:{name:string;width:number;height:number;alpha:number[]}[]};
async function source(page:Page,name='wide-unknown'){
  await page.goto('/');await page.getByTestId('import-input').setInputFiles(`tests/fixtures/matting/closed-form-${name}.png`);await expect(page.locator('.layer-row')).toHaveCount(1);
  const bytes=await readFile(`tests/fixtures/matting/closed-form-${name}-trimap.png`);return page.evaluate(async bytes=>{const asset=await window.luma.editor.assetStore.add(new Blob([new Uint8Array(bytes)],{type:'image/png'}),'Trimap',undefined,false);return asset.id;},[...bytes]);
}

test('the default native global solver matches independent bytes, retains one-entry history and exports a real soft matte',async({page})=>{
  const trimapAssetId=await source(page),fixture=reference.cases.find(item=>item.name==='wide-unknown')!;
  const result=await page.evaluate(async trimapAssetId=>{
    const {editor}=window.luma,source=editor.document.selectedLayer!,before=editor.document.toJSON(),progress:any[]=[];
    await source.refineEdge({smoothness:0,trimapAssetId,decontaminate:true},{onProgress:value=>progress.push(value)});
    const after=editor.document.toJSON(),target=editor.document.selectedLayer!,asset=editor.assetStore.get(target.mask!.assetId!),canvas=document.createElement('canvas');canvas.width=asset.width;canvas.height=asset.height;const c=canvas.getContext('2d')!;c.drawImage(asset.bitmap,0,0);const mask=Array.from(c.getImageData(0,0,asset.width,asset.height).data).filter((_,i)=>i%4===3);c.clearRect(0,0,canvas.width,canvas.height);c.drawImage(editor.assetStore.get((source as any).assetId).bitmap,0,0);const originalRgb=c.getImageData(0,0,canvas.width,canvas.height).data;c.clearRect(0,0,canvas.width,canvas.height);c.drawImage(editor.assetStore.get((target as any).assetId).bitmap,0,0);const correctedRgb=c.getImageData(0,0,canvas.width,canvas.height).data,changedRgb=correctedRgb.some((value,i)=>i%4!==3&&value!==originalRgb[i]),intrinsicAlphaPreserved=correctedRgb.every((value,i)=>i%4!==3||value===originalRgb[i]);
    const image=await createImageBitmap(await editor.exportPng());c.clearRect(0,0,canvas.width,canvas.height);c.drawImage(image,0,0);image.close();const exported=Array.from(c.getImageData(0,0,canvas.width,canvas.height).data).filter((_,i)=>i%4===3);editor.document.undo();return{before,after,undone:editor.document.toJSON(),mask,exported,progress,changedRgb,intrinsicAlphaPreserved};
  },trimapAssetId);
  const errors=result.mask.map((value,i)=>Math.abs(value-fixture.alpha[i]));expect(Math.max(...errors)).toBeLessThanOrEqual(1);expect(errors.reduce((a,b)=>a+b,0)/errors.length).toBeLessThan(.02);expect(result.exported).toEqual(result.mask);expect(result.undone).toEqual(result.before);expect(result.after.children[0].visible).toBe(false);expect(result.after.children[1].mask?.kind).toBe('bitmap');expect(result.changedRgb).toBe(true);expect(result.intrinsicAlphaPreserved).toBe(true);expect(new Set(result.progress.map(value=>value.phase))).toEqual(new Set(['capture','solve','encode']));expect(result.progress.filter(value=>value.phase==='solve').at(-1).relativeResidual).toBeLessThanOrEqual(1e-7);
});

test('the documented global solver example runs in isolation and a later script error discards its private assets',async({page})=>{
  await source(page);const guide=await readFile('docs/SCRIPTING_API.md','utf8'),script=guide.match(/<!-- example: closed-form-matting -->\s*```js\n([\s\S]*?)\n```/)?.[1];expect(script).toBeTruthy();
  const result=await page.evaluate(async script=>{
    const {editor,MarqueeSelection}=window.luma;editor.document.selection=new MarqueeSelection({shape:'rectangle',x:0,y:0,width:32,height:9});const before=editor.document.toJSON(),count=editor.assetStore.values().length;
    let error='';try{await editor.runScript(script+'\nthrow new Error("Later global failure");');}catch(cause){error=String(cause);}const failed=editor.document.toJSON(),failedCount=editor.assetStore.values().length;
    const output=await editor.runScript(script!);const after=editor.document.toJSON();editor.document.undo();return{before,failed,after,undone:editor.document.toJSON(),count,failedCount,error,output};
  },script);expect(result.error).toContain('Later global failure');expect(result.failed).toEqual(result.before);expect(result.failedCount).toBe(result.count);expect(result.after.children[0].mask?.kind).toBe('bitmap');expect(result.undone).toEqual(result.before);
});

test('cancelling during actual global iterations leaves source, assets and history intact',async({page})=>{
  const trimapAssetId=await source(page,'synthetic-fine-strands'),result=await page.evaluate(async trimapAssetId=>{
    const {editor}=window.luma,before=editor.document.toJSON(),assets=editor.assetStore.values().length,abort=new AbortController();let iteration=-1,error='';
    try{await editor.refineEdge({smoothness:0,trimapAssetId},{signal:abort.signal,onProgress:progress=>{if(progress.phase==='solve'&&(progress.iteration??0)>0){iteration=progress.iteration!;abort.abort();}}});}catch(cause){error=String(cause);}
    await new Promise(resolve=>setTimeout(resolve,150));return{before,after:editor.document.toJSON(),assets,afterAssets:editor.assetStore.values().length,iteration,error};
  },trimapAssetId);expect(result.iteration).toBeGreaterThan(0);expect(result.error).toBeTruthy();expect(result.after).toEqual(result.before);expect(result.afterAssets).toBe(result.assets);
});

test('the genuine graph allocation budget rejects a large unknown system without capping image imports or committing assets',async({page})=>{
  await page.goto('/');const result=await page.evaluate(async()=>{
    const {editor}=window.luma;editor.newDocument({width:1024,height:512});const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=512;const c=canvas.getContext('2d')!;c.fillStyle='#336699';c.fillRect(0,0,1024,512);const blob=()=>new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!),'image/png'));
    await editor.importImage(new File([await blob()],'unknown-system.png',{type:'image/png'}));const image=c.createImageData(1024,512);for(let y=0;y<512;y++)for(let x=0;x<1024;x++){const i=(y*1024+x)*4;image.data[i]=image.data[i+1]=image.data[i+2]=255;image.data[i+3]=x<2?255:x>1021?0:128;}c.putImageData(image,0,0);const trimap=await editor.assetStore.add(await blob(),'Trimap',undefined,false),before=editor.document.toJSON(),count=editor.assetStore.values().length;
    let error='';try{await editor.refineEdge({trimapAssetId:trimap.id,smoothness:0});}catch(cause){error=String(cause);}return{before,after:editor.document.toJSON(),count,afterCount:editor.assetStore.values().length,error};
  });expect(result.error).toContain('graph working budget');expect(result.after).toEqual(result.before);expect(result.afterCount).toBe(result.count);
});

test('the native 50 MP global solve carries distant constraints across horizontal and vertical capture seams',async({page})=>{
  await page.goto('/');await page.getByTestId('import-input').setInputFiles('tests/fixtures/matting/closed-form-native-50mp.png');await expect(page.locator('.layer-row')).toHaveCount(1);
  const bytes=await readFile('tests/fixtures/matting/closed-form-native-50mp-trimap.png'),fixture=reference.cases.find(item=>item.name==='distant-native-patch')!;
  const result=await page.evaluate(async bytes=>{
    const {editor}=window.luma,trimap=await editor.assetStore.add(new Blob([new Uint8Array(bytes)],{type:'image/png'}),'Native trimap',undefined,false),source=editor.document.selectedLayer!,original=(source as any).assetId,sourceBytes=new Uint8Array(await editor.assetStore.get(original).blob.arrayBuffer()),revision=editor.document.getSnapshot().revision;
    const progress:any[]=[],longTasks:{start:number;duration:number}[]=[],observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())longTasks.push({start:entry.startTime,duration:entry.duration});});observer.observe({type:'longtask'});let inputResponseMs:number|undefined,queued=false;
    const start=performance.now();await source.refineEdge({trimapAssetId:trimap.id,smoothness:0},{onProgress:value=>{progress.push(value);if(value.phase==='solve'&&(value.iteration??0)>0&&!queued){queued=true;const at=performance.now();setTimeout(()=>{(document.querySelector('button[aria-label="Hand tool (H)"]') as HTMLButtonElement).click();inputResponseMs=performance.now()-at;},0);}}});
    const elapsedMs=performance.now()-start;await new Promise(resolve=>setTimeout(resolve,0));for(const entry of observer.takeRecords())longTasks.push({start:entry.startTime,duration:entry.duration});observer.disconnect();const revisionDelta=editor.document.getSnapshot().revision-revision,output=editor.assetStore.get(source.mask!.assetId!),canvas=document.createElement('canvas');canvas.width=601;canvas.height=9;const c=canvas.getContext('2d')!;c.drawImage(output.bitmap,480,4604,601,9,0,0,601,9);const alpha=Array.from(c.getImageData(0,0,601,9).data).filter((_,i)=>i%4===3),project=await editor.saveProject(),saved=editor.document.toJSON();await editor.openProject(new File([project],'global-native.luma'));const restoredBytes=new Uint8Array(await editor.assetStore.get(original).blob.arrayBuffer());
    return{elapsedMs,width:output.width,height:output.height,revisionDelta,alpha,inputResponseMs,progressFirst:progress[0],progressLast:progress.at(-1),solveLast:progress.filter(item=>item.phase==='solve').at(-1),longTasks:longTasks.filter(item=>item.start>=start&&item.start<=start+elapsedMs),sourceUnchanged:sourceBytes.length===restoredBytes.length&&sourceBytes.every((value,i)=>value===restoredBytes[i]),projectRestored:JSON.stringify(saved)===JSON.stringify(editor.document.toJSON())};
  },[...bytes]);
  const expected:number[]=[];for(let y=1;y<10;y++)for(let x=1;x<602;x++)expected.push(fixture.alpha[y*603+x]);const errors=result.alpha.map((value,i)=>Math.abs(value-expected[i]));expect(Math.max(...errors)).toBeLessThanOrEqual(1);expect(errors.reduce((a,b)=>a+b,0)/errors.length).toBeLessThan(.02);expect([result.width,result.height]).toEqual([10000,5000]);expect(result.revisionDelta).toBe(1);expect(result.sourceUnchanged).toBe(true);expect(result.projectRestored).toBe(true);expect(result.inputResponseMs).toBeLessThan(250);expect(result.solveLast.iteration).toBeGreaterThan(0);expect(result.solveLast.relativeResidual).toBeLessThanOrEqual(1e-7);expect(result.progressLast.completed).toBe(result.progressLast.total);
  await writeFile('/tmp/canoli-closed-form-native50.json',JSON.stringify({...result,alpha:undefined,maximumByteError:Math.max(...errors),meanByteError:errors.reduce((a,b)=>a+b,0)/errors.length}));console.log('50 MP global closed-form matting',JSON.stringify({...result,alpha:undefined}));
});
