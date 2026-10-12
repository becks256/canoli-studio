import {test,expect} from '@playwright/test';

test('scripts on a stroke-heavy document record snapshot transport latency',async({page},info)=>{
 await page.goto('/');
 await page.evaluate(()=>{
  const {editor:e,PaintLayer,BrushStroke}=window.luma;
  e.newDocument({width:800,height:600});
  // Hidden source artwork keeps renderer timing out of this transport diagnostic.
  const layer=new PaintLayer({visible:false});
  for(let i=0;i<64;i++)layer.strokes.add(new BrushStroke({size:5,color:'#345678',points:Array.from({length:1000},(_,j)=>({x:20+j*.7,y:20+i*5+Math.sin(j/10)*2,pressure:1}))}));
  e.document.layers.add(layer);
 });
 await page.waitForTimeout(200);
 const reconstruction=await page.evaluate(()=>{
  const {editor:e,Document}=window.luma,data=e.document.toJSON(),samples=[];
  for(let i=0;i<5;i++){
   const start=performance.now(),copy=Document.fromJSON(data);
   samples.push({ms:performance.now()-start,layers:copy.layers.length,history:copy.getSnapshot().past.length});
  }
  return samples;
 });
 console.log('document-reconstruction-latency',JSON.stringify(reconstruction));
 await info.attach('document-reconstruction-latency',{body:JSON.stringify(reconstruction),contentType:'application/json'});
 for(const row of reconstruction){expect(row.layers).toBe(1);expect(row.history).toBe(0);}
 const samples=await page.evaluate(async()=>{
  const e=window.luma.editor,revision=e.document.getSnapshot().revision;
  const samples=[];
  for(let i=0;i<5;i++){
   const start=performance.now();
   const result=await e.scripts.run(e.document,'print(document.layers.length);');
   samples.push({ms:performance.now()-start,commands:result.commands.length,logs:result.logs,revision:e.document.getSnapshot().revision-revision});
  }
  return samples;
 });
 console.log('script-transport-latency',JSON.stringify(samples));
 await info.attach('script-transport-latency',{body:JSON.stringify(samples),contentType:'application/json'});
 for(const row of samples){expect(row.commands).toBe(0);expect(row.logs).toEqual(['1']);expect(row.revision).toBe(0);}
});
