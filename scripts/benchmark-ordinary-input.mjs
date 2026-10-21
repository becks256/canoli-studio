/** Normal-production pointer-to-matching-canvas-copy proxy. No editor globals. */
import {chromium} from '@playwright/test';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {cpus,platform,arch} from 'node:os';
import {join} from 'node:path';
import {readProject} from '../src/core/project.ts';

const texturePath=process.env.CANOLI_ORDINARY_INPUT_TEXTURE;
const textureBytes=texturePath?await readFile(texturePath):null;
const corpus=[...['brush','pencil','eraser'].flatMap(tool=>['layer','mask','filter-mask'].map(target=>({id:`${tool}-${target}`,tool,target,width:512,size:8,probeOffsetX:0}))),...['brush-layer','pencil-mask','eraser-filter-mask'].map(id=>({id:`large-${id}`,tool:id.split('-')[0],target:id.slice(id.indexOf('-')+1),width:2048,size:2048,probeOffsetX:1023})),...(textureBytes?['brush-layer','pencil-mask','eraser-filter-mask'].map(id=>({id:`near-large-${id}`,tool:id.split('-')[0],target:id.slice(id.indexOf('-')+1),width:2048,size:1800,probeOffsetX:899})):[]),...(textureBytes?['brush-layer','pencil-mask','eraser-filter-mask'].map(id=>({id:`medium-${id}`,tool:id.split('-')[0],target:id.slice(id.indexOf('-')+1),width:2048,size:900,probeOffsetX:449})):[])];
const selected=process.env.CANOLI_ORDINARY_INPUT_CASES?.split(',');
if(selected?.some(id=>!corpus.some(f=>f.id===id)))throw new Error('Unknown CANOLI_ORDINARY_INPUT_CASES fixture.');
const fixtures=corpus.filter(f=>!selected||selected.includes(f.id));
const output=process.env.CANOLI_ORDINARY_INPUT_OUTPUT??`/tmp/canoli-ordinary-input-${Date.now()}`;
const baseURL=process.env.CANOLI_ORDINARY_INPUT_URL??'http://127.0.0.1:4173/';
const diagnostic=process.env.CANOLI_ORDINARY_INPUT_DIAGNOSTIC==='1';
await mkdir(output,{recursive:false});
const save=(name,value)=>writeFile(join(output,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const sha=value=>createHash('sha256').update(value).digest('hex');
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
const reports=[];
try{
 for(const fixture of fixtures){
  const context=await browser.newContext({viewport:{width:3000,height:1000}}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  let hooked=false;
  try{
   await page.goto(baseURL);
   if(await page.evaluate(()=>'luma'in window))throw new Error('Use a normal production build without developer globals.');
   const source=`document.resize(${fixture.width},128);
    ${fixture.target==='filter-mask'?`const master=new Document({width:${fixture.width},height:128});const paint=master.layers.add(new PaintLayer());paint.strokes.add(new PaintFill({bounds:{x:0,y:0,width:${fixture.width},height:128},color:'#404040'}));const layer=document.placeSmartObject(document.defineComponent(master));layer.addFilter(new SmartToneFilter({exposure:1}));`:`document.layers.add(new LayerGroup({name:'Canvas backend fixture',blendMode:'pass-through'}));const layer=document.layers.add(new PaintLayer());${fixture.target!=='layer'||fixture.tool==='eraser'?`layer.strokes.add(new PaintFill({bounds:{x:0,y:0,width:${fixture.width},height:128},color:'#0000ff'}));`:''}`}
    layer.name='Measured ordinary stroke';
    ${fixture.target!=='layer'?`layer.${fixture.target==='mask'?'mask':'filterMask'}=new LayerMask({base:1});`:''}
    document.selectedLayer=layer;print('Ordinary input fixture ready');`;
   await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();
   await page.getByLabel('Script code',{exact:true}).fill(source);
   await page.getByRole('button',{name:'Run script',exact:true}).click();
   try{await page.getByLabel('Script output').filter({hasText:'Ordinary input fixture ready'}).waitFor();}
   catch(error){throw new Error(`Failed fixture ${fixture.id}: ${await page.getByLabel('Script output').innerText()}`,{cause:error});}
   await page.getByRole('button',{name:'Close scripts',exact:true}).click();
   await page.getByRole('button',{name:fixture.tool==='brush'?'Brush tool (B)':fixture.tool==='pencil'?'Pencil tool (N)':'Eraser tool (E)',exact:true}).click();
   if(fixture.target!=='layer')await page.getByRole('combobox',{name:'Paint target',exact:true}).selectOption(fixture.target==='mask'?'mask-hide':'filter-mask-hide');
   const values=[['Size',fixture.size],['Tool opacity',100],['Smoothing',0],...(fixture.tool==='pencil'?[]:[['Hardness',100],['Flow',100]])];
   for(const [label,value]of values){const field=page.getByRole('spinbutton',{name:`${label} value`,exact:true});await field.fill(String(value));await field.press('Enter');}
   await page.getByLabel('Pressure controls size',{exact:true}).uncheck();await page.getByLabel('Pressure controls opacity',{exact:true}).uncheck();
   if(fixture.target==='layer'&&fixture.tool!=='eraser')await page.getByLabel('Foreground color',{exact:true}).fill('#ff0000');
   if(textureBytes){
    await page.getByRole('button',{name:'Texture…',exact:true}).click();const texture=page.getByRole('dialog',{name:'Brush texture',exact:true});
    await texture.getByLabel('Brush texture image file',{exact:true}).setInputFiles({name:'Measured original texture.png',mimeType:'image/png',buffer:textureBytes});
    await texture.getByAltText('Texture coverage preview').waitFor();await texture.getByRole('combobox',{name:'Texture channel',exact:true}).selectOption('alpha');
    await texture.getByRole('button',{name:'Apply texture',exact:true}).click();
   }
   await page.getByLabel('Editing canvas',{exact:true}).focus();await page.keyboard.press('Control+1');
   const idle=()=>page.waitForFunction(()=>!document.querySelector('footer .status-dot.working'));
   await idle();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   if(!(await page.locator('footer').textContent())?.includes('Standard rendering'))throw new Error('Canvas-copy measurement requires displayed Standard rendering.');
   const project=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Save project',exact:true}).click();const file=join(output,`${fixture.id}-${name}.luma`);await(await pending).saveAs(file);const bytes=await readFile(file);return{file,sha256:sha(bytes),contents:await readProject(new Blob([new Uint8Array(bytes)]))};};
   const pixels=()=>page.locator('.canvas-wrap canvas[data-testid="artwork"]').evaluate(canvas=>canvas.toDataURL());
   const before=await project('before'),beforePixels=await pixels();
   const box=await page.locator('.canvas-wrap').boundingBox();if(!box||Math.abs(box.width-fixture.width)>.1||Math.abs(box.height-128)>.1)throw new Error(`Expected actual-size${fixture.width}x128canvas: `+JSON.stringify(box));
   const expected={kind:'exact',offsetX:fixture.probeOffsetX,rgba:fixture.target==='layer'&&fixture.tool!=='eraser'?[255,0,0,255]:fixture.target==='filter-mask'?[64,64,64,255]:[0,0,0,0]};
   await page.evaluate(()=>{
    const state={pending:null,samples:[],tasks:[],frames:[],first:0,last:0,probes:[],controls:[],failed:null};
    window.canoliOrdinaryInput=state;
    const p=CanvasRenderingContext2D.prototype,draw=p.drawImage;
    const entries=list=>list.map(e=>({start:e.startTime,duration:e.duration}));
    const observer=new PerformanceObserver(list=>state.tasks.push(...entries(list.getEntries())));observer.observe({type:'longtask'});
    let raf=0;const frame=at=>{state.frames.push(at);raf=requestAnimationFrame(frame);};raf=requestAnimationFrame(frame);
    const capture=event=>{const pending=state.pending;if(!pending||pending.start||!(event.buttons&1)||!event.target.closest?.('.viewport'))return;if(!event.isTrusted){state.failed='Untrusted pointer event';return;}pending.start=performance.now();pending.clientX=event.clientX;pending.clientY=event.clientY;state.first||=pending.start;};
    window.addEventListener('pointermove',capture,true);
    p.drawImage=function(...args){
     const result=draw.apply(this,args),pending=state.pending;
     if(pending?.start&&this.canvas.isConnected&&this.canvas.matches('canvas[data-testid="artwork"]')&&this.canvas.closest('.canvas-wrap')){
      const copied=performance.now(),probeStart=performance.now(),box=this.canvas.getBoundingClientRect(),x=Math.floor((pending.clientX+pending.expected.offsetX-box.x)*this.canvas.width/box.width),y=Math.floor((pending.clientY-box.y)*this.canvas.height/box.height);
      if(x>=0&&y>=0&&x<this.canvas.width&&y<this.canvas.height){
       const rgba=Array.from(this.getImageData(x,y,1,1).data);state.probes.push({duration:performance.now()-probeStart,x,y,rgba,copied});
       if(pending.expected.kind==='pigment'?rgba[3]>0&&pending.expected.rgb.every((value,index)=>value===rgba[index]):rgba.every((value,index)=>value===pending.expected.rgba[index])){state.last=copied;state.samples.push({...pending,rgba,copied,duration:copied-pending.start});state.pending=null;}
      }
     }
     return result;
    };
    state.finish=()=>{state.tasks.push(...entries(observer.takeRecords()));observer.disconnect();cancelAnimationFrame(raf);window.removeEventListener('pointermove',capture,true);p.drawImage=draw;};
   });hooked=true;
   await page.evaluate(async()=>{const state=window.canoliOrdinaryInput;const start=await new Promise(resolve=>setTimeout(()=>{const at=performance.now();while(performance.now()<at+75){}resolve(at);},0));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));state.controls=state.tasks.filter(task=>task.duration>=50&&task.start<=start+5&&task.start+task.duration>=start+70);if(!state.controls.length)throw new Error('Native long-task positive control was not observed.');});
   await page.mouse.move(box.x+36,box.y+64);await page.mouse.down();
   for(let index=0;index<20;index++){
    const x=48+index*12,y=64;
    const baseline=await page.locator('.canvas-wrap canvas[data-testid="artwork"]').evaluate((canvas,{clientX,clientY})=>{const box=canvas.getBoundingClientRect();return Array.from(canvas.getContext('2d').getImageData(Math.floor((clientX-box.x)*canvas.width/box.width),Math.floor((clientY-box.y)*canvas.height/box.height),1,1).data);},{clientX:box.x+x+fixture.probeOffsetX,clientY:box.y+y});
    if(expected.kind==='pigment'?baseline[3]>0&&expected.rgb.every((value,i)=>value===baseline[i]):baseline.every((value,i)=>value===expected.rgba[i]))throw new Error(`Fixture ${fixture.id} point ${index} already matched before new input.`);
    await page.evaluate(({index,x,y,expected})=>{window.canoliOrdinaryInput.pending={index,x,y,expected,start:0};},{index,x,y,expected});
    await page.mouse.move(box.x+x,box.y+y);
    await page.waitForFunction(index=>window.canoliOrdinaryInput.failed||window.canoliOrdinaryInput.samples.length>index,index,{timeout:30000});
   }
   await page.mouse.up();await idle();
   const observation=await page.evaluate(()=>{const state=window.canoliOrdinaryInput;state.finish();return{samples:state.samples,tasks:state.tasks,frames:state.frames,probes:state.probes,controls:state.controls,first:state.first,last:state.last,failed:state.failed};});hooked=false;
   if(observation.failed)throw new Error(observation.failed);
   if(observation.samples.length!==20||observation.samples.some(s=>!s.start||s.duration<0))throw new Error('Missing matched input/presentation samples.');
   const after=await project('after'),layer=after.contents.document.children.find(layer=>layer.name==='Measured ordinary stroke');
   const operation=fixture.target==='layer'?layer?.kind==='paint'?layer.strokes.at(-1):null:layer?.[fixture.target==='mask'?'mask':'filterMask']?.strokes?.at(-1)?.stroke;
   const expectedKind=fixture.tool==='pencil'?'pencil':fixture.target==='layer'&&fixture.tool==='eraser'?'eraser':'brush';
   if(operation?.kind!==expectedKind)throw new Error('Missing committed ordinary operation: '+JSON.stringify(operation));
   if(textureBytes){const asset=after.contents.entries.find(entry=>entry.id===operation.texture?.assetId);if(operation.texture?.channel!=='alpha'||!asset||sha(new Uint8Array(await asset.blob.arrayBuffer()))!==sha(textureBytes))throw new Error('Committed texture settings or original source bytes changed.');}
   const beforeLayer=before.contents.document.children.find(node=>node.name==='Measured ordinary stroke');
   const operations=node=>fixture.target==='layer'?node.strokes:node[fixture.target==='mask'?'mask':'filterMask'].strokes??[];
   if(operations(layer).length!==operations(beforeLayer).length+1)throw new Error('Expected exactly one new operation.');
   if(operation.points.some(point=>point.y!==64||point.pressure!==1))throw new Error('Recorded y/pressure changed.');
   const pointXs=operation.points.map(point=>point.x),expectedXs=[36,...Array.from({length:20},(_,i)=>48+i*12)];
   if(JSON.stringify(pointXs)!==JSON.stringify(expectedXs))throw new Error(`Recorded points differ: ${JSON.stringify(pointXs)}`);
   const afterPixels=await pixels();if(beforePixels===afterPixels)throw new Error('Stroke did not change displayed pixels.');
   await writeFile(join(output,`${fixture.id}-before.png`),Buffer.from(beforePixels.split(',')[1],'base64'),{flag:'wx'});await writeFile(join(output,`${fixture.id}-after.png`),Buffer.from(afterPixels.split(',')[1],'base64'),{flag:'wx'});
   await page.keyboard.press('Control+z');await idle();const undo=await project('undo');
   if(JSON.stringify(undo.contents.document)!==JSON.stringify(before.contents.document))throw new Error('One undo did not restore exact model.');
   const undoPixels=await pixels();if(undoPixels!==beforePixels)throw new Error('One undo did not restore displayed pixels.');
   await writeFile(join(output,`${fixture.id}-undo.png`),Buffer.from(undoPixels.split(',')[1],'base64'),{flag:'wx'});
   if(errors.length)throw new Error(errors.join('\n'));
   const sorted=observation.samples.map(s=>s.duration).sort((a,b)=>a-b),overlap=observation.tasks.filter(task=>task.start<observation.last&&task.start+task.duration>observation.first),gaps=observation.frames.slice(1).flatMap((at,i)=>observation.frames[i]<observation.last&&at>observation.first?[at-observation.frames[i]]:[]);
   const report={fixture,source,expected,diagnostic,baseURL,textureSource:textureBytes?{path:texturePath,sha256:sha(textureBytes)}:null,viewport:{width:3000,height:1000},browser:browser.version(),host:{platform:platform(),arch:arch(),cpu:cpus()[0]?.model,logicalCpus:cpus().length},...observation,overlappingLongTasks:overlap,frameGaps:gaps,p95:sorted[Math.ceil(sorted.length*.95)-1],maximum:sorted.at(-1),recordedPointXs:pointXs,displayedPngSha256:{before:sha(Buffer.from(beforePixels.split(',')[1],'base64')),after:sha(Buffer.from(afterPixels.split(',')[1],'base64')),undo:sha(Buffer.from(undoPixels.split(',')[1],'base64'))},oneUndoExactModelAndPixels:true,projects:{before:{sha256:before.sha256,path:before.file},after:{sha256:after.sha256,path:after.file},undo:{sha256:undo.sha256,path:undo.file}},limits:['Twenty paced pointer moves in a synthetic fixture (including maximum-size brush/pencil/eraser footprints); no sustained throughput, physical-display/GPU/tablet, representative-photo or process-peak-memory proof.','All samples require exact known newly matching RGBA at a point that did not match before the new trusted input. Maximum-size footprints probe their advancing leading edge 1023 pixels ahead of the pointer, inside the new hard stamp and beyond the old one.','Timestamps end at native Canvas drawImage return for a matching pixel, before diagnostic one-pixel readback. Probe durations are retained; observation overhead can affect subsequent work.','Native animation callbacks and long-task observations describe browser scheduling, not physical presentation. Diagnostic runs under other machine load must not establish latency acceptance.']};
   await save(`${fixture.id}.json`,report);reports.push(report);
  }catch(error){await save(`${fixture.id}-failure.json`,{fixture,error:String(error),stack:error.stack,errors,partial:await page.evaluate(()=>{const s=window.canoliOrdinaryInput;return s?{samples:s.samples,pending:s.pending,tasks:s.tasks,probes:s.probes.slice(-12),failed:s.failed}:null;}).catch(()=>null)});throw error;}
  finally{if(hooked)await page.evaluate(()=>window.canoliOrdinaryInput?.finish()).catch(()=>{});await context.close();}
 }
 await save('report.json',{format:'canoli-ordinary-input-proxy',version:1,diagnostic,reports});
 console.log(reports.map(report=>({id:report.fixture.id,p95:report.p95,maximum:report.maximum,longTasks:report.overlappingLongTasks.length})));
}finally{await browser.close();}
