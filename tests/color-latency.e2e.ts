import {test,expect} from '@playwright/test';

for (const layers of [5,20]) test(`color overlay input with ${layers} layers records preview and commit latency`,async({page},info)=>{
 await page.goto('/');
 await page.evaluate(layers=>{
  const {editor:e,PaintLayer,PaintFill}=window.luma;
  e.newDocument({width:800,height:600});
  e.document.transaction('Fixture',()=>{
   for(let i=0;i<layers;i++){
    const layer=e.document.layers.add(new PaintLayer());
    layer.strokes.add(new PaintFill({bounds:{x:0,y:0,width:800,height:600},color:'#804020'}));
   }
  });
  e.document.selectedLayer=e.document.layers.at(layers-1)!;
 },layers);
 await page.getByRole('checkbox',{name:'Enable color overlay',exact:true}).check();
 await page.getByLabel('Overlay color',{exact:true}).focus();
 await page.waitForTimeout(200);
 const result=await page.evaluate(async()=>{
  const e=window.luma.editor,input=document.querySelector<HTMLInputElement>('[aria-label="Overlay color"]')!;
  const revision=e.document.getSnapshot().revision,original=e.document.selectedLayer!.styles.toJSON().colorOverlay.color;
  const samples:{phase:string;ms:number;prepareMs:number}[]=[],longTasks:number[]=[];
  let pending:{start:number;phase:string;done:()=>void}|undefined;
  const observer=new PerformanceObserver(list=>{for(const task of list.getEntries())longTasks.push(task.duration);});
  observer.observe({type:'longtask'});
  const prepare=e.renderer.prepareViewport.bind(e.renderer);
  e.renderer.prepareViewport=async(...args)=>{
   const measured=pending,start=performance.now(),frame=await prepare(...args),prepareMs=performance.now()-start,present=frame.present.bind(frame);
   frame.present=canvas=>{
    present(canvas);
    if(measured && pending===measured){samples.push({phase:measured.phase,ms:performance.now()-measured.start,prepareMs});pending=undefined;measured.done();}
   };
   return frame;
  };
  const measure=(phase:string,color:string)=>new Promise<void>((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error(`No color ${phase} presentation`)),5000);
   pending={start:performance.now(),phase,done:()=>{clearTimeout(timer);resolve();}};
   input.value=color;
   input.dispatchEvent(new Event(phase==='preview'?'input':'change',{bubbles:true}));
  });
  for(let i=0;i<30;i++)await measure('preview',i===29?'#0000ff':`#${(0x204060+i*512).toString(16).padStart(6,'0')}`);
  const previewRevision=e.document.getSnapshot().revision;
  await measure('commit','#0000ff');
  const commitRevision=e.document.getSnapshot().revision,color=e.document.selectedLayer!.styles.toJSON().colorOverlay.color;
  await new Promise(requestAnimationFrame);observer.disconnect();
  e.document.undo();
  return {samples,longTasks,revision,previewRevision,commitRevision,color,original,undone:e.document.selectedLayer!.styles.toJSON().colorOverlay.color};
 });
 console.log('color-latency',JSON.stringify({layers,...result}));
 await info.attach('color-latency',{body:JSON.stringify({layers,...result}),contentType:'application/json'});
 expect(result.samples.filter(s=>s.phase==='preview')).toHaveLength(30);
 expect(result.previewRevision).toBe(result.revision);
 expect(result.commitRevision).toBe(result.revision+1);
 expect(result.color).toBe('#0000ff');expect(result.undone).toBe(result.original);
});
