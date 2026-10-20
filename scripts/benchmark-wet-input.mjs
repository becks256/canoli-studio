/** Normal-production pointer-to-matching-canvas-copy proxy. No editor globals. */
import {chromium} from '@playwright/test';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {cpus,platform,arch} from 'node:os';
import {join} from 'node:path';
import {readProject} from '../src/core/project.ts';

const corpus=['mixer-layer','smudge-layer','mixer-mask','smudge-mask','mixer-filter-mask','smudge-filter-mask'].map(id=>({id,tool:id.startsWith('mixer')?'mixer':'smudge',target:id.endsWith('filter-mask')?'filter-mask':id.endsWith('mask')?'mask':'layer'}));
const selected=process.env.CANOLI_WET_INPUT_CASES?.split(',');
if(selected?.some(id=>!corpus.some(f=>f.id===id)))throw new Error('Unknown CANOLI_WET_INPUT_CASES fixture.');
const fixtures=corpus.filter(f=>!selected||selected.includes(f.id));
const output=process.env.CANOLI_WET_INPUT_OUTPUT??`/tmp/canoli-wet-input-${Date.now()}`;
const baseURL=process.env.CANOLI_WET_INPUT_URL??'http://127.0.0.1:4173/';
const profiled=process.env.CANOLI_WET_INPUT_PROFILE==='1';
const diagnostic=profiled||process.env.CANOLI_WET_INPUT_DIAGNOSTIC==='1';
await mkdir(output,{recursive:false});
const save=(name,value)=>writeFile(join(output,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const sha=value=>createHash('sha256').update(value).digest('hex');
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
const reports=[];
try{
 for(const fixture of fixtures){
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  let hooked=false;
  try{
   await page.goto(baseURL);
   if(await page.evaluate(()=>'luma'in window))throw new Error('Use a normal production build without developer globals.');
   const source=`document.resize(512,128);
    ${fixture.target==='filter-mask'?`const master=new Document({width:512,height:128});const paint=master.layers.add(new PaintLayer());paint.strokes.add(new PaintFill({bounds:{x:0,y:0,width:512,height:128},color:'#404040'}));const layer=document.placeSmartObject(document.defineComponent(master));layer.addFilter(new SmartToneFilter({exposure:1}));`:`const layer=document.layers.add(new PaintLayer());layer.strokes.add(new PaintFill({bounds:{x:0,y:0,width:512,height:128},color:'#0000ff'}));`}
    layer.name='Measured wet stroke';
    ${fixture.target!=='layer'?`layer.${fixture.target==='mask'?'mask':'filterMask'}=new LayerMask({base:1})${fixture.tool==='smudge'?`.paint(new PencilStroke({points:[{x:36,y:64}],size:16,pressureSize:false}),'hide')`:''};`:fixture.tool==='smudge'?`layer.strokes.add(new PaintFill({bounds:{x:28,y:56,width:16,height:16},color:'#ff0000'}));`:''}
    document.selectedLayer=layer;print('Wet input fixture ready');`;
   await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();
   await page.getByLabel('Script code',{exact:true}).fill(source);
   await page.getByRole('button',{name:'Run script',exact:true}).click();
   try{await page.getByLabel('Script output').filter({hasText:'Wet input fixture ready'}).waitFor();}
   catch(error){throw new Error(`Failed fixture ${fixture.id}: ${await page.getByLabel('Script output').innerText()}`,{cause:error});}
   await page.getByRole('button',{name:'Close scripts',exact:true}).click();
   await page.getByRole('button',{name:fixture.tool==='mixer'?'Mixer brush':'Smudge tool',exact:true}).click();
   if(fixture.target!=='layer')await page.getByRole('combobox',{name:'Paint target',exact:true}).selectOption(fixture.target==='mask'?'mask-hide':'filter-mask-hide');
   const values=[['Size',8],['Hardness',100],['Tool opacity',100],['Flow',100],['Smoothing',0],['Wetness',0],['Pickup',0],[fixture.target==='layer'?'Initial foreground load':'Initial coverage load',fixture.tool==='mixer'?100:0]];
   for(const [label,value]of values){const field=page.getByRole('spinbutton',{name:`${label} value`,exact:true});await field.fill(String(value));await field.press('Enter');}
   await page.getByLabel('Pressure controls size',{exact:true}).uncheck();await page.getByLabel('Pressure controls opacity',{exact:true}).uncheck();
   if(fixture.target==='layer')await page.getByLabel('Foreground color',{exact:true}).fill('#ff0000');
   await page.getByLabel('Editing canvas',{exact:true}).focus();await page.keyboard.press('Control+1');
   const idle=()=>page.waitForFunction(()=>!document.querySelector('footer .status-dot.working'));
   await idle();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   if(!(await page.locator('footer').textContent())?.includes('Standard rendering'))throw new Error('Canvas-copy measurement requires displayed Standard rendering.');
   const project=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Save project',exact:true}).click();const file=join(output,`${fixture.id}-${name}.luma`);await(await pending).saveAs(file);const bytes=await readFile(file);return{file,sha256:sha(bytes),contents:await readProject(new Blob([new Uint8Array(bytes)]))};};
   const pixels=()=>page.locator('.canvas-wrap canvas[data-testid="artwork"]').evaluate(canvas=>canvas.toDataURL());
   const before=await project('before'),beforePixels=await pixels();
   const box=await page.locator('.canvas-wrap').boundingBox();if(!box||Math.abs(box.width-512)>.1||Math.abs(box.height-128)>.1)throw new Error('Expected actual-size512x128canvas: '+JSON.stringify(box));
   const expected=fixture.target==='layer'?{kind:'pigment',rgb:[255,0,0]}:{kind:'exact',rgba:fixture.target==='mask'?[0,0,0,0]:[64,64,64,255]};
   await page.evaluate(profiled=>{
    const state={pending:null,samples:[],tasks:[],frames:[],first:0,last:0,probes:[],controls:[],failed:null,transactions:[],workerCalls:[]};
    window.canoliWetInput=state;
    const p=CanvasRenderingContext2D.prototype,draw=p.drawImage;
    const entries=list=>list.map(e=>({start:e.startTime,duration:e.duration}));
    const observer=new PerformanceObserver(list=>state.tasks.push(...entries(list.getEntries())));observer.observe({type:'longtask'});
    let raf=0;const frame=at=>{state.frames.push(at);raf=requestAnimationFrame(frame);};raf=requestAnimationFrame(frame);
    const capture=event=>{const pending=state.pending;if(!pending||pending.start||!(event.buttons&1)||!event.target.closest?.('.viewport'))return;if(!event.isTrusted){state.failed='Untrusted pointer event';return;}pending.start=performance.now();pending.clientX=event.clientX;pending.clientY=event.clientY;state.first||=pending.start;};
    window.addEventListener('pointermove',capture,true);
    p.drawImage=function(...args){
     const result=draw.apply(this,args),pending=state.pending;
     if(pending?.start&&this.canvas.isConnected&&this.canvas.matches('canvas[data-testid="artwork"]')&&this.canvas.closest('.canvas-wrap')){
      const copied=performance.now(),probeStart=performance.now(),box=this.canvas.getBoundingClientRect(),x=Math.floor((pending.clientX-box.x)*this.canvas.width/box.width),y=Math.floor((pending.clientY-box.y)*this.canvas.height/box.height);
      if(x>=0&&y>=0&&x<this.canvas.width&&y<this.canvas.height){
       const rgba=Array.from(this.getImageData(x,y,1,1).data);state.probes.push({duration:performance.now()-probeStart,x,y,rgba,copied});
       if(pending.expected.kind==='pigment'?rgba[3]>0&&pending.expected.rgb.every((value,index)=>value===rgba[index]):rgba.every((value,index)=>value===pending.expected.rgba[index])){state.last=copied;state.samples.push({...pending,rgba,copied,duration:copied-pending.start});state.pending=null;}
      }
     }
     return result;
    };
    const restoreProfile=[];
    if(profiled){
     const transaction=IDBDatabase.prototype.transaction;
     IDBDatabase.prototype.transaction=function(...args){
      const value=transaction.apply(this,args);
      if(this.name.startsWith('canoli-wet-job-')){const row={database:this.name,mode:value.mode,start:performance.now(),end:null,status:null};state.transactions.push(row);for(const type of ['complete','abort'])value.addEventListener(type,()=>{row.end=performance.now();row.status=type;},{once:true});}
      return value;
     };
     restoreProfile.push(()=>{IDBDatabase.prototype.transaction=transaction;});
     const post=Worker.prototype.postMessage,pending=new WeakMap(),workers=[];
     Worker.prototype.postMessage=function(...args){
      const message=args[0];
      if(Number.isSafeInteger(message?.id)){
       let requests=pending.get(this);
       if(!requests){requests=new Map();pending.set(this,requests);const receive=event=>{if(event.data?.type==='progress')return;const row=requests.get(event.data?.id);if(row){row.end=performance.now();row.status=event.data.error?'error':'complete';requests.delete(event.data.id);}};this.addEventListener('message',receive);workers.push([this,receive]);}
       const row={id:message.id,operation:Object.keys(message).filter(key=>key!=='id'&&key!=='pixels').join(','),bytes:message.pixels?.byteLength??0,start:performance.now(),end:null,status:null};requests.set(message.id,row);state.workerCalls.push(row);
      }
      return post.apply(this,args);
     };
     restoreProfile.push(()=>{Worker.prototype.postMessage=post;for(const [worker,receive]of workers)worker.removeEventListener('message',receive);});
    }
    state.finish=()=>{state.tasks.push(...entries(observer.takeRecords()));observer.disconnect();cancelAnimationFrame(raf);window.removeEventListener('pointermove',capture,true);p.drawImage=draw;for(const restore of restoreProfile)restore();};
   },profiled);hooked=true;
   await page.evaluate(async()=>{const state=window.canoliWetInput;const start=await new Promise(resolve=>setTimeout(()=>{const at=performance.now();while(performance.now()<at+75){}resolve(at);},0));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));state.controls=state.tasks.filter(task=>task.duration>=50&&task.start<=start+5&&task.start+task.duration>=start+70);if(!state.controls.length)throw new Error('Native long-task positive control was not observed.');});
   await page.mouse.move(box.x+36,box.y+64);await page.mouse.down();
   for(let index=0;index<20;index++){
    const x=48+index*12,y=64;
    const baseline=await page.locator('.canvas-wrap canvas[data-testid="artwork"]').evaluate((canvas,{clientX,clientY})=>{const box=canvas.getBoundingClientRect();return Array.from(canvas.getContext('2d').getImageData(Math.floor((clientX-box.x)*canvas.width/box.width),Math.floor((clientY-box.y)*canvas.height/box.height),1,1).data);},{clientX:box.x+x,clientY:box.y+y});
    if(expected.kind==='pigment'?baseline[3]>0&&expected.rgb.every((value,i)=>value===baseline[i]):baseline.every((value,i)=>value===expected.rgba[i]))throw new Error(`Fixture ${fixture.id} point ${index} already matched before new input.`);
    await page.evaluate(({index,x,y,expected})=>{window.canoliWetInput.pending={index,x,y,expected,start:0};},{index,x,y,expected});
    await page.mouse.move(box.x+x,box.y+y);
    await page.waitForFunction(index=>window.canoliWetInput.failed||window.canoliWetInput.samples.length>index,index,{timeout:30000});
   }
   await page.mouse.up();await idle();
   const observation=await page.evaluate(()=>{const state=window.canoliWetInput;state.finish();return{samples:state.samples,tasks:state.tasks,frames:state.frames,probes:state.probes,controls:state.controls,first:state.first,last:state.last,failed:state.failed,transactions:state.transactions,workerCalls:state.workerCalls};});hooked=false;
   if(observation.failed)throw new Error(observation.failed);
   if(observation.samples.length!==20||observation.samples.some(s=>!s.start||s.duration<0))throw new Error('Missing matched input/presentation samples.');
   if(profiled&&(!observation.transactions.length||!observation.workerCalls.some(row=>row.operation==='wetPaintMix'&&row.status==='complete')))throw new Error('Missing actual private-storage/worker diagnostic observations.');
   const after=await project('after'),layer=after.contents.document.children.find(layer=>layer.name==='Measured wet stroke');
   const operation=fixture.target==='layer'?layer?.kind==='paint'?layer.strokes.at(-1):null:layer?.[fixture.target==='mask'?'mask':'filterMask']?.strokes?.at(-1)?.stroke;
   if(operation?.kind!=='wet')throw new Error('Missing committed wet operation.');
   const pointXs=operation.brush.points.map(point=>point.x),expectedXs=[36,...Array.from({length:20},(_,i)=>48+i*12)];
   if(JSON.stringify(pointXs)!==JSON.stringify(expectedXs))throw new Error(`Recorded points differ: ${JSON.stringify(pointXs)}`);
   const afterPixels=await pixels();if(beforePixels===afterPixels)throw new Error('Stroke did not change displayed pixels.');
   await writeFile(join(output,`${fixture.id}-before.png`),Buffer.from(beforePixels.split(',')[1],'base64'),{flag:'wx'});await writeFile(join(output,`${fixture.id}-after.png`),Buffer.from(afterPixels.split(',')[1],'base64'),{flag:'wx'});
   await page.keyboard.press('Control+z');await idle();const undo=await project('undo');
   if(JSON.stringify(undo.contents.document)!==JSON.stringify(before.contents.document))throw new Error('One undo did not restore exact model.');
   const undoPixels=await pixels();if(undoPixels!==beforePixels)throw new Error('One undo did not restore displayed pixels.');
   await writeFile(join(output,`${fixture.id}-undo.png`),Buffer.from(undoPixels.split(',')[1],'base64'),{flag:'wx'});
   if(errors.length)throw new Error(errors.join('\n'));
   const sorted=observation.samples.map(s=>s.duration).sort((a,b)=>a-b),overlap=observation.tasks.filter(task=>task.start<observation.last&&task.start+task.duration>observation.first),gaps=observation.frames.slice(1).flatMap((at,i)=>observation.frames[i]<observation.last&&at>observation.first?[at-observation.frames[i]]:[]);
   const report={fixture,source,expected,diagnostic,profiled,baseURL,viewport:{width:1440,height:1000},browser:browser.version(),host:{platform:platform(),arch:arch(),cpu:cpus()[0]?.model,logicalCpus:cpus().length},...observation,overlappingLongTasks:overlap,frameGaps:gaps,p95:sorted[Math.ceil(sorted.length*.95)-1],maximum:sorted.at(-1),recordedPointXs:pointXs,displayedPngSha256:{before:sha(Buffer.from(beforePixels.split(',')[1],'base64')),after:sha(Buffer.from(afterPixels.split(',')[1],'base64')),undo:sha(Buffer.from(undoPixels.split(',')[1],'base64'))},oneUndoExactModelAndPixels:true,projects:{before:{sha256:before.sha256,path:before.file},after:{sha256:after.sha256,path:after.file},undo:{sha256:undo.sha256,path:undo.file}},limits:['Twenty paced pointer moves in a small synthetic fixture; no sustained throughput, physical-display/GPU/tablet, representative-photo or process-peak-memory proof.','Layer samples require newly visible pure loaded pigment at a point that previously did not match; finite carried pigment is not assumed to stay opaque. Mask/filter samples require exact known coverage-result pixels.','Timestamps end at native Canvas drawImage return for a matching pixel, before diagnostic one-pixel readback. Probe durations are retained; observation overhead can affect subsequent work.','Optional diagnostic transaction and worker round trips include scheduling/transfer/response overhead, can overlap and must not be summed as isolated kernel costs. Their hooks add overhead.','Native animation callbacks and long-task observations describe browser scheduling, not physical presentation. Diagnostic runs under other machine load must not establish latency acceptance.']};
   await save(`${fixture.id}.json`,report);reports.push(report);
  }catch(error){await save(`${fixture.id}-failure.json`,{fixture,error:String(error),stack:error.stack,errors,partial:await page.evaluate(()=>{const s=window.canoliWetInput;return s?{samples:s.samples,pending:s.pending,tasks:s.tasks,probes:s.probes.slice(-12),failed:s.failed}:null;}).catch(()=>null)});throw error;}
  finally{if(hooked)await page.evaluate(()=>window.canoliWetInput?.finish()).catch(()=>{});await context.close();}
 }
 await save('report.json',{format:'canoli-wet-input-proxy',version:1,diagnostic,reports});
 console.log(reports.map(report=>({id:report.fixture.id,p95:report.p95,maximum:report.maximum,longTasks:report.overlappingLongTasks.length})));
}finally{await browser.close();}
