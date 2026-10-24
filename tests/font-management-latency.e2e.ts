import {expect,test} from '@playwright/test';
import {openFontManager} from './helpers/font-management';

interface FontTimingSample {
 presentMs:number;commitMs:number;waitBeforePrepareMs:number;
 prepareMs:number;presentAfterPrepareMs:number;backend:string;
}

for(const count of [16,64])test(`font replacement ${count} text layers records matching canvas presentation and long tasks`,async({page},info)=>{
 await page.goto('/');await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
 await page.evaluate(async count=>{
  const {editor,TextLayer,ParagraphStyle}=window.luma;editor.newDocument({width:800,height:600});const style=editor.document.paragraphStyles.add(new ParagraphStyle({name:'Body',format:{fontFamily:'serif',fontSize:16,color:'#ffffff'}}));
  for(let i=0;i<count;i++){const layer=editor.document.layers.add(new TextLayer({text:`${i} ${'Native font replacement '.repeat(40)}`,x:(i%8)*95,y:Math.floor(i/8)*60}));layer.paragraphStyle=style;}
  await document.fonts.ready;
  const state={start:0,expected:'',samples:[]as FontTimingSample[],commitMs:0,longTasks:[]as number[]};(window as any).fontTiming=state;
  const observer=new PerformanceObserver(entries=>{for(const entry of entries.getEntries())state.longTasks.push(entry.duration);});observer.observe({type:'longtask'});(window as any).fontTimingObserver=observer;
  window.addEventListener('click',event=>{if((event.target as Element).closest('button')?.textContent?.trim()==='Replace font'){state.start=performance.now();state.commitMs=0;}},true);
  editor.document.onCommand(command=>{if(command.type==='document.font.replace'&&state.start)state.commitMs=performance.now()-state.start;});
  const renderer=editor.renderer,prepare=renderer.prepareViewport.bind(renderer);
  renderer.prepareViewport=async(...args)=>{const start=state.start,expected=state.expected,matches=args[0].children.every(layer=>layer.kind!=='text'||layer.fontFamily===expected),prepareStarted=performance.now(),frame=await prepare(...args),prepared=performance.now(),present=frame.present.bind(frame);frame.present=canvas=>{present(canvas);if(start&&matches&&state.start===start){const shown=performance.now();state.samples.push({presentMs:shown-start,commitMs:state.commitMs,waitBeforePrepareMs:prepareStarted-start,prepareMs:prepared-prepareStarted,presentAfterPrepareMs:shown-prepared,backend:frame.backend});state.start=0;}};return frame;};
 },count);
 const dialog=await openFontManager(page);
 const profiler=process.env.LUMA_PROFILE?await page.context().newCDPSession(page):undefined;
 if(profiler){await profiler.send('Profiler.enable');await profiler.send('Profiler.start');}
 for(let i=0;i<12;i++){
  const from=i%2===0?'serif':'monospace',to=i%2===0?'monospace':'serif';await dialog.getByRole('button',{name:from,exact:true}).click();await dialog.getByLabel('Replacement font preset',{exact:true}).selectOption(to);await page.evaluate(to=>{(window as any).fontTiming.expected=to;},to);await dialog.getByRole('button',{name:'Replace font',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).fontTiming.samples.length)).toBe(i+1);
 }
 if(profiler){const {profile}=await profiler.send('Profiler.stop');const {writeFile}=await import('node:fs/promises');await writeFile(info.outputPath('font-replacement.cpuprofile'),JSON.stringify(profile));await profiler.detach();}
 const result=await page.evaluate(count=>{const observer=(window as any).fontTimingObserver as PerformanceObserver,state=(window as any).fontTiming;state.longTasks.push(...observer.takeRecords().map(entry=>entry.duration));observer.disconnect();return{layers:count,iterations:12,...state};},count);expect(result.samples).toHaveLength(12);expect(result.samples.every((sample:FontTimingSample)=>sample.presentMs>=sample.commitMs&&sample.commitMs>0)).toBe(true);
 for(const sample of result.samples as FontTimingSample[]){
  expect(sample.waitBeforePrepareMs).toBeGreaterThanOrEqual(0);
  expect(sample.prepareMs).toBeGreaterThanOrEqual(0);
  expect(sample.presentAfterPrepareMs).toBeGreaterThanOrEqual(0);
  expect(Math.abs(sample.presentMs-sample.waitBeforePrepareMs-sample.prepareMs-sample.presentAfterPrepareMs)).toBeLessThan(.001);
 }
 console.log('font-replacement-latency',JSON.stringify(result));await info.attach('font-replacement-latency',{body:JSON.stringify(result),contentType:'application/json'});
});
