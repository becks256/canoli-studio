import {writeFile} from 'node:fs/promises';
import {test,expect} from '@playwright/test';

test('tool switching stays measurable through a mixed session of strokes and history',async({page},info)=>{
  const rounds=Number(process.env.LUMA_MIXED_ROUNDS ?? 15);
  test.setTimeout(Math.max(120000,rounds*5000));
  await page.goto('/');
  await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
  await page.evaluate(()=>{
    const {editor,PaintLayer,PaintFill,LayerStyle}=window.luma;
    editor.newDocument({width:698,height:396});
    for(let i=0;i<5;i++){
      const layer=editor.document.layers.add(new PaintLayer());
      layer.strokes.add(new PaintFill({bounds:{x:0,y:0,width:698,height:396},color:'#907050'}));
      layer.styles=new LayerStyle({colorOverlay:{enabled:true,color:'#508080',opacity:0.3}});
      editor.document.selectedLayer=layer;
    }
  });
  await page.keyboard.press('Control+1');await page.waitForTimeout(200);
  await page.evaluate(()=>{
    const state={strokes:[] as {tool:string;start:number;commitMs:number;presentMs:number}[],samples:[] as {tool:string;domMs:number;frameMs:number}[],longTasks:[] as {start:number;duration:number}[],thumbnails:[] as {start:number;end:number}[]};
    (window as any).mixedTiming=state;
    const editor=window.luma.editor;
    let pendingStroke:{tool:string;start:number;commitMs:number}|undefined;
    const end=editor.tools.end.bind(editor.tools);
    editor.tools.end=async(...args)=>{
      const start=performance.now(),tool=document.querySelector('nav[aria-label="Editor tools"] button[aria-pressed="true"]')?.getAttribute("aria-label") ?? "unknown";
      await end(...args);
      pendingStroke={tool,start,commitMs:performance.now()-start};
    };
    const prepare=editor.renderer.prepareViewport.bind(editor.renderer);
    editor.renderer.prepareViewport=async(...args)=>{
      const frame=await prepare(...args);
      if(!args[2]?.paintPreview){
        const present=frame.present.bind(frame);
        frame.present=canvas=>{
          present(canvas);
          if(pendingStroke){state.strokes.push({...pendingStroke,presentMs:performance.now()-pendingStroke.start});pendingStroke=undefined;}
        };
      }
      return frame;
    };
    const pixels=window.luma.editor.pixels, thumbnail=pixels.thumbnail.bind(pixels);
    pixels.thumbnail=async(...args)=>{
      const start=performance.now();
      try{return await thumbnail(...args);}finally{state.thumbnails.push({start,end:performance.now()});}
    };
    let pending:{button:HTMLElement;tool:string;start:number}|undefined;
    const observer=new MutationObserver(()=>{
      if(!pending || pending.button.getAttribute('aria-pressed')!=='true')return;
      const current=pending;pending=undefined;const domMs=performance.now()-current.start;
      requestAnimationFrame(()=>state.samples.push({tool:current.tool,domMs,frameMs:performance.now()-current.start}));
    });
    observer.observe(document.body,{subtree:true,attributes:true,attributeFilter:['aria-pressed']});
    window.addEventListener('click',event=>{
      const button=(event.target as Element).closest('button');
      const tool=button?.getAttribute('aria-label');
      if(button && tool?.includes(' tool (') && button.getAttribute('aria-pressed')!=='true')
        pending={button,tool,start:performance.now()};
    },true);
    const tasks=new PerformanceObserver(list=>{for(const entry of list.getEntries())state.longTasks.push({start:entry.startTime,duration:entry.duration});});
    tasks.observe({type:'longtask'});
  });
  const profiler=process.env.LUMA_PROFILE ? await page.context().newCDPSession(page) : null;
  if(profiler){await profiler.send('Profiler.enable');await profiler.send('Profiler.start');}
  const labels=['Brush tool (B)','Pencil tool (N)','Eraser tool (E)','Marquee tool (M)','Lasso tool (L)','Magic wand tool (W)','Move tool (V)'];
  const box=(await page.locator('.canvas-wrap').boundingBox())!;
  let count=0;
  for(let round=0;round<rounds;round++){
    for(const [index,label] of labels.entries()){
      const button=page.getByRole('button',{name:label,exact:true});await button.click();
      await expect(button).toHaveAttribute('aria-pressed','true');
      await expect.poll(()=>page.evaluate(()=>(window as any).mixedTiming.samples.length)).toBe(++count);
      if(index<3){
        await page.mouse.move(box.x+30,box.y+30+(round%15)*18);await page.mouse.down();
        await page.mouse.move(box.x+400,box.y+40+(round%15)*18,{steps:5});await page.mouse.up();
        await expect.poll(()=>page.evaluate(()=>(window as any).mixedTiming.strokes.length)).toBe(round*3+index+1);
      }
    }
    await page.keyboard.press('Control+z');await page.keyboard.press('Control+Shift+z');
  }
  await page.evaluate(()=>window.luma.editor.workspaceAutosave.flush());
  const result=await page.evaluate(()=>({...(window as any).mixedTiming,
    history:window.luma.editor.document.getSnapshot().past.length,
    strokeCount:(window.luma.editor.document.selectedLayer as InstanceType<typeof window.luma.PaintLayer>).strokes.length,
    saved:window.luma.editor.workspaceAutosave.getSnapshot().status}));
  if(profiler){const {profile}=await profiler.send('Profiler.stop');const path=info.outputPath('mixed.cpuprofile');await writeFile(path,JSON.stringify(profile));await info.attach('cpu-profile',{path,contentType:'application/json'});await profiler.detach();}
  console.log('mixed-session-latency',JSON.stringify(result));
  await info.attach('mixed-session-latency',{body:JSON.stringify(result),contentType:'application/json'});
  expect(result.samples).toHaveLength(rounds*7);expect(result.strokeCount).toBe(1+rounds*3);
  expect(result.history).toBeLessThanOrEqual(60);expect(result.saved).toBe('saved');
});
