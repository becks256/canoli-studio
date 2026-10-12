import { writeFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

for (const layers of [5, 64]) test(`crop resize and isolated scripts with ${layers} layers record presentation latency`, async ({ page }, info) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Move tool (V)', exact: true }).click();
  await page.evaluate(layers => {
    const { editor: e, PaintLayer, PaintFill } = window.luma;
    e.newDocument({ width: 800, height: 600 });
    e.document.transaction('Fixture', () => {
      for (let i=0;i<layers;i++) {
        const layer=e.document.layers.add(new PaintLayer({x:i%20,y:i%15}));
        layer.strokes.add(new PaintFill({bounds:{x:0,y:0,width:200,height:100},color:'#807060'}));
      }
    });
  }, layers);
  await page.waitForTimeout(200);
  const profiler=process.env.LUMA_PROFILE ? await page.context().newCDPSession(page) : null;
  if(profiler){await profiler.send("Profiler.enable");await profiler.send("Profiler.start");}
  const result = await page.evaluate(async () => {
    const e=window.luma.editor, samples:{action:string;commitMs:number;presentMs:number;prepareMs:number;scriptRuntimeMs:number}[]=[],longTasks:number[]=[];
    let pending: {start:number;presentMs:number|null;prepareMs:number;scriptRuntimeMs:number} | null=null;
    const runScript=e.scripts.run.bind(e.scripts);
    e.scripts.run=async(...args)=>{
      const measured=pending,start=performance.now();
      try{return await runScript(...args);}finally{if(measured)measured.scriptRuntimeMs=performance.now()-start;}
    };
    const prepare=e.renderer.prepareViewport.bind(e.renderer);
    e.renderer.prepareViewport=async(...args)=>{
      const measured=pending,start=performance.now(),frame=await prepare(...args),prepareMs=performance.now()-start,present=frame.present.bind(frame);
      frame.present=canvas=>{
        present(canvas);
        if(measured && measured===pending && args[0]===e.document.getSnapshot().document){
          measured.presentMs=performance.now()-measured.start;measured.prepareMs=prepareMs;
        }
      };
      return frame;
    };
    const observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())longTasks.push(entry.duration);});
    observer.observe({type:'longtask'});
    const measure=async(action:string,run:()=>unknown)=>{
      const state={start:performance.now(),presentMs:null as number|null,prepareMs:0,scriptRuntimeMs:0};pending=state;
      await run();const commitMs=performance.now()-state.start;
      while(state.presentMs===null){
        if(performance.now()-state.start>10000)throw Error(`No presentation for ${action}`);
        await new Promise(requestAnimationFrame);
      }
      samples.push({action,commitMs,presentMs:state.presentMs,prepareMs:state.prepareMs,scriptRuntimeMs:state.scriptRuntimeMs});pending=null;
      await new Promise(requestAnimationFrame);
    };
    const initial=JSON.stringify(e.document.toJSON());
    for(let i=0;i<5;i++){
      await measure('crop',()=>e.document.crop({x:20,y:20,width:760,height:560}));
      await measure('undo-crop',()=>e.document.undo());
      await measure('image-resize',()=>e.document.resizeImage(1200,900));
      await measure('undo-resize',()=>e.document.undo());
      await measure('script',()=>e.runScript('document.transaction("Move all", () => { for (const layer of document.layers) layer.x += 1; });'));
      await measure('undo-script',()=>e.document.undo());
    }
    await new Promise(resolve=>setTimeout(resolve,100));observer.disconnect();
    return {samples,longTasks,restored:JSON.stringify(e.document.toJSON())===initial,layers:e.document.layers.length};
  });
  if(profiler){const {profile}=await profiler.send("Profiler.stop");const path=info.outputPath("document-operations.cpuprofile");await writeFile(path,JSON.stringify(profile));await info.attach("cpu-profile",{path,contentType:"application/json"});await profiler.detach();}
  console.log('document-operations-latency',JSON.stringify(result));
  await info.attach('document-operations-latency',{body:JSON.stringify(result),contentType:'application/json'});
  expect(result.restored).toBe(true);expect(result.layers).toBe(layers);expect(result.samples).toHaveLength(30);
});
