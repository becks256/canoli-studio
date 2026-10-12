import {test,expect} from '@playwright/test';

test('deep paint history records undo and redo presentation latency',async({page},info)=>{
  await page.goto('/');
  await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
  await page.evaluate(()=>{
    const {editor,PaintLayer,PaintFill}=window.luma;
    editor.newDocument({width:698,height:396});
    editor.document.transaction('Fixture',()=>{
      for(let i=0;i<5;i++){
        const layer=editor.document.layers.add(new PaintLayer({name:`Routine ${i}`}));
        layer.strokes.add(new PaintFill({bounds:{x:i*10,y:20,width:300,height:200},color:'#807060'}));
      }
    });
    editor.document.selectedLayer=editor.document.layers.at(4)!;
  });
  await page.keyboard.press('Control+1');
  await page.waitForTimeout(250);
  await page.evaluate(async()=>{
    const {editor,BrushStroke,PaintLayer}=window.luma;
    const layer=editor.document.selectedLayer as InstanceType<typeof PaintLayer>;
    for(let i=0;i<40;i++){
      layer.strokes.add(new BrushStroke({points:[{x:30,y:30+i*8,pressure:1},{x:620,y:35+i*8,pressure:1}],size:20,hardness:0.5,color:'#a04070'}));
      await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
    }
  });
  await page.evaluate(()=>{
    const e=window.luma.editor;
    const state={label:'',started:0,samples:[] as {action:string;ms:number;backend:string}[]};
    (window as any).routineTiming=state;
    const begin=(event:Event)=>{
      if(!state.label || state.started)return;
      if(event instanceof KeyboardEvent && ['Control','Shift','Alt','Meta'].includes(event.key))return;
      state.started=performance.now();
    };
    window.addEventListener('keydown',begin,true);window.addEventListener('click',begin,true);
    const prepare=e.renderer.prepareViewport.bind(e.renderer);
    e.renderer.prepareViewport=async(...args)=>{
      const frame=await prepare(...args),present=frame.present.bind(frame);
      frame.present=canvas=>{
        present(canvas);
        if(state.started){state.samples.push({action:state.label,ms:performance.now()-state.started,backend:frame.backend});state.started=0;state.label='';}
      };
      return frame;
    };
  });
  const measure=async(label:string,action:()=>Promise<unknown>)=>{
    const count=await page.evaluate(label=>{const s=(window as any).routineTiming;s.label=label;return s.samples.length;},label);
    await action();
    await expect.poll(()=>page.evaluate(()=>(window as any).routineTiming.samples.length)).toBe(count+1);
  };
  for(let i=0;i<10;i++)await measure('undo',()=>page.keyboard.press('Control+z'));
  expect(await page.evaluate(()=>(window.luma.editor.document.selectedLayer as InstanceType<typeof window.luma.PaintLayer>).strokes.length)).toBe(31);
  for(let i=0;i<10;i++)await measure('redo',()=>page.keyboard.press('Control+Shift+z'));
  const samples=await page.evaluate(()=>(window as any).routineTiming.samples);
  console.log('deep-history-latency',JSON.stringify(samples));
  await info.attach('deep-history-latency',{body:JSON.stringify(samples),contentType:'application/json'});
  expect(await page.evaluate(()=>(window.luma.editor.document.selectedLayer as InstanceType<typeof window.luma.PaintLayer>).strokes.length)).toBe(41);
});
