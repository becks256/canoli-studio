import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test('sustained five-layer painting records commit-to-presentation latency', async ({ page }, info) => {
  await page.goto('/');
  await page.getByRole('button', {name:'Move tool (V)',exact:true}).click();
  await page.evaluate(() => {
    const {editor, PaintLayer, PaintFill}=window.luma;
    editor.newDocument({width:698,height:396});
    editor.document.transaction('Fixture',()=>{
      for(let i=0;i<5;i++){
        const layer=editor.document.layers.add(new PaintLayer({name:`Layer ${i}`}));
        layer.strokes.add(new PaintFill({bounds:{x:i*30,y:i*20,width:300,height:200},color:'#807060'}));
      }
    });
    editor.document.selectedLayer=editor.document.layers.at(4)!;
  });
  await page.keyboard.press('Control+1');
  await page.getByRole('button',{name:'Brush tool (B)',exact:true}).click();
  await page.evaluate(()=>{
    const e=window.luma.editor;
    const samples:{commitMs:number;presentMs:number;backend:string}[]=[];
    (window as any).sustainedSamples=samples;
    let pending:{start:number;commitMs:number}|undefined;
    const end=e.tools.end.bind(e.tools);
    e.tools.end=async(...args)=>{
      const start=performance.now();
      await end(...args);
      pending={start,commitMs:performance.now()-start};
    };
    const prepare=e.renderer.prepareViewport.bind(e.renderer);
    e.renderer.prepareViewport=async(...args)=>{
      const frame=await prepare(...args);
      if(!args[2]?.paintPreview){
        const present=frame.present.bind(frame);
        frame.present=canvas=>{
          present(canvas);
          if(pending){samples.push({commitMs:pending.commitMs,presentMs:performance.now()-pending.start,backend:frame.backend});pending=undefined;}
        };
      }
      return frame;
    };
  });
  const profiler=process.env.LUMA_PROFILE ? await page.context().newCDPSession(page) : null;
  if(profiler){await profiler.send('Profiler.enable');await profiler.send('Profiler.start');}
  const box=(await page.locator('.canvas-wrap').boundingBox())!;
  for(let i=0;i<60;i++){
    await page.mouse.move(box.x+30,box.y+30+(i%20)*15);
    await page.mouse.down();
    await page.mouse.move(box.x+600,box.y+40+(i%20)*15,{steps:6});
    await page.mouse.up();
    await expect.poll(()=>page.evaluate(()=>(window as any).sustainedSamples.length)).toBe(i+1);
  }
  if(profiler){const {profile}=await profiler.send('Profiler.stop');const path=info.outputPath('paint.cpuprofile');await writeFile(path,JSON.stringify(profile));await info.attach('cpu-profile',{path,contentType:'application/json'});await profiler.detach();}
  const samples=await page.evaluate(()=>(window as any).sustainedSamples);
  const result={document:{width:698,height:396,layers:5},samples};
  await info.attach('sustained-paint',{body:JSON.stringify(result,null,2),contentType:'application/json'});
  console.log('sustained-paint',JSON.stringify(result));
  expect(await page.evaluate(()=>window.luma.editor.document.layers.length)).toBe(5);
});
