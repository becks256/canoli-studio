import {test,expect} from '@playwright/test';

for(const tool of ['dodge','burn','spot-heal','clone'] as const)test(`${tool} repeated gestures record completion and main-thread stalls`,async({page},info)=>{
  const strokes=process.env.LUMA_RETOUCH_STRESS ? 32 : 8;
  await page.goto('/');
  await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
  await page.evaluate(async()=>{
    const e=window.luma.editor;e.newDocument({width:698,height:396});
    const canvas=new OffscreenCanvas(698,396),c=canvas.getContext('2d')!;
    c.fillStyle='#646464';c.fillRect(0,0,698,396);
    for(let i=0;i<8;i++){c.fillStyle='#ff0000';c.fillRect(120,60+i*35,3,3);}
    await e.importImage(new File([await canvas.convertToBlob()],'retouch.png',{type:'image/png'}));
    e.tools.configure({size:16,hardness:1,opacity:1,flow:1,smoothing:0,pressureSize:false,pressureOpacity:false});
  });
  await page.keyboard.press('Control+1');
  await page.keyboard.press(tool==='dodge'?'o':tool==='burn'?'Shift+O':tool==='clone'?'s':'Shift+J');
  await page.waitForTimeout(200);
  await page.evaluate(()=>{
    const e=window.luma.editor;
    const state={start:0,revision:0,samples:[] as number[],longTasks:[] as number[],phases:[] as {method:string;ms:number}[],liveStart:0,liveSamples:[] as {stroke:number;ms:number}[]};(window as any).retouchTiming=state;
    const toBlob=HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob=function(callback,...args){const start=performance.now();return toBlob.call(this,blob=>{state.phases.push({method:'toBlob',ms:performance.now()-start});callback(blob);},...args);};
    const heal=e.healStroke.bind(e);
    e.healStroke=async(...args)=>{const start=performance.now();try{return await heal(...args);}finally{state.phases.push({method:'healStroke',ms:performance.now()-start});}};
    const processorPrototype=Object.getPrototypeOf(e.renderer.processor);
    for(const method of ['findDonor','poissonBlend','blendAdjustment']){
      const original=processorPrototype[method];
      processorPrototype[method]=async function(...args:unknown[]){const start=performance.now();try{return await original.apply(this,args);}finally{state.phases.push({method,ms:performance.now()-start});}};
    }
    const render=e.renderer.render.bind(e.renderer);
    e.renderer.render=async(...args)=>{const start=performance.now();try{return await render(...args);}finally{state.phases.push({method:'render',ms:performance.now()-start});}};
    new PerformanceObserver(list=>{for(const entry of list.getEntries())state.longTasks.push(entry.duration);}).observe({entryTypes:['longtask']});
    window.addEventListener('pointerdown',()=>{state.liveStart=0;},true);
    window.addEventListener('pointerup',()=>{state.start=performance.now();state.revision=e.document.getSnapshot().revision;},true);
    const move=e.tools.move.bind(e.tools);
    e.tools.move=(...args)=>{state.liveStart=performance.now();return move(...args);};
    const prepare=e.renderer.prepareViewport.bind(e.renderer);
    e.renderer.prepareViewport=async(...args)=>{
      const revision=e.document.getSnapshot().revision,liveStart=state.liveStart,preview=args[2]?.paintPreview;
      const frame=await prepare(...args),present=frame.present.bind(frame);
      frame.present=canvas=>{present(canvas);
        // Record all live paint previews so a missing clone preview remains visible.
        if(preview&&liveStart)state.liveSamples.push({stroke:state.samples.length,ms:performance.now()-liveStart});
        if(state.start&&revision>state.revision){state.samples.push(performance.now()-state.start);state.start=0;}};
      return frame;
    };
  });
  const history=await page.evaluate(()=>window.luma.editor.document.getSnapshot().past.length);
  const box=(await page.locator('.canvas-wrap').boundingBox())!;
  if(tool==='clone'){
    await page.keyboard.down('Alt');await page.mouse.click(box.x+60,box.y+40);await page.keyboard.up('Alt');
  }
  for(let i=0;i<strokes;i++){
    await page.mouse.move(box.x+112,box.y+61+(i%8)*35);await page.mouse.down();
    await page.mouse.move(box.x+130,box.y+61+(i%8)*35,{steps:6});await page.mouse.up();
    await expect.poll(()=>page.evaluate(()=>(window as any).retouchTiming.samples.length)).toBe(i+1);
  }
  const result=await page.evaluate(()=>({...(window as any).retouchTiming,history:window.luma.editor.document.getSnapshot().past.length}));
  expect(result.history).toBe(history+strokes);
  if(tool==='dodge'||tool==='burn'||tool==='clone')expect(result.liveSamples.length).toBeGreaterThan(strokes);
  console.log('retouch-latency',JSON.stringify({tool,strokes,...result}));
  await info.attach('retouch-latency',{body:JSON.stringify({tool,strokes,...result}),contentType:'application/json'});
});
