import {test,expect} from '@playwright/test';
import {sourcePng} from './png-fixture';

test('50 MP import, save and export record completion and UI stalls',async({page},info)=>{
  await page.goto('/');
  const bytes=await sourcePng(10000,5000);
  const result=await page.evaluate(async(bytes)=>{
    const e=window.luma.editor;
    const phases:{action:string;start:number;end:number}[]=[],gaps:number[]=[],longTasks:{start:number;duration:number}[]=[];
    let last=performance.now(),running=true;
    const tick=(now:number)=>{gaps.push(now-last);last=now;if(running)requestAnimationFrame(tick);};requestAnimationFrame(tick);
    const observer=new PerformanceObserver(list=>{for(const t of list.getEntries())longTasks.push({start:t.startTime,duration:t.duration});});observer.observe({type:'longtask'});
    const measure=async<T>(action:string,run:()=>Promise<T>)=>{const start=performance.now(),value=await run();phases.push({action,start,end:performance.now()});await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);return value;};
    e.newDocument();
    const layer=await measure('import',()=>e.importImage(new File([new Uint8Array(bytes)],'50MP.png',{type:'image/png'})));
    layer.setTone({exposure:1});
    const project=await measure('save',()=>e.saveProject());
    e.newDocument();
    await measure('reopen',()=>e.openProject(new File([project],'50MP.luma')));
    const output=await measure('export',()=>e.exportPng());
    const bitmap=await createImageBitmap(output);
    const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const c=canvas.getContext('2d')!;
    const pixels=[];
    for(const [x,y]of [[0,0],[2047,63],[2048,64],[9999,4999]]){
      c.clearRect(0,0,1,1);c.drawImage(bitmap,x,y,1,1,0,0,1,1);pixels.push([...c.getImageData(0,0,1,1).data]);
    }
    const dimensions=[bitmap.width,bitmap.height];bitmap.close();
    await new Promise(resolve=>setTimeout(resolve,100));running=false;observer.disconnect();
    return {phases,gaps,longTasks,pixels,dimensions,document:[e.document.width,e.document.height]};
  },[...bytes]);
  expect(result.dimensions).toEqual([10000,5000]);expect(result.document).toEqual([10000,5000]);
  for(const pixel of result.pixels)expect(pixel).toEqual([80,120,160,255]);
  await page.keyboard.press('Control+1');await page.waitForTimeout(250);
  await page.evaluate(()=>{
    const state={start:0,samples:[] as number[]};(window as any).largeZoom=state;
    window.addEventListener('keydown',event=>{if(['=','-'].includes(event.key))state.start=performance.now();},true);
    const renderer=window.luma.editor.renderer,prepare=renderer.prepareViewport.bind(renderer);
    renderer.prepareViewport=async(...args)=>{
      const frame=await prepare(...args),present=frame.present.bind(frame);
      frame.present=canvas=>{present(canvas);if(state.start){state.samples.push(performance.now()-state.start);state.start=0;}};return frame;
    };
  });
  for(let i=0;i<20;i++){
    await page.keyboard.press(i%2?'-':'=');
    await expect.poll(()=>page.evaluate(()=>(window as any).largeZoom.samples.length)).toBe(i+1);
  }
  const zoom=await page.evaluate(()=>(window as any).largeZoom.samples as number[]);
  console.log('large-image-latency',JSON.stringify({...result,zoom}));
  await info.attach('large-image-latency',{body:JSON.stringify({...result,zoom}),contentType:'application/json'});
});
