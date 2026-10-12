import {test,expect} from '@playwright/test';

for(const points of [1000,4000]) test(`recovery save with ${64*points} retained points measures control response`,async({page},info)=>{
 await page.goto('/');await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
 await page.evaluate(async points=>{
  const {editor:e,PaintLayer,BrushStroke}=window.luma;
  e.newDocument({width:698,height:396});
  const layer=new PaintLayer({visible:false});
  for(let i=0;i<64;i++)layer.strokes.add(new BrushStroke({size:5,points:Array.from({length:points},(_,j)=>({x:20+j*600/points,y:20+i*5,pressure:1}))}));
  e.document.layers.add(layer);
  await e.recovery.flush();await e.workspaceAutosave.flush();
 },points);
 await expect(page.locator('footer .status-dot.working')).toHaveCount(0);
 await page.evaluate(()=>{
  const entries:{start:number;duration:number}[]=[];
  const observer=new PerformanceObserver(list=>{for(const e of list.getEntries())entries.push({start:e.startTime,duration:e.duration});});
  observer.observe({type:'longtask'});
  (window as any).recoveryTiming={entries,observer};
 });
 const result=await page.getByRole('button',{name:'Pencil tool (N)',exact:true}).evaluate(async button=>{
  const e=window.luma.editor,id=crypto.randomUUID(),revision=e.document.getSnapshot().revision;
  const start=performance.now();let saveFinished=false;
  const control=new Promise<{ms:number;beforeSave:boolean;selected:boolean}>(resolve=>setTimeout(()=>{
   (button as HTMLButtonElement).click();
   requestAnimationFrame(()=>resolve({ms:performance.now()-start,beforeSave:!saveFinished,selected:button.getAttribute('aria-pressed')==='true'}));
  },0));
  const saved=e.recovery.repository.save(id,e.document.getSnapshot().document,e.assetStore).then(()=>{saveFinished=true;return performance.now()-start;});
  const [saveMs,input]=await Promise.all([saved,control]);
  const end=performance.now();await new Promise(resolve=>setTimeout(resolve,100));
  const state=(window as any).recoveryTiming;state.observer.disconnect();
  const entry=(await e.recovery.repository.list()).find(entry=>entry.id===id)!;
  const layer=entry.document.children[0];
  const nativeBytes=new TextEncoder().encode(JSON.stringify({id:entry.id,document:entry.document,savedAt:entry.savedAt,assetKeys:entry.assetKeys}));
  const nativeChecksum=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',nativeBytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
  return {saveMs,input,checksumMatchesNative:entry.checksum===nativeChecksum,longTasks:state.entries.filter((entry:{start:number;duration:number})=>entry.start+entry.duration>start && entry.start<end),revisionUnchanged:e.document.getSnapshot().revision===revision,
   points:layer.kind==='paint'?layer.strokes.reduce((sum,stroke)=>sum+(stroke.kind==='fill'?0:stroke.points.length),0):0};
 });
 expect(result.checksumMatchesNative).toBe(true);expect(result.points).toBe(64*points);expect(result.revisionUnchanged).toBe(true);expect(result.input.selected).toBe(true);
 console.log('recovery-latency',JSON.stringify(result));
 await info.attach('recovery-latency',{body:JSON.stringify(result),contentType:'application/json'});
});
