import{test,expect}from'@playwright/test';
import type{AdaptiveRenderer}from'../src/engine/adaptive';

for(const nested of[false,true])test(`cold ${nested?'nested':'flat'} layer composition records queued input and complete pixel identity`,async({page},info)=>{
 await page.goto('/');await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
 const result=await page.evaluate(async nested=>{
  const{editor,Document,TextLayer,LayerGroup}=window.luma,doc=new Document({width:800,height:600});doc.transaction('Cold text fixture',()=>{const owner=nested?doc.layers.add(new LayerGroup()).layers:doc.layers;for(let i=0;i<(nested?63:64);i++){owner.add(new TextLayer({text:`${i} ${'Native font replacement '.repeat(40)}`,x:(i%8)*95,y:Math.floor(i/8)*60,fontFamily:'serif',fontSize:16,color:'#315b2a'}));}});await document.fonts.ready;
  const Renderer=editor.renderer.constructor as typeof AdaptiveRenderer,renderer=new Renderer();await renderer.processor.ready;await new Promise(resolve=>setTimeout(resolve,0));const before=JSON.stringify(doc.toJSON()),revision=doc.getSnapshot().revision,samples:{renderMs:number;inputMs:number;inputBeforeComplete:boolean;sha256:string;ink:boolean}[]=[],longTasks:{startTime:number;duration:number}[]=[];
  const observer=new PerformanceObserver(list=>{for(const e of list.getEntries())longTasks.push({startTime:e.startTime,duration:e.duration});});observer.observe({type:'longtask'});
  try{for(let i=0;i<12;i++){
   renderer.clearCache();const start=performance.now();let complete=false,inputMs=0,inputBeforeComplete=false;const input=new Promise<void>(resolve=>{setTimeout(()=>{inputMs=performance.now()-start;inputBeforeComplete=!complete;resolve();},0);});const canvas=await renderer.render(doc.getSnapshot().document,editor.assetStore);const renderMs=performance.now()-start;complete=true;
   try{await input;const bytes=canvas.getContext('2d')!.getImageData(0,0,800,600).data,sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');samples.push({renderMs,inputMs,inputBeforeComplete,sha256,ink:bytes.some((v,j)=>j%4===3&&v>0)});}finally{canvas.width=canvas.height=0;}
  }}finally{for(const e of observer.takeRecords())longTasks.push({startTime:e.startTime,duration:e.duration});observer.disconnect();renderer.dispose();}
  return{nested,samples,longTasks,modelExact:before===JSON.stringify(doc.toJSON()),revisionExact:revision===doc.getSnapshot().revision};
 },nested);
 expect(result.samples).toHaveLength(12);expect(result.modelExact&&result.revisionExact).toBe(true);expect(new Set(result.samples.map(s=>s.sha256)).size).toBe(1);for(const s of result.samples){expect(s.renderMs).toBeGreaterThan(0);expect(s.inputMs).toBeGreaterThanOrEqual(0);expect(s.ink).toBe(true);}console.log('layer-render-latency',JSON.stringify(result));await info.attach('layer-render-latency',{body:JSON.stringify(result),contentType:'application/json'});
});
