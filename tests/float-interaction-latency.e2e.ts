import {test,expect} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';

// References are independently generated complete native scenes from the
// palette corpus. Only their declared 131x79 top-left region is read back.
// The readback timestamp includes verification/flush overhead; neither timing
// is a physical display/compositor measurement.
for(const kind of ['lut','gradient-map']as const)test(`float ${kind} controls record matching model and independently checked canvas pixels`,async({page},info)=>{
 const directory='tests/fixtures/float-palette/',manifest=JSON.parse(await readFile(directory+'manifest.json','utf8')),indices=kind==='lut'?[16,18]:[2,3],references:number[][]=[];
 for(const index of indices){
  const scene=manifest.scenes.find((row:any)=>row.source==='u16-all-levels.tif'&&row.name==='palette-'+index),raw=gunzipSync(await readFile(directory+scene.reference)),values=new Float32Array(new Uint8Array(raw).buffer),bytes:number[]=[];
  for(let i=0;i<values.length;i++){
   if(i%4===3){expect(values[i]).toBe(1);bytes.push(255);continue;}
   const value=Math.max(0,Math.min(1,values[i]));bytes.push(Math.round(255*(value<=.0031308?12.92*value:1.055*value**(1/2.4)-.055)));
  }
  references.push(bytes);
 }
 expect(references[0].filter((v,i)=>i%4!==3&&Math.abs(v-references[1][i])>2).length).toBeGreaterThan(1000);
 const original=await readFile('tests/fixtures/uint16-float/u16-all-levels.tif'),originalSha256=createHash('sha256').update(original).digest('hex');
 await page.goto('/');await page.waitForFunction(()=>!!window.luma?.editor);
 const fixture=await page.evaluate(async({bytes,adjustment})=>{
  const{editor,AdjustmentLayer}=window.luma;await editor.openTiff(new File([new Uint8Array(bytes)],'u16-all-levels.tif',{type:'image/tiff'}),{editingPrecision:'float32'});
  const layer=editor.document.layers.add(new AdjustmentLayer({name:'Float timing control',adjustment}));editor.document.selectedLayer=layer;
  return{id:layer.id,sourceId:editor.assetStore.values()[0].id};
 },{bytes:[...original],adjustment:manifest.cases[kind==='lut'?17:2].adjustment});
 await page.keyboard.press('Control+1');await expect(page.getByTestId('artwork')).toHaveJSProperty('width',256);await expect(page.getByTestId('artwork')).toHaveJSProperty('height',256);await expect(page.locator('footer .status-dot.working')).toHaveCount(0);
 const before=await page.evaluate(()=>JSON.stringify(window.luma.editor.document.toJSON())),initialRevision=await page.evaluate(()=>window.luma.editor.document.getSnapshot().revision);
 await page.evaluate(({kind,id,references})=>{
  const e=window.luma.editor,state={pending:null as null|{index:number;value:number|boolean;start:number},samples:[]as {value:number|boolean;copyMs:number;verifiedReadbackMs:number;waitBeforePrepareMs:number;prepareMs:number;backend:string;maximumColorError:number}[],longTasks:[]as {start:number;duration:number}[],mismatches:[]as {value:number|boolean;maximumColorError:number}[],errors:[]as string[]};
  (window as any).floatInputTiming=state;
  const observer=new PerformanceObserver(list=>{for(const row of list.getEntries())state.longTasks.push({start:row.startTime,duration:row.duration});});observer.observe({type:'longtask'});(window as any).floatInputObserver=observer;
  const begin=(event:Event)=>{
   const p=state.pending;if(!p||p.start)return;const target=event.target as HTMLInputElement;
   if(kind==='lut'&&event instanceof KeyboardEvent&&['Home','End'].includes(event.key)&&target.getAttribute('aria-label')==='LUT amount')p.start=performance.now();
   if(kind==='gradient-map'&&event.type==='click'&&target.getAttribute('aria-label')==='Reverse gradient map')p.start=performance.now();
  };
  window.addEventListener('keydown',begin,true);window.addEventListener('click',begin,true);
  const prepare=e.renderer.prepareViewport.bind(e.renderer);
  e.renderer.prepareViewport=async(...args)=>{
   const pending=state.pending,layer=args[0].children.find(row=>row.id===id),matched=pending&&layer?.kind==='adjustment'&&(layer.adjustment.kind==='lut'?layer.adjustment.amount:layer.adjustment.kind==='gradient-map'?layer.adjustment.reverse:null)===pending.value,started=performance.now(),frame=await prepare(...args),prepared=performance.now(),present=frame.present.bind(frame);
   frame.present=canvas=>{
    present(canvas);const copied=performance.now();if(!matched||!pending?.start||state.pending!==pending)return;
    if(canvas.width!==256||canvas.height!==256){state.errors.push('Unexpected viewport geometry');return;}
    const actual=canvas.getContext('2d')!.getImageData(0,0,131,79).data,expected=references[pending.index];let maximum=0,alphaDifferent=0;
    for(let i=0;i<actual.length;i++)if(i%4===3){if(actual[i]!==expected[i])alphaDifferent++;}else maximum=Math.max(maximum,Math.abs(actual[i]-expected[i]));
    if(maximum>1||alphaDifferent){state.mismatches.push({value:pending.value,maximumColorError:maximum});return;}
    state.samples.push({value:pending.value,copyMs:copied-pending.start,verifiedReadbackMs:performance.now()-pending.start,waitBeforePrepareMs:started-pending.start,prepareMs:prepared-started,backend:frame.backend,maximumColorError:maximum});state.pending=null;
   };return frame;
  };
 },{kind,id:fixture.id,references});
 const slider=page.getByRole('slider',{name:'LUT amount',exact:true});if(kind==='lut')await slider.focus();
 for(let i=0;i<20;i++){
  const index=kind==='lut'?i%2:1-i%2,value=kind==='lut'?index*100:!!index;
  await page.evaluate(({index,value})=>{(window as any).floatInputTiming.pending={index,value,start:0};},{index,value});
  if(kind==='lut')await page.keyboard.down(index?'End':'Home');else await page.getByRole('checkbox',{name:'Reverse gradient map',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).floatInputTiming.samples.length)).toBe(i+1);
  if(kind==='lut')await page.keyboard.up(index?'End':'Home');
  await expect.poll(()=>page.evaluate(()=>window.luma.editor.document.getSnapshot().revision)).toBe(initialRevision+i+1);await expect(page.locator('footer .status-dot.working')).toHaveCount(0);
 }
 const result=await page.evaluate(async({sourceId})=>{
  const observer=(window as any).floatInputObserver as PerformanceObserver,state=(window as any).floatInputTiming;state.longTasks.push(...observer.takeRecords().map(row=>({start:row.startTime,duration:row.duration})));observer.disconnect();
  const asset=window.luma.editor.assetStore.get(sourceId),hash=await crypto.subtle.digest('SHA-256',await asset.blob.arrayBuffer());return{...state,dimensions:[window.luma.editor.document.width,window.luma.editor.document.height],originalSha256:[...new Uint8Array(hash)].map(v=>v.toString(16).padStart(2,'0')).join('')};
 },{sourceId:fixture.sourceId});
 expect(result.samples).toHaveLength(20);expect(result.errors).toEqual([]);expect(result.mismatches).toEqual([]);expect(result.originalSha256).toBe(originalSha256);expect(result.dimensions).toEqual([256,256]);
 await page.evaluate(()=>{for(let i=0;i<20;i++)window.luma.editor.document.undo();});expect(await page.evaluate(()=>JSON.stringify(window.luma.editor.document.toJSON()))).toBe(before);
 const report={kind,sourceSha256:originalSha256,fixtureIndices:indices,...result,limits:['Paced real keyboard/checkbox input, 20 samples on one host.','Copy timestamp follows the matching native frame copy; pixel acknowledgement includes getImageData verification/flush overhead.','Independent reference RGB is encoded with the standard sRGB transfer and compared within one code; alpha is exact.','No physical display latency, sustained 60fps, HDR/wide-gamut quality or whole-editor completion claim.']};
 await writeFile(info.outputPath('float-'+kind+'-latency.json'),JSON.stringify(report,null,2));console.log('float-control-latency',JSON.stringify(report));
});
