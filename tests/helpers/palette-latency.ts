import {expect,type Page,type TestInfo} from '@playwright/test';
import {writeFile,stat} from 'node:fs/promises';
import {Document,VectorLayer,VectorPath} from '../../src/dom';
import {serializeProject} from '../../src/core/project';
import {historyPng,historyProject,historyScript} from './history-inspector';

export async function paletteLatencyWorkflow(page:Page,info:TestInfo,count:number,production=false){
 const data=new Document({name:`Palette ${count}`,width:800,height:600}).toJSON();
 for(let i=0;i<count;i++){
  const layer=new VectorLayer({name:`Shape ${i+1}`,x:(i%8)*96,y:Math.floor(i/8)*64}).toJSON();
  if(layer.kind!=='vector')throw Error('Expected vector');
  layer.paths=Array.from({length:count===64?32:1},(_,index)=>{
   const x=(index%8)*4,y=Math.floor(index/8)*4;
   return new VectorPath({points:[{x,y},{x:x+3,y},{x:x+3,y:y+3},{x,y:y+3}],closed:true,fill:'#2468ac',stroke:null,strokeWidth:0}).toJSON();
  });data.children.push(layer);
 }
 const file=info.outputPath('palette-source.luma');await writeFile(file,Buffer.from(await(await serializeProject(data,{get(){throw Error('No raster source');}})).arrayBuffer()));
 await page.setViewportSize({width:1280,height:720});await page.goto('/');await page.getByTestId('project-input').setInputFiles(file);
 expect(await page.evaluate(()=>'luma'in window)).toBe(!production);await expect(page.getByLabel('Document name',{exact:true})).toHaveValue(`Palette ${count}`);
 if(production)await historyScript(page,'document.selectLayers([...document.layers]);','Palette selection ready');
 else{await expect.poll(()=>page.evaluate(()=>window.luma.editor.document.name)).toBe(`Palette ${count}`);await page.evaluate(()=>window.luma.editor.document.selectLayers([...window.luma.editor.document.layers]));}
 await expect(page.locator('.canvas-status')).toContainText('Ready');
 const beforeProject=production?await historyProject(page,info,'palette-before.luma'):undefined;if(beforeProject)expect(beforeProject.value.document.children).toEqual(data.children);const selectedRows=await page.locator('.layer-row.selected').count(),undoDisabled=await page.getByRole('button',{name:'Undo (Mod+Z)',exact:true}).isDisabled();
 const before=count?await historyPng(page,info,'palette-before.png'):undefined;
 await page.evaluate(()=>new Promise<void>(resolve=>requestIdleCallback(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())),{timeout:2000})));
 await page.evaluate(production=>{
  const doc=production?null:window.luma.editor.document,before=doc?.getSnapshot();
  const state={samples:[]as any[],pending:null as any,diagnostic:null as any,longTasks:[]as {start:number;duration:number}[],before,doc,original:doc?.toJSON,observer:null as PerformanceObserver|null,domObserver:null as MutationObserver|null};
  const matches=(pending:any)=>{
   const palette=document.querySelector('.command-palette'),input=palette?.querySelector('input');
   if(!palette||!input)return false;
   const labels=[...palette.querySelectorAll('[role=option]')].map(node=>node.textContent??'');
   const alignmentLabels=labels.filter(label=>/Align (left|center|right|top|middle|bottom) to /.test(label));
   return pending.kind==='open'?alignmentLabels.length===18:input.value===pending.query&&alignmentLabels.length===3&&['selection','canvas','key object'].every(reference=>labels.some(label=>label.includes(`Align ${pending.direction} to ${reference}`)));
  };
  const check=()=>{
   const pending=state.pending;if(!pending)return;
   pending.frames++;if(matches(pending)){state.samples.push({kind:pending.kind,query:pending.query??'',ms:performance.now()-pending.start,domMs:(pending.domAt??performance.now())-pending.start,frames:pending.frames});state.pending=null;}
   else requestAnimationFrame(check);
  };
  const begin=(kind:string,event:Event)=>{
   if(kind==='input'&&!(event.target as Element).matches('.command-palette input'))return;
   if(kind==='open'&&!(event.target as Element).closest('button[aria-label="Find a command (Mod+K)"]'))return;
   const query=kind==='input'?(event.target as HTMLInputElement).value:'',direction=query.replace('align ','');
   state.pending={kind,query,direction,start:performance.now(),frames:0};requestAnimationFrame(check);
  };
  state.domObserver=new MutationObserver(()=>{const pending=state.pending;if(pending&&pending.domAt===undefined&&matches(pending))pending.domAt=performance.now();});state.domObserver.observe(document.body,{childList:true,subtree:true,attributes:true,characterData:true});
  document.addEventListener('click',event=>begin('open',event),true);document.addEventListener('input',event=>begin('input',event),true);
  state.observer=new PerformanceObserver(entries=>state.longTasks.push(...entries.getEntries().map(entry=>({start:entry.startTime,duration:entry.duration}))));state.observer.observe({type:'longtask'});
  (window as any).paletteTiming=state;
 },production);
 // Attribute one isolated search separately; latency samples use the original method.
 const profiler=process.env.CANOLI_PALETTE_PROFILE&&count===64?await page.context().newCDPSession(page):null;if(profiler){await profiler.send('Profiler.enable');await profiler.send('Profiler.start');}
 await page.getByRole('button',{name:'Find a command (Mod+K)',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).paletteTiming.samples.length)).toBe(1);
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 if(profiler){const{profile}=await profiler.send('Profiler.stop');await writeFile(info.outputPath('palette-opening.cpuprofile'),JSON.stringify(profile));await profiler.detach();}
 if(!production)await page.evaluate(()=>{const state=(window as any).paletteTiming;state.diagnostic={calls:0,ms:0,caller:''};state.doc.toJSON=function(){const start=performance.now(),result=state.original.call(this);state.diagnostic.calls++;state.diagnostic.ms+=performance.now()-start;if(!state.diagnostic.caller)state.diagnostic.caller=new Error().stack;return result;};});
 const search=page.getByRole('combobox',{name:'Search commands',exact:true});await search.fill('align center');
 await expect.poll(()=>page.evaluate(()=>(window as any).paletteTiming.samples.length)).toBe(2);
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 if(!production)await page.evaluate(()=>{const state=(window as any).paletteTiming;state.doc.toJSON=state.original;});
 for(let index=0;index<12;index++){
  await search.fill('align '+['left','middle','right','center'][index%4]);
  await expect.poll(()=>page.evaluate(()=>(window as any).paletteTiming.samples.length)).toBe(index+3);
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 }
 const result=await page.evaluate(()=>{
  const state=(window as any).paletteTiming;state.longTasks.push(...state.observer.takeRecords().map((entry:any)=>({start:entry.startTime,duration:entry.duration})));state.observer.disconnect();state.domObserver.disconnect();
  const now=state.doc?.getSnapshot();const unchanged:Record<string,boolean>=now?{model:now.document===state.before.document,revision:now.revision===state.before.revision,history:now.past.length===state.before.past.length,selection:JSON.stringify(now.selectedIds)===JSON.stringify(state.before.selectedIds)}:{};return{samples:state.samples,diagnostic:state.diagnostic,longTasks:state.longTasks,unchanged};
 });
 expect(result.samples).toHaveLength(14);
 await page.screenshot({path:info.outputPath('palette-search.png')});await page.keyboard.press('Escape');
 if(before)expect((await historyPng(page,info,'palette-after.png')).bytes).toEqual(before.bytes);
 if(production){const afterProject=await historyProject(page,info,'palette-after.luma');expect(undoDisabled).toBe(true);result.unchanged={model:JSON.stringify(afterProject.value.document)===JSON.stringify(beforeProject!.value.document),history:await page.getByRole('button',{name:'Undo (Mod+Z)',exact:true}).isDisabled(),selection:await page.locator('.layer-row.selected').count()===selectedRows};}
 expect(Object.values(result.unchanged).every(Boolean)).toBe(true);
 const ordered=result.samples.slice(2).map((sample:any)=>sample.ms).sort((a:number,b:number)=>a-b);
 const fixtureBytes=(await stat(file)).size;const report={production,profiled:!!profiler,variant:process.env.CANOLI_PALETTE_VARIANT??'final',layers:count,paths:count*(count===64?32:1),fixtureBytes,...result,median:ordered[Math.floor(ordered.length/2)],p95:ordered[Math.ceil(ordered.length*.95)-1]};
 await writeFile(info.outputPath('palette-latency.json'),JSON.stringify(report,null,2));console.log('palette-latency',JSON.stringify({layers:count,paths:report.paths,median:report.median,p95:report.p95,diagnostic:report.diagnostic,longTasks:report.longTasks}));
}
