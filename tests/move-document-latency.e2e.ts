import {test,expect} from '@playwright/test';

for (const strokes of [0,64]) test(`move layer with ${strokes * 1000} retained paint points`, async ({page},info) => {
  await page.goto('/');
  await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
  await page.evaluate(async strokes=>{
    const {editor:e,PaintLayer,BrushStroke}=window.luma;
    e.newDocument({width:698,height:396});
    // Keep unrelated source artwork hidden to isolate input/metadata copying.
    const retained=new PaintLayer({visible:false});
    for(let i=0;i<strokes;i++) retained.strokes.add(new BrushStroke({size:5,color:'#345678',points:Array.from({length:1000},(_,j)=>({x:20+j*.6,y:20+i*5,pressure:1}))}));
    e.document.layers.add(retained);
    const canvas=new OffscreenCanvas(160,80),c=canvas.getContext('2d')!;
    c.fillStyle='#ee6633';c.fillRect(0,0,160,80);
    const layer=await e.importImage(new File([await canvas.convertToBlob()],'Move.png',{type:'image/png'}));
    layer.update({x:220,y:140});
  },strokes);
  await page.keyboard.press('Control+1');
  await expect(page.locator('footer .status-dot.working')).toHaveCount(0);
  const revision=await page.evaluate(()=>window.luma.editor.document.getSnapshot().revision);
  await page.evaluate(()=>{
    const e=window.luma.editor;
    const timing={start:0,phase:'move',sequence:0,copies:0,copyMs:0,frames:[] as {phase:string;ms:number}[]};
    (window as any).moveTiming=timing;
    const serialize=e.document.toJSON.bind(e.document);
    e.document.toJSON=()=>{const start=performance.now();try{return serialize();}finally{timing.copies++;timing.copyMs+=performance.now()-start;}};
    window.addEventListener('pointermove',event=>{if(event.buttons===1){timing.start=performance.now();timing.phase='move';timing.sequence++;}},true);
    window.addEventListener('pointerup',()=>{timing.start=performance.now();timing.phase='commit';timing.sequence++;},true);
    const prepare=e.renderer.prepareViewport.bind(e.renderer);
    e.renderer.prepareViewport=async(...args)=>{
      const {start,phase,sequence}=timing,frame=await prepare(...args),present=frame.present.bind(frame);
      frame.present=canvas=>{present(canvas);if(start){timing.frames.push({phase,ms:performance.now()-start});if(sequence===timing.sequence)timing.start=0;}};
      return frame;
    };
  });
  const box=(await page.locator('.canvas-wrap').boundingBox())!;
  await page.mouse.move(box.x+300,box.y+180);await page.mouse.down();
  for(let i=1;i<=30;i++) {await page.mouse.move(box.x+300+i*2,box.y+180+i);await page.waitForTimeout(16);}
  expect(await page.evaluate(()=>window.luma.editor.document.getSnapshot().revision)).toBe(revision);
  await page.mouse.up();
  await expect.poll(()=>page.evaluate(()=>(window as any).moveTiming.frames.some((f:{phase:string})=>f.phase==='commit'))).toBe(true);
  const result=await page.evaluate(()=>({...(window as any).moveTiming,revision:window.luma.editor.document.getSnapshot().revision,x:window.luma.editor.document.selectedLayer!.x,y:window.luma.editor.document.selectedLayer!.y}));
  expect(result.revision).toBe(revision+1);expect([result.x,result.y]).toEqual([280,170]);
  expect(result.frames.filter((f:{phase:string})=>f.phase==='move').length).toBeGreaterThan(10);
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(()=>{const l=window.luma.editor.document.selectedLayer!;return [l.x,l.y];})).toEqual([220,140]);
  console.log('move-document-latency',JSON.stringify({strokes,...result}));
  await info.attach('move-document-latency',{body:JSON.stringify({strokes,...result}),contentType:'application/json'});
});
