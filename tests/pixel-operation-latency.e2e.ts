import {writeFile} from 'node:fs/promises';
import {test,expect} from '@playwright/test';

for(const [width,height] of [[698,396],[2000,1500]]){
  test(`pixel operations ${width}x${height} record completion and frame gaps`,async({page},info)=>{
    await page.goto('/');
    await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
    await page.evaluate(async({width,height})=>{
      const e=window.luma.editor;e.newDocument({width,height});
      const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
      const c=canvas.getContext('2d')!;c.fillStyle='#ff0000';c.fillRect(0,0,width/2,height);
      c.fillStyle='rgba(0,0,255,0.5)';c.fillRect(width/2,0,width/2,height);
      const blob=await new Promise<Blob>(resolve=>canvas.toBlob(b=>resolve(b!)));
      await e.importImage(new File([blob],'selection.png',{type:'image/png'}));
    },{width,height});
    await page.waitForTimeout(200);
    const profiler=process.env.LUMA_PROFILE ? await page.context().newCDPSession(page) : null;
    if(profiler){await profiler.send('Profiler.enable');await profiler.send('Profiler.start');}
    const result=await page.evaluate(async()=>{
      const e=window.luma.editor,samples:{action:string;ms:number}[]=[],gaps:number[]=[],longTasks:number[]=[];
      const phases:{action:string;phase:string;ms:number}[]=[];
      let action='';
      let wandCoverageCorrect = true;
      const capture=(e.pixels as any).capture.bind(e.pixels);
      (e.pixels as any).capture=async(...args:unknown[])=>{
        const start=performance.now(),label=action;const result=await capture(...args);
        phases.push({action:label,phase:'pixel-capture',ms:performance.now()-start});return result;
      };
      const selection=e.renderer.processor.selection.bind(e.renderer.processor);
      e.renderer.processor.selection=async(...args)=>{
        const start=performance.now(),label=action;const result=await selection(...args);
        phases.push({action:label,phase:'selection-mask',ms:performance.now()-start});return result;
      };
      let last=performance.now(),running=true;
      const frame=(now:number)=>{gaps.push(now-last);last=now;if(running)requestAnimationFrame(frame);};
      requestAnimationFrame(frame);
      const observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())longTasks.push(entry.duration);});
      observer.observe({type:'longtask'});
      const measure=async(label:string,run:()=>Promise<void>)=>{
        action=label;const start=performance.now();await run();samples.push({action,ms:performance.now()-start});action='';
        await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
      };
      for(let i=0;i<5;i++){
        await measure('wand',()=>e.pixels.wand({x:10,y:10}));
        const coverage=e.document.selection!.toJSON().regions[0].coverage!;
        wandCoverageCorrect &&= coverage.width===e.document.width && coverage.height===e.document.height &&
          coverage.runs.length===e.document.height*4 && coverage.runs.every((value,index)=>{
            const row=Math.floor(index/4),slot=index%4;
            return value===(slot===0 ? row*e.document.width+e.document.width/2 : slot===1 ? 255 : slot===2 ? (row+1)*e.document.width : 0);
          });
        await measure('load-transparency',()=>e.pixels.loadTransparency());
        await measure('copy',()=>e.pixels.copy());
        await measure('paste',()=>e.pixels.paste());
        e.document.undo();e.document.selectedLayer=e.document.layers.at(0)!;
        e.document.selection=null;
        await new Promise(requestAnimationFrame);
      }
      await new Promise(resolve=>setTimeout(resolve,100));running=false;observer.disconnect();
      return {samples,phases,gaps,longTasks,wandCoverageCorrect,layers:e.document.layers.length,canPaste:e.pixels.canPaste};
    });
    if(profiler){const {profile}=await profiler.send('Profiler.stop');const path=info.outputPath('pixels.cpuprofile');await writeFile(path,JSON.stringify(profile));await info.attach('cpu-profile',{path,contentType:'application/json'});await profiler.detach();}
    console.log('pixel-operation-latency',JSON.stringify({width,height,...result}));
    await info.attach('pixel-operation-latency',{body:JSON.stringify(result),contentType:'application/json'});
    expect(result.wandCoverageCorrect).toBe(true);expect(result.layers).toBe(1);expect(result.canPaste).toBe(true);
  });
}
