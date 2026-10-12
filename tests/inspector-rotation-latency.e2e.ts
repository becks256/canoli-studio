import {test,expect} from '@playwright/test';

for(const strokes of [0,64]) test(`inspector rotation with ${strokes*1000} retained paint points`,async({page},info)=>{
  await page.goto('/');
  await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
  await page.evaluate(async strokes=>{
    const {editor:e,PaintLayer,BrushStroke}=window.luma;
    e.newDocument({width:698,height:396});
    const retained=new PaintLayer({visible:false});
    for(let i=0;i<strokes;i++)retained.strokes.add(new BrushStroke({size:5,color:'#345678',points:Array.from({length:1000},(_,j)=>({x:20+j*.6,y:20+i*5,pressure:1}))}));
    e.document.layers.add(retained);
    const canvas=new OffscreenCanvas(160,80),c=canvas.getContext('2d')!;
    c.fillStyle='#ee6633';c.fillRect(0,0,160,80);
    const layer=await e.importImage(new File([await canvas.convertToBlob()],'Rotate.png',{type:'image/png'}));
    layer.update({x:220,y:140});
  },strokes);
  await page.keyboard.press('Control+1');
  await expect(page.locator('footer .status-dot.working')).toHaveCount(0);
  const revision=await page.evaluate(()=>window.luma.editor.document.getSnapshot().revision);
  const slider=page.getByRole('slider',{name:'Rotation',exact:true});
  await slider.evaluate(element=>{
    const e=window.luma.editor,timing={start:0,phase:'preview',sequence:0,copies:0,copyMs:0,frames:[] as {phase:string;ms:number}[]};
    (window as any).rotationTiming=timing;
    const serialize=e.document.toJSON.bind(e.document);
    e.document.toJSON=()=>{const start=performance.now();try{return serialize();}finally{timing.copies++;timing.copyMs+=performance.now()-start;}};
    element.addEventListener('input',()=>{timing.start=performance.now();timing.phase='preview';timing.sequence++;},true);
    window.addEventListener('pointerup',()=>{timing.start=performance.now();timing.phase='commit';timing.sequence++;},true);
    const prepare=e.renderer.prepareViewport.bind(e.renderer);
    e.renderer.prepareViewport=async(...args)=>{
      const {start,phase,sequence}=timing,frame=await prepare(...args),present=frame.present.bind(frame);
      frame.present=canvas=>{present(canvas);if(start){timing.frames.push({phase,ms:performance.now()-start});if(sequence===timing.sequence)timing.start=0;}};
      return frame;
    };
  });
  const box=(await slider.boundingBox())!;
  const x=box.x+box.width/2,y=box.y+box.height/2;
  await page.mouse.move(x,y);await page.mouse.down();
  for(let i=1;i<=30;i++){await page.mouse.move(x+box.width*.2*i/30,y);await page.waitForTimeout(16);}
  expect(await page.evaluate(()=>window.luma.editor.document.getSnapshot().revision)).toBe(revision);
  const degrees=Number(await slider.inputValue());
  await page.mouse.up();
  await expect.poll(()=>page.evaluate(()=>(window as any).rotationTiming.frames.some((f:{phase:string})=>f.phase==='commit'))).toBe(true);
  const result=await page.evaluate(()=>{const e=window.luma.editor,layer=e.document.selectedLayer!;return {...(window as any).rotationTiming,revision:e.document.getSnapshot().revision,transform:layer.transform.toJSON()};});
  expect(result.revision).toBe(revision+1);
  expect(Math.atan2(result.transform.b,result.transform.a)*180/Math.PI).toBeCloseTo(degrees,3);
  expect(result.frames.filter((f:{phase:string})=>f.phase==='preview').length).toBeGreaterThan(10);
  await slider.blur();
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(()=>window.luma.editor.document.selectedLayer!.transform.toJSON())).toMatchObject({a:1,b:0,c:0,d:1});
  console.log('inspector-rotation-latency',JSON.stringify({strokes,...result}));
  await info.attach('inspector-rotation-latency',{body:JSON.stringify({strokes,...result}),contentType:'application/json'});
});
