import {test,expect} from '@playwright/test';
import {sourcePng} from './png-fixture';

test('50 MP diagonal clone stroke records live feedback and commit',async({page},info)=>{
 await page.goto('/');await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
 const bytes=await sourcePng(10000,5000);
 await page.evaluate(async bytes=>{
  const {editor:e,PaintLayer,PaintFill}=window.luma;e.newDocument({width:10000,height:5000});
  await e.importImage(new File([new Uint8Array(bytes)],'50MP.png',{type:'image/png'}));
  const color=e.document.layers.add(new PaintLayer());color.strokes.add(new PaintFill({bounds:{x:0,y:0,width:10000,height:2200},color:'#ff3300'}));
  e.document.selectedLayer=null;e.tools.configure({size:200,hardness:1,opacity:1,flow:1,smoothing:0,pressureSize:false,pressureOpacity:false});
 },[...bytes]);
 await page.keyboard.press('Control+0');await page.keyboard.press('s');await page.waitForTimeout(200);
 await page.evaluate(()=>window.luma.editor.tools.configure({size:200,hardness:1,opacity:1,flow:1,smoothing:0,pressureSize:false,pressureOpacity:false}));
 await page.evaluate(value=>{(window as any).profileLargeClone=value;},!!process.env.LUMA_PROFILE);
 await page.evaluate(()=>{
  const state={start:0,up:0,live:[] as number[],commit:0,longTasks:[] as number[],encoding:[] as number[],phases:[] as {method:string;start:number;ms:number}[],longTaskDetails:[] as {start:number;ms:number}[]};(window as any).largeCloneTiming=state;
  const toBlob=HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob=function(callback,...args){const start=performance.now();return toBlob.call(this,blob=>{state.encoding.push(performance.now()-start);callback(blob);},...args);};
  new PerformanceObserver(list=>{for(const e of list.getEntries()){state.longTasks.push(e.duration);state.longTaskDetails.push({start:e.startTime,ms:e.duration});}}).observe({type:'longtask'});
  window.addEventListener('pointermove',event=>{if(event.buttons===1)state.start=performance.now();},true);
  window.addEventListener('pointerup',()=>state.up=performance.now(),true);
  const renderer=window.luma.editor.renderer,prepare=renderer.prepareViewport.bind(renderer);
  if((window as any).profileLargeClone){
   const e=window.luma.editor;
   for(const [owner,method] of [[e.tools,'sampleClone'],[e.assetStore,'add'],[renderer,'render']] as [any,string][]){
    const original=owner[method].bind(owner);
    owner[method]=async(...args:unknown[])=>{const start=performance.now();try{return await original(...args);}finally{state.phases.push({method,start,ms:performance.now()-start});}};
   }
  }
  renderer.prepareViewport=async(...args)=>{
   const start=state.start,preview=args[2]?.paintPreview,frame=await prepare(...args),present=frame.present.bind(frame);
   frame.present=canvas=>{present(canvas);if(preview?.cloneSource&&start)state.live.push(performance.now()-start);else if(state.up&&state.start&&!preview)state.commit=performance.now()-state.up;};return frame;
  };
 });
 const box=(await page.locator('.canvas-wrap').boundingBox())!,scale=box.width/10000;
 const move=async(x:number,y:number)=>page.mouse.move(box.x+x*scale,box.y+y*scale);
 await page.keyboard.down('Alt');await move(2000,500);await page.mouse.down();await page.mouse.up();await page.keyboard.up('Alt');
 const revision=await page.evaluate(()=>window.luma.editor.document.getSnapshot().revision);
 await move(2000,2500);await page.mouse.down();
 for(let i=1;i<=30;i++){await move(2000+i*200,2500+i*50);await page.waitForTimeout(16);}
 expect(await page.evaluate(()=>window.luma.editor.document.getSnapshot().revision)).toBe(revision);
 await page.mouse.up();
 await expect.poll(()=>page.evaluate(()=>(window as any).largeCloneTiming.commit),{timeout:60000}).toBeGreaterThan(0);
 const result=await page.evaluate(async()=>{
  const e=window.luma.editor,c=await e.renderer.render(e.document.getSnapshot().document,e.assetStore,{cache:false,region:{x:7900,y:3975,width:1,height:1}});
  const pixel=[...c.getContext('2d')!.getImageData(0,0,1,1).data];c.width=0;
  return {...(window as any).largeCloneTiming,pixel,dimensions:[e.document.width,e.document.height],revision:e.document.getSnapshot().revision,layer:e.document.selectedLayer!.toJSON(),offset:e.tools.getSnapshot().cloneOffset};
 });
 console.log('large-clone-latency',JSON.stringify(result));await info.attach('large-clone-latency',{body:JSON.stringify(result),contentType:'application/json'});
 expect(result.dimensions).toEqual([10000,5000]);expect(result.revision).toBe(revision+1);expect(result.pixel).toEqual([255,51,0,255]);expect(result.live.length).toBeGreaterThan(10);
});
