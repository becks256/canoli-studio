import {test,expect} from '@playwright/test';

for(const {lines,characters,layers,style="plain"} of [{lines:1,characters:14,layers:1},{lines:100,characters:14,layers:1},{lines:600,characters:14,layers:1},{lines:1,characters:9900,layers:1},{lines:1,characters:14,layers:64},{lines:1,characters:14,layers:64,style:"overlay"},{lines:1,characters:14,layers:64,style:"shadow"}])test(`text input ${lines} lines, ${characters} characters per line, ${layers} layers ${style} records canvas response`,async({page},info)=>{
  await page.goto('/');
  await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
  await page.evaluate(async({lines,characters,layers,style})=>{
    const {editor,TextLayer,LayerStyle}=window.luma;editor.newDocument({width:800,height:600});
    for(let i=1;i<layers;i++)editor.document.layers.add(new TextLayer({text:`Design layer ${i}`,x:i%10*70,y:Math.floor(i/10)*50,fontSize:16,color:'#ffffff'}));
    const line='Design details'.repeat(Math.ceil(characters/14)).slice(0,characters);
    const layer=editor.document.layers.add(new TextLayer({text:Array(lines).fill(line).join('\n'),fontSize:16,color:'#ffffff'}));
    if(style!=="plain")for(const item of editor.document.layers) item.styles=new LayerStyle({
      colorOverlay:{enabled:true,color:'#e09458',opacity:0.65},
      dropShadow:{enabled:style==="shadow",blur:3,x:2,y:4,opacity:0.5,color:'#362044'},
    });
    editor.document.selectedLayer=layer;await document.fonts.ready;
  },{lines,characters,layers,style});
  await expect(page.locator('footer .status-dot.working')).toHaveCount(0);
  const input=page.getByRole('textbox',{name:'Text content',exact:true});
  await input.focus();await page.keyboard.press('Control+End');
  await page.evaluate(()=>{
    const state={start:0,expected:"",samples:[] as number[],longTasks:[] as number[]};(window as any).textTiming=state;
    new PerformanceObserver(list=>{for(const entry of list.getEntries())state.longTasks.push(entry.duration);}).observe({type:"longtask"});
    window.addEventListener('input',event=>{if((event.target as Element).getAttribute('aria-label')==='Text content'){state.start=performance.now();state.expected=(event.target as HTMLTextAreaElement).value;}},true);
    const renderer=window.luma.editor.renderer,prepare=renderer.prepareViewport.bind(renderer),targetId=window.luma.editor.document.selectedLayer!.id;
    renderer.prepareViewport=async(...args)=>{
      const start=state.start,expected=state.expected;
      const matches=args[0].children.some(layer=>layer.id===targetId&&layer.kind==='text'&&layer.text===expected);
      const frame=await prepare(...args),present=frame.present.bind(frame);
      frame.present=canvas=>{present(canvas);if(start&&matches&&state.start===start){state.samples.push(performance.now()-start);state.start=0;}};
      return frame;
    };
  });
  const profiler=process.env.LUMA_PROFILE?await page.context().newCDPSession(page):undefined;
  if(profiler){await profiler.send("Profiler.enable");await profiler.send("Profiler.start");}
  for(let i=0;i<20;i++){
    await input.pressSequentially('x');
    await expect.poll(()=>page.evaluate(()=>(window as any).textTiming.samples.length)).toBe(i+1);
  }
  if(profiler){const {profile}=await profiler.send("Profiler.stop");const {writeFile}=await import("node:fs/promises");await writeFile(info.outputPath("text.cpuprofile"),JSON.stringify(profile));await profiler.detach();}
  const {samples,longTasks}=await page.evaluate(()=>(window as any).textTiming);
  const text=await input.inputValue();expect(text.endsWith('x'.repeat(20))).toBe(true);
  console.log('text-latency',JSON.stringify({lines,characters,layers,style,samples,longTasks}));
  await info.attach('text-latency',{body:JSON.stringify({lines,characters,layers,style,samples,longTasks}),contentType:'application/json'});
});

for(const paths of [20,200])test(`move vector ${paths} paths records live response`,async({page},info)=>{
  await page.goto('/');await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
  await page.evaluate(paths=>{
    const {editor,VectorLayer,VectorPath}=window.luma;editor.newDocument({width:800,height:600});
    const layer=new VectorLayer({name:'Moving vectors'});
    for(let i=0;i<paths;i++){
      const x=20+i%20*20,y=20+Math.floor(i/20)*20;
      layer.paths.add(new VectorPath({points:[{x,y},{x:x+15,y},{x:x+15,y:y+15},{x,y:y+15}],closed:true,fill:'#ff0000'}));
    }
    editor.document.layers.add(layer);editor.document.selectedLayer=layer;
  },paths);
  await page.keyboard.press('Control+1');await page.waitForTimeout(200);
  await page.evaluate(()=>{
    const e=window.luma.editor,state={first:0,latest:0,phase:'move',sequence:0,samples:[] as number[],frames:[] as {phase:string;oldestInputMs:number;latestInputMs:number;waitBeforePrepareMs:number;prepareMs:number}[]};(window as any).vectorTiming=state;
    const input=(phase:string)=>{const now=performance.now();if(!state.first)state.first=now;state.latest=now;state.phase=phase;state.sequence++;};
    window.addEventListener('pointermove',event=>{if(event.buttons===1)input('move');},true);
    window.addEventListener('pointerup',()=>input('commit'),true);
    const prepare=e.renderer.prepareViewport.bind(e.renderer);
    e.renderer.prepareViewport=async(...args)=>{
      const {first,latest,phase,sequence}=state,started=performance.now();
      const frame=await prepare(...args),prepareMs=performance.now()-started,present=frame.present.bind(frame);
      frame.present=canvas=>{
        present(canvas);
        if(first){
          const now=performance.now();state.frames.push({phase,oldestInputMs:now-first,latestInputMs:now-latest,waitBeforePrepareMs:started-latest,prepareMs});
          state.samples.push(now-latest);
          if(state.sequence===sequence)state.first=state.latest=0;
        }
      };return frame;
    };
  });
  const box=(await page.locator('.canvas-wrap').boundingBox())!;
  await page.mouse.move(box.x+27,box.y+27);await page.mouse.down();
  for(let i=1;i<=30;i++){await page.mouse.move(box.x+27+i*2,box.y+27+i);await page.waitForTimeout(16);}
  await page.mouse.up();
  await expect.poll(()=>page.evaluate(()=>(window as any).vectorTiming.frames.some((frame:{phase:string})=>frame.phase==='commit'))).toBe(true);
  const result=await page.evaluate(()=>({samples:(window as any).vectorTiming.samples,frames:(window as any).vectorTiming.frames,x:window.luma.editor.document.selectedLayer!.x,y:window.luma.editor.document.selectedLayer!.y}));
  expect(result.x).toBe(60);expect(result.y).toBe(30);expect(result.samples.length).toBeGreaterThan(10);
  console.log('vector-latency',JSON.stringify({paths,...result}));
  await info.attach('vector-latency',{body:JSON.stringify({paths,...result}),contentType:'application/json'});
});
