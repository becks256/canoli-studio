import {writeFile} from 'node:fs/promises';
import {test,expect} from '@playwright/test';

for(const styled of [false,true])for(const layers of [5,20])for(const gesture of ['rotate','resize'] as const)test(`${gesture} with ${layers} layers${styled?' styled':''} records live and committed response`,async({page},info)=>{
  await page.goto('/');await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
  await page.evaluate(async({layers,styled})=>{
    const {editor:e,PaintLayer,PaintFill,LayerStyle,LayerMask,MarqueeSelection}=window.luma;e.newDocument({width:698,height:396});
    for(let i=0;i<layers-1;i++){
      const layer=e.document.layers.add(new PaintLayer());
      layer.strokes.add(new PaintFill({bounds:{x:10*i,y:10,width:300,height:300},color:'#345678'}));
      if(styled){layer.styles=new LayerStyle({dropShadow:{enabled:true,blur:8,x:4,y:5,opacity:.4,color:'#000000'},colorOverlay:{enabled:true,opacity:.25,color:'#5080c0'}});layer.mask=new LayerMask({selection:new MarqueeSelection({shape:'ellipse',x:0,y:0,width:350,height:350}),feather:4});}

    }
    const canvas=new OffscreenCanvas(160,80),c=canvas.getContext('2d')!;
    c.fillStyle='#ee6633';c.fillRect(0,0,160,80);
    const layer=await e.importImage(new File([await canvas.convertToBlob()],'Transform.png',{type:'image/png'}));layer.update({x:220,y:140});
    if(styled){layer.styles=new LayerStyle({dropShadow:{enabled:true,blur:8,x:4,y:5,opacity:.4,color:'#000000'},colorOverlay:{enabled:true,opacity:.25,color:'#5080c0'}});layer.mask=new LayerMask({selection:new MarqueeSelection({shape:'ellipse',x:0,y:0,width:160,height:80}),feather:4});}
  },{layers,styled});
  await page.keyboard.press('Control+1');await page.waitForTimeout(200);
  const revision=await page.evaluate(()=>window.luma.editor.document.getSnapshot().revision);
  await page.evaluate(value=>{(window as any).profileTransforms=value;},!!process.env.LUMA_PROFILE);
  await page.evaluate(()=>{
    const state={start:0,phase:'move',sequence:0,phases:[] as {method:string;ms:number}[],frames:[] as {phase:string;ms:number;prepareMs:number;waitBeforePrepareMs:number}[]};(window as any).transformTiming=state;
    const input=(phase:string)=>{state.start=performance.now();state.phase=phase;state.sequence++;};
    window.addEventListener('pointermove',event=>{if(event.buttons===1)input('move');},true);
    window.addEventListener('pointerup',()=>input('commit'),true);
    const e=window.luma.editor,prepare=e.renderer.prepareViewport.bind(e.renderer);
    if((window as any).profileTransforms){
      const renderer=e.renderer as any;
      for(const method of ['renderMaskCoverage','raster']){
        const original=renderer[method].bind(renderer);
        renderer[method]=async(...args:unknown[])=>{const start=performance.now();try{return await original(...args);}finally{state.phases.push({method,ms:performance.now()-start});}};
      }
      const processor=e.renderer.processor as any;
      for(const method of ['selection','feather']){
        const original=processor[method].bind(processor);
        processor[method]=async(...args:unknown[])=>{const start=performance.now();try{return await original(...args);}finally{state.phases.push({method,ms:performance.now()-start});}};
      }
    }
    e.renderer.prepareViewport=async(...args)=>{
      const {start,phase,sequence}=state,begin=performance.now(),frame=await prepare(...args),prepareMs=performance.now()-begin,present=frame.present.bind(frame);
      frame.present=canvas=>{present(canvas);if(start){state.frames.push({phase,ms:performance.now()-start,prepareMs,waitBeforePrepareMs:begin-start});if(sequence===state.sequence)state.start=0;}};
      return frame;
    };
  });
  const profiler=process.env.LUMA_PROFILE ? await page.context().newCDPSession(page) : null;
  if(profiler){await profiler.send('Profiler.enable');await profiler.send('Profiler.start');}
  const box=(await page.locator('.canvas-wrap').boundingBox())!;
  const handle=gesture==='rotate'?page.getByRole('button',{name:'Drag to rotate layer'}):page.locator('[data-handle="se"]');
  const h=(await handle.boundingBox())!,x=h.x+h.width/2,y=h.y+h.height/2;
  const cx=box.x+300,cy=box.y+180,angle=Math.atan2(y-cy,x-cx),radius=Math.hypot(x-cx,y-cy);
  await page.mouse.move(x,y);await page.mouse.down();
  for(let i=1;i<=30;i++){
    await page.mouse.move(gesture==='rotate'?cx+Math.cos(angle+Math.PI/2*i/30)*radius:x+i*2,gesture==='rotate'?cy+Math.sin(angle+Math.PI/2*i/30)*radius:y+i);
    await page.waitForTimeout(16);
  }
  expect(await page.evaluate(()=>window.luma.editor.document.getSnapshot().revision)).toBe(revision);
  await page.mouse.up();
  await expect.poll(()=>page.evaluate(()=>(window as any).transformTiming.frames.some((frame:{phase:string})=>frame.phase==='commit'))).toBe(true);
  const result=await page.evaluate(()=>({frames:(window as any).transformTiming.frames,phases:(window as any).transformTiming.phases,revision:window.luma.editor.document.getSnapshot().revision,layer:window.luma.editor.document.selectedLayer!.toJSON()}));
  expect(result.revision).toBe(revision+1);
  if(gesture==='rotate'){expect(result.layer.transform!.a).toBeCloseTo(0);expect(result.layer.transform!.b).toBeCloseTo(1);}
  else {expect(result.layer.kind).toBe('raster');if(result.layer.kind==='raster'){expect(result.layer.width).toBeCloseTo(220);expect(result.layer.height).toBeCloseTo(110);}}
  if(profiler){const {profile}=await profiler.send('Profiler.stop');const path=info.outputPath('transform.cpuprofile');await writeFile(path,JSON.stringify(profile));await info.attach('cpu-profile',{path,contentType:'application/json'});await profiler.detach();}
  console.log('transform-latency',JSON.stringify({layers,gesture,styled,frames:result.frames,phases:result.phases}));
  await info.attach('transform-latency',{body:JSON.stringify({layers,gesture,styled,frames:result.frames,phases:result.phases}),contentType:'application/json'});
  expect(result.frames.filter((f:{phase:string})=>f.phase==='move').length).toBeGreaterThan(10);

});
