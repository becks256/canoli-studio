import {writeFile} from 'node:fs/promises';
import {test,expect} from '@playwright/test';

const points=Number(process.env.LUMA_ERASER_POINTS ?? 1000);
for(const strokes of [0,64]) test(`tool switching with ${strokes*points} retained raster eraser points`,async({page},info)=>{
  await page.goto('/');
  await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
  await page.evaluate(async ({strokes,points})=>{
    const {editor:e,EraserStroke}=window.luma;
    e.newDocument({width:698,height:396});
    const canvas=new OffscreenCanvas(160,80),c=canvas.getContext('2d')!;
    c.fillStyle='#ee6633';c.fillRect(0,0,160,80);
    const layer=await e.importImage(new File([await canvas.convertToBlob()],'Erasures.png',{type:'image/png'}));
    layer.update({x:220,y:140,erasures:Array.from({length:strokes},(_,i)=>({width:160,height:80,stroke:new EraserStroke({size:1,points:Array.from({length:points},(_,j)=>({x:10+j*120/points,y:10+i*.9,pressure:1}))}).toJSON()}))});
  },{strokes,points});
  await page.keyboard.press('Control+1');
  await expect(page.locator('footer .status-dot.working')).toHaveCount(0);
  await page.waitForTimeout(200);
  const revision=await page.evaluate(()=>window.luma.editor.document.getSnapshot().revision);
  await page.evaluate(()=>{
    const {RasterLayer}=window.luma;
    const timing={copies:0,copyMs:0,samples:[] as number[],longTasks:[] as number[],longTaskEntries:[] as {start:number;duration:number}[]};
    (window as any).rasterInspectorTiming=timing;
    const original=RasterLayer.prototype.toJSON;
    RasterLayer.prototype.toJSON=function(){const start=performance.now();try{return original.call(this);}finally{timing.copies++;timing.copyMs+=performance.now()-start;}};
    let pending:{button:HTMLElement;start:number}|undefined;
    const observer=new MutationObserver(()=>{
      if(!pending || pending.button.getAttribute('aria-pressed')!=='true')return;
      const start=pending.start;pending=undefined;
      requestAnimationFrame(()=>timing.samples.push(performance.now()-start));
    });
    observer.observe(document.body,{subtree:true,attributes:true,attributeFilter:['aria-pressed']});
    window.addEventListener('click',event=>{
      const button=(event.target as Element).closest('button');
      if(button?.getAttribute('aria-label')?.includes(' tool (') && button.getAttribute('aria-pressed')!=='true') pending={button,start:performance.now()};
    },true);
    const tasks=new PerformanceObserver(list=>{for(const entry of list.getEntries()){timing.longTasks.push(entry.duration);timing.longTaskEntries.push({start:entry.startTime,duration:entry.duration});}});
    tasks.observe({type:'longtask'});
  });
  const profiler=process.env.LUMA_PROFILE ? await page.context().newCDPSession(page) : null;
  if(profiler){await profiler.send('Profiler.enable');await profiler.send('Profiler.start');}
  for(let i=0;i<30;i++) {
    const button=page.getByRole('button',{name:i%2?'Pencil tool (N)':'Brush tool (B)',exact:true});
    await button.click();await expect(button).toHaveAttribute('aria-pressed','true');
    await expect.poll(()=>page.evaluate(()=>(window as any).rasterInspectorTiming.samples.length)).toBe(i+1);
  }
  const result=await page.evaluate(()=>({...(window as any).rasterInspectorTiming,revision:window.luma.editor.document.getSnapshot().revision}));
  expect(result.revision).toBe(revision);expect(result.samples).toHaveLength(30);
  if(profiler){const {profile}=await profiler.send('Profiler.stop');const path=info.outputPath('raster-inspector.cpuprofile');await writeFile(path,JSON.stringify(profile));await info.attach('cpu-profile',{path,contentType:'application/json'});await profiler.detach();}
  console.log('raster-inspector-latency',JSON.stringify({strokes,points,...result}));
  await info.attach('raster-inspector-latency',{body:JSON.stringify({strokes,points,...result}),contentType:'application/json'});
});
