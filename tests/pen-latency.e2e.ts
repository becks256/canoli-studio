import {expectPenControl} from './pen-control-position';
import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';

for(const {paths, anchors} of [{paths:20,anchors:4},{paths:200,anchors:4},{paths:2000,anchors:4},{paths:1,anchors:8000}])test(`Pen anchor edit with ${paths} paths and ${anchors} anchors records live response`,async({page},info)=>{
 await page.goto('/');await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
 await page.evaluate(({paths,anchors})=>{
  const {editor:e,VectorLayer,VectorPath}=window.luma;e.newDocument({width:800,height:600});
  const layer=new VectorLayer();
  for(let i=0;i<paths;i++){
   const x=20+(i%20)*30,y=20+Math.floor(i/20)*30;
   layer.paths.add(new VectorPath({points:anchors===4 ? [{x,y},{x:x+18,y},{x:x+18,y:y+18},{x,y:y+18}] : Array.from({length:anchors},(_,j)=>({x:20+(j%20)*30,y:20+Math.floor(j/20)*30})),closed:true,fill:'#ff3300'}));
  }
  e.document.layers.add(layer);e.document.selectedLayer=layer;
 },{paths,anchors});
 await page.keyboard.press('Control+1');await page.keyboard.press('p');await page.waitForTimeout(200);
 const box=(await page.locator('.canvas-wrap').boundingBox())!;
 const revision=await page.evaluate(()=>window.luma.editor.document.getSnapshot().revision);
 await page.evaluate(()=>{
  const state={start:0,phase:'move',sequence:0,frames:[] as {phase:string;ms:number;prepareMs:number;backend:string}[],longTasks:[] as number[],longTaskDetails:[] as {start:number;duration:number}[],events:[] as {phase:string;start:number}[]};(window as any).penTiming=state;
  const input=(phase:string)=>{state.start=performance.now();state.events.push({phase,start:state.start});state.phase=phase;state.sequence++;};
  window.addEventListener('pointerdown',()=>state.events.push({phase:'down',start:performance.now()}),true);
  window.addEventListener('pointermove',event=>{if(event.buttons===1)input('move');else state.events.push({phase:'hover',start:performance.now()});},true);window.addEventListener('pointerup',()=>input('commit'),true);
  new PerformanceObserver(list=>{for(const e of list.getEntries()){state.longTasks.push(e.duration);state.longTaskDetails.push({start:e.startTime,duration:e.duration});}}).observe({type:'longtask'});
  const renderer=window.luma.editor.renderer,prepare=renderer.prepareViewport.bind(renderer);
  renderer.prepareViewport=async(...args)=>{
   const {start,phase,sequence}=state,begin=performance.now(),frame=await prepare(...args),prepareMs=performance.now()-begin,present=frame.present.bind(frame);
   frame.present=canvas=>{present(canvas);if(start){state.frames.push({phase,ms:performance.now()-start,prepareMs,backend:frame.backend});if(sequence===state.sequence)state.start=0;}};return frame;
  };
 });
 const trace = process.env.LUMA_PEN_TRACE ? await page.context().newCDPSession(page) : null;
 if (trace) await trace.send('Tracing.start',{categories:'devtools.timeline',transferMode:'ReturnAsStream'});
 const profiler = process.env.LUMA_PROFILE ? await page.context().newCDPSession(page) : null;
 if (profiler) { await profiler.send('Profiler.enable'); await profiler.send('Profiler.start'); }
 await page.mouse.move(box.x+20,box.y+20);await page.mouse.down();
 for(let i=1;i<=30;i++){await page.mouse.move(box.x+20+i*2,box.y+20+i);await page.waitForTimeout(16);}
 expect(await page.evaluate(()=>window.luma.editor.document.getSnapshot().revision)).toBe(revision);
 await expect(page.getByTestId('pen-controls').locator('rect')).toHaveCount(paths*anchors);
 await expectPenControl(page.getByTestId('pen-controls').locator('rect').first(), 80, 50);
 await page.mouse.up();
 await expect.poll(()=>page.evaluate(()=>(window as any).penTiming.frames.some((f:{phase:string})=>f.phase==='commit'))).toBe(true);
 if (trace) {
  const finished = new Promise<{stream?:string}>(resolve=>trace.once('Tracing.tracingComplete',resolve));
  await trace.send('Tracing.end');
  const {stream}=await finished;if(!stream)throw new Error('Missing browser trace stream');let contents='';
  for (;;) {const chunk=await trace.send('IO.read',{handle:stream});contents+=chunk.data;if(chunk.eof)break;}
  await trace.send('IO.close',{handle:stream});await trace.detach();
  await writeFile(process.env.LUMA_PEN_TRACE!,contents);
 }
 if (profiler) {
  const {profile} = await profiler.send('Profiler.stop');
  if (process.env.LUMA_PEN_PROFILE_DIR) await writeFile(`${process.env.LUMA_PEN_PROFILE_DIR}/pen-${paths}-${anchors}.cpuprofile`,JSON.stringify(profile));
  await info.attach('pen-cpu-profile',{body:JSON.stringify(profile),contentType:'application/json'});
  const times = new Map<number,number>();
  profile.samples?.forEach((id:number,i:number)=>times.set(id,(times.get(id)??0)+(profile.timeDeltas?.[i]??0)));
  console.log('pen-profile',JSON.stringify(profile.nodes.map(node=>({name:node.callFrame.functionName,url:node.callFrame.url,line:node.callFrame.lineNumber,ms:(times.get(node.id)??0)/1000})).sort((a,b)=>b.ms-a.ms).slice(0,25)));
  await profiler.detach();
 }
 const result=await page.evaluate(()=>({...((window as any).penTiming),revision:window.luma.editor.document.getSnapshot().revision,layer:window.luma.editor.document.selectedLayer!.toJSON()}));
 const timings = result.frames.filter((f:{phase:string})=>f.phase==='move').map((f:{ms:number})=>f.ms).sort((a:number,b:number)=>a-b);
 console.log('pen-latency',JSON.stringify({paths,anchors,backends:[...new Set(result.frames.map((frame:{backend:string})=>frame.backend))],frames:timings.length,median:timings[Math.floor(timings.length/2)],p95:timings[Math.floor(timings.length*.95)],commit:result.frames.filter((f:{phase:string})=>f.phase==='commit'),longTasks:result.longTasks,longTaskDetails:result.longTaskDetails,events:result.events}));await info.attach('pen-latency',{body:JSON.stringify({paths,anchors,...result}),contentType:'application/json'});
 expect(result.revision).toBe(revision+1);expect(result.layer.paths[0].points[0]).toMatchObject({x:80,y:50});expect(result.frames.filter((f:{phase:string})=>f.phase==='move').length).toBeGreaterThan(10);
});
